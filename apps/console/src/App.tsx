import { useMemo } from 'react';
import { createDemoShow, DEFAULT_FOOTPRINT, DEFAULT_STAGE, stageGeofence } from '@ghpaths/field-model';
import { simTopology, type MultiDsRobotStatus } from '@ghpaths/show-protocol';
import { useRobots, type RobotState } from './useRobots';
import { useMultiDs } from './useMultiDs';
import { useShow } from './useShow';

const RAD2DEG = 180 / Math.PI;

/** 世界坐标 → SVG 屏幕坐标（世界 +y 向观众，SVG y 向下 → 翻转 y；航向随之取负） */
function toScreen(x: number, y: number): string {
  return `${x.toFixed(3)},${(-y).toFixed(3)}`;
}

function RobotMarker({ state, index }: { state: RobotState; index: number }) {
  const { pose, trail, live } = state;
  const fw = DEFAULT_FOOTPRINT.widthM / 2;
  const fl = DEFAULT_FOOTPRINT.lengthM / 2;
  // 无位姿时停在原点待命（灰色幽灵）
  const x = pose?.xM ?? 0;
  const y = pose?.yM ?? 0;
  const headingDeg = pose ? -pose.headingRad * RAD2DEG : 0;
  return (
    <g className={live ? `robot-layer robot-${index + 1}` : 'robot-layer idle'}>
      {trail.length > 1 && (
        <polyline points={trail.map((p) => toScreen(p.x, p.y)).join(' ')} className="trail" />
      )}
      <g transform={`translate(${x} ${-y}) rotate(${headingDeg})`}>
        {/* 车体：长轴沿局部 +x（rotate 后 +x 即航向方向） */}
        <rect x={-fl} y={-fw} width={fl * 2} height={fw * 2} rx={0.05} className="robot-body" />
        {/* 航向指示：车头短线（局部 +x 端） */}
        <line x1={fl} y1={0} x2={fl + 0.3} y2={0} className="heading" />
      </g>
      <text x={x} y={-y + fw + 0.45} textAnchor="middle" className="robot-label">
        {state.robot}
      </text>
    </g>
  );
}

function dsStateText(ds: MultiDsRobotStatus | undefined, ntLive: boolean, showState?: string): string {
  if (!ds) return 'multi-DS 未连';
  if (ds.state === 'estopped') return '急停';
  if (!ds.linked) return '失联';
  if (ds.state === 'enabled') {
    if (showState === 'held') return '保持中';
    return ntLive ? '运动中' : '已使能';
  }
  return '未使能';
}

export function App() {
  const { robots, sendCommand, publishClock } = useRobots();
  const multiDs = useMultiDs();
  const teams = useMemo(() => simTopology.teams(), []);
  const demoShow = useMemo(() => createDemoShow(teams), [teams]);
  const show = useShow(publishClock, sendCommand, teams);
  const { widthM: w, depthM: d } = DEFAULT_STAGE;
  const fence = stageGeofence(DEFAULT_STAGE, DEFAULT_FOOTPRINT);
  const liveCount = robots.filter((r) => r.live).length;
  const allLive = liveCount === robots.length && robots.length > 0;

  return (
    <main className="app">
      <header>
        <h1>GHPaths 演控台</h1>
        <span className={`badge ${allLive ? 'ok' : liveCount > 0 ? 'warn' : ''}`}>
          {liveCount}/{robots.length} 在线
        </span>
        <span className={`badge ${multiDs.connected ? 'ok' : 'warn'}`}>
          multi-DS {multiDs.connected ? '已连' : '未连'}
        </span>
        <span className={`badge ${show.phase === 'running' ? 'ok' : show.phase === 'held' ? 'warn' : ''}`}>
          {show.phase === 'idle' ? '演出未启动' : `⏱ ${show.tShowSeconds.toFixed(1)}s${show.phase === 'held' ? '（已暂停）' : ''}`}
        </span>
        <div className="spacer" />
        {show.phase === 'idle' ? (
          <button
            className="show-start"
            onClick={() => {
              multiDs.send({ type: 'enableAll' });
              show.start();
            }}
          >
            启动演出
          </button>
        ) : (
          <>
            {show.phase === 'running' ? (
              <button onClick={() => show.hold()}>暂停</button>
            ) : (
              <button onClick={() => show.resume()}>继续</button>
            )}
            <button
              className="stop-all"
              onClick={() => {
                show.stop();
                multiDs.send({ type: 'disableAll' });
              }}
            >
              结束演出
            </button>
          </>
        )}
      </header>

      <section className="stage-wrap">
        <svg viewBox={`${-w / 2} ${-d / 2 - 0.6} ${w} ${d + 1.2}`} className="stage">
          <rect x={-w / 2} y={-d / 2} width={w} height={d} className="stage-border" />
          <rect
            x={-fence.widthM / 2}
            y={-fence.depthM / 2}
            width={fence.widthM}
            height={fence.depthM}
            className="geofence"
          />
          {/* 编排路径预览（Phase 3 编辑器落地前用内置演示演出） */}
          {demoShow.paths.map((p, i) => (
            <polyline
              key={`path-${p.robot}`}
              points={p.waypoints.map((wp) => toScreen(wp.xM, wp.yM)).join(' ')}
              className={`path-preview robot-path-${i + 1}`}
            />
          ))}
          {robots.map((r, i) => (
            <RobotMarker key={r.robot} state={r} index={i} />
          ))}
        </svg>
        {liveCount === 0 && (
          <p className="hint">未检测到模拟机器人 —— 先在仓库根目录运行 <code>npm run sim</code>。</p>
        )}
        {liveCount > 0 && !multiDs.connected && (
          <p className="hint">机器人已连 NT，但 multi-DS 未连接 —— 运行 <code>npm run ds</code> 后即可使能。</p>
        )}
        {liveCount > 0 && multiDs.connected && show.phase === 'idle' && (
          <p className="hint">就绪 —— 点「启动演出」开演（使能 + 时钟 + 路径一起走）。</p>
        )}
      </section>

      <section className="panel">
        {robots.map((r, i) => {
          const ds = multiDs.robots.get(r.robot);
          return (
            <div key={r.robot} className={`robot-card ${r.live ? '' : 'offline'}`}>
              <span className={`dot robot-dot-${i + 1}`} data-on={r.live} />
              <span className="card-team">{r.robot}</span>
              <span className={`card-state ${ds?.state === 'estopped' ? 'estop' : ''}`}>
                {dsStateText(ds, r.live, r.health?.showState)}
              </span>
              {ds?.state === 'estopped' ? (
                <button onClick={() => multiDs.send({ type: 'clearEstop', team: r.robot })}>解除急停</button>
              ) : (
                <>
                  <button onClick={() => multiDs.send({ type: ds?.state === 'enabled' ? 'disable' : 'enable', team: r.robot })}>
                    {ds?.state === 'enabled' ? '失能' : '使能'}
                  </button>
                  <button className="estop-btn" onClick={() => multiDs.send({ type: 'estop', team: r.robot })}>
                    急停
                  </button>
                </>
              )}
              <span className="card-batt">{ds?.linked ? `${ds.batteryVolts.toFixed(1)}V` : ''}</span>
            </div>
          );
        })}
      </section>
    </main>
  );
}

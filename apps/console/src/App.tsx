import { DEFAULT_FOOTPRINT, DEFAULT_STAGE, stageGeofence } from '@ghpaths/field-model';
import { useRobots, type RobotState } from './useRobots';

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

export function App() {
  const { robots, sendCommand } = useRobots();
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
        <span className="badge">sim 回路</span>
        <div className="spacer" />
        <button
          className="stop-all"
          onClick={() => robots.forEach((r) => sendCommand(r.robot, { kind: 'stop' }))}
        >
          全部停止
        </button>
        <button
          className="resume-all"
          onClick={() => robots.forEach((r) => sendCommand(r.robot, { kind: 'resume' }))}
        >
          全部恢复
        </button>
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
          {robots.map((r, i) => (
            <RobotMarker key={r.robot} state={r} index={i} />
          ))}
        </svg>
        {liveCount === 0 && (
          <p className="hint">未检测到模拟机器人 —— 先在仓库根目录运行 <code>npm run sim</code>。</p>
        )}
      </section>

      <section className="panel">
        {robots.map((r, i) => (
          <div key={r.robot} className={`robot-card ${r.live ? '' : 'offline'}`}>
            <span className={`dot robot-dot-${i + 1}`} data-on={r.live} />
            <span className="card-team">{r.robot}</span>
            <span className="card-state">
              {!r.connected ? '连接中' : !r.live ? '无数据' : r.health?.enabled === false ? '已冻结' : '运行中'}
            </span>
            <button onClick={() => sendCommand(r.robot, { kind: 'stop' })}>停</button>
            <button onClick={() => sendCommand(r.robot, { kind: 'resume' })}>走</button>
          </div>
        ))}
      </section>
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_FOOTPRINT, DEFAULT_STAGE, SAFETY_MIN_SEPARATION_M, stageGeofence } from '@ghpaths/field-model';
import { simTopology, type MultiDsRobotStatus } from '@ghpaths/show-protocol';
import { useRobots, type RobotState } from './useRobots';
import { useMultiDs } from './useMultiDs';
import { useShow } from './useShow';
import { useRecorder } from './useRecorder';
import { useReplay } from './useReplay';
import { useBackends } from './useBackends';
import { jsonlToWpilog } from './wpilog-export';
import { useTelemetry } from './useTelemetry';
import { usePathEditor } from './usePathEditor';
import { EditorCanvas } from './EditorCanvas';
import { TimelineBar } from './TimelineBar';
import { Stage3D, type Robot3DData } from './Stage3D';
import { SpacingChart } from './SpacingChart';
import { Sparkline } from './Sparkline';
import { useI18n } from './i18n';
import type { Strings } from './ui-strings';
import { Preferences } from './Preferences';

const RAD2DEG = 180 / Math.PI;

/** 世界坐标 → SVG 屏幕坐标（世界 +y 向观众，SVG y 向下 → 翻转 y；航向随之取负） */
function toScreen(x: number, y: number): string {
  return `${x.toFixed(3)},${(-y).toFixed(3)}`;
}

function RobotMarker({
  robot,
  x,
  y,
  headingRad,
  trail,
  live,
  dim,
  index,
}: {
  robot: number;
  x: number;
  y: number;
  headingRad: number;
  trail: Array<{ x: number; y: number }> | null;
  live: boolean;
  dim: boolean;
  index: number;
}): JSX.Element {
  const fw = DEFAULT_FOOTPRINT.widthM / 2;
  const fl = DEFAULT_FOOTPRINT.lengthM / 2;
  const headingDeg = -headingRad * RAD2DEG;
  return (
    <g className={`robot-layer ${live ? '' : 'idle'} ${dim ? 'dimmed' : ''}`}>
      {trail && trail.length > 1 && (
        <polyline points={trail.map((p) => toScreen(p.x, p.y)).join(' ')} className="trail" />
      )}
      <g transform={`translate(${x} ${-y}) rotate(${headingDeg})`}>
        {/* 车体：长轴沿局部 +x（rotate 后 +x 即航向方向） */}
        <rect x={-fl} y={-fw} width={fl * 2} height={fw * 2} rx={0.05} className="robot-body" />
        {/* 航向指示：车头短线（局部 +x 端） */}
        <line x1={fl} y1={0} x2={fl + 0.3} y2={0} className="heading" />
      </g>
      <text x={x} y={-y + fw + 0.45} textAnchor="middle" className={`robot-label robot-label-${index + 1}`}>
        {robot}
      </text>
    </g>
  );
}

function dsStateText(ds: MultiDsRobotStatus | undefined, ntLive: boolean, showState: string | undefined, S: Strings): string {
  if (!ds) return S.stMultiDsNotConn;
  if (ds.state === 'estopped') return S.stEstop;
  if (!ds.linked) return S.stOffline;
  if (ds.state !== 'enabled') return S.stNotEnabled;
  // DS 已使能：细分演出层
  switch (showState) {
    case 'running': return ntLive ? S.stMoving : S.stRunNoData;
    case 'held': return S.stHolding;
    case 'stopped': return S.stShowEnded;
    case 'armed': return S.stArmed;
    default: return S.stEnabled;
  }
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Safari 对即时吊销的 blob URL 有中止下载的历史问题，延迟吊销
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function downloadJsonl(text: string): void {
  downloadBlob(
    new Blob([text], { type: 'application/jsonl' }),
    `showlog-${timestampForFilename()}.jsonl`,
  );
}

function timestampForFilename(): string {
  const now = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** 导出 WPILOG（ADR-0006：AdvantageScope 直接打开,2D 场地 + 曲线） */
function downloadWpilog(jsonl: string): void {
  const blob = jsonlToWpilog(jsonl);
  if (blob) downloadBlob(blob, `showlog-${timestampForFilename()}.wpilog`);
}



export function App() {
  const { S } = useI18n();
  const recorder = useRecorder();
  const replay = useReplay();
  const backends = useBackends();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const telemetry = useTelemetry();
  const editor = usePathEditor();
  const [editMode, setEditMode] = useState(false);
  const [view3D, setView3D] = useState(false);
  const editorFileRef = useRef<HTMLInputElement | null>(null);
  const [editorMsg, setEditorMsg] = useState<string | null>(null);
  const { robots, sendCommand, publishClock } = useRobots({
    onPose: (robot, pose) => {
      recorder.pushPose(robot, pose);
      telemetry.onPose(robot, pose);
      telemetry.onShowClock(pose.tShowUs);
    },
    onHealth: recorder.pushHealth,
  });
  const multiDs = useMultiDs();
  const teams = useMemo(() => simTopology.teams(), []);
  const activeShow = editor.show;
  const editorPaths = useMemo(() => new Map(editor.show.paths.map((p) => [p.robot, p])), [editor.show]);
  const show = useShow(publishClock, sendCommand, teams, activeShow.durationShowUs, activeShow.id, recorder.pushShowEvent, editorPaths);
  const { widthM: w, depthM: d } = DEFAULT_STAGE;
  const fence = stageGeofence(DEFAULT_STAGE, DEFAULT_FOOTPRINT);
  const liveCount = robots.filter((r) => r.live).length;
  const allLive = liveCount === robots.length && robots.length > 0;
  const replayData = replay.data;
  const replayActive = replayData !== null;

  // multi-DS 状态落盘（recorder 内部按内容去重；pushDs 为稳定引用）+ 遥测采样
  useEffect(() => {
    for (const [team, st] of multiDs.robots) {
      recorder.pushDs(team, st.state, st.linked, st.batteryVolts);
      telemetry.onBattery(team, st.batteryVolts);
    }
  }, [multiDs.robots, recorder.pushDs, telemetry.onBattery]);

  // 未导出的日志在关页/刷新前拦一道
  useEffect(() => {
    if (recorder.lineCount === 0 || recorder.exported) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [recorder.lineCount, recorder.exported]);

  const startShow = (): void => {
    // 上一场未导出 → 先自动救出再清缓冲（联排连跑多场不丢日志）
    if (recorder.lineCount > 0 && !recorder.exported) {
      const t = recorder.exportText();
      if (t) downloadJsonl(t);
    }
    multiDs.send({ type: 'enableAll' });
    recorder.begin(teams, activeShow.id);
    show.start();
  };
  const stopShow = (): void => {
    show.stop();
    multiDs.send({ type: 'disableAll' });
    recorder.end();
  };

  return (
    <main className="app">
      <header>
        <h1>{S.appName}</h1>
        <span className={`badge ${allLive ? 'ok' : liveCount > 0 ? 'warn' : ''}`}>
          {S.online(liveCount, robots.length)}
        </span>
        <span className={`badge ${multiDs.connected ? 'ok' : 'warn'}`}>
          {multiDs.connected ? S.multiDsConnected : S.multiDsDisconnected}
        </span>
        {replayActive ? (
          <span className="badge">{S.replayMode}</span>
        ) : (
          <span className={`badge ${show.phase === 'running' ? 'ok' : show.phase === 'held' ? 'warn' : ''}`}>
            {show.phase === 'idle'
              ? S.showNotStarted
              : show.ended
                ? S.showEnded
                : show.phase === 'held'
                  ? S.showPaused
                  : S.showClock(show.tShowSeconds)}
          </span>
        )}
        {recorder.recording && <span className="badge rec">{S.recording(recorder.lineCount)}</span>}
        <div className="spacer" />
        {!replayActive && !editMode && (
          <button onClick={() => setView3D(!view3D)} title={S.t2d3dSwitch}>
            {view3D ? S.view2D : S.view3D}
          </button>
        )}
        {!replayActive && (
          <button
            className={editMode ? 'edit-mode-btn active' : 'edit-mode-btn'}
            disabled={show.phase !== 'idle'}
            title={show.phase !== 'idle' ? S.tNoEditDuringShow : S.tPathEditor}
            onClick={() => { setEditMode(!editMode); setEditorMsg(null); }}
          >
            {editMode ? S.exitEdit : S.pathEdit}
          </button>
        )}
        {replayActive ? (
          <>
            <button onClick={() => replay.setPlaying(!replay.playing)}>{replay.playing ? S.pauseReplay : S.playReplay}</button>
            <button onClick={() => replay.close()}>{S.exitReplay}</button>
          </>
        ) : (
          <>
            {show.phase === 'idle' ? (
              <button className="show-start" onClick={startShow}>
                {S.startShow}
              </button>
            ) : (
              <>
                {show.phase === 'running' ? (
                  <button onClick={() => show.hold()}>{S.holdShow}</button>
                ) : show.ended ? null : (
                  <button onClick={() => show.resume()}>{S.resumeShow}</button>
                )}
                <button className="stop-all" onClick={stopShow}>
                  {S.stopShow}
                </button>
              </>
            )}
            {recorder.lineCount > 0 && !recorder.recording && (
              <>
                <button onClick={() => { const t = recorder.exportText(); if (t) downloadJsonl(t); }}>
                  {S.exportLog}
                </button>
                <button
                  onClick={() => { const t = recorder.exportText(); if (t) downloadWpilog(t); }}
                  title={S.tWpilogHint}
                >
                  {S.exportWpilog}
                </button>
              </>
            )}
            {show.phase === 'idle' && (
              <>
                <button onClick={() => fileInputRef.current?.click()}>{S.replayLog}</button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jsonl,.txt,application/jsonl,text/plain"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (show.phase !== 'idle') {
                      // 演出进行中不得进回放：画布会被录像接管而失去主停止键
                      replay.loadText('');
                      e.target.value = '';
                      return;
                    }
                    replay.loadText(await f.text());
                    e.target.value = '';
                  }}
                />
              </>
            )}
          </>
        )}
        <Preferences />
      </header>

      {backends.available && (
        <div className="backends-bar">
          {backends.backends.map((b) => (
            <span key={b.which} className="backend-pill">
              <span className="dot" data-on={b.running} style={{ color: '#79c0ff' }} />
              {b.which === 'sim' ? S.simLabel : S.multidsLabel}
              {b.running && <span className="backend-uptime">{b.uptimeSecs}s</span>}
              <button onClick={() => backends.toggle(b.which)}>{b.running ? S.stop : S.start}</button>
            </span>
          ))}
          {backends.error && <span className="backend-err">{backends.error}</span>}
        </div>
      )}

      {view3D && !editMode && !replayActive ? (
        <section className="stage-wrap">
          <Stage3D
            robots={robots.map((r, i) => ({
              robot: r.robot,
              xM: r.pose?.xM ?? 0,
              yM: r.pose?.yM ?? 0,
              headingRad: r.pose?.headingRad ?? 0,
              trail: r.trail,
            }))}
          />
          <p className="hint">{S.hint3d}</p>
        </section>
      ) : null}

      {!view3D && !editMode && (
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
          {/* 编排路径预览（编辑器数据 = 演出数据,单一来源） */}
          {activeShow.paths.map((p, i) => (
            <polyline
              key={`path-${p.robot}`}
              points={p.waypoints.map((wp) => toScreen(wp.xM, wp.yM)).join(' ')}
              className={`path-preview robot-path-${i + 1}`}
            />
          ))}
          {replayActive
            ? [...replay.posesAtCursor.entries()].map(([robot, p]) => {
                const idx = teams.indexOf(robot);
                const trail = replay.trailsAtCursor.get(robot) ?? null;
                return (
                  <RobotMarker
                    key={robot}
                    robot={robot}
                    x={p.xM}
                    y={p.yM}
                    headingRad={p.headingRad}
                    trail={trail}
                    live
                    dim={false}
                    index={idx < 0 ? 0 : idx}
                  />
                );
              })
            : robots.map((r: RobotState, i: number) => (
                <RobotMarker
                  key={r.robot}
                  robot={r.robot}
                  x={r.pose?.xM ?? 0}
                  y={r.pose?.yM ?? 0}
                  headingRad={r.pose?.headingRad ?? 0}
                  trail={r.trail}
                  live={r.live}
                  dim={false}
                  index={i}
                />
              ))}
        </svg>
        {!replayActive && replay.parseError && (
          <p className="hint warn-text">{S.hintParseFail(replay.parseError)}</p>
        )}
        {replayActive ? (
          <div className="replay-bar">
            <div className="replay-stats">
              <span className={replayData.stats.minSeparationM < 1.05 ? 'stat-bad' : 'stat-ok'}>
                {S.replayMinSep(replayData.stats.minSeparationM)}
              </span>
              <span>{S.replayAtTime(replayData.stats.minSeparationAtMs)}</span>
              {replayData.stats.separationBreaches.length > 0 && (
                <span className="stat-bad">{S.replayBreaches(replayData.stats.separationBreaches.length)}</span>
              )}
            </div>
            <span className="replay-time">
              {S.replayTime(replay.cursorMs, replayData.durationMs, replay.tShowAtCursor)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(replayData.durationMs, 1)}
              step={50}
              value={replay.cursorMs}
              onChange={(e) => replay.seek(Number(e.target.value))}
              style={{ width: '60%' }}
            />
            {/* 间距超阈值时段（红色标记条,叠加在进度条上） */}
            <span className="replay-breaches">
              {replayData.stats.separationBreaches.map(([start, end], i) => (
                <span
                  key={i}
                  className="breach-mark"
                  style={{
                    left: `${(start * 1000 / replayData.durationMs) * 100}%`,
                    width: `${Math.max(0.5, ((end - start) * 1000 / replayData.durationMs) * 100)}%`,
                  }}
                  title={S.replayBreachRange(start, end)}
                />
              ))}
            </span>
            <span className="replay-events">
              {replayData.events.map((ev, i) => (
                <span key={i} className="event-mark" title={ev.event}>
                  {{ start: '▶', stop: '■', hold: '⏸', resume: '⏵', ended: '✓' }[ev.event] ?? ev.event[0]}
                </span>
              ))}
            </span>
          </div>
        ) : liveCount === 0 ? (
          <p className="hint">
            {backends.available ? S.hintNoRobots : `${S.hintNoRobotsPrefix} ${S.hintRunNpmSim}`}
          </p>
        ) : !multiDs.connected ? (
          <p className="hint">
            {backends.available ? S.hintNoDs : `${S.hintNoDsPrefix} ${S.hintRunNpmDs}`}
          </p>
        ) : show.phase === 'idle' ? (
          <p className="hint">{S.hintReady}</p>
        ) : null}
      </section>
      )}

      {editMode && !replayActive ? (
        <section className="stage-wrap">
          <EditorCanvas editor={editor} running={show.phase !== 'idle'} />
          <TimelineBar editor={editor} />
          <div className="editor-bar">
            <span className="editor-hint">
              {S.edHint}
            </span>
            <div className="spacer" />
            {editor.violations.length > 0 ? (
              <span className="editor-violation">
                {S.edViolation(editor.violations.length, Math.min(...editor.violations.map(v => v.minSepM)))}
              </span>
            ) : (
              <span className="editor-ok">{S.edNoViolation}</span>
            )}
            <button onClick={() => editorFileRef.current?.click()}>{S.edLoadJson}</button>
            <button onClick={() => { const j = editor.exportJson(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([j], { type: 'application/json' })); a.download = 'show-paths.json'; a.click(); }}>
              {S.edExportJson}
            </button>
            <button onClick={() => editor.loadDemo()}>{S.edResetDemo}</button>
            <input
              ref={editorFileRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const err = editor.loadJson(await f.text());
                setEditorMsg(err ?? S.edLoaded);
                e.target.value = '';
              }}
            />
            {editorMsg && <span className="editor-msg">{editorMsg}</span>}
          </div>
          <div className="editor-robot-tabs">
            {editor.show.paths.map((p, i) => (
              <button
                key={p.robot}
                className={editor.selectedRobot === p.robot ? 'active' : ''}
                onClick={() => { editor.selectRobot(p.robot); editor.selectWaypoint(null); }}
              >
                <span className={`dot robot-dot-${i + 1}`} data-on={editor.selectedRobot === p.robot} />
                {p.robot}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!replayActive && !editMode && (
        <section className="charts-row">
          <SpacingChart data={telemetry.spacing} thresholdM={SAFETY_MIN_SEPARATION_M} windowMs={60_000} title={S.chartMinSep} />
          <SpacingChart data={telemetry.clockDrift} thresholdM={0} windowMs={60_000} title={S.chartDrift} unit={S.chartUnitPpm} />
        </section>
      )}

      <section className="panel">
        {robots.map((r, i) => {
          const ds = multiDs.robots.get(r.robot);
          return (
            <div key={r.robot} className={`robot-card ${r.live ? '' : 'offline'}`}>
              <span className={`dot robot-dot-${i + 1}`} data-on={r.live} />
              <span className="card-team">{r.robot}</span>
              <span className={`card-state ${ds?.state === 'estopped' ? 'estop' : ''}`}>
                {dsStateText(ds, r.live, r.health?.showState, S)}
              </span>
              {ds?.state === 'estopped' ? (
                <button onClick={() => multiDs.send({ type: 'clearEstop', team: r.robot })}>{S.clearEstop}</button>
              ) : (
                <>
                  <button onClick={() => multiDs.send({ type: ds?.state === 'enabled' ? 'disable' : 'enable', team: r.robot })}>
                    {ds?.state === 'enabled' ? S.disable : S.enable}
                  </button>
                  <button className="estop-btn" onClick={() => multiDs.send({ type: 'estop', team: r.robot })}>
                    {S.estop}
                  </button>
                </>
              )}
              <span className="card-batt ${ds?.linked && ds.batteryVolts < 11 ? 'batt-critical' : ds?.linked && ds.batteryVolts < 11.5 ? 'batt-warn' : ''}">
                {ds?.linked ? `${ds.batteryVolts.toFixed(1)}V` : ''}
                <Sparkline data={telemetry.battery.get(r.robot)} />
              </span>
            </div>
          );
        })}
      </section>
    </main>
  );
}

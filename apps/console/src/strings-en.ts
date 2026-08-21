/**
 * strings-en —— en-US 英文包（ADR-0008 §8.7）。
 * 键集与 ui-strings.ts 的 Strings 严格一致（类型约束;改 key 时三语言同步）。
 * 机器人术语随 FRC 官方用法：Enable/Disable/E-Stop/Show/Geofence。
 */
import type { Strings } from './ui-strings';

export const EN: Strings = {
  // 标题与徽章
  appName: 'GHPaths Show Console',
  online: (n, total) => `${n}/${total} online`,
  multiDsConnected: 'multi-DS connected',
  multiDsDisconnected: 'multi-DS not connected',
  showNotStarted: 'Show not started',
  showEnded: 'Show ended',
  showPaused: 'Paused',
  showClock: (s) => `⏱ ${s.toFixed(1)}s`,
  recording: (n) => `● REC ${n}`,
  replayMode: 'Replay',

  // 按钮
  startShow: 'Start Show',
  stopShow: 'End Show',
  holdShow: 'Hold',
  resumeShow: 'Resume',
  exportLog: 'Export Log',
  exportWpilog: 'Export WPILOG',
  replayLog: 'Replay Log',
  exitReplay: 'Exit Replay',
  playReplay: 'Play Replay',
  pauseReplay: 'Pause Replay',
  pathEdit: 'Edit Paths',
  exitEdit: 'Exit Editor',
  view3D: '3D',
  view2D: '2D',
  enable: 'Enable',
  disable: 'Disable',
  estop: 'E-Stop',
  clearEstop: 'Clear E-Stop',
  enableAll: 'Enable All',
  disableAll: 'Disable All',
  stopAll: 'E-Stop All',
  prefs: 'Settings',

  // 按钮 title 提示
  t2d3dSwitch: 'Toggle 2D/3D view',
  tPathEditor: 'Multi-robot path editor',
  tNoEditDuringShow: 'Cannot edit while a show is running',
  tWpilogHint: 'Opens directly in AdvantageScope (2D field + charts)',

  // 后端面板
  simLabel: 'Simulated Robots',
  multidsLabel: 'multi-DS',
  stop: 'Stop',
  start: 'Start',

  // 状态
  stConnecting: 'Connecting',
  stNoData: 'No data',
  stFrozen: 'Frozen',
  stMoving: 'Moving',
  stRunNoData: 'Run? no data',
  stHolding: 'Holding',
  stShowEnded: 'Show ended',
  stArmed: 'Armed',
  stEnabled: 'Enabled',
  stNotEnabled: 'Not enabled',
  stEstop: 'E-STOP',
  stOffline: 'Offline',
  stMultiDsNotConn: 'multi-DS not connected',

  // 编辑器
  edHint: 'Click a waypoint to select · drag to move · hover an empty track segment for + insert · Delete removes mid points (endpoints locked)',
  edInsertWaypoint: 'Insert waypoint',
  edNoViolation: 'No collision risk ✓',
  edViolation: (n, min) => `Collision risk: ${n} pairs (min ${min.toFixed(2)}m < 1.05m)`,
  edLoadJson: 'Load JSON',
  edExportJson: 'Export JSON',
  edResetDemo: 'Reset Demo',
  edLoaded: 'Loaded',
  edShowRunning: 'Show running — editing paused (resumes when the show ends)',

  // 时间线（编辑器底部）
  tlBreaches: (n) => `⚠ ${n} pairs`,

  // 提示
  hintNoRobots: 'No simulated robots detected — start the Simulated Robots backend in the panel above.',
  hintNoRobotsPrefix: 'No simulated robots detected —',
  hintRunNpmSim: 'First run npm run sim at the repo root.',
  hintNoDs: 'Robots are on NT, but multi-DS is not connected — start the multi-DS backend in the panel above.',
  hintNoDsPrefix: 'Robots are on NT, but multi-DS is not connected —',
  hintRunNpmDs: 'Run npm run ds, then you can enable robots.',
  hintReady: 'Ready — press “Start Show” (enables robots, starts clock and paths together, records automatically).',
  hint3d: '3D full-field monitor (placeholder geometry; .glb models arrive in ADR-0006 Phase 3)',
  hintParseFail: (err) => `Failed to parse log: ${err}`,

  // 回放
  replayTime: (cur, dur, show) =>
    `${(cur / 1000).toFixed(1)}s / ${(dur / 1000).toFixed(1)}s (show clock ${(show / 1e6).toFixed(1)}s)`,
  replayMinSep: (v) => `Min separation ${v.toFixed(2)}m`,
  replayAtTime: (t) => `@${(t / 1000).toFixed(1)}s`,
  replayBreaches: (n) => `${n} breaches`,
  replayBreachRange: (start, end) => `${start.toFixed(1)}s ~ ${end.toFixed(1)}s separation breach`,

  // 图表
  chartMinSep: 'Min Robot Separation',
  chartDrift: 'Clock Drift',
  chartThreshold: (v) => `Safety threshold ${v.toFixed(2)}m`,
  chartUnitM: 'm',
  chartUnitPpm: 'ppm',
  chartLast60s: 'last 60s',

  // 偏好设置窗口（ADR-0008 §8.7）
  prefTitle: 'Settings',
  prefLanguage: 'Language',
  prefLangAuto: 'Follow System',
  prefLangHint: 'Applies immediately and persists (localStorage; migrates to Tauri store once packaged)',
  prefCloseHint: 'Esc to close · ⌘, to open',

  // 错误边界
  ebTitle: '⚠ UI Render Error',
  ebBody: 'multi-DS and the robots are unaffected (separate processes). Click below to recover, or reload the page.',
  ebRecover: 'Restore UI',
};

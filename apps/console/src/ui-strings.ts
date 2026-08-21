/**
 * ui-strings —— console UI 的全部用户可见文案（zh-CN 简体包,即 key 目录与单一来源）。
 * ADR-0008 i18n：
 *  - 本文件是简体包 + 形状定义（Strings）;
 *  - en-US 手写包见 strings-en.ts;
 *  - zh-TW 由 i18n.tsx 用 OpenCC 从本包运行时派生（+机器人术语表人工校对）;
 *  - 数据与 topic/日志字段不翻译。
 * 改动 checklist：新增/修改 key 时三语言同步（en 包补齐;繁体自动跟随）。
 */

/** 函数型文案的统一约束（供 satisfies 推导用） */
type StrFn = (...args: never[]) => string;

export const S = {
  // 标题与徽章
  appName: 'GHPaths 演控台',
  online: (n: number, total: number) => `${n}/${total} 在线`,
  multiDsConnected: 'multi-DS 已连',
  multiDsDisconnected: 'multi-DS 未连',
  showNotStarted: '演出未启动',
  showEnded: '演出结束',
  showPaused: '已暂停',
  showClock: (s: number) => `⏱ ${s.toFixed(1)}s`,
  recording: (n: number) => `● 录制 ${n}`,
  replayMode: '回放中',

  // 按钮
  startShow: '启动演出',
  stopShow: '结束演出',
  holdShow: '暂停',
  resumeShow: '继续',
  exportLog: '导出日志',
  exportWpilog: '导出 WPILOG',
  replayLog: '回放日志',
  exitReplay: '退出回放',
  playReplay: '播放回放',
  pauseReplay: '暂停回放',
  pathEdit: '路径编辑',
  exitEdit: '退出编辑',
  view3D: '3D',
  view2D: '2D',
  enable: '使能',
  disable: '失能',
  estop: '急停',
  clearEstop: '解除急停',
  enableAll: '全部使能',
  disableAll: '全部失能',
  stopAll: '急停全部',
  prefs: '偏好设置',

  // 按钮 title 提示
  t2d3dSwitch: '2D/3D 视图切换',
  tPathEditor: '多机路径编辑器',
  tNoEditDuringShow: '演出进行中不可编辑',
  tWpilogHint: 'AdvantageScope 可直接打开（2D 场地 + 曲线）',

  // 后端面板
  simLabel: '模拟机器人',
  multidsLabel: 'multi-DS',
  stop: '停止',
  start: '启动',

  // 状态
  stConnecting: '连接中',
  stNoData: '无数据',
  stFrozen: '已冻结',
  stMoving: '运动中',
  stRunNoData: '运行?无数据',
  stHolding: '保持中',
  stShowEnded: '演出结束',
  stArmed: '待演',
  stEnabled: '已使能',
  stNotEnabled: '未使能',
  stEstop: '急停',
  stOffline: '失联',
  stMultiDsNotConn: 'multi-DS 未连',

  // 编辑器
  edHint: '点击航点选中 · 拖动移动 · 线上空处悬停显示 + 插入 · Delete 删除中间点（端点固定）',
  edInsertWaypoint: '插入航点',
  edNoViolation: '无碰撞风险 ✓',
  edViolation: (n: number, min: number) => `碰撞风险 ${n} 对（最窄 ${min.toFixed(2)}m < 1.05m）`,
  edLoadJson: '载入 JSON',
  edExportJson: '导出 JSON',
  edResetDemo: '恢复演示',
  edLoaded: '已载入',
  edShowRunning: '演出运行中——编辑已暂停（结束演出后恢复）',

  // 时间线（编辑器底部）
  tlBreaches: (n: number) => `⚠ ${n} 对`,

  // 提示
  hintNoRobots: '未检测到模拟机器人 —— 在上方面板启动「模拟机器人」后端。',
  hintNoRobotsPrefix: '未检测到模拟机器人 ——',
  hintRunNpmSim: '先在仓库根目录运行 npm run sim。',
  hintNoDs: '机器人已连 NT，但 multi-DS 未连接 —— 在上方面板启动「multi-DS」后端。',
  hintNoDsPrefix: '机器人已连 NT，但 multi-DS 未连接 ——',
  hintRunNpmDs: '运行 npm run ds 后即可使能。',
  hintReady: '就绪 —— 点「启动演出」开演（使能 + 时钟 + 路径一起走，自动录制）。',
  hint3d: '3D 全场监控（几何占位;ADR-0006 Phase 3 换 .glb 模型）',
  hintParseFail: (err: string) => `日志解析失败：${err}`,

  // 回放
  replayTime: (cur: number, dur: number, show: number) =>
    `${(cur / 1000).toFixed(1)}s / ${(dur / 1000).toFixed(1)}s（演出时钟 ${(show / 1e6).toFixed(1)}s）`,
  replayMinSep: (v: number) => `最窄间距 ${v.toFixed(2)}m`,
  replayAtTime: (t: number) => `@${(t / 1000).toFixed(1)}s`,
  replayBreaches: (n: number) => `超阈值 ${n} 段`,
  replayBreachRange: (start: number, end: number) => `${start.toFixed(1)}s ~ ${end.toFixed(1)}s 间距超阈值`,

  // 图表
  chartMinSep: '最小机间距',
  chartDrift: '时钟漂移',
  chartThreshold: (v: number) => `安全阈值 ${v.toFixed(2)}m`,
  chartUnitM: 'm',
  chartUnitPpm: 'ppm',
  chartLast60s: '近 60s',

  // 偏好设置窗口（ADR-0008 §8.7）
  prefTitle: '偏好设置',
  prefLanguage: '语言',
  prefLangAuto: '跟随系统',
  prefLangHint: '修改立即生效并持久化（localStorage;打包后迁移至 Tauri store）',
  prefCloseHint: 'Esc 关闭 · ⌘, 打开',

  // 场地地图（ADR-0008 §8.8）
  fmButton: '场地',
  fmTitle: '场地地图',
  fmCurrent: '当前场地',
  fmSize: (w: number, d: number) => `${w}×${d}m`,
  fmTags: (n: number) => `AprilTag ${n} 个`,
  fmImageYes: '底图：有',
  fmImageNo: '底图：无',
  fmImportJson: '导入场地包 / AprilTag 布局 (JSON)',
  fmImportPng: '导入底图 (PNG)',
  fmExportTags: '导出 AprilTag 布局',
  fmReset: '恢复默认舞台',
  fmPngTitle: '底图尺寸（米）',
  fmPngHint: (w: number, h: number) => `图片 ${w}×${h}px——输入对应场地尺寸（满铺映射;角点标定 Phase 3）`,
  fmWidthM: '宽（米）',
  fmDepthM: '深（米）',
  fmOk: '确定',
  fmCancel: '取消',
  fmImported: (name: string) => `已导入「${name}」`,
  fmNoTags: '当前场地无 AprilTag——先导入布局再导出',
  fmBadJson: (err: string) => `导入失败：${err}`,
  fmBuiltin: '内置场地（随版本打包,离线可用）',
  fmApply: '应用',

  // 错误边界（ErrorBoundary——类组件,经 getCurrentStrings() 读取）
  ebTitle: '⚠ UI 渲染异常',
  ebBody: 'multi-DS 与机器人不受影响（独立进程）。点击下方恢复,或刷新页面。',
  ebRecover: '恢复界面',
} satisfies Record<string, string | StrFn>;

/** 文案目录形状——三语言包的共同类型（en 包手写,繁体包派生） */
export type Strings = typeof S;

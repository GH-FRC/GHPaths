/**
 * ui-strings —— console UI 的全部用户可见文案（中文）。
 * ADR-0008 i18n 的前置：先集中管理（本文件即为 key→文案 的单一来源），
 * 后续接 react-i18next 时把这里改成翻译文件即可。
 */
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
  edNoViolation: '无碰撞风险 ✓',
  edViolation: (n: number, min: number) => `碰撞风险 ${n} 对（最窄 ${min.toFixed(2)}m < 1.05m）`,
  edLoadJson: '载入 JSON',
  edExportJson: '导出 JSON',
  edResetDemo: '恢复演示',
  edShowRunning: '演出运行中——编辑已暂停（结束演出后恢复）',

  // 提示
  hintNoRobots: '未检测到模拟机器人 —— 在上方面板启动「模拟机器人」后端。',
  hintNoDs: '机器人已连 NT，但 multi-DS 未连接 —— 在上方面板启动「multi-DS」后端。',
  hintReady: '就绪 —— 点「启动演出」开演（使能 + 时钟 + 路径一起走，自动录制）。',
  hint3d: '3D 全场监控（几何占位;ADR-0006 Phase 3 换 .glb 模型）',
  hintParseFail: (err: string) => `日志解析失败：${err}`,

  // 回放
  replayTime: (cur: number, dur: number, show: number) =>
    `${(cur / 1000).toFixed(1)}s / ${(dur / 1000).toFixed(1)}s（演出时钟 ${(show / 1e6).toFixed(1)}s）`,
  replayMinSep: (v: number) => `最窄间距 ${v.toFixed(2)}m`,
  replayAtTime: (t: number) => `@${(t / 1000).toFixed(1)}s`,
  replayBreaches: (n: number) => `超阈值 ${n} 段`,

  // 图表
  chartMinSep: '最小机间距',
  chartDrift: '时钟漂移',
  chartThreshold: (v: number) => `安全阈值 ${v.toFixed(2)}m`,
  chartUnitM: 'm',
  chartUnitPpm: 'ppm',
  chartLast60s: '近 60s',
} as const;

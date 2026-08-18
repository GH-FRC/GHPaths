/**
 * show-protocol —— 演出协议的第一天定义（报告 §六.3：同步时钟从第一天定死，后补很痛苦）。
 *
 * 通道划分：
 *  - NT4（经 packages/nt-link）：位姿上报、健康状态、演出命令、时钟广播
 *  - multi-DS 控制通道（FRC DS 协议本身，不走 NT）：使能 / 失能 / 急停
 *
 * 不变量：机器人以演出时钟（show-time）驱动轨迹，不使用本地时钟；
 * 演控软件持续广播时钟样本，机器人端做 RTT 校正与漂移收敛。
 */

/** 队号即机器人标识（虚构号段 9001~9006） */
export type RobotId = number;

export const ROBOT_TEAM_RANGE = { min: 9001, max: 9006 } as const;

/**
 * 舞台世界坐标系（与 field-model 一致）：+x 向右，+y 向观众方向，
 * 原点在舞台中心，长度单位米，角度单位弧度。
 */
export interface PoseSample {
  /** 演出时钟微秒（经时钟同步校正后的采样时刻） */
  tShowUs: number;
  xM: number;
  yM: number;
  /** 航向：0 = +x 方向，逆时针为正 */
  headingRad: number;
}

export interface RobotHealth {
  dsLinked: boolean;
  enabled: boolean;
  estopped: boolean;
  /** 最近 SHOW_CLOCK_TIMEOUT_MS 内收到演出时钟样本 */
  clockLinked: boolean;
  /** 演出驱动状态：idle 未装载 / armed 已装载待发 / running 行驶中 / held 保持 / stopped 结束归位 */
  showState: 'idle' | 'armed' | 'running' | 'held' | 'stopped';
  /** 机器人代码版本，联排对版本用 */
  codeVersion: string;
  fault: string | null;
}

/** 演出时钟样本失效时限：超过即视为断时钟，机器人停止（robot/README 约束） */
export const SHOW_CLOCK_TIMEOUT_MS = 750;

/** 演控 → 机器人的演出命令。设计为幂等、可安全重放（NT4 至少一次语义）。 */
export type ShowCommand =
  | { kind: 'arm'; showId: string; segmentId: number }
  | { kind: 'start'; showId: string; tStartShowUs: number }
  | { kind: 'hold' }
  | { kind: 'resume' }
  | { kind: 'stop' };

/** 演控 → 全体的时钟样本（100ms/10Hz 周期；机器人端失联阈值 SHOW_CLOCK_TIMEOUT_MS=750ms） */
export interface ShowClockSample {
  /** 演控侧单调时钟，微秒——机器人端据此做 RTT/漂移估计 */
  tMonotonicUs: number;
  /** 演出时钟，微秒（未开始 / 暂停时冻结） */
  tShowUs: number;
  running: boolean;
}

/**
 * NT4 topic 约定（两种拓扑下命名一致，见报告 §4.2）：
 *  A. 演控作为中心 NT4 服务器，机器人作为客户端连上来（星型，推荐）；
 *  B. 过渡期：演控作为 6 个客户端分别连各机器人的 NT4 服务器。
 * topic 名遵循 NT4 惯例以 `/` 开头（WPILib getTable("ghpaths") 即映射到 /ghpaths/...）。
 */
export const ntTopics = {
  pose: (robot: RobotId) => `/ghpaths/${robot}/pose`,
  health: (robot: RobotId) => `/ghpaths/${robot}/health`,
  command: (robot: RobotId) => `/ghpaths/${robot}/cmd`,
  clock: '/ghpaths/clock',
} as const;

/**
 * sim 开发回路的拓扑约定（ADR-0005）：console 与 fake-robot / multi-DS 共用此推导。
 * 真实机器人 NT4 服务端在 5810、DS 走 UDP 1110/1150（按 10.TE.AM.5 alias 区分）；
 * sim 在同一台机器上用**端口区分**各端点（macOS 127/8 其余地址默认不可 bind）：
 *   NT4 各机 15801~15806，机器人 DS 端点 15101~15106，逻辑 DS 15001~15006。
 * 真机模式不受影响（LogicalDs 默认 1110/1150 + alias 地址）。
 */
export const simTopology = {
  teamBase: 9001,
  count: 6,
  wsPortBase: 15800,
  teams(): RobotId[] {
    return Array.from({ length: this.count }, (_, i) => this.teamBase + i);
  },
  /** 模拟机器人 NT4 服务端端口（对应真机 5810） */
  wsPort(team: RobotId): number {
    return this.wsPortBase + (team % 100);
  },
  wsUrl(team: RobotId): string {
    return `ws://127.0.0.1:${this.wsPort(team)}`;
  },
  /** 机器人侧 DS 端点端口（真机固定 1110） */
  robotDsControlPort(team: RobotId): number {
    return 15100 + (team % 100);
  },
  /** 逻辑 DS 本地端口（真机固定 1110） */
  dsControlPort(team: RobotId): number {
    return 15000 + (team % 100);
  },
} as const;

/** multi-DS 控制 API 端口（仅 localhost；ADR-0002） */
export const MULTI_DS_CONTROL_PORT = 5899;

/** UI → multi-DS 控制 API 消息（ws://127.0.0.1:5899，JSON） */
export type MultiDsControl =
  | { type: 'enable'; team: RobotId }
  | { type: 'disable'; team: RobotId }
  | { type: 'estop'; team: RobotId }
  | { type: 'clearEstop'; team: RobotId }
  | { type: 'enableAll' }
  | { type: 'disableAll' }
  | { type: 'estopAll' }
  | { type: 'uiPing' };

/** multi-DS → UI 状态广播（约 10Hz） */
export interface MultiDsRobotStatus {
  team: RobotId;
  state: 'disabled' | 'enabled' | 'estopped';
  /** 500ms 内收到机器人状态包视为链路在线 */
  linked: boolean;
  batteryVolts: number;
}

export interface MultiDsStatusMsg {
  type: 'status';
  robots: MultiDsRobotStatus[];
}

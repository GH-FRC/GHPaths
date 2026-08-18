/**
 * multi-ds —— 自研 FRC DS 协议多机使能控制模块。
 *
 * 形态（ADR-0002）：独立 Node 进程，对 UI 暴露 localhost WebSocket 控制 API（:5899）；
 * 与演控 UI 解耦，为 Systemcore 换代预留整体替换空间。
 *
 * 安全语义（一等公民，改动必须过本包 README 的安全检查单）：
 *  - 本进程停止/崩溃 → 心跳停止 → 全部机器人自动失效（DS 看门狗天然兜底）；
 *  - 控制端（UI）断连超过宽限期 → 全部机器人自动 disable（默认策略，宽限期可调不可关）；
 *  - estop 一旦发出，只允许显式 clear，任何自动逻辑不得复位。
 *
 * 协议事实唯一来源：docs/protocol/ds-protocol-2026.md（资料红线见 CLAUDE.md）。
 */
import { EventEmitter } from 'node:events';

export interface LogicalDsConfig {
  /** 队号，如 9001 */
  team: number;
  /**
   * 本地绑定地址：DS 惯例 10.TE.AM.5（多机 alias，见 scripts/setup-aliases.sh）；
   * sim 场景用 127.0.0.1。同一进程内 6 个实例各绑不同本地地址，互不冲突。
   */
  localAddress: string;
  /** roboRIO 地址（mDNS 名或 IP）；sim 场景用 127.0.0.1 */
  robotAddress: string;
}

export type DsControlState = 'disabled' | 'autonomous-enabled' | 'teleop-enabled' | 'estopped';

/** Phase 0 定型包结构后补全字段（docs/protocol/ds-protocol-2026.md） */
export interface RobotStatusPacket {
  raw: Uint8Array;
}

export interface LogicalDs {
  readonly team: number;
  readonly state: DsControlState;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** 表演为全自动驾驶：只进 autonomous */
  enableAutonomous(): void;
  disable(): void;
  estop(): void;
}

export class NodeLogicalDs extends EventEmitter implements LogicalDs {
  private _state: DsControlState = 'disabled';

  private readonly config: LogicalDsConfig;

  constructor(config: LogicalDsConfig) {
    super();
    this.config = config;
  }

  get team(): number {
    return this.config.team;
  }

  get state(): DsControlState {
    return this._state;
  }

  async start(): Promise<void> {
    // TODO(Phase 0)：
    //  1. 按 config.localAddress 绑定：UDP 1110（发控制包，20ms 周期）、
    //     UDP 1150（收状态）、TCP 1740（roboRIO 主动连入）；
    //  2. 包结构按 docs/protocol/ds-protocol-2026.md——先在 sim/fake-robot 上对通，再上实机；
    //  3. 发布状态事件（this.emit）供控制 API 转发给 UI。
    throw new Error('TODO(Phase 0): DS 协议实现');
  }

  async stop(): Promise<void> {
    // TODO(Phase 0)：关闭全部 socket。注意：进程退出即心跳停止 = 全机失效，是安全兜底而非缺陷。
    throw new Error('TODO(Phase 0)');
  }

  enableAutonomous(): void {
    throw new Error('TODO(Phase 0)');
  }

  disable(): void {
    throw new Error('TODO(Phase 0)');
  }

  estop(): void {
    throw new Error('TODO(Phase 0)');
  }
}

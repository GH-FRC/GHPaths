/**
 * nt-link —— NT4 接入适配层。
 * 对上（console / sim）暴露稳定接口；对下隔离具体 NT 客户端实现。
 *
 * 背景（ADR-0003，核查确认）：WPILib 官方没有 JS/TS NT 客户端；
 * 当前唯一可用选型是社区 ntcore-ts（@ntcore-ts/client，活跃但 1.0 beta、单人维护）。
 * 因此依赖必须被隔离在本包内，随时可换实现或 fork；
 * 兜底：NT4 协议（WebSocket + JSON 控制帧 + MessagePack 数据帧，端口 5810/5811）
 * 有官方规范，自研薄客户端属可控工作量。
 */
import type { PoseSample, RobotHealth, RobotId, ShowCommand } from '@ghpaths/show-protocol';

export interface RobotConnection {
  readonly robot: RobotId;
  /** 'roboRIO-9001-FRC.local:5810' 或 '10.90.1.2:5810'；sim 场景为 127.0.0.1:5810 */
  readonly address: string;
  connect(): Promise<void>;
  close(): void;
  /** 订阅位姿流，返回退订函数 */
  onPose(cb: (pose: PoseSample) => void): () => void;
  onHealth(cb: (health: RobotHealth) => void): () => void;
  sendCommand(cmd: ShowCommand): void;
}

export interface NtLink {
  connectRobot(robot: RobotId, address: string): Promise<RobotConnection>;
  closeAll(): void;
}

/**
 * TODO(Phase 2)：接入 @ntcore-ts/client（或按 NT4 规范自研薄客户端）。实现注意：
 *  - 多机器人 = 多连接实例（ntcore-ts 的 NetworkTables 类原生支持多 URI 并连）；
 *  - 最低延迟：pose topic 的 update interval 调小，或发布端显式 flush()；
 *  - struct 编码与机器人端 WPILib 定义对齐（Phase 0 定案：Pose2d + 时间戳）。
 */
export function createNtLink(): NtLink {
  throw new Error('TODO(Phase 2): NT 客户端实现（见 docs/decisions/0003-nt-adapter.md）');
}

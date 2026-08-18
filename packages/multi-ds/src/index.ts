/**
 * multi-ds —— 自研 FRC DS 协议多机使能控制模块（独立进程，ADR-0002）。
 *
 * 结构：
 *  - src/packet.ts   协议包编解码（FRCture 依据，Phase 0 实机验证）
 *  - src/logical-ds.ts 单个逻辑 DS（心跳/看门狗/三态）
 *  - src/main.ts     进程入口 + localhost:5899 控制 API + UI 宽限期
 *
 * 安全语义（改动必须过 README 安全检查单）：
 *  - 进程停止/崩溃 → 心跳停止 → 全部机器人自动失效（DS 看门狗天然兜底）；
 *  - UI 断连超过宽限期 → 全部 disable（默认 2s，可调不可关）；
 *  - estop 闩锁只能显式 clearEstop() 解除，任何自动逻辑不得复位。
 *
 * 协议事实唯一来源：docs/protocol/ds-protocol-2026.md（资料红线见 CLAUDE.md）。
 */
export {
  encodeControlPacket,
  decodeStatusPacket,
  CONTROL_ESTOP,
  CONTROL_ENABLED,
  CONTROL_MODE_MASK,
  REQUEST_REBOOT_RIO,
  REQUEST_RESTART_CODE,
  STATUS_ESTOP,
  STATUS_BROWNOUT,
  STATUS_CODE_START,
  STATUS_ENABLED,
  STATUS_MODE_MASK,
  TRACE_ROBOT_CODE,
  TRACE_IS_ROBORIO,
  TRACE_DISABLED,
} from './packet.ts';
export type { ControlPacketInput, StatusPacket } from './packet.ts';
export { LogicalDs } from './logical-ds.ts';
export type { LogicalDsConfig, DsControlState, DsStatusEvent } from './logical-ds.ts';

/**
 * FRC DS 协议 2020~2026 包编解码（UDP 1110 / 1150）。
 *
 * 依据：FRCture 逆向规范（frcture.readthedocs.io，driverstation/ds_to_rio 与 rio_to_ds，
 * 2026-08-18 抓取核对）；与 ds-rs（MIT/Apache-2.0，2018-2020 验证）交叉一致。
 * 状态标记：**已按 FRCture 实现，待 Phase 0 实机抓包最终确认**（见 docs/protocol/ds-protocol-2026.md）。
 *
 * 控制包（DS → roboRIO，约 20ms）：
 *   偏移  字段            类型     说明
 *   0     Sequence Num    u16      递增回绕
 *   2     Comm Version    u8       恒 0x01
 *   3     Control         u8       位域（见 CONTROL_*）
 *   4     Request         u8       位域（见 REQUEST_*）
 *   5     Alliance        u8       <3 红 / ≥3 蓝；位置 = 值%3+1（表演场景固定 0）
 *   6..   Tags            n        Size u8 + ID u8 + Data（使能不需要，本项目不发）
 *
 * 状态包（roboRIO → DS，响应控制包）：
 *   0     Sequence Num    u16
 *   2     Comm Version    u8       0x01
 *   3     Status          u8       位域（正常时基本是控制包回声）
 *   4     Trace           u8       位域（Robot Code / Is roboRIO 等）
 *   5     Battery         u16      XX + YY/256 伏
 *   7     Request Date?   u8       首连 0x01
 *   8..   Tags            n        本项目忽略
 */

export const CONTROL_ESTOP = 0x80;
export const CONTROL_FMS_ATTACHED = 0x08;
export const CONTROL_ENABLED = 0x04;
export const CONTROL_MODE_MASK = 0x03; // 0: Teleop, 1: Test, 2: Autonomous

export const REQUEST_REBOOT_RIO = 0x08;
export const REQUEST_RESTART_CODE = 0x04;

export const STATUS_ESTOP = 0x80;
export const STATUS_BROWNOUT = 0x10;
export const STATUS_CODE_START = 0x08; // 1 = 正在初始化用户代码
export const STATUS_ENABLED = 0x04;
export const STATUS_MODE_MASK = 0x03;

export const TRACE_ROBOT_CODE = 0x20;
export const TRACE_IS_ROBORIO = 0x10;
export const TRACE_TEST_MODE = 0x08;
export const TRACE_AUTONOMOUS = 0x04;
export const TRACE_TELEOP = 0x02;
export const TRACE_DISABLED = 0x01;

export interface ControlPacketInput {
  seq: number;
  enabled: boolean;
  /** 0 = Teleop, 1 = Test, 2 = Autonomous（表演恒 2） */
  mode: 0 | 1 | 2;
  estop: boolean;
  rebootRio: boolean;
  restartCode: boolean;
}

/** 编码控制包（无标签区，6 字节：seq u16 + commVer + control + request + alliance） */
export function encodeControlPacket(input: ControlPacketInput): Buffer {
  const control =
    (input.estop ? CONTROL_ESTOP : 0) |
    (input.enabled ? CONTROL_ENABLED : 0) |
    (input.mode & CONTROL_MODE_MASK);
  const request =
    (input.rebootRio ? REQUEST_REBOOT_RIO : 0) |
    (input.restartCode ? REQUEST_RESTART_CODE : 0);
  const buf = Buffer.allocUnsafe(6);
  buf.writeUInt16BE(input.seq & 0xffff, 0);
  buf.writeUInt8(0x01, 2); // Comm Version
  buf.writeUInt8(control, 3);
  buf.writeUInt8(request, 4);
  buf.writeUInt8(0, 5); // Alliance: 红 1（表演场景无联盟语义）
  return buf;
}

export interface StatusPacket {
  seq: number;
  estop: boolean;
  brownout: boolean;
  codeInitializing: boolean;
  enabled: boolean;
  mode: 0 | 1 | 2;
  robotCode: boolean;
  isRoboRIO: boolean;
  batteryVolts: number;
  requestDate: boolean;
}

/** 解码状态包；长度不足或版本异常返回 null（容忍标签区与后续字段） */
export function decodeStatusPacket(buf: Buffer): StatusPacket | null {
  if (buf.length < 8) return null;
  const seq = buf.readUInt16BE(0);
  const commVersion = buf.readUInt8(2);
  if (commVersion !== 0x01) return null;
  const status = buf.readUInt8(3);
  const trace = buf.readUInt8(4);
  const batteryRaw = buf.readUInt16BE(5);
  return {
    seq,
    estop: (status & STATUS_ESTOP) !== 0,
    brownout: (status & STATUS_BROWNOUT) !== 0,
    codeInitializing: (status & STATUS_CODE_START) !== 0,
    enabled: (status & STATUS_ENABLED) !== 0,
    mode: (status & STATUS_MODE_MASK) as 0 | 1 | 2,
    robotCode: (trace & TRACE_ROBOT_CODE) !== 0,
    isRoboRIO: (trace & TRACE_IS_ROBORIO) !== 0,
    batteryVolts: Math.floor(batteryRaw / 256) + (batteryRaw % 256) / 256,
    requestDate: buf.readUInt8(7) === 0x01,
  };
}

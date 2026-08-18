/**
 * DsEndpoint —— 模拟机器人的 roboRIO DS 端点（ADR-0005 硬约束：与真机一致的看门狗语义）。
 *
 * - 监听 robotHost:1110（sim 实际端口由 simTopology.robotDsControlPort 派生）收 multi-DS 控制包；
 *   按包回状态包到控制包的来源端口（sim 约定；真机 roboRIO 固定回 DS 的 :1150，与本端点无关）；
 * - 看门狗：500ms 无有效控制包 → 链路失联、强制失效（运动许可收回）；
 *   有效 = 完整 6 字节头 + Comm Version 0x01（垃圾包不得喂狗）；
 * - estop 收到即闩锁且清使能，仅当后续无 estop 位的包携带 restartCode 请求（真机恢复路径）才解除；
 * - 包格式与 packages/multi-ds/src/packet.ts 同源（FRCture）。
 */
import dgram from 'node:dgram';
import {
  CONTROL_ESTOP,
  CONTROL_ENABLED,
  CONTROL_MODE_MASK,
  REQUEST_RESTART_CODE,
  STATUS_ESTOP,
  STATUS_ENABLED,
  STATUS_MODE_MASK,
  TRACE_AUTONOMOUS,
  TRACE_DISABLED,
  TRACE_IS_ROBORIO,
  TRACE_ROBOT_CODE,
  TRACE_TELEOP,
} from '@ghpaths/multi-ds';

const WATCHDOG_MS = 500;
/** 模拟电池电压 12.4V（XX=12, YY=102） */
const BATTERY_RAW = 12 * 256 + 102;

export interface DsEndpointOptions {
  /** 监听地址（sim：simTopology.robotDsHost(team)；真机为 roboRIO 自身 IP） */
  host: string;
  port?: number;
}

export class DsEndpoint {
  private socket: dgram.Socket | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastControlMs = 0;
  private linked = false;
  private cmdEnabled = false;
  private estopLatched = false;
  /** 最近一次控制包的模式（状态包按 FRCture 语义回声，含禁用态） */
  private lastModeEcho: 0 | 1 | 2 = 2;

  private readonly opts: DsEndpointOptions;

  constructor(opts: DsEndpointOptions) {
    this.opts = opts;
  }

  /** 是否许可运动：链路在线 + 控制包使能位 + 未闩锁急停 */
  get enabled(): boolean {
    return this.linked && this.cmdEnabled && !this.estopLatched;
  }

  get dsLinked(): boolean {
    return this.linked;
  }

  get estopped(): boolean {
    return this.estopLatched;
  }

  async start(): Promise<void> {
    const sock = dgram.createSocket('udp4');
    const port = this.opts.port ?? 1110;
    sock.bind(port, this.opts.host);
    await new Promise<void>((resolve, reject) => {
      sock.once('listening', resolve);
      sock.once('error', reject);
    });
    sock.on('message', (buf: Buffer, rinfo) => {
      // 先验证包结构再喂看门狗：任意垃圾包不得维持链路/使能（安全审查 T3 实测曾可绕过）
      if (buf.length < 6 || buf.readUInt8(2) !== 0x01) return; // 完整 6 字节头 + Comm Version
      this.lastControlMs = performance.now();
      if (!this.linked) this.linked = true;
      const control = buf.readUInt8(3);
      const request = buf.readUInt8(4);
      const estop = (control & CONTROL_ESTOP) !== 0;
      const modeOk = (control & CONTROL_MODE_MASK) === 2; // 表演只接受 Autonomous
      this.lastModeEcho = (control & CONTROL_MODE_MASK) as 0 | 1 | 2;
      // estop 位优先：同包带 restartCode 不得解除闩锁（安全审查 T4：单包绕过曾可行）
      if (estop) {
        this.estopLatched = true;
        this.cmdEnabled = false;
      } else {
        if ((request & REQUEST_RESTART_CODE) !== 0) this.estopLatched = false; // 真机恢复路径
        this.cmdEnabled = (control & CONTROL_ENABLED) !== 0 && modeOk;
      }
      this.replyStatus(sock, rinfo.address, rinfo.port, buf.readUInt16BE(0));
    });
    this.socket = sock;
    this.watchdogTimer = setInterval(() => {
      if (this.linked && performance.now() - this.lastControlMs > WATCHDOG_MS) {
        this.linked = false;
        this.cmdEnabled = false; // 失联即收回运动许可（与真机看门狗一致）
      }
    }, 50);
  }

  async stop(): Promise<void> {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    await new Promise<void>((resolve) => {
      if (!this.socket) return resolve();
      this.socket.close(() => resolve());
    });
    this.socket = null;
    this.linked = false;
    this.cmdEnabled = false;
  }

  private replyStatus(sock: dgram.Socket, dsAddress: string, dsPort: number, seq: number): void {
    const enabled = this.cmdEnabled && !this.estopLatched;
    // 状态包基本是控制包的回声（FRCture）：模式位即使禁用态也回声，trace 同步模式位
    const status =
      (this.estopLatched ? STATUS_ESTOP : 0) |
      (this.lastModeEcho & STATUS_MODE_MASK) |
      (enabled ? STATUS_ENABLED : 0);
    const trace =
      TRACE_ROBOT_CODE |
      TRACE_IS_ROBORIO |
      (this.lastModeEcho === 2 ? TRACE_AUTONOMOUS : this.lastModeEcho === 0 ? TRACE_TELEOP : 0) |
      (enabled ? 0 : TRACE_DISABLED);
    const buf = Buffer.allocUnsafe(8);
    buf.writeUInt16BE(seq, 0);
    buf.writeUInt8(0x01, 2); // Comm Version
    buf.writeUInt8(status, 3);
    buf.writeUInt8(trace, 4);
    buf.writeUInt16BE(BATTERY_RAW, 5);
    buf.writeUInt8(0x00, 7); // Request Date：sim 无 TCP 对时通道
    // sim 模式：状态包回控制包的来源端口（真机由 roboRIO 固定回 DS :1150，与本端点无关）
    sock.send(buf, dsPort, dsAddress);
  }
}

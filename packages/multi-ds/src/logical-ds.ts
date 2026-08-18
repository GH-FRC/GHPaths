/**
 * LogicalDs —— 单个逻辑 Driver Station：向一台机器人发 20ms 控制包心跳，收状态包。
 *
 * 地址模型（与真机一致，仅地址不同）：
 *  - 本地绑定 localAddress:1110（发送源端口，即真实 DS 的做法）并监听 localAddress:1150；
 *  - 控制包发往 robotAddress:1110；机器人把状态包回到控制包来源地址的 :1150。
 *
 * 安全语义（改动必须过本包 README 检查单）：
 *  - 本对象 stop()/进程死亡 → 心跳停止 → 机器人看门狗失效（安全兜底）；
 *  - estop 一经发出持续置位，直到显式 clearEstop()（内部不再自动复位）；
 *  - estop 态下 enableAutonomous() 无效（必须先 clearEstop）。
 */
import { EventEmitter } from 'node:events';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { encodeControlPacket, decodeStatusPacket, type StatusPacket } from './packet.ts';

export interface LogicalDsConfig {
  team: number;
  /** 本地绑定地址：真机 10.TE.AM.5（alias，见 scripts/setup-aliases.sh）；sim 127.0.0.1 */
  localAddress: string;
  /** 机器人地址：真机 mDNS 名或 10.TE.AM.2；sim 127.0.0.1 */
  robotAddress: string;
  /** 控制包端口。缺省 1110（真机）；sim 用 simTopology.dsControlPort(team) 区分 6 个逻辑 DS */
  controlPort?: number;
  /** 机器人端控制包监听端口。缺省同 controlPort（真机两端都是 1110）；sim 用 simTopology.robotDsControlPort(team) */
  robotPort?: number;
  /**
   * 状态包监听端口。缺省 1150（真机协议惯例，独立 socket）；
   * 传 null 表示与控制包共用同一 socket（sim 模式：机器人直接回控制包来源端口）。
   */
  statusPort?: number | null;
}

export type DsControlState = 'disabled' | 'enabled' | 'estopped';

export interface DsStatusEvent {
  team: number;
  linked: boolean;
  state: DsControlState;
  robot: StatusPacket | null;
}

const HEARTBEAT_MS = 20;
const LINK_TIMEOUT_MS = 500;

export class LogicalDs extends EventEmitter {
  private state: DsControlState = 'disabled';
  private seq = 0;
  private controlSocket: dgram.Socket | null = null;
  private statusSocket: dgram.Socket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private linkCheckTimer: NodeJS.Timeout | null = null;
  private lastStatusMs = 0;
  private linked = false;
  private lastRobotStatus: StatusPacket | null = null;
  private pendingRestartCode = false;
  private restartCodeSinceMs = 0;
  /** robotAddress 解析后的数字 IP（rinfo.address 只会是数字 IP，直接比配置字符串必失配） */
  private resolvedRobotIp = '';
  private warnedBadStatus = false;
  private readonly controlPort: number;
  private readonly robotPort: number;
  private readonly statusPort: number | null;

  private readonly config: LogicalDsConfig;

  constructor(config: LogicalDsConfig) {
    super();
    this.config = config;
    this.controlPort = config.controlPort ?? 1110;
    this.robotPort = config.robotPort ?? this.controlPort;
    this.statusPort = config.statusPort === undefined ? 1150 : config.statusPort;
  }

  get team(): number {
    return this.config.team;
  }

  get currentState(): DsControlState {
    return this.state;
  }

  get isLinked(): boolean {
    return this.linked;
  }

  get batteryVolts(): number {
    return this.lastRobotStatus?.batteryVolts ?? 0;
  }

  async start(): Promise<void> {
    // mDNS 名先解析成数字 IP：状态包过滤只能对数字 IP（真机路径必须，sim 下 127.0.0.1 即自身）
    this.resolvedRobotIp = (await dns.lookup(this.config.robotAddress, { family: 4 })).address;

    const control = dgram.createSocket('udp4');
    control.bind(this.controlPort, this.config.localAddress);
    await new Promise<void>((resolve, reject) => {
      control.once('listening', resolve);
      control.once('error', reject);
    });

    let status: dgram.Socket;
    if (this.statusPort === null) {
      // sim 模式：机器人把状态包回给控制包来源端口，收发同 socket
      status = control;
    } else {
      // 真机模式：roboRIO 惯例把状态包发往 DS 的 1150 端口（独立 socket）
      status = dgram.createSocket('udp4');
      status.bind(this.statusPort, this.config.localAddress);
      await new Promise<void>((resolve, reject) => {
        status.once('listening', resolve);
        status.once('error', reject);
      });
    }

    status.on('message', (buf: Buffer, rinfo) => {
      if (rinfo.address !== this.resolvedRobotIp) return; // 只认本机器人（按解析后 IP）
      const pkt = decodeStatusPacket(buf);
      if (!pkt) {
        if (!this.warnedBadStatus) {
          this.warnedBadStatus = true;
          console.warn(`[multi-ds] team ${this.team}: 丢弃无法解码的状态包（commVersion 异常？）`);
        }
        return;
      }
      this.lastRobotStatus = pkt;
      this.lastStatusMs = performance.now();
      // clearEstop 的 restartCode 位持续到机器人回声 estop=false 为止（上限 3s 防呆）
      if (this.pendingRestartCode && !pkt.estop) this.pendingRestartCode = false;
      if (!this.linked) {
        this.linked = true;
        this.emitStatus();
      }
    });

    this.controlSocket = control;
    this.statusSocket = status === control ? null : status;

    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_MS);
    this.linkCheckTimer = setInterval(() => {
      if (this.linked && performance.now() - this.lastStatusMs > LINK_TIMEOUT_MS) {
        this.linked = false;
        this.lastRobotStatus = null;
        // 链路超时即降级使能：机器人不在线期间下的 enable 不得在其恢复瞬间自动生效
        // （真 DS 同样不保持断连期间的使能状态）
        if (this.state === 'enabled') this.state = 'disabled';
        this.emitStatus();
      }
    }, 100);
    this.sendHeartbeat(); // 立刻发首个心跳，缩短建链时间
  }

  enableAutonomous(): void {
    if (this.state === 'estopped') return; // 急停态必须先显式 clearEstop
    this.state = 'enabled';
    this.sendHeartbeat();
  }

  disable(): void {
    if (this.state === 'estopped') return; // disable 不解除急停；estop 包持续发送
    this.state = 'disabled';
    this.sendHeartbeat();
  }

  estop(): void {
    this.state = 'estopped';
    this.sendHeartbeat();
  }

  /** 唯一解除急停的途径：补发 restartCode 请求位（真机的恢复路径），随后回到 disabled。
   *  restartCode 位持续到机器人回声 estop=false 或 3s 上限——单包易丢，不确认不撒手。 */
  clearEstop(): void {
    if (this.state !== 'estopped') return;
    this.state = 'disabled';
    this.pendingRestartCode = true;
    this.restartCodeSinceMs = performance.now();
    this.sendHeartbeat();
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.linkCheckTimer) clearInterval(this.linkCheckTimer);
    this.heartbeatTimer = null;
    this.linkCheckTimer = null;
    // 停止前发一个 disable 心跳，让"优雅关闭"场景机器人立即失效
    this.state = 'disabled';
    if (this.controlSocket) {
      this.sendHeartbeat();
    }
    await closeSocket(this.controlSocket);
    await closeSocket(this.statusSocket);
    this.controlSocket = null;
    this.statusSocket = null;
    this.linked = false;
  }

  private sendHeartbeat(): void {
    if (!this.controlSocket) return;
    this.seq = (this.seq + 1) & 0xffff;
    // restartCode 保持置位直到机器人确认（estop 回声变 false）或 3s 上限
    if (this.pendingRestartCode && performance.now() - this.restartCodeSinceMs > 3000) {
      this.pendingRestartCode = false;
    }
    const restartCode = this.pendingRestartCode;
    const pkt = encodeControlPacket({
      seq: this.seq,
      enabled: this.state === 'enabled',
      mode: 2, // Autonomous（表演全自动驾驶）
      estop: this.state === 'estopped',
      rebootRio: false,
      restartCode,
    });
    this.controlSocket.send(pkt, this.robotPort, this.config.robotAddress);
  }

  private emitStatus(): void {
    this.emit('status', {
      team: this.team,
      linked: this.linked,
      state: this.state,
      robot: this.lastRobotStatus,
    } satisfies DsStatusEvent);
  }
}

function closeSocket(sock: dgram.Socket | null): Promise<void> {
  return new Promise((resolve) => {
    if (!sock) return resolve();
    sock.close(() => resolve());
  });
}

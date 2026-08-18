/**
 * nt-link —— NT4 接入适配层。
 * 对上（console / sim）暴露稳定接口；对下隔离具体 NT 客户端实现。
 *
 * 背景与规范依据：
 *  - WPILib 无官方 JS/TS NT 客户端（ADR-0003），本包自带按 NT4 规范 4.1 实现的薄客户端
 *    （src/nt4-client.ts），浏览器与 Node 通用——真机（roboRIO:5810）与 sim 均可直连；
 *  - 位姿线格式：double[] = [x, y, heading]（弧度）；演出的时间戳语义见 show-protocol。
 */
import { Nt4Client, type Nt4Status } from './nt4-client.ts';
import {
  ntTopics,
  type PoseSample,
  type RobotHealth,
  type RobotId,
  type ShowCommand,
} from '@ghpaths/show-protocol';

export interface RobotConnection {
  readonly robot: RobotId;
  /** 'roboRIO-9001-FRC.local:5810' / '10.90.1.2:5810' / sim 场景 '127.0.0.1:15801' */
  readonly address: string;
  /** 当前连接状态（事件回调可能早于监听者挂载，UI 轮询此属性兜底） */
  readonly connected: boolean;
  connect(): Promise<void>;
  close(): void;
  /** 订阅位姿流，返回退订函数 */
  onPose(cb: (pose: PoseSample) => void): () => void;
  onHealth(cb: (health: RobotHealth) => void): () => void;
  onStatus(cb: (status: Nt4Status) => void): () => void;
  sendCommand(cmd: ShowCommand): void;
}

export interface NtLink {
  connectRobot(robot: RobotId, address: string): Promise<RobotConnection>;
  closeAll(): void;
}

class RobotConnectionImpl implements RobotConnection {
  private readonly client: Nt4Client;
  private readonly poses = new Set<(p: PoseSample) => void>();
  private readonly healths = new Set<(h: RobotHealth) => void>();
  private readonly statuses = new Set<(s: Nt4Status) => void>();

  readonly robot: RobotId;
  readonly address: string;

  get connected(): boolean {
    return this.client.connected;
  }

  constructor(robot: RobotId, address: string) {
    this.robot = robot;
    this.address = address;
    this.client = new Nt4Client({
      serverUrl: `ws://${address}`,
      clientName: `ghpaths-console-${robot}`,
      onValue: (topic, tsUs, value) => this.dispatch(topic.name, tsUs, value),
      onStatus: (s) => {
        for (const cb of this.statuses) cb(s);
      },
    });
    this.client.subscribe(['/ghpaths/']);
  }

  connect(): Promise<void> {
    // Nt4Client 在构造时已开始连接；此处等待首个连接成功（10s 超时则报错，由调用方决定重试策略）
    if (this.client.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`连接 ${this.address} 超时`)), 10_000);
      const off = this.onStatus((s) => {
        if (s === 'connected') {
          clearTimeout(timer);
          off();
          resolve();
        }
      });
    });
  }

  close(): void {
    this.client.close();
  }

  onPose(cb: (pose: PoseSample) => void): () => void {
    this.poses.add(cb);
    return () => this.poses.delete(cb);
  }

  onHealth(cb: (health: RobotHealth) => void): () => void {
    this.healths.add(cb);
    return () => this.healths.delete(cb);
  }

  onStatus(cb: (status: Nt4Status) => void): () => void {
    this.statuses.add(cb);
    return () => this.statuses.delete(cb);
  }

  sendCommand(cmd: ShowCommand): void {
    this.client.publishJson(ntTopics.command(this.robot), JSON.stringify(cmd));
  }

  private dispatch(topicName: string, tsUs: number, value: unknown): void {
    if (topicName === ntTopics.pose(this.robot)) {
      if (!Array.isArray(value) || value.length < 3) return;
      const [x, y, heading] = value as number[];
      if (typeof x !== 'number' || typeof y !== 'number' || typeof heading !== 'number') return;
      const pose: PoseSample = { tShowUs: tsUs, xM: x, yM: y, headingRad: heading };
      for (const cb of this.poses) cb(pose);
    } else if (topicName === ntTopics.health(this.robot)) {
      if (typeof value !== 'string') return;
      try {
        const h = JSON.parse(value) as Partial<RobotHealth>;
        for (const cb of this.healths) cb({
          dsLinked: h.dsLinked === true,
          enabled: h.enabled === true,
          estopped: h.estopped === true,
          codeVersion: typeof h.codeVersion === 'string' ? h.codeVersion : '?',
          fault: typeof h.fault === 'string' ? h.fault : null,
        });
      } catch {
        // 非 JSON 的 health 值直接忽略
      }
    }
  }
}

class NtLinkImpl implements NtLink {
  private readonly connections = new Map<RobotId, RobotConnectionImpl>();

  async connectRobot(robot: RobotId, address: string): Promise<RobotConnection> {
    const existing = this.connections.get(robot);
    if (existing && existing.address === address) {
      await existing.connect();
      return existing;
    }
    if (existing) existing.close();
    const conn = new RobotConnectionImpl(robot, address);
    this.connections.set(robot, conn);
    await conn.connect();
    return conn;
  }

  closeAll(): void {
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
  }
}

export function createNtLink(): NtLink {
  return new NtLinkImpl();
}

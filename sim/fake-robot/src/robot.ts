/**
 * FakeRobot —— 单台模拟机器人：NT4 服务端 + 位姿生成器。
 *
 * NT4 部分按规范 4.1 实现（allwpilib v2026.2.1 ntcore/doc/networktables4.adoc）：
 * 子协议协商、announce/subscribe/publish、cached 初值、二进制 MessagePack 值帧、
 * RTT 时间应答、WS PING 活性检查。规范要求的 $ 元 topic 本实现省略（客户端不订阅 "$" 前缀即可）。
 *
 * 位姿：每台机器人沿各自椭圆漫游；收到 ShowCommand stop/hold 冻结、start/resume 恢复
 * （这也充当 NT4 发布链路的回环验证）。DS 端点模拟（UDP 1110/1150 看门狗语义）属 Phase 0，
 * 届时冻结逻辑接入真实使能状态。
 */
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { encode, decodeMulti } from '@msgpack/msgpack';
import { ntTopics, type RobotId } from '@ghpaths/show-protocol';

const SUBPROTO_41 = 'v4.1.networktables.first.wpi.edu';
const SUBPROTO_40 = 'networktables.first.wpi.edu';

interface TopicEntry {
  id: number;
  type: string;
  lastTsUs: number;
  lastValue: number[] | string;
}

interface SubEntry {
  subuid: number;
  topics: string[];
  prefix: boolean;
}

export interface FakeRobotOptions {
  team: RobotId;
  port: number;
  host: string;
  freeRun: boolean;
}

const TYPE_CODE: Record<string, number> = { double: 1, json: 4, 'double[]': 17 };

/** 连接上的活性记录（挂在 ws 对象上，pong 回调与 ping 巡检共用） */
interface AliveMarker {
  lastPongMs: number;
}

export class FakeRobot {
  private readonly topics = new Map<string, TopicEntry>();
  private nextTopicId = 1;
  private readonly startNs = process.hrtime.bigint();
  private frozen = false;
  private simSeconds = 0;
  private lastTickNs = this.startNs;

  private readonly opts: FakeRobotOptions;

  constructor(opts: FakeRobotOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.topics.set(ntTopics.pose(this.opts.team), {
      id: this.nextTopicId++,
      type: 'double[]',
      lastTsUs: 0,
      lastValue: [0, 0, 0],
    });
    this.topics.set(ntTopics.health(this.opts.team), {
      id: this.nextTopicId++,
      type: 'json',
      lastTsUs: 0,
      lastValue: '',
    });

    const server = createServer();
    const wss = new WebSocketServer({
      server,
      handleProtocols: (protocols: Set<string>): string | false => {
        if (protocols.has(SUBPROTO_41)) return SUBPROTO_41;
        if (protocols.has(SUBPROTO_40)) return SUBPROTO_40;
        return false;
      },
    });

    wss.on('connection', (ws: WebSocket, req) => {
      if (!req.url?.startsWith('/nt/')) {
        ws.close(1008, 'expected /nt/<name>');
        return;
      }
      this.setupConnection(ws);
    });

    await new Promise<void>((resolve) => server.listen(this.opts.port, this.opts.host, resolve));

    setInterval(() => this.tick(wss), 50);
    setInterval(() => this.pingSweep(wss), 1000);
  }

  private setupConnection(ws: WebSocket): void {
    const alive: AliveMarker = { lastPongMs: performance.now() };
    (ws as WebSocket & { alive?: AliveMarker }).alive = alive;
    const subs: SubEntry[] = [];
    const pubs = new Map<number, string>(); // pubuid → topic 名

    ws.on('pong', () => {
      alive.lastPongMs = performance.now();
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        for (const frame of Array.from(decodeMulti(data as Buffer))) {
          if (!Array.isArray(frame) || frame.length !== 4) continue;
          const [id, , dt, value] = frame as [number, number, number, unknown];
          if (id === -1) {
            // RTT 请求：回服务器时基 + 原样回显（规范 §Timestamps）
            ws.send(encode([-1, this.serverUs(), dt, value]));
          } else {
            const name = pubs.get(id);
            if (name === ntTopics.command(this.opts.team) && typeof value === 'string') {
              this.handleCommand(value);
            }
          }
        }
        return;
      }
      let msgs: unknown;
      try {
        msgs = JSON.parse(String(data));
      } catch {
        return;
      }
      for (const m of Array.isArray(msgs) ? msgs : [msgs]) {
        const { method, params } = (m ?? {}) as { method?: string; params?: Record<string, unknown> };
        if (method === 'subscribe' && params) {
          const sub: SubEntry = {
            subuid: Number(params.subuid),
            topics: (params.topics as string[]) ?? [],
            prefix: (params.options as { prefix?: boolean } | undefined)?.prefix !== false,
          };
          const idx = subs.findIndex((s) => s.subuid === sub.subuid);
          if (idx >= 0) subs[idx] = sub;
          else subs.push(sub);
          // 规范 §subscribe：对已存在的 cached topic 先发 announce + 当前值
          for (const [name, topic] of this.topics) {
            if (this.matches(name, sub)) {
              this.sendAnnounce(ws, name, topic);
              ws.send(encode([topic.id, topic.lastTsUs, TYPE_CODE[topic.type] ?? 5, topic.lastValue]));
            }
          }
        } else if (method === 'publish' && params) {
          const name = String(params.name);
          const pubuid = Number(params.pubuid);
          pubs.set(pubuid, name);
          const existing = this.topics.get(name);
          if (!existing) {
            const topic: TopicEntry = {
              id: this.nextTopicId++,
              type: String(params.type ?? 'json'),
              lastTsUs: 0,
              lastValue: '',
            };
            this.topics.set(name, topic);
            for (const sub of subs) {
              if (this.matches(name, sub)) this.sendAnnounce(ws, name, topic);
            }
          } else {
            // 已存在的 topic：回 announce 带上该客户端的 pubuid（规范 §publish）
            this.sendAnnounce(ws, name, existing, pubuid);
          }
        } else if (method === 'unsubscribe' && params) {
          const uid = Number(params.subuid);
          const idx = subs.findIndex((s) => s.subuid === uid);
          if (idx >= 0) subs.splice(idx, 1);
        } else if (method === 'unpublish' && params) {
          pubs.delete(Number(params.pubuid));
        }
      }
    });
  }

  private matches(topicName: string, sub: SubEntry): boolean {
    return sub.prefix
      ? sub.topics.some((t) => topicName.startsWith(t))
      : sub.topics.includes(topicName);
  }

  private sendAnnounce(ws: WebSocket, name: string, topic: TopicEntry, pubuid?: number): void {
    ws.send(
      JSON.stringify([
        {
          method: 'announce',
          params: {
            name,
            id: topic.id,
            type: topic.type,
            ...(pubuid !== undefined ? { pubuid } : {}),
            properties: {},
          },
        },
      ]),
    );
  }

  private handleCommand(json: string): void {
    let cmd: { kind?: string };
    try {
      cmd = JSON.parse(json);
    } catch {
      return;
    }
    if (cmd.kind === 'stop' || cmd.kind === 'hold') this.frozen = true;
    else if (cmd.kind === 'start' || cmd.kind === 'resume') this.frozen = false;
  }

  private tick(wss: WebSocketServer): void {
    const nowNs = process.hrtime.bigint();
    const dt = Number(nowNs - this.lastTickNs) / 1e9;
    this.lastTickNs = nowNs;
    if (!this.frozen) this.simSeconds += dt;

    const pose = this.topics.get(ntTopics.pose(this.opts.team));
    const health = this.topics.get(ntTopics.health(this.opts.team));
    if (!pose || !health) return;

    const ts = this.serverUs();
    pose.lastTsUs = ts;
    pose.lastValue = this.poseAt(this.simSeconds);

    const hJson = JSON.stringify({
      dsLinked: false,
      enabled: !this.frozen,
      estopped: false,
      codeVersion: 'sim-0.1',
      fault: null,
    });
    const healthDirty = hJson !== String(health.lastValue);
    if (healthDirty) {
      health.lastValue = hJson;
      health.lastTsUs = ts;
    }

    const poseFrame = encode([pose.id, ts, TYPE_CODE['double[]'], pose.lastValue]);
    const healthFrame = healthDirty ? encode([health.id, ts, TYPE_CODE['json'], health.lastValue]) : undefined;

    // 简化：帧发给所有连接——未订阅的客户端按规范会忽略未知 topic id；
    // 多前缀客户端出现时再补逐连接过滤。
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      ws.send(poseFrame);
      if (healthFrame) ws.send(healthFrame);
    }
  }

  /** 椭圆漫游位姿（世界坐标：+x 右、+y 向观众、原点舞台中心、米/弧度） */
  private poseAt(t: number): [number, number, number] {
    const i = (this.opts.team % 100) - 1; // 0..5
    const cx = -3.5 + i * 1.4;
    const cy = i % 2 === 0 ? 1.2 : -1.2;
    const a = 1.1 + (i % 3) * 0.25;
    const b = 0.8;
    const w = 0.4 + 0.08 * i;
    const th = w * t + (i * 2 * Math.PI) / 6;
    const x = cx + a * Math.cos(th);
    const y = cy + b * Math.sin(th);
    const heading = Math.atan2(b * Math.cos(th), -a * Math.sin(th));
    return [x, y, heading];
  }

  private pingSweep(wss: WebSocketServer): void {
    const now = performance.now();
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const alive = (ws as WebSocket & { alive?: AliveMarker }).alive;
      if (!alive) continue;
      ws.ping();
      // 两轮 ping（约 2s）无 pong 即断开（规范 §aliveness 的宽松版）
      if (now - alive.lastPongMs > 2500) ws.terminate();
    }
  }

  private serverUs(): number {
    return Number((process.hrtime.bigint() - this.startNs) / 1000n);
  }
}

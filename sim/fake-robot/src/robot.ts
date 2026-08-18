/**
 * FakeRobot —— 单台模拟机器人：NT4 服务端 + 位姿生成器。
 *
 * NT4 部分按规范 4.1 实现（allwpilib v2026.2.1 ntcore/doc/networktables4.adoc）：
 * 子协议协商、announce/subscribe/publish/unpublish、cached 初值与 retained 更新、
 * 值帧跨连接转发、topic 生命周期（发布者归零即删除 + unannounce）、properties、
 * RTT 时间应答、WS PING 活性（仅 4.1 连接——规范禁止对 4.0 连接发 PING）。
 * 已知简化：$ 元 topic 未实现；广播未按订阅逐连接过滤（客户端按规范忽略未知 id）。
 *
 * 位姿：每台机器人沿各自椭圆漫游；收到 ShowCommand stop/hold 冻结、start/resume 恢复
 * （这也充当 NT4 发布链路的回环验证）。DS 端点模拟（UDP 1110/1150 看门狗语义）属 Phase 0，
 * 届时冻结逻辑接入真实使能状态。
 */
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { encode, decodeMulti } from '@msgpack/msgpack';
import { ntTopics, simTopology, type RobotId } from '@ghpaths/show-protocol';
import { DsEndpoint } from './ds-endpoint.ts';

const SUBPROTO_41 = 'v4.1.networktables.first.wpi.edu';
const SUBPROTO_40 = 'networktables.first.wpi.edu';

interface TopicEntry {
  id: number;
  type: string;
  properties: Record<string, unknown>;
  lastTsUs: number;
  lastValue: number[] | string;
  /** 服务端自身（tick）发布的固有 topic：发布者归零也不删除 */
  intrinsic: boolean;
  clientPublisherCount: number;
}

interface SubEntry {
  subuid: number;
  topics: string[];
  prefix: boolean;
}

interface ConnState {
  lastPongMs: number;
  lastReceiveMs: number;
  protocol: string;
  subs: SubEntry[];
  /** pubuid → topic 名（该连接上的发布） */
  pubs: Map<number, string>;
}

export interface FakeRobotOptions {
  team: RobotId;
  port: number;
  host: string;
  freeRun: boolean;
}

const TYPE_CODE: Record<string, number> = { double: 1, json: 4, 'double[]': 17 };

type StatefulSocket = WebSocket & { state?: ConnState };

export class FakeRobot {
  private readonly topics = new Map<string, TopicEntry>();
  private nextTopicId = 1;
  private readonly startNs = process.hrtime.bigint();
  private frozen = false;
  private simSeconds = 0;
  private lastTickNs = this.startNs;
  private wss: WebSocketServer | null = null;
  /** DS 端点（free-run=false 时创建）：运动许可的权威来源 */
  private ds: DsEndpoint | null = null;

  private readonly opts: FakeRobotOptions;

  constructor(opts: FakeRobotOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.addIntrinsicTopic(ntTopics.pose(this.opts.team), 'double[]', [0, 0, 0]);
    this.addIntrinsicTopic(ntTopics.health(this.opts.team), 'json', '');

    const server = createServer();
    const wss = new WebSocketServer({
      server,
      handleProtocols: (protocols: Set<string>): string | false => {
        if (protocols.has(SUBPROTO_41)) return SUBPROTO_41;
        if (protocols.has(SUBPROTO_40)) return SUBPROTO_40;
        return false;
      },
    });
    this.wss = wss;

    wss.on('connection', (ws: WebSocket, req) => {
      const sock = ws as StatefulSocket;
      if (!req.url?.startsWith('/nt/')) {
        ws.close(1008, 'expected /nt/<name>');
        return;
      }
      const now = performance.now();
      sock.state = { lastPongMs: now, lastReceiveMs: now, protocol: ws.protocol, subs: [], pubs: new Map() };
      this.setupConnection(sock);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port, this.opts.host, resolve);
    });

    if (!this.opts.freeRun) {
      this.ds = new DsEndpoint({ host: this.opts.host, port: simTopology.robotDsControlPort(this.opts.team) });
      await this.ds.start();
    }

    setInterval(() => this.tick(), 50);
    setInterval(() => this.pingSweep(), 1000);
  }

  private addIntrinsicTopic(name: string, type: string, initial: number[] | string): void {
    this.topics.set(name, {
      id: this.nextTopicId++,
      type,
      properties: {},
      lastTsUs: 0,
      lastValue: initial,
      intrinsic: true,
      clientPublisherCount: 0,
    });
  }

  private setupConnection(ws: StatefulSocket): void {
    const state = ws.state;
    if (!state) return;

    ws.on('pong', () => {
      state.lastPongMs = performance.now();
    });

    ws.on('close', () => {
      // 规范 §Server Behavior：连接断开 = 该连接全部发布的隐式 unpublish
      for (const name of new Set(state.pubs.values())) {
        this.releasePublisher(name);
      }
      state.pubs.clear();
      state.subs = [];
    });

    ws.on('message', (data, isBinary) => {
      state.lastReceiveMs = performance.now();
      if (isBinary) {
        for (const frame of Array.from(decodeMulti(data as Buffer))) {
          if (!Array.isArray(frame) || frame.length !== 4) continue;
          const [pubuid, ts, dt, value] = frame as [number, number, number, unknown];
          if (pubuid === -1) {
            // RTT 请求：回服务器时基 + 原样回显（规范 §Timestamps）
            ws.send(encode([-1, this.serverUs(), dt, value]));
          } else {
            this.handleClientValue(ws, pubuid, ts, value, data as Buffer);
          }
        }
        return;
      }
      this.handleControlMessage(ws, String(data));
    });
  }

  private handleControlMessage(ws: StatefulSocket, text: string): void {
    const state = ws.state;
    if (!state) return;
    let msgs: unknown;
    try {
      msgs = JSON.parse(text);
    } catch {
      return;
    }
    for (const m of Array.isArray(msgs) ? msgs : [msgs]) {
      const { method, params } = (m ?? {}) as { method?: string; params?: Record<string, unknown> };
      if (method === 'subscribe' && params) {
        const sub: SubEntry = {
          subuid: Number(params.subuid),
          topics: (params.topics as string[]) ?? [],
          // 规范 §Subscription Options：prefix 未指定时默认 false
          prefix: (params.options as { prefix?: boolean } | undefined)?.prefix === true,
        };
        const idx = state.subs.findIndex((s) => s.subuid === sub.subuid);
        if (idx >= 0) state.subs[idx] = sub;
        else state.subs.push(sub);
        // 规范 §subscribe：对已存在的 cached topic 先发 announce + 当前值
        for (const [name, topic] of this.topics) {
          if (this.matches(name, sub)) {
            this.sendAnnounce(ws, name, topic);
            ws.send(encode([topic.id, topic.lastTsUs, TYPE_CODE[topic.type] ?? 5, topic.lastValue]));
          }
        }
      } else if (method === 'publish' && params) {
        this.handlePublish(ws, params);
      } else if (method === 'unpublish' && params) {
        const pubuid = Number(params.pubuid);
        const name = state.pubs.get(pubuid);
        if (name !== undefined) {
          state.pubs.delete(pubuid);
          this.releasePublisher(name);
        }
      } else if (method === 'unsubscribe' && params) {
        const uid = Number(params.subuid);
        const idx = state.subs.findIndex((s) => s.subuid === uid);
        if (idx >= 0) state.subs.splice(idx, 1);
      } else if (method === 'setproperties' && params) {
        this.handleSetProperties(ws, params);
      }
    }
  }

  private handlePublish(ws: StatefulSocket, params: Record<string, unknown>): void {
    const state = ws.state;
    if (!state) return;
    const name = String(params.name);
    const pubuid = Number(params.pubuid);

    const prev = state.pubs.get(pubuid);
    if (prev !== undefined && prev !== name) this.releasePublisher(prev);

    const existing = this.topics.get(name);
    if (!existing) {
      const topic: TopicEntry = {
        id: this.nextTopicId++,
        type: String(params.type ?? 'json'),
        properties: (params.properties as Record<string, unknown> | undefined) ?? {},
        lastTsUs: 0,
        lastValue: '',
        intrinsic: false,
        clientPublisherCount: 0,
      };
      this.topics.set(name, topic);
      if (prev !== name) topic.clientPublisherCount++;
      // 规范 §msg-announce：对 publish 的响应必须带该 pubuid（客户端视为发布确认）
      this.sendAnnounce(ws, name, topic, pubuid);
      // 规范 §msg-announce：topic 创建时向所有订阅了匹配前缀的客户端 announce
      for (const other of this.openClients()) {
        if (other === ws) continue;
        if (this.matchesAny(other, name)) this.sendAnnounce(other, name, topic);
      }
    } else {
      if (prev !== name) existing.clientPublisherCount++;
      this.sendAnnounce(ws, name, existing, pubuid);
    }
    state.pubs.set(pubuid, name);
  }

  private handleClientValue(ws: StatefulSocket, pubuid: number, tsUs: number, value: unknown, raw: Buffer): void {
    const state = ws.state;
    if (!state) return;
    const name = state.pubs.get(pubuid);
    if (name === undefined) return;
    const topic = this.topics.get(name);
    if (topic && tsUs >= topic.lastTsUs) {
      // 规范 §Caching：保留最大时间戳的值
      topic.lastTsUs = tsUs;
      if (typeof value === 'string') topic.lastValue = value;
      else if (Array.isArray(value)) topic.lastValue = value as number[];
    }
    // 值转发给其他连接（pub/sub 核心语义）
    for (const other of this.openClients()) {
      if (other !== ws) other.send(raw);
    }
    if (name === ntTopics.command(this.opts.team) && typeof value === 'string') {
      this.handleCommand(value);
    }
  }

  private handleSetProperties(ws: StatefulSocket, params: Record<string, unknown>): void {
    const name = String(params.name);
    const update = (params.update ?? {}) as Record<string, unknown>;
    const topic = this.topics.get(name);
    if (!topic) return; // 规范：topic 不存在时忽略
    for (const [k, v] of Object.entries(update)) {
      if (v === null) delete topic.properties[k];
      else topic.properties[k] = v;
    }
    ws.send(JSON.stringify([{ method: 'properties', params: { name, ack: true, update } }]));
    for (const other of this.openClients()) {
      if (other !== ws) other.send(JSON.stringify([{ method: 'properties', params: { name, update } }]));
    }
  }

  /** 发布者归零的非固有 topic：删除并向所有客户端发 unannounce（规范 §msg-unpublish） */
  private releasePublisher(name: string): void {
    const topic = this.topics.get(name);
    if (!topic) return;
    topic.clientPublisherCount = Math.max(0, topic.clientPublisherCount - 1);
    if (topic.clientPublisherCount === 0 && !topic.intrinsic) {
      this.topics.delete(name);
      for (const ws of this.openClients()) {
        ws.send(JSON.stringify([{ method: 'unannounce', params: { name, id: topic.id } }]));
      }
    }
  }

  private openClients(): StatefulSocket[] {
    const out: StatefulSocket[] = [];
    if (!this.wss) return out;
    for (const ws of this.wss.clients) {
      if (ws.readyState === WebSocket.OPEN) out.push(ws as StatefulSocket);
    }
    return out;
  }

  private matchesAny(ws: StatefulSocket, topicName: string): boolean {
    return ws.state?.subs.some((s) => this.matches(topicName, s)) === true;
  }

  private matches(topicName: string, sub: SubEntry): boolean {
    return sub.prefix
      ? sub.topics.some((t) => topicName.startsWith(t))
      : sub.topics.includes(topicName);
  }

  private sendAnnounce(ws: StatefulSocket, name: string, topic: TopicEntry, pubuid?: number): void {
    ws.send(
      JSON.stringify([
        {
          method: 'announce',
          params: {
            name,
            id: topic.id,
            type: topic.type,
            ...(pubuid !== undefined ? { pubuid } : {}),
            properties: topic.properties,
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

  private tick(): void {
    const nowNs = process.hrtime.bigint();
    const dt = Number(nowNs - this.lastTickNs) / 1e9;
    this.lastTickNs = nowNs;
    // 运动许可：free-run 调试旁路，或 DS 端点在线且使能（看门狗语义在 DsEndpoint 内）
    const motionPermitted = this.opts.freeRun || (this.ds?.enabled ?? false);
    if (!this.frozen && motionPermitted) this.simSeconds += dt;

    const pose = this.topics.get(ntTopics.pose(this.opts.team));
    const health = this.topics.get(ntTopics.health(this.opts.team));
    if (!pose || !health) return;

    const ts = this.serverUs();
    pose.lastTsUs = ts;
    pose.lastValue = this.poseAt(this.simSeconds);

    const moving = !this.frozen && motionPermitted;
    const hJson = JSON.stringify({
      dsLinked: this.ds?.dsLinked ?? false,
      enabled: moving,
      estopped: this.ds?.estopped ?? false,
      codeVersion: 'sim-0.2',
      fault: null,
    });
    const healthDirty = hJson !== String(health.lastValue);
    if (healthDirty) {
      health.lastValue = hJson;
      health.lastTsUs = ts;
    }

    const poseFrame = encode([pose.id, ts, TYPE_CODE['double[]'], pose.lastValue]);
    const healthFrame = healthDirty ? encode([health.id, ts, TYPE_CODE['json'], health.lastValue]) : undefined;

    for (const ws of this.openClients()) {
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

  private pingSweep(): void {
    const now = performance.now();
    for (const ws of this.openClients()) {
      const state = ws.state;
      if (!state) continue;
      // 规范 4.1 动机：禁止对 v4.0 连接发 WS PING（4.0 连接用消息流量判活）
      if (state.protocol === SUBPROTO_41) {
        ws.ping();
        if (now - state.lastPongMs > 2500) ws.terminate();
      } else if (now - state.lastReceiveMs > 15000) {
        ws.terminate();
      }
    }
  }

  private serverUs(): number {
    return Number((process.hrtime.bigint() - this.startNs) / 1000n);
  }
}

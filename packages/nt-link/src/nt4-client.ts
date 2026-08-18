/**
 * NT4 薄客户端 —— 按 NetworkTables 协议规范 4.1 实现。
 * 规范原文：allwpilib v2026.2.1 `ntcore/doc/networktables4.adoc`（与本仓库冻结栈同版）。
 *
 * 实现子集（GHPaths 所需）：连接（子协议协商 v4.1/v4.0）、订阅（前缀 + cached 初值）、
 * 接收二进制 MessagePack 值帧、发布、RTT 时间同步（Cristian 算法）、自动重连。
 * 浏览器与 Node ≥22 通用（依赖全局 WebSocket 与 performance）。
 */
import { decodeMulti, encode } from '@msgpack/msgpack';

/** 客户端应在 WebSocket 子协议中同时提供两个版本，优先 4.1（规范 §WebSockets Protocol Configuration） */
const SUBPROTOCOLS = ['v4.1.networktables.first.wpi.edu', 'networktables.first.wpi.edu'];

/** NT4 数据类型串 → 二进制帧中的类型码（规范 §Supported Data Types） */
const TYPE_CODES: Record<string, number> = {
  boolean: 0,
  double: 1,
  int: 2,
  float: 3,
  string: 4,
  json: 4,
  raw: 5,
  msgpack: 5,
  protobuf: 5,
  'boolean[]': 16,
  'double[]': 17,
  'int[]': 18,
  'float[]': 19,
  'string[]': 20,
};

export interface Nt4TopicInfo {
  name: string;
  id: number;
  type: string;
}

export type Nt4Status = 'connecting' | 'connected' | 'disconnected';

export interface Nt4ClientOptions {
  /** ws://host:port（不含路径；/nt/<clientName> 由本客户端追加） */
  serverUrl: string;
  clientName: string;
  onValue: (topic: Nt4TopicInfo, timestampUs: number, value: unknown) => void;
  onStatus?: (status: Nt4Status) => void;
}

/** 本地单调时钟，微秒（RTT 与服务器时基偏移都在同一时钟内计算） */
function localUs(): number {
  return performance.now() * 1000;
}

export class Nt4Client {
  private ws: WebSocket | null = null;
  private stopped = false;
  private status: Nt4Status = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rttTimer: ReturnType<typeof setInterval> | null = null;

  private nextSubuid = 1;
  private nextPubuid = 1;
  private readonly topicsById = new Map<number, Nt4TopicInfo>();
  private readonly topicsByName = new Map<string, Nt4TopicInfo>();
  /** 重连后需要重发的订阅（subuid → 前缀列表） */
  private readonly subscriptions = new Map<number, string[]>();
  /** 重连后需要重发的发布（pubuid → {name, type}） */
  private readonly publications = new Map<number, { name: string; type: string; wireType?: string }>();
  private readonly pubuidByTopic = new Map<string, number>();
  /**
   * 待发值（时间同步前 / 断线期间缓存）。演出命令幂等可重放（show-protocol），
   * 每个 pubuid 只保留最新一条。首个 RTT 应答后统一补发。
   */
  private readonly pendingValues = new Map<number, [number, string]>();
  private timeSynced = false;
  private controlReplayed = false;
  private bestRttUs = Number.POSITIVE_INFINITY;
  private serverOffsetUs = 0;
  private lastReceiveMs = 0;

  private readonly opts: Nt4ClientOptions;

  constructor(opts: Nt4ClientOptions) {
    this.opts = opts;
    this.connect();
  }

  get connected(): boolean {
    return this.status === 'connected';
  }

  /** 当前本地时间对应的估计服务器时基（微秒） */
  get estimatedServerUs(): number {
    return localUs() + this.serverOffsetUs;
  }

  close(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.setStatus('disconnected');
  }

  subscribe(prefixes: string[], subuid = this.nextSubuid++): void {
    this.subscriptions.set(subuid, prefixes);
    this.sendJson({
      method: 'subscribe',
      params: {
        topics: prefixes,
        subuid,
        options: { prefix: true, periodic: 0.05, all: false, topicsonly: false },
      },
    });
  }

  /**
   * 发布一个 JSON 值（NT4 的 json topic，线路上为字符串）。
   * 首次调用发出 publish 控制帧；时间同步完成前缓存值帧。
   */
  publishJson(topicName: string, jsonString: string): void {
    const type = 'json';
    let pubuid = this.pubuidByTopic.get(topicName);
    if (pubuid === undefined) {
      pubuid = this.nextPubuid++;
      this.publications.set(pubuid, { name: topicName, type });
      this.pubuidByTopic.set(topicName, pubuid);
      this.sendJson({ method: 'publish', params: { name: topicName, pubuid, type, properties: {} } });
    }
    // 类型码以服务端 announce 宣告的实际类型为准（规范 §msg-publish）
    const effective = this.publications.get(pubuid)?.wireType ?? type;
    this.sendValue(pubuid, TYPE_CODES[effective] ?? 5, jsonString);
  }

  private sendValue(pubuid: number, typeCode: number, value: string): void {
    if (this.status !== 'connected' || !this.timeSynced) {
      this.pendingValues.set(pubuid, [typeCode, value]);
      return;
    }
    // 规范 §Timestamps：时间戳为整数微秒——真 ntcore 以 expect_i64 解码，浮点会被断连
    this.ws?.send(encode([pubuid, Math.round(this.estimatedServerUs), typeCode, value]));
  }

  private connect(): void {
    if (this.stopped) return;
    this.setStatus('connecting');
    const url = `${this.opts.serverUrl.replace(/\/+$/, '')}/nt/${this.opts.clientName}`;
    const ws = new WebSocket(url, SUBPROTOCOLS);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.topicsById.clear();
      this.topicsByName.clear();
      this.bestRttUs = Number.POSITIVE_INFINITY;
      this.timeSynced = false;
      this.controlReplayed = false;
      this.lastReceiveMs = performance.now();
      this.setStatus('connected');
      // 规范建议先做 RTT 测量再发其他控制消息（§Client Behavior）；
      // publish/subscribe 重放推迟到首个 RTT 应答后（见 handleBinary）
      this.sendRtt();
      this.rttTimer = setInterval(() => {
        this.sendRtt();
        // 活性检查（浏览器无法主动发 WS PING，用 RTT 流量代替；规范 §aliveness）
        if (performance.now() - this.lastReceiveMs > 6000) {
          ws.close();
        }
      }, 2000);
    };

    ws.onmessage = (ev: MessageEvent) => {
      this.lastReceiveMs = performance.now();
      if (typeof ev.data === 'string') {
        this.handleText(ev.data);
      } else if (ev.data instanceof ArrayBuffer) {
        this.handleBinary(new Uint8Array(ev.data));
      }
    };

    ws.onclose = () => {
      this.clearTimers();
      this.setStatus('disconnected');
      if (!this.stopped) {
        this.reconnectTimer = setTimeout(() => this.connect(), 1500);
      }
    };
    // onerror 不做额外处理：随后必有 onclose，走统一重连路径
  }

  private handleText(text: string): void {
    let msgs: unknown;
    try {
      msgs = JSON.parse(text);
    } catch {
      return;
    }
    for (const m of Array.isArray(msgs) ? msgs : [msgs]) {
      if (typeof m !== 'object' || m === null) continue;
      const { method, params } = m as { method?: unknown; params?: unknown };
      if (typeof method !== 'string' || typeof params !== 'object' || params === null) continue;
      if (method === 'announce') {
        const { name, id, type } = params as { name?: unknown; id?: unknown; type?: unknown };
        if (typeof name === 'string' && typeof id === 'number' && typeof type === 'string') {
          const info: Nt4TopicInfo = { name, id, type };
          this.topicsById.set(id, info);
          this.topicsByName.set(name, info);
          // 规范 §msg-publish：发布值类型以服务端宣告的实际类型为准
          const pubuid = this.pubuidByTopic.get(name);
          if (pubuid !== undefined) {
            const local = this.publications.get(pubuid);
            if (local && local.type !== type) {
              if ((TYPE_CODES[type] ?? 5) === (TYPE_CODES[local.type] ?? 5)) {
                local.wireType = type; // 同码不同名（如 json/string）：采用服务端类型
              } else {
                console.warn(
                  `[nt-link] topic ${name} 服务端类型 ${type} 与本地 ${local.type} 不兼容，值可能被忽略`,
                );
              }
            }
          }
        }
      } else if (method === 'unannounce') {
        const { name, id } = params as { name?: unknown; id?: unknown };
        if (typeof name === 'string' && typeof id === 'number') {
          this.topicsById.delete(id);
          this.topicsByName.delete(name);
        }
      }
      // properties 消息本客户端暂不使用（规范要求忽略不识别的内容）
    }
  }

  private handleBinary(data: Uint8Array): void {
    let frames: unknown[];
    try {
      frames = Array.from(decodeMulti(data));
    } catch {
      return; // 规范允许忽略无法解码的消息
    }
    for (const f of frames) {
      if (!Array.isArray(f) || f.length !== 4) continue;
      const [id, ts, , value] = f as [number, number, number, unknown];
      if (id === -1) {
        // RTT 应答：value 为我们发出的本地时间回显（规范 §Timestamps）
        const rtt = localUs() - Number(value);
        if (rtt >= 0 && rtt < this.bestRttUs) {
          this.bestRttUs = rtt;
          this.serverOffsetUs = ts + rtt / 2 - localUs();
          this.timeSynced = true;
          const queued = [...this.pendingValues.entries()];
          this.pendingValues.clear();
          for (const [pubuid, [typeCode, valueText]] of queued) {
            this.sendValue(pubuid, typeCode, valueText);
          }
          if (!this.controlReplayed) {
            this.controlReplayed = true;
            this.replayControl();
          }
        }
        continue;
      }
      const topic = this.topicsById.get(id);
      if (topic) {
        this.opts.onValue(topic, ts, value);
      }
    }
  }

  private sendRtt(): void {
    if (this.status !== 'connected') return;
    this.ws?.send(encode([-1, 0, 1, localUs()]));
  }

  /** 连接建立且时钟同步后，重放全部 publish/subscribe 控制帧 */
  private replayControl(): void {
    for (const [pubuid, pub] of this.publications) {
      this.sendJson({ method: 'publish', params: { name: pub.name, pubuid, type: pub.type, properties: {} } });
    }
    for (const [subuid, prefixes] of this.subscriptions) {
      this.sendJson({
        method: 'subscribe',
        params: { topics: prefixes, subuid, options: { prefix: true, periodic: 0.05 } },
      });
    }
  }

  private sendJson(msg: unknown): void {
    // 规范 §Text Data Frames：文本帧是 JSON 消息列表。
    // 未连接时丢弃：onopen 会依据 subscriptions/publications 重放全部控制帧。
    if (this.status !== 'connected') return;
    this.ws?.send(JSON.stringify([msg]));
  }

  private setStatus(s: Nt4Status): void {
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.rttTimer !== null) clearInterval(this.rttTimer);
    this.reconnectTimer = null;
    this.rttTimer = null;
  }
}

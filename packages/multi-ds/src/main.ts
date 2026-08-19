/**
 * multi-DS 独立进程入口（ADR-0002）：N 个逻辑 DS + localhost:5899 控制 API。
 *
 * 运行（根目录）：npm run ds [-- --count 6 --base-team 9001 --grace-ms 2000]
 *
 * 安全语义：
 *  - 本进程被杀 → 心跳停止 → 机器人看门狗失效（预期行为，验收标准之一）；
 *  - UI 断连（或从未连接后一度连接再静默）超过宽限期 → 全部 disable（estop 闩锁不解除）。
 */
import { WebSocketServer, WebSocket } from 'ws';
import { LogicalDs, type DsStatusEvent } from './logical-ds.ts';
import {
  MULTI_DS_CONTROL_PORT,
  simTopology,
  type MultiDsControl,
  type MultiDsRobotStatus,
} from '@ghpaths/show-protocol';

interface Options {
  count: number;
  baseTeam: number;
  graceMs: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { count: simTopology.count, baseTeam: simTopology.teamBase, graceMs: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--count') opts.count = Number(argv[++i]);
    else if (a === '--base-team') opts.baseTeam = Number(argv[++i]);
    else if (a === '--grace-ms') opts.graceMs = Number(argv[++i]);
  }
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > 99) {
    console.error('--count 需要 1~99 的整数');
    process.exit(1);
  }
  if (!Number.isInteger(opts.baseTeam) || opts.baseTeam < 1) {
    console.error('--base-team 需要正整数队号');
    process.exit(1);
  }
  // 宽限期是安全链（可调不可关）：NaN 会让比较恒 false 而静默失效，必须硬校验
  if (!Number.isInteger(opts.graceMs) || opts.graceMs < 250) {
    console.error('--grace-ms 需要 ≥250 的整数（毫秒）');
    process.exit(1);
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const teams = Array.from({ length: opts.count }, (_, i) => opts.baseTeam + i);

  const dsByTeam = new Map<number, LogicalDs>();
  const robotState = new Map<number, { linked: boolean; batteryVolts: number }>();

  for (const team of teams) {
    // sim 地址模型：逻辑 DS 与机器人都在 127.0.0.1，用端口区分（macOS 127/8 其余地址默认不可 bind）。
    // 真机部署：localAddress 用 10.TE.AM.5 alias、robotAddress 用 mDNS 名、端口走默认 1110/1150（配置文件属 Phase 0）。
    const ds = new LogicalDs({
      team,
      localAddress: '127.0.0.1',
      robotAddress: '127.0.0.1',
      controlPort: simTopology.dsControlPort(team),
      robotPort: simTopology.robotDsControlPort(team),
      statusPort: null,
    });
    ds.on('status', (ev: DsStatusEvent) => {
      robotState.set(ev.team, { linked: ev.linked, batteryVolts: ds.batteryVolts });
    });
    await ds.start();
    dsByTeam.set(team, ds);
    robotState.set(team, { linked: false, batteryVolts: 0 });
    console.log(`  team ${team}: DS :${simTopology.dsControlPort(team)} → robot :${simTopology.robotDsControlPort(team)}`);
  }

  // ---- 控制API（仅 localhost）----
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: MULTI_DS_CONTROL_PORT,
    // 浏览器页面必带 Origin：只接受本机来源（含 Tauri 壳的 tauri://localhost——ADR-0007 打包后的
    // 页面 Origin），挡掉任意网页连 5899 发 clearEstop/enableAll；无 Origin（本地进程，如探针）放行
    verifyClient: (info: { req: { headers: Record<string, string | string[] | undefined> } }): boolean => {
      const origin = info.req.headers.origin;
      if (origin === undefined) return true;
      try {
        const url = new URL(origin);
        return (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'tauri:') &&
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
      } catch {
        return false;
      }
    },
  });
  wss.on('error', (err: Error) => {
    console.error('multi-DS 控制 API 异常（5899 被占？）:', err.message);
    process.exit(1);
  });
  let lastUiActivityMs = 0;
  let uiHasConnected = false;

  const apply = (fn: (ds: LogicalDs) => void): void => {
    for (const ds of dsByTeam.values()) fn(ds);
  };

  wss.on('connection', (ws: WebSocket) => {
    uiHasConnected = true;
    lastUiActivityMs = performance.now();
    ws.on('message', (data) => {
      lastUiActivityMs = performance.now();
      let msg: MultiDsControl;
      try {
        msg = JSON.parse(String(data)) as MultiDsControl;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'enable': dsByTeam.get(msg.team)?.enableAutonomous(); break;
        case 'disable': dsByTeam.get(msg.team)?.disable(); break;
        case 'estop': dsByTeam.get(msg.team)?.estop(); break;
        case 'clearEstop': dsByTeam.get(msg.team)?.clearEstop(); break;
        case 'enableAll': apply((ds) => ds.enableAutonomous()); break;
        case 'disableAll': apply((ds) => ds.disable()); break;
        case 'estopAll': apply((ds) => ds.estop()); break;
        case 'uiPing': break; // 只刷新活动时间
      }
    });
  });

  // UI 宽限期监控（ADR-0002：可调时长，不可关闭）
  setInterval(() => {
    if (uiHasConnected && performance.now() - lastUiActivityMs > opts.graceMs) {
      apply((ds) => ds.disable());
    }
  }, 200);

  // 10Hz 状态广播
  setInterval(() => {
    const robots: MultiDsRobotStatus[] = teams.map((team) => {
      const ds = dsByTeam.get(team)!;
      const rs = robotState.get(team) ?? { linked: false, batteryVolts: 0 };
      return {
        team,
        state: ds.currentState,
        linked: rs.linked,
        batteryVolts: rs.batteryVolts,
      };
    });
    const payload = JSON.stringify({ type: 'status', robots });
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }, 100);

  console.log(`multi-DS 就绪：${teams.length} 台，控制API ws://127.0.0.1:${MULTI_DS_CONTROL_PORT}（宽限期 ${opts.graceMs}ms）`);

  const shutdown = async (): Promise<void> => {
    console.log('multi-DS 关闭：全部 disable 后退出');
    apply((ds) => ds.disable());
    await Promise.all([...dsByTeam.values()].map((ds) => ds.stop()));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error('multi-DS 启动失败:', err);
  process.exit(1);
});

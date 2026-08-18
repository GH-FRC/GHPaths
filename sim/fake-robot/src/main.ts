// fake-robot —— 无硬件开发回路的模拟机器人入口（ADR-0005）。
//
// 每台模拟机器人 = NT4 服务端（位姿/健康发布 + 命令接收）。DS 端点模拟属 Phase 0。
// 运行：npm run sim [-- --count 6 --base-team 9001 --no-free-run]
//   --count N        启动 N 台（默认 6）
//   --base-team T    队号起点（默认 9001）
//   --no-free-run    冻结直到收到 start/resume 命令（默认 free-run：启动即漫游）
import { FakeRobot } from './robot.ts';
import { simTopology } from '@ghpaths/show-protocol';

interface Options {
  count: number;
  baseTeam: number;
  freeRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { count: simTopology.count, baseTeam: simTopology.teamBase, freeRun: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--count') opts.count = Number(argv[++i]);
    else if (a === '--base-team') opts.baseTeam = Number(argv[++i]);
    else if (a === '--no-free-run') opts.freeRun = false;
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`fake-robot: 启动 ${opts.count} 台模拟机器人（队号 ${opts.baseTeam} 起，free-run=${opts.freeRun}）`);
  for (let i = 0; i < opts.count; i++) {
    const team = opts.baseTeam + i;
    const robot = new FakeRobot({
      team,
      port: simTopology.wsPortBase + (team % 100),
      host: '127.0.0.1',
      freeRun: opts.freeRun,
    });
    await robot.start();
    console.log(`  team ${team} → ${simTopology.wsUrl(team)}/nt/…`);
  }
  console.log('就绪。Ctrl-C 退出。');
}

main().catch((err: unknown) => {
  console.error('fake-robot 启动失败:', err);
  process.exit(1);
});

// fake-robot —— 无硬件开发回路的模拟机器人入口（ADR-0005）。
//
// 每台模拟机器人 = NT4 服务端（位姿/健康 + 命令）+ DS 端点（UDP 1110/1150，roboRIO 看门狗语义）。
// 默认运动受 DS 使能门控（free-run=false）：先 npm run ds 再在 UI 里使能，机器人才动。
// --free-run 为调试旁路（无视 DS，启动即漫游）——排障用，勿当正常模式。
//
// 运行：npm run sim [-- --count 6 --base-team 9001 --free-run]
import { FakeRobot } from './robot.ts';
import { simTopology } from '@ghpaths/show-protocol';

interface Options {
  count: number;
  baseTeam: number;
  freeRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { count: simTopology.count, baseTeam: simTopology.teamBase, freeRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--count') opts.count = Number(argv[++i]);
    else if (a === '--base-team') opts.baseTeam = Number(argv[++i]);
    else if (a === '--free-run') opts.freeRun = true;
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > 99) {
    console.error('--count 需要 1~99 的整数（端口派生自 team%100，>99 会撞端口）');
    process.exit(1);
  }
  if (!Number.isInteger(opts.baseTeam) || opts.baseTeam < 1) {
    console.error('--base-team 需要正整数队号');
    process.exit(1);
  }
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
    const dsInfo = opts.freeRun ? '（free-run：无 DS 端点）' : `，DS 端点 :${simTopology.robotDsControlPort(team)}`;
    console.log(`  team ${team} → NT4 ${simTopology.wsUrl(team)}${dsInfo}`);
  }
  if (!opts.freeRun) {
    console.log('运动受 DS 使能门控：npm run ds 启动 multi-DS，再在演控台 UI 中使能。');
  }
  console.log('就绪。Ctrl-C 退出。');
}

main().catch((err: unknown) => {
  console.error('fake-robot 启动失败:', err);
  process.exit(1);
});

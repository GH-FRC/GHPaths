// fake-robot —— 无硬件开发回路的模拟机器人（ADR-0005）。
//
// 每个模拟机器人提供两件事：
//  1. NT4：发布 pose/health（Node ≥21 全局 WebSocket；中心服务器拓扑下连演控）；
//  2. DS 端点：监听 UDP 1110/1150 + TCP 1740，模拟 roboRIO 的使能语义——
//     只有持续收到 multi-DS 的控制包才“允许运动”，停包即失效。
//     模拟端点必须实现与真机一致的看门狗语义，否则测不出安全问题（ADR-0005 的硬约束）。
//
// 计划用法：npm run sim -- --count 6 --base-team 9001
// TODO(Phase 0)：完整实现（pose 沿椭圆/八字漫游即可满足 UI 调试）。
// 运行方式：node src/main.ts（Node ≥21 原生 type stripping，无需构建）。

interface FakeRobotOptions {
  count: number;
  baseTeam: number;
  host: string;
}

function parseArgs(argv: string[]): FakeRobotOptions {
  // TODO(Phase 0)：完整参数解析（--count / --base-team）
  const count = Number(argv[2] ?? 6);
  return { count, baseTeam: 9001, host: '127.0.0.1' };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `TODO(Phase 0): 启动 ${opts.count} 台模拟机器人（队号 ${opts.baseTeam} 起）@ ${opts.host}`,
  );
  console.log('每台 = NT4 pose/health 发布 + DS 端点（UDP 1110/1150、TCP 1740）模拟 roboRIO 使能语义');
  process.exitCode = 1; // 尚未实现：显式失败而非静默成功
}

main();

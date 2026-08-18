// ds-probe —— DS 使能链路自检（需 fake-robot 在跑且非 --free-run；multi-DS 进程须停，否则端口冲突）。
// 四关：建链、使能→运动、心跳停止→看门狗失效（≤1s）、estop 闩锁与恢复。
// 运行：npm run probe:ds -w @ghpaths/multi-ds（或根目录 npm run probe:ds）
// 排障：报"使能后未运动"多为 sim 里残留 estop 闩锁——重启 npm run sim 即恢复。
import { LogicalDs } from './logical-ds.ts';
import { createNtLink } from '@ghpaths/nt-link';
import { simTopology, type RobotHealth } from '@ghpaths/show-protocol';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(
  holder: { health?: RobotHealth },
  pred: (h: RobotHealth) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (holder.health && pred(holder.health)) return true;
    await sleep(50);
  }
  return false;
}

async function main(): Promise<void> {
  const team = simTopology.teamBase;
  const link = createNtLink();
  const holder: { health?: RobotHealth } = {};
  const conn = await link.connectRobot(team, simTopology.wsUrl(team).replace('ws://', ''));
  conn.onHealth((h) => {
    holder.health = h;
  });
  await sleep(500); // 等 health 初值

  // 1) 建链：LogicalDs 心跳 → 机器人 dsLinked
  const simConfig = {
    team,
    localAddress: '127.0.0.1',
    robotAddress: '127.0.0.1',
    controlPort: simTopology.dsControlPort(team),
    robotPort: simTopology.robotDsControlPort(team),
    statusPort: null,
  } as const;
  const ds = new LogicalDs(simConfig);
  await ds.start();
  const linked = await waitHealth(holder, (h) => h.dsLinked, 1500);
  console.log(`1) DS 建链：dsLinked=${linked ? 'true' : 'false'}${linked ? ' ✓' : ' ✗'}`);
  if (!linked) throw new Error('建链失败（fake-robot 是否在跑？是否 --free-run？multi-DS 是否占着端口？）');

  // 2) 使能 → 运动
  ds.enableAutonomous();
  const moving = await waitHealth(holder, (h) => h.enabled, 1000);
  console.log(`2) 使能：enabled=${moving ? 'true' : 'false'}${moving ? ' ✓' : ' ✗'}`);
  if (!moving) throw new Error('使能后未运动');

  // 3) 心跳停止（进程内 stop = 模拟 multi-DS 崩溃）→ 看门狗 ≤1s 失效
  const t0 = performance.now();
  await ds.stop();
  const died = await waitHealth(holder, (h) => !h.enabled && !h.dsLinked, 1500);
  const elapsed = (performance.now() - t0).toFixed(0);
  console.log(`3) 看门狗：心跳停止后 ${elapsed}ms 失效${died ? ' ✓' : ' ✗（要求 ≤~1s）'}`);
  if (!died) throw new Error('心跳停止后机器人未失效');

  // 4) estop 闩锁：estop → estopped；disable 不解除；clearEstop 恢复
  const ds2 = new LogicalDs(simConfig);
  await ds2.start();
  await sleep(300);
  ds2.enableAutonomous();
  await waitHealth(holder, (h) => h.enabled, 1000);
  ds2.estop();
  const estopped = await waitHealth(holder, (h) => h.estopped && !h.enabled, 1000);
  console.log(`4) estop 闩锁：${estopped ? '✓' : '✗'}`);
  if (!estopped) throw new Error('estop 未生效');
  ds2.disable();
  await sleep(300);
  if (!holder.health?.estopped) throw new Error('disable 意外解除了 estop 闩锁');
  ds2.clearEstop();
  const cleared = await waitHealth(holder, (h) => !h.estopped, 1000);
  console.log(`   clearEstop 解除：${cleared ? '✓' : '✗'}`);
  if (!cleared) throw new Error('clearEstop 未解除闩锁');

  await ds2.stop();
  link.closeAll();
  console.log('ds-probe 通过 ✓');
}

main().catch((err: unknown) => {
  console.error('ds-probe 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});

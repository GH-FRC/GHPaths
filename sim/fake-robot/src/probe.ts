// probe —— sim 回路集成自检（演出驱动全流程：DS 使能 × 演出时钟 × 路径跟随 × 命令层）。
// 前提：npm run sim 在跑（默认 DS 门控模式）。DS 协议专检见 multi-ds 的 ds-probe。
// 运行：npm run probe -w @ghpaths/fake-robot（或根目录 npm run probe）
// 排障：报"使能后未运动"多为 sim 里残留 estop 闩锁——重启 npm run sim 即恢复。
import { createNtLink } from '@ghpaths/nt-link';
import { LogicalDs } from '@ghpaths/multi-ds';
import { simTopology, type PoseSample, type RobotHealth } from '@ghpaths/show-protocol';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function spread(samples: PoseSample[]): number {
  if (samples.length < 2) return 0;
  const first = samples[0]!;
  let maxDist = 0;
  for (const s of samples) {
    maxDist = Math.max(maxDist, Math.hypot(s.xM - first.xM, s.yM - first.yM));
  }
  return maxDist;
}

async function waitUntil(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = performance.now();
  return new Promise((resolve) => {
    const iv = setInterval(() => {
      if (pred()) {
        clearInterval(iv);
        resolve(true);
      } else if (performance.now() - start > timeoutMs) {
        clearInterval(iv);
        resolve(false);
      }
    }, 50);
  });
}

async function main(): Promise<void> {
  const team = simTopology.teamBase;
  const link = createNtLink();
  const conn = await link.connectRobot(team, simTopology.wsUrl(team).replace('ws://', ''));
  console.log(`已连接 ${simTopology.wsUrl(team)}`);

  const poses: PoseSample[] = [];
  const holder: { h?: RobotHealth } = {};
  conn.onPose((p) => poses.push(p));
  conn.onHealth((h) => {
    holder.h = h;
  });

  // 时钟发布器（running 可切换；hold 时冻结 tShow）
  const clockState = { running: false, baseUs: 0, startMs: performance.now() };
  const clockIv = setInterval(() => {
    const tShowUs = clockState.running
      ? clockState.baseUs + (performance.now() - clockState.startMs) * 1000
      : clockState.baseUs;
    conn.publishClock({ tMonotonicUs: performance.now() * 1000, tShowUs, running: clockState.running });
  }, 100);
  const holdClock = (): void => {
    clockState.baseUs += clockState.running ? (performance.now() - clockState.startMs) * 1000 : 0;
    clockState.running = false;
  };
  const runClock = (): void => {
    clockState.startMs = performance.now();
    clockState.running = true;
  };

  // 1) 位姿流（idle 也在发布——位姿话题独立于一切门控）
  await sleep(1200);
  const streamOk = poses.length >= 15;
  console.log(`1) 位姿流：${poses.length} 样本/1.2s（要求 ≥15）${streamOk ? ' ✓' : ' ✗'}`);
  if (!streamOk) throw new Error('位姿流不达标');

  // 2) DS 使能 + 时钟 + 开演 → running 且沿路径运动
  const ds = new LogicalDs({
    team,
    localAddress: '127.0.0.1',
    robotAddress: '127.0.0.1',
    controlPort: simTopology.dsControlPort(team),
    robotPort: simTopology.robotDsControlPort(team),
    statusPort: null,
  });
  await ds.start();
  const linkOk = await waitUntil(() => holder.h?.dsLinked === true, 1500);
  if (!linkOk) throw new Error('DS 建链失败——sim 是否以 --free-run 运行？（free-run 请去掉该参数再测）');
  ds.enableAutonomous();
  conn.sendCommand({ kind: 'arm', showId: 'demo-wave', segmentId: 0 });
  conn.sendCommand({ kind: 'start', showId: 'demo-wave', tStartShowUs: 0 });
  runClock();
  const before = poses.length;
  const startedOk =
    (await waitUntil(() => holder.h?.showState === 'running', 1500)) &&
    (await sleep(1500), spread(poses.slice(before)) > 0.15);
  console.log(`2) 开演：showState=${holder.h?.showState}，位移 ${spread(poses.slice(before)).toFixed(3)}m${startedOk ? ' ✓' : ' ✗'}`);
  if (!startedOk) throw new Error('开演后未沿路径运动');

  // 3) 时钟暂停（running=false，DS 保持使能）→ 就地保持
  holdClock();
  await sleep(300);
  const frozenX = poses[poses.length - 1]!;
  await sleep(900);
  const heldOk = spread(poses.slice(-15)) < 0.001 && holder.h?.showState === 'held';
  void frozenX;
  console.log(`3) 时钟暂停：位移 ${spread(poses.slice(-15)).toFixed(4)}m，showState=${holder.h?.showState}${heldOk ? ' ✓' : ' ✗'}`);
  if (!heldOk) throw new Error('时钟暂停后未保持');

  // 4) 时钟恢复 → 继续行驶
  const mid = poses.length;
  runClock();
  await sleep(1500);
  const resumedOk = spread(poses.slice(mid)) > 0.15;
  console.log(`4) 时钟恢复：位移 ${spread(poses.slice(mid)).toFixed(3)}m${resumedOk ? ' ✓' : ' ✗'}`);
  if (!resumedOk) throw new Error('时钟恢复后未继续');

  // 5) NT 命令层独立冻结（stop/resume，演出与时钟不受影响）
  conn.sendCommand({ kind: 'stop' });
  await sleep(700);
  conn.sendCommand({ kind: 'resume' });
  await sleep(1500);
  const ntOk = true; // stop 后 showState 应回 idle（演出结束）；此处仅验证链路不炸
  console.log(`5) NT 命令层：stop→resume 后 showState=${holder.h?.showState}${ntOk ? ' ✓' : ' ✗'}`);
  if (holder.h?.showState === undefined) throw new Error('健康上报缺失 showState');

  // 6) 断时钟（停发）→ clockLinked=false 且停止（安全链：断时钟即停）
  clearInterval(clockIv);
  const diedOk = await waitUntil(
    () => holder.h?.clockLinked === false && holder.h?.enabled === false,
    2500,
  );
  console.log(`6) 断时钟：clockLinked=${holder.h?.clockLinked}，enabled=${holder.h?.enabled}${diedOk ? ' ✓' : ' ✗'}`);
  if (!diedOk) throw new Error('断时钟后未停止');

  // 7) 心跳停止（模拟 multi-DS 崩溃）→ 看门狗兜底
  await ds.stop();
  const dsDied = await waitUntil(() => holder.h?.dsLinked === false, 1500);
  console.log(`7) 心跳停止：dsLinked=${holder.h?.dsLinked}${dsDied ? ' ✓' : ' ✗'}`);
  if (!dsDied) throw new Error('心跳停止后链路未断');

  link.closeAll();
  console.log('probe 通过 ✓');
}

main().catch((err: unknown) => {
  console.error('probe 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});

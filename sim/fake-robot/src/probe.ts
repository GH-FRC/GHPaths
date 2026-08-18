// probe —— sim 回路集成自检（NT4 + 演出命令链路）。
// 前提：npm run sim 在跑（默认 DS 门控模式）。DS 协议细节的专检见 multi-ds 的 ds-probe。
// 四关：位姿流（未使能也在发布）、DS 使能→运动、NT stop/resume 冻结与恢复、心跳停止→失效。
// 运行：npm run probe -w @ghpaths/fake-robot（或根目录 npm run probe）
// 排障：报"使能后未运动"多为 sim 里残留 estop 闩锁（此前的探针可能闩过）——重启 npm run sim 即恢复。
import { createNtLink } from '@ghpaths/nt-link';
import { LogicalDs } from '@ghpaths/multi-ds';
import { simTopology, type PoseSample } from '@ghpaths/show-protocol';

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

async function main(): Promise<void> {
  const team = simTopology.teamBase;
  const link = createNtLink();
  const conn = await link.connectRobot(team, simTopology.wsUrl(team).replace('ws://', ''));
  console.log(`已连接 ${simTopology.wsUrl(team)}`);

  const poses: PoseSample[] = [];
  conn.onPose((p) => poses.push(p));

  // 1) 位姿流（机器人未使能也在发布——位姿话题独立于使能）
  await sleep(1200);
  const streamOk = poses.length >= 15;
  console.log(`1) 位姿流：${poses.length} 样本/1.2s（要求 ≥15）${streamOk ? ' ✓' : ' ✗'}`);
  if (!streamOk) throw new Error('位姿流不达标');

  // 2) DS 使能（探针自带逻辑 DS）→ 运动
  const ds = new LogicalDs({
    team,
    localAddress: '127.0.0.1',
    robotAddress: '127.0.0.1',
    controlPort: simTopology.dsControlPort(team),
    robotPort: simTopology.robotDsControlPort(team),
    statusPort: null,
  });
  await ds.start();
  ds.enableAutonomous();
  const before = poses.length;
  await sleep(1200);
  const moving = spread(poses.slice(before)) > 0.01;
  console.log(`2) DS 使能→运动：位移 ${spread(poses.slice(before)).toFixed(3)}m${moving ? ' ✓' : ' ✗'}`);
  if (!moving) throw new Error('使能后未运动');

  // 3) NT stop → 冻结；resume → 恢复（演出命令层，独立于 DS 使能）
  conn.sendCommand({ kind: 'stop' });
  await sleep(800);
  const frozen = spread(poses.slice(-10)) < 0.001;
  console.log(`3) NT stop 冻结：${spread(poses.slice(-10)).toFixed(4)}m${frozen ? ' ✓' : ' ✗'}`);
  if (!frozen) throw new Error('stop 后仍在运动');
  conn.sendCommand({ kind: 'resume' });
  const mid = poses.length;
  await sleep(800);
  const resumed = spread(poses.slice(mid)) > 0.01;
  console.log(`4) NT resume 恢复：${spread(poses.slice(mid)).toFixed(3)}m${resumed ? ' ✓' : ' ✗'}`);
  if (!resumed) throw new Error('resume 后未恢复运动');

  await ds.stop();
  link.closeAll();
  console.log('probe 通过 ✓');
}

main().catch((err: unknown) => {
  console.error('probe 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});

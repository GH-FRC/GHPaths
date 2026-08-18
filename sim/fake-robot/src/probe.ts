// probe —— sim 回路集成自检：用 nt-link 连一台模拟机器人，验证收流 + 命令回环。
// 通过条件：1.5s 内收到 ≥ 20 个位姿；stop 后位姿冻结；resume 后恢复运动。
// 运行：npm run probe -w @ghpaths/fake-robot（需先 npm run sim）
import { createNtLink } from '@ghpaths/nt-link';
import { simTopology, type PoseSample } from '@ghpaths/show-protocol';

async function main(): Promise<void> {
  const team = simTopology.teamBase;
  const link = createNtLink();
  const conn = await link.connectRobot(team, simTopology.wsUrl(team).replace('ws://', ''));
  console.log(`已连接 ${simTopology.wsUrl(team)}`);

  const poses: PoseSample[] = [];
  conn.onPose((p) => poses.push(p));

  await sleep(1500);
  const got = poses.length;
  const moving = positionSpread(poses) > 0.01;
  console.log(`1) 位姿流：${got} 个样本 / 1.5s（要求 ≥20），位移 ${positionSpread(poses).toFixed(3)}m`);
  if (got < 20 || !moving) throw new Error('位姿流不达标');

  conn.sendCommand({ kind: 'stop' });
  await sleep(800);
  const frozenPoses = poses.slice(-10);
  const frozen = positionSpread(frozenPoses) < 0.001;
  console.log(`2) stop 命令：最近 10 帧位移 ${positionSpread(frozenPoses).toFixed(4)}m（要求 ≈0）`);
  if (!frozen) throw new Error('stop 后仍在运动');

  conn.sendCommand({ kind: 'resume' });
  const before = poses.length;
  await sleep(800);
  const resumed = positionSpread(poses.slice(before)) > 0.01;
  console.log(`3) resume 命令：恢复后位移 ${(positionSpread(poses.slice(before))).toFixed(3)}m（要求 >0.01）`);
  if (!resumed) throw new Error('resume 后未恢复运动');

  link.closeAll();
  console.log('probe 通过 ✓');
}

function positionSpread(samples: PoseSample[]): number {
  if (samples.length < 2) return 0;
  let maxDist = 0;
  const first = samples[0]!;
  for (const s of samples) {
    maxDist = Math.max(maxDist, Math.hypot(s.xM - first.xM, s.yM - first.yM));
  }
  return maxDist;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err: unknown) => {
  console.error('probe 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});

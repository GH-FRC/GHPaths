// probe —— sim 回路集成自检（演出驱动全流程：DS 使能 × 演出时钟 × 路径跟随 × 安全链）。
// 前提：npm run sim 在跑（默认 DS 门控模式）且 multi-DS 进程已停（探针自带逻辑 DS 绑 15001 会冲突）。
// 运行：npm run probe -w @ghpaths/fake-robot（或根目录 npm run probe）
// 排障：报"start 被拒绝"多为上一轮探针把机器人开到路径中途——重启 npm run sim 即复位就位。
import { createNtLink } from '@ghpaths/nt-link';
import { LogicalDs } from '@ghpaths/multi-ds';
import { simTopology, type PoseSample, type RobotHealth } from '@ghpaths/show-protocol';
import { createDemoShow, poseOnPathAt } from '@ghpaths/field-model';

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
  const demoPath = createDemoShow(simTopology.teams()).paths[0]!;
  const link = createNtLink();
  const conn = await link.connectRobot(team, simTopology.wsUrl(team).replace('ws://', ''));
  console.log(`已连接 ${simTopology.wsUrl(team)}`);

  const poses: PoseSample[] = [];
  const holder: { h?: RobotHealth } = {};
  conn.onPose((p) => poses.push(p));
  conn.onHealth((h) => {
    holder.h = h;
  });

  // 时钟发布器（running 可切换；hold 时冻结 tShow，恢复时不产生跳变）
  const clockState = { running: false, baseUs: 0, startMs: performance.now() };
  let clockOn = true;
  const clockIv = setInterval(() => {
    const tShowUs = clockState.running
      ? clockState.baseUs + (performance.now() - clockState.startMs) * 1000
      : clockState.baseUs;
    conn.publishClock({ tMonotonicUs: performance.now() * 1000, tShowUs, running: clockState.running });
  }, 100);
  const holdClock = (): void => {
    if (clockState.running) clockState.baseUs += (performance.now() - clockState.startMs) * 1000;
    clockState.running = false;
  };
  const runClock = (): void => {
    clockState.startMs = performance.now();
    clockState.running = true;
  };

  // 1) 位姿流（idle 也在发布——位姿话题独立于一切门控）；且待命位 = 路径起点（就位检查基础）
  await sleep(1200);
  const atStart =
    poses.length > 0 &&
    Math.hypot(poses[poses.length - 1]!.xM - demoPath.waypoints[0]!.xM, poses[poses.length - 1]!.yM - demoPath.waypoints[0]!.yM) < 0.05;
  console.log(`1) 位姿流：${poses.length} 样本/1.2s（≥15），就位于路径起点=${atStart}${poses.length >= 15 && atStart ? ' ✓' : ' ✗'}`);
  if (poses.length < 15 || !atStart) throw new Error('位姿流或就位检查不达标');

  // 2) DS 使能 + arm/start → running 且沿路径运动（基线在 running 达成后重置，排除起点对齐位移）
  const ds = new LogicalDs({
    team,
    localAddress: '127.0.0.1',
    robotAddress: '127.0.0.1',
    controlPort: simTopology.dsControlPort(team),
    robotPort: simTopology.robotDsControlPort(team),
    statusPort: null,
  });
  try {
    await ds.start();
  } catch (e) {
    throw new Error(`DS 端口绑定失败（multi-DS 在跑？先停 npm run ds）：${e instanceof Error ? e.message : e}`);
  }
  if (!(await waitUntil(() => holder.h?.dsLinked === true, 1500))) {
    throw new Error('DS 建链失败——sim 是否以 --free-run 运行？（free-run 请去掉该参数再测）');
  }
  ds.enableAutonomous();
  conn.sendCommand({ kind: 'arm', showId: 'demo-wave', segmentId: 0 });
  conn.sendCommand({ kind: 'start', showId: 'demo-wave', tStartShowUs: 0 });
  runClock();
  const running = await waitUntil(() => holder.h?.showState === 'running', 1500);
  await sleep(500); // 起步落定后再取基线
  const base = poses.length;
  await sleep(1500);
  const moved = spread(poses.slice(base));
  // 沿路径校验：最近位姿应贴近路径在当前 tShow 的位姿（<0.2m）
  const last = poses[poses.length - 1]!;
  const onPath = poseOnPathAt(demoPath, last.tShowUs);
  const trackErr = onPath ? Math.hypot(last.xM - onPath.x, last.yM - onPath.y) : 99;
  console.log(`2) 开演：running=${running}，1.5s 位移 ${moved.toFixed(3)}m，路径跟踪误差 ${trackErr.toFixed(3)}m${running && moved > 0.1 && trackErr < 0.2 ? ' ✓' : ' ✗'}`);
  if (!running || moved <= 0.1 || trackErr >= 0.2) throw new Error('开演后未沿路径运动');

  // 3) 时钟暂停（running=false，DS 保持使能）→ 就地保持
  holdClock();
  await sleep(300);
  await sleep(900);
  const heldOk = spread(poses.slice(-15)) < 0.001 && holder.h?.showState === 'held';
  console.log(`3) 时钟暂停：位移 ${spread(poses.slice(-15)).toFixed(4)}m，showState=${holder.h?.showState}${heldOk ? ' ✓' : ' ✗'}`);
  if (!heldOk) throw new Error('时钟暂停后未保持');

  // 4) 时钟恢复 → 继续行驶
  const mid = poses.length;
  runClock();
  await sleep(1500);
  const resumedOk = spread(poses.slice(mid)) > 0.1;
  console.log(`4) 时钟恢复：位移 ${spread(poses.slice(mid)).toFixed(3)}m${resumedOk ? ' ✓' : ' ✗'}`);
  if (!resumedOk) throw new Error('时钟恢复后未继续');

  // 5) 断时钟（停发，演出进行中）→ clockLinked=false 且冻结（运动状态下的真实安全链测试）
  holdClock(); // 先冻结时钟账本再停发——恢复时 tShow 连续，不触发机器人的跳变防护
  clockOn = false;
  clearInterval(clockIv);
  const diedOk = await waitUntil(() => holder.h?.clockLinked === false, 2500);
  await sleep(800); // 确保采样窗完全落在断链之后（10 帧 = 500ms）
  const frozenOk = spread(poses.slice(-10)) < 0.001;
  console.log(`5) 断时钟（运行中）：clockLinked=${holder.h?.clockLinked}，冻结=${frozenOk}${diedOk && frozenOk ? ' ✓' : ' ✗'}`);
  if (!diedOk || !frozenOk) throw new Error('运行中断时钟未停');
  void clockOn;

  // 6) 恢复发布（基线冻结连续，但断链衰减窗内机器人已本地外推 ~0.7s → 样本相对回跳）
  //    安全断言：跳变必须被拒（fault 上报）且机器人保持冻结——不得盲目跟随跳变时钟
  runClock();
  const clockIv2 = setInterval(() => {
    const tShowUs = clockState.running
      ? clockState.baseUs + (performance.now() - clockState.startMs) * 1000
      : clockState.baseUs;
    conn.publishClock({ tMonotonicUs: performance.now() * 1000, tShowUs, running: clockState.running });
  }, 100);
  const relinked = await waitUntil(() => holder.h?.clockLinked === true, 2500);
  await sleep(800);
  const jumpRejected =
    holder.h?.fault !== null && holder.h?.fault !== undefined && holder.h?.showState === 'held';
  const stayFrozen = spread(poses.slice(-10)) < 0.001;
  console.log(`6) 跳变防护：clockLinked=${relinked}，fault="${holder.h?.fault ?? ''}"，冻结=${stayFrozen}${relinked && jumpRejected && stayFrozen ? ' ✓' : ' ✗'}`);
  clearInterval(clockIv2);
  if (!relinked || !jumpRejected || !stayFrozen) throw new Error('时钟跳变未被正确拒绝');

  // 7) NT stop → 演出结束（showState=stopped），resume 不得复活
  conn.sendCommand({ kind: 'stop' });
  const stoppedOk = await waitUntil(() => holder.h?.showState === 'stopped', 1500);
  const stopIdx = poses.length;
  conn.sendCommand({ kind: 'resume' });
  await sleep(800);
  const stayStopped = spread(poses.slice(stopIdx)) < 0.001;
  console.log(`7) NT stop：showState=${holder.h?.showState}，resume 后不动=${stayStopped}${stoppedOk && stayStopped ? ' ✓' : ' ✗'}`);
  clearInterval(clockIv2);
  if (!stoppedOk || !stayStopped) throw new Error('stop/resume 语义异常');

  // 8) 心跳停止（模拟 multi-DS 崩溃）→ 看门狗兜底
  await ds.stop();
  const dsDied = await waitUntil(() => holder.h?.dsLinked === false, 1500);
  console.log(`8) 心跳停止：dsLinked=${holder.h?.dsLinked}${dsDied ? ' ✓' : ' ✗'}`);
  if (!dsDied) throw new Error('心跳停止后链路未断');

  link.closeAll();
  console.log('probe 通过 ✓');
}

main().catch((err: unknown) => {
  console.error('probe 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});

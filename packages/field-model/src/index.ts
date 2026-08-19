/**
 * field-model —— 舞台与路径的共享数据模型。
 * 画布渲染（Phase 2）、路径编辑器（Phase 3）、仿真（sim/fake-robot）共用。
 * 坐标系与 show-protocol 一致：+x 向右、+y 向观众、原点舞台中心、米/弧度。
 */

export interface StageConfig {
  /** 舞台宽（左右方向），米 */
  widthM: number;
  /** 舞台深（前后/观众方向），米 */
  depthM: number;
}

/** TODO(Phase 0)：用实际舞台测量尺寸替换 */
export const DEFAULT_STAGE: StageConfig = { widthM: 12, depthM: 8 };

export interface RobotFootprint {
  lengthM: number;
  widthM: number;
}

/** TODO(Phase 0)：用实际机器人底盘尺寸替换 */
export const DEFAULT_FOOTPRINT: RobotFootprint = { lengthM: 0.9, widthM: 0.8 };

/**
 * 地理围栏（报告 §六.4 安全体系）：舞台边界内缩机器人外接圆半径。
 * 取外接圆（½·√(长²+宽²)）而非轴对齐内缩——机器人朝向任意，轴对齐假设会把
 * 横行的机器人放出边界（审校 2026-08-18 修正）。robot 端可直接以此为硬边界。
 */
export function stageGeofence(stage: StageConfig, robot: RobotFootprint): StageConfig {
  const radiusM = Math.sqrt(robot.lengthM ** 2 + robot.widthM ** 2) / 2;
  return {
    widthM: stage.widthM - 2 * radiusM,
    depthM: stage.depthM - 2 * radiusM,
  };
}

export interface Waypoint {
  xM: number;
  yM: number;
  headingRad: number;
  /** 到访时刻（演出时钟微秒）——多机时间对齐的锚点 */
  tShowUs: number;
}

export interface RobotShowPath {
  robot: number;
  waypoints: Waypoint[];
}

export interface Show {
  id: string;
  paths: RobotShowPath[];
  /** 演出总时长（微秒）= max(paths 末点时刻) */
  durationShowUs: number;
}

/**
 * 两机路径在全时间轴上的最小间距（米），碰撞预警用。
 * 时间采样 + 分段线性位姿求距离（路径规模小，直接算）。
 */
export function minSeparationM(a: RobotShowPath, b: RobotShowPath): number {
  if (a.waypoints.length === 0 || b.waypoints.length === 0) return Number.POSITIVE_INFINITY;
  const t0 = Math.min(a.waypoints[0]!.tShowUs, b.waypoints[0]!.tShowUs);
  const t1 = Math.max(
    a.waypoints[a.waypoints.length - 1]!.tShowUs,
    b.waypoints[b.waypoints.length - 1]!.tShowUs,
  );
  const STEP_US = 100_000; // 100ms 采样
  let min = Number.POSITIVE_INFINITY;
  for (let t = t0; t <= t1; t += STEP_US) {
    const pa = poseOnPathAt(a, t);
    const pb = poseOnPathAt(b, t);
    if (!pa || !pb) continue;
    min = Math.min(min, Math.hypot(pa.x - pb.x, pa.y - pb.y));
  }
  return min;
}

/**
 * 内置演示演出（sim/预览用，Phase 3 编辑器落地前的占位编排）：
 * 6 台机器人各沿一条正弦"扫场"车道行驶，时长 60s。
 * 无碰撞性：全队同相位同幅值（车道间为纯平移）→ 任意时刻相邻中心距恒等于车道间距；
 * 车道间距 ≥ 机器人倾斜投影宽（0.9·sinθmax + 0.8·cosθmax，θmax≈20.5° ≈ 1.064m），
 * 构建时用 minSeparationM 断言。峰值 |y| = 2.75+0.5 = 3.25 < 围栏 3.398。
 */
export const DEMO_SHOW_ID = 'demo-wave';

/** 全队安全最小间距（米）——演示演出的构建期断言阈值与编辑器/图表的碰撞预警共用 */
export const SAFETY_MIN_SEPARATION_M = 1.05;

export function createDemoShow(teams: number[]): Show {
  const durationS = 60;
  const laneSpacing = 1.1;
  const amplitude = 0.5;
  const cycles = 1; // 全程一个正弦周期：λ=8.4m，最大倾角 ≈20.5°
  const paths: RobotShowPath[] = teams.map((robot, i) => {
    const laneY = (-(teams.length - 1) / 2) * laneSpacing + i * laneSpacing;
    const waypoints: Waypoint[] = [];
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const x = -4.2 + (8.4 * s) / steps;
      const wave = (u: number): number =>
        amplitude * Math.sin((2 * Math.PI * cycles * (u + 4.2)) / 8.4);
      const y = laneY + wave(x);
      // 航向取段方向；末航点取最后一段（避免结尾朝向突跳）
      const prevX = s === 0 ? x : -4.2 + (8.4 * (s - 1)) / steps;
      const prevY = s === 0 ? y : laneY + wave(prevX);
      const headingRad =
        s === 0
          ? Math.atan2(wave(x + 0.35) - wave(x), 0.35)
          : Math.atan2(y - prevY, x - prevX);
      waypoints.push({
        xM: x,
        yM: y,
        headingRad,
        tShowUs: Math.round((s / steps) * durationS * 1e6),
      });
    }
    return { robot, waypoints };
  });
  // 构建期自检：相邻车道最小间距必须 ≥ 底盘倾斜投影宽（1.064m，见头注释；1.05 留工程余量）
  for (let i = 1; i < paths.length; i++) {
    const sep = minSeparationM(paths[i - 1]!, paths[i]!);
    if (sep < SAFETY_MIN_SEPARATION_M) {
      throw new Error(`demo show 车道 ${i - 1}/${i} 最小间距 ${sep.toFixed(3)}m < 1.05m（碰撞）`);
    }
  }
  return { id: DEMO_SHOW_ID, paths, durationShowUs: durationS * 1e6 };
}

/** 路径上某演出时刻的位姿（分段线性插值；航向取段方向）。
 *  首个航点前 → 起点静止；末个航点后 → 末点静止。空路径返回 null。 */
export function poseOnPathAt(path: RobotShowPath, tShowUs: number): { x: number; y: number; heading: number } | null {
  const wps = path.waypoints;
  if (wps.length === 0) return null;
  if (wps.length === 1 || tShowUs <= wps[0]!.tShowUs) {
    const a = wps[0]!;
    return { x: a.xM, y: a.yM, heading: a.headingRad };
  }
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1]!;
    const b = wps[i]!;
    if (tShowUs < b.tShowUs) {
      const span = b.tShowUs - a.tShowUs;
      const f = span > 0 ? (tShowUs - a.tShowUs) / span : 1;
      return {
        x: a.xM + (b.xM - a.xM) * f,
        y: a.yM + (b.yM - a.yM) * f,
        heading: Math.atan2(b.yM - a.yM, b.xM - a.xM),
      };
    }
  }
  const last = wps[wps.length - 1]!;
  return { x: last.xM, y: last.yM, heading: last.headingRad };
}


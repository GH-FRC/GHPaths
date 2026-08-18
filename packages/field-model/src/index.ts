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
 * TODO(Phase 3)：实现（分段线性 + 时间采样即可，规模很小）。
 */
export function minSeparationM(_a: RobotShowPath, _b: RobotShowPath): number {
  throw new Error('TODO(Phase 3): 碰撞检测');
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

/**
 * 内置演示演出（sim/预览用，Phase 3 编辑器落地前的占位编排）：
 * 6 台机器人各沿一条"波浪扫场"车道行驶（y 车道互不重叠，天然无碰撞），时长 60s。
 */
export function createDemoShow(teams: number[]): Show {
  const durationS = 60;
  const paths: RobotShowPath[] = teams.map((robot, i) => {
    const laneY = -2.4 + i * 0.96; // 车道间距恒定 > 底盘宽；全队 x 进度同步 → 横向间距恒定，无碰撞
    const amplitude = 0.6 + (i % 2) * 0.2; // 峰值 |y| ≤ 3.2 < 围栏 3.4
    const phase = (i * Math.PI) / 3;
    const waypoints: Waypoint[] = [];
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const tS = (s / steps) * durationS;
      const x = -4.2 + (8.4 * s) / steps;
      const y = laneY + amplitude * Math.sin((s / steps) * Math.PI * 2 * 1.5 + phase);
      const nextS = (Math.min(s + 1, steps) / steps) * durationS;
      const nextX = -4.2 + (8.4 * Math.min(s + 1, steps)) / steps;
      const nextY =
        laneY + amplitude * Math.sin((Math.min(s + 1, steps) / steps) * Math.PI * 2 * 1.5 + phase);
      waypoints.push({
        xM: x,
        yM: y,
        headingRad: s === steps ? Math.atan2(nextY - y, Math.max(nextX - x, 0.001)) : Math.atan2(nextY - y, nextX - x),
        tShowUs: Math.round(tS * 1e6),
      });
    }
    return { robot, waypoints };
  });
  return { id: 'demo-wave', paths, durationShowUs: durationS * 1e6 };
}

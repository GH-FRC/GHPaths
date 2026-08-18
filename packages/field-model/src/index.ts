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

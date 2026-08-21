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

/** 位姿快照的全对最小间距（米）——实时遥测与回放统计共用。
 *  positions: 机器人 → 世界坐标 {x, y};返回最小中心距,单机/空返回 ∞。 */
export function minSeparationFromPositions(
  positions: Map<number, { x: number; y: number }>,
): number {
  const teams = [...positions.keys()];
  if (teams.length < 2) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = positions.get(teams[i]!)!;
      const b = positions.get(teams[j]!)!;
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return min;
}

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

/* ============================================================
 * FieldMap —— 场地地图（ADR-0008 §8.8）
 * 赛季场地随版本内置 + 用户导入;AprilTag 布局兼容 WPILib/PhotonVision
 * 官方 AprilTagFieldLayout JSON 格式（导入导出双向）;演出环境假设离线。
 * 坐标系与本包一致（原点场地中心,+x 右,+y 观众方,米）;
 * WPILib 布局原点在场地角——转换在 parse/export 两个边界完成。
 * ============================================================ */

/** AprilTag 位姿（世界坐标;quaternion 为 WPILib 布局的 X/Y/Z/W 四元数） */
export interface FieldTag {
  id: number;
  family?: string;
  /** 标签边长（米） */
  sizeM?: number;
  xM: number;
  yM: number;
  zM?: number;
  quat?: [number, number, number, number];
  /** 由四元数派生的偏航（弧度,标签面朝向;2D 渲染用,parse 时填） */
  yawRad?: number;
}

/** 像素↔世界标定点（底图像素坐标 → 世界米坐标;≥2 点即定仿射,
 *  AS 式角点标定的最小形式。空 = 整幅底图满铺场地矩形） */
export interface CalibrationPoint {
  px: number;
  py: number;
  xM: number;
  yM: number;
}

export interface FieldMapImage {
  /** 底图 URL（data: 或打包资产路径） */
  url: string;
  widthPx: number;
  heightPx: number;
  calibration?: CalibrationPoint[];
}

export interface FieldMap {
  id: string;
  name: string;
  /** 场地尺寸（米）——世界坐标范围 ±size/2 */
  sizeM: { widthM: number; depthM: number };
  image?: FieldMapImage;
  tags: FieldTag[];
  /** 围栏覆盖（缺省 = stageGeofence(sizeM, DEFAULT_FOOTPRINT)） */
  geofence?: StageConfig;
}

/** 内置默认舞台模板（纯矢量,无底图无标签）——12×8m,见 DEFAULT_STAGE */
export const DEFAULT_FIELD_MAP: FieldMap = {
  id: 'default-stage',
  name: '默认舞台 12×8m',
  sizeM: { widthM: DEFAULT_STAGE.widthM, depthM: DEFAULT_STAGE.depthM },
  tags: [],
};

/** 四元数（X,Y,Z,W）→ 偏航角（弧度,ZYX 欧拉的 yaw;标签面朝向的水平投影）。
 *  yaw = atan2(2(xy+wz), 1−2(y²+z²))——旋转矩阵 R10/R00 之比（2026-08-21 单元检查纠错:
 *  旧式分子写反,纯 Z 轴 90° 旋转会误报 0） */
export function yawFromQuat(x: number, y: number, z: number, w: number): number {
  return Math.atan2(2 * (x * y + w * z), 1 - 2 * (y * y + z * z));
}

/**
 * 解析 WPILib AprilTagFieldLayout 官方 JSON（PhotonVision 同格式）为 FieldMap。
 * 布局原点在场地一角（+x 沿 length,+y 沿 width）→ 平移到中心原点。
 * 已有地图时可传 base 保留其底图/尺寸（只换标签）。
 */
export function parseAprilTagLayout(json: string, base?: FieldMap): FieldMap {
  const raw = JSON.parse(json) as {
    field?: { length?: number; width?: number };
    tags?: Array<{
      ID?: number;
      family?: string;
      size?: number;
      pose?: {
        translation?: { x?: number; y?: number; z?: number };
        rotation?: { quaternion?: { X?: number; Y?: number; Z?: number; W?: number } };
      };
    }>;
  };
  const fieldL = raw.field?.length ?? 0;
  const fieldW = raw.field?.width ?? 0;
  if (fieldL <= 0 || fieldW <= 0 || !Array.isArray(raw.tags)) {
    throw new Error('字段缺失：需要 field.length/field.width 与 tags 数组（WPILib AprilTagFieldLayout 格式）');
  }
  const tags: FieldTag[] = raw.tags.map((t) => {
    if (typeof t.ID !== 'number') throw new Error(`标签缺 ID：${JSON.stringify(t).slice(0, 60)}`);
    const q = t.pose?.rotation?.quaternion;
    const x = t.pose?.translation?.x ?? 0;
    const y = t.pose?.translation?.y ?? 0;
    const quat: [number, number, number, number] | undefined = q
      ? [q.X ?? 0, q.Y ?? 0, q.Z ?? 0, q.W ?? 1]
      : undefined;
    return {
      id: t.ID,
      family: t.family,
      sizeM: t.size,
      xM: x - fieldL / 2,
      yM: y - fieldW / 2,
      zM: t.pose?.translation?.z,
      quat,
      yawRad: quat ? yawFromQuat(quat[0], quat[1], quat[2], quat[3]) : undefined,
    };
  });
  if (tags.length === 0) throw new Error('tags 为空');
  return {
    id: base?.id ?? `apriltags-${tags.length}`,
    name: base?.name ?? `AprilTag 场地（${tags.length} 标签）`,
    sizeM: base?.sizeM ?? { widthM: fieldL, depthM: fieldW },
    image: base?.image,
    tags,
    geofence: base?.geofence,
  };
}

/** FieldMap.tags → WPILib AprilTagFieldLayout JSON（中心原点 → 场地角原点）。
 *  AprilTag 单一事实来源（ADR-0008）：演控端一份布局,导出给机器人侧 PhotonVision。 */
export function exportAprilTagLayout(map: FieldMap): string {
  const { widthM: L, depthM: W } = map.sizeM;
  const layout = {
    field: { length: L, width: W },
    tags: map.tags.map((t) => ({
      ID: t.id,
      ...(t.family ? { family: t.family } : {}),
      ...(t.sizeM ? { size: t.sizeM } : {}),
      pose: {
        translation: { x: t.xM + L / 2, y: t.yM + W / 2, z: t.zM ?? 0 },
        rotation: { quaternion: { X: t.quat?.[0] ?? 0, Y: t.quat?.[1] ?? 0, Z: t.quat?.[2] ?? 0, W: t.quat?.[3] ?? 1 } },
      },
    })),
  };
  return JSON.stringify(layout, null, 2);
}

/** 底图像素 → 世界坐标（有标定用标定仿射;无标定按满铺场地矩形）。
 *  标定 ≥2 点取两轴线性映射（轴对齐场地图的常规情形）;不足退满铺。 */
export function pixelToWorld(image: FieldMapImage, sizeM: { widthM: number; depthM: number }, px: number, py: number): { xM: number; yM: number } {
  const cal = image.calibration;
  if (cal && cal.length >= 2) {
    const [a, b] = [cal[0]!, cal[1]!];
    const fx = (b.px - a.px) / (b.xM - a.xM || 1);
    const fy = (b.py - a.py) / (b.yM - a.yM || 1);
    return { xM: a.xM + (px - a.px) / (fx || 1), yM: a.yM + (py - a.py) / (fy || 1) };
  }
  return {
    xM: (px / image.widthPx - 0.5) * sizeM.widthM,
    yM: (0.5 - py / image.heightPx) * sizeM.depthM,
  };
}

/** 校验 FieldMap（导入边界;返回错误文案,null = 通过） */
export function validateFieldMap(map: FieldMap): string | null {
  if (!map.id || !map.name) return 'id/name 不能为空';
  if (!(map.sizeM.widthM > 0.5 && map.sizeM.widthM < 100)) return `场地宽 ${map.sizeM.widthM}m 不在 0.5~100m 范围`;
  if (!(map.sizeM.depthM > 0.5 && map.sizeM.depthM < 100)) return `场地深 ${map.sizeM.depthM}m 不在 0.5~100m 范围`;
  const ids = new Set<number>();
  for (const t of map.tags) {
    if (ids.has(t.id)) return `标签 ID ${t.id} 重复`;
    ids.add(t.id);
    if (Math.abs(t.xM) > map.sizeM.widthM / 2 + 1 || Math.abs(t.yM) > map.sizeM.depthM / 2 + 1) {
      return `标签 ${t.id} 坐标 (${t.xM.toFixed(1)},${t.yM.toFixed(1)}) 超出场地 +1m 余量`;
    }
  }
  if (map.image && (!map.image.widthPx || !map.image.heightPx)) return '底图缺像素尺寸';
  return null;
}


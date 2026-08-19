/**
 * Stage3D —— 3D 全场监控视图（ADR-0006 优先级二;Phase 3 模型管线的第一步）。
 *
 * 几何体占位（ADR-0006：低模起步,Phase 3 后接 .glb 模型管线与 CAD→Blender 流程）：
 *  - 舞台 = 地板平面 + 半透明边界墙;围栏虚线不进 3D（2D 画布职责）
 *  - 机器人 = 盒子 + 车头方向楔形标记,按各自机器人色着色
 *  - 轨迹尾巴 = 每机最近 3s 的线段（透明渐隐）
 *
 * 坐标系：field-model 世界坐标（+x 右/+y 向观众/原点舞台中心）→ three.js
 * x→x、y→z（three 的 z 朝观众,一致性靠 mirror 不需要——直接映射即可）。
 * 相机：透视,固定俯瞰角,OrbitControls 待后续（先免依赖,静态视角够监控用）。
 */
import { Canvas } from '@react-three/fiber';
import { DEFAULT_FOOTPRINT, DEFAULT_STAGE, stageGeofence } from '@ghpaths/field-model';
import type { RobotId } from '@ghpaths/show-protocol';

export interface Robot3DData {
  robot: RobotId;
  xM: number;
  yM: number;
  headingRad: number;
  trail: Array<{ x: number; y: number }>;
}

const ROBOT_COLORS = ['#ff7b72', '#ffa657', '#f2cc60', '#7ee787', '#79c0ff', '#d2a8ff'] as const;

function RobotBox({ data, index }: { data: Robot3DData; index: number }): JSX.Element {
  const color = ROBOT_COLORS[index % ROBOT_COLORS.length] ?? '#79c0ff';
  // three.js 坐标：世界 x → three x,世界 y → three z,heading 绕 three y 轴
  // world heading 0 = +x 方向,逆时针为正 → three rotationY = -heading（three 的 y 旋转顺时针为正）
  const rotY = -data.headingRad;

  return (
    <group position={[data.xM, DEFAULT_FOOTPRINT.lengthM / 2, data.yM]} rotation={[0, rotY, 0]}>
      {/* 车体（盒子;几何占位,Phase 3 换 .glb） */}
      <mesh castShadow>
        <boxGeometry args={[DEFAULT_FOOTPRINT.lengthM, DEFAULT_FOOTPRINT.lengthM, DEFAULT_FOOTPRINT.widthM]} />
        <meshStandardMaterial color={color} opacity={0.85} transparent />
      </mesh>
      {/* 车头方向标记（楔形;+x 端） */}
      <mesh position={[DEFAULT_FOOTPRINT.lengthM / 2 + 0.08, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.06, 0.18, 4]} />
        <meshStandardMaterial color="#e8e8ea" />
      </mesh>
    </group>
  );
}

function TrailLine({ points, color }: { points: Array<{ x: number; y: number }>; color: string }): JSX.Element | null {
  if (points.length < 2) return null;
  const verts = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    verts[i * 3] = p.x;
    verts[i * 3 + 1] = 0.02;
    verts[i * 3 + 2] = p.y;
  });
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[verts, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} transparent opacity={0.4} />
    </line>
  );
}

export function Stage3D({ robots }: { robots: Robot3DData[] }): JSX.Element {
  const { widthM: w, depthM: d } = DEFAULT_STAGE;
  const fence = stageGeofence(DEFAULT_STAGE, DEFAULT_FOOTPRINT);

  return (
    <div className="stage3d-wrap">
      <Canvas
        camera={{ position: [0, 12, d * 0.9], fov: 50, near: 0.1, far: 100 }}
        shadows
        className="stage3d"
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 15, 5]} castShadow intensity={0.8} />
        {/* 舞台地板 */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color="#1a2129" />
        </mesh>
        {/* 边界墙（半透明,舞台轮廓） */}
        <mesh position={[0, 0.5, d / 2]}>
          <planeGeometry args={[w, 1]} />
          <meshStandardMaterial color="#2f81f7" transparent opacity={0.15} side={2} />
        </mesh>
        <mesh position={[0, 0.5, -d / 2]}>
          <planeGeometry args={[w, 1]} />
          <meshStandardMaterial color="#2f81f7" transparent opacity={0.15} side={2} />
        </mesh>
        <mesh position={[w / 2, 0.5, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[d, 1]} />
          <meshStandardMaterial color="#2f81f7" transparent opacity={0.15} side={2} />
        </mesh>
        <mesh position={[-w / 2, 0.5, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[d, 1]} />
          <meshStandardMaterial color="#2f81f7" transparent opacity={0.15} side={2} />
        </mesh>
        {/* 网格线（舞台参考格,1m 间隔） */}
        <gridHelper args={[Math.max(w, d), Math.max(w, d), '#232932', '#1c2128']} position={[0, 0.01, 0]} />
        {/* 机器人 + 轨迹 */}
        {robots.map((r, i) => (
          <group key={r.robot}>
            <RobotBox data={r} index={i} />
            <TrailLine points={r.trail} color={ROBOT_COLORS[i % ROBOT_COLORS.length] ?? '#79c0ff'} />
          </group>
        ))}
      </Canvas>
    </div>
  );
}

import { DEFAULT_FOOTPRINT, DEFAULT_STAGE } from '@ghpaths/field-model';

const ROBOTS = [9001, 9002, 9003, 9004, 9005, 9006] as const;

/**
 * Phase 2 之前的占位界面：验证 workspace 依赖链路与舞台坐标渲染。
 * 注意：SVG 显示层 y 轴向下；世界坐标 +y 向观众的翻转由 Phase 2 的画布层统一处理。
 */
export function App() {
  const { widthM: w, depthM: d } = DEFAULT_STAGE;
  return (
    <main className="app">
      <header>
        <h1>GHPaths 演控台</h1>
        <span className="badge">Phase 0 · 脚手架</span>
      </header>
      <section className="stage-wrap">
        <svg viewBox={`${-w / 2} ${-d / 2} ${w} ${d}`} className="stage">
          <rect x={-w / 2} y={-d / 2} width={w} height={d} className="stage-border" />
          {ROBOTS.map((robot, i) => {
            const x = -w / 2 + (w / (ROBOTS.length + 1)) * (i + 1);
            const y = d / 2 - 0.8;
            return (
              <g key={robot} transform={`translate(${x} ${y})`}>
                <rect
                  x={-DEFAULT_FOOTPRINT.widthM / 2}
                  y={-DEFAULT_FOOTPRINT.lengthM / 2}
                  width={DEFAULT_FOOTPRINT.widthM}
                  height={DEFAULT_FOOTPRINT.lengthM}
                  className={`robot robot-${i + 1}`}
                  rx={0.05}
                />
                <text y={DEFAULT_FOOTPRINT.lengthM / 2 + 0.45} textAnchor="middle" className="robot-label">
                  {robot}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="hint">
          占位画布：世界坐标 +x 向右、+y 向观众、原点舞台中心（与 field-model 一致）。
          实时位姿叠加将在 Phase 2 经 nt-link 接入；一键启停经 multi-DS 控制 API（5899）。
        </p>
      </section>
    </main>
  );
}

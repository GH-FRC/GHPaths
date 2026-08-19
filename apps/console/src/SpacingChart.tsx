/**
 * SpacingChart —— 最小机间距实时曲线（单序列 + 安全阈值线）。
 *
 * 形态依据（dataviz 规程）：数据职责 = 「是否有任一对低于安全间距」→ emphasis 单线,
 * 不用分类色板（验证器确认 6 色机器人板相邻 CVD 分离不足,单线回避该问题）。
 * 线 2px;网格隐性（#232932）;悬停十字线+浮签（命中区宽 16px > 线宽）;
 * 阈值线为状态色（serious）虚线 + 直接标注——状态色不承担序列身份。
 * 文本用文本色,不用序列色。
 */
import { useRef, useState } from 'react';
import type { TelemetryPoint } from './useTelemetry';

const W = 100; // viewBox 宽（%拉伸）——非等比 SVG 用 preserveAspectRatio="none" 的坑:文字会变形。
// 故采用固定 viewBox 并整宽渲染,文本不变形。
const H = 120;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 18;

export function SpacingChart({
  data,
  thresholdM,
  windowMs,
}: {
  data: TelemetryPoint[];
  thresholdM: number;
  windowMs: number;
}): JSX.Element {
  const [hover, setHover] = useState<{ x: number; point: TelemetryPoint } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const now = data.length > 0 ? data[data.length - 1]!.tMs : performance.now();
  const t0 = now - windowMs;
  const inWindow = data.filter((p) => p.tMs >= t0);
  const maxV = Math.max(thresholdM * 1.6, ...inWindow.map((p) => p.v), 1);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const xOf = (tMs: number): number => PAD_L + ((tMs - t0) / windowMs) * plotW;
  const yOf = (v: number): number => PAD_T + (1 - v / maxV) * plotH;

  const path =
    inWindow.length > 1
      ? inWindow.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.tMs).toFixed(2)},${yOf(p.v).toFixed(2)}`).join(' ')
      : '';

  const last = inWindow[inWindow.length - 1];
  const gridYs = [0, 0.5, 1].map((f) => ({ y: PAD_T + f * plotH, label: (maxV * (1 - f)).toFixed(1) }));

  const onMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const svg = svgRef.current;
    if (!svg || inWindow.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    // 最近样本（命中区由 pointermove 全图覆盖,不要求精确在线上）
    let nearest: TelemetryPoint | null = null;
    let bestDx = Number.POSITIVE_INFINITY;
    for (const p of inWindow) {
      const dx = Math.abs(xOf(p.tMs) - px);
      if (dx < bestDx) {
        bestDx = dx;
        nearest = p;
      }
    }
    if (nearest) setHover({ x: xOf(nearest.tMs), point: nearest });
  };

  return (
    <div className="chart-card">
      <div className="chart-title">最小机间距 <span className="chart-sub">m · 近 60s</span></div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* 网格（隐性）+ 轴标 */}
        {gridYs.map((g) => (
          <g key={g.y}>
            <line x1={PAD_L} x2={W - PAD_R} y1={g.y} y2={g.y} className="chart-grid" />
            <text x={PAD_L - 4} y={g.y + 3} textAnchor="end" className="chart-axis-text">
              {g.label}
            </text>
          </g>
        ))}
        {/* 安全阈值线（状态色,虚线,直接标注——文本用文本色） */}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={yOf(thresholdM)}
          y2={yOf(thresholdM)}
          className="chart-threshold"
        />
        <text x={W - PAD_R - 2} y={yOf(thresholdM) - 3} textAnchor="end" className="chart-threshold-text">
          安全阈值 {thresholdM.toFixed(2)}m
        </text>
        {/* 数据线（2px,强调蓝） */}
        {path && <path d={path} className="chart-line" fill="none" />}
        {/* 末端直接标注（最新值;文本色而非线色） */}
        {last && (
          <g>
            <circle cx={xOf(last.tMs)} cy={yOf(last.v)} r={1.6} className="chart-line-dot" />
            <text x={Math.min(xOf(last.tMs) + 3, W - PAD_R - 20)} y={yOf(last.v) - 4} className="chart-last-text">
              {last.v.toFixed(2)}
            </text>
          </g>
        )}
        {/* 十字线 + 浮签 */}
        {hover && inWindow.length > 0 && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={PAD_T} y2={H - PAD_B} className="chart-crosshair" />
            <circle cx={hover.x} cy={yOf(hover.point.v)} r={1.8} className="chart-line-dot" />
            <g
              transform={`translate(${Math.min(hover.x + 4, W - 40)}, ${Math.max(yOf(hover.point.v) - 12, PAD_T)})`}
            >
              <rect width={34} height={16} rx={3} className="chart-tip-bg" />
              <text x={17} y={11} textAnchor="middle" className="chart-tip-text">
                {hover.point.v.toFixed(2)}m
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

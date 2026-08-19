/**
 * TimelineBar —— 编辑器时间轴：选中机器人的航点时间分布可视化与微调。
 *
 * 形态：水平条带（时间→x 轴）;每航点一个可拖拽的标记（菱形）;端点固定不可拖。
 * 拖动改变航点的 tShowUs（钳制在前后航点之间——时间单调性不可破坏）。
 * 值：编辑时间（μs）;显示格式 mm:ss.s。
 */
import { useRef, useState } from 'react';
import type { RobotId } from '@ghpaths/show-protocol';
import type { PathEditor } from './usePathEditor';

export function TimelineBar({ editor }: { editor: PathEditor }): JSX.Element | null {
  const path = editor.show.paths.find((p) => p.robot === editor.selectedRobot);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragWp, setDragWp] = useState<number | null>(null);

  if (!path || path.waypoints.length < 2) return null;

  const durationUs = path.waypoints[path.waypoints.length - 1]!.tShowUs || 1;
  const W = 100;
  const H = 36;
  const BAR_Y = 18;
  const xOf = (tUs: number): number => (tUs / durationUs) * W;

  const toTime = (e: React.PointerEvent): number => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return Math.round(frac * durationUs);
  };

  const onMove = (e: React.PointerEvent): void => {
    if (dragWp === null) return;
    const t = toTime(e);
    // 钳制在前后航点之间（时间单调性）
    const prev = path.waypoints[dragWp - 1]?.tShowUs ?? 0;
    const next = path.waypoints[dragWp + 1]?.tShowUs ?? durationUs;
    const clamped = Math.max(prev + 1000, Math.min(next - 1000, t)); // ≥1ms 间隔
    editor.updateWaypointTime(editor.selectedRobot, dragWp, clamped);
  };

  return (
    <div className="timeline-bar">
      <span className="timeline-label">{editor.selectedRobot}</span>
      {editor.violations.length > 0 && (
        <span className="timeline-alert">⚠ {editor.violations.length} 对</span>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="timeline-svg"
        onPointerMove={onMove}
        onPointerUp={() => setDragWp(null)}
        onPointerLeave={() => setDragWp(null)}
      >
        {/* 基线 */}
        <line x1={0} x2={W} y1={BAR_Y} y2={BAR_Y} className="timeline-track" />
        {/* 航点标记 */}
        {path.waypoints.map((wp, i) => {
          const isTerminal = i === 0 || i === path.waypoints.length - 1;
          const x = xOf(wp.tShowUs);
          return (
            <g key={i}>
              <rect
                x={x - 0.6}
                y={BAR_Y - 3}
                width={1.2}
                height={6}
                className={isTerminal ? 'timeline-wp-terminal' : editor.selectedWaypoint === i ? 'timeline-wp-selected' : 'timeline-wp'}
                transform={`rotate(45 ${x} ${BAR_Y})`}
                onPointerDown={(e) => {
                  if (isTerminal) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragWp(i);
                  editor.selectWaypoint(i);
                }}
                style={{ cursor: isTerminal ? 'default' : 'ew-resize' }}
              >
                <title>
                  {`${(wp.tShowUs / 1e6).toFixed(2)}s · (${wp.xM.toFixed(2)}, ${wp.yM.toFixed(2)})`}
                </title>
              </rect>
            </g>
          );
        })}
        {/* 时间刻度 */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text key={f} x={f * W} y={H - 2} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="timeline-tick">
            {f === 0 ? '0s' : f === 1 ? `${(durationUs / 1e6).toFixed(0)}s` : `${(f * durationUs / 1e6).toFixed(0)}s`}
          </text>
        ))}
      </svg>
    </div>
  );
}

/**
 * EditorCanvas —— 路径编辑画布（Phase 3 第一块）。
 *
 * 交互：
 *  - 点击航点选中（白描边放大）;拖动移动（pointer capture,画布坐标→世界坐标）
 *  - 段中点显示插入预览点（+）,点击插入
 *  - Delete/Backspace 删除选中航点（首尾航点不可删——路径端点固定）
 *  - 选中机器人 = 当前编辑层;其余图层淡化但可见（全局上下文）
 *  - 碰撞违规对:违规路径段标红(状态色只承担告警语义)
 *
 * 世界→屏幕:y 翻转与 App 画布同约定;米单位,viewBox 与舞台同尺寸。
 */
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FOOTPRINT, DEFAULT_FIELD_MAP, stageGeofence, type FieldMap, type Show, type Waypoint } from '@ghpaths/field-model';
import type { RobotId } from '@ghpaths/show-protocol';
import type { PathEditor } from './usePathEditor';
import { useI18n } from './i18n';
import { FieldBackdrop } from './FieldBackdrop';

const RAD2DEG = 180 / Math.PI;

const INSERT_HIT_R = 0.28; // 插入预览点命中半径（米）

export function EditorCanvas({
  editor,
  running,
  map,
}: {
  editor: PathEditor;
  running: boolean;
  /** 场地地图（ADR-0008 §8.8）——画布尺寸与底图来自当前地图;缺省内置舞台 */
  map?: FieldMap;
}): JSX.Element {
  const { S } = useI18n();
  const fieldMap = map ?? DEFAULT_FIELD_MAP;
  const { widthM: w, depthM: d } = fieldMap.sizeM;
  const fence = fieldMap.geofence ?? stageGeofence(fieldMap.sizeM, DEFAULT_FOOTPRINT);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverSeg, setHoverSeg] = useState<number | null>(null);

  const selectedPath = editor.show.paths.find((p) => p.robot === editor.selectedRobot);
  const violatingRobots = new Set(
    editor.violations.flatMap((v) => [v.a, v.b]),
  );

  const toWorld = (e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    // viewBox 含画布边距（-w/2 … w/2 + 上下 0.6 余量,与 App 同式）
    const padY = 0.6;
    const x = ((e.clientX - rect.left) / rect.width) * w - w / 2;
    const y = d / 2 + padY - ((e.clientY - rect.top) / rect.height) * (d + padY * 2);
    return { x, y };
  };

  // 键盘删除
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selectedWaypoint !== null) {
        const idx = editor.selectedWaypoint;
        if (idx > 0 && idx < (selectedPath?.waypoints.length ?? 0) - 1) {
          editor.deleteWaypoint(idx);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, selectedPath]);

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!dragging) return;
    const { x, y } = toWorld(e);
    editor.moveWaypoint(x, Math.max(-fence.depthM / 2, Math.min(fence.depthM / 2, y)));
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`${-w / 2} ${-d / 2 - 0.6} ${w} ${d + 1.2}`}
      className="stage"
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(false)}
      onPointerLeave={() => setDragging(false)}
    >
      {/* 场地底图 + AprilTag（编辑器与主画布同一地图,单一来源） */}
      <FieldBackdrop map={fieldMap} />
      <rect x={-w / 2} y={-d / 2} width={w} height={d} className="stage-border" />
      <rect
        x={-fence.widthM / 2}
        y={-fence.depthM / 2}
        width={fence.widthM}
        height={fence.depthM}
        className="geofence"
      />

      {/* 各机器人路径层 */}
      {editor.show.paths.map((path) => {
        const isSel = path.robot === editor.selectedRobot;
        const isViolating = violatingRobots.has(path.robot);
        const idx = editor.show.paths.indexOf(path);
        return (
          <g key={path.robot} className={isSel ? '' : 'editor-layer-dim'}>
            <polyline
              points={path.waypoints.map((wp) => `${wp.xM},${-wp.yM}`).join(' ')}
              className={`path-preview ${isViolating ? 'editor-path-violating' : 'robot-path-' + ((idx % 6) + 1)}`}
            />
            {/* 命中线（加宽命中区,不可见） */}
            {isSel && (
              <polyline
                points={path.waypoints.map((wp) => `${wp.xM},${-wp.yM}`).join(' ')}
                className="editor-hit-line"
                fill="none"
                onPointerEnter={() => setHoverSeg(0)}
                onPointerLeave={() => setHoverSeg(null)}
              />
            )}
            {/* 航点（选中层可交互;端点方形=固定,中间圆形可拖） */}
            {path.waypoints.map((wp, i) => {
              const isTerminal = i === 0 || i === path.waypoints.length - 1;
              const isSelected = isSel && editor.selectedWaypoint === i;
              if (isSel) {
                return (
                  <g key={i}>
                    {isSelected && (
                      <circle cx={wp.xM} cy={-wp.yM} r={0.22} className="editor-wp-selected-ring" />
                    )}
                    {isTerminal ? (
                      <rect
                        x={wp.xM - 0.1}
                        y={-wp.yM - 0.1}
                        width={0.2}
                        height={0.2}
                        className="editor-wp-terminal"
                      />
                    ) : (
                      <circle
                        cx={wp.xM}
                        cy={-wp.yM}
                        r={0.13}
                        className={`editor-wp ${isSelected ? 'editor-wp-selected' : `robot-wp-${(idx % 6) + 1}`}`}
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setDragging(true);
                          editor.selectWaypoint(i);
                        }}
                        style={{ cursor: 'grab' }}
                      />
                    )}
                  </g>
                );
              }
              return (
                <circle
                  key={i}
                  cx={wp.xM}
                  cy={-wp.yM}
                  r={0.07}
                  className="editor-wp-bg"
                />
              );
            })}
            {/* 段中点插入预览（仅选中层;hover 段时显示） */}
            {isSel && hoverSeg !== null &&
              path.waypoints.slice(0, -1).map((a, i) => {
                const b = path.waypoints[i + 1]!;
                return (
                  <circle
                    key={`ins-${i}`}
                    cx={(a.xM + b.xM) / 2}
                    cy={-(a.yM + b.yM) / 2}
                    r={INSERT_HIT_R}
                    className="editor-insert-hint"
                    onClick={() => editor.insertWaypoint(i)}
                  >
                    <title>{S.edInsertWaypoint}</title>
                  </circle>
                );
              })}
          </g>
        );
      })}

      {running && <EditorFooter text={S.edShowRunning} depthM={d} />}
    </svg>
  );
}

function EditorFooter({ text, depthM }: { text: string; depthM: number }): JSX.Element {
  return (
    <text x={0} y={-depthM / 2 - 0.2} textAnchor="middle" className="editor-banner">
      {text}
    </text>
  );
}

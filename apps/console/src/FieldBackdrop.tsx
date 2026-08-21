/**
 * FieldBackdrop —— 场地地图 SVG 底层（ADR-0008 §8.8）：底图 + AprilTag 标记。
 * App 画布与 EditorCanvas 共用;世界坐标 y 向上,SVG y 向下 → 渲染时翻转。
 * 只负责"场地长什么样",不承担路径/机器人层。
 */
import type { FieldMap } from '@ghpaths/field-model';
import { imageWorldRect } from './useFieldMap';

/** 底图 + 标签层（无底图时只画标签;都没有 → 不渲染,舞台矢量边框兜底） */
export function FieldBackdrop({ map }: { map: FieldMap }): JSX.Element | null {
  const rect = imageWorldRect(map);
  if (!rect && map.tags.length === 0) return null;
  return (
    <g className="field-backdrop" aria-hidden="true">
      {rect && (
        <image
          href={map.image!.url}
          x={rect.xM}
          y={-(rect.yM + rect.heightM)}
          width={rect.widthM}
          height={rect.heightM}
          preserveAspectRatio="none"
          className="field-image"
        />
      )}
      {map.tags.map((t) => (
        <g key={t.id} transform={`translate(${t.xM} ${-t.yM})`} className="field-tag">
          {/* 标签面朝向短线（yaw;有四元数才有） */}
          {t.yawRad != null && (
            <line
              x1={0} y1={0}
              x2={Math.cos(-t.yawRad) * 0.45} y2={Math.sin(-t.yawRad) * 0.45}
              className="field-tag-facing"
            />
          )}
          <rect x={-0.15} y={-0.15} width={0.3} height={0.3} className="field-tag-box" />
          <text x={0} y={0.55} textAnchor="middle" className="field-tag-label">{t.id}</text>
        </g>
      ))}
    </g>
  );
}

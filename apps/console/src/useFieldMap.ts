/**
 * useFieldMap —— 场地地图状态（ADR-0008 §8.8）。
 *  - 默认内置舞台模板（DEFAULT_FIELD_MAP,纯矢量）
 *  - 用户导入：GHPaths 场地包 JSON（单文件,底图 data URL 内嵌）/
 *    WPILib AprilTagFieldLayout JSON（官方格式,PhotonVision 同款）/
 *    PNG 底图（配尺寸输入;满铺标定,精细角点标定 Phase 3）
 *  - 持久化 localStorage（底图 data URL 体积大,配额溢出时退内存并提示）
 *  - 导出 AprilTag 布局（WPILib 格式）——单一事实来源给机器人侧
 */
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_FIELD_MAP, exportAprilTagLayout, parseAprilTagLayout, validateFieldMap,
  type FieldMap,
} from '@ghpaths/field-model';
import { BUILTIN_FIELDS } from './fields/builtin-fields';

export { BUILTIN_FIELDS };

const STORAGE_KEY = 'ghpaths.fieldmap';

/** GHPaths 场地包 JSON（导入格式;与 FieldMap 同构,image.url 为 data URL） */
function isPackageFormat(v: unknown): v is FieldMap {
  return (
    typeof v === 'object' && v !== null &&
    'sizeM' in v && 'tags' in v && 'id' in v && 'name' in v
  );
}

function loadStored(): FieldMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FIELD_MAP;
    const v = JSON.parse(raw) as unknown;
    if (!isPackageFormat(v)) return DEFAULT_FIELD_MAP;
    return validateFieldMap(v) ? DEFAULT_FIELD_MAP : v;
  } catch {
    return DEFAULT_FIELD_MAP;
  }
}

export interface FieldMapApi {
  map: FieldMap;
  /** 导入 GHPaths 场地包或 WPILib AprilTag 布局（按内容嗅探）;返回错误文案或 null */
  importJson: (text: string) => string | null;
  /** 导入 PNG 底图（满铺标定;尺寸米由调用方收集） */
  importPng: (dataUrl: string, widthPx: number, heightPx: number, widthM: number, depthM: number) => string | null;
  /** 导出 AprilTag 布局（WPILib 官方格式;无标签返回 null） */
  exportTags: () => string | null;
  /** 应用内置场地（赛季场地清单;浅拷贝入 state） */
  applyBuiltin: (map: FieldMap) => void;
  reset: () => void;
  /** 持久化失败（配额）提示;ack 后清 */
  storeWarning: string | null;
  clearStoreWarning: () => void;
}

export function useFieldMap(): FieldMapApi {
  const [map, setMap] = useState<FieldMap>(loadStored);
  const [storeWarning, setStoreWarning] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      setStoreWarning('场地未持久化（存储配额不足）——刷新后回到默认舞台');
    }
  }, [map]);

  const importJson = useCallback((text: string): string | null => {
    try {
      const v = JSON.parse(text) as unknown;
      let next: FieldMap;
      if (isPackageFormat(v)) {
        next = { ...v, tags: v.tags ?? [] };
      } else {
        // WPILib 布局:尺寸与当前地图一致（±1cm）时保留现有底图（同场补标签的常见情形）
        let rawSize: { length?: number; width?: number } | undefined;
        try {
          rawSize = (v as { field?: { length?: number; width?: number } }).field;
        } catch { /* 走 parse 的错误路径 */ }
        const keepImage =
          rawSize?.length != null && rawSize.width != null &&
          Math.abs(rawSize.length - map.sizeM.widthM) < 0.01 &&
          Math.abs(rawSize.width - map.sizeM.depthM) < 0.01
            ? { ...map, id: map.id, name: map.name }
            : undefined;
        next = parseAprilTagLayout(text, keepImage);
      }
      const err = validateFieldMap(next);
      if (err) return err;
      setMap(next);
      return null;
    } catch (e) {
      return `无法解析：${e instanceof Error ? e.message : String(e)}`;
    }
  }, [map]);

  const importPng = useCallback((
    dataUrl: string, widthPx: number, heightPx: number, widthM: number, depthM: number,
  ): string | null => {
    if (!(widthM > 0.5 && widthM < 100) || !(depthM > 0.5 && depthM < 100)) {
      return `尺寸 ${widthM}×${depthM}m 不在 0.5~100m 范围`;
    }
    setMap({
      id: `user-image-${Date.now()}`,
      name: `导入底图 ${widthM}×${depthM}m`,
      sizeM: { widthM, depthM },
      image: { url: dataUrl, widthPx, heightPx },
      tags: [],
    });
    return null;
  }, []);

  const exportTags = useCallback((): string | null => {
    if (map.tags.length === 0) return null;
    return exportAprilTagLayout(map);
  }, [map]);

  const applyBuiltin = useCallback((m: FieldMap): void => {
    setMap({ ...m, tags: m.tags.map((t) => ({ ...t })), image: m.image ? { ...m.image } : undefined });
  }, []);

  const reset = useCallback((): void => {
    setMap(DEFAULT_FIELD_MAP);
  }, []);

  return {
    map,
    importJson,
    importPng,
    exportTags,
    applyBuiltin,
    reset,
    storeWarning,
    clearStoreWarning: () => setStoreWarning(null),
  };
}

/** 底图在 SVG 里的世界矩形（y 向上;渲染时再翻）。
 *  无标定 = 满铺场地;有标定 = 两点定出的轴对齐矩形。 */
export function imageWorldRect(map: FieldMap): { xM: number; yM: number; widthM: number; heightM: number } | null {
  const img = map.image;
  if (!img) return null;
  const cal = img.calibration;
  if (cal && cal.length >= 2) {
    const xs = cal.map((c) => c.xM);
    const ys = cal.map((c) => c.yM);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { xM: x0, yM: y0, widthM: x1 - x0, heightM: y1 - y0 };
  }
  const { widthM, depthM } = map.sizeM;
  return { xM: -widthM / 2, yM: -depthM / 2, widthM, heightM: depthM };
}

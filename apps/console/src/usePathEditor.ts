/**
 * usePathEditor —— 多机路径编辑器状态（Phase 3 第一块：编辑画布与数据模型闭环）。
 *
 * 编辑模型：
 *  - 选中机器人（一次编辑一台）;选中航点（可拖动/插入/删除）
 *  - 拖动航点 → 实时更新 field-model 路径;时间由相邻航点等比重分配（简化时间模型,
 *    手动时间轴微调属后续）
 *  - 命名航点间的直线段是轨迹的**编辑视图**;机器人实际轨迹生成（PathPlanner 平滑）
 *    属 Phase 3 后续——编辑器先保证几何正确与碰撞检测
 *
 * 持久化：JSON 下载/加载（Show 格式 = field-model 的 Show,单一来源）。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  createDemoShow,
  minSeparationM,
  SAFETY_MIN_SEPARATION_M,
  type Show,
  type Waypoint,
} from '@ghpaths/field-model';
import { simTopology, type RobotId } from '@ghpaths/show-protocol';

export interface EditorState {
  show: Show;
  selectedRobot: RobotId;
  selectedWaypoint: number | null;
  /** 编辑过程中的最小间距违规（相邻对列表,实时碰撞检测） */
  violations: Array<{ a: RobotId; b: RobotId; minSepM: number }>;
}

export interface PathEditor extends EditorState {
  selectRobot: (robot: RobotId) => void;
  selectWaypoint: (index: number | null) => void;
  /** 画布拖动：把选中机器人的选中航点移到世界坐标（保留时间戳） */
  moveWaypoint: (xM: number, yM: number) => void;
  /** 在段 t∈[0,1) 处插入航点（时间线性内插） */
  insertWaypoint: (afterIndex: number) => void;
  deleteWaypoint: (index: number) => void;
  loadDemo: () => void;
  exportJson: () => string;
  loadJson: (json: string) => string | null;
}

export function usePathEditor(): PathEditor {
  const initial = useMemo(() => createDemoShow(simTopology.teams()), []);
  const [show, setShow] = useState<Show>(initial);
  const [selectedRobot, setSelectedRobot] = useState<RobotId>(simTopology.teams()[0]!);
  const [selectedWaypoint, setSelectedWaypoint] = useState<number | null>(null);
  /** 拖动节流标记 */
  const dirtyRef = useRef(0);

  const violations = useMemo(() => {
    const out: Array<{ a: RobotId; b: RobotId; minSepM: number }> = [];
    for (let i = 0; i < show.paths.length; i++) {
      for (let j = i + 1; j < show.paths.length; j++) {
        const sep = minSeparationM(show.paths[i]!, show.paths[j]!);
        if (sep < SAFETY_MIN_SEPARATION_M) {
          out.push({ a: show.paths[i]!.robot, b: show.paths[j]!.robot, minSepM: sep });
        }
      }
    }
    return out;
  }, [show]);

  const updatePath = useCallback(
    (robot: RobotId, fn: (wps: Waypoint[]) => Waypoint[]): void => {
      setShow((prev) => ({
        ...prev,
        paths: prev.paths.map((p) => (p.robot === robot ? { ...p, waypoints: fn(p.waypoints) } : p)),
      }));
    },
    [],
  );

  const moveWaypoint = useCallback(
    (xM: number, yM: number): void => {
      if (selectedWaypoint === null) return;
      dirtyRef.current++;
      const idx = selectedWaypoint;
      updatePath(selectedRobot, (wps) =>
        wps.map((wp, i) => (i === idx ? { ...wp, xM, yM } : wp)),
      );
    },
    [selectedWaypoint, selectedRobot, updatePath],
  );

  const insertWaypoint = useCallback(
    (afterIndex: number): void => {
      updatePath(selectedRobot, (wps) => {
        if (afterIndex < 0 || afterIndex >= wps.length - 1) return wps;
        const a = wps[afterIndex]!;
        const b = wps[afterIndex + 1]!;
        const mid: Waypoint = {
          xM: (a.xM + b.xM) / 2,
          yM: (a.yM + b.yM) / 2,
          headingRad: a.headingRad,
          tShowUs: Math.round((a.tShowUs + b.tShowUs) / 2),
        };
        return [...wps.slice(0, afterIndex + 1), mid, ...wps.slice(afterIndex + 1)];
      });
      setSelectedWaypoint(afterIndex + 1);
    },
    [selectedRobot, updatePath],
  );

  const deleteWaypoint = useCallback(
    (index: number): void => {
      updatePath(selectedRobot, (wps) =>
        wps.length <= 2 ? wps : wps.filter((_, i) => i !== index),
      );
      setSelectedWaypoint(null);
    },
    [selectedRobot, updatePath],
  );

  const exportJson = useCallback((): string => JSON.stringify(show, null, 2), [show]);

  const loadJson = useCallback((json: string): string | null => {
    try {
      const parsed = JSON.parse(json) as Show;
      if (!Array.isArray(parsed.paths) || parsed.paths.length === 0) return '无路径数据';
      for (const p of parsed.paths) {
        if (!Array.isArray(p.waypoints) || p.waypoints.length < 2) {
          return `机器人 ${p.robot} 航点不足`;
        }
      }
      setShow(parsed);
      setSelectedWaypoint(null);
      return null;
    } catch {
      return 'JSON 解析失败';
    }
  }, []);

  const loadDemo = useCallback((): void => {
    setShow(createDemoShow(simTopology.teams()));
    setSelectedWaypoint(null);
  }, []);

  return {
    show,
    selectedRobot,
    selectedWaypoint,
    violations,
    selectRobot: setSelectedRobot,
    selectWaypoint: setSelectedWaypoint,
    moveWaypoint,
    insertWaypoint,
    deleteWaypoint,
    loadDemo,
    exportJson,
    loadJson,
  };
}

/**
 * useTelemetry —— 轻量遥测环缓冲（始终开启,不受录制开关影响）。
 *  - 间距：每 pose 拍计算全部机对的最小中心距（15 对,20Hz,开销可忽略）,保留 60s
 *  - 电池：multi-DS 状态 1Hz 采样,保留 10 分钟
 * 图表消费这些缓冲;录制（useRecorder）是独立的落盘通道。
 */
import { useMemo, useRef } from 'react';
import type { PoseSample, RobotId } from '@ghpaths/show-protocol';

export interface TelemetryPoint {
  tMs: number;
  v: number;
}

const SPACING_WINDOW_MS = 60_000;
const BATTERY_WINDOW_MS = 600_000;
const BATTERY_SAMPLE_MS = 1_000;

export interface TelemetryState {
  /** 最小机间距序列（米;按 pose 拍） */
  spacing: TelemetryPoint[];
  /** 每机电池序列（伏;1Hz） */
  battery: Map<RobotId, TelemetryPoint[]>;
  onPose: (robot: RobotId, pose: PoseSample) => void;
  onBattery: (robot: RobotId, volts: number) => void;
}

export function useTelemetry(): TelemetryState {
  const spacingRef = useRef<TelemetryPoint[]>([]);
  const batteryRef = useRef(new Map<RobotId, TelemetryPoint[]>());
  /** 最近一拍各机位姿（间距计算用） */
  const latestPoses = useRef(new Map<RobotId, PoseSample>());
  const lastBatterySample = useRef(0);

  const onPose = useMemo(
    () =>
      (robot: RobotId, pose: PoseSample): void => {
        latestPoses.current.set(robot, pose);
        if (latestPoses.current.size < 2) return;
        // 全对最小中心距（6 机 15 对;样本级 O(n²) 规模极小）
        let min = Number.POSITIVE_INFINITY;
        const poses = [...latestPoses.current.values()];
        for (let i = 0; i < poses.length; i++) {
          for (let j = i + 1; j < poses.length; j++) {
            const d = Math.hypot(poses[i]!.xM - poses[j]!.xM, poses[i]!.yM - poses[j]!.yM);
            if (d < min) min = d;
          }
        }
        const tMs = performance.now();
        spacingRef.current.push({ tMs, v: min });
        const cutoff = tMs - SPACING_WINDOW_MS;
        const arr = spacingRef.current;
        let drop = 0;
        while (drop < arr.length && arr[drop]!.tMs < cutoff) drop++;
        if (drop > 0) arr.splice(0, drop);
      },
    [],
  );

  const onBattery = useMemo(
    () =>
      (robot: RobotId, volts: number): void => {
        const now = performance.now();
        if (now - lastBatterySample.current < BATTERY_SAMPLE_MS) return;
        lastBatterySample.current = now;
        const arr = batteryRef.current.get(robot) ?? [];
        arr.push({ tMs: now, v: volts });
        const cutoff = now - BATTERY_WINDOW_MS;
        let drop = 0;
        while (drop < arr.length && arr[drop]!.tMs < cutoff) drop++;
        if (drop > 0) arr.splice(0, drop);
        batteryRef.current.set(robot, arr);
      },
    [],
  );

  return {
    spacing: spacingRef.current,
    battery: batteryRef.current,
    onPose,
    onBattery,
  };
}

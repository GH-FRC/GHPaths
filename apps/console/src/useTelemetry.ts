/**
 * useTelemetry —— 轻量遥测环缓冲（始终开启,不受录制开关影响）。
 *  - 间距：每 pose 拍计算全部机对的最小中心距（15 对,20Hz,开销可忽略）,保留 60s
 *  - 电池：multi-DS 状态 1Hz 采样,保留 10 分钟
 * 图表消费这些缓冲;录制（useRecorder）是独立的落盘通道。
 */
import { useMemo, useRef } from 'react';
import type { PoseSample, RobotId } from '@ghpaths/show-protocol';
import { minSeparationFromPositions } from '@ghpaths/field-model';

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
  /** 演出时钟漂移率序列（ppm;每秒采样——show time 与 wall time 的偏差率） */
  clockDrift: TelemetryPoint[];
  onPose: (robot: RobotId, pose: PoseSample) => void;
  onBattery: (robot: RobotId, volts: number) => void;
  onShowClock: (tShowUs: number) => void;
}

export function useTelemetry(): TelemetryState {
  const spacingRef = useRef<TelemetryPoint[]>([]);
  const driftRef = useRef<TelemetryPoint[]>([]);
  const driftLastRef = useRef<{ wallMs: number; tShowUs: number } | null>(null);
  const batteryRef = useRef(new Map<RobotId, TelemetryPoint[]>());
  /** 最近一拍各机位姿（间距计算用） */
  const latestPoses = useRef(new Map<RobotId, PoseSample>());
  const lastBatterySample = useRef(0);

  const onPose = useMemo(
    () =>
      (robot: RobotId, pose: PoseSample): void => {
        latestPoses.current.set(robot, pose);
        if (latestPoses.current.size < 2) return;
        const positions = new Map<number, { x: number; y: number }>();
        for (const [id, p] of latestPoses.current) positions.set(id, { x: p.xM, y: p.yM });
        const min = minSeparationFromPositions(positions);
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

  const onShowClock = useMemo(
    () =>
      (tShowUs: number): void => {
        const now = performance.now();
        const last = driftLastRef.current;
        if (last) {
          const wallDtMs = now - last.wallMs;
          const showDtMs = (tShowUs - last.tShowUs) / 1000;
          if (wallDtMs > 900 && wallDtMs < 1100 && showDtMs > 0) {
            // 漂移率 ppm = (showΔ - wallΔ) / wallΔ × 1e6（正值 = 演出钟偏快）
            const ppm = ((showDtMs - wallDtMs) / wallDtMs) * 1e6;
            driftRef.current.push({ tMs: now, v: ppm });
            if (driftRef.current.length > 60) driftRef.current.shift();
          }
        }
        driftLastRef.current = { wallMs: now, tShowUs };
      },
    [],
  );

  return {
    spacing: spacingRef.current,
    battery: batteryRef.current,
    clockDrift: driftRef.current,
    onPose,
    onBattery,
    onShowClock,
  };
}

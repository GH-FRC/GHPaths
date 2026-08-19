/**
 * useReplay —— 演出日志回放：解析 JSONL，按录制时间轴驱动画布。
 * 播放推进用 rAF（暂停即停帧）；位姿查找为二分（每台机器人独立时间线）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RobotId, ShowLogRecord } from '@ghpaths/show-protocol';

export interface ReplayPose {
  tRecMs: number;
  tShowUs: number;
  xM: number;
  yM: number;
  headingRad: number;
}

export interface ReplayData {
  meta: Extract<ShowLogRecord, { type: 'meta' }> | null;
  teams: RobotId[];
  poses: Map<RobotId, ReplayPose[]>;
  events: Array<{ tRecMs: number; event: string }>;
  durationMs: number;
}

export interface ReplayControl {
  data: ReplayData | null;
  parseError: string | null;
  cursorMs: number;
  playing: boolean;
  loadText: (text: string) => void;
  close: () => void;
  seek: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  /** 当前时刻各机器人的位姿（最近的 ≤cursor 样本） */
  posesAtCursor: Map<RobotId, ReplayPose>;
  /** 光标前 5s 的轨迹窗（回放渲染用） */
  trailsAtCursor: Map<RobotId, Array<{ x: number; y: number }>>;
  tShowAtCursor: number;
}

function parseLog(text: string): { data: ReplayData | null; error: string | null } {
  const poses = new Map<RobotId, ReplayPose[]>();
  const events: Array<{ tRecMs: number; event: string }> = [];
  let meta: ReplayData['meta'] = null;
  let durationMs = 0;
  let lines = 0;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s === '') continue;
    lines++;
    let rec: ShowLogRecord;
    try {
      rec = JSON.parse(s) as ShowLogRecord;
    } catch {
      continue; // 容忍个别坏行
    }
    if (rec.type === 'meta') meta = rec;
    else if (rec.type === 'pose') {
      // 结构校验：缺字段/非有限值的行按坏行处理（防幽灵机位与 NaN 变换）
      if (!Number.isFinite(rec.tRecMs) || !Number.isFinite(rec.tShowUs) ||
          !Number.isFinite(rec.xM) || !Number.isFinite(rec.yM) ||
          !Number.isFinite(rec.headingRad) || !Number.isInteger(rec.robot)) continue;
      const arr = poses.get(rec.robot) ?? [];
      arr.push({ tRecMs: rec.tRecMs, tShowUs: rec.tShowUs, xM: rec.xM, yM: rec.yM, headingRad: rec.headingRad });
      poses.set(rec.robot, arr);
      durationMs = Math.max(durationMs, rec.tRecMs);
    } else if (rec.type === 'show') {
      events.push({ tRecMs: rec.tRecMs, event: rec.event });
      durationMs = Math.max(durationMs, rec.tRecMs);
    }
  }
  if (lines === 0) return { data: null, error: '空文件' };
  if (poses.size === 0) return { data: null, error: '无位姿数据' };
  // 时间轴归一化：tRecMs 是录制端绝对单调钟（performance.now），平移到 0 起
  let minT = Number.POSITIVE_INFINITY;
  for (const arr of poses.values()) {
    if (arr.length > 0) minT = Math.min(minT, arr[0]!.tRecMs);
  }
  for (const ev of events) minT = Math.min(minT, ev.tRecMs);
  if (Number.isFinite(minT) && minT > 0) {
    for (const arr of poses.values()) {
      for (const p of arr) p.tRecMs -= minT;
    }
    for (const ev of events) ev.tRecMs -= minT;
    durationMs -= minT;
  }
  return {
    data: { meta, teams: [...poses.keys()], poses, events, durationMs },
    error: null,
  };
}

function poseAt(samples: ReplayPose[], tMs: number): ReplayPose | null {
  if (samples.length === 0) return null;
  // 二分：最后一个 tRecMs ≤ tMs 的样本；tMs 早于首个样本 → 取首样本（光标 0 显示就位状态）
  let lo = 0;
  let hi = samples.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.tRecMs <= tMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return samples[ans >= 0 ? ans : 0]!;
}

export function useReplay(): ReplayControl {
  const [data, setData] = useState<ReplayData | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [cursorMs, setCursorMs] = useState(0);
  const [playing, setPlayingState] = useState(false);
  const cursorRef = useRef(0);
  const dataRef = useRef<ReplayData | null>(null);
  dataRef.current = data;

  const seek = useCallback((ms: number): void => {
    const d = dataRef.current;
    const clamped = Math.max(0, Math.min(ms, d?.durationMs ?? 0));
    cursorRef.current = clamped;
    setCursorMs(clamped);
  }, []);

  // rAF 播放推进
  useEffect(() => {
    if (!playing || !data) return;
    let raf = 0;
    let last = performance.now();
    const tick = (): void => {
      const now = performance.now();
      // 单帧步进钳制 ≤250ms：后台标签回前台不吞掉整段时间
      cursorRef.current += Math.min(now - last, 250);
      last = now;
      if (cursorRef.current >= data.durationMs) {
        cursorRef.current = data.durationMs;
        setCursorMs(data.durationMs);
        setPlayingState(false);
        return;
      }
      setCursorMs(cursorRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, data]);

  const loadText = useCallback(
    (text: string): void => {
      const { data: d, error } = parseLog(text);
      setParseError(error);
      setData(d);
      cursorRef.current = 0;
      setCursorMs(0);
      setPlayingState(false);
    },
    [],
  );

  const close = useCallback((): void => {
    setData(null);
    setParseError(null);
    setPlayingState(false);
  }, []);

  const setPlaying = useCallback((p: boolean): void => {
    const d = dataRef.current;
    if (p && d && cursorRef.current >= d.durationMs) {
      cursorRef.current = 0; // 播放到头后再按播放 → 从头
      setCursorMs(0);
    }
    setPlayingState(p);
  }, []);

  const posesAtCursor = new Map<RobotId, ReplayPose>();
  const trailsAtCursor = new Map<RobotId, Array<{ x: number; y: number }>>();
  let tShowAtCursor = 0;
  if (data) {
    for (const [robot, samples] of data.poses) {
      const p = poseAt(samples, cursorMs);
      if (p) {
        posesAtCursor.set(robot, p);
        tShowAtCursor = Math.max(tShowAtCursor, p.tShowUs);
      }
      // 轨迹窗：先二分定位光标下标，再回溯 ≤240 条（5s 窗，隔点采样 ≤120 点）
      let lo2 = 0;
      let hi2 = samples.length - 1;
      let idx = -1;
      while (lo2 <= hi2) {
        const mid = (lo2 + hi2) >> 1;
        if (samples[mid]!.tRecMs <= cursorMs) {
          idx = mid;
          lo2 = mid + 1;
        } else {
          hi2 = mid - 1;
        }
      }
      const trail: Array<{ x: number; y: number }> = [];
      for (let i = idx; i >= 0 && i > idx - 240; i -= 2) {
        const s = samples[i]!;
        if (s.tRecMs < cursorMs - 5000) break;
        trail.push({ x: s.xM, y: s.yM });
        if (trail.length >= 120) break;
      }
      if (trail.length > 0) trailsAtCursor.set(robot, trail.reverse());
    }
  }

  return { data, parseError, cursorMs, playing, loadText, close, seek, setPlaying, posesAtCursor, trailsAtCursor, tShowAtCursor };
}

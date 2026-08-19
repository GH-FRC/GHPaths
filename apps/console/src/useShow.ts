/**
 * useShow —— 演出时钟与演出命令（show-time 语义的唯一 UI 侧实现，见 show-protocol）。
 *
 * 时钟：10Hz 向全部机器人广播 ShowClockSample；running=false 时 tShow 冻结（hold 语义
 * 靠时钟本身实现，机器人不需要 hold/resume 命令）。
 * 命令：start → arm（带编辑器路径,无则用机器人内置）+ 各机 start(tStart)；stop → 各机 stop。
 * UI 断连/卸载时停止广播 → 机器人 750ms 内断时钟自动停（安全链一环）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RobotId, ShowClockSample } from '@ghpaths/show-protocol';
import type { RobotShowPath } from '@ghpaths/field-model';
import { subscribeTicks } from './tick-source';

export type ShowPhase = 'idle' | 'running' | 'held';

export interface ShowControl {
  phase: ShowPhase;
  /** 当前演出时钟（秒，供显示） */
  tShowSeconds: number;
  /** 演出已到时长自动收尾（held 且不可 resume；操作员点「结束演出」撤使能） */
  ended: boolean;
  start: () => void;
  hold: () => void;
  resume: () => void;
  stop: () => void;
}

export function useShow(
  publishClock: (sample: ShowClockSample) => void,
  sendCommand: (robot: RobotId, cmd: { kind: 'start'; showId: string; tStartShowUs: number } | { kind: 'stop' } | { kind: 'arm'; showId: string; segmentId: number; path?: unknown }) => void,
  teams: RobotId[],
  durationShowUs: number,
  showId: string,
  onEvent?: (event: 'start' | 'hold' | 'resume' | 'stop' | 'ended') => void,
  paths?: Map<number, RobotShowPath>,
): ShowControl {
  const [phase, setPhase] = useState<ShowPhase>('idle');
  const [tShowSeconds, setTShowSeconds] = useState(0);
  const [ended, setEnded] = useState(false);
  /** 时基：running 起点的本地时刻与当时的 tShow 偏移 */
  const baseRef = useRef({ startMs: 0, baseUs: 0 });
  const phaseRef = useRef<ShowPhase>('idle');
  phaseRef.current = phase;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const currentTShowUs = useCallback((): number => {
    const { startMs, baseUs } = baseRef.current;
    if (phaseRef.current === 'running') {
      // 到演出时长自动收尾：时钟冻结在时长处（机器人保持），操作员再点「结束演出」撤使能
      return Math.min(baseUs + (performance.now() - startMs) * 1000, durationShowUs);
    }
    return Math.min(baseUs, durationShowUs);
  }, [durationShowUs]);

  // 节拍源用 Worker（tick-source）：后台标签的 setInterval 被节流到 ~1 次/分钟，
  // 曾实测导致演出时钟断流全场自动停；Worker 节拍不受钳制
  useEffect(() => {
    const unsub = subscribeTicks(1, () => {
      const tShowUs = currentTShowUs();
      if (phaseRef.current === 'running' && tShowUs >= durationShowUs) {
        // 到点自动 hold（安全：不再无限期保持使能行驶完毕的机器人）
        baseRef.current = { startMs: performance.now(), baseUs: durationShowUs };
        setPhase('held');
        setEnded(true);
        onEventRef.current?.('ended');
      }
      publishClock({
        tMonotonicUs: performance.now() * 1000,
        tShowUs,
        running: phaseRef.current === 'running',
      });
      setTShowSeconds(tShowUs / 1e6);
    });
    return unsub;
  }, [currentTShowUs, publishClock, durationShowUs]);

  const start = useCallback((): void => {
    baseRef.current = { startMs: performance.now(), baseUs: 0 };
    setEnded(false);
    setPhase('running');
    onEventRef.current?.('start');
    for (const team of teams) {
      sendCommand(team, { kind: 'arm', showId, segmentId: 0, path: paths?.get(team) });
      sendCommand(team, { kind: 'start', showId, tStartShowUs: 0 });
    }
  }, [sendCommand, teams, showId, paths]);

  const hold = useCallback((): void => {
    if (phaseRef.current !== 'running') return;
    baseRef.current = { startMs: performance.now(), baseUs: currentTShowUs() };
    setPhase('held');
    onEventRef.current?.('hold');
  }, [currentTShowUs]);

  const resume = useCallback((): void => {
    if (phaseRef.current !== 'held' || ended) return; // 已到时长不再续跑
    baseRef.current = { startMs: performance.now(), baseUs: currentTShowUs() };
    setPhase('running');
    onEventRef.current?.('resume');
  }, [currentTShowUs, ended]);

  const stop = useCallback((): void => {
    setPhase('idle');
    setEnded(false);
    baseRef.current = { startMs: performance.now(), baseUs: 0 };
    setTShowSeconds(0);
    onEventRef.current?.('stop');
    for (const team of teams) sendCommand(team, { kind: 'stop' });
  }, [sendCommand, teams]);

  return { phase, tShowSeconds, ended, start, hold, resume, stop };
}

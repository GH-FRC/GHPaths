/**
 * useRecorder —— 演出日志录制（ShowLogRecord v1，JSONL；见 show-protocol）。
 * 内存缓冲 + 手动导出（浏览器环境无文件写入；导出 .jsonl 下载）。
 * 上限保护：超限丢最旧（保存最近 ~30 分钟位姿量级）。
 */
import { useCallback, useRef, useState } from 'react';
import type { RobotHealth, RobotId, PoseSample, ShowLogRecord } from '@ghpaths/show-protocol';

const MAX_LINES = 300_000;

export interface Recorder {
  recording: boolean;
  lineCount: number;
  begin: (teams: RobotId[], showId: string | null) => void;
  end: () => void;
  pushPose: (robot: RobotId, pose: PoseSample) => void;
  pushHealth: (robot: RobotId, health: RobotHealth) => void;
  pushDs: (team: RobotId, state: 'disabled' | 'enabled' | 'estopped', linked: boolean, batteryVolts: number) => void;
  pushShowEvent: (event: 'start' | 'hold' | 'resume' | 'stop' | 'ended') => void;
  /** 导出 JSONL 文本（调用方负责触发下载） */
  exportText: () => string | null;
}

export function useRecorder(): Recorder {
  const [recording, setRecording] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const linesRef = useRef<string[]>([]);
  const recordingRef = useRef(false);
  // DS 行按内容去重（10Hz 状态广播 × 6 台，只在变化时落盘）
  const lastDsRef = useRef(new Map<RobotId, string>());

  const append = useCallback((line: ShowLogRecord): void => {
    if (!recordingRef.current) return;
    const arr = linesRef.current;
    arr.push(JSON.stringify(line));
    if (arr.length > MAX_LINES) arr.splice(0, arr.length - MAX_LINES);
    setLineCount(arr.length);
  }, []);

  const begin = useCallback((teams: RobotId[], showId: string | null): void => {
    linesRef.current = [];
    lastDsRef.current.clear();
    recordingRef.current = true;
    setRecording(true);
    setLineCount(0);
    append({ type: 'meta', v: 1, recordedAt: new Date().toISOString(), teams, showId });
  }, [append]);

  const end = useCallback((): void => {
    recordingRef.current = false;
    setRecording(false);
  }, []);

  const pushPose = useCallback(
    (robot: RobotId, pose: PoseSample): void => {
      append({
        type: 'pose',
        tRecMs: performance.now(),
        tShowUs: pose.tShowUs,
        robot,
        xM: pose.xM,
        yM: pose.yM,
        headingRad: pose.headingRad,
      });
    },
    [append],
  );

  const pushHealth = useCallback(
    (robot: RobotId, health: RobotHealth): void => {
      append({ type: 'health', tRecMs: performance.now(), robot, health });
    },
    [append],
  );

  const pushDs = useCallback(
    (team: RobotId, state: 'disabled' | 'enabled' | 'estopped', linked: boolean, batteryVolts: number): void => {
      const key = `${state}|${linked}|${batteryVolts.toFixed(1)}`;
      if (lastDsRef.current.get(team) === key) return;
      lastDsRef.current.set(team, key);
      append({ type: 'ds', tRecMs: performance.now(), team, state, linked, batteryVolts });
    },
    [append],
  );

  const pushShowEvent = useCallback(
    (event: 'start' | 'hold' | 'resume' | 'stop' | 'ended'): void => {
      append({ type: 'show', tRecMs: performance.now(), event });
    },
    [append],
  );

  const exportText = useCallback((): string | null => {
    if (linesRef.current.length === 0) return null;
    return linesRef.current.join('\n') + '\n';
  }, []);

  return {
    recording,
    lineCount,
    begin,
    end,
    pushPose,
    pushHealth,
    pushDs,
    pushShowEvent,
    exportText,
  };
}

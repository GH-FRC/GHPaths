/**
 * useRobots —— console 的机器人连接层：经 nt-link 连接全部模拟机器人，
 * 维护位姿/健康/轨迹状态，定时器节流刷新到 React（20Hz 位姿流不逐帧 setState）。
 */
import { useEffect, useRef, useState } from 'react';
import { createNtLink, type NtLink, type RobotConnection } from '@ghpaths/nt-link';
import { simTopology, type PoseSample, type RobotHealth, type RobotId } from '@ghpaths/show-protocol';

export interface RobotState {
  robot: RobotId;
  connected: boolean;
  /** 最近 1s 内有位姿（比 connected 更强的"活着"判据） */
  live: boolean;
  pose: PoseSample | null;
  health: RobotHealth | null;
  trail: Array<{ x: number; y: number }>;
}

export type UiCommand = { kind: 'stop' } | { kind: 'resume' };

const TRAIL_LIMIT = 240; // 20Hz × 12s

interface Entry {
  conn: RobotConnection | null;
  connected: boolean;
  lastPoseMs: number;
  pose: PoseSample | null;
  health: RobotHealth | null;
  trail: Array<{ x: number; y: number }>;
}

export function useRobots(): { robots: RobotState[]; sendCommand: (robot: RobotId, cmd: UiCommand) => void } {
  const [robots, setRobots] = useState<RobotState[]>(() =>
    simTopology.teams().map((robot) => ({
      robot,
      connected: false,
      live: false,
      pose: null,
      health: null,
      trail: [],
    })),
  );

  const linkRef = useRef<NtLink | null>(null);
  const entriesRef = useRef(
    new Map<RobotId, Entry>(
      simTopology.teams().map((team) => [
        team,
        { conn: null, connected: false, lastPoseMs: 0, pose: null, health: null, trail: [] },
      ]),
    ),
  );

  useEffect(() => {
    const link = createNtLink();
    linkRef.current = link;

    // openRobot 同步返回连接对象：回调立即挂载，不因首连超时而丢失
    // （先开 UI 后开 sim 的场景，画布在 sim 起来后自动点亮）
    for (const team of simTopology.teams()) {
      const entry = entriesRef.current.get(team);
      if (!entry) continue;
      const conn = link.openRobot(team, simTopology.wsUrl(team).replace('ws://', ''));
      entry.conn = conn;
      conn.onStatus((s) => {
        entry.connected = s === 'connected';
      });
      conn.onPose((p) => {
        entry.pose = p;
        entry.lastPoseMs = performance.now();
        entry.trail.push({ x: p.xM, y: p.yM });
        if (entry.trail.length > TRAIL_LIMIT) entry.trail.shift();
      });
      conn.onHealth((h) => {
        entry.health = h;
      });
      void conn.connect().catch(() => {
        // 首连等待超时：内部自动重连，状态回调稍后点亮
      });
    }

    const flush = () => {
      const now = performance.now();
      setRobots(
        simTopology.teams().map((team) => {
          const e = entriesRef.current.get(team);
          return {
            robot: team,
            connected: e?.conn?.connected === true,
            live: e !== undefined && e.lastPoseMs > 0 && now - e.lastPoseMs < 1000,
            pose: e?.pose ?? null,
            health: e?.health ?? null,
            trail: e?.trail ?? [],
          };
        }),
      );
    };
    const timer = setInterval(flush, 100);
    return () => {
      clearInterval(timer);
      link.closeAll();
      linkRef.current = null;
    };
  }, []);

  const sendCommand = (robot: RobotId, cmd: UiCommand): void => {
    const entry = entriesRef.current.get(robot);
    if (entry?.conn) {
      entry.conn.sendCommand(cmd);
      return;
    }
    const link = linkRef.current;
    if (!link) return;
    link
      .openRobot(robot, simTopology.wsUrl(robot).replace('ws://', ''))
      .sendCommand(cmd);
  };

  return { robots, sendCommand };
}

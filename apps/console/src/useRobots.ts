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
    let disposed = false;

    (async () => {
      for (const team of simTopology.teams()) {
        if (disposed) return;
        const entry = entriesRef.current.get(team);
        if (!entry) continue;
        try {
          const conn = await link.connectRobot(team, simTopology.wsUrl(team).replace('ws://', ''));
          if (disposed) return;
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
        } catch {
          // 首连超时：保持 disconnected；连接对象内部持续重连，onStatus 稍后点亮
        }
      }
    })();

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
      disposed = true;
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
    void link
      .connectRobot(robot, simTopology.wsUrl(robot).replace('ws://', ''))
      .then((conn) => conn.sendCommand(cmd))
      .catch(() => undefined);
  };

  return { robots, sendCommand };
}

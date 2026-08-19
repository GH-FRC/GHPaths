/**
 * useMultiDs —— console 与 multi-DS 进程（ws://127.0.0.1:5899）的连接层。
 * 每 500ms 发 uiPing 维持"UI 在线"；收 10Hz 状态广播；断线自动重连。
 * （ADR-0002 安全链：UI 崩溃/断连 → multi-DS 宽限期后自动全停。）
 */
import { useEffect, useRef, useState } from 'react';
import { MULTI_DS_CONTROL_PORT, type MultiDsControl, type MultiDsRobotStatus } from '@ghpaths/show-protocol';
import { subscribeTicks } from './tick-source';

export type MultiDsCommand =
  | { type: 'enable'; team: number }
  | { type: 'disable'; team: number }
  | { type: 'estop'; team: number }
  | { type: 'clearEstop'; team: number }
  | { type: 'enableAll' }
  | { type: 'disableAll' }
  | { type: 'estopAll' };

export interface MultiDsState {
  connected: boolean;
  robots: Map<number, MultiDsRobotStatus>;
}

export function useMultiDs(): MultiDsState & { send: (cmd: MultiDsCommand) => void } {
  const [connected, setConnected] = useState(false);
  const [robots, setRobots] = useState<Map<number, MultiDsRobotStatus>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  /** CONNECTING 期间发出的命令缓存（急停绝不能因重连窗口被静默丢弃），onopen 时补发 */
  const pendingRef = useRef<MultiDsCommand[]>([]);

  useEffect(() => {
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubPing: (() => void) | null = null;

    const connect = (): void => {
      if (stopped) return;
      const ws = new WebSocket(`ws://127.0.0.1:${MULTI_DS_CONTROL_PORT}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return; // StrictMode/Fast Refresh 的旧 socket 迟到事件
        setConnected(true);
        const send = (m: MultiDsControl): void => ws.send(JSON.stringify(m));
        send({ type: 'uiPing' });
        for (const cmd of pendingRef.current.splice(0)) send(cmd);
        // uiPing 走 Worker 节拍（每 5 拍 = 500ms）：后台标签不再因节流误触发宽限期全停
        unsubPing = subscribeTicks(5, () => send({ type: 'uiPing' }));
      };
      ws.onmessage = (ev: MessageEvent) => {
        if (wsRef.current !== ws) return;
        if (typeof ev.data !== 'string') return;
        try {
          const msg = JSON.parse(ev.data) as { type?: string; robots?: MultiDsRobotStatus[] };
          if (msg.type === 'status' && Array.isArray(msg.robots)) {
            setRobots(new Map(msg.robots.map((r) => [r.team, r])));
          }
        } catch {
          // 忽略坏帧
        }
      };
      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        setConnected(false);
        setRobots(new Map()); // 断连后清空快照，避免显示过期的"运动中"
        unsubPing?.();
        unsubPing = null;
        wsRef.current = null;
        if (!stopped) reconnectTimer = setTimeout(connect, 1500);
      };
      // onerror 后必有 onclose，走统一重连
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      unsubPing?.();
      wsRef.current?.close();
    };
  }, []);

  const send = (cmd: MultiDsCommand): void => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(cmd));
      return;
    }
    // 未连接（含重连窗口）：只有停向命令值得缓存补发；使能类缓存补发会造成
    // "multi-DS 晚启动 → 已装填的机器人无人操作突然开动"的反安全延迟自启动，直接丢弃
    const stopDirected = cmd.type.startsWith('estop') || cmd.type.startsWith('disable') || cmd.type === 'clearEstop';
    if (!stopDirected) return;
    pendingRef.current = pendingRef.current.filter(
      (c) => c.type !== cmd.type || ('team' in c && 'team' in cmd && c.team !== cmd.team),
    );
    pendingRef.current.push(cmd);
    if (pendingRef.current.length > 32) pendingRef.current.shift();
  };

  return { connected, robots, send };
}

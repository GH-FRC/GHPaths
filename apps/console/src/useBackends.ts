/**
 * useBackends —— sidecar 后端进程面板（仅 Tauri 壳内可用;Web 模式隐藏）。
 * sim / multi-DS 的启动/停止/状态,经 Tauri command 与 Rust 进程管理器交互。
 * 日志在 /tmp/ghpaths/{which}.log（GUI 进程无终端）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface BackendState {
  which: string;
  running: boolean;
  uptimeSecs: number;
}

export function isTauriShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function useBackends(): {
  available: boolean;
  backends: BackendState[];
  toggle: (which: string) => void;
  error: string | null;
} {
  const available = isTauriShell();
  const [backends, setBackends] = useState<BackendState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const invokeRef = useRef<((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null>(null);

  useEffect(() => {
    if (!available) return;
    void (async () => {
      const core = await import('@tauri-apps/api/core');
      invokeRef.current = core.invoke;
      // 首启自动拉起两个后端（排练摩擦最小;失败不打断——面板可见状态）
      // 首启自启：backend_start 幂等（已在运行 = Ok），失败说明 sidecar 产物缺失等真实问题
      // ——直接展示给面板（不再吞掉）
      for (const which of ['sim', 'multids']) {
        try {
          await core.invoke('backend_start', { which });
        } catch (e) {
          setError(String(e));
        }
      }
    })();
    const iv = setInterval(async () => {
      if (!invokeRef.current) return;
      try {
        const st = (await invokeRef.current('backend_status')) as BackendState[];
        setBackends(st);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [available]);

  const toggle = useCallback((which: string): void => {
    const invoke = invokeRef.current;
    if (!invoke) return;
    const target = backends.find((b) => b.which === which);
    // start/stop 均幂等（后端保证），手快双击不再产生可展示的错误
    void invoke('backend_' + (target?.running ? 'stop' : 'start'), { which }).catch((e: unknown) =>
      setError(String(e)),
    );
  }, [backends]);

  return { available, backends, toggle, error };
}

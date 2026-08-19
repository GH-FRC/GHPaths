/**
 * tickSource —— 全局节拍源：单例 Worker 每 100ms 一拍，订阅者自行分频。
 * 用途：演出时钟广播（1 拍/次）与 multi-DS uiPing（每 5 拍/次）。
 * Worker 加载失败时回退到页面 setInterval（行为退化为旧版，仍正确只是后台标签会被节流）。
 */

type TickCallback = (tMs: number) => void;

interface Subscriber {
  cb: TickCallback;
  every: number; // 每 every 拍回调一次
  count: number;
}

let worker: Worker | null = null;
let workerFailed = false;
const subscribers = new Set<Subscriber>();
let fallbackTimer: ReturnType<typeof setInterval> | null = null;

function fanout(tMs: number): void {
  for (const s of subscribers) {
    s.count++;
    if (s.count % s.every === 0) s.cb(tMs);
  }
}

function ensureWorker(): void {
  if (worker !== null || workerFailed) return;
  try {
    worker = new Worker(new URL('./clock.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ t: number }>) => fanout(ev.data.t);
    worker.onerror = () => startFallback();
    worker.postMessage({ type: 'start', periodMs: 100 });
  } catch {
    startFallback();
  }
}

function startFallback(): void {
  workerFailed = true;
  if (worker !== null) {
    worker.terminate();
    worker = null;
  }
  if (fallbackTimer !== null) return;
  fallbackTimer = setInterval(() => fanout(performance.now()), 100);
}

/** 订阅节拍；every=1 即每拍（100ms）。返回退订函数。 */
export function subscribeTicks(every: number, cb: TickCallback): () => void {
  const sub: Subscriber = { cb, every: Math.max(1, Math.floor(every)), count: 0 };
  subscribers.add(sub);
  ensureWorker();
  return () => {
    subscribers.delete(sub);
  };
}

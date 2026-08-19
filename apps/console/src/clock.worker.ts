/**
 * clock.worker —— 节拍源 Worker。
 * 浏览器对后台标签页的 setInterval 钳到 ~1 次/分钟（实测 47s 间隔），导致演出时钟
 * 断流全场自动停、uiPing 停发触发 multi-DS 宽限期全停。Worker 线程的定时器不受
 * 标签页可见性钳制，postMessage 派发也不走被钳的定时器队列——把节拍源搬进来，
 * 页面侧在 onmessage 回调里执行发送（对已建立的 WebSocket 调 send() 不受限）。
 */

let timer: ReturnType<typeof setInterval> | null = null;
let periodMs = 100;

self.onmessage = (ev: MessageEvent<{ type: string; periodMs?: number }>) => {
  if (ev.data.type === 'start') {
    const p = ev.data.periodMs ?? 100;
    if (timer !== null) clearInterval(timer);
    periodMs = p;
    timer = setInterval(() => {
      (self as unknown as Worker).postMessage({ t: performance.now() });
    }, periodMs);
  } else if (ev.data.type === 'stop') {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }
};

/**
 * Sparkline —— 单序列迷你趋势线（机器人卡片内电池用）。
 * 单序列单色（该卡片的机器人色 = 卡片上下文内的身份,非图表分类板职责）;
 * 无网格无轴;首尾值差（涨/跌/平）用灰度方向线端小圆点,不占用状态色。
 */
import type { TelemetryPoint } from './useTelemetry';

export function Sparkline({
  data,
  width = 56,
  height = 16,
}: {
  data: TelemetryPoint[] | undefined;
  width?: number;
  height?: number;
}): JSX.Element | null {
  if (!data || data.length < 2) return null;
  const vs = data.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const path = data
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - 2 - ((p.v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} className="sparkline" aria-hidden="true">
      <path d={path} className="sparkline-path" fill="none" />
    </svg>
  );
}

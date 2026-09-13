export type MapMetric = "population" | "share" | "density" | "change";

export const mapThresholdVersion = "G6-MAP-110-114-CONTINUOUS-V2";
export const sequentialColors = ["#2B6CB0", "#F2C94C", "#E67E22", "#C0392B"] as const;
export const divergingColors = ["#2166AC", "#67A9CF", "#F3F4F4", "#F4A261", "#C94A3F"] as const;
export const sequentialGradientColors = ["#2B6CB0", "#78B7D8", "#F2C94C", "#E67E22", "#C0392B"] as const;
export const divergingGradientColors = ["#2166AC", "#67A9CF", "#F3F4F4", "#F4A261", "#C94A3F"] as const;

export function percentChange(current: number | null | undefined, baseline: number | null | undefined) {
  if (current == null || baseline == null || baseline === 0) return null;
  return (current / baseline - 1) * 100;
}

export function quantile(values: number[], probability: number) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * Math.min(Math.max(probability, 0), 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

export function sequentialBreaks(values: number[]) {
  return [quantile(values, 0.25), quantile(values, 0.5), quantile(values, 0.75)] as const;
}

export function sequentialClass(value: number, breaks: readonly number[]) {
  if (value <= breaks[0]) return 0;
  if (value <= breaks[1]) return 1;
  if (value <= breaks[2]) return 2;
  return 3;
}

export function divergingBreaks(values: number[]) {
  const absolute = values.filter(Number.isFinite).map((value) => Math.abs(value)).filter((value) => value > 0);
  const inner = quantile(absolute, 0.5);
  const outer = Math.max(quantile(absolute, 0.75), inner);
  return { inner, outer };
}

export function divergingClass(value: number, breaks: { inner: number; outer: number }) {
  if (value <= -breaks.outer) return 0;
  if (value < -breaks.inner) return 1;
  if (value <= breaks.inner) return 2;
  if (value < breaks.outer) return 3;
  return 4;
}

export function numericDomain(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: 0, max: 1 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return min === max ? { min, max: min + 1 } : { min, max };
}

export function symmetricDomain(values: number[]) {
  const maximum = Math.max(0, ...values.filter(Number.isFinite).map((value) => Math.abs(value)));
  return maximum || 1;
}

/** 非完整組成比的圖表上限：無條件進位至下一個10的倍數。 */
export function roundUpToTen(value: number) {
  return Math.max(10, Math.ceil(value / 10) * 10);
}

/** 人數圖表以兩位有效位數建立跨地區、跨年度固定上限。 */
export function roundedCountCeiling(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);
  return Math.ceil(value / magnitude) * magnitude;
}

function parseHexColor(color: string) {
  const normalized = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) throw new Error(`Invalid hex color: ${color}`);
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

export function interpolateGradientColor(
  value: number,
  min: number,
  max: number,
  colors: readonly string[],
) {
  if (!colors.length) return "#E5E9EC";
  if (colors.length === 1 || max <= min) return colors[0];
  const position = Math.min(Math.max((value - min) / (max - min), 0), 1) * (colors.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(Math.ceil(position), colors.length - 1);
  const fraction = position - lowerIndex;
  const lower = parseHexColor(colors[lowerIndex]);
  const upper = parseHexColor(colors[upperIndex]);
  const mixed = lower.map((channel, index) => Math.round(channel + (upper[index] - channel) * fraction));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

// Presentation geometry only: no aggregation, population mapping or value estimation.
export type AxisLabelMode = "auto" | "wrap" | "slant" | "vertical";
export type ResolvedLabelMode = Exclude<AxisLabelMode, "auto">;

const textWidth = (text: string) => Array.from(text).reduce((width, character) => width + (character.codePointAt(0)! > 127 ? 16 : 9), 0);

export function wrapAxisLabel(text: string, maxWidth = 112): string[] {
  const lines: string[] = [];
  let line = "";
  for (const character of Array.from(text)) {
    if (line && textWidth(line + character) > maxWidth) { lines.push(line); line = ""; }
    line += character;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function roundAxisMaximum(maximum: number) {
  if (maximum <= 10) return Math.ceil(maximum / 2) * 2 || 2;
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  return Math.ceil(maximum / magnitude) * magnitude;
}

export function createCustomChartLayout({ labels, dimension, labelMode, viewportWidth, seriesCount, kind, yMax }: {
  labels: string[]; dimension: string; labelMode: AxisLabelMode; viewportWidth: number;
  seriesCount: number; kind: "line" | "bar"; yMax: number;
}) {
  const mode: ResolvedLabelMode = labelMode === "auto"
    ? dimension === "geography" && labels.length > 8 ? "vertical" : "wrap"
    : labelMode;
  const lines = labels.map((label) => mode === "vertical" ? Array.from(label) : wrapAxisLabel(label, mode === "slant" ? 176 : 112));
  const longestLine = Math.max(16, ...lines.flat().map(textWidth));
  const tallestLabel = Math.max(1, ...lines.map((label) => label.length)) * 22;
  const diagonalHeight = Math.ceil((longestLine + tallestLabel) / Math.SQRT2);
  const labelWidth = mode === "vertical" ? 28 : mode === "slant" ? Math.ceil(tallestLabel * Math.SQRT2) + 20 : longestLine;
  const minSlot = Math.max(56, labelWidth + 24, kind === "bar" ? seriesCount * 20 + 24 : 0);
  const left = mode === "slant" ? diagonalHeight + 16 : 16;
  const right = 24;
  const top = 24;
  const plotHeight = 320;
  const labelHeight = mode === "slant" ? diagonalHeight : tallestLabel;
  const height = top + plotHeight + 20 + labelHeight + 24;
  const width = Math.max(Math.floor(viewportWidth), left + right + Math.max(labels.length, 1) * minSlot);
  const plotWidth = width - left - right;
  const slotWidth = plotWidth / Math.max(labels.length, 1);
  const ticks = Array.from({ length: 5 }, (_, index) => yMax - yMax * index / 4);
  const tickLabels = ticks.map((tick) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(tick));
  const yAxisWidth = Math.max(68, Math.max(...tickLabels.map(textWidth)) + 16);
  const barWidth = Math.min(36, (slotWidth - 24) / Math.max(seriesCount, 1) - 4);
  return { mode, lines, width, height, left, right, top, plotHeight, plotWidth, slotWidth,
    barWidth, ticks, tickLabels, yAxisWidth,
    xAt: (index: number) => left + (index + 0.5) * slotWidth,
    yAt: (value: number) => top + (1 - value / yMax) * plotHeight,
  };
}

export function customLinePath(values: (number | null | undefined)[], xAt: (index: number) => number, yAt: (value: number) => number) {
  let connected = false;
  return values.map((value, index) => {
    if (value == null) { connected = false; return ""; }
    const command = connected ? "L" : "M";
    connected = true;
    return `${command}${xAt(index)},${yAt(value)}`;
  }).filter(Boolean).join(" ");
}

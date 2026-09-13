/** Descriptive copy only: never writes back to chart values, denominators or policy rules. */
export type ReadingPoint = { year: number; value: number | null | undefined };
const valid = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
// Match the chart's Intl.NumberFormat decimal rounding (toFixed differs at x.xx5).
const rounded = (value: number, digits: number) => Number(value.toLocaleString("en-US", { useGrouping: false, minimumFractionDigits: digits, maximumFractionDigits: digits }));
const number = (value: number, digits: number) => value.toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function changeFact(current: number, baseline: number, unit: string, digits: number): string {
  const difference = rounded(rounded(current, digits) - rounded(baseline, digits), digits);
  if (difference === 0) return "顯示值持平";
  return `${difference > 0 ? "增加" : "減少"}${number(Math.abs(difference), digits)}${unit === "%" ? "個百分點" : unit}`;
}

export function trendFact(points: ReadingPoint[], label: string, unit: string, digits = 2): string {
  const ordered = [...points].sort((a, b) => a.year - b.year);
  const available = ordered.filter((point): point is { year: number; value: number } => valid(point.value));
  const last = available.at(-1);
  if (!last) return `${label}：目前條件尚無資料。`;
  const missingLatest = ordered.at(-1)!.year > last.year ? `${ordered.at(-1)!.year}年尚無資料；最新可用為` : "";
  const first = available[0];
  const comparison = first.year === last.year ? "" : `，較${first.year}年${changeFact(last.value, first.value, unit, digits)}`;
  return `${missingLatest}${last.year}年${label}為${number(last.value, digits)}${unit}${comparison}。`;
}

/** Compare only series actually present in this chart; ties use displayed precision. */
export function categoryFacts(items: Array<{ label: string; value: number | null | undefined }>, context: string, unit = "%", digits = 2): string[] {
  const available = items.filter((item): item is { label: string; value: number } => valid(item.value));
  if (!available.length) return [`${context}：目前條件尚無資料。`];
  const maximum = Math.max(...available.map((item) => rounded(item.value, digits)));
  const leaders = available.filter((item) => rounded(item.value, digits) === maximum);
  if (available.length === 1) return [`${context}，${leaders[0].label}為${number(maximum, digits)}${unit}。`];
  if (leaders.length === available.length) return [`${context}，圖中${available.length}個類別的顯示值均為${number(maximum, digits)}${unit}。`];
  return [`${context}，圖中${leaders.map((item) => item.label).join("、")}${leaders.length > 1 ? "並列" : ""}最高，${leaders.length > 1 ? "各" : "為"}${number(maximum, digits)}${unit}。`];
}

export function seriesFacts(points: Array<{ year: number; values: Record<string, number | null> }>, names: string[], unit = "%", digits = 2): string[] {
  const ordered = [...points].sort((a, b) => a.year - b.year);
  const last = ordered.at(-1);
  if (!last) return ["目前條件尚無資料。"];
  const facts = categoryFacts(names.map((label) => ({ label, value: last.values[label] })), `${last.year}年`, unit, digits);
  const first = ordered[0];
  if (first.year === last.year) return facts;
  const changes = names.flatMap((label) => {
    const start = first.values[label], end = last.values[label];
    return valid(start) && valid(end) ? [{ label, start, end, magnitude: Math.abs(rounded(rounded(end, digits) - rounded(start, digits), digits)) }] : [];
  });
  if (!changes.length) return facts;
  const maximum = Math.max(...changes.map((item) => item.magnitude));
  if (maximum === 0) return [...facts, `與${first.year}年相比，可比較類別的顯示值均持平。`];
  const largest = changes.filter((item) => item.magnitude === maximum);
  return [...facts, `較${first.year}年變動最多：${largest.map((item) => `${item.label}${changeFact(item.end, item.start, unit, digits)}`).join("；")}。`];
}

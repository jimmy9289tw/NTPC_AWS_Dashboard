"use client";
import { ChartCanvas } from "./chart-canvas";

import { useId, useState } from "react";
import type { EvidenceChart } from "./policy-narrative";
import { customLinePath, wrapAxisLabel } from "./custom-chart-layout";
import { roundedCountCeiling, roundUpToTen } from "./map-metrics";
import { quadrantPlot, QuadrantPointTooltip } from "./quadrant-chart-primitives";
import { chartMotionKey, useChartTransition } from "./chart-transition";

const colors = ["#2563eb", "#0f766e", "#804699", "#a34f00", "#0b2f47"];
export const formatPolicyValue = (value: number | null | undefined, unit: string) => value == null || !Number.isFinite(value) ? "尚無資料" : value.toLocaleString("zh-TW", { maximumFractionDigits: unit === "人" ? 0 : unit === "萬元" ? 1 : 2 }) + unit;

export function policyPointDifference(left: number | null | undefined, right: number | null | undefined, unit: string) {
  if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) return null;
  const digits = unit === "人" ? 0 : unit === "萬元" ? 1 : 2;
  const displayed = (value: number) => Number(value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: digits }));
  const value = Number((displayed(right) - displayed(left)).toFixed(digits));
  return { value, label: `${value > 0 ? "+" : ""}${value.toLocaleString("zh-TW", { maximumFractionDigits: digits })}${unit === "%" ? "個百分點" : unit}` };
}

export function policyChartGeometry(chart: EvidenceChart) {
  const points = chart.series.flatMap((series) => series.points);
  const ceiling = Math.max(1, chart.reference?.value ?? 0, ...points.map((point) => Math.max(point.value ?? 0, point.high ?? 0)));
  const maximum = chart.composition ? Math.max(100, roundUpToTen(ceiling)) : chart.unit === "%" ? Math.max(10, roundUpToTen(ceiling)) : roundedCountCeiling(ceiling);
  const observedMinimum = Math.min(0, ...points.map(point => Math.min(point.value ?? 0, point.low ?? 0)));
  const minimum = observedMinimum < 0 ? -roundedCountCeiling(Math.abs(observedMinimum)) : 0;
  const labels = chart.series[0]?.points.map((point) => wrapAxisLabel(point.label, 112)) ?? [];
  const multipleBars = chart.kind === "bar" && chart.series.length > 2;
  const paired = (chart.comparisonGroups?.length ?? 0) > 1;
  const seriesStep = multipleBars ? 48 : Math.min(64, 80 / Math.max(1, chart.series.length)) + 4;
  const width = Math.max(quadrantPlot.width, labels.length * (multipleBars ? (paired ? chart.comparisonGroups!.length * 164 : chart.series.length * seriesStep) + 24 : 112) + 100);
  // Extra annotation space sits outside the quantitative scale, including above upper bounds.
  const headroom = chart.series.length >= 2 || (chart.kind === "bar" && chart.series[0]?.points.length === 2) ? 48 : 0;
  const left = quadrantPlot.left, right = width - quadrantPlot.right, top = quadrantPlot.top + headroom, baseline = quadrantPlot.height - quadrantPlot.bottom + headroom;
  const height = quadrantPlot.height + headroom + (paired ? 28 : 0) + Math.max(0, ...labels.map(lines => lines.length - 1)) * 22 + (chart.xLabel ? 26 : 0);
  return { minimum, maximum, labels, width, height, left, right, top, baseline, seriesStep,
    x: (index: number) => left + (index + .5) * (right - left) / Math.max(labels.length, 1),
    seriesOffset: (index: number) => paired ? (Math.floor(index / 2) - (chart.comparisonGroups!.length - 1) / 2) * 164 + (index % 2 ? 22 : -22) : (index - (chart.series.length - 1) / 2) * seriesStep,
    y: (value: number) => baseline - (value - minimum) / (maximum - minimum) * (baseline - top),
  };
}

export function NarrativeChart({ chart: sourceChart }: { chart: EvidenceChart }) {
  const id = useId();
  const [educationChoice, setEducationChoice] = useState("all");
  const educationGroup = sourceChart.comparisonGroups?.find(group => group.label === educationChoice);
  const chart = educationGroup ? { ...sourceChart, series: [sourceChart.series[educationGroup.left], sourceChart.series[educationGroup.right]], comparisonGroups: [{ ...educationGroup, left: 0, right: 1 }] } : sourceChart;
  const paired = (chart.comparisonGroups?.length ?? 0) > 1;
  const color = (index: number) => colors[index % (chart.comparisonGroups ? 2 : colors.length)];
  const [active, setActive] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; label: string; value: string } | null>(null);
  const [pairChoice, setPairChoice] = useState("0:1");
  const [hoverSignature, setHoverSignature] = useState("");
  const pairs = chart.comparisonGroups?.map(group => ({ ...group, key: `${group.left}:${group.right}` })) ?? chart.series.flatMap((left, li) => chart.series.slice(li + 1).map((right, offset) => ({ key: `${li}:${li + offset + 1}`, left: li, right: li + offset + 1, label: `${left.name} → ${right.name}` })));
  const pair = pairs.find(item => item.key === pairChoice) ?? pairs[0];
  const pointPair = chart.kind === "bar" && chart.series.length === 1 && chart.series[0].points.length === 2 ? chart.series[0].points : null;
  const signature = chartMotionKey(chart, pair?.key);
  const g = policyChartGeometry(chart);
  const rows = chart.series[0]?.points ?? [];
  const valid = chart.series.flatMap((series) => series.points).filter((point) => point.value != null && Number.isFinite(point.value));
  const hasRange = valid.some((point) => point.low != null && point.high != null);
  const chartTransition = useChartTransition(chartMotionKey(chart, pair?.key), true);
  return <figure className="pn-chart" aria-labelledby={id}>
    <figcaption id={id}><strong>{chart.title}</strong><span>單位：{chart.unit}</span></figcaption>
    <p className="pn-chart-context">{chart.period} · {chart.sex}</p>
    {!chart.comparisonGroups && pairs.length > 1 && <label className="pn-indicator-select pn-pair-select">比較哪兩組<select value={pair.key} onChange={event => setPairChoice(event.target.value)}>{pairs.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>}
    {sourceChart.comparisonGroups && <label className="pn-indicator-select">教育程度<select value={educationGroup?.label ?? "all"} onChange={event => setEducationChoice(event.target.value)}><option value="all">全部教育程度（新北市與行政區兩兩對照）</option>{sourceChart.comparisonGroups.map(group => <option key={group.label} value={group.label}>{group.label}</option>)}</select></label>}
    {pointPair && <p className="pn-comparison-caption">差距＝右柱（{pointPair[1].label}）− 左柱（{pointPair[0].label}）。</p>}
    {paired ? <p className="pn-comparison-caption">每種學歷左柱為新北市，右柱為所選行政區；括號為右柱減左柱的百分點差距。可選一種學歷放大檢視。</p> : pair && <p className="pn-comparison-caption">差距＝{chart.series[pair.right].name} − {chart.series[pair.left].name}；正數紅字、負數綠字{chart.unit === "%" ? "，單位為百分點" : ""}。</p>}
    {chart.annotation && <div className="pn-chart-annotation"><span>{chart.annotation.label}</span><strong>{chart.annotation.value}</strong></div>}
    {!valid.length ? <p className="pn-empty">目前條件尚無資料。</p> : <>
      {/* A focusable scroll region preserves chart labels in narrow drawers. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="pn-plot-scroll" role="region" tabIndex={0} aria-label={chart.title + "；窄畫面可左右捲動"}>
        <ChartCanvas className="chart-canvas" ref={chartTransition} style={chart.series.length > 2 ? { minWidth: g.width } : undefined} onMouseOverCapture={() => setHoverSignature(signature)} onFocusCapture={() => setHoverSignature(signature)} onClickCapture={() => setHoverSignature(signature)} onMouseLeave={() => { setHover(null); setActive(null); }}><svg viewBox={`0 0 ${g.width} ${g.height}`} role="group" aria-label={chart.title}>
          <title>{chart.title}</title>
          {[0, 1, 2, 3, 4].map(tick => { const value = g.minimum + (g.maximum - g.minimum) * tick / 4; return <g key={tick}><line x1={g.left} x2={g.right} y1={g.y(value)} y2={g.y(value)} className="grid-line" /><text x={g.left - 10} y={g.y(value) + 4} textAnchor="end">{value.toLocaleString("zh-TW", { maximumFractionDigits: chart.unit === "人" ? 0 : 1 })}</text></g>; })}
          <text className="axis-title" transform={`translate(18 ${(g.top + g.baseline) / 2}) rotate(-90)`} textAnchor="middle">{chart.unit}</text>
          {chart.xLabel && <text className="axis-title" x={(g.left + g.right) / 2} y={g.height - 6} textAnchor="middle">{chart.xLabel}</text>}
          <line x1={g.left} x2={g.left} y1={g.top} y2={g.baseline} className="axis-line" />
          <line x1={g.left} x2={g.right} y1={g.baseline} y2={g.baseline} className="axis-line" />
          {g.minimum < 0 && <line x1={g.left} x2={g.right} y1={g.y(0)} y2={g.y(0)} className="axis-line" />}
          {chart.reference && <line x1={g.left} x2={g.right} y1={g.y(chart.reference.value)} y2={g.y(chart.reference.value)} stroke="#6b7280" strokeWidth={2} strokeDasharray="4 4" />}
          {rows.map((point, index) => <text key={point.label} x={g.x(index)} y={g.baseline + (paired ? 56 : 28)} textAnchor="middle"><title>{point.label}</title>{g.labels[index].map((line, lineIndex) => <tspan key={lineIndex} x={g.x(index)} dy={lineIndex ? 22 : 0}>{line}</tspan>)}</text>)}
          {chart.series.map((series, seriesIndex) => <g key={seriesIndex}>
            {chart.kind === "line" && <path data-motion-key={`series-${seriesIndex}-line`} data-motion-target={JSON.stringify({ d: customLinePath(series.points.map(point => point.value), g.x, g.y) })} data-motion-enter={JSON.stringify({ d: customLinePath(series.points.map(point => point.value == null ? null : 0), g.x, g.y) })} d={customLinePath(series.points.map((point) => point.value), g.x, g.y)} fill="none" stroke={color(seriesIndex)} strokeWidth={3} strokeDasharray={seriesIndex ? "7 4" : undefined} />}
            {series.points.map((point, index) => {
              if (point.value == null) return <text key={point.label} x={g.x(index)} y={g.baseline - 12 - seriesIndex * 20} textAnchor="middle">缺值</text>;
              const barWidth = chart.series.length > 2 ? 40 : Math.min(64, 80 / chart.series.length);
              const cx = g.x(index) + (chart.kind === "bar" ? g.seriesOffset(seriesIndex) : 0);
              const range = point.low != null && point.high != null && Number.isFinite(point.low) && Number.isFinite(point.high);
              const description = `${point.label} · ${series.name}：${formatPolicyValue(point.value, chart.unit)}${range ? `；下限${formatPolicyValue(point.low, chart.unit)}，上限${formatPolicyValue(point.high, chart.unit)}` : ""}`;
              const HitTarget = chart.kind === "bar" ? "rect" : "circle";
              const hitGeometry = chart.kind === "bar" ? { x: cx - 22, y: Math.min(g.y(0), g.y(point.value)) - 4, width: 44, height: Math.max(44, Math.abs(g.y(0) - g.y(point.value)) + 8) } : { cx, cy: g.y(point.value), r: 22 };
              const geometry = chart.kind === "bar" ? { x: cx - barWidth / 2, y: Math.min(g.y(0), g.y(point.value)), width: barWidth, height: Math.abs(g.y(0) - g.y(point.value)) } : { cx, cy: g.y(point.value), r: 7 };
              return <g key={point.label}>
                {chart.kind === "bar" ? <rect {...geometry} data-motion-key={`series-${seriesIndex}-point-${index}`} data-motion-target={JSON.stringify(geometry)} data-motion-enter={JSON.stringify({ y: g.y(0), height: 0 })} rx={4} fill={color(seriesIndex)} /> : <circle {...geometry} data-motion-key={`series-${seriesIndex}-point-${index}`} data-motion-target={JSON.stringify(geometry)} data-motion-enter={JSON.stringify({ cy: g.y(0) })} fill="#fff" stroke={color(seriesIndex)} strokeWidth={3} />}
                {range && <g className="pn-estimate-interval" aria-label={description}>
                  <line data-motion-key={`series-${seriesIndex}-point-${index}-range`} data-motion-target={JSON.stringify({ x1: cx, x2: cx, y1: g.y(point.low!), y2: g.y(point.high!) })} data-motion-enter={JSON.stringify({ y1: g.y(0), y2: g.y(0) })} x1={cx} x2={cx} y1={g.y(point.low!)} y2={g.y(point.high!)} stroke="#374151" strokeWidth={3} />
                  <line data-motion-key={`series-${seriesIndex}-point-${index}-low`} data-motion-target={JSON.stringify({ x1: cx - 12, x2: cx + 12, y1: g.y(point.low!), y2: g.y(point.low!) })} data-motion-enter={JSON.stringify({ y1: g.y(0), y2: g.y(0) })} data-bound="low" x1={cx - 12} x2={cx + 12} y1={g.y(point.low!)} y2={g.y(point.low!)} stroke="#374151" strokeWidth={3} />
                  <line data-motion-key={`series-${seriesIndex}-point-${index}-high`} data-motion-target={JSON.stringify({ x1: cx - 12, x2: cx + 12, y1: g.y(point.high!), y2: g.y(point.high!) })} data-motion-enter={JSON.stringify({ y1: g.y(0), y2: g.y(0) })} data-bound="high" x1={cx - 12} x2={cx + 12} y1={g.y(point.high!)} y2={g.y(point.high!)} stroke="#374151" strokeWidth={3} />
                </g>}
                <HitTarget {...hitGeometry} data-motion-key={`series-${seriesIndex}-point-${index}-hit`} data-motion-target={JSON.stringify(hitGeometry)} data-motion-enter={JSON.stringify(chart.kind === "bar" ? { y: g.y(0) - 4, height: 44 } : { cy: g.y(0) })} fill="transparent" tabIndex={0} role="button" aria-label={description}
                  onMouseEnter={() => { setActive(description); setHover({ x: cx, y: g.y(point.value!), label: point.label + " · " + series.name, value: description.split("：").slice(1).join("：") }); }}
                  onFocus={() => { setActive(description); setHover({ x: cx, y: g.y(point.value!), label: point.label + " · " + series.name, value: description.split("：").slice(1).join("：") }); }}
                  onBlur={() => setHover(null)} onClick={() => { setActive(description); setHover({ x: cx, y: g.y(point.value!), label: point.label + " · " + series.name, value: description.split("：").slice(1).join("：") }); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(description); setHover({ x: cx, y: g.y(point.value!), label: point.label + " · " + series.name, value: description.split("：").slice(1).join("：") }); } }}><title>{description}</title></HitTarget>
              </g>;
            })}
          </g>)}
          {pointPair && (() => {
            const difference = policyPointDifference(pointPair[0].value, pointPair[1].value, chart.unit);
            if (!difference) return null;
            const bracketY = g.y(Math.max(0, ...pointPair.map(point => Math.max(point.value!, point.high ?? point.value!)))) - 20;
            return <g data-motion-label="true" className={`pn-difference ${difference.value > 0 ? "is-positive" : difference.value < 0 ? "is-negative" : "is-zero"}`} aria-label={`${pointPair[1].label}減${pointPair[0].label}：${difference.label}`}><path d={`M ${g.x(0)} ${bracketY + 8} V ${bracketY} H ${g.x(1)} V ${bracketY + 8}`} fill="none" strokeWidth={2} /><text x={(g.x(0) + g.x(1)) / 2} y={bracketY - 8} textAnchor="middle">{difference.label}</text></g>;
          })()}
          {paired && rows.flatMap((row, index) => chart.comparisonGroups!.map(group => <text key={`${row.label}-${group.label}`} x={g.x(index) + (g.seriesOffset(group.left) + g.seriesOffset(group.right)) / 2} y={g.baseline + 25} textAnchor="middle">{group.label}</text>))}
          {(chart.comparisonGroups ?? (pair ? [pair] : [])).flatMap(pair => rows.map((row, index) => {
            const a = chart.series[pair.left].points[index], b = chart.series[pair.right].points[index];
            const difference = policyPointDifference(a?.value, b?.value, chart.unit);
            if (!difference) return null;
            const xa = g.x(index) + (chart.kind === "bar" ? g.seriesOffset(pair.left) : -28);
            const xb = g.x(index) + (chart.kind === "bar" ? g.seriesOffset(pair.right) : 28);
            const bracketY = g.y(Math.max(0, a.value!, b.value!, a.high ?? a.value!, b.high ?? b.value!)) - 20;
            return <g key={`difference-${pair.left}-${row.label}`} data-motion-label="true" className={`pn-difference ${difference.value > 0 ? "is-positive" : difference.value < 0 ? "is-negative" : "is-zero"}`} aria-label={`${row.label}，${chart.series[pair.right].name}減${chart.series[pair.left].name}：${difference.label}`}>
              <path d={`M ${xa} ${bracketY + 8} V ${bracketY} H ${xb} V ${bracketY + 8}`} fill="none" strokeWidth={2} />
              <text x={(xa + xb) / 2} y={bracketY - 8} textAnchor="middle">{difference.label}</text>
            </g>;
          }))}
        </svg>{hover && hoverSignature === signature && <QuadrantPointTooltip x={hover.x} y={hover.y} width={g.width} height={g.height} title={hover.label} identity={chart.identity}>{hover.value}</QuadrantPointTooltip>}</ChartCanvas>
      </div>
      <p className="pn-chart-readout" aria-live="polite">{hoverSignature === signature && active ? active : "移到長條或資料點查看數值；手機可點選。"}</p>
      <div className="pn-chart-legend">{chart.series.map((series, index) => <span key={series.name}><i style={{ borderColor: color(index), borderTopStyle: chart.kind === "line" && index ? "dashed" : "solid" }} />{series.name}</span>)}</div>
      {hasRange && <details className="pn-details"><summary>查看點估計與上下限</summary><ul className="pn-range-values" aria-label="點估計及模型上下限">{chart.series.flatMap((series) => series.points.filter((point) => point.value != null && point.low != null && point.high != null).map((point) => <li key={series.name + point.label}><strong>{point.label} · {series.name}</strong><span>點估計 {formatPolicyValue(point.value, chart.unit)}</span><span>下限 {formatPolicyValue(point.low, chart.unit)}</span><span>上限 {formatPolicyValue(point.high, chart.unit)}</span></li>))}</ul></details>}
    </>}
    {chart.reference && <p className="pn-range-note">灰色虛線：{chart.reference.label} {formatPolicyValue(chart.reference.value, chart.unit)}</p>}
    {hasRange && <p className="pn-range-note">灰色線：模型敏感度上下限。</p>}
    {chart.composition && <p className="pn-range-note">各教育程度分別為分母；同一教育程度的四種婚姻占比合計100%。</p>}
    <PolicyChartTable chart={chart} />
    {chart.detailTable && <details className="pn-details"><summary>{chart.detailTable.title}</summary><div className="pn-table-scroll"><table className="pn-compact-table"><caption>{chart.detailTable.title}；{chart.period}；{chart.sex}</caption><thead><tr>{chart.detailTable.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{chart.detailTable.rows.map((row, index) => <tr key={index}>{row.map((value, column) => column === 0 ? <th key={column} scope="row">{value}</th> : <td key={column}>{value}</td>)}</tr>)}</tbody></table></div></details>}
  </figure>;
}

function PolicyChartTable({ chart }: { chart: EvidenceChart }) {
  const rows = chart.series[0]?.points ?? [];
  const compact = chart.series.length <= 2;
  const cell = (point: EvidenceChart["series"][number]["points"][number] | undefined) => <>{formatPolicyValue(point?.value, chart.unit)}{point?.low != null && point.high != null && <small className="pn-table-range">下限 {formatPolicyValue(point.low, chart.unit)}<br />上限 {formatPolicyValue(point.high, chart.unit)}</small>}</>;
  return <details className="pn-details"><summary>查看圖表資料表</summary><div className="pn-table-scroll"><table className="pn-compact-table"><caption>{chart.title}；{chart.period}；{chart.sex}</caption><thead><tr><th scope="col">年度／類別</th>{compact ? chart.series.map(series => <th key={series.name} scope="col">{series.name}（{chart.unit}）</th>) : <><th scope="col">比較組</th><th scope="col">數值（{chart.unit}）</th></>}</tr></thead><tbody>{compact ? rows.map((point, index) => <tr key={point.label}><th scope="row">{point.label}{chart.series.length === 2 && <small className="pn-table-range">差距 {policyPointDifference(chart.series[0].points[index]?.value, chart.series[1].points[index]?.value, chart.unit)?.label ?? "尚無資料"}</small>}</th>{chart.series.map(series => <td key={series.name}>{cell(series.points[index])}</td>)}</tr>) : rows.flatMap((point, index) => chart.series.map(series => <tr key={point.label + series.name}><th scope="row">{point.label}</th><td>{series.name}</td><td>{cell(series.points[index])}</td></tr>))}</tbody></table></div></details>;
}

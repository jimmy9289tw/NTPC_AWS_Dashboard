"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { createCustomChartLayout, customLinePath, type AxisLabelMode } from "./custom-chart-layout";
import { chartMotionKey, useChartTransition } from "./chart-transition";
import "./custom-analysis-chart.css";

const colors = ["#2563eb", "#0f766e", "#b45309", "#7c3aed", "#be123c", "#0369a1", "#475569", "#4d7c0f"];
const number = (value: number) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value);
type Point = { x: string; series: string; value: number };

export function CustomAnalysisChart({ rows, xValues, seriesValues, metric, unit, dimension, dimensionLabel, kind, yMax }: {
  rows: Point[]; xValues: string[]; seriesValues: string[]; metric: string; unit: string;
  dimension: string; dimensionLabel: string; kind: "bar" | "line"; yMax: number;
}) {
  const [labelMode, setLabelMode] = useState<AxisLabelMode>("auto");
  const [selectedX, setSelectedX] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(640);
  const viewport = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const canvasId = useId();
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setViewportWidth(Math.max(1, element.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = createCustomChartLayout({ labels: xValues, dimension, labelMode, viewportWidth, seriesCount: seriesValues.length, kind, yMax });
  const activeX = selectedX != null && xValues.includes(selectedX) ? selectedX : xValues[0];
  const pointAt = new Map(rows.map((row) => [`${row.x}\u0000${row.series}`, row]));
  const overflowing = layout.width > viewportWidth + 1;
  const modeName = layout.mode === "vertical" ? "直向排列" : layout.mode === "slant" ? "45°斜排" : "橫向換行";
  const pointInteraction = (row: Point) => ({
    role: "button", tabIndex: 0,
    "aria-label": `${row.x}，${row.series}，${number(row.value)}${unit}`,
    onMouseEnter: () => setSelectedX(row.x),
    onFocus: () => setSelectedX(row.x),
    onClick: () => setSelectedX(row.x),
    onKeyDown: (event: KeyboardEvent<SVGElement>) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedX(row.x); }
    },
  });
  function selectCategory(x: string) {
    setSelectedX(x);
    const element = viewport.current;
    if (element) element.scrollTo({ left: Math.max(0, layout.xAt(xValues.indexOf(x)) - element.clientWidth / 2) });
  }

  const chartTransition = useChartTransition(chartMotionKey(rows, xValues, seriesValues, metric, unit, dimension, kind, yMax, labelMode));
  return <div className="diy-chart">
    <div className="diy-chart-toolbar">
      <div className="diy-axis-heading"><span>Y軸</span><strong>{metric}（{unit}）</strong></div>
      <label>標籤排列<select value={labelMode} onChange={(event) => setLabelMode(event.target.value as AxisLabelMode)}>
        <option value="auto">自動（目前：{modeName}）</option>
        <option value="wrap">橫向換行</option><option value="slant">45°斜排</option><option value="vertical">直向排列</option>
      </select></label>
    </div>
    <div className="diy-scroll-guide" id={instructionsId}>
      <p>{xValues.length}個比較項目 · 完整名稱不省略。{overflowing ? "可左右捲動圖表；Y軸刻度固定在左側。" : "指向資料點或使用下方選單查看數值。"}</p>
      {overflowing && <div className="diy-scroll-buttons">
        <button type="button" aria-controls={canvasId} aria-label="向左捲動圖表" onClick={() => viewport.current?.scrollBy({ left: -viewportWidth * 0.75 })}>← 往左</button>
        <button type="button" aria-controls={canvasId} aria-label="向右捲動圖表" onClick={() => viewport.current?.scrollBy({ left: viewportWidth * 0.75 })}>往右 →</button>
      </div>}
    </div>
    <div className="diy-chart-frame" ref={chartTransition} style={{ gridTemplateColumns: `${layout.yAxisWidth}px minmax(0, 1fr)` }}>
      <svg className="diy-y-axis" width={layout.yAxisWidth} height={layout.height} aria-hidden="true">
        {layout.ticks.map((tick, index) => <text key={tick} x={layout.yAxisWidth - 12} y={layout.yAt(tick) + 5} textAnchor="end">{layout.tickLabels[index]}</text>)}
        <line x1={layout.yAxisWidth - 1} x2={layout.yAxisWidth - 1} y1={layout.top} y2={layout.yAt(0)} className="axis-line" />
      </svg>
      {/* Keyboard focus enables native arrow-key scrolling; this region is not a button. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="diy-chart-viewport" id={canvasId} ref={viewport} role="region" tabIndex={0} aria-label={`${metric}圖表，可左右捲動`} aria-describedby={instructionsId}>
        <svg className="diy-chart-canvas" width={layout.width} height={layout.height} role="group" aria-label={`${metric}依${dimensionLabel}比較，單位${unit}`}>
          {layout.ticks.map((tick) => <line key={tick} x1={0} x2={layout.width} y1={layout.yAt(tick)} y2={layout.yAt(tick)} className="grid-line" />)}
          <line x1={0} x2={layout.width} y1={layout.yAt(0)} y2={layout.yAt(0)} className="axis-line" />
          {xValues.map((x, index) => <g key={x} transform={`translate(${layout.xAt(index)} ${layout.yAt(0) + 26})`}>
            <line y1={-26} y2={-20} className="axis-line" />
            <text className="diy-x-label" textAnchor={layout.mode === "slant" ? "end" : "middle"} transform={layout.mode === "slant" ? "rotate(-45)" : undefined}>
              <title>{x}</title>{layout.lines[index].map((line, lineIndex) => <tspan key={lineIndex} x={0} dy={lineIndex ? 22 : 0}>{line}</tspan>)}
            </text>
          </g>)}
          {seriesValues.map((series, seriesIndex) => {
            const color = colors[seriesIndex % colors.length];
            const values = xValues.map((x) => pointAt.get(`${x}\u0000${series}`));
            return <g key={series}>
              {kind === "line" && <path d={customLinePath(values.map((row) => row?.value), layout.xAt, layout.yAt)} fill="none" stroke={color} strokeWidth={3} strokeDasharray={seriesIndex % 3 === 1 ? "8 4" : seriesIndex % 3 === 2 ? "3 3" : undefined} />}
              {values.map((row, index) => {
                if (!row) return null;
                const cx = layout.xAt(index);
                const cy = layout.yAt(row.value);
                return kind === "line"
                  ? <circle key={row.x} cx={cx} cy={cy} r={6} fill="#fff" stroke={color} strokeWidth={3} {...pointInteraction(row)}><title>{`${row.x} · ${series}：${number(row.value)}${unit}`}</title></circle>
                  : <rect key={row.x} x={cx - seriesValues.length * (layout.barWidth + 4) / 2 + seriesIndex * (layout.barWidth + 4) + 2} y={cy} width={layout.barWidth} height={layout.yAt(0) - cy} rx={3} fill={color} {...pointInteraction(row)}><title>{`${row.x} · ${series}：${number(row.value)}${unit}`}</title></rect>;
              })}
            </g>;
          })}
        </svg>
      </div>
    </div>
    <p className="diy-x-heading"><span>X軸</span> {dimensionLabel}</p>
    <div className="diy-point-readout">
      <label>查看數值<select value={activeX ?? ""} onChange={(event) => selectCategory(event.target.value)}>{xValues.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      <dl aria-live="polite" aria-atomic="true">{seriesValues.map((series, index) => {
        const row = pointAt.get(`${activeX}\u0000${series}`);
        return <div key={series}><dt><i aria-hidden="true" style={{ background: colors[index % colors.length] }} />{series}</dt><dd>{row ? `${number(row.value)} ${unit}` : "無可用數值"}</dd></div>;
      })}</dl>
    </div>
    <ul className="diy-chart-legend" aria-label="圖例">{seriesValues.map((series, index) => <li key={series}><i aria-hidden="true" style={{ borderTopColor: colors[index % colors.length], borderTopStyle: kind === "line" && index % 3 ? "dashed" : "solid" }} />{series}</li>)}</ul>
    {kind === "line" && dimension !== "year" && <p className="diy-chart-note">這張折線連接不同類別，不代表時間趨勢；比較行政區高低時也可切換長條圖。</p>}
  </div>;
}

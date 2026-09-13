import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createCustomChartLayout, customLinePath, roundAxisMaximum, wrapAxisLabel } from "../app/custom-chart-layout.ts";

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
  return nextLoad(url, context);
} });
const { CustomAnalysisChart } = await import("../app/custom-analysis-chart.tsx");
const districts = ["板橋區", "三重區", "中和區", "永和區", "新莊區", "新店區", "樹林區", "鶯歌區", "三峽區", "淡水區", "汐止區", "瑞芳區", "土城區", "蘆洲區", "五股區", "泰山區", "林口區", "深坑區", "石碇區", "坪林區", "三芝區", "石門區", "八里區", "平溪區", "雙溪區", "貢寮區", "金山區", "萬里區", "烏來區"];
const defaults = { labels: districts, dimension: "geography", labelMode: "auto", viewportWidth: 720, seriesCount: 4, kind: "line", yMax: 4000000 };

test("29 districts keep every character and spacing at mobile through desktop widths", () => {
  for (const viewportWidth of [190, 320, 540, 820, 1200]) {
    const layout = createCustomChartLayout({ ...defaults, viewportWidth });
    assert.equal(layout.mode, "vertical");
    assert.equal(layout.lines.length, 29);
    assert.deepEqual(layout.lines.map((lines) => lines.join("")), districts);
    assert.ok(layout.slotWidth >= 56);
    assert.ok(layout.width >= viewportWidth);
    assert.ok(layout.xAt(0) > 16);
    assert.ok(layout.xAt(28) < layout.width - 16);
    assert.ok(layout.yAt(0) + 26 + 2 * 22 < layout.height - 16);
  }
});

test("eight grouped bars never overlap neighbouring categories", () => {
  const layout = createCustomChartLayout({ ...defaults, kind: "bar", seriesCount: 8, viewportWidth: 200 });
  const groupWidth = (layout.barWidth + 4) * 8;
  assert.ok(layout.barWidth >= 16);
  assert.ok(groupWidth <= layout.slotWidth - 24);
  assert.ok(layout.xAt(1) - groupWidth / 2 > layout.xAt(0) + groupWidth / 2);
});

test("five annual labels stay horizontal and fit a normal desktop plot", () => {
  const layout = createCustomChartLayout({ ...defaults, labels: ["110年", "111年", "112年", "113年", "114年"], dimension: "year", viewportWidth: 720 });
  assert.equal(layout.mode, "wrap");
  assert.equal(layout.width, 720);
  assert.ok(layout.lines.every((lines) => lines.length === 1));
});

test("long industry names wrap without truncation and reserve vertical space", () => {
  const label = "專業、科學及技術服務業與支援服務";
  assert.equal(wrapAxisLabel(label).join(""), label);
  assert.ok(wrapAxisLabel(label).length > 1);
  for (const labelMode of ["wrap", "slant", "vertical"]) {
    const layout = createCustomChartLayout({ ...defaults, labels: [label, "其他服務業"], labelMode });
    assert.equal(layout.lines[0].join(""), label);
    assert.ok(layout.height > layout.top + layout.plotHeight + 40);
    if (labelMode === "slant") assert.ok(layout.left > 100, "leftmost diagonal label must remain inside the canvas");
  }
});

test("Y ticks retain full quantities and the existing scale rounding", () => {
  assert.equal(roundAxisMaximum(845938), 900000);
  assert.equal(roundAxisMaximum(45.6), 50);
  const layout = createCustomChartLayout(defaults);
  assert.deepEqual(layout.tickLabels, ["4,000,000", "3,000,000", "2,000,000", "1,000,000", "0"]);
  assert.ok(layout.yAxisWidth >= 88);
  assert.equal(layout.yAt(0), layout.top + layout.plotHeight);
  assert.equal(layout.yAt(defaults.yMax), layout.top);
});

test("missing observations break lines, never fill a gap or alter values", () => {
  const values = [12.34, null, 23.45, 0, undefined, 8.76];
  const before = [...values];
  const path = customLinePath(values, (index) => index * 10, (value) => value);
  assert.equal(path, "M0,12.34 M20,23.45 L30,0 M50,8.76");
  assert.deepEqual(values, before);
});

test("rendered chart exposes full names, fixed Y axis, controls and exact value readout", () => {
  const rows = districts.map((x, index) => ({ x, series: "18–35歲", value: 1000 + index }));
  const before = JSON.stringify(rows);
  const html = renderToStaticMarkup(createElement(CustomAnalysisChart, {
    rows, xValues: districts, seriesValues: ["18–35歲"], metric: "青年戶籍人口密度", unit: "人／平方公里",
    dimension: "geography", dimensionLabel: "地理範圍", kind: "line", yMax: 2000,
  }));
  assert.match(html, /diy-y-axis/);
  assert.match(html, /青年戶籍人口密度（人／平方公里）/);
  assert.match(html, /Y軸刻度固定在左側/);
  assert.match(html, /標籤排列/);
  assert.match(html, /查看數值/);
  assert.match(html, /1,000 人／平方公里/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /向右捲動圖表/);
  assert.match(html, /不代表時間趨勢/);
  assert.doesNotMatch(html, /viewBox=/, "do not scale all text to a fixed SVG width");
  for (const district of districts) assert.ok(html.includes(`<title>${district}</title>`));
  assert.equal(JSON.stringify(rows), before);
});

test("table alternative includes all filtered series rather than only the eight chart series", async () => {
  const source = await readFile(new URL("../app/custom-analysis-workbench.tsx", import.meta.url), "utf8");
  assert.match(source, /presentedRows = chartKind === "table" \? chartRows : visibleRows/);
  assert.match(source, /<tbody>\{presentedRows\.map/);
  assert.match(source, /CustomAnalysisChart rows=\{visibleRows\}/);
});

test("chart CSS keeps overflow local, readable fonts and keyboard focus", async () => {
  const css = await readFile(new URL("../app/custom-analysis-chart.css", import.meta.url), "utf8");
  assert.match(css, /\.diy-chart-viewport \{[^}]*overflow-x: auto/);
  assert.match(css, /\.diy-chart \.diy-x-label \{[^}]*font-size: 16px/);
  assert.match(css, /\.diy-chart \.diy-y-axis text \{[^}]*font-size: 14px/);
  assert.match(css, /focus-visible/);
  assert.match(css, /min-height: 44px/);
  assert.doesNotMatch(css, /text-overflow:\s*ellipsis/);
});

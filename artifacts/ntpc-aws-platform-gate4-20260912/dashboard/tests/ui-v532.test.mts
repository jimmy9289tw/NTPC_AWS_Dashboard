import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { quickAnnualExportContext, type ExportSelection } from "../app/export-catalogue.ts";
import { validateExportSelection } from "../app/export-selection.ts";
import { navigationLabels, entryPeriods } from "../app/workspace-presentation.ts";
import { modalFocusTarget } from "../app/modal-interaction.ts";
import { chartReadingScale, chartLabelLines, isNumericAxis, ChartCanvas } from "../app/chart-canvas.tsx";
import { NarrativeChart } from "../app/policy-evidence-chart.tsx";
import { tooltipPosition } from "../app/quadrant-chart-primitives.tsx";
import { chartTransitionDuration, chartValueRevealDelay } from "../app/chart-transition.ts";
import type { EvidenceChart } from "../app/policy-narrative.ts";

const read = (name: string) => readFileSync(new URL("../app/" + name, import.meta.url), "utf8");
const context: ExportSelection = { topic: "population", years: [113], ages: ["30-35"], sexes: ["女"], districts: ["淡水區"] };

test("三母體快速下載只讀目前可見單選條件，不回退頁面舊值", () => {
  const normalized = validateExportSelection(context);
  assert.deepEqual(quickAnnualExportContext(normalized), { year: 113, ageBand: "30-35", sex: "女", district: "淡水區" });
  assert.equal(quickAnnualExportContext({ ...context, years: [112,113] }), null);
  assert.equal(quickAnnualExportContext({ ...context, ages: [] }), null);
  assert.equal(quickAnnualExportContext({ ...context, sexes: ["合計","女"] }), null);
  assert.equal(quickAnnualExportContext({ ...context, districts: ["新北市","淡水區"] }), null);
  assert.equal(quickAnnualExportContext({ ...context, years: [NaN] }), null);
  assert.equal(quickAnnualExportContext({ topic: "facilities", years: [115], ages: ["不適用"], sexes: ["不適用"], districts: ["淡水區"] }), null);
  const client = read("dashboard-client.tsx"), exporter = read("export-center.tsx");
  assert.match(client, /!\["overview", "policy", "custom", "export"\]\.includes\(activeView\)/);
  assert.match(exporter, /kind: "data", universe, \.\.\.quickContext/);
  assert.match(exporter, /kind, selection, fields: effectiveFields/);
  assert.doesNotMatch(exporter, /universe, year, ageBand, sex, district/);
  assert.match(client, /activeView === "export" \? "#export-center"/);
});

test("簡稱涵蓋八入口，保留完整可存取名稱、權限及薪資實際年度", () => {
  assert.equal(Object.keys(navigationLabels).length, 9);
  assert.equal(Object.keys(entryPeriods).length, 8);
  assert.match(entryPeriods.wage, /113.*114年待發布/);
  const ui = read("dashboard-client.tsx");
  assert.match(ui, /aria-label=\{viewConfig\[view\]\.label\}/);
  assert.match(ui, /aria-label="AI問資料"/);
  assert.match(ui, /visibleEntryViews\.map/);
  assert.match(ui, /只影響本圖/);
  assert.match(ui, /本頁共用條件/);
  assert.match(ui, /資料範圍與更新/);
});

test("抽屜焦點循環：Tab、Shift-Tab、容器及空狀態", () => {
  const a = {} as HTMLElement, b = {} as HTMLElement, c = {} as HTMLElement;
  assert.equal(modalFocusTarget([a,b,c], c, false), a);
  assert.equal(modalFocusTarget([a,b,c], a, true), c);
  assert.equal(modalFocusTarget([a,b,c], b, false), null);
  assert.equal(modalFocusTarget([a,b,c], null, false), a);
  assert.equal(modalFocusTarget([a,b,c], null, true), c);
  assert.equal(modalFocusTarget([a], a, false), a);
  assert.equal(modalFocusTarget([], a, false), null);
  const modal = read("modal-interaction.ts"), client = read("dashboard-client.tsx");
  assert.match(modal, /isTop\(\)/); assert.match(modal, /previous\?\.isConnected/);
  assert.match(modal, /doc\.body\.style\.overflow = bodyOverflow/);
  assert.match(modal, /close\.current = onClose/);
  assert.match(client, /useModalInteraction\(chatOpen, chatPanelRef/);
  assert.match(client, /useModalInteraction\(menuOpen, menuPanelRef/);
  assert.match(client, /useModalInteraction\(!!signal, drawerRef/);
});

test("圖表閱讀容器保留原始圖形和數值；窄畫面最小字體不小於14px", () => {
  const industry = "醫療保健及社會工作服務業";
  const lines = chartLabelLines(industry);
  assert.equal(lines.join(""), industry);
  assert.ok(lines.every(line => Array.from(line).length <= 12));
  assert.equal(isNumericAxis([{text:"940,000"},{text:"915,000"},{text:"人"}]), true);
  assert.equal(isNumericAxis([{text:"10.0%"},{text:"-10.0%"}]), true);
  assert.equal(isNumericAxis([{text:industry},{text:"製造業"}]), false);
  for (const width of [620, 680, 860, 1160]) {
    const mobile = chartReadingScale(width, 342);
    assert.equal(mobile.overflow, true);
    assert.ok(mobile.minimum / width * 16 >= 14);
    assert.equal(chartReadingScale(width, width).overflow, false);
  }
  const html = renderToStaticMarkup(createElement(ChartCanvas, { className: "chart-canvas", "aria-label": "年度比較" }, createElement("svg", { viewBox: "0 0 620 285" }, createElement("rect", { y: 10, height: 85, "aria-label": "113年 85%" }))));
  assert.match(html, /role="region" tabindex="0"/);
  assert.match(html, /aria-label="113年 85%"/);
  assert.match(html, /height="85"/);
  assert.match(html, /readable-plot-scroll/);
  const canvas = read("chart-canvas.tsx");
  assert.match(canvas, /data-values-pending/);
  assert.match(canvas, /chart-tap-readout/);
  assert.match(canvas, /aria-hidden="true" viewBox/);
  assert.equal(chartTransitionDuration, 2000);
  assert.equal(chartValueRevealDelay, 2100);
});

test("政策圖上下限預設收合，但數字、差距、誤差線與表格仍完整", () => {
  const chart: EvidenceChart = { title: "有偶占比", kind: "bar", unit: "%", universe: "戶籍人口", period: "114年", sex: "合計", identity: "模型估計", method: "原方法", sources: [], limitation: "", series: [
    { name: "新北市", points: [{ label: "114年", value: 16.33, low: 16, high: 17 }] },
    { name: "淡水區", points: [{ label: "114年", value: 19.19, low: 18, high: 20 }] },
  ] };
  const before = JSON.stringify(chart);
  const html = renderToStaticMarkup(createElement(NarrativeChart, { chart }));
  assert.match(html, /<details class="pn-details"><summary>查看點估計與上下限/);
  assert.match(html, /\+2.86個百分點/);
  assert.match(html, /data-bound="low"/); assert.match(html, /data-bound="high"/);
  assert.match(html, /查看圖表資料表/); assert.match(html, /19.19/);
  assert.equal(JSON.stringify(chart), before);
  assert.match(read("policy-narrative-workbench.tsx"), /!items\.length \? " is-empty"/);
  assert.match(read("policy-narrative.css"), /\.pn-status-column\.is-empty/);
});

test("提示框依SVG實際大小定位、不被橫向捲動容器裁切", () => {
  const placement = tooltipPosition({ left: 390, top: 5 }, { width: 250, height: 100 }, { width: 390, height: 844 });
  assert.ok(placement.left >= 8 && placement.left + 250 <= 382);
  assert.ok(placement.top >= 8);
  const tooltip = read("quadrant-chart-primitives.tsx");
  assert.match(tooltip, /plot\.left \+ x \/ width \* plot\.width/);
  assert.match(tooltip, /createPortal/);
  assert.match(tooltip, /window\.addEventListener\("scroll", update, true\)/);
  assert.doesNotMatch(read("dashboard-client.tsx"), /<div className="chart-point-tooltip/);
});

test("共用樣式保留差值正負色、觸控尺寸、可捲動表格首欄與列印", () => {
  const css = read("workspace-ui.css");
  assert.match(css, /--text-body: 1rem/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /position: sticky; left: 0/);
  assert.match(css, /@media print/);
  assert.doesNotMatch(css, /\.chart-canvas svg text[^}]*fill:/);
  assert.match(css, /\.home-monthly \{ grid-template-columns: minmax\(0, 1fr\)/);
  function contrast(hex: string, background: string) {
    const luminance = (color: string) => {
      const rgb = color.match(/\w\w/g)!.map(value => parseInt(value,16)/255).map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
      return rgb[0]*.2126 + rgb[1]*.7152 + rgb[2]*.0722;
    };
    const a = luminance(hex), b = luminance(background); return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  }
  for (const text of ["19324a","475f70","0f766e"]) assert.ok(contrast(text,"f5f8fa") >= 4.5);
});

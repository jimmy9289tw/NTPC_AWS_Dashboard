import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NarrativeChart, policyChartGeometry, policyPointDifference } from "../app/policy-evidence-chart.tsx";
import { chartValueRevealDelay, deferChartValues, startChartTransition } from "../app/chart-transition.ts";
import { monthlyPopulationView } from "../app/monthly-population-view.ts";
import { monthlyPopulationData } from "../app/monthly-population.ts";
import type { EvidenceChart } from "../app/policy-narrative.ts";

const chart: EvidenceChart = { title: "有偶占比", unit: "%", kind: "bar", universe: "戶籍人口", period: "113、114年", sex: "合計", identity: "模型估計", method: "原交叉表", sources: [], limitation: "", series: [
  { name: "新北市", points: [{ label: "113年", value: 16.33, low: 16.33, high: 16.77 }, { label: "114年", value: 15.81, low: 15.81, high: 16.22 }] },
  { name: "八里區", points: [{ label: "113年", value: 19.19, low: 19.19, high: 19.51 }, { label: "114年", value: 18.96, low: 18.96, high: 19.32 }] }
] };

test("差距以顯示後數字右減左：正負、百分點、零與缺值", () => {
  assert.deepEqual(policyPointDifference(16.33, 19.19, "%"), { value: 2.86, label: "+2.86個百分點" });
  assert.deepEqual(policyPointDifference(19.19, 16.33, "%"), { value: -2.86, label: "-2.86個百分點" });
  assert.equal(policyPointDifference(16.334, 19.186, "%")?.value, 2.86);
  assert.equal(policyPointDifference(0, 0, "人")?.label, "0人");
  assert.equal(policyPointDifference(15, 25, "人")?.label, "+10人");
  assert.equal(policyPointDifference(null, 25, "%"), null);
  assert.equal(policyPointDifference(NaN, 25, "%"), null);
});

test("每年一個ㄇ形括號，保留上下限、資料表與單位，括號高於上界", () => {
  const html = renderToStaticMarkup(createElement(NarrativeChart, { chart }));
  assert.equal((html.match(/class="pn-difference is-positive"/g) ?? []).length, 2);
  assert.match(html, /\+2.86個百分點/); assert.match(html, /\+3.15個百分點/);
  assert.equal((html.match(/data-bound="low"/g) ?? []).length, 4);
  assert.equal((html.match(/data-bound="high"/g) ?? []).length, 4);
  assert.match(html, /data-motion-enter/); assert.match(html, /pn-compact-table/);
  const g = policyChartGeometry(chart);
  assert.ok(g.y(19.51) - 28 > 0);
  assert.equal(g.maximum, 20);
  assert.ok(g.y(19.51) - 20 < g.y(19.51));
});

test("新掛載長條從零長到終值；快速切換保留React原定終點", () => {
  const oldRaf = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  let tick: FrameRequestCallback = () => {};
  globalThis.requestAnimationFrame = cb => { tick = cb; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const attributes: Record<string, string> = { y: "20", height: "80" };
    const mark = { tagName: "rect", dataset: { motionTarget: JSON.stringify({ y: 20, height: 80 }), motionEnter: JSON.stringify({ y: 100, height: 0 }) }, hasAttribute: (key: string) => key in attributes, getAttribute: (key: string) => attributes[key], setAttribute: (key: string, value: string) => { attributes[key] = value; } };
    const element = { querySelectorAll: () => [mark] } as unknown as Element;
    const first = startChartTransition(element, new Map(), false, true);
    assert.equal(attributes.height, "0"); tick(0); tick(1000); assert.equal(attributes.height, "40"); first.cancel();
    // React skips an unchanged height=80 prop; DOM is still height=40.
    const next = startChartTransition(element, first.snapshot, false);
    assert.equal(attributes.height, "40"); tick(2000); tick(4000); assert.equal(attributes.height, "80");
    next.cancel();
    startChartTransition(element, new Map(), true, true); assert.equal(attributes.height, "80");
  } finally { globalThis.requestAnimationFrame = oldRaf; globalThis.cancelAnimationFrame = oldCancel; }
});

test("數字2100毫秒後出現；重選取消舊計時器；減少動態不隱藏", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const attrs = new Map<string,string>();
  const element = { setAttribute: (key:string,value:string) => attrs.set(key,value), removeAttribute: (key:string) => attrs.delete(key) } as unknown as Element;
  let cancel = deferChartValues(element, false);
  assert.equal(chartValueRevealDelay, 2100);
  context.mock.timers.tick(2000); assert.equal(attrs.get("data-values-pending"), "true");
  context.mock.timers.tick(100); assert.equal(attrs.has("data-values-pending"), false);
  cancel(); cancel = deferChartValues(element, false);
  context.mock.timers.tick(1000); cancel();
  const next = deferChartValues(element, false);
  context.mock.timers.tick(1100); assert.equal(attrs.has("data-values-pending"), true);
  context.mock.timers.tick(1000); assert.equal(attrs.has("data-values-pending"), false); next();
  deferChartValues(element, true); assert.equal(attrs.has("data-values-pending"), false);
});

test("每個月份均擷取110–114五個官方月底值，不把月份相加", () => {
  const input = monthlyPopulationData.records.filter(row => row.geography === "新北市" && row.ageBand === "18-35" && row.sex === "合計");
  assert.equal(input.length, 60);
  assert.equal(monthlyPopulationView(input, "continuous", 12).rows.length, 60);
  for (let month = 1; month <= 12; month++) {
    const view = monthlyPopulationView(input, "same-month", month);
    assert.deepEqual(view.rows.map(row => row.year), [110,111,112,113,114]);
    assert.ok(view.rows.every(row => row.month === month));
    assert.equal(view.difference, view.rows[4].population - view.rows[3].population);
  }
  assert.equal(monthlyPopulationView(input, "same-month", 12).latest?.population, 845938);
});

test("同月比較無前一年或分母為零不補造年增率", () => {
  const view = monthlyPopulationView([{ year: 112, month: 1, population: 0 }, { year: 114, month: 1, population: 10 }], "same-month", 1);
  assert.equal(view.difference, null); assert.equal(view.annualChange, null); assert.equal(view.windowChange, null);
  assert.equal(monthlyPopulationView([], "same-month", 12).latest, undefined);
});

test("據點資訊僅位於M；表格有局部寬度規則；數字標籤延遲但軸標保留", () => {
  const source = (path: string) => readFileSync(new URL("../app/" + path, import.meta.url), "utf8");
  const workbench = source("policy-narrative-workbench.tsx");
  assert.doesNotMatch(workbench.split('<Stage code="A"')[1].split('<Stage code="M"')[0], /<FacilityReferences/);
  assert.match(workbench.split('<Stage code="M"')[1].split('<Stage code="E"')[0], /<FacilityReferences/);
  assert.doesNotMatch(workbench, /key={displayCase.chart.title}/);
  assert.match(source("policy-narrative.css"), /\.pn-chart table {[^}]*min-width: 0/);
  assert.match(source("globals.css"), /\.youth-industry-wage-matrix \.salary-matrix-scroll {[^}]*max-width: 800px/);
  const client = source("dashboard-client.tsx");
  for (const name of ["JointEducationMarriageChart", "IndustryRankingChart", "YouthIndustryWageMatrix"]) assert.match(client.split(`function ${name}(`)[1].split("\nfunction ")[0], /data-motion-label="true"/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPolicyInventory, policyExecutionPlan } from "../app/policy-synthesis.ts";
import { buildDistrictPolicySignal } from "../app/policy-engine.ts";
import { buildPolicyCases, policyStateLabel } from "../app/policy-narrative.ts";
import { getDistrictPolicyEvidence } from "../app/district-policy-evidence.ts";
import { dashboardData, getWage } from "../app/dashboard-data.ts";

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
  return nextLoad(url, context);
} });
const { PolicyNarrativeWorkbench, PolicyStatusBoard, EvidenceDrawer } = await import("../app/policy-narrative-workbench.tsx");
const { NarrativeChart, policyChartGeometry } = await import("../app/policy-evidence-chart.tsx");
const { citywideSignals } = await import("../app/policy-workflow.tsx");
const context = { scope: "district", district: "淡水區", year: 114, ageBand: "18-35", sex: "合計" };
function districtSignal(ctx) {
  const e = getDistrictPolicyEvidence(ctx.year, ctx.district, ctx.ageBand, ctx.sex);
  return buildDistrictPolicySignal({ ...e, rank: e.populationRank, ageLabel: ctx.ageBand });
}

test("district inventory includes priority, monitoring and missing branches without inheriting aggregate state", () => {
  const signal = districtSignal(context);
  const before = JSON.stringify(signal);
  const items = buildPolicyInventory(context, [signal]);
  assert.equal(items.length, 7);
  assert.ok(items.some((item) => item.state === "已觸發"));
  assert.ok(items.some((item) => policyStateLabel(item.state) === "持續監測"));
  assert.equal(items.find((item) => item.topic === "教育×婚姻").state, "無法判定");
  assert.equal(JSON.stringify(signal), before);
  for (const legacy of buildPolicyCases(context, [signal])) {
    assert.equal(items.find((item) => item.topic === legacy.topic).state, legacy.state, "already-triggered branches retain V7 authority");
  }
});

test("district results and supporting charts never include city labor, industry or workplace wage", () => {
  for (const district of ["淡水區", "板橋區", "平溪區", "烏來區"]) {
    const ctx = { ...context, district };
    const items = buildPolicyInventory(ctx, [districtSignal(ctx), ...citywideSignals(114, "18-35", "合計")]);
    for (const item of items) {
      assert.match(item.chart.universe, /戶籍|青年服務據點/);
      assert.ok(item.supporting.every((evidence) => /戶籍|青年服務據點/.test(evidence.chart.universe)));
      assert.ok(!item.supporting.some((evidence) => ["就業轉銜", "行業結構", "薪資與發展"].includes(evidence.topic)));
      assert.match(item.ruleNote, /不更動數值門檻/);
    }
  }
});

test("missing first-year trend is not misclassified as a failed policy", () => {
  const ctx = { ...context, year: 110 };
  const items = buildPolicyInventory(ctx, [districtSignal(ctx)]);
  assert.equal(items.find((item) => item.topic === "人口趨勢").state, "無法判定");
  assert.match(items.find((item) => item.topic === "人口趨勢").statusReason, /不是沒有政策需求/);
});

test("114 wage missingness blocks that rationale, not the other city topics", () => {
  const ctx = { ...context, scope: "city", sex: "女" };
  const items = buildPolicyInventory(ctx, citywideSignals(114, "18-35", "女"));
  const wage = items.find((item) => item.topic === "薪資與發展");
  assert.equal(wage.state, "無法判定");
  assert.equal(wage.chart.series[0].points.find((point) => point.label === "114年").value, null);
  assert.match(wage.synthesis, /不能替它觸發介入/);
  assert.ok(wage.adaptations.some((text) => /不據歷史薪資核定/.test(text)));
  assert.ok(wage.supporting.some((evidence) => evidence.relation === "不同母體背景"));
  assert.match(wage.chart.sex, /男女合計/);
  assert.equal(wage.chart.series[0].points[0].value, getWage(113, "18-35").metrics["全年總薪資平均數"]);
});

test("city synthesis retains education and marriage as separately sourced household context", () => {
  const ctx = { ...context, scope: "city", year: 113 };
  const items = buildPolicyInventory(ctx, citywideSignals(113, "18-35", "合計"));
  const wage = items.find((item) => item.topic === "薪資與發展");
  const education = wage.supporting.find((evidence) => evidence.topic === "教育程度");
  assert.equal(education.chart.period, "113年12月底");
  assert.match(education.chart.universe, /戶籍/);
  assert.equal(education.chart.series[0].points.length, 5);
  assert.ok(education.chart.sources.length > 0);
  assert.match(education.implication, /不把戶籍結構套用/);
  assert.ok(wage.adaptations.some((text) => /平均數與中位數相差/.test(text)));
});

test("A changes with actual local trends and M changes with both topic and selected option", () => {
  const a = buildPolicyInventory(context, [districtSignal(context)]).find((item) => item.topic === "青年據點");
  const ctx = { ...context, district: "板橋區" };
  const b = buildPolicyInventory(ctx, [districtSignal(ctx)]).find((item) => item.topic === "青年據點");
  assert.notEqual(a.adaptations[0], b.adaptations[0]);
  assert.notEqual(a.options[2].action, b.options[2].action);
  const current = policyExecutionPlan(a, a.options[0]);
  const pilot = policyExecutionPlan(a, a.options[2]);
  assert.notEqual(current.during, pilot.during);
  assert.notEqual(current.monitoring[0].metric, pilot.monitoring[0].metric);
  assert.match(current.before, /尚未取得完整方案清冊/);
  const city = buildPolicyInventory({ ...context, scope: "city" }, citywideSignals(114, "18-35", "合計"));
  const labor = city.find((item) => item.topic === "就業轉銜");
  const industry = city.find((item) => item.topic === "行業結構");
  assert.notEqual(labor.monitoring[0].metric, industry.monitoring[0].metric);
  assert.notEqual(labor.options[2].action, industry.options[2].action);
});

test("classification board has three labelled lists and actionable entries for both scopes", () => {
  for (const scope of ["district", "city"]) {
    const ctx = { ...context, scope };
    const items = buildPolicyInventory(ctx, scope === "district" ? [districtSignal(ctx)] : citywideSignals(114, "18-35", "合計"));
    const html = renderToStaticMarkup(createElement(PolicyStatusBoard, { context: ctx, cases: items, onSelect() {} }));
    for (const status of ["優先盤點", "持續監測", "資料待補"]) assert.ok(html.includes(status));
    assert.match(html, /分類原因/);
    assert.match(html, /type="button"/);
    assert.match(html, scope === "district" ? /淡水區｜行政區/ : /新北市｜全市/);
  }
});

test("bar chart and drawer display both numeric bounds with the same bounded SVG renderer", () => {
  const ctx = { ...context, scope: "city", year: 113 };
  const item = buildPolicyInventory(ctx, citywideSignals(113, "18-35", "合計")).find((entry) => entry.topic === "薪資與發展");
  for (const component of [createElement(NarrativeChart, { chart: item.chart }), createElement(EvidenceDrawer, { policyCase: item, onClose() {} })]) {
    const html = renderToStaticMarkup(component);
    assert.match(html, /data-bound="low"/);
    assert.match(html, /data-bound="high"/);
    assert.match(html, /下限 /);
    assert.match(html, /上限 /);
    assert.match(html, /點估計 /);
    assert.match(html, /pn-plot-scroll/);
    assert.match(html, /模型敏感度上下限/);
    assert.doesNotMatch(html, /pn-comparison-row|pn-bar-track/);
  }
  const g = policyChartGeometry(item.chart);
  for (const point of item.chart.series[0].points) {
    assert.ok(g.y(point.high) >= g.top);
    assert.ok(g.y(point.low) <= g.baseline);
  }
});

test("all policy chart labels and ranges fit the shared geometry without altering raw datasets", () => {
  const before = JSON.stringify(dashboardData.wage);
  const ctx = { ...context, scope: "city", year: 113 };
  for (const item of buildPolicyInventory(ctx, citywideSignals(113, "18-35", "合計"))) {
    for (const chart of [item.chart, ...item.supporting.map((evidence) => evidence.chart)]) {
      const g = policyChartGeometry(chart);
      assert.ok(g.height >= 285);
      chart.series[0].points.forEach((point, index) => {
        assert.equal(g.labels[index].join(""), point.label);
        assert.ok(g.x(index) >= g.left && g.x(index) <= g.right);
      });
    }
  }
  assert.equal(JSON.stringify(dashboardData.wage), before);
});

test("ROAMEF uses equal-width stretched cards, scoped overflow, and evidence links for other variables", async () => {
  const css = await readFile(new URL("../app/policy-narrative.css", import.meta.url), "utf8");
  assert.match(css, /\.pn-pair \{[^}]*repeat\(2, minmax\(0,1fr\)\)[^}]*align-items: stretch/);
  assert.match(css, /\.pn-stage-body \{[^}]*flex: 1/);
  assert.match(css, /\.pn-plot-scroll \{[^}]*overflow-x: auto/);
  const html = renderToStaticMarkup(createElement(PolicyNarrativeWorkbench, { context, signals: [districtSignal(context)], onBack() {}, onOpenChat() {} }));
  assert.match(html, /綜合判讀/);
  assert.match(html, /官方案例與可參考做法/);
  assert.match(html, /pn-fact-links/);
  assert.match(html, /未來可整理之資訊/);
  assert.match(html, /pn-stage-body/);
});

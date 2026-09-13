import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { evaluateIndustryPolicyConditions, buildIndustryPolicySignal, type IndustrySignalInput } from "../app/policy-engine.ts";
import { collectIndustryPolicyInput } from "../app/policy-industry-input.ts";
import { withIndustryEvidence } from "../app/policy-industry-evidence.ts";
import { buildPolicyInventory } from "../app/policy-synthesis.ts";
import { buildCase, displayRoundedDifference, type PolicyContext } from "../app/policy-narrative.ts";
import { getResidentEmploymentIndustry } from "../app/resident-employment-industry.ts";
import { policyActionFlow } from "../app/policy-action-flow.ts";
import { NarrativeChart } from "../app/policy-evidence-chart.tsx";
registerHooks({ load(url, context, next) { return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context); } });
const { citywideSignals } = await import("../app/policy-workflow.tsx");
const { PolicyNarrativeWorkbench, RuleDiagram } = await import("../app/policy-narrative-workbench.tsx");
const context: PolicyContext = { scope: "city", district: "新北市", year: 113, ageBand: "18-24", sex: "合計" };
const inventory = (ctx = context) => buildPolicyInventory(ctx, citywideSignals(ctx.year, ctx.ageBand, ctx.sex));
const industry = (ctx = context) => inventory(ctx).find(item => item.topic === "行業結構")!;
const seed: IndustrySignalInput = { ageLabel: "青年", sexLabel: "合計", industry: "測試", currentSharePct: 20, previousSharePct: 20, threeYearShares: [20,20,20], topFiveSharePct: 60, previousTopFiveSharePct: 60, lifeStageShares: [20,20,20], maleSharePct: 20, femaleSharePct: 20, previousMaleSharePct: 20, previousFemaleSharePct: 20, sensitivityLowPct: 19, sensitivityHighPct: 21 };

test("three independent V1 triggers retain thresholds, strict direction, OR and supplemental age evidence", () => {
  for (const change of [
    { threeYearShares: [20,20.5,21] }, { threeYearShares: [21,20.5,20] },
    { topFiveSharePct: 61 }, { maleSharePct: 21 }, { femaleSharePct: 21 },
  ]) assert.equal(buildIndustryPolicySignal({ ...seed, ...change }).state, "已觸發");
  for (const change of [
    { threeYearShares: [20,19,21] }, { threeYearShares: [20,20,21] },
    { threeYearShares: [null,20,22] }, { topFiveSharePct: 60.999 },
    { topFiveSharePct: 59 }, { maleSharePct: 30, previousMaleSharePct: 30 },
    { lifeStageShares: [20,23,21] }, { lifeStageShares: [10,30,21] },
  ]) assert.equal(buildIndustryPolicySignal({ ...seed, ...change }).state, "持續觀察");
  assert.equal(buildIndustryPolicySignal({ ...seed, currentSharePct: null }).state, "無法判定");
  assert.equal(buildIndustryPolicySignal({ ...seed, topFiveSharePct: null, maleSharePct: 40 }).state, "無法判定");
});

test("all 60 city year/age/sex combinations preserve original classifications and match their source evidence", () => {
  for (const year of [110,111,112,113,114]) for (const ageBand of ["18-24","25-29","30-35","18-35"] as const) for (const sex of ["合計","男","女"] as const) {
    const ctx: PolicyContext = { ...context, year, ageBand, sex };
    const { input: i, industryCode } = collectIndustryPolicyInput(year, ageBand, sex);
    // Independent copy of the original rule, not the presentation evaluator.
    const v = i.threeYearShares.filter((n): n is number => n != null);
    const trend = v.length === 3 && ((v[0] < v[1] && v[1] < v[2]) || (v[0] > v[1] && v[1] > v[2])) && Math.abs(v[2]-v[0]) >= 1;
    const concentration = i.topFiveSharePct != null && i.previousTopFiveSharePct != null && i.topFiveSharePct-i.previousTopFiveSharePct >= 1;
    const gap = i.maleSharePct != null && i.femaleSharePct != null && i.previousMaleSharePct != null && i.previousFemaleSharePct != null
      && Math.abs(i.maleSharePct-i.femaleSharePct)-Math.abs(i.previousMaleSharePct-i.previousFemaleSharePct) >= 1;
    const expected = i.currentSharePct == null || i.topFiveSharePct == null ? "無法判定" : trend || concentration || gap ? "已觸發" : "持續觀察";
    const actual = industry(ctx);
    assert.equal(actual.state, expected, JSON.stringify(ctx));
    assert.deepEqual(actual.ruleSteps!.slice(0,3).map(s => s.met === true), [trend, concentration, gap]);
    assert.equal(actual.facts!.length, 4);
    actual.facts![0].chart.series[0].points.forEach((p, index) => {
      const original = getResidentEmploymentIndustry(year-2+index,sex,ageBand).find(r=>r.industryCode===industryCode);
      assert.equal(p.value, original?.sharePct ?? null);
      assert.equal(p.low, original?.sharePctLow);
      assert.equal(p.high, original?.sharePctHigh);
    });
    for (const fact of actual.facts!) assert.ok(fact.chart.sources.every(source => source.url.startsWith("https://")));
    for (const rule of actual.ruleSteps!) assert.ok(actual.facts!.some(f => f.id === rule.factId));
  }
});

test("screenshot cohort 113/18-24/all is priority ONLY for widening gender gap, and opens that chart first", () => {
  const item = industry();
  assert.deepEqual(item.ruleSteps!.map(s => s.met), [false,false,true,true]);
  assert.match(item.chart.title, /男女行業占比差距/);
  assert.match(item.headline, /0.73.*3.62.*擴大2.89/);
  assert.match(item.ruleSteps![0].observed, /24.12%.*24.47%.*23.33%.*未連續同向/);
  assert.match(item.ruleSteps![1].observed, /70.92%.*69.54%.*減少1.38/);
  assert.equal(item.facts![2].chart.series[0].points.length, 2);
  assert.equal(item.facts![2].chart.detailTable!.rows.length, 6);
  assert.equal(item.facts![3].chart.sex, "男女合計");
});

test("top five re-ranks independently by year, includes all ten source rows, and uses displayed subtraction in prose", () => {
  const ctx = { ...context, year:112, ageBand:"25-29" as const };
  const chart = industry(ctx).facts![1].chart;
  assert.equal(chart.detailTable!.rows.length, 10);
  for (const y of [111,112]) {
    const rows = [...getResidentEmploymentIndustry(y,"合計","25-29")].sort((a,b)=>b.sharePct-a.sharePct).slice(0,5);
    assert.equal(chart.series[0].points.find(p => p.label===y+"年")!.value, rows.reduce((sum,r)=>sum+r.sharePct,0));
    rows.forEach((r,index)=>assert.deepEqual(chart.detailTable!.rows[(y-111)*5+index], [y+"年／第"+(index+1)+"名", r.industry, r.sharePct.toFixed(6)+"%"]));
  }
  assert.match(industry(ctx).ruleSteps![1].observed, /61.64%.*61.19%.*減少0.45/);
  assert.equal(displayRoundedDifference(chart.series[0].points[1].value,chart.series[0].points[0].value), -.45);
});

test("missing historical values stay missing and age differences never substitute for a primary condition", () => {
  const item = industry({ ...context, year:110 });
  assert.equal(item.ruleSteps![0].met, null);
  assert.equal(item.ruleSteps![1].met, null);
  assert.equal(item.ruleSteps![2].met, null);
  assert.deepEqual(item.facts![0].chart.series[0].points.slice(0,2).map(p=>p.value),[null,null]);
  const html = renderToStaticMarkup(createElement(NarrativeChart,{chart:item.facts![2].chart}));
  assert.doesNotMatch(html,/undefined%|NaN/);
  assert.match(html,/尚無資料/);
});

test("structured OR diagram links each condition to its own chart and separates supplemental evidence", () => {
  const html = renderToStaticMarkup(createElement(RuleDiagram,{item:industry(),onOpen(){}}));
  assert.match(html,/以下三項任一符合/);
  assert.match(html,/符合條件：3/);
  assert.match(html,/查看主要行業三年變動圖表/);
  assert.match(html,/查看前五大行業集中度圖表/);
  assert.match(html,/查看男女行業占比差距圖表/);
  assert.match(html,/年齡層差距｜補充線索，不單獨列為優先盤點/);
  assert.doesNotMatch(html,/所選行業占比連續三年同向變動且幅度/);
  for (const fact of industry().facts!) {
    const rendered = renderToStaticMarkup(createElement(NarrativeChart,{chart:fact.chart}));
    assert.match(rendered,/data-motion-enter/);
    assert.match(rendered,/查看圖表資料表/);
    assert.match(rendered,/pn-compact-table/);
  }
});

test("112/25-29 with no priority keeps current measures; reference tools are collapsed and no pilot radios or schedule appear", () => {
  const ctx: PolicyContext = { ...context,year:112,ageBand:"25-29" };
  const cases = inventory(ctx);
  assert.equal(cases.filter(c=>c.state==="已觸發").length,0);
  const item = cases.find(c=>c.topic==="行業結構")!;
  const flow = policyActionFlow(ctx,item,"mobile");
  assert.equal(flow.mode,"monitor"); assert.equal(flow.program.id,"current");
  assert.equal(flow.programs.length,4);
  const html = renderToStaticMarkup(createElement(PolicyNarrativeWorkbench,{context:ctx,signals:citywideSignals(112,"25-29","合計"),initialCaseId:item.id,onBack(){},onOpenChat(){}}));
  assert.match(html,/現行措施與備選工具/);
  assert.match(html,/<details class="pn-details"><summary>可參考的工具｜尚未選為本次方案/);
  assert.doesNotMatch(html,/type="radio"|試辦草案：|第3–5個月｜試辦2場|以兩場試辦的到場/);
});

test("priority still offers four selectable options, but another priority never changes the selected issue's mode", () => {
  const ctx: PolicyContext = {...context, year:114,ageBand:"18-35"};
  const cases=inventory(ctx);
  assert.ok(cases.some(c=>c.state==="已觸發"));
  const monitor=cases.find(c=>c.state==="目前未觸發"||c.state==="持續觀察")!;
  assert.equal(policyActionFlow(ctx,monitor,"mobile").mode,"monitor");
  const missing=cases.find(c=>c.topic==="薪資與發展")!;
  assert.equal(policyActionFlow(ctx,missing,"career").mode,"missing");
  assert.equal(policyActionFlow(ctx,missing,"career").program.id,"collect");
  const html = renderToStaticMarkup(createElement(PolicyNarrativeWorkbench,{context,signals:citywideSignals(113,"18-24","合計"),initialCaseId:industry().id,onBack(){},onOpenChat(){}}));
  assert.equal((html.match(/type="radio"/g)??[]).length,4);
  assert.match(html,/試辦草案：/);
});

test("district evidence is never replaced by city industry charts", () => {
  const ctx: PolicyContext = {...context,scope:"district",district:"淡水區"};
  const item=buildCase(ctx,buildIndustryPolicySignal(seed),"行業結構",null);
  assert.equal(withIndustryEvidence(ctx,item),item);
  assert.equal(evaluateIndustryPolicyConditions(seed).triggered,false);
});

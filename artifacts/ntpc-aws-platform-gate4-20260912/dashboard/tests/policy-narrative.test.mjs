import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPolicyCases, policyChatPrompt, displayRoundedDifference } from "../app/policy-narrative.ts";
import { dashboardData, getLabor, getRegistered, getWage } from "../app/dashboard-data.ts";
import { getDistrictPolicyEvidence } from "../app/district-policy-evidence.ts";
import { buildDistrictPolicySignal } from "../app/policy-engine.ts";
import { higherEducationMarriedShare } from "../app/joint-education-marriage.ts";

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
  return nextLoad(url, context);
} });
const { PolicyNarrativeWorkbench, NarrativeChart } = await import("../app/policy-narrative-workbench.tsx");
const fixture = (id, domains = []) => ({ id, title: "測試議題", state: "持續觀察", signal: "測試訊號", relativePosition: "比較基準", supportedInterpretation: "描述性結果", unsupportedConclusion: "不能歸因為政策效果", policyQuestion: "需求為何", recommendedAction: "舊方案", actionBasis: [], decisionGate: "待核定", evidenceDomains: domains, policyTools: [], agencies: "待確認", monitoring: [], missingData: [], rule: "既有規則，不由敘事層修改" });
const context = { scope: "district", district: "淡水區", year: 114, ageBand: "18-35", sex: "合計" };
function districtSignal(ctx, joint) {
  const e = getDistrictPolicyEvidence(ctx.year, ctx.district, ctx.ageBand, ctx.sex);
  return buildDistrictPolicySignal({ ...e, ageLabel: ctx.ageBand, rank: e.populationRank,
    higherEducationMarriedPct: joint?.districtPct, cityHigherEducationMarriedPct: joint?.cityPct,
    higherEducationMarriedConservativeGapPct: joint?.conservativeGapPct, higherEducationMarriedEstimated: joint?.estimated,
  });
}
async function comparison(districtCode) {
  const city = JSON.parse(await readFile(new URL("../public/data/joint-education-marriage.json", import.meta.url), "utf8"));
  const district = JSON.parse(await readFile(new URL("../public/data/joint-education-marriage-districts/" + districtCode + ".json", import.meta.url), "utf8"));
  const a = higherEducationMarriedShare(city, 114, "18-35", "合計");
  const b = higherEducationMarriedShare(district, 114, "18-35", "合計");
  return { districtPct: b.value, cityPct: a.value, conservativeGapPct: a.low - b.high, estimated: true, districtLowPct: b.low, districtHighPct: b.high, cityLowPct: a.low, cityHighPct: a.high };
}

test("Tamsui narrative matches source counts, ranking and repaired PPTX trial frequency", () => {
  const signal = districtSignal(context);
  const saved = JSON.stringify(signal);
  const cases = buildPolicyCases(context, [signal]);
  const item = cases.find((item) => item.topic === "青年據點");
  assert.ok(item);
  assert.match(item.headline, /5\.08%/);
  assert.deepEqual(item.chart.series[0].points.map((point) => point.value), [40922, 41038, 41556, 42104, 43000]);
  assert.match(item.reading.join(" "), /第1／29區/);
  assert.match(item.reading.join(" "), /115年.*不是114年歷史/);
  assert.match(item.caution, /目前無行政區服務資料/);
  assert.match(item.options.find((option) => option.id === "pilot").action, /每3個月至少2場/);
  assert.doesNotMatch(item.options.find((option) => option.id === "pilot").action, /每月至少2場/);
  assert.equal(JSON.stringify(signal), saved, "must not mutate the existing signal or calculation authority");
  assert.ok(!cases.some((item) => item.topic === "人口趨勢"), "the same site-growth evidence should not create a redundant case");
});

test("Pingxi education × marriage displays the actual gap and model range; Tamsui does not trigger it", async () => {
  const joint = await comparison("65000240");
  const ctx = { ...context, district: "平溪區" };
  const item = buildPolicyCases(ctx, [districtSignal(ctx, joint)], joint).find((item) => item.topic === "教育×婚姻");
  assert.ok(item);
  assert.match(item.headline, /10\.72%.*低於全市7\.86個百分點/);
  assert.equal(Number((joint.cityPct - joint.districtPct).toFixed(2)), 7.87);
  assert.equal(displayRoundedDifference(joint.cityPct, joint.districtPct), 7.86);
  assert.match(item.chart.method, /各四捨五入至小數點後兩位再相減/);
  assert.match(item.chart.method, /分母為同年、同區、同年齡及性別的大學及研究所人口/);
  assert.equal(item.chart.series[0].points[0].low, joint.districtLowPct);
  assert.match(item.options[2].action, /6個月、2場.*自願/);
  assert.match(item.evaluation, /不以有偶率或結婚人數考核/);
  const tamsui = await comparison("65000100");
  assert.ok(!buildPolicyCases(context, [districtSignal(context, tamsui)], tamsui).some((item) => item.topic === "教育×婚姻"));
});

test("district flow rejects city-only signals, including when no district evidence exists", () => {
  const signals = ["labor-unemployment-movement", "wage-freshness-and-identity", "industry-youth-structure"].map((id) => fixture(id));
  assert.deepEqual(buildPolicyCases(context, signals), []);
  const result = buildPolicyCases(context, [...signals, districtSignal(context)]);
  assert.ok(result.every((item) => item.chart.universe.includes("戶籍")));
});

test("labor chart uses its labor denominator, all-sex identity and the existing five-year benchmark", () => {
  const signal = fixture("labor-unemployment-movement");
  const item = buildPolicyCases({ ...context, scope: "city", sex: "女" }, [signal])[0];
  assert.equal(item.chart.series[0].points.at(-1).value, getLabor(114, "18-35").metrics["失業率"]);
  assert.equal(Number(item.chart.reference.value.toFixed(2)), 5.68);
  assert.match(item.chart.reference.label, /110–114年中位數.*非目標/);
  assert.match(item.chart.sex, /男女合計/);
  assert.match(item.chart.method, /失業人數 ÷ 勞動力/);
  assert.match(item.chart.period, /全年12個月平均/);
  assert.doesNotMatch(item.chart.period, /12月底/);
});

test("114 wage remains missing while 113 comparison is explicit and all-sex", () => {
  const signal = { ...fixture("wage-freshness-and-identity"), state: "無法判定" };
  const item = buildPolicyCases({ ...context, scope: "city", sex: "女" }, [signal])[0];
  assert.match(item.headline, /114年.*最新可用為113年/);
  assert.equal(item.chart.series[0].points.find((point) => point.label === "114年").value, null);
  assert.equal(item.chart.series[0].points[0].value, getWage(113, "18-35").metrics["全年總薪資平均數"]);
  assert.match(item.chart.annotation.value, /9\.2萬元/);
  assert.match(item.chart.sex, /男女合計/);
  assert.match(item.caution, /不能證明統計上無顯著差異/);
});

test("year and age changes use actual matching records without altering them", () => {
  for (const year of dashboardData.meta.years) for (const ageBand of dashboardData.meta.ageBands) for (const sex of dashboardData.meta.sexes) {
    const ctx = { ...context, year, ageBand, sex };
    const item = buildPolicyCases(ctx, [fixture("district-population-scale", ["人口趨勢"])])[0];
    assert.equal(item.chart.series[0].points.at(-1).value, getRegistered(year, context.district, ageBand, sex).population);
    assert.equal(item.chart.series[0].points.length, year - 109);
    assert.doesNotMatch(JSON.stringify(item), /NaN|Infinity|undefined/);
  }
});

test("policy chat carries the chosen issue, actual sex, option and district boundaries", () => {
  const item = buildPolicyCases(context, [districtSignal(context)])[0];
  const text = policyChatPrompt(context, item, item.options[2], "為什麼這樣建議？");
  assert.match(text, /淡水區；114年；18–35歲/);
  assert.match(text, /本次議題：青年據點/);
  assert.match(text, /每3個月至少2場/);
  assert.match(text, /不得將全市勞動、行業或薪資分攤/);
  assert.match(text, /不補造目標值或成效/);
});

test("rendered policy page exposes R/O evidence, one-case options and honest unexecuted outcomes", () => {
  const html = renderToStaticMarkup(createElement(PolicyNarrativeWorkbench, { context, signals: [districtSignal(context)], onBack() {}, onOpenChat() {} }));
  for (const code of ["R", "O", "A", "M", "E", "F"]) assert.match(html, new RegExp('id="pn-title-' + code + '"'));
  assert.ok(html.indexOf('id="pn-title-R"') < html.indexOf('id="pn-title-O"'));
  assert.ok(html.indexOf('id="pn-title-O"') < html.indexOf('id="pn-title-A"'));
  assert.ok(html.includes(getRegistered(context.year, context.district, context.ageBand, context.sex).population.toLocaleString("zh-TW")));
  assert.match(html, /政策目標草案/);
  assert.match(html, /建議成效評估之KPI/);
  const optionInputs = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
  assert.equal(optionInputs.length, 4);
  assert.equal(new Set(optionInputs.map((input) => input.match(/name="([^"]+)"/)?.[1])).size, 1);
  assert.equal(optionInputs.filter((input) => /checked/.test(input)).length, 1);
  assert.doesNotMatch(html, /方案與經費概估|尚未執行.*成效待回收|核定前需要補齊/);
  assert.match(html, /<select/);
  assert.match(html, /<table/);
  assert.match(html, /AI問政策證據/);
  assert.doesNotMatch(html, /需人工審核|想进一步/);
});

test("exact evidence chart shows comparison gap and readable model ranges", async () => {
  const ctx = { ...context, district: "平溪區" };
  const joint = await comparison("65000240");
  const item = buildPolicyCases(ctx, [districtSignal(ctx, joint)], joint).find((item) => item.topic === "教育×婚姻");
  const html = renderToStaticMarkup(createElement(NarrativeChart, { chart: item.chart }));
  assert.match(html, /低7\.86個百分點/);
  assert.match(html, /模型敏感度上下限/);
  assert.match(html, /下限 10\.69%/);
  assert.match(html, /上限 10\.94%/);
  assert.match(html, /\+7\.86個百分點/);
  assert.match(html, /模型敏感度上下限/);
});

test("display differences use the same rounded values as the reader, preserving nulls and engine precision", () => {
  assert.equal(displayRoundedDifference(18.5834328, 10.7171108), 7.86);
  assert.equal(displayRoundedDifference(10.7171108, 18.5834328), -7.86);
  assert.equal(displayRoundedDifference(60.94, 51.74, 1), 9.2);
  assert.equal(displayRoundedDifference(null, 1), null);
  assert.equal(displayRoundedDifference(Number.NaN, 1), null);
});

test("missing joint evidence is visible; responsive drawer includes focus and motion safeguards", async () => {
  const html = renderToStaticMarkup(createElement(PolicyNarrativeWorkbench, { context, signals: [districtSignal(context)], jointStatus: "unavailable", onBack() {}, onOpenChat() {} }));
  assert.match(html, /教育×婚姻交叉資料暫時無法取得/);
  const ui = await readFile(new URL("../app/policy-narrative-workbench.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/policy-narrative.css", import.meta.url), "utf8");
  assert.match(ui, /aria-modal="true"/);
  assert.match(ui, /useModalInteraction\(true, ref, onClose, ref\)/);
  const modal = await readFile(new URL("../app/modal-interaction.ts", import.meta.url), "utf8");
  assert.match(modal, /event\.key === "Escape"/);
  assert.match(modal, /event\.key !== "Tab"/);
  assert.match(modal, /previous\.focus\(\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /100dvh/);
  assert.match(css, /max-width: 600px/);
  assert.match(css, /min-height: 44px/);
});

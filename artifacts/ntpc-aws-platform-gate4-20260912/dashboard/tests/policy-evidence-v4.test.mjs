import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getRegistered, getServiceFacilities, dashboardData, geographyLabel } from "../app/dashboard-data.ts";
import { getDistrictPolicyEvidence } from "../app/district-policy-evidence.ts";
import { buildDistrictPolicySignal } from "../app/policy-engine.ts";
import { buildPolicyInventory } from "../app/policy-synthesis.ts";
import { higherEducationMarriedShare, educationMarriageShare, JOINT_EDUCATION_CATEGORIES, JOINT_MARRIAGE_CATEGORIES } from "../app/joint-education-marriage.ts";
import { policyPrograms, programKpis, programSources } from "../app/policy-program-options.ts";
import { districtPopulationMedian, jointClassificationChart } from "../app/policy-district-facts.ts";
import { getPopulation } from "../app/district-annual-rankings.ts";
registerHooks({ load(url, context, nextLoad) { return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : nextLoad(url, context); } });
const { NarrativeChart, policyChartGeometry } = await import("../app/policy-evidence-chart.tsx");
const { PolicyNarrativeWorkbench, EvidenceDrawer, PolicyStatusBoard } = await import("../app/policy-narrative-workbench.tsx");
const { FacilityReferences } = await import("../app/policy-facility-references.tsx");
const { citywideSignals } = await import("../app/policy-workflow.tsx");
const ctx = { scope: "district", district: "淡水區", year: 114, ageBand: "30-35", sex: "合計" };
function inventory(context, joint = null) {
  const e = getDistrictPolicyEvidence(context.year, context.district, context.ageBand, context.sex);
  const signal = buildDistrictPolicySignal({ ...e, rank: e.populationRank, ageLabel: context.ageBand,
    higherEducationMarriedPct: joint?.districtPct, cityHigherEducationMarriedPct: joint?.cityPct,
    higherEducationMarriedConservativeGapPct: joint?.conservativeGapPct, higherEducationMarriedEstimated: joint?.estimated });
  return { items: buildPolicyInventory(context, [signal], joint), signal };
}
test("Tamsui 114 age30–35 ranking facts match the requested example and distinct V7 growth window", () => {
  const { items } = inventory(ctx);
  assert.deepEqual(items.filter(i => i.state === "已觸發").map(i => i.topic), ["人口趨勢", "青年據點", "婚姻狀態"]);
  const trend = items.find(i => i.topic === "人口趨勢");
  assert.deepEqual(trend.facts.map(f => f.rank), [1, 13, 9]);
  assert.ok(trend.facts.every(f => f.statement.includes("與去年持平")));
  assert.match(trend.facts[2].statement, /17,449人/);
  assert.match(trend.ruleSteps[1].observed, /第2名/);
  assert.ok(trend.ruleSteps.every(s => s.met === true));
  for (const f of trend.facts) {
    assert.deepEqual(f.chart.series.map(s => s.name), [f.id === "population" ? "29區人口數中位數" : "新北市", "淡水區"]);
    assert.deepEqual(f.chart.series[0].points.map(p => p.label), ["113年", "114年"]);
  }
  const marriage = items.find(i => i.topic === "婚姻狀態");
  assert.match(marriage.headline, /2.72個百分點/);
  assert.ok(marriage.ruleSteps.every(s => s.met === true));
});
test("all category facts follow exact filters and retain independent snapshot periods", () => {
  for (const district of ["淡水區", "板橋區"]) for (const sex of ["合計", "女"]) for (const year of [110, 114]) {
    const { items } = inventory({ ...ctx, district, sex, year });
    const education = items.find(i => i.topic === "教育程度");
    assert.equal(education.facts.length, 6);
    const university = education.facts.find(f => f.id === "education大學");
    assert.equal(university.chart.series[1].points[1].value, getRegistered(year, district, "30-35", sex).education["大學"].value);
    assert.match(university.chart.identity, /模型估計/);
    if (year === 110) assert.equal(university.chart.series[1].points[0].value, null);
    const site = items.find(i => i.topic === "青年據點").facts[0];
    assert.deepEqual(site.chart.series[0].points.map(p => p.label), [dashboardData.service.snapshotYear + "年清冊"]);
    assert.equal(site.chart.series[1].points[0].value, getServiceFacilities(district).filter(s => s.active).length);
    assert.match(site.chart.sex, /不分年齡與性別/);
  }
});
test("joint comparison uses both original annual payloads, not marginal products or carry-forward", async () => {
  const city = JSON.parse(await readFile(new URL("../public/data/joint-education-marriage.json", import.meta.url)));
  const district = JSON.parse(await readFile(new URL("../public/data/joint-education-marriage-districts/65000100.json", import.meta.url)));
  const history = [113,114].map(year => { const c = higherEducationMarriedShare(city,year,"30-35","合計"), d = higherEducationMarriedShare(district,year,"30-35","合計"); return { year, districtPct: d.value, cityPct: c.value, districtLowPct: d.low, districtHighPct: d.high, cityLowPct: c.low, cityHighPct: c.high }; });
  const joint = { ...history[1], estimated: true, conservativeGapPct: history[1].cityLowPct - history[1].districtHighPct, history };
  joint.cells = JOINT_EDUCATION_CATEGORIES.flatMap(education => JOINT_MARRIAGE_CATEGORIES.map(marriage => ({ education, marriage, history: [113,114].map(year => {
    const c = educationMarriageShare(city,year,"30-35","合計",education,marriage), d = educationMarriageShare(district,year,"30-35","合計",education,marriage);
    return { year, districtPct:d.value, cityPct:c.value, districtLowPct:d.low, districtHighPct:d.high, cityLowPct:c.low, cityHighPct:c.high };
  }) })));
  const item = inventory(ctx, joint).items.find(i => i.topic === "教育×婚姻");
  assert.equal(item.overviewChart.series.length, 10);
  assert.equal(item.overviewChart.comparisonGroups.length, 5);
  assert.equal(item.overviewChart.xLabel, "婚姻狀態");
  assert.equal(item.overviewChart.composition, true);
  assert.match(item.overviewChart.universe, /^新北市與淡水區/);
  for (const series of item.overviewChart.series) {
    assert.deepEqual(series.points.map(p => p.label), JOINT_MARRIAGE_CATEGORIES);
    assert.ok(Math.abs(series.points.reduce((sum, p) => sum + p.value, 0) - 100) < 1e-8);
    const [education, geography] = series.name.split("・");
    for (const p of series.points) assert.equal(p.value, educationMarriageShare(geography === "新北市" ? city : district,114,"30-35","合計",education,p.label).value);
  }
  const overviewGeometry = policyChartGeometry(item.overviewChart);
  assert.equal(overviewGeometry.maximum, 100);
  assert.ok(overviewGeometry.seriesStep >= 44);
  assert.ok(overviewGeometry.x(0) - 2 * overviewGeometry.seriesStep - 22 >= overviewGeometry.left);
  assert.ok(overviewGeometry.x(3) + 2 * overviewGeometry.seriesStep + 22 <= overviewGeometry.right);
  const chartHtml = renderToStaticMarkup(createElement(NarrativeChart,{chart:item.overviewChart}));
  assert.equal((chartHtml.match(/role="button"/g) ?? []).length,40);
  assert.match(chartHtml,/新北市與行政區兩兩對照/);
  assert.equal((chartHtml.match(/class="pn-difference /g) ?? []).length,20);
  assert.match(chartHtml,/同一教育程度的四種婚姻占比合計100%/);
  const boardHtml = renderToStaticMarkup(createElement(PolicyStatusBoard,{context:ctx,cases:[item],onSelect(){}}));
  assert.equal((boardHtml.match(/class="pn-chart"/g) ?? []).length,1);
  assert.match(boardHtml,/展開交叉圖與計算方式/);
  const missing = jointClassificationChart(ctx,item.chart,{...joint,cells:joint.cells.slice(1)});
  assert.equal(missing.series[0].points[0].value,null);
  assert.equal(jointClassificationChart(ctx,item.chart,null),undefined);
  assert.equal(item.chart.series[1].points[0].value, history[0].districtPct);
  assert.equal(item.chart.series[1].points[1].high, history[1].districtHighPct);
  assert.notEqual(item.chart.series[1].points[0].value, item.chart.series[1].points[1].value);
  assert.equal(item.facts.length,21);
  const divorce = item.facts.find(f => f.id === "joint-國中及以下-離婚或終止結婚");
  const rows = district.records.filter(r => r.year === 114 && r.ageBand === "30-35" && r.sex === "合計" && r.education === "國中及以下");
  const expected = rows.find(r => r.marriage === "離婚或終止結婚").population / rows.reduce((s,r) => s + r.population,0) * 100;
  assert.equal(divorce.chart.series[1].points[1].value,expected);
  assert.match(divorce.chart.method,/同年、同區、同年齡與性別的國中及以下總人口/);
  assert.equal(policyPrograms(ctx,{...item,chart:divorce.chart})[0].id,"adjustment");
  for (const marriage of ["喪偶", "離婚或終止結婚", "未婚"]) {
    const selected = item.facts.find(f => f.id === "joint-國中及以下-" + marriage);
    assert.equal(policyPrograms(ctx, { ...item, chart: selected.chart })[0].id, marriage === "未婚" ? "social" : "adjustment");
  }
  for (const education of JOINT_EDUCATION_CATEGORIES) {
    const values = JOINT_MARRIAGE_CATEGORIES.map(m => educationMarriageShare(district,114,"30-35","合計",education,m));
    assert.ok(Math.abs(values.reduce((s,v) => s+v.value,0)-100)<1e-8);
    assert.ok(values.every(v => v.low<=v.value && v.value<=v.high));
  }
});

test("population benchmark is the 15th of all 29 districts under the same annual age and sex filters", () => {
  const districts = dashboardData.geographies.filter(g => g.level === "DISTRICT");
  for (const year of [109,110,111,112,113,114]) for (const ageBand of ["18-35","18-24","25-29","30-35"]) for (const sex of ["合計","男","女"]) {
    const values = districts.map(g => getPopulation(year,geographyLabel(g.name),ageBand,sex)).sort((a,b) => a-b);
    assert.equal(values.length,29);
    assert.ok(values.every(v => v != null));
    assert.equal(districtPopulationMedian(year,ageBand,sex),values[14]);
  }
  assert.equal(districtPopulationMedian(999,"18-35","合計"),null);
  const population = inventory(ctx).items.find(i => i.topic === "人口規模");
  assert.equal(population.chart.series[0].points[1].value,districtPopulationMedian(114,"30-35","合計"));
  assert.match(population.headline,/29區人口數中位數/);
  assert.equal(population.facts[0].rank,9);
});

test("facility references preserve source addresses, filters, links, status and snapshot year", () => {
  for (const district of ["淡水區","新莊區","板橋區","新北市"]) {
    const html = renderToStaticMarkup(createElement(FacilityReferences,{district}));
    assert.match(html,new RegExp(dashboardData.service.snapshotYear+"年清冊快照"));
    for (const facility of getServiceFacilities(district)) {
      assert.ok(html.includes(facility.name));
      assert.ok(html.includes(facility.address));
      assert.ok(html.includes(facility.sourceUrl.replaceAll("&","&amp;")));
    }
    if (district === "淡水區") assert.match(html,/這份清冊未列出淡水區據點/);
    if (district === "新莊區") assert.match(html,/暫停營運（清冊狀態）/);
    assert.doesNotMatch(html,/服務不足|最近據點|114年清冊/);
  }
});

test("each district issue offers four distinct mechanisms with referenced cases and matching KPI", () => {
  for (const item of inventory(ctx).items) {
    const options = policyPrograms(ctx,item);
    assert.equal(options.length,4);
    assert.equal(new Set(options.map(p=>p.id)).size,4);
    assert.equal(new Set(options.map(p=>p.mechanism)).size,4);
    assert.ok(options.every(p=>p.suitableFor && p.preparation && p.sourceIds.every(id=>programSources[id])));
    assert.ok(options.some(p=>p.sourceIds.some(id=>["taoyuan","kaohsiung","tainan","volunteer","deliberation"].includes(id))));
    for (const option of options) assert.equal(programKpis(option).at(-1).metric,option.metric);
  }
});

test("city employment, industry and wage programs have distinct choices without changing population scope", () => {
  const context = { ...ctx,scope:"city",district:"新北市",year:113,ageBand:"18-35" };
  const items = buildPolicyInventory(context,citywideSignals(113,"18-35","合計"));
  for (const topic of ["就業轉銜","行業結構","薪資與發展"]) {
    const item = items.find(i=>i.topic===topic);
    const choices = policyPrograms(context,item);
    assert.equal(choices.length,4);
    assert.equal(new Set(choices.map(p=>p.mechanism)).size,4);
    assert.ok(choices.some(p=>p.sourceIds.includes("taoyuan")));
    assert.ok(choices.some(p=>p.sourceIds.includes("kaohsiung")));
  }
});

test("combined joint plot preserves all five years, four age bands and three sexes without stale cells", async () => {
  const payload = JSON.parse(await readFile(new URL("../public/data/joint-education-marriage-districts/65000100.json", import.meta.url)));
  const city = JSON.parse(await readFile(new URL("../public/data/joint-education-marriage.json", import.meta.url)));
  const base = inventory(ctx).items[0].chart;
  for (const year of [110,111,112,113,114]) for (const ageBand of ["18-35","18-24","25-29","30-35"]) for (const sex of ["合計","男","女"]) {
    const cells = JOINT_EDUCATION_CATEGORIES.flatMap(education=>JOINT_MARRIAGE_CATEGORIES.map(marriage=>{
      const v=educationMarriageShare(payload,year,ageBand,sex,education,marriage);
      const c=educationMarriageShare(city,year,ageBand,sex,education,marriage);
      return {education,marriage,history:[{year,districtPct:v.value,cityPct:c.value,districtLowPct:v.low,districtHighPct:v.high,cityLowPct:c.low,cityHighPct:c.high}]};
    }));
    const chart=jointClassificationChart({...ctx,year,ageBand,sex},base,{cells,estimated:ageBand!=="25-29"});
    for(const series of chart.series) {
      assert.ok(Math.abs(series.points.reduce((sum,p)=>sum+p.value,0)-100)<1e-8);
      const [education, geography] = series.name.split("・");
      for(const p of series.points) assert.equal(p.value,educationMarriageShare(geography === "新北市" ? city : payload,year,ageBand,sex,education,p.label).value);
    }
    assert.match(chart.period,new RegExp(year+"年"));
    assert.equal(chart.identity,ageBand==="25-29"?"官方行政值":"模型估計：PCLM＋IPF");
  }
});
test("negative growth and both bounds stay inside the same quadrant geometry", () => {
  const chart = inventory(ctx).items.find(i => i.topic === "人口趨勢").chart;
  const g = policyChartGeometry(chart);
  assert.equal(g.width, 620); assert.equal(g.height, 333); assert.ok(g.minimum < 0);
  for (const s of chart.series) for (const p of s.points) assert.ok(g.y(p.value) >= g.top && g.y(p.value) <= g.baseline);
  const html = renderToStaticMarkup(createElement(NarrativeChart, { chart }));
  assert.ok(!/<rect[^>]*height="-/.test(html));
  assert.match(html, /axis-title/); assert.match(html, /查看圖表資料表/);
});
test("policy view has factual links, real program references, KPI proposals and no retired budget or internal banners", () => {
  const { items, signal } = inventory(ctx);
  const html = renderToStaticMarkup(createElement(PolicyNarrativeWorkbench,{ context:ctx,signals:[signal],onBack(){},onOpenChat(){} }));
  for (const text of ["分類原因","官方案例與可參考做法","建議成效評估之KPI","未來可整理之資訊","6個月並試辦2場次","pn-rule-diagram"]) assert.ok(html.includes(text), text);
  for (const text of ["方案與經費概估","經費分項","判讀界線","核定前需要補齊","尚未執行 · 成效待回收","辦理場次是執行量"]) assert.ok(!html.includes(text), text);
  const drawer = renderToStaticMarkup(createElement(EvidenceDrawer, { policyCase: items[0], onClose(){} }));
  assert.ok(!drawer.includes("可用性狀態"));
  const marriage = items.find(i => i.topic === "婚姻狀態");
  const programs = policyPrograms(ctx, marriage);
  assert.equal(programs[0].id,"family");
  assert.notEqual(programKpis(programs[0]).at(-1).metric, programKpis(programs[1]).at(-1).metric);
  assert.ok(Object.values(programSources).every(s => new URL(s.url).hostname.endsWith(".gov.tw") || new URL(s.url).hostname.endsWith("ntpc.edu.tw")));
});

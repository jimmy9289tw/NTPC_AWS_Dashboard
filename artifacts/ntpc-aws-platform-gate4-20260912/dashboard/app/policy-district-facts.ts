import { ageBandLabel, dashboardData, geographyLabel, getRegistered, getServiceFacilities, type RegisteredRecord } from "./dashboard-data";
import { buildDistrictRankings, competitionRank, getPopulation } from "./district-annual-rankings";
import { getDistrictPolicyEvidence } from "./district-policy-evidence";
import { percentChange } from "./map-metrics";
import { displayRoundedDifference, type EvidenceChart, type JointComparison, type PolicyCase, type PolicyContext, type PolicyFact, type PolicyRuleStep } from "./policy-narrative";
import { policySourceStatus } from "./policy-source-status";
import { JOINT_EDUCATION_CATEGORIES, JOINT_MARRIAGE_CATEGORIES } from "./joint-education-marriage";

const fmt = (v: number | null | undefined, unit = "%") => v == null ? "尚無資料" : v.toLocaleString("zh-TW", { maximumFractionDigits: unit === "人" || unit === "處" ? 0 : 2 }) + unit;
type Value = { value: number | null; low?: number | null; high?: number | null };
type Reader = (year: number, geography: string) => Value;
const names = dashboardData.geographies.filter(g => g.level === "DISTRICT").map(g => geographyLabel(g.name));
export function districtPopulationMedian(year: number, ageBand: PolicyContext["ageBand"], sex: PolicyContext["sex"]): number | null {
  const values = names.map(g => getPopulation(year, g, ageBand, sex));
  if (values.length !== 29 || values.some(v => v == null || !Number.isFinite(v))) return null;
  return (values as number[]).sort((a, b) => a - b)[14];
}

export function jointClassificationChart(context: PolicyContext, base: EvidenceChart, joint: JointComparison | null): EvidenceChart | undefined {
  if (!joint?.cells?.length) return undefined;
  return { ...base, title: `新北市與${context.district}教育程度及婚姻狀態比較`, kind: "bar", unit: "%", xLabel: "婚姻狀態", composition: true,
    universe: `新北市與${context.district}戶籍登記現住人口`, period: `${context.year}年12月底`, sex: `${ageBandLabel(context.ageBand)} · ${context.sex}`,
    identity: context.ageBand === "25-29" ? "官方行政值" : "模型估計：PCLM＋IPF",
    method: "各教育程度中該婚姻狀態人口 ÷ 同年、同區、同年齡、同性別的該教育程度總人口 × 100%。同一教育程度的四種婚姻占比合計100%；直接引用既有交叉表，不相乘邊際占比。",
    annotation: undefined, reference: undefined,
    sources: policySourceStatus.filter(s => s.id === "education-marriage").map(s => ({ name: s.topic, url: s.url })),
    comparisonGroups: JOINT_EDUCATION_CATEGORIES.map((education, index) => ({ label: education, left: index * 2, right: index * 2 + 1 })),
    series: JOINT_EDUCATION_CATEGORIES.flatMap(education => ["新北市", context.district].map((geography, index) => ({ name: `${education}・${geography}`, points: JOINT_MARRIAGE_CATEGORIES.map(marriage => {
      const row = joint.cells?.find(c => c.education === education && c.marriage === marriage)?.history.find(h => h.year === context.year);
      return { label: marriage, value: (index === 0 ? row?.cityPct : row?.districtPct) ?? null, low: index === 0 ? row?.cityLowPct : row?.districtLowPct, high: index === 0 ? row?.cityHighPct : row?.districtHighPct };
    }) }))) };
}
const sum = (r: RegisteredRecord | undefined, group: "education" | "marriage", keys: string[]): Value => {
  const metrics = keys.map(k => r?.[group][k]);
  if (metrics.some(m => m == null)) return { value: null };
  return { value: metrics.reduce((s, m) => s + m!.value, 0),
    low: metrics.every(m => m?.low != null) ? metrics.reduce((s, m) => s + m!.low!, 0) : null,
    high: metrics.every(m => m?.high != null) ? metrics.reduce((s, m) => s + m!.high!, 0) : null };
};

/** Presentation only. V7 in policy-engine remains the classification authority. */
export function districtFacts(context: PolicyContext, topic: string, base: EvidenceChart, joint: JointComparison | null): PolicyFact[] {
  const { year, district, ageBand, sex } = context;
  const ranks = buildDistrictRankings(year, ageBand, sex, district);
  const read = (y: number, g: string) => getRegistered(y, g, ageBand, sex);
  function fact(id: string, label: string, unit: string, reader: Reader, method: string, sourceId = "population", ranked = true): PolicyFact {
    const own = reader(year, district).value, city = reader(year, "新北市").value;
    const rankFor = (y: number) => competitionRank(names.map(geography => ({ geography, value: reader(y, geography).value })), district);
    const rank = ranked ? rankFor(year) : null, previousRank = ranked ? rankFor(year - 1) : null;
    const movement = rank == null || previousRank == null ? "前一年排名尚無資料" : previousRank === rank ? "與去年持平" : `較去年${previousRank > rank ? "上升" : "下降"}${Math.abs(previousRank - rank)}名`;
    const gap = displayRoundedDifference(own, city, unit === "人" ? 0 : 2);
    const identity = sourceId === "education-marriage" ? (ageBand === "25-29" ? "官方行政值" : "模型估計：PCLM＋IPF") : "官方行政值直接計算";
    const chart: EvidenceChart = { ...base, title: `${label}：新北市與${district}`, kind: "bar", unit,
      universe: `新北市與${district}戶籍登記現住人口`, period: `${year - 1}、${year}年12月底`, sex: `${ageBandLabel(ageBand)} · ${sex}`, identity, method,
      series: ["新北市", district].map(g => ({ name: g, points: [year - 1, year].map(y => ({ label: y + "年", ...reader(y, g) })) })),
      annotation: undefined, reference: undefined, sources: policySourceStatus.filter(s => s.id === sourceId).map(s => ({ name: s.topic, url: s.url })) };
    return { id, label, rank, chart,
      statement: `${label}${rank == null ? "" : `排名第${rank}名（${movement}）`}：${fmt(own, unit)}。`,
      comparison: `${year}年${district}${fmt(own, unit)}；新北市${fmt(city, unit)}${gap == null ? "" : `，相差${fmt(Math.abs(gap), unit === "%" ? "個百分點" : unit)}（${gap === 0 ? "持平" : gap > 0 ? "高於全市" : "低於全市"}）`}。` };
  }
  const population = () => {
    const f = fact("population", "戶籍人口數", "人", (y, g) => ({ value: getPopulation(y, g, ageBand, sex) }), "官方單一年齡依所選年齡與性別加總；每年12月底存量。");
    const own = getPopulation(year, district, ageBand, sex), benchmark = districtPopulationMedian(year, ageBand, sex);
    const gap = displayRoundedDifference(own, benchmark, 0);
    f.chart = { ...f.chart, title: `戶籍人口數：${district}與29區人口數中位數`, universe: "新北市29個行政區之戶籍登記現住人口",
      method: "每年將29區同年齡、同性別年底戶籍人口數由小到大排序，取第15筆為行政區人口數中位數；與所選區人口數比較。排名仍按29區人口由大到小計算。",
      series: [{ name: "29區人口數中位數", points: [year - 1, year].map(y => ({ label: y + "年", value: districtPopulationMedian(y, ageBand, sex) })) }, f.chart.series[1]] };
    f.comparison = `${year}年${district}${fmt(own, "人")}；29區人口數中位數${fmt(benchmark, "人")}${gap == null ? "" : `，${gap === 0 ? "與中位數相同" : `${gap > 0 ? "多" : "少"}${fmt(Math.abs(gap), "人")}`}`}。`;
    return f;
  };
  const density = () => fact("density", "戶籍人口密度", "人／平方公里", (y, g) => {
    const p = getPopulation(y, g, ageBand, sex), area = read(Math.max(y, 110), g)?.landAreaKm2;
    return { value: p != null && area ? p / area : null };
  }, "同年、同區、同年齡與性別戶籍人口 ÷ 官方土地面積；新北市使用全市人口與全市土地面積。");
  const change = () => fact("change", "戶籍人口年度變化率", "%", (y, g) => ({ value: percentChange(getPopulation(y, g, ageBand, sex), getPopulation(y - 1, g, ageBand, sex)) }), "（當年年底人口－前一年年底人口）÷ 前一年年底人口 × 100%。");
  const category = (group: "education" | "marriage", keys: string[], label: string) => fact(group + keys.join("-"), label, "%", (y, g) => sum(read(y, g), group, keys), `分子：${keys.join("、")}人口；分母：同年、同區、同年齡與性別戶籍人口。占比沿用資料包的PCLM與IPF結果；25–29歲使用原生年齡帶。`, "education-marriage");
  if (topic === "人口趨勢") return [change(), density(), population()];
  if (topic === "人口規模") return [population(), density(), change()];
  if (topic === "教育程度") return [category("education", ["國中及以下", "高中職"], "高中職及以下占比"), ...["國中及以下", "高中職", "專科", "大學", "研究所"].map(k => category("education", [k], k + "占比"))];
  if (topic === "婚姻狀態") return ["有偶", "未婚", "離婚或終止結婚", "喪偶"].map(k => category("marriage", [k], k + "占比"));
  if (topic === "性別結構") return (["男", "女"] as const).map(s => {
    const f = fact("sex-" + s, s + "性占同齡人口比率", "%", (y, g) => ({ value: getRegistered(y, g, ageBand, s)?.sexSharePct ?? null }), `${s}性人口 ÷ 同年、同區、同年齡男女合計戶籍人口 × 100%。`);
    f.chart.sex = `${ageBandLabel(ageBand)} · 男女合計母體中的${s}性占比`;
    return f;
  });
  if (topic === "青年據點") {
    const snapshot = dashboardData.service.snapshotYear;
    const facilities = ranks.find(r => r.key === "facilities")!;
    const reader: Reader = (y, g) => ({ value: y === snapshot ? getServiceFacilities(g).filter(s => s.active).length : null });
    const f = fact("facilities", "清冊內營運中青年據點", "處", reader, "官方青年據點清冊依行政區計數；據點不依年齡或性別拆分。", "population", false);
    f.rank = facilities.rank;
    f.statement = `${snapshot}年清冊列${facilities.value}處營運中青年據點，並列第${facilities.rank}名；尚無前一年清冊排名。`;
    f.comparison = `${snapshot}年清冊：${district}${facilities.value}處，新北市${getServiceFacilities("新北市").filter(s => s.active).length}處。`;
    f.chart.period = `${snapshot}年據點清冊快照`;
    f.chart.universe = "官方清冊列示之青年服務據點";
    f.chart.sex = "據點總數，不分年齡與性別";
    f.chart.identity = "官方據點清冊";
    f.chart.series = ["新北市", district].map(g => ({ name: g, points: [{ label: snapshot + "年清冊", ...reader(snapshot, g) }] }));
    f.chart.sources = [...new Map(getServiceFacilities("新北市").map(s => [s.sourceUrl, { name: "青年局據點清冊", url: s.sourceUrl }])).values()];
    return [f, change(), population()];
  }
  if (topic === "教育×婚姻") {
    const f = fact("joint", "大學及研究所有偶占比", "%", (y, g) => {
      if (g !== district && g !== "新北市") return { value: null };
      const row = joint?.history?.find(h => h.year === y) ?? (y === year ? joint : null);
      return g === district ? { value: row?.districtPct ?? null, low: row?.districtLowPct, high: row?.districtHighPct } : { value: row?.cityPct ?? null, low: row?.cityLowPct, high: row?.cityHighPct };
    }, "大學及研究所有偶人口 ÷ 同年、同區、同年齡與性別的大學及研究所人口 × 100%。沿用交叉表既有PCLM＋IPF換算；上下限為模型敏感度包絡。", "education-marriage", false);
    const cells = joint?.cells?.map(cell => fact("joint-" + cell.education + "-" + cell.marriage, cell.education + "：" + cell.marriage + "占比", "%", (y, g) => {
      const row = cell.history.find(h => h.year === y);
      return g === district ? { value: row?.districtPct ?? null, low: row?.districtLowPct, high: row?.districtHighPct } : g === "新北市" ? { value: row?.cityPct ?? null, low: row?.cityLowPct, high: row?.cityHighPct } : { value: null };
    }, `分子：${cell.education}中${cell.marriage}人口；分母：同年、同區、同年齡與性別的${cell.education}總人口。使用原教育×婚姻交叉表的PCLM＋IPF換算結果；25–29歲使用原生年齡帶。`, "education-marriage", false)) ?? [];
    return [f, ...cells];
  }
  return [];
}

export function districtRuleSteps(context: PolicyContext, topic: string, joint: JointComparison | null): PolicyRuleStep[] {
  const e = getDistrictPolicyEvidence(context.year, context.district, context.ageBand, context.sex);
  const cutoff = Math.max(1, Math.ceil(e.districtCount * .25));
  const step = (label: string, value: number | null, test: (v: number) => boolean, observed: string): PolicyRuleStep => ({ label, observed, met: value == null ? null : test(value) });
  const trend = [step("期間人口增加", e.windowChangePct, v => v > 0, `${e.windowStartYear}–${e.windowEndYear}年變化${fmt(e.windowChangePct)}`), step(`期間成長排名前${cutoff}名`, e.growthRank, v => v <= cutoff, `第${e.growthRank ?? "—"}名／${e.districtCount}區`), step("增加的年度區間達75%", e.annualIntervalCount ? e.positiveAnnualIntervals / e.annualIntervalCount : null, v => v >= .75, `${e.positiveAnnualIntervals}／${e.annualIntervalCount}個區間增加`)];
  if (topic === "人口趨勢") return trend;
  if (topic === "青年據點") return [...trend, step("清冊營運中據點為0處", e.activeServiceSiteCount, v => v === 0, `${dashboardData.service.snapshotYear}年清冊：${e.activeServiceSiteCount}處`)];
  if (topic === "人口規模") return [step(`人口規模排名前${cutoff}名`, e.populationRank, v => v <= cutoff, `第${e.populationRank ?? "—"}名／${e.districtCount}區`), { label: "人口趨勢分流", observed: trend.every(s => s.met === true) ? "優先議題已歸入人口趨勢" : "人口規模獨立列示", met: !trend.every(s => s.met === true) }];
  if (topic === "教育程度" || topic === "婚姻狀態") {
    const education = topic === "教育程度";
    const own = education ? e.educationLowerPct : e.marriedPct, city = education ? e.cityEducationLowerPct : e.cityMarriedPct;
    const gap = own != null && city != null ? own - city : null;
    const rank = education ? e.educationDifferenceRank : e.marriageDifferenceRank;
    const conservative = education ? e.educationConservativeGapPct : e.marriageConservativeGapPct;
    return [step((education ? "高中職及以下" : "有偶") + "占比高於全市至少2個百分點", gap, v => v >= 2, `${fmt(own)} vs ${fmt(city)}；差${fmt(displayRoundedDifference(own, city), "個百分點")}`), step(`差距排名前${cutoff}名`, rank, v => v <= cutoff, `第${rank ?? "—"}名`), ...(e.demographicEstimated ? [step("模型下限高於全市上限", conservative, v => v > 0, `保守差距${fmt(conservative, "個百分點")}`)] : [])];
  }
  if (topic === "教育×婚姻") return [step("大學及研究所有偶占比低於全市至少2個百分點", joint ? joint.cityPct - joint.districtPct : null, v => v >= 2, joint ? `全市${fmt(joint.cityPct)}、本區${fmt(joint.districtPct)}` : "同條件交叉表尚無資料"), ...(joint?.estimated ? [step("全市模型下限高於本區上限", joint.conservativeGapPct, v => v > 0, `保守差距${fmt(joint.conservativeGapPct, "個百分點")}`)] : [])];
  return [step("男女性別占比與全市差至少1個百分點", e.maleSharePct != null && e.cityMaleSharePct != null ? Math.abs(e.maleSharePct - e.cityMaleSharePct) : null, v => v >= 1, `男性占比：本區${fmt(e.maleSharePct)}、全市${fmt(e.cityMaleSharePct)}`), step(`絕對差距排名前${cutoff}名`, e.genderDifferenceRank, v => v <= cutoff, `第${e.genderDifferenceRank ?? "—"}名`)];
}

export function withDistrictFacts(context: PolicyContext, item: PolicyCase, joint: JointComparison | null): PolicyCase {
  const facts = districtFacts(context, item.topic, item.chart, joint);
  return { ...item, facts, ruleSteps: districtRuleSteps(context, item.topic, joint), chart: facts[0]?.chart ?? item.chart,
    overviewChart: item.topic === "教育×婚姻" ? jointClassificationChart(context, item.chart, joint) : undefined,
    headline: facts[0]?.comparison ?? item.headline, baseline: facts[0]?.statement ?? item.baseline, reading: facts.map(f => f.comparison) };
}

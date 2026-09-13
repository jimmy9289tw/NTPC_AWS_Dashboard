import { ageBandLabel, type AgeBand } from "./dashboard-data";
import { evaluateIndustryPolicyConditions } from "./policy-engine";
import { collectIndustryPolicyInput } from "./policy-industry-input";
import { getResidentEmploymentIndustry, residentEmploymentIndustryData, type IndustrySex } from "./resident-employment-industry";
import type { EvidenceChart, PolicyCase, PolicyContext, PolicyFact, PolicyRuleStep } from "./policy-narrative";
import { displayRoundedDifference } from "./policy-narrative";

const number = (value: number | null | undefined) => value == null ? "尚無資料" : value.toFixed(2);
const percent = (value: number | null | undefined) => value == null ? "尚無資料" : number(value) + "%";
const precisePercent = (value: number | null | undefined) => value == null ? "尚無資料" : value.toFixed(6) + "%";
const movement = (value: number | null) => value == null ? "尚無前一年比較" : value === 0 ? "持平" : `${value > 0 ? "增加" : "減少"}${number(Math.abs(value))}個百分點`;

// Charts consume the very same input and predicates as policy-engine. They do
// not recalculate a new rule from the rounded chart labels or change the state.
export function withIndustryEvidence(context: PolicyContext, item: PolicyCase): PolicyCase {
  if (context.scope !== "city" || item.topic !== "行業結構") return item;
  const { year, ageBand, sex } = context;
  const { input, industryCode, leading } = collectIndustryPolicyInput(year, ageBand, sex);
  const result = evaluateIndustryPolicyConditions(input);
  const trendMove = displayRoundedDifference(input.threeYearShares[2], input.threeYearShares[0]);
  const topFiveMove = displayRoundedDifference(input.topFiveSharePct, input.previousTopFiveSharePct);
  const years = [year - 2, year - 1, year];
  const pairYears = [year - 1, year];
  const row = (y: number, selectedSex: IndustrySex = sex, band: AgeBand = ageBand) =>
    getResidentEmploymentIndustry(y, selectedSex, band).find(r => r.industryCode === industryCode);
  const sourceYears = years.filter(y => residentEmploymentIndustryData.meta.years.includes(y));
  const sources = sourceYears.map(y => ({
    name: `${y}年人力資源調查年報（模型原始資料）`,
    url: residentEmploymentIndustryData.meta.sourcePages[String(y)],
  })).filter(s => Boolean(s.url));
  const base: EvidenceChart = {
    title: "", kind: "bar", unit: "%", series: [], xLabel: "年度",
    universe: "平常居住於新北市的青年就業者；分母為同年度、同年齡、同性別就業者",
    sex: sex === "合計" ? "男女合計" : sex,
    period: `${year - 1}–${year}年 · ${ageBandLabel(ageBand)} · 年度調查口徑`,
    identity: leading?.origin ?? "模型估計",
    method: residentEmploymentIndustryData.meta.method, sources,
    limitation: "行業占比是就業結構，不能單獨推論缺工或政策效果。上下限為模型敏感度範圍，不是信賴區間。",
  };
  const trendValues = input.threeYearShares.map((v, i) => `${years[i]}年${percent(v)}`).join(" → ");
  const trendSummary = `${input.industry}：${trendValues}。` + (result.threeYearMove == null
    ? "尚缺完整三年比較值。"
    : `${result.sustainedDirection ? "連續同向" : "未連續同向"}；三年累計${movement(trendMove)}。`);
  const trendChart: EvidenceChart = { ...base, kind: "line",
    title: `${input.industry}：連續三年占比`,
    period: `${year - 2}–${year}年 · ${ageBandLabel(ageBand)} · 年度調查口徑`,
    series: [{ name: input.industry, points: years.map(y => ({ label: y + "年", value: row(y)?.sharePct ?? null, low: row(y)?.sharePctLow, high: row(y)?.sharePctHigh })) }],
    annotation: { label: "三年累計變動", value: movement(trendMove) },
    method: `固定比較${year}年占比最高的「${input.industry}」，不是每年換成不同的第一名。三個年度占比須連續上升或連續下降，且末年減首年的絕對差至少1個百分點。占比沿用原青年模型。`,
    detailTable: { title: "逐年變動與累計差距", columns: ["比較期間", "變動（百分點）"], rows: [
      [`${year - 1}年 − ${year - 2}年`, number(displayRoundedDifference(input.threeYearShares[1], input.threeYearShares[0]))],
      [`${year}年 − ${year - 1}年`, number(displayRoundedDifference(input.threeYearShares[2], input.threeYearShares[1]))],
      ["末年 − 首年", number(trendMove)],
    ] },
  };
  const topFive = (y: number) => [...getResidentEmploymentIndustry(y, sex, ageBand)].sort((a, b) => b.sharePct - a.sharePct).slice(0, 5);
  const concentrationSummary = `前五大行業合計：${year - 1}年${percent(input.previousTopFiveSharePct)} → ${year}年${percent(input.topFiveSharePct)}，${movement(topFiveMove)}。`;
  const concentrationChart: EvidenceChart = { ...base, title: "前五大行業集中度：與前一年度相比",
    series: [{ name: "前五大行業合計占比", points: [{ label: year - 1 + "年", value: input.previousTopFiveSharePct }, { label: year + "年", value: input.topFiveSharePct }] }],
    annotation: { label: "與前一年度相比", value: movement(topFiveMove) },
    method: "每年依同年齡、同性別的19類行業占比重新排序，加總當年前五名。集中度年變動＝本年前五名合計占比 − 前一年前五名合計占比；至少增加1個百分點符合條件。兩年的前五名成員可能不同。",
    detailTable: { title: "各年前五名與加總依據", columns: ["年度／排名", "行業", "占比（計算精度）"], rows: pairYears.flatMap(y => topFive(y).map((r, i) => [y + "年／第" + (i + 1) + "名", r.industry, r.sharePct.toFixed(6) + "%"])) },
  };
  const sexMove = result.currentSexGap == null || result.previousSexGap == null ? null : result.currentSexGap - result.previousSexGap;
  const displayedSexMove = displayRoundedDifference(result.currentSexGap, result.previousSexGap);
  const sexSummary = `${input.industry}男女占比差距：${year - 1}年${number(result.previousSexGap)} → ${year}年${number(result.currentSexGap)}個百分點；${displayedSexMove == null ? "尚無前一年比較" : displayedSexMove === 0 ? "持平" : `${displayedSexMove > 0 ? "擴大" : "縮小"}${number(Math.abs(displayedSexMove))}個百分點`}。`;
  const sexChart: EvidenceChart = { ...base, title: `${input.industry}：男女行業占比差距`, unit: "個百分點", sex: "男性與女性分別計算",
    universe: "平常居住於新北市的青年就業者；男性、女性各以同性別就業者為分母",
    series: [{ name: "男女占比差距（絕對值）", points: [{ label: year - 1 + "年", value: result.previousSexGap }, { label: year + "年", value: result.currentSexGap }] }],
    annotation: { label: "差距年變動", value: movement(displayedSexMove) },
    method: `固定比較${year}年主要行業「${input.industry}」。每年差距＝｜男性該行業占比 − 女性該行業占比｜；本年差距 − 前一年差距至少1個百分點符合條件。不是比較男女就業人數，也不是只看當年差距有多大。`,
    detailTable: { title: "男女占比與差距的計算依據", columns: ["年度／項目", "數值"], rows: pairYears.flatMap((y, i) => [
      [y + "年／男性行業占比", precisePercent(row(y, "男")?.sharePct)],
      [y + "年／女性行業占比", precisePercent(row(y, "女")?.sharePct)],
      [y + "年／兩者差距絕對值（百分點）", (i ? result.currentSexGap : result.previousSexGap)?.toFixed(6) ?? "尚無資料"],
    ]) },
  };
  const bands: AgeBand[] = ["18-24", "25-29", "30-35"];
  const ageSummary = `${year}年男女合計，${input.industry}在三個年齡層的最高與最低占比相差${number(result.lifeStageSpread)}個百分點。`;
  const ageChart: EvidenceChart = { ...base, title: input.industry + "：三個年齡層占比", sex: "男女合計", xLabel: "年齡層", period: year + "年 · 年度調查口徑",
    series: [{ name: "該年齡層行業占比", points: bands.map(band => ({ label: ageBandLabel(band), value: row(year, "合計", band)?.sharePct ?? null, low: row(year, "合計", band)?.sharePctLow, high: row(year, "合計", band)?.sharePctHigh })) }],
    annotation: { label: "最高 − 最低", value: number(result.lifeStageSpread) + "個百分點" },
    method: "按18–24、25–29、30–35歲分別計算男女合計行業占比；最大值減最小值達3個百分點列為補充線索，不單獨列為優先盤點。",
  };
  const facts: PolicyFact[] = [
    { id: "industry-three-year", label: "主要行業三年變動", statement: trendSummary, comparison: trendSummary, chart: trendChart },
    { id: "industry-top-five", label: "前五大行業集中度", statement: concentrationSummary, comparison: concentrationSummary, chart: concentrationChart },
    { id: "industry-sex-gap", label: "男女行業占比差距", statement: sexSummary, comparison: sexSummary, chart: sexChart },
    { id: "industry-age-spread", label: "年齡層差距（補充）", statement: ageSummary, comparison: ageSummary, chart: ageChart },
  ];
  const steps: PolicyRuleStep[] = [
    { label: "主要行業占比連續三年同向變動，累計至少1個百分點。", observed: trendSummary, met: result.threeYearMove == null ? null : result.sustainedMaterialMove, factId: facts[0].id },
    { label: "前五大行業集中度較前一年增加至少1個百分點。", observed: concentrationSummary, met: result.topFiveMove == null ? null : result.concentrationRise, factId: facts[1].id },
    { label: "男女行業占比差距較前一年擴大至少1個百分點。", observed: sexSummary, met: sexMove == null ? null : result.wideningSexGap, factId: facts[2].id },
    { label: "三個年齡層行業占比差距至少3個百分點。", observed: ageSummary, met: result.lifeStageSpread == null ? null : result.lifeStageDifference, factId: facts[3].id, supplementary: true },
  ];
  for (const fact of facts) fact.chart.method += " 圖中變動差距依顯示到小數點後2位的值相減；初篩門檻沿用原資料計算精度。";
  // Reveal precision only when rounding would make the threshold look crossed.
  const moves = [result.threeYearMove == null ? null : Math.abs(result.threeYearMove), result.topFiveMove, sexMove];
  const shown = [trendMove == null ? null : Math.abs(trendMove), topFiveMove, displayedSexMove];
  moves.forEach((value, i) => {
    if (value != null && shown[i] != null && (value >= 1) !== (shown[i]! >= 1)) {
      steps[i].observed += `門檻比較值為${value.toFixed(6)}個百分點。`;
      facts[i].statement = steps[i].observed;
      facts[i].comparison = steps[i].observed;
    }
  });
  const primary = facts.find(f => steps.some(s => !s.supplementary && s.met && s.factId === f.id)) ?? facts[0];
  return { ...item, facts, ruleSteps: steps, ruleMode: "any", chart: primary.chart, headline: primary.comparison,
    reading: steps.filter(s => !s.supplementary && s.met).map(s => s.observed) };
}

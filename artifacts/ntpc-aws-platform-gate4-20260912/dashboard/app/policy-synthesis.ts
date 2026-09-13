import { dashboardData, getLabor, getRegistered, getWage } from "./dashboard-data";
import { getDistrictPolicyEvidence } from "./district-policy-evidence";
import { buildCase, buildPolicyCases, displayRoundedDifference, type EvidenceChart, type JointComparison, type PolicyCase, type PolicyContext, type PolicyOption } from "./policy-narrative";
import type { PolicySignal, PolicySignalState } from "./policy-engine";
import { policySourceStatus } from "./policy-source-status";
import { withDistrictFacts } from "./policy-district-facts";
import { withIndustryEvidence } from "./policy-industry-evidence";

export const policySynthesisVersion = "多證據整合 V1｜2026-09-08";
export type SupportingEvidence = { id: string; topic: string; finding: string; implication: string; chart: EvidenceChart; relation: string };
export type IntegratedPolicyCase = PolicyCase & {
  statusReason: string; supporting: SupportingEvidence[]; synthesis: string; adaptations: string[]; nextCheck: string;
};
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const number = (value: number) => value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
const order: Record<PolicySignalState, number> = { 已觸發: 0, 持續觀察: 1, 目前未觸發: 1, 無法判定: 2 };

// Inventory exposes untriggered branches too. Trigger membership still comes from V7;
// do not copy its thresholds or infer one topic's state from the aggregate state.
export function buildPolicyInventory(context: PolicyContext, signals: PolicySignal[], joint: JointComparison | null = null): IntegratedPolicyCase[] {
  let cases: PolicyCase[];
  const reasons = new Map<string, string>();
  if (context.scope === "district") {
    const signal = signals.find((item) => item.id === "district-population-scale");
    if (!signal) return [];
    const e = getDistrictPolicyEvidence(context.year, context.district, context.ageBand, context.sex);
    const baseReady = finite(e.population) && finite(e.populationRank);
    const growthReady = finite(e.windowChangePct) && finite(e.growthRank) && e.annualIntervalCount > 0;
    const topics: Array<[string, boolean, string]> = [
      ["人口規模", baseReady, "同年度人口與行政區排名"],
      ["人口趨勢", baseReady && growthReady, "至少兩個年度及成長排序"],
      ["青年據點", baseReady && growthReady && finite(e.activeServiceSiteCount), "人口趨勢及營運中據點清冊"],
      ["教育程度", baseReady && finite(e.educationLowerPct) && finite(e.cityEducationLowerPct) && finite(e.educationDifferenceRank) && (!e.demographicEstimated || finite(e.educationConservativeGapPct)), "教育占比、全市基準、差距排名與方法範圍"],
      ["婚姻狀態", baseReady && finite(e.marriedPct) && finite(e.cityMarriedPct) && finite(e.marriageDifferenceRank) && (!e.demographicEstimated || finite(e.marriageConservativeGapPct)), "婚姻占比、全市基準、差距排名與方法範圍"],
      ["教育×婚姻", baseReady && joint != null && finite(joint.districtPct) && finite(joint.cityPct) && (!joint.estimated || finite(joint.conservativeGapPct)), "同條件教育×婚姻交叉表及方法範圍"],
      ["性別結構", baseReady && finite(e.maleSharePct) && finite(e.cityMaleSharePct) && finite(e.genderDifferenceRank), "男女戶籍人口、全市基準與差距排名"],
    ];
    cases = topics.map(([topic, ready, needed]) => {
      const triggered = signal.evidenceDomains.includes(topic);
      const state: PolicySignalState = !ready ? "無法判定" : triggered ? "已觸發" : "目前未觸發";
      const item = withDistrictFacts(context, buildCase(context, { ...signal, state }, topic, joint), joint);
      const reason = !ready ? needed + "尚未齊備；不是沒有政策需求。" : triggered ? topic + "符合原有分支的優先盤點條件，不代表已核定介入。" : topic + "資料可用，但目前未達原分支的優先條件。";
      reasons.set(item.id, reason);
      return item;
    });
  } else {
    cases = buildPolicyCases(context, signals).map(item => withIndustryEvidence(context, item));
    for (const item of cases) reasons.set(item.id, item.state === "無法判定" ? item.headline : item.signal.relativePosition);
  }
  const sorted = [...cases].sort((a, b) => order[a.state] - order[b.state]);
  return sorted.map((item) => integrate(context, item, sorted, reasons.get(item.id) ?? ""));
}

function supportImplication(topic: string, state: PolicySignalState, crossUniverse: boolean) {
  if (state === "無法判定") return "缺少同條件資料；本項不作介入理由，先補齊再判讀。";
  if (crossUniverse) return "僅作全市環境背景；母體不同，不能把這張圖當作主議題族群的個人特徵或因果。";
  const guidance: Record<string, string> = {
    "人口規模": "用來估計可能的服務對象規模；不是實際報名人數。",
    "人口趨勢": "用來比較固定場地或可調度服務的配置方式；不把變動直接解讀為外流。",
    "青年據點": "清冊可協助找合作場地；快照年份不同，不能視為所選年度歷史量能。",
    "教育程度": "可調整課程與資訊難度；仍須詢問技能需求及參與意願。",
    "婚姻狀態": "可提供自選的生活或居住諮詢題目；不能據此認定照顧需求。",
    "教育×婚姻": "可評估自願交流活動；有偶率不是活動意願，也不是活動績效。",
    "性別結構": "用於檢查招募是否涵蓋不同性別；人口差距不等於服務不平等。",
  };
  return guidance[topic] ?? "作為並列觀察，另以實際服務資料確認介入對象。";
}

function demographicSupport(context: PolicyContext, primary: PolicyCase): SupportingEvidence[] {
  if (context.scope !== "city") return [];
  const record = getRegistered(context.year, "新北市", context.ageBand, context.sex);
  if (!record) return [];
  return (["education", "marriage"] as const).map((key) => {
    const entries = Object.entries(record[key]);
    const leading = [...entries].sort((a, b) => b[1].value - a[1].value)[0];
    const topic = key === "education" ? "教育程度" : "婚姻狀態";
    const chart: EvidenceChart = { ...primary.chart, title: `${context.year}年新北市${topic}結構`, unit: "%", kind: "bar",
      universe: "新北市戶籍登記現住人口", period: context.year + "年12月底", sex: context.sex,
      series: [{ name: "占比", points: entries.map(([label, value]) => ({ label, value: value.value, low: value.low, high: value.high })) }],
      identity: leading?.[1].origin ?? "尚無資料", method: leading?.[1].method ?? "依原資料占比與原年齡換算方法；不跨母體合併。",
      sources: policySourceStatus.filter((entry) => entry.id === "education-marriage").map((entry) => ({ name: entry.topic, url: entry.url })),
      limitation: "戶籍結構不能推論服務意願、求職技能或個人工作條件。", annotation: undefined, reference: undefined,
    };
    return { id: "city-context-" + key, topic, finding: leading ? `${topic}中${leading[0]}占${number(leading[1].value)}%。` : "目前結構資料待補。", implication: "用於規劃需求訪談的分組；不把戶籍結構套用成失業者或受僱員工的特徵。", chart, relation: "戶籍結構背景" };
  });
}

function integrate(context: PolicyContext, item: PolicyCase, cases: PolicyCase[], statusReason: string): IntegratedPolicyCase {
  const candidates = cases.filter((other) => other.id !== item.id);
  const supporting: SupportingEvidence[] = candidates.map((other) => {
    const crossUniverse = context.scope === "city" && item.chart.universe !== other.chart.universe;
    return { id: other.id, topic: other.topic, finding: other.headline,
      implication: supportImplication(other.topic, other.state, crossUniverse), chart: other.chart,
      relation: other.state === "無法判定" ? "資料待補" : crossUniverse ? "不同母體背景" : other.state === "已觸發" ? "另有初篩訊號" : "未達優先門檻",
    };
  });
  supporting.push(...demographicSupport(context, item));
  const priority = (topic: string) => cases.some((entry) => entry.topic === topic && entry.state === "已觸發");
  const adaptations: string[] = [];
  if (context.scope === "district") {
    const e = getDistrictPolicyEvidence(context.year, context.district, context.ageBand, context.sex);
    if (e.windowChangePct != null) adaptations.push(e.windowChangePct < 0
      ? `所選期間人口變動${number(e.windowChangePct)}%；先採共用場地或可調度場次，不因人口排名直接增加固定租約。`
      : `所選期間人口變動${number(e.windowChangePct)}%；先保留可增減場次的安排，是否擴大仍由報名、完成及成本決定。`);
    if (priority("教育程度") && item.topic !== "教育程度") adaptations.push("教育占比另達初篩條件：可把技能諮詢設為獨立可選服務，不要求全部活動參與者上課。");
    if (priority("教育×婚姻") && item.topic !== "教育×婚姻") adaptations.push("教育×婚姻另有差距：可增加自願興趣交流，與職涯服務分開報名，不把未婚當成需要介入。");
    if (priority("婚姻狀態") && item.topic !== "婚姻狀態") adaptations.push("有偶占比另達初篩條件：先讓青年自選居住、照顧或職涯諮詢主題，再邀請相符單位，不預設每人都有家庭照顧需求。");
    if (priority("性別結構") && item.topic !== "性別結構") adaptations.push("性別結構另有差距：先分列自願提供性別的報名與完成情形；取得服務資料前，不以人口差距啟動時段A/B測試。");
    if (item.topic === "教育程度" && e.activeServiceSiteCount === 0) adaptations.push(`${dashboardData.service.snapshotYear}年清冊未列營運中青年據點，可先洽既有學校或公共空間辦短課；不是已證明本區沒有服務。`);
  } else {
    const labor = getLabor(context.year, context.ageBand);
    const previous = getLabor(context.year - 1, context.ageBand);
    const change = displayRoundedDifference(labor?.metrics["失業率"], previous?.metrics["失業率"]);
    if (change != null) adaptations.push(`同年齡男女合計失業率較前一年${change >= 0 ? "增加" : "減少"}${number(Math.abs(change))}個百分點；${priority("就業轉銜") ? "可同步洽雇主確認媒合障礙，仍不能把上升歸因為技能不足。" : "未達失業優先條件，不以失業惡化為由普遍擴大訓練班。"}`);
    const industry = cases.find((entry) => entry.topic === "行業結構")?.chart.series[0]?.points[0];
    if (industry?.value != null) adaptations.push(`居住地口徑以${industry.label}就業占比較高（${number(industry.value)}%）；可先邀相關雇主訪談，也納入其他職涯選擇。占比不是職缺數，不能與工作場所薪資直接配成同一批人。`);
    const wage = getWage(context.year, context.ageBand);
    if (!wage) adaptations.push(`${context.year}年青年薪資缺少同口徑值；先做職缺條件整理，不據歷史薪資核定當年補助額或預估加薪效果。`);
    else {
      const gap = displayRoundedDifference(wage.metrics["全年總薪資平均數"], wage.metrics["全年總薪資中位數"], 1);
      if (gap != null) adaptations.push(`${context.year}年平均數與中位數相差${number(gap)}萬元；諮詢資料同列薪資區間、工時與職務，不用平均數當作每位青年的預期薪資。`);
    }
  }
  const topic = item.topic;
  const existingCheck = `先請承辦核對「${topic}」相關現行方案的對象、場次、成本及可用名額；本頁尚未取得完整方案清冊，不能宣稱已有或沒有同類服務。`;
  const approach = item.state === "無法判定" ? "先補齊主議題資料；其餘訊號只能協助規劃查核，不能替它觸發介入。"
    : item.state === "已觸發" ? `以「${topic}」為主，先比較既有方案的小幅調整與可停止的試辦，不把多個訊號加總成風險分數。`
      : `「${topic}」未達優先門檻，先檢查既有服務是否符合實際需求；其他議題的訊號不會自動提高本議題的優先等級。`;
  const profiles: Record<string, [string, string]> = {
    "教育×婚姻": ["可測試不同興趣社群的自願參與與續參意願。", "報名自選造成組成差異，不能以結婚率判定活動效果。"],
    "青年據點": ["可比較巡迴與固定場地的交通、轉介與每服務人次成本。", "短期到場者不代表全區需求；固定設點仍缺跨局處服務量能。"],
    "教育程度": ["可檢查分級課程是否降低退出並改善進修轉介。", "學歷不是技能測驗，須避免把同學歷者視為相同訓練需求。"],
    "就業轉銜": ["可逐筆追查職缺不匹配與媒合後留任的原因。", "雇主職缺、求職意願與景氣同時影響結果，不能只看課程結業。"],
    "行業結構": ["可比較主要行業與跨行業的職缺條件及可移轉技能。", "就業占比不代表未來需求；未核對實際職缺前不承諾訓練後就業。"],
    "薪資與發展": ["可先提高工時、薪資區間與職務條件的可比性。", "全市模型薪資不能代替參與者實際薪資，範圍重疊不是顯著性檢定。"],
    "婚姻狀態": ["讓青年自行選擇諮詢主題，可檢查跨單位轉介是否完成。", "有偶不等於有照顧需求，不以婚姻狀態強制分派服務。"],
    "性別結構": ["可識別報名到完成哪個環節有實際差距。", "目前人口結構不足以證明服務不平等；必須先有服務端資料。"],
  };
  const [benefit, tradeoff] = profiles[topic] ?? ["可比較不同年齡服務入口的使用與完成情形。", "人口變化也受年齡進出與遷徙影響，不能當作方案效果。"];
  const options = item.options.map((option) => ({ ...option,
    action: option.id === "current" ? existingCheck : option.action + (adaptations[0] ? " 本次調整：" + adaptations[0] : ""),
    benefit: option.id === "current" ? `先確認${topic}的現有服務，不重複投入相同項目。` : benefit,
    tradeoff: option.id === "current" ? `若${topic}的實際服務障礙持續存在，維持現況仍有延後改善的成本。` : tradeoff,
  }));
  return { ...item, options, statusReason, supporting, synthesis: approach, adaptations, nextCheck: existingCheck,
    ruleNote: item.ruleNote + " 本版清單額外列出未觸發與缺資料分支；這項可見性調整取代舊版『未觸發面向不顯示』的呈現方式，不更動數值門檻。多個指標可能相關，不作獨立證據加總。",
  };
}

export function policyExecutionPlan(item: IntegratedPolicyCase, option: PolicyOption) {
  const monitoring = option.id === "current" ? [
    { metric: item.topic + "現有服務資料完整率", calculation: "可取得的必要欄位數 ÷ 應備欄位數 × 100%；應備欄位為對象、名額、使用量、成本、成果5項，未取得不填0值。", source: "承辦提供的方案清冊及使用紀錄，尚待取得", frequency: "本次盤點完成時" },
    { metric: item.chart.title, calculation: item.chart.method, source: "原官方來源及原估計方法；不能作服務成效", frequency: "每日審視發布，按官方頻率更新" },
  ] : item.monitoring;
  const lead = option.id === "current" ? item.nextCheck : `${option.title}開始前：${item.nextCheck}`;
  const during = option.id === "current" ? `只盤點${item.topic}的既有紀錄與未滿足需求；不把尚未辦理的試辦填成已有成果。`
    : `${option.id === "adjust" ? "保留既有流程，記下本次改了什麼" : "單獨標記試辦場次與自願參與者"}；按「${monitoring[0].metric}」留下分子、分母與未回覆情形。`;
  const review = option.id === "current" ? `先確認${item.topic}是否已有方案承接，再依資料決定維持或進入最低調整。`
    : `依${option.timing}檢視「${monitoring[0].metric}」及單位成本；${item.adaptations[0] ?? "若服務對象與原假設不同，先修改設計。"}`;
  return { before: lead, during, review, monitoring };
}

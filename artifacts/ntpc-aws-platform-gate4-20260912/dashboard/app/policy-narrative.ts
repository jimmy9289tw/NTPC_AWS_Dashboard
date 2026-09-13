import { ageBandLabel, dashboardData, getRegistered, getLabor, getWage, type AgeBand, type Sex } from "./dashboard-data";
import { getDistrictPolicyEvidence } from "./district-policy-evidence";
import { getResidentEmploymentIndustry } from "./resident-employment-industry";
import { percentChange } from "./map-metrics";
import { policySourceStatus } from "./policy-source-status";
import { median, type PolicySignal, type PolicySignalState } from "./policy-engine";
import { siteRelease } from "./release";

// Presentation adapter only: calculation and trigger authority remain in policy-engine.
export const policyNarrativeVersion = siteRelease.policyExperienceVersion;
export const policyProposalSource = "新北青年政策決策樹_完整提案_V3_20260908_相容修正版.pptx，第11、15–19頁";
export type PolicyContext = { scope: "district" | "city"; district: string; year: number; ageBand: AgeBand; sex: Sex };
export type JointHistoryPoint = { year: number; districtPct: number | null; cityPct: number | null; districtLowPct?: number; districtHighPct?: number; cityLowPct?: number; cityHighPct?: number };
export type JointComparison = { districtPct: number; cityPct: number; conservativeGapPct: number; estimated: boolean; districtLowPct?: number; districtHighPct?: number; cityLowPct?: number; cityHighPct?: number; history?: JointHistoryPoint[]; cells?: Array<{ education: string; marriage: string; history: JointHistoryPoint[] }> };
export type PolicyFact = { id: string; label: string; statement: string; comparison: string; chart: EvidenceChart; rank?: number | null };
export type PolicyRuleStep = { label: string; observed: string; met: boolean | null; factId?: string; supplementary?: boolean };
export type EvidencePoint = { label: string; value: number | null; low?: number | null; high?: number | null };
export type EvidenceChart = {
  title: string; unit: string; kind: "line" | "bar";
  series: Array<{ name: string; points: EvidencePoint[] }>;
  universe: string; period: string; sex: string; identity: string; method: string;
  sources: Array<{ name: string; url: string }>; limitation: string;
  annotation?: { label: string; value: string };
  reference?: { label: string; value: number };
  xLabel?: string;
  composition?: boolean;
  comparisonGroups?: Array<{ label: string; left: number; right: number }>;
  detailTable?: { title: string; columns: string[]; rows: string[][] };
};
export type PolicyOption = { id: string; title: string; action: string; benefit: string; tradeoff: string; timing: string };
export type PolicyCase = {
  id: string; topic: string; state: PolicySignalState; signal: PolicySignal;
  headline: string; reading: string[]; caution: string; chart: EvidenceChart;
  objective: string; beneficiary: string; baseline: string; output: string;
  monitoring: Array<{ metric: string; calculation: string; source: string; frequency: string }>;
  agencies: string; options: PolicyOption[]; evaluation: string; missing: string[];
  ruleNote: string;
  facts?: PolicyFact[];
  ruleSteps?: PolicyRuleStep[];
  ruleMode?: "any";
  overviewChart?: EvidenceChart;
};

const number = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value)
  ? "尚無資料" : value.toLocaleString("zh-TW", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const percent = (value: number | null | undefined) => number(value) + (value == null ? "" : "%");
const count = (value: number | null | undefined) => number(value, 0) + (value == null ? "" : "人");
export function displayRoundedDifference(current: number | null | undefined, baseline: number | null | undefined, digits = 2): number | null {
  if (current == null || baseline == null || !Number.isFinite(current) || !Number.isFinite(baseline)) return null;
  const round = (value: number) => Number(value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: digits, minimumFractionDigits: digits }));
  return round(round(current) - round(baseline));
}
const source = (id: string) => policySourceStatus.filter((item) => item.id === id).map((item) => ({ name: item.topic, url: item.url }));
const order: Record<PolicySignalState, number> = { 已觸發: 0, 持續觀察: 1, 無法判定: 2, 目前未觸發: 3 };

export function policyStateLabel(state: PolicySignalState) {
  return state === "已觸發" ? "優先盤點" : state === "無法判定" ? "資料待補" : "持續監測";
}

function makeChart(context: PolicyContext): EvidenceChart {
  const geography = context.scope === "district" ? context.district : "新北市";
  const years = dashboardData.meta.years.filter((year) => year <= context.year);
  return {
    title: geography + ageBandLabel(context.ageBand) + "戶籍人口變化", unit: "人", kind: "line",
    series: [{ name: "戶籍人口", points: years.map((year) => ({ label: year + "年", value: getRegistered(year, geography, context.ageBand, context.sex)?.population ?? null })) }],
    universe: geography + "戶籍登記現住人口", period: years.length ? years[0] + "–" + context.year + "年，每年12月底" : "所選年度尚無資料",
    sex: context.sex, identity: "官方行政值", method: "官方單一年齡依所選年齡帶加總；年末人口為存量，不加總12個月。",
    sources: source("population"), limitation: "人口變動包含年齡進出、遷徙等因素，不能直接解讀為青年外流或服務不足。",
  };
}

type Draft = { objective: string; pilot: string; adjustment: string; output: string; agencies: string; monitoring: PolicyCase["monitoring"]; evaluation: string };
const serviceMonitoring: PolicyCase["monitoring"] = [
  { metric: "完成轉介比例", calculation: "完成轉介件數 ÷ 已接受轉介件數 × 100%；分母為0不計算。", source: "服務及轉介紀錄，尚待回收", frequency: "每月彙整" },
  { metric: "到場者交通時間", calculation: "到場者回報單程分鐘數的中位數，並列樣本數；不代表未到場者。", source: "活動問卷，尚待回收", frequency: "每場回收" },
  { metric: "每服務人次成本", calculation: "同期間可歸屬成本 ÷ 服務人次；同一人可能重複計入。", source: "核銷與服務紀錄，尚待回收", frequency: "每月彙整" },
];
const employmentMonitoring: PolicyCase["monitoring"] = [
  { metric: "課程完成率", calculation: "完成課程人數 ÷ 正式參訓人數 × 100%；另列中途退出原因。", source: "課程名冊，尚待回收", frequency: "每梯次" },
  { metric: "3個月後就業或進修比例", calculation: "已就業或進修者 ÷ 完成追蹤者 × 100%；另列追蹤回覆率。", source: "參與者追蹤，尚待回收", frequency: "服務後3個月" },
  { metric: "媒合後3個月留任比例", calculation: "3個月後仍在原媒合工作者 ÷ 已屆3個月追蹤期的媒合到職者 × 100%；失聯另列，不視為已留任。", source: "媒合及到職追蹤，尚待回收", frequency: "到職後3個月" },
];

function draftFor(topic: string, context: PolicyContext): Draft {
  const place = context.scope === "district" ? context.district : "新北市";
  if (topic === "教育×婚姻") return {
    objective: "讓有意願的青年有更多在地交流機會，確認哪些活動形式能帶來持續參與。",
    pilot: "在" + place + "既有公共空間試辦6個月、2場青年交流活動，可包含自願參加的聯誼。",
    adjustment: "在既有活動增加興趣社群或跨校跨業交流場次，先詢問參與意願。",
    output: "6個月2場青年交流活動（簡報試辦草案）", agencies: "建議青年局主責，社會局、教育局及區公所協辦；分工待確認。",
    monitoring: [
      { metric: "活動到場率", calculation: "實際到場人次 ÷ 有效報名人次 × 100%；按活動計算，不稱去重觸達率。", source: "報名及簽到紀錄，尚待回收", frequency: "每場" },
      { metric: "後續參與意願", calculation: "願意再參與的有效答卷數 ÷ 該題有效答卷數 × 100%；並列回覆率。", source: "自願活動問卷，尚待回收", frequency: "每場結束後" },
    ], evaluation: "比較不同活動形式的到場、滿意度、後續參與意願與成本。參與者自選造成的差異須保留，不以有偶率或結婚人數考核。",
  };
  if (topic === "行業結構") return {
    objective: "核對主要行業與其他行業的實際職缺，讓青年能比較可移轉技能與工作條件。",
    pilot: "邀請主要及替代行業雇主，共辦職務體驗與小型媒合；先確認職缺真實存在，再招募自願參與者。",
    adjustment: "在既有職涯服務加入跨行業職務比較，列出技能、工時、地點與薪資條件。",
    output: "職缺及合作雇主確認後，再訂體驗梯次與名額", agencies: "建議勞工局主責，青年局、經發局協辦；實際分工待確認。",
    monitoring: [
      { metric: "有效職缺核對率", calculation: "已由雇主確認仍在招募的職缺數 ÷ 本次蒐集職缺數 × 100%；重複職缺去重，分母為0不計。", source: "雇主訪談與職缺清冊，尚待取得", frequency: "每梯次招募前" },
      { metric: "體驗後媒合到職比例", calculation: "已到職者 ÷ 完成職務體驗且有求職意願者 × 100%；另列未回覆者與未求職者。", source: "體驗與媒合追蹤紀錄，尚待取得", frequency: "體驗後1個月" },
      employmentMonitoring[2],
    ], evaluation: "比較不同職務體驗的到職及留任結果，先檢查參與者原始條件。行業占比變動只作背景，不能證明媒合成效。",
  };
  if (topic === "教育程度" || topic === "就業轉銜") return {
    objective: topic === "教育程度" ? "讓有需求的青年完成職涯或技能課程，並接上就業或進修機會。" : "提高參與青年與合適職缺的匹配程度，追蹤服務後是否穩定就業。",
    pilot: topic === "教育程度" ? "每6個月試辦1梯次職涯導航與技能證照課程，搭配就業或進修轉介。" : "先向雇主核對職缺與技能需求，再試辦小班訓練及求職媒合。",
    adjustment: "在既有職涯諮詢增加技能診斷及轉介，記錄未能成功匹配的原因。",
    output: topic === "教育程度" ? "每6個月1梯次（簡報試辦草案）" : "名額、期間與合作職缺待確認",
    agencies: "建議青年局、勞工局共同規劃，教育局協辦；實際主責待確認。", monitoring: topic === "教育程度" ? employmentMonitoring : [
      { metric: "求職媒合到職比例", calculation: "已到職者 ÷ 已完成服務且有求職意願者 × 100%；另列未回覆、進修與退出者。", source: "求職服務及到職追蹤，尚待回收", frequency: "服務後1個月" },
      employmentMonitoring[2],
      { metric: "未匹配原因分布", calculation: "各原因回覆件數 ÷ 有效原因回覆件數 × 100%；多選題另標可重複，不要求合計100%。", source: "青年與雇主雙方回饋，尚待取得", frequency: "每次未成功媒合後" },
    ],
    evaluation: "除完成課程外，追蹤3個月後就業或進修情形。若有可比較對象，先檢查原始條件差異；單純前後變化不能歸因於課程。",
  };
  if (topic === "薪資與發展") return {
    objective: "協助有職涯轉換需求的青年了解薪資條件，確認諮詢是否改善職缺選擇與匹配。",
    pilot: "補齊同口徑薪資與職缺條件後，評估薪資資訊諮詢及職涯轉換小規模試辦。",
    adjustment: "整理既有職缺的薪資區間、工時與職務要求，提供可核對的比較資訊。",
    output: "所選年度資料、職缺與工時資料確認後再訂規模", agencies: "建議勞工局主責，青年局、主計處協辦；分工待確認。",
    monitoring: [
      { metric: "諮詢後職缺匹配情形", calculation: "完成追蹤者中成功匹配的比例；另外列回覆率及工作條件。", source: "諮詢及職缺追蹤，尚待回收", frequency: "服務後3個月" },
      { metric: "青年薪資平均數與中位數", calculation: "沿用同口徑年度資料及原估計方法；名目變化另受物價、工時與組成影響。", source: "既有薪資資料及後續官方更新", frequency: "每日審視發布、按官方年度更新" },
    ], evaluation: "先核對薪資定義、工時與職務是否相同，再比較參與者的就業條件；全市薪資變化不能直接當成諮詢成效。",
  };
  if (topic === "婚姻狀態" || topic === "性別結構") return {
    objective: topic === "婚姻狀態" ? "讓有居住、照顧或職涯諮詢需求的青年更順利取得轉介。" : "確認不同性別青年在服務報名與完成階段是否遇到不同障礙。",
    pilot: topic === "婚姻狀態" ? "以3個月為一期試辦跨局處諮詢，依實際諮詢主題安排轉介。" : "先建立參與資料；確認服務使用差距後，再設計3個月招募管道或時段測試。",
    adjustment: "在現有報名與服務流程增加自願回饋，確認使用者遇到的障礙。",
    output: "3個月一期；服務需求與測試條件待確認", agencies: "依諮詢議題由青年局會同社會局、區公所等單位確認分工。",
    monitoring: topic === "婚姻狀態" ? serviceMonitoring : [
      { metric: "各性別報名至完成比例", calculation: "該性別完成服務人次 ÷ 該性別有效報名人次 × 100%；性別未填另列，不以戶籍人口作分母。", source: "自願提供的性別、報名及完成紀錄，尚待取得", frequency: "每場或每月" },
      { metric: "使用障礙回覆分布", calculation: "回報時段、交通或資訊障礙的有效件數 ÷ 有效回覆件數 × 100%；並列小樣本及未回覆情形。", source: "自願回饋，尚待取得；小樣本不公開細分", frequency: "每場結束後" },
    ], evaluation: "比較轉介完成、等待時間及使用者回饋。人口中的性別比例不能替代服務參與比例，招募測試也不能只改人口分母。",
  };
  return {
    objective: "確認青年取得服務的障礙，讓有需求的人更方便取得諮詢與轉介。",
    pilot: topic === "青年據點" ? "在既有公共空間試辦6個月青年巡迴服務日，每3個月至少2場，再評估是否需要固定據點。" : "在既有方案試辦分齡服務入口，先用需求訪談及實際報名結果確認調整方向。",
    adjustment: "與既有場地及服務單位合作，調整服務時段並登記未被滿足的需求。",
    output: topic === "青年據點" ? "6個月試辦，每3個月至少2場（簡報草案）" : "先確認需求及既有服務，再訂試辦名額與期間",
    agencies: "建議青年局主責，區公所、民政局協辦；實際分工待確認。",
    monitoring: serviceMonitoring, evaluation: "比較交通時間、完成轉介與成本，並回收未使用服務者的意見。到場者的改善不能直接外推為全區青年都受益。",
  };
}

export function buildCase(context: PolicyContext, signal: PolicySignal, topic: string, joint: JointComparison | null): PolicyCase {
  const geography = context.scope === "district" ? context.district : "新北市";
  const chart = makeChart(context);
  const record = getRegistered(context.year, geography, context.ageBand, context.sex);
  const first = chart.series[0].points[0]?.value;
  const growth = percentChange(record?.population, first);
  let headline = geography + ageBandLabel(context.ageBand) + "戶籍人口為" + count(record?.population);
  let reading = [chart.period + "人口變化" + percent(growth) + "。", signal.signal];
  let baseline = "目前戶籍人口 " + count(record?.population);
  let caution = chart.limitation;
  if (growth != null && chart.series[0].points.length > 1) chart.annotation = { label: "所選期間人口變動", value: percent(growth) };
  if (context.scope === "district") {
    const evidence = getDistrictPolicyEvidence(context.year, context.district, context.ageBand, context.sex);
    reading = [
      "同一年度、年齡與性別下，人口變動率排名第" + (evidence.growthRank ?? "尚無資料") + "／" + evidence.districtCount + "區。",
      "所選期間" + evidence.positiveAnnualIntervals + "／" + evidence.annualIntervalCount + "個年度區間人口增加；區間不足時不判讀持續趨勢。",
    ];
    if (topic === "青年據點") {
      headline = context.district + "青年人口於所選期間變化" + percent(evidence.windowChangePct) + (signal.state === "已觸發" ? "，可先評估巡迴服務。" : "；是否需要調整服務，仍依本議題狀態判讀。");
      reading.push(dashboardData.service.snapshotYear + "年官方清冊列有" + evidence.activeServiceSiteCount + "處營運中青年據點。這是清冊快照，不是" + context.year + "年歷史據點數。看人口與據點，尚不能判定服務不足。");
      caution = "目前無行政區服務資料。官方清冊未列不代表沒有其他局處、民間或巡迴服務；新增固定據點仍需使用量與成本證據。";
    } else if (["教育程度", "婚姻狀態", "教育×婚姻", "性別結構"].includes(topic)) {
      const own = topic === "教育程度" ? evidence.educationLowerPct : topic === "婚姻狀態" ? evidence.marriedPct : topic === "性別結構" ? evidence.maleSharePct : joint?.districtPct ?? null;
      const city = topic === "教育程度" ? evidence.cityEducationLowerPct : topic === "婚姻狀態" ? evidence.cityMarriedPct : topic === "性別結構" ? evidence.cityMaleSharePct : joint?.cityPct ?? null;
      const label = topic === "教育程度" ? "高中職及以下占比" : topic === "婚姻狀態" ? "有偶占比" : topic === "性別結構" ? "男性占青年人口比率" : "大學及研究所有偶占比";
      const gap = displayRoundedDifference(own, city);
      headline = geography + label + percent(own) + (gap == null ? "，比較資料待補。" : "，" + (gap >= 0 ? "高於" : "低於") + "全市" + number(Math.abs(gap)) + "個百分點。");
      chart.title = context.year + "年" + label + "：" + geography + "與全市";
      chart.unit = "%"; chart.kind = "bar"; chart.period = context.year + "年12月底";
      chart.series = [{ name: label, points: [{ label: geography, value: own }, { label: "新北市", value: city }] }];
      chart.annotation = gap == null ? undefined : { label: "相較全市", value: (gap >= 0 ? "高" : "低") + number(Math.abs(gap)) + "個百分點" };
      if (topic === "教育×婚姻" && joint) {
        Object.assign(chart.series[0].points[0], { low: joint.districtLowPct, high: joint.districtHighPct });
        Object.assign(chart.series[0].points[1], { low: joint.cityLowPct, high: joint.cityHighPct });
      }
      chart.sex = topic === "性別結構" ? "男女合計母體中的男性占比（此指標不隨性別篩選改變）" : context.sex;
      chart.identity = topic === "性別結構" ? "官方行政值" : topic === "教育×婚姻" ? (joint?.estimated ? "模型估計" : "依原始交叉表計算；載入狀態見數值") : (evidence.demographicEstimated ? "模型估計" : "官方行政值直接彙整");
      chart.method = topic === "教育×婚姻" ? "分子為大學及研究所有偶人口；分母為同年、同區、同年齡及性別的大學及研究所人口。沿用PCLM＋IPF結果；25–29歲依原始交叉表。" : topic === "性別結構" ? "男性青年人口 ÷ 男女合計青年人口 × 100%。" : (record?.[topic === "教育程度" ? "education" : "marriage"]?.[topic === "教育程度" ? "高中職" : "有偶"]?.method ?? "沿用已發布類別占比及原方法。") + "；分母為同年、同區、同年齡與性別戶籍人口。";
      chart.sources = source(topic === "性別結構" ? "population" : "education-marriage");
      chart.method += " 畫面差額先將兩個占比各四捨五入至小數點後兩位再相減，便於直接核對。原估計、排名及觸發規則仍使用原始精度。";
      const band = topic === "教育×婚姻" ? displayRoundedDifference(joint?.cityLowPct, joint?.districtHighPct) ?? joint?.conservativeGapPct : topic === "教育程度" ? evidence.educationConservativeGapPct : topic === "婚姻狀態" ? evidence.marriageConservativeGapPct : null;
      reading = ["比較使用相同年度與年齡條件。" + (topic === "性別結構" ? "這張圖專看男女合計中的男性占比。" : "全市是參考基準，不是政策應達到的目標。"),
        band == null ? "差距為描述性比較，不是政策效果或顯著性檢定。" : "原模型敏感度包絡的保守差距為" + number(band) + "個百分點；這不是信賴區間或顯著性檢定。"];
      baseline = label + " " + percent(own) + "；全市 " + percent(city);
      caution = topic === "教育×婚姻" || topic === "婚姻狀態" ? "婚姻狀態不能推論交友意願、照顧需求或生活好壞，也不作為活動績效目標。" : topic === "性別結構" ? "人口性別結構不能證明服務觸及不平等。缺少按性別的參與紀錄，不能啟動以服務落差為由的A/B測試。" : "教育程度不能直接代表技能不足或求職意願；課程需求仍須由青年及雇主資料確認。";
    }
  } else if (signal.id === "labor-unemployment-movement") {
    const current = getLabor(context.year, context.ageBand);
    const previous = getLabor(context.year - 1, context.ageBand);
    const rate = current?.metrics["失業率"];
    const change = displayRoundedDifference(rate, previous?.metrics["失業率"]);
    headline = context.year + "年青年失業率" + percent(rate) + (change == null ? "，前一年比較值不足。" : "，較前一年" + (change >= 0 ? "增加" : "減少") + number(Math.abs(change)) + "個百分點。");
    chart.title = "青年失業率年度變化"; chart.unit = "%"; chart.sex = "男女合計（尚無同性別勞動估計）";
    chart.universe = "平常居住於新北市的民間人口及勞動力";
    chart.period = chart.period.replace("每年12月底", "全年12個月平均");
    chart.series = [{ name: "失業率", points: dashboardData.meta.years.filter((year) => year <= context.year).map((year) => ({ label: year + "年", value: getLabor(year, context.ageBand)?.metrics["失業率"] ?? null })) }];
    chart.identity = current?.meta["失業率"]?.origin ?? "所選年度尚無資料";
    chart.method = "先依原年齡換算取得失業人數及勞動力，再以失業人數 ÷ 勞動力 × 100%；非戶籍人口分母。";
    chart.sources = source("labor"); reading = [signal.relativePosition, signal.state === "已觸發" ? "既有規則已觸發，可比較訓練轉介與媒合選項；仍需確認青年和職缺的實際障礙。" : "目前未形成優先介入訊號。下方列的是可供準備的選項，不表示已證明需要擴大方案。"];
    const referenceValue = median(dashboardData.meta.years.map((year) => getLabor(year, context.ageBand)?.metrics["失業率"]).filter((value): value is number => value != null));
    if (referenceValue != null) chart.reference = { label: dashboardData.meta.years[0] + "–" + dashboardData.meta.years.at(-1) + "年中位數（比較基準，非目標）", value: referenceValue };
    chart.annotation = change == null ? undefined : { label: "與前一年度相比", value: (change >= 0 ? "+" : "−") + number(Math.abs(change)) + "個百分點" };
    baseline = "失業率 " + percent(rate); caution = "這是調查估計及年齡換算結果。失業率變化不能單獨歸因於某項政策；所選性別不適用這份男女合計資料。";
  } else if (signal.id === "industry-youth-structure") {
    const rows = [...getResidentEmploymentIndustry(context.year, context.sex, context.ageBand)].sort((a, b) => b.sharePct - a.sharePct);
    headline = rows[0] ? "青年就業者以" + rows[0].industry + "占比最高，為" + percent(rows[0].sharePct) + "。" : "所選條件尚無青年行業結構資料。";
    chart.title = context.year + "年前五大行業就業占比"; chart.unit = "%"; chart.kind = "bar";
    chart.universe = "平常居住於新北市的青年就業者"; chart.period = context.year + "年，年度調查口徑";
    chart.series = [{ name: "就業占比", points: rows.slice(0, 5).map((row) => ({ label: row.industry, value: row.sharePct, low: row.sharePctLow, high: row.sharePctHigh })) }];
    chart.identity = rows[0]?.origin ?? "尚無資料"; chart.method = rows[0]?.method ?? "PCLM及IPF模型估計，沿用原就業人口分母。"; chart.sources = source("industry");
    chart.annotation = rows.length ? { label: "前五大行業合計占比", value: percent(rows.slice(0, 5).reduce((sum, row) => sum + (displayRoundedDifference(row.sharePct, 0) ?? 0), 0)) } : undefined;
    chart.method += " 畫面前五大合計以各行已顯示的兩位小數相加；原始占比、排名及規則精度不變。";
    reading = [signal.relativePosition, "行業占比高表示目前就業分布較集中，不代表該行業有更多職缺，也不代表適合所有青年。"];
    baseline = rows[0] ? rows[0].industry + " " + percent(rows[0].sharePct) : "尚無資料"; caution = signal.unsupportedConclusion;
  } else if (signal.id === "wage-freshness-and-identity") {
    const years = dashboardData.meta.years.filter((year) => year <= context.year);
    const latestYear = years.filter((year) => getWage(year, context.ageBand)).at(-1);
    const latest = latestYear == null ? undefined : getWage(latestYear, context.ageBand);
    const current = getWage(context.year, context.ageBand);
    headline = !current ? context.year + "年薪資尚無同口徑值" + (latestYear == null ? "。" : "，最新可用為" + latestYear + "年。") : signal.signal;
    chart.title = "全年總薪資平均數與中位數"; chart.unit = "萬元"; chart.sex = "男女合計（尚無同性別薪資估計）";
    chart.universe = "工作場所位於新北市的受僱員工"; chart.period = years[0] + "–" + context.year + "年，全年總薪資；缺年留空";
    chart.series = ["全年總薪資平均數", "全年總薪資中位數"].map((metric) => ({ name: metric.replace("全年總薪資", ""), points: years.map((year) => { const row = getWage(year, context.ageBand); return { label: year + "年", value: row?.metrics[metric] ?? null, low: row?.meta[metric]?.low, high: row?.meta[metric]?.high }; }) }));
    chart.identity = latest?.meta["全年總薪資平均數"]?.origin ?? "尚無資料";
    chart.method = "沿用原年齡薪資估計：平均數採年齡相對關係校準，中位數由薪資分布混合取得；範圍為模型敏感度，不是信賴區間。"; chart.sources = source("wage-youth");
    const mean = latest?.metrics["全年總薪資平均數"], med = latest?.metrics["全年總薪資中位數"];
    chart.kind = "bar";
    chart.title = latestYear == null ? "所選年度薪資尚無資料" : latestYear + "年全年薪資：平均數與中位數差距";
    chart.period = latestYear == null ? context.year + "年尚無資料" : latestYear + "年全年總薪資" + (!current ? "；所選" + context.year + "年尚無資料，歷史值僅供背景" : "");
    chart.series = [{ name: "全年總薪資", points: [
      { label: (latestYear ?? context.year) + "年平均數", value: mean ?? null, low: latest?.meta["全年總薪資平均數"]?.low, high: latest?.meta["全年總薪資平均數"]?.high },
      { label: (latestYear ?? context.year) + "年中位數", value: med ?? null, low: latest?.meta["全年總薪資中位數"]?.low, high: latest?.meta["全年總薪資中位數"]?.high },
      ...(!current && latestYear != null ? [{ label: context.year + "年", value: null }] : []),
    ] }];
    const displayedWageGap = displayRoundedDifference(mean, med, 1);
    chart.annotation = displayedWageGap == null ? undefined : { label: (latestYear ?? context.year) + "年平均數減中位數", value: number(displayedWageGap, 1) + "萬元" };
    chart.method += " 畫面薪資差額以顯示至小數點後一位的平均數與中位數相減。";
    reading = [latestYear == null ? "沒有可用的歷年薪資值。" : latestYear + "年平均數" + number(mean, 1) + "萬元、中位數" + number(med, 1) + "萬元；" + (displayedWageGap == null ? "差額尚無資料。" : "差額" + number(displayedWageGap, 1) + "萬元。"), "平均數與中位數的距離可以描述薪資分布，但不足以判定哪個因素造成差異。"];
    baseline = current ? "同年度平均數 " + number(current.metrics["全年總薪資平均數"], 1) + "萬元" : "所選年度缺值；歷史值僅供背景閱讀"; caution = "薪資為工作場所口徑，不能描述為新北市設籍青年所得。模型範圍重疊不能證明統計上無顯著差異。";
  } else {
    reading = ["所選期間戶籍青年人口變化" + percent(growth) + "。人口減少的原因需再查年齡進出與遷徙，不能直接歸因為留居意願下降。", signal.signal];
  }
  chart.limitation = caution;
  const draft = draftFor(topic, context);
  return {
    id: signal.id + ":" + topic, topic, state: signal.state, signal, headline, reading, caution, chart,
    objective: draft.objective, beneficiary: geography + "、" + ageBandLabel(context.ageBand) + "中有相關需求且自願參與的青年",
    baseline, output: draft.output, agencies: draft.agencies, monitoring: draft.monitoring, evaluation: draft.evaluation,
    options: [
      { id: "current", title: "維持現況", action: "維持既有服務，先回收需求與使用情形，不新增試辦。", benefit: "可先補齊基準，避免在需求尚未確認時增加固定支出。", tradeoff: "若既有使用者確有障礙，改善會較慢；仍需要追蹤人力。", timing: "依既有服務週期追蹤" },
      { id: "adjust", title: "最低調整", action: draft.adjustment, benefit: "可使用既有場地與流程，先確認服務調整是否可行。", tradeoff: "仍有協作及人力成本，不能保證改善結果。", timing: "期間、負責人與可用量能待確認" },
      { id: "pilot", title: "小規模試辦", action: draft.pilot, benefit: "可取得服務使用、結果及成本紀錄，再決定是否擴大。", tradeoff: "需要核定預算、對象及比較方式；短期結果不能直接外推全市。", timing: draft.output },
    ],
    missing: [...new Set([...signal.missingData, "成效指標基準、目標值、預算與執行期限尚待核定"])],
    ruleNote: "沿用既有觸發規則；介入內容參考修正版簡報。門檻、頻率與權責仍為待核定草案。",
  };
}

export function buildPolicyCases(context: PolicyContext, signals: PolicySignal[], joint: JointComparison | null = null): PolicyCase[] {
  const ordered = [...signals].sort((a, b) => order[a.state] - order[b.state]);
  if (context.scope === "district") {
    const signal = ordered.find((item) => item.id === "district-population-scale");
    if (!signal) return [];
    const allowed = ["教育×婚姻", "青年據點", "教育程度", "婚姻狀態", "性別結構", "人口規模", "人口趨勢"];
    const topics = signal.evidenceDomains.filter((item) => allowed.includes(item) && !(item === "人口趨勢" && signal.evidenceDomains.includes("青年據點")));
    return (topics.length ? topics : ["人口趨勢"]).map((topic) => buildCase(context, signal, topic, joint));
  }
  const topics: Record<string, string> = { "life-stage-composition": "人口與生命階段", "labor-unemployment-movement": "就業轉銜", "industry-youth-structure": "行業結構", "wage-freshness-and-identity": "薪資與發展" };
  return ordered.filter((signal) => topics[signal.id]).map((signal) => buildCase(context, signal, topics[signal.id], null));
}

export function policyChatPrompt(context: PolicyContext, policyCase: PolicyCase, option: PolicyOption, question: string) {
  return "政策研判範圍：" + (context.scope === "district" ? context.district : "新北市全市") + "；" + context.year + "年；" + ageBandLabel(context.ageBand) + "；實際資料性別：" + policyCase.chart.sex + "。\n"
    + "本次議題：" + policyCase.topic + "。資料訊號：" + policyCase.headline + "\n"
    + "政策目標草案：" + policyCase.objective + "；目前比較選項：" + option.title + "，" + option.action + "\n"
    + "母體：" + policyCase.chart.universe + "；限制：" + policyCase.caution + "\n"
    + (context.scope === "district" ? "不得將全市勞動、行業或薪資分攤為行政區數值。\n" : "三母體不可互換分母。\n")
    + "請依可查核來源回答，區分觀察結果、待驗證原因及政策草案，不補造目標值或成效。\n問題：" + question;
}

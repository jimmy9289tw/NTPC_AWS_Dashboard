"use client";
import {AwsChat,type ChatContext} from './aws-chat';
import { monthlyPopulationView, type MonthlyViewMode } from "./monthly-population-view";
import { monthlyChartLayout, monthlyTickIndices } from './monthly-chart-layout';
import { monthlyPopulationData } from './monthly-population';
const monthlyPeriods = monthlyPopulationData.meta.periods;
const monthLabel = (p: string) => `${p.slice(0,-2)}年${Number(p.slice(-2))}月`;
const monthlyPeriodLabel = `${monthLabel(monthlyPeriods[0])}至${monthLabel(monthlyPeriods.at(-1)!)}`;
const monthlyPeriodCompact = `${monthlyPeriods[0].slice(0,-2)}/${monthlyPeriods[0].slice(-2)}–${monthlyPeriods.at(-1)!.slice(0,-2)}/${monthlyPeriods.at(-1)!.slice(-2)}`;

import { quadrantPlot, QuadrantPointTooltip } from "./quadrant-chart-primitives";
import { categoryFacts, changeFact, seriesFacts, trendFact } from "./data-reading";
import { DataReadingSummary } from "./data-reading-summary";
import { navigationLabels, entryPeriods } from "./workspace-presentation";
import { useModalInteraction } from "./modal-interaction";
import { ChartCanvas, chartLabelLines } from "./chart-canvas";
import { chartMotionKey, useChartTransition } from "./chart-transition";

import { FormEvent, KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ageBandLabel,
  dashboardData,
  geographyLabel,
  getLabor,
  getRegistered,
  getRegisteredTotalPopulation,
  getServiceAnnual,
  getServiceFacilities,
  getWage,
  type AgeBand,
  type CategoryMetric,
  type RegisteredRecord,
  type ServiceFacility,
  type Sex,
} from "./dashboard-data";
import { ExportCenter } from "./export-center";
import { siteRelease } from "./release";
import { getDistrictPolicyEvidence } from "./district-policy-evidence";
import {
  getResidentEmploymentIndustry,
  getResidentEmploymentTotal,
  residentEmploymentIndustryData,
  type IndustrySex,
} from "./resident-employment-industry";
import {
  divergingGradientColors,
  interpolateGradientColor,
  mapThresholdVersion,
  numericDomain,
  percentChange,
  roundedCountCeiling,
  roundUpToTen,
  sequentialGradientColors,
  symmetricDomain,
  type MapMetric,
} from "./map-metrics";
import {
  findJointEducationMarriage,
  higherEducationMarriedShare,
  JOINT_DATA_URL,
  JOINT_EDUCATION_CATEGORIES,
  JOINT_MARRIAGE_CATEGORIES,
  type JointEducationMarriagePayload,
} from "./joint-education-marriage";
import { buildDistrictRankings, type DistrictRankingMetric } from "./district-annual-rankings";
import { youthIndustryWage, type YouthIndustryWageAgeBand } from "./youth-industry-wage";
import { compoundAnnualGrowthRatePct, estimateRangesOverlap, growthRatePct, meanMedianGap, meanMedianGapSharePct } from "./wage-metrics";
import { PolicyWorkflow } from "./policy-workflow";
import { CustomAnalysisWorkbench } from "./custom-analysis-workbench";
import { molSalaryContext } from "./mol-salary-context";
import {
  buildIndustryPolicySignal,
  buildDistrictPolicySignal,
  buildLaborPolicySignal,
  buildLifeStagePolicySignal,
  buildWagePolicySignal,
  median,
  type PolicySignal,
  type PolicySignalState,
} from "./policy-engine";

type Answer = {
  answer: string;
  caveat?: string;
  mode?: string;
  sources?: Array<{ id: string; label?: string; url: string }>;
};

type MonthlyAnalysisResponse = {
  rows: Array<{
    period: string;
    year: number;
    month: number;
    geography: string;
    ageBand: AgeBand;
    sex: Sex;
    population: number;
    monthChange: number | null;
    yearChange: number | null;
  }>;
  meta: {
    generatedAt: string;
    sourceName: string;
    sourceUrl: string;
    identity: string;
    method: string;
    availability: string;
  };
  scale: {
    minimum: number;
    maximum: number;
    rule: string;
  };
};

type AuthStatus = {
  authenticated: boolean;
  email?: string;
  name?: string | null;
  role?: "viewer" | "decision";
  permissions?: {
    viewPolicy: boolean;
    exportData: boolean;
  };
};

type ChartEvidence = {
  universe: string;
  period: string;
  identity: string;
  method: string;
  source: string;
  sourceUrl?: string;
  availability?: string;
  updatedAt?: string;
};

type StoryStep = {
  label: string;
  title: string;
  detail: string;
};

type PageStory = {
  title: string;
  lead: string;
  steps: [StoryStep, StoryStep, StoryStep, StoryStep];
  evidenceNote: string;
};

type Position = [number, number];
type Geometry =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };
type DistrictFeature = {
  type: "Feature";
  properties: { TOWNNAME: string };
  geometry: Geometry;
};
type FeatureCollection = { type: "FeatureCollection"; features: DistrictFeature[] };
type DashboardView = "overview" | "registered" | "district" | "labor" | "industry" | "wage" | "policy" | "custom" | "export";
type AnalysisMode = "trend" | "monthly";

const viewConfig: Record<DashboardView, { index: string; label: string; eyebrow: string; title: string; description: string; universe: string; scope: string; timeBasis: string }> = {
  overview: {
    index: "00",
    label: "資料入口",
    eyebrow: "選擇這次要查的問題",
    title: "先選資料，再看結論",
    description: "首頁列出目前帳號可用的資料分析與決策工具。每個入口都標示地理範圍、年度、性別與資料限制。",
    universe: "三種母體分開使用",
    scope: "全市、29區或工作場所依入口決定",
    timeBasis: "各入口顯示實際可用年度",
  },
  registered: {
    index: "01",
    label: "戶籍人口／教育程度／婚姻狀態／男女（全新北市）",
    eyebrow: "全新北市｜戶籍人口母體",
    title: "戶籍人口、教育、婚姻與男女結構",
    description: "固定檢視新北市全市。人口與男女為官方行政值；教育與婚姻的估計欄位保留PCLM與IPF方法身分。",
    universe: "戶籍登記現住人口",
    scope: "新北市全市",
    timeBasis: "人口可逐月；教育與婚姻依官方發布週期",
  },
  district: {
    index: "02",
    label: "戶籍人口／教育程度／婚姻狀態／男女（29個行政區）",
    eyebrow: "29行政區｜戶籍人口母體",
    title: "用地圖比較戶籍人口與生命階段",
    description: "以戶籍登記地檢視29區人口、男女、教育及婚姻結構。勞動與薪資沒有行政區資料，不會套用這裡的地區選擇。",
    universe: "戶籍登記現住人口",
    scope: "新北市29行政區",
    timeBasis: "每月月底；年度值採12月31日存量",
  },
  labor: {
    index: "03",
    label: "就業率／失業率（全新北市）",
    eyebrow: "就業與職涯｜民間人口及勞動市場母體",
    title: "勞動參與、就業與失業",
    description: "以民間人口或勞動力作分母，呈現新北市整體調查估計。行政區與戶籍人口篩選不會套用到這一頁。",
    universe: "新北市民間人口與勞動力",
    scope: "新北市整體",
    timeBasis: "全年12個月平均；官方半年表作年齡拆分輔助",
  },
  industry: {
    index: "04",
    label: "青年就業者行業結構（全新北市）",
    eyebrow: "就業與職涯｜青年分析層",
    title: "青年就業者分布在哪些行業",
    description: "以平常居住於新北市的就業者為母體，將官方寬年齡帶透過PCLM與IPF換算成四組青年年齡；所有結果保留模型估計與敏感度標籤。",
    universe: "平常居住於新北市的就業者",
    scope: "新北市整體",
    timeBasis: "110–114年；官方上下半年平均形成年度矩陣",
  },
  wage: {
    index: "05",
    label: "薪資資料（全新北市）",
    eyebrow: "薪資與發展｜受僱員工薪資母體",
    title: "工作場所受僱員工薪資與資料時效",
    description: "母體是工作場所位於新北市的本國籍全時受僱員工，不等同戶籍青年或全體勞動力；缺值維持缺值，不以其他年度代填。",
    universe: "工作場所位於新北市的受僱員工",
    scope: "新北市整體",
    timeBasis: "全年統計；目前最新可比年度為113年",
  },
  policy: {
    index: "06",
    label: "政策研判",
    eyebrow: "決策內網｜證據與方案",
    title: "先形成政策問題，再比較可行選項",
    description: "從R資料依據與O關注目標，整理A四象限分級及未來研擬方向。",
    universe: "各資料母體分開研判",
    scope: "新北市全市及29區；僅使用可發布層級",
    timeBasis: "110–114年；薪資114年缺值，113年僅作明示背景",
  },
  custom: {
    index: "07",
    label: "自訂分析",
    eyebrow: "決策內網｜互動式分析",
    title: "選擇欄位，建立自己的比較圖",
    description: "提供類似BI工具的欄位角色與篩選器；一次只使用一種母體，X軸與Y軸只代表圖表角色，不自動宣稱因果。",
    universe: "使用者所選單一母體",
    scope: "依資料主題限制可用地理層級",
    timeBasis: "依資料主題顯示實際可用年度",
  },
  export: {
    index: "08",
    label: "資料匯出",
    eyebrow: "資料、欄位與來源",
    title: "依條件選擇並匯出CSV",
    description: "先選母體，再選年度、年齡、性別、行政區與欄位。系統保留缺值、數值身分、方法、來源及Code Book。",
    universe: "三種母體分檔匯出",
    scope: "依所選母體限制可用地理層級",
    timeBasis: "戶籍與勞動110–114年；薪資110–113年",
  },
};

const educationColors: Record<string, string> = {
  研究所: "#075985",
  大學: "#0284c7",
  專科: "#38bdf8",
  高中職: "#7dd3fc",
  國中及以下: "#bae6fd",
};
const marriageColors: Record<string, string> = {
  未婚: "#0f766e",
  有偶: "#14b8a6",
  "離婚或終止結婚": "#f59e0b",
  喪偶: "#64748b",
};
const ageOrder: AgeBand[] = ["18-24", "25-29", "30-35", "18-35"];
const uiVersion = siteRelease.uiVersion;
const dataVersion = "G5 V3.7（青年四年齡層薪資層）";
const policyRulesVersion = siteRelease.policyRulesVersion;
const serviceDataVersion = dashboardData.meta.externalDataVersion;

const viewIcons: Record<DashboardView, string> = {
  overview: "/icons/overview.png",
  registered: "/icons/life-stage.png",
  district: "/icons/district-compare.png",
  labor: "/icons/employment.png",
  industry: "/icons/employment.png",
  wage: "/icons/salary.png",
  policy: "/icons/overview.png",
  custom: "/icons/district-compare.png",
  export: "/icons/overview.png",
};

const dataEntryViews: DashboardView[] = ["registered", "district", "labor", "industry", "wage"];
function leaderState(state: PolicySignalState) {
  if (state === "已觸發") return { label: "優先盤點", icon: "!" };
  if (state === "無法判定") return { label: "資料待補", icon: "?" };
  return { label: "持續監測", icon: "•" };
}

const quickQuestionsByView: Record<DashboardView, string[]> = {
  overview: ["八個資料入口有什麼差別？", "哪些資料可以看到29個行政區？", "哪些資料目前只有男女合計？"],
  registered: ["114年新北市18–35歲戶籍人口有多少？", "18–35歲教育程度如何換算？", "戶籍人口每月增減怎麼計算？"],
  district: ["淡水區有哪些政策建議與數據依據？", "114年板橋區18–35歲戶籍人口密度是多少？", "烏來區有哪些政策建議與教育婚姻數據依據？"],
  labor: ["114年18–35歲失業率與勞參率是多少？", "失業率和就業人口比率的分母有何不同？", "新北市就業者的行業資料可切18–35歲嗎？"],
  industry: ["114年18–35歲就業者主要分布在哪些行業？", "25–29歲男性與女性的行業結構有何不同？", "青年行業資料如何用PCLM與IPF估計？"],
  wage: ["113年18–35歲平均薪資與中位數差多少？", "18–35歲110至113年薪資成長速度如何？", "114年18–35歲薪資為何尚未呈現？"],
  policy: ["目前哪些訊號需要優先盤點？", "這項建議有哪些政策選項？", "送交決策前還缺哪些資料？"],
  custom: ["如何選擇X軸、Y軸與圖例？", "哪些欄位可以在同一張圖比較？", "為什麼不同母體不能直接合併？"],
  export: ["我要怎麼匯出三種母體的CSV？", "Code Book可以查到哪些欄位定義？", "為什麼勞動與薪資不能選行政區？"],
};

const viewerQuickQuestionsByView: Record<DashboardView, string[]> = {
  ...quickQuestionsByView,
  district: ["114年板橋區18–35歲戶籍人口密度是多少？", "淡水區五年青年人口如何變化？", "烏來區教育與婚姻資料的估計方法是什麼？"],
  export: ["三種資料母體有什麼差別？", "哪些欄位是官方值或模型估計？", "資料多久審視一次？"],
};

function isDashboardView(value: string | null): value is DashboardView {
  return value === "overview" || value === "registered" || value === "district" || value === "labor" || value === "industry" || value === "wage" || value === "policy" || value === "custom" || value === "export";
}

function fullGeography(value: string) {
  return value === "新北市" || value.startsWith("新北市") ? value : `新北市${value}`;
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function formatPct(value?: number | null) {
  return value == null ? "—" : `${formatNumber(value, 2)}%`;
}

function formatGeneratedAt(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function changePhrase(value: number | null, subject = "數值") {
  if (value == null) return `${subject}尚無前一年可比值`;
  if (Math.abs(value) < 0.005) return `${subject}與前一年持平`;
  return `${subject}較前一年${value > 0 ? "增加" : "減少"}${formatNumber(Math.abs(value), 2)}%`;
}

function pointChangePhrase(value: number | null, subject: string) {
  if (value == null) return `${subject}尚無前一年可比值`;
  if (Math.abs(value) < 0.005) return `${subject}與前一年持平`;
  return `${subject}較前一年${value > 0 ? "增加" : "減少"}${formatNumber(Math.abs(value), 2)}個百分點`;
}

function HelpTip({ label, children, align = "start" }: { label: string; children: ReactNode; align?: "start" | "end" }) {
  return (
    <div className={`help-tip${align === "end" ? " align-end" : ""}`}>
      <details><summary className="help-tip-trigger" aria-label={`查看「${label}」說明`} title="查看說明"><span aria-hidden="true">?</span></summary></details>
      <div className="help-tip-panel" role="note">
        <div className="help-tip-panel-heading"><strong>{label}</strong><button type="button" onClick={(event) => { event.currentTarget.closest(".help-tip")?.querySelector("details")?.removeAttribute("open"); event.currentTarget.blur(); }}>關閉</button></div>
        <div>{children}</div>
      </div>
    </div>
  );
}

function EvidenceDetails({ evidence }: { evidence: ChartEvidence }) {
  const rows = [
    ["母體定義", evidence.universe],
    ["資料年度", evidence.period],
    ["數值身分", evidence.identity],
    ["計算方法", evidence.method],
    ["更新日期", formatGeneratedAt(evidence.updatedAt ?? dashboardData.meta.generatedAt)],
    ["資料來源", evidence.source],
    ["可用性狀態", evidence.availability ?? "可發布"],
  ] as const;
  return (
    <details className="evidence-details">
      <summary><span>資料來源與計算方式</span><small>母體・年度・方法</small></summary>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{label === "資料來源" && evidence.sourceUrl
              ? <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">{value}</a>
              : value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function DecisionStory({ story }: { story: PageStory }) {
  return (
    <section className="decision-story" aria-labelledby="decision-story-title">
      <header>
        <div><p className="kicker">本頁決策主線</p><h2 id="decision-story-title">{story.title}</h2></div>
        <HelpTip label="這條閱讀主線怎麼產生">
          <p>{story.evidenceNote}</p>
          <p><strong>使用原則：</strong>先確認母體與年份，再比較趨勢，最後才提出可供討論的政策選項。</p>
        </HelpTip>
      </header>
      <p className="decision-story-lead">{story.lead}</p>
      <ol>
        {story.steps.map((step, index) => <li key={step.label}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <div><small>{step.label}</small><strong>{step.title}</strong><p>{step.detail}</p></div>
        </li>)}
      </ol>
    </section>
  );
}

function StoryBridge({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <div className="story-bridge" role="note" aria-label={`閱讀步驟${index}：${title}`}>
      <span aria-hidden="true">{String(index).padStart(2, "0")}</span>
      <div><h2><small>第{["", "一", "二", "三", "四"][index] ?? index}部分</small>{title}</h2><p>{children}</p></div>
    </div>
  );
}

function entries(values: Record<string, CategoryMetric>, preferredOrder: string[]) {
  return preferredOrder.filter((name) => values[name]).map((name) => [name, values[name]] as const);
}

function StackedDistribution({
  title,
  values,
  colors,
  order,
  year,
  source,
  sourceUrl,
}: {
  title: string;
  values: Record<string, CategoryMetric>;
  colors: Record<string, string>;
  order: string[];
  year: number;
  source: string;
  sourceUrl: string;
}) {
  const items = entries(values, order);
  const estimated = items.some(([, item]) => item.origin.includes("估計"));
  return (
    <section className="distribution" aria-labelledby={`${title}-title`}>
      <div className="section-heading compact-heading">
        <div>
          <p className="kicker">戶籍人口母體</p>
          <h3 id={`${title}-title`}>{title}</h3>
        </div>
        {estimated && <span className="estimate-badge">含模型估計</span>}
      </div>
      <div className="stacked-bar" aria-hidden="true">
        {items.map(([name, item]) => (
          <span key={name} style={{ width: `${Math.max(item.value, 0)}%`, background: colors[name] }} />
        ))}
      </div>
      <ul className="legend-list" aria-label={`${title}圖例與數值`}>
        {items.map(([name, item]) => (
          <li key={name}>
            <i style={{ background: colors[name] }} aria-hidden="true" />
            <span>{name}</span>
            <strong>{formatPct(item.value)}</strong>
          </li>
        ))}
      </ul>
      <details className="data-table-details">
        <summary>查看數值、方法與敏感度</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th>類別</th><th>占比</th><th>數值身分</th><th>方法</th><th>方法敏感度</th></tr></thead>
            <tbody>
              {items.map(([name, item]) => (
                <tr key={name}>
                  <td>{name}</td><td>{formatPct(item.value)}</td><td>{item.origin}</td><td>{item.method}</td>
                  <td>{item.low == null || item.high == null ? "—" : `${formatPct(item.low)}～${formatPct(item.high)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <EvidenceDetails evidence={{
        universe: "戶籍登記現住人口",
        period: `${year}年12月31日`,
        identity: estimated ? "官方行政邊際資料再模型估計" : items[0]?.[1].origin ?? "尚無資料",
        method: estimated ? "PCLM年齡拆分＋IPF行政區邊際校準" : items[0]?.[1].method ?? "尚無資料",
        source,
        sourceUrl,
      }} />
    </section>
  );
}

function TrendChart({
  title,
  points,
  unit,
  colors,
  yMin,
  yMax,
  evidence,
  question,
  trendNotes,
  actionNotes,
  caveat,
  dashedSeries = [],
}: {
  title: string;
  points: Array<{ year: number; values: Record<string, number | null> }>;
  unit: string;
  colors: Record<string, string>;
  yMin?: number;
  yMax?: number;
  evidence: ChartEvidence;
  question?: string;
  trendNotes?: string[];
  actionNotes?: string[];
  caveat?: string;
  dashedSeries?: string[];
}) {
  const [activePoint, setActivePoint] = useState<{ name: string; year: number; value: number; x: number; y: number } | null>(null);
  const series = Object.keys(colors);
  const allValues = points.flatMap((point) => series.map((name) => point.values[name])).filter((value): value is number => value != null);
  const observedMinimum = allValues.length ? Math.min(...allValues) : 0;
  const observedMaximum = allValues.length ? Math.max(...allValues) : 1;
  const minimum = yMin ?? Math.min(0, observedMinimum);
  const maximum = yMax ?? roundedCountCeiling(observedMaximum);
  const { width, height, left, right, top, bottom } = quadrantPlot;
  const x = (index: number) => left + (index / Math.max(points.length - 1, 1)) * (width - left - right);
  const y = (value: number) => top + ((maximum - value) / Math.max(maximum - minimum, 1e-9)) * (height - top - bottom);
  const ticks = Array.from({ length: 5 }, (_, index) => maximum - ((maximum - minimum) * index / 4));
  const pathFor = (name: string) => points
    .map((point, index) => point.values[name] == null ? null : `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.values[name] as number).toFixed(1)}`)
    .filter(Boolean)
    .join(" ");
  const chartTransition = useChartTransition(chartMotionKey(points, title, unit, colors, yMin, yMax));
  return (
    <section className="trend-chart" aria-labelledby={`${title}-chart-title`}>
      <div className="chart-title-row">
        <div><p className="chart-overline">五年趨勢</p><div className="title-help-row"><h3 id={`${title}-chart-title`}>{title}</h3><HelpTip label={`${title}閱讀說明`}>
          {question && <p><strong>這張圖要回答：</strong>{question}</p>}
          {trendNotes?.length ? <><h4>數據呈現的趨勢</h4><ul>{trendNotes.map((item) => <li key={item}>{item}</li>)}</ul></> : null}
          {actionNotes?.length ? <><h4>可以進行的措施</h4><ul>{actionNotes.map((item) => <li key={item}>{item}</li>)}</ul></> : null}
          {caveat && <p><strong>不能直接判讀：</strong>{caveat}</p>}
        </HelpTip></div></div>
        <span>單位：{unit}</span>
      </div>
      <DataReadingSummary facts={seriesFacts(points, series, unit, unit === "人" ? 0 : 2)} identity={evidence.identity} />
      <ChartCanvas ref={chartTransition} className="chart-canvas" onMouseLeave={() => setActivePoint(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}，年度${points.map((point) => point.year).join("、")}，Y軸${formatNumber(minimum)}至${formatNumber(maximum)}${unit}`}>
          <line x1={left} x2={left} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="axis-line" />
          <text className="axis-title" transform={`translate(18 ${top + (height - top - bottom) / 2}) rotate(-90)`} textAnchor="middle">{unit}</text>
          {ticks.map((value, index) => {
            const gy = top + (height - top - bottom) * index / 4;
            return <g key={index}><line x1={left} x2={width - right} y1={gy} y2={gy} className="grid-line" /><text x={left - 10} y={gy + 4} textAnchor="end">{formatNumber(value, unit === "%" || unit === "萬元" ? 1 : 0)}</text></g>;
          })}
          {points.map((point, index) => <g key={point.year}><line x1={x(index)} x2={x(index)} y1={height - bottom} y2={height - bottom + 5} className="axis-tick" /><text x={x(index)} y={height - 20} textAnchor="middle">{point.year}年</text></g>)}
          {series.map((name) => <path key={name} d={pathFor(name)} fill="none" stroke={colors[name]} strokeWidth="4" strokeDasharray={dashedSeries.includes(name) ? "10 8" : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
          {series.flatMap((name) => points.map((point, index) => {
            const value = point.values[name];
            if (value == null) return null;
            const px = x(index);
            const py = y(value);
            return <circle
              key={`${name}-${point.year}`}
              cx={px}
              cy={py}
              r="7"
              fill="white"
              stroke={colors[name]}
              strokeWidth="3"
              tabIndex={0}
              role="button"
              aria-label={`${point.year}年，${name}，${formatNumber(value, unit === "%" || unit === "萬元" ? 2 : 0)}${unit}`}
              onMouseEnter={() => setActivePoint({ name, year: point.year, value, x: px, y: py })}
              onFocus={() => setActivePoint({ name, year: point.year, value, x: px, y: py })}
              onBlur={() => setActivePoint(null)}
            ><title>{`${point.year}年 ${name} ${formatNumber(value, unit === "%" || unit === "萬元" ? 2 : 0)}${unit}`}</title></circle>;
          }))}
        </svg>
        {activePoint && <QuadrantPointTooltip x={activePoint.x} y={activePoint.y} width={width} height={height} title={`${activePoint.year}年・${activePoint.name}`} identity={evidence.identity}>{formatNumber(activePoint.value, unit === "%" || unit === "萬元" ? 2 : 0)}{unit}</QuadrantPointTooltip>}
      </ChartCanvas>
      <ul className="chart-legend">{series.map((name) => <li key={name}><i className={dashedSeries.includes(name) ? "legend-dashed" : ""} style={{ background: colors[name] }} />{name}</li>)}</ul>
      <details className="data-table-details">
        <summary>查看圖表資料表</summary>
        <div className="table-scroll"><table><thead><tr><th>年度</th>{series.map((name) => <th key={name}>{name}</th>)}</tr></thead><tbody>{points.map((point) => <tr key={point.year}><td>{point.year}年</td>{series.map((name) => <td key={name}>{point.values[name] == null ? "尚無資料" : `${formatNumber(point.values[name] as number, unit === "%" ? 2 : 1)}${unit}`}</td>)}</tr>)}</tbody></table></div>
      </details>
      <EvidenceDetails evidence={evidence} />
    </section>
  );
}

function ChartFilters({
  idPrefix,
  ageBand,
  sex,
  onAgeBandChange,
  onSexChange,
  marriage,
  onMarriageChange,
}: {
  idPrefix: string;
  ageBand: AgeBand;
  sex: Sex;
  onAgeBandChange: (value: AgeBand) => void;
  onSexChange: (value: Sex) => void;
  marriage?: string;
  onMarriageChange?: (value: string) => void;
}) {
  return (
    <div className="chart-filter-row" aria-label="本圖篩選條件">
      <span className="filter-scope-note">只影響本圖</span>
      <label htmlFor={`${idPrefix}-age`}>年齡
        <select id={`${idPrefix}-age`} value={ageBand} onChange={(event) => onAgeBandChange(event.target.value as AgeBand)}>
          {ageOrder.map((item) => <option key={item} value={item}>{ageBandLabel(item)}</option>)}
        </select>
      </label>
      <label htmlFor={`${idPrefix}-sex`}>性別
        <select id={`${idPrefix}-sex`} value={sex} onChange={(event) => onSexChange(event.target.value as Sex)}>
          {dashboardData.meta.sexes.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      {marriage != null && onMarriageChange && <label htmlFor={`${idPrefix}-marriage`}>婚姻狀態
        <select id={`${idPrefix}-marriage`} value={marriage} onChange={(event) => onMarriageChange(event.target.value)}>
          {JOINT_MARRIAGE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>}
    </div>
  );
}

type DualAxisPoint = { year: number; barValue: number | null; lineValue: number | null };

function DualAxisPopulationChart({
  chartId,
  title,
  question,
  barLabel,
  lineLabel,
  lineUnit,
  points,
  filters,
  evidence,
  caveat,
}: {
  chartId: string;
  title: string;
  question: string;
  barLabel: string;
  lineLabel: string;
  lineUnit: "%" | "人／平方公里";
  points: DualAxisPoint[];
  filters: ReactNode;
  evidence: ChartEvidence;
  caveat: string;
}) {
  const [activePoint, setActivePoint] = useState<{ year: number; label: string; value: number; unit: string; x: number; y: number } | null>(null);
  const width = 720;
  const height = 350;
  const left = 88;
  const right = 96;
  const top = 42;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const slot = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.min(58, slot * 0.5);
  const leftObserved = Math.max(1, ...points.map((point) => point.barValue ?? 0));
  const rightObserved = Math.max(1, ...points.map((point) => point.lineValue ?? 0));
  const leftMaximum = roundedCountCeiling(leftObserved);
  const rightMaximum = lineUnit === "%" ? Math.max(10, roundUpToTen(rightObserved)) : roundedCountCeiling(rightObserved);
  const yLeft = (value: number) => top + (1 - value / leftMaximum) * plotHeight;
  const yRight = (value: number) => top + (1 - value / rightMaximum) * plotHeight;
  const xCenter = (index: number) => left + slot * index + slot / 2;
  const rightTicks = Array.from({ length: 5 }, (_, index) => rightMaximum - rightMaximum * index / 4);
  const leftTicks = Array.from({ length: 5 }, (_, index) => leftMaximum - leftMaximum * index / 4);
  const linePath = points.map((point, index) => point.lineValue == null ? null : `${index === 0 ? "M" : "L"}${xCenter(index)},${yRight(point.lineValue)}`).filter(Boolean).join(" ");
  const changes = points.map((point, index) => ({
    year: point.year,
    value: point.barValue,
    delta: index === 0 || point.barValue == null || points[index - 1].barValue == null
      ? null
      : point.barValue - (points[index - 1].barValue as number),
  }));
  const chartTransition = useChartTransition(chartMotionKey(points, title, barLabel, lineLabel));
  return (
    <section className="dual-axis-chart" aria-labelledby={`${chartId}-title`}>
      <div className="chart-title-row">
        <div><p className="chart-overline">年度雙軸比較</p><div className="title-help-row"><h3 id={`${chartId}-title`}>{title}</h3><HelpTip label={`${title}閱讀說明`}>
          <p><strong>這張圖要回答：</strong>{question}</p>
          <p><strong>長條：</strong>{barLabel}，左軸從0開始。</p>
          <p><strong>折線：</strong>{lineLabel}，右軸從0開始。</p>
          <p><strong>年度卡片：</strong>僅列{barLabel}與前一年度相比的增減；第一個年度因沒有前期資料，標示為「無前期資料」。</p>
          <p><strong>不能直接判讀：</strong>{caveat}</p>
        </HelpTip></div></div>
        <span className="five-point-note">5個年末觀測點</span>
      </div>
      {filters}
      <DataReadingSummary facts={[trendFact(points.map((point) => ({ year: point.year, value: point.barValue })), barLabel, "人", 0), trendFact(points.map((point) => ({ year: point.year, value: point.lineValue })), lineLabel, lineUnit)]} identity={evidence.identity} />
      <div className="annual-change-strip" aria-label={`${barLabel}與前一年度相比`}>
        {changes.map((item) => <div key={item.year}><span>{item.year}年</span><strong>{item.value == null ? "—" : formatNumber(item.value)}</strong><small className={item.delta == null ? "change-base" : item.delta > 0 ? "change-up" : item.delta < 0 ? "change-down" : "change-base"}>{item.delta == null ? "與前一年度相比：無前期資料" : item.delta > 0 ? `與前一年度相比：↑ +${formatNumber(item.delta)}人` : item.delta < 0 ? `與前一年度相比：↓ ${formatNumber(item.delta)}人` : "與前一年度相比：→ 0人"}</small></div>)}
      </div>
      <ChartCanvas ref={chartTransition} className="chart-canvas" onMouseLeave={() => setActivePoint(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}。長條使用左軸人數，折線使用右軸${lineUnit}`}>
          {leftTicks.map((value, index) => {
            const gy = top + plotHeight * index / 4;
            return <g key={`grid-${index}`}><line x1={left} x2={width - right} y1={gy} y2={gy} className="grid-line" /><text x={left - 10} y={gy + 4} textAnchor="end">{formatNumber(value)}</text><text x={width - right + 10} y={gy + 4} textAnchor="start">{formatNumber(rightTicks[index], lineUnit === "%" ? 1 : 0)}</text></g>;
          })}
          <line x1={left} x2={left} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={width - right} x2={width - right} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="axis-line" />
          <text className="axis-title axis-title-left" transform={`translate(18 ${top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">{barLabel}（人）</text>
          <text className="axis-title axis-title-right" transform={`translate(${width - 18} ${top + plotHeight / 2}) rotate(90)`} textAnchor="middle">{lineLabel}（{lineUnit}）</text>
          {points.map((point, index) => {
            const center = xCenter(index);
            const barTop = point.barValue == null ? height - bottom : yLeft(point.barValue);
            return <g key={point.year}>
              {point.barValue != null && <rect x={center - barWidth / 2} y={barTop} width={barWidth} height={height - bottom - barTop} rx="7" className="dual-bar" tabIndex={0} role="button" aria-label={`${point.year}年${barLabel}${formatNumber(point.barValue)}人`} onMouseEnter={() => setActivePoint({ year: point.year, label: barLabel, value: point.barValue as number, unit: "人", x: center, y: barTop })} onFocus={() => setActivePoint({ year: point.year, label: barLabel, value: point.barValue as number, unit: "人", x: center, y: barTop })} onBlur={() => setActivePoint(null)}><title>{point.year}年 {barLabel} {formatNumber(point.barValue)}人</title></rect>}
              <text x={center} y={height - 24} textAnchor="middle">{point.year}年</text>
            </g>;
          })}
          <path d={linePath} fill="none" className="dual-line" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => point.lineValue == null ? null : <circle key={`line-${point.year}`} cx={xCenter(index)} cy={yRight(point.lineValue)} r="7" className="dual-line-point" tabIndex={0} role="button" aria-label={`${point.year}年${lineLabel}${formatNumber(point.lineValue, 2)}${lineUnit}`} onMouseEnter={() => setActivePoint({ year: point.year, label: lineLabel, value: point.lineValue as number, unit: lineUnit, x: xCenter(index), y: yRight(point.lineValue as number) })} onFocus={() => setActivePoint({ year: point.year, label: lineLabel, value: point.lineValue as number, unit: lineUnit, x: xCenter(index), y: yRight(point.lineValue as number) })} onBlur={() => setActivePoint(null)}><title>{point.year}年 {lineLabel} {formatNumber(point.lineValue, 2)}{lineUnit}</title></circle>)}
        </svg>
        {activePoint && <QuadrantPointTooltip x={activePoint.x} y={activePoint.y} width={width} height={height} title={<>{activePoint.year}年・{activePoint.label}</>} identity="">{formatNumber(activePoint.value, activePoint.unit === "人" ? 0 : 2)}{activePoint.unit}<small>{evidence.identity}</small></QuadrantPointTooltip>}
      </ChartCanvas>
      <ul className="chart-legend"><li><i className="legend-bar" />{barLabel}（左軸）</li><li><i className="legend-line" />{lineLabel}（右軸）</li></ul>
      <details className="data-table-details"><summary>查看圖表資料表</summary><div className="table-scroll"><table><thead><tr><th>年度</th><th>{barLabel}（人）</th><th>與前一年度相比（人）</th><th>{lineLabel}（{lineUnit}）</th></tr></thead><tbody>{changes.map((item, index) => <tr key={item.year}><td>{item.year}年</td><td>{item.value == null ? "尚無資料" : formatNumber(item.value)}</td><td>{item.delta == null ? "無前期資料" : formatNumber(item.delta)}</td><td>{points[index].lineValue == null ? "尚無資料" : formatNumber(points[index].lineValue as number, 2)}</td></tr>)}</tbody></table></div></details>
      <EvidenceDetails evidence={evidence} />
    </section>
  );
}

function JointEducationMarriageChart({ geography = "新北市" }: { geography?: string }) {
  const [ageBand, setAgeBand] = useState<AgeBand>("18-35");
  const [sex, setSex] = useState<Sex>("合計");
  const [marriage, setMarriage] = useState("未婚");
  const [payloadState, setPayloadState] = useState<{ dataUrl: string; payload: JointEducationMarriagePayload } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [activePoint, setActivePoint] = useState<{ year: number; education: string; value: number; x: number; y: number } | null>(null);
  const geographyEntry = dashboardData.geographies.find((item) => geographyLabel(item.name) === geography);
  const dataUrl = geography === "新北市" ? JOINT_DATA_URL : `/data/joint-education-marriage-districts/${geographyEntry?.code}.json`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(dataUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json() as JointEducationMarriagePayload;
      })
      .then((payload) => { setLoadError(""); setPayloadState({ dataUrl, payload }); })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError("交叉資料暫時無法載入，請重新嘗試。");
      });
    return () => controller.abort();
  }, [dataUrl, reloadKey]);
  const payload = payloadState?.dataUrl === dataUrl ? payloadState.payload : null;
  const chartTransition = useChartTransition(chartMotionKey(geography, ageBand, sex, marriage, payload?.records.filter((row) => row.ageBand === ageBand && row.sex === sex && row.marriage === marriage).map((row) => [row.year, row.education, row.marriageSharePct])));
  if (!payload) return <section className="joint-analysis section-shell joint-loading" aria-labelledby="joint-analysis-loading-title"><div><p className="kicker">交叉分析｜教育 × 婚姻 × 年齡 × 性別</p><h2 id="joint-analysis-loading-title">{loadError || "正在載入交叉資料"}</h2><p>{loadError ? "其他圖表仍可正常使用。重新載入只會讀取已發布的交叉資料檔。" : "保留固定高度，完成後顯示110至114年群組長條圖。"}</p>{loadError && <button type="button" className="secondary-button" onClick={() => { setLoadError(""); setReloadKey((value) => value + 1); }}>重新載入</button>}</div></section>;
  const education = [...JOINT_EDUCATION_CATEGORIES];
  const years = payload.meta.years;
  const values = education.flatMap((educationName) => years.map((year) => findJointEducationMarriage(payload, year, ageBand, sex, educationName, marriage)));
  const maximum = Math.max(10, roundUpToTen(Math.max(1, ...values.map((row) => row?.marriageSharePct ?? 0))));
  const width = 1120;
  const height = 430;
  const left = 72;
  const right = 24;
  const top = 52;
  const bottom = 86;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const groupWidth = plotWidth / education.length;
  const barGap = 4;
  const barWidth = Math.min(30, (groupWidth - 30) / years.length - barGap);
  const yearColors = ["#0B2F47", "#0F766E", "#2563EB", "#D97706", "#9333EA"];
  const y = (value: number) => top + (1 - value / maximum) * plotHeight;
  const identity = ageBand === "25-29" ? "官方行政精確值" : "官方聯合表邊際校準之模型估計值";
  return (
    <section className="joint-analysis section-shell" aria-labelledby="joint-analysis-title">
      <div className="section-heading">
        <div><p className="kicker">{geography}｜教育 × 婚姻 × 年齡 × 性別</p><div className="title-help-row"><h2 id="joint-analysis-title">不同教育程度的婚姻狀態占比</h2><HelpTip label="教育與婚姻交叉分析說明">
          <p><strong>分母：</strong>同年度、同年齡、同性別、同一教育程度的四種婚姻狀態人口合計。</p>
          <p><strong>分子：</strong>上述群組中，所選婚姻狀態的人口。</p>
          <p><strong>年齡換算：</strong>25–29歲直接採官方五歲組；其餘年齡帶以PCLM建立單一年齡種子，再用IPF同時校準官方單一年齡人口及官方教育×婚姻聯合格數。</p>
          <p><strong>不能直接判讀：</strong>未婚占比較高不等於婚姻狀況不理想，也不能直接證明聯誼活動需求；仍須人口婚育意願或服務需求調查。</p>
        </HelpTip></div></div>
        <span className={ageBand === "25-29" ? "official-badge" : "estimate-badge"}>{identity}</span>
      </div>
      <p className="joint-lead">每種教育程度中，{marriage}人口占多少？下圖比較五年間的變化。</p>
      <ChartFilters idPrefix="joint" ageBand={ageBand} sex={sex} onAgeBandChange={setAgeBand} onSexChange={setSex} marriage={marriage} onMarriageChange={setMarriage} />
      <DataReadingSummary facts={seriesFacts(years.map((year) => ({ year, values: Object.fromEntries(education.map((name) => [name, findJointEducationMarriage(payload, year, ageBand, sex, name, marriage)?.marriageSharePct ?? null])) })), education).map((fact) => `${marriage}占比：${fact}`)} identity={identity} />
      <ChartCanvas ref={chartTransition} className="chart-canvas joint-chart-canvas" onMouseLeave={() => setActivePoint(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${ageBandLabel(ageBand)}${sex}${marriage}占各教育程度人口比例，110至114年群組長條圖`}>
          {Array.from({ length: 6 }, (_, index) => maximum - maximum * index / 5).map((tick, index) => {
            const gy = top + plotHeight * index / 5;
            return <g key={tick}><line x1={left} x2={width - right} y1={gy} y2={gy} className="grid-line" /><text x={left - 10} y={gy + 4} textAnchor="end">{formatNumber(tick, 0)}%</text></g>;
          })}
          <line x1={left} x2={left} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="axis-line" />
          <text className="axis-title" transform={`translate(18 ${top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">婚姻狀態占比（%）</text>
          {education.flatMap((educationName, educationIndex) => years.map((year, yearIndex) => {
            const row = findJointEducationMarriage(payload, year, ageBand, sex, educationName, marriage);
            const value = row?.marriageSharePct ?? 0;
            const groupStart = left + educationIndex * groupWidth;
            const totalBarWidth = years.length * barWidth + (years.length - 1) * barGap;
            const x = groupStart + (groupWidth - totalBarWidth) / 2 + yearIndex * (barWidth + barGap);
            const topY = y(value);
            const center = x + barWidth / 2;
            return <g key={`${educationName}-${year}`}>
              <rect data-motion-key={`${educationName}-${year}`} data-motion-target={JSON.stringify({ x, y: topY, width: barWidth, height: height - bottom - topY })} x={x} y={topY} width={barWidth} height={height - bottom - topY} rx="4" fill={yearColors[yearIndex]} tabIndex={0} role="button" aria-label={`${educationName}，${year}年，${marriage}${formatPct(value)}`} onMouseEnter={() => setActivePoint({ year, education: educationName, value, x: center, y: topY })} onFocus={() => setActivePoint({ year, education: educationName, value, x: center, y: topY })} onBlur={() => setActivePoint(null)}><title>{educationName} {year}年 {marriage} {formatPct(value)}</title></rect>
              <text data-motion-label="true" x={center} y={Math.max(topY - 7, 18)} textAnchor="middle" className="joint-bar-value">{formatNumber(value, 1)}</text>
            </g>;
          }))}
          {education.map((educationName, educationIndex) => <text key={educationName} x={left + educationIndex * groupWidth + groupWidth / 2} y={height - 42} textAnchor="middle" className="joint-education-label">{educationName}</text>)}
        </svg>
        {activePoint && <QuadrantPointTooltip x={activePoint.x} y={activePoint.y} width={width} height={height} title={<>{activePoint.education}・{activePoint.year}年</>} identity="">{marriage} {formatPct(activePoint.value)}<small>{identity}</small></QuadrantPointTooltip>}
      </ChartCanvas>
      <ul className="chart-legend joint-year-legend">{years.map((year, index) => <li key={year}><i style={{ background: yearColors[index] }} />{year}年</li>)}</ul>
      <details className="data-table-details"><summary>查看完整交叉占比與人口數</summary><div className="table-scroll"><table><thead><tr><th>教育程度</th>{years.map((year) => <th key={year}>{year}年</th>)}</tr></thead><tbody>{education.map((educationName) => <tr key={educationName}><td>{educationName}</td>{years.map((year) => { const row = findJointEducationMarriage(payload, year, ageBand, sex, educationName, marriage); return <td key={year}>{row ? <>{formatPct(row.marriageSharePct)}<small className="cell-subvalue">{formatNumber(row.population)}人</small></> : "尚無資料"}</td>; })}</tr>)}</tbody></table></div></details>
      <EvidenceDetails evidence={{ universe: payload.meta.universe, period: `${years.at(0)}–${years.at(-1)}年12月31日`, identity, method: payload.meta.method, source: payload.meta.sourceName, sourceUrl: payload.meta.sourceUrl, availability: `${geography}110–114年可發布；非25–29歲為模型估計` }} />
    </section>
  );
}

function AllYearRegisteredDashboard({
  registeredSource,
  educationSource,
  marriageSource,
  geography = "新北市",
}: {
  registeredSource: { name: string; url: string };
  educationSource: { name: string; url: string };
  marriageSource: { name: string; url: string };
  geography?: string;
}) {
  const [populationAge, setPopulationAge] = useState<AgeBand>("18-35");
  const [populationSex, setPopulationSex] = useState<Sex>("合計");
  const [shareAge, setShareAge] = useState<AgeBand>("18-35");
  const [shareSex, setShareSex] = useState<Sex>("合計");
  const [marriageAge, setMarriageAge] = useState<AgeBand>("18-35");
  const [marriageSex, setMarriageSex] = useState<Sex>("合計");
  const [educationAge, setEducationAge] = useState<AgeBand>("18-35");
  const [educationSex, setEducationSex] = useState<Sex>("合計");
  const years = dashboardData.meta.years;
  const populationPoints = years.map((year) => { const row = getRegistered(year, geography, populationAge, populationSex); return { year, barValue: row?.population ?? null, lineValue: row?.populationDensityPerKm2 ?? null }; });
  const sharePoints = years.map((year) => { const row = getRegistered(year, geography, shareAge, shareSex); return { year, barValue: getRegisteredTotalPopulation(row), lineValue: row?.populationSharePct ?? null }; });
  const marriagePoints = years.map((year) => ({ year, values: Object.fromEntries(Object.keys(marriageColors).map((name) => [name, getRegistered(year, geography, marriageAge, marriageSex)?.marriage[name]?.value ?? null])) }));
  const educationPoints = years.map((year) => ({ year, values: Object.fromEntries(Object.keys(educationColors).map((name) => [name, getRegistered(year, geography, educationAge, educationSex)?.education[name]?.value ?? null])) }));
  const categoryIdentity = (dimension: "education" | "marriage", selectedAge: AgeBand, selectedSex: Sex) => years.some((year) => Object.values(getRegistered(year, geography, selectedAge, selectedSex)?.[dimension] ?? {}).some((item) => item.origin.includes("估計"))) ? "官方行政邊際資料再模型估計" : "官方行政精確值";
  return (
    <>
      <section className="annual-analysis-intro section-shell" aria-labelledby="annual-analysis-title">
        <div><p className="kicker">{geography}｜全年度比較分析｜110–114年</p><div className="title-help-row"><h2 id="annual-analysis-title">先看人口規模，再讀教育與婚姻結構</h2><HelpTip label="圖表閱讀順序">第一列比較青年占比與人口密度；第二列比較婚姻與教育結構。四張圖各自保留年齡與性別篩選，避免一個條件誤改全部圖表。</HelpTip></div></div>
        <ol><li><span>1</span>確認青年規模與占比</li><li><span>2</span>對照總量與人口密度</li><li><span>3</span>追蹤婚姻狀態變化</li><li><span>4</span>追蹤教育程度變化</li></ol>
      </section>
      <section className="annual-quadrant-grid" aria-label={`${geography}戶籍人口年度比較分析`}>
        <article className="annual-quadrant-card quadrant-one">
          <span className="quadrant-label">先看青年占多少</span>
          <DualAxisPopulationChart chartId="youth-share" title={`${ageBandLabel(shareAge)}人口占戶籍總人口比率`} question={`${geography}同一性別全齡戶籍總人口與選定年齡人口占比，五年間如何變動？`} barLabel={`${geography}${shareSex === "合計" ? "" : shareSex}戶籍總人口`} lineLabel="選定年齡人口占同地區戶籍人口比率" lineUnit="%" points={sharePoints} filters={<ChartFilters idPrefix="share" ageBand={shareAge} sex={shareSex} onAgeBandChange={setShareAge} onSexChange={setShareSex} />} caveat="長條是同地區、同一性別的全年齡戶籍人口；折線才受年齡篩選影響。人口占比變動只描述戶籍結構，不能直接解釋遷徙、婚育、就業或政策效果。" evidence={{ universe: "戶籍登記現住人口", period: `${years.at(0)}–${years.at(-1)}年12月31日`, identity: "官方行政精確值直接計算", method: "長條＝官方占比欄位的分母，即同地區同一性別全年齡戶籍人口；折線＝選定年齡戶籍人口÷同年度同地區同一性別全年齡戶籍人口×100", source: registeredSource.name, sourceUrl: registeredSource.url }} />
        </article>
        <article className="annual-quadrant-card quadrant-two">
          <span className="quadrant-label">再看人口怎麼變</span>
          <DualAxisPopulationChart chartId="population-density" title={`${ageBandLabel(populationAge)}人口與密度變化`} question="選定年齡與性別的戶籍人口總數及每平方公里人口，五年間如何變動？" barLabel={`${ageBandLabel(populationAge)}戶籍人口`} lineLabel="青年戶籍人口密度" lineUnit="人／平方公里" points={populationPoints} filters={<ChartFilters idPrefix="population" ageBand={populationAge} sex={populationSex} onAgeBandChange={setPopulationAge} onSexChange={setPopulationSex} />} caveat={`這裡的總人數是目前篩選群組的總數；人口密度是以${geography}官方土地面積作分母，不是居住擁擠度。`} evidence={{ universe: "戶籍登記現住人口", period: `${years.at(0)}–${years.at(-1)}年12月31日`, identity: "官方行政精確值直接計算", method: `選定年齡戶籍人口直接加總；人口密度＝選定人口÷${geography}官方土地面積`, source: registeredSource.name, sourceUrl: registeredSource.url }} />
        </article>
        <article className="annual-quadrant-card quadrant-three">
          <span className="quadrant-label">了解婚姻分布</span>
          <ChartFilters idPrefix="marriage" ageBand={marriageAge} sex={marriageSex} onAgeBandChange={setMarriageAge} onSexChange={setMarriageSex} />
          <TrendChart title="婚姻狀態占比變化" points={marriagePoints} unit="%" yMin={0} yMax={100} colors={marriageColors} question="四種婚姻狀態在五個年末觀測點如何變動？" trendNotes={["每條線代表一種婚姻狀態；同年度四類合計為100%。", "請用圖上節點或資料表讀取精確值，不把五點折線視為連續預測。"]} actionNotes={["可先辨識變動較大的年齡與性別群組，再查婚育意願、居住與照顧需求。"]} caveat="婚姻狀態是戶籍登記結構，不代表個人幸福、婚育意願或服務需求。" evidence={{ universe: "戶籍登記現住人口", period: `${years.at(0)}–${years.at(-1)}年12月31日`, identity: categoryIdentity("marriage", marriageAge, marriageSex), method: marriageAge === "25-29" ? "官方五歲年齡組直接彙整" : "PCLM單一年齡拆分＋IPF官方邊際校準", source: marriageSource.name, sourceUrl: marriageSource.url }} />
        </article>
        <article className="annual-quadrant-card quadrant-four">
          <span className="quadrant-label">了解教育結構</span>
          <ChartFilters idPrefix="education" ageBand={educationAge} sex={educationSex} onAgeBandChange={setEducationAge} onSexChange={setEducationSex} />
          <TrendChart title="教育程度占比變化" points={educationPoints} unit="%" yMin={0} yMax={100} colors={educationColors} question="五種教育程度在五個年末觀測點如何變動？" trendNotes={["教育分為國中及以下、高中職、專科、大學、研究所五類。", "同年度五類合計為100%；請由節點或資料表讀取精確值。"]} actionNotes={["可先辨識結構變動，再搭配就學、轉銜或職訓需求資料形成政策問題。"]} caveat="教育程度占比變化不能單獨證明教育落差、就業結果或政策成效。" evidence={{ universe: "戶籍登記現住人口", period: `${years.at(0)}–${years.at(-1)}年12月31日`, identity: categoryIdentity("education", educationAge, educationSex), method: educationAge === "25-29" ? "官方五歲年齡組直接彙整" : "PCLM單一年齡拆分＋IPF官方邊際校準", source: educationSource.name, sourceUrl: educationSource.url }} />
        </article>
      </section>
      <StoryBridge index={2} title="教育程度不同，婚姻分布也不同嗎？">看完各自的比例，再比較每種教育程度內的婚姻狀態。</StoryBridge>
      <JointEducationMarriageChart geography={geography} />
    </>
  );
}

function BarTrendChart({
  title,
  points,
  seriesName,
  color,
  evidence,
}: {
  title: string;
  points: Array<{ year: number; value: number | null }>;
  seriesName: string;
  color: string;
  evidence: ChartEvidence;
}) {
  const width = 620;
  const height = 270;
  const left = 54;
  const right = 18;
  const top = 34;
  const bottom = 46;
  const plotHeight = height - top - bottom;
  const slot = (width - left - right) / Math.max(points.length, 1);
  const barWidth = Math.min(58, slot * 0.58);
  const y = (value: number) => top + ((100 - value) / 100) * plotHeight;
  return (
    <section className="bar-trend" aria-labelledby={`${title}-bar-title`}>
      <div className="chart-title-row">
        <div><p className="chart-overline">年度比較</p><h3 id={`${title}-bar-title`}>{title}</h3></div>
        <span>單位：%</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}，${points.map((point) => `${point.year}年${formatPct(point.value)}`).join("，")}`}>
        {[0, 50, 100].map((value) => {
          const gy = y(value);
          return <g key={value}><line x1={left} x2={width - right} y1={gy} y2={gy} className="grid-line" /><text x={left - 8} y={gy + 4} textAnchor="end">{value}</text></g>;
        })}
        {points.map((point, index) => {
          const center = left + slot * index + slot / 2;
          const value = point.value;
          const topY = value == null ? y(0) : y(value);
          return <g key={point.year}>
            <rect x={center - barWidth / 2} y={topY} width={barWidth} height={Math.max(y(0) - topY, 0)} rx="8" fill={color} />
            <text x={center} y={value == null ? topY - 8 : Math.max(topY - 8, 16)} textAnchor="middle" className="bar-value">{value == null ? "—" : formatNumber(value, 2)}</text>
            <text x={center} y={height - 18} textAnchor="middle">{point.year}年</text>
          </g>;
        })}
      </svg>
      <div className="chart-series-label"><i style={{ background: color }} aria-hidden="true" /><span>{seriesName}</span></div>
      <details className="data-table-details">
        <summary>查看圖表資料表</summary>
        <div className="table-scroll"><table><thead><tr><th>年度</th><th>{seriesName}</th></tr></thead><tbody>{points.map((point) => <tr key={point.year}><td>{point.year}年</td><td>{formatPct(point.value)}</td></tr>)}</tbody></table></div>
      </details>
      <EvidenceDetails evidence={evidence} />
    </section>
  );
}

function LaborComplementGrid({
  points,
  evidence,
}: {
  points: Array<{ year: number; employed: number | null; unemployed: number | null }>;
  evidence: ChartEvidence;
}) {
  return (
    <section className="labor-complements" aria-labelledby="labor-complements-title">
      <div className="chart-title-row">
        <div><p className="chart-overline">互補比例</p><h3 id="labor-complements-title">勞動力中就業占比與失業率</h3></div>
        <span>每年合計100%</span>
      </div>
      <div className="donut-grid">
        {points.map((point) => {
          const employed = point.employed ?? 0;
          return (
            <article key={point.year}>
              <div className="donut" style={{ background: `conic-gradient(var(--green) 0 ${employed}%, var(--red) ${employed}% 100%)` }} role="img" aria-label={`${point.year}年，勞動力中就業占比${formatPct(point.employed)}，失業率${formatPct(point.unemployed)}`}>
                <span><strong>{point.year}</strong><small>年</small></span>
              </div>
              <dl><div><dt>就業</dt><dd>{formatPct(point.employed)}</dd></div><div><dt>失業</dt><dd>{formatPct(point.unemployed)}</dd></div></dl>
            </article>
          );
        })}
      </div>
      <div className="chart-series-label complement-legend"><span><i className="employment-dot" aria-hidden="true" />勞動力中就業占比</span><span><i className="unemployment-dot" aria-hidden="true" />失業率</span></div>
      <EvidenceDetails evidence={evidence} />
    </section>
  );
}

function LaborAgeFilter({
  idPrefix,
  ageBand,
  onAgeBandChange,
}: {
  idPrefix: string;
  ageBand: AgeBand;
  onAgeBandChange: (value: AgeBand) => void;
}) {
  return (
    <div className="chart-filter-row labor-chart-filter" aria-label="本圖篩選條件">
      <span className="filter-scope-note">只影響本圖</span>
      <label htmlFor={`${idPrefix}-age`}>年齡
        <select id={`${idPrefix}-age`} value={ageBand} onChange={(event) => onAgeBandChange(event.target.value as AgeBand)}>
          {ageOrder.map((item) => <option key={item} value={item}>{ageBandLabel(item)}</option>)}
        </select>
      </label>
      <span className="fixed-filter-value"><small>性別</small><strong>男女合計</strong><HelpTip label="勞動資料性別限制">目前公開資料不足以形成110–114年完整的青年年齡組×性別×民間人口、勞動力、就業及失業交叉母數，因此性別固定為男女合計。</HelpTip></span>
    </div>
  );
}

type LaborDualAxisPoint = { year: number; count: number | null; rate: number | null };

function LaborDualAxisChart({
  chartId,
  title,
  question,
  countLabel,
  rateLabel,
  points,
  filters,
  evidence,
  caveat,
}: {
  chartId: string;
  title: string;
  question: string;
  countLabel: string;
  rateLabel: string;
  points: LaborDualAxisPoint[];
  filters: ReactNode;
  evidence: ChartEvidence;
  caveat: string;
}) {
  const [activePoint, setActivePoint] = useState<{ year: number; label: string; value: number; unit: string; x: number; y: number } | null>(null);
  const width = 720;
  const height = 350;
  const left = 88;
  const right = 96;
  const top = 42;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const slot = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.min(58, slot * 0.5);
  const countMaximum = roundedCountCeiling(Math.max(1, ...points.map((point) => point.count ?? 0)));
  const rateMaximum = Math.max(10, roundUpToTen(Math.max(1, ...points.map((point) => point.rate ?? 0))));
  const countY = (value: number) => top + (1 - value / countMaximum) * plotHeight;
  const rateY = (value: number) => top + (1 - value / rateMaximum) * plotHeight;
  const xCenter = (index: number) => left + slot * index + slot / 2;
  const countTicks = Array.from({ length: 5 }, (_, index) => countMaximum - countMaximum * index / 4);
  const rateTicks = Array.from({ length: 5 }, (_, index) => rateMaximum - rateMaximum * index / 4);
  const ratePath = points.map((point, index) => point.rate == null ? null : `${index === 0 ? "M" : "L"}${xCenter(index)},${rateY(point.rate)}`).filter(Boolean).join(" ");
  const changes = points.map((point, index) => ({
    ...point,
    countDelta: index === 0 || point.count == null || points[index - 1].count == null ? null : point.count - (points[index - 1].count as number),
    rateDelta: index === 0 || point.rate == null || points[index - 1].rate == null ? null : point.rate - (points[index - 1].rate as number),
  }));
  const chartTransition = useChartTransition(chartMotionKey(points, title, countLabel, rateLabel));
  return (
    <section className="dual-axis-chart labor-dual-axis" aria-labelledby={`${chartId}-title`}>
      <div className="chart-title-row">
        <div><p className="chart-overline">年度雙軸比較</p><div className="title-help-row"><h3 id={`${chartId}-title`}>{title}</h3><HelpTip label={`${title}閱讀說明`}>
          <p><strong>這張圖要回答：</strong>{question}</p>
          <p><strong>長條：</strong>{countLabel}，左軸單位為千人。</p>
          <p><strong>折線：</strong>{rateLabel}，右軸單位為百分比。</p>
          <p><strong>年度卡片：</strong>僅列{countLabel}與前一年度相比的人數增減；{rateLabel}的年度差異保留於下方可展開資料表。</p>
          <p><strong>不能直接判讀：</strong>{caveat}</p>
        </HelpTip></div></div>
        <span className="five-point-note">5個全年平均值</span>
      </div>
      {filters}
      <DataReadingSummary facts={[trendFact(points.map((point) => ({ year: point.year, value: point.count })), countLabel, "千人"), trendFact(points.map((point) => ({ year: point.year, value: point.rate })), rateLabel, "%")]} identity={evidence.identity} />
      <div className="annual-change-strip labor-change-strip" aria-label={`${countLabel}與前一年度相比`}>
        {changes.map((item) => <div key={item.year}>
          <span>{item.year}年</span>
          <strong>{item.count == null ? "—" : `${formatNumber(item.count, 2)}千人`}</strong>
          <small className={item.countDelta == null ? "change-base" : item.countDelta > 0 ? "change-up" : item.countDelta < 0 ? "change-down" : "change-base"}>{item.countDelta == null ? "與前一年度相比：無前期資料" : `與前一年度相比：${item.countDelta > 0 ? "↑ +" : item.countDelta < 0 ? "↓ " : "→ "}${formatNumber(item.countDelta, 2)}千人`}</small>
        </div>)}
      </div>
      <ChartCanvas ref={chartTransition} className="chart-canvas" onMouseLeave={() => setActivePoint(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}。長條使用左軸千人，折線使用右軸百分比`}>
          {countTicks.map((value, index) => {
            const gy = top + plotHeight * index / 4;
            return <g key={`grid-${index}`}><line x1={left} x2={width - right} y1={gy} y2={gy} className="grid-line" /><text x={left - 10} y={gy + 4} textAnchor="end">{formatNumber(value, 1)}</text><text x={width - right + 10} y={gy + 4} textAnchor="start">{formatNumber(rateTicks[index], 1)}</text></g>;
          })}
          <line x1={left} x2={left} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={width - right} x2={width - right} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="axis-line" />
          <text className="axis-title axis-title-left" transform={`translate(18 ${top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">{countLabel}（千人）</text>
          <text className="axis-title axis-title-right" transform={`translate(${width - 18} ${top + plotHeight / 2}) rotate(90)`} textAnchor="middle">{rateLabel}（%）</text>
          {points.map((point, index) => {
            const center = xCenter(index);
            const barTop = point.count == null ? height - bottom : countY(point.count);
            return <g key={point.year}>
              {point.count != null && <rect x={center - barWidth / 2} y={barTop} width={barWidth} height={height - bottom - barTop} rx="7" className="dual-bar" tabIndex={0} role="button" aria-label={`${point.year}年${countLabel}${formatNumber(point.count, 2)}千人`} onMouseEnter={() => setActivePoint({ year: point.year, label: countLabel, value: point.count as number, unit: "千人", x: center, y: barTop })} onFocus={() => setActivePoint({ year: point.year, label: countLabel, value: point.count as number, unit: "千人", x: center, y: barTop })} onBlur={() => setActivePoint(null)}><title>{point.year}年 {countLabel} {formatNumber(point.count, 2)}千人</title></rect>}
              <text x={center} y={height - 24} textAnchor="middle">{point.year}年</text>
            </g>;
          })}
          <path d={ratePath} fill="none" className="dual-line" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => point.rate == null ? null : <circle key={`rate-${point.year}`} cx={xCenter(index)} cy={rateY(point.rate)} r="7" className="dual-line-point" tabIndex={0} role="button" aria-label={`${point.year}年${rateLabel}${formatNumber(point.rate, 2)}%`} onMouseEnter={() => setActivePoint({ year: point.year, label: rateLabel, value: point.rate as number, unit: "%", x: xCenter(index), y: rateY(point.rate as number) })} onFocus={() => setActivePoint({ year: point.year, label: rateLabel, value: point.rate as number, unit: "%", x: xCenter(index), y: rateY(point.rate as number) })} onBlur={() => setActivePoint(null)}><title>{point.year}年 {rateLabel} {formatNumber(point.rate, 2)}%</title></circle>)}
        </svg>
        {activePoint && <QuadrantPointTooltip x={activePoint.x} y={activePoint.y} width={width} height={height} title={<>{activePoint.year}年・{activePoint.label}</>} identity="">{formatNumber(activePoint.value, 2)}{activePoint.unit}<small>{evidence.identity}</small></QuadrantPointTooltip>}
      </ChartCanvas>
      <ul className="chart-legend"><li><i className="legend-bar" />{countLabel}（左軸）</li><li><i className="legend-line" />{rateLabel}（右軸）</li></ul>
      <details className="data-table-details"><summary>查看圖表資料表</summary><div className="table-scroll"><table><thead><tr><th>年度</th><th>{countLabel}（千人）</th><th>人數與前一年度相比</th><th>{rateLabel}</th><th>比率與前一年度相比</th></tr></thead><tbody>{changes.map((item) => <tr key={item.year}><td>{item.year}年</td><td>{item.count == null ? "尚無資料" : formatNumber(item.count, 2)}</td><td>{item.countDelta == null ? "無前期資料" : `${formatNumber(item.countDelta, 2)}千人`}</td><td>{formatPct(item.rate)}</td><td>{item.rateDelta == null ? "無前期資料" : `${formatNumber(item.rateDelta, 2)}個百分點`}</td></tr>)}</tbody></table></div></details>
      <EvidenceDetails evidence={evidence} />
    </section>
  );
}

function LaborCompositionChart({
  ageBand,
  onAgeBandChange,
  evidence,
}: {
  ageBand: AgeBand;
  onAgeBandChange: (value: AgeBand) => void;
  evidence: ChartEvidence;
}) {
  const [activePoint, setActivePoint] = useState<{ year: number; label: string; value: number; x: number; y: number } | null>(null);
  const points = dashboardData.meta.years.map((year) => {
    const row = getLabor(year, ageBand);
    return { year, employed: row?.metrics["勞動力中就業占比"] ?? null, unemployed: row?.metrics["失業率"] ?? null };
  });
  const width = 720;
  const height = 350;
  const left = 76;
  const right = 24;
  const top = 34;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const slot = plotWidth / points.length;
  const barWidth = Math.min(64, slot * 0.55);
  const y = (value: number) => top + (1 - value / 100) * plotHeight;
  const chartTransition = useChartTransition(chartMotionKey(ageBand, points));
  return (
    <section className="labor-composition-chart" aria-labelledby="labor-composition-title">
      <div className="chart-title-row"><div><p className="chart-overline">100%組成比較</p><div className="title-help-row"><h3 id="labor-composition-title">勞動力中的就業與失業</h3><HelpTip label="就業與失業組成閱讀說明"><p><strong>這張圖要回答：</strong>已進入勞動市場者，就業與失業的組成在五年間如何變化？</p><p><strong>分母：</strong>同年度、同年齡層的勞動力人口。</p><p><strong>不能直接判讀：</strong>失業率變動不能單獨證明職缺不足或政策造成變化。</p></HelpTip></div></div><span className="five-point-note">每年合計100%</span></div>
      <LaborAgeFilter idPrefix="labor-composition" ageBand={ageBand} onAgeBandChange={onAgeBandChange} />
      <DataReadingSummary facts={[trendFact(points.map((point) => ({ year: point.year, value: point.employed })), "勞動力中就業占比", "%"), trendFact(points.map((point) => ({ year: point.year, value: point.unemployed })), "失業率", "%")]} identity={evidence.identity} />
      <div className="annual-change-strip labor-change-strip" aria-label="勞動力中就業占比與前一年度相比">
        {points.map((point) => {
          const previous = points.find(item => item.year === point.year - 1)?.employed;
          const delta = point.employed == null || previous == null ? null : Number((Number(point.employed.toFixed(2)) - Number(previous.toFixed(2))).toFixed(2));
          return <div key={point.year}><span>{point.year}年</span><strong>{formatPct(point.employed)}</strong><small className={delta == null || delta === 0 ? "change-base" : delta > 0 ? "change-up" : "change-down"}>{delta == null ? "與前一年度相比：無前期資料" : `與前一年度相比：${delta > 0 ? "↑ +" : delta < 0 ? "↓ " : "→ "}${formatNumber(delta, 2)}個百分點`}</small></div>;
        })}
      </div>
      <ChartCanvas ref={chartTransition} className="chart-canvas" onMouseLeave={() => setActivePoint(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`110至114年${ageBandLabel(ageBand)}勞動力中就業占比與失業率`}>
          {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="grid-line" /><text x={left - 10} y={y(tick) + 4} textAnchor="end">{tick}%</text></g>)}
          <line x1={left} x2={left} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="axis-line" />
          <text className="axis-title" transform={`translate(18 ${top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">占勞動力人口比率（%）</text>
          {points.map((point, index) => {
            const center = left + slot * index + slot / 2;
            const employed = point.employed ?? 0;
            const unemployed = point.unemployed ?? 0;
            const employedTop = y(employed);
            const unemployedBottom = y(employed);
            const unemployedTop = y(Math.min(employed + unemployed, 100));
            return <g key={point.year}>
              <rect x={center - barWidth / 2} y={employedTop} width={barWidth} height={height - bottom - employedTop} rx="0" className="composition-employed" tabIndex={0} role="button" aria-label={`${point.year}年勞動力中就業占比${formatPct(point.employed)}`} onMouseEnter={() => setActivePoint({ year: point.year, label: "勞動力中就業占比", value: employed, x: center, y: employedTop })} onFocus={() => setActivePoint({ year: point.year, label: "勞動力中就業占比", value: employed, x: center, y: employedTop })} onBlur={() => setActivePoint(null)}><title>{point.year}年 勞動力中就業占比 {formatPct(point.employed)}</title></rect>
              <rect x={center - barWidth / 2} y={unemployedTop} width={barWidth} height={Math.max(unemployedBottom - unemployedTop, 0)} rx="5" className="composition-unemployed" tabIndex={0} role="button" aria-label={`${point.year}年失業率${formatPct(point.unemployed)}`} onMouseEnter={() => setActivePoint({ year: point.year, label: "失業率", value: unemployed, x: center, y: unemployedTop })} onFocus={() => setActivePoint({ year: point.year, label: "失業率", value: unemployed, x: center, y: unemployedTop })} onBlur={() => setActivePoint(null)}><title>{point.year}年 失業率 {formatPct(point.unemployed)}</title></rect>
              <text x={center} y={height - 24} textAnchor="middle">{point.year}年</text>
            </g>;
          })}
        </svg>
        {activePoint && <QuadrantPointTooltip x={activePoint.x} y={activePoint.y} width={width} height={height} title={<>{activePoint.year}年・{activePoint.label}</>} identity="">{formatNumber(activePoint.value, 2)}%<small>{evidence.identity}</small></QuadrantPointTooltip>}
      </ChartCanvas>
      <ul className="chart-legend"><li><i className="employment-dot" />勞動力中就業占比</li><li><i className="unemployment-dot" />失業率</li></ul>
      <details className="data-table-details"><summary>查看圖表資料表</summary><div className="table-scroll"><table><thead><tr><th>年度</th><th>勞動力中就業占比</th><th>失業率</th><th>合計檢查</th></tr></thead><tbody>{points.map((point) => <tr key={point.year}><td>{point.year}年</td><td>{formatPct(point.employed)}</td><td>{formatPct(point.unemployed)}</td><td>{point.employed == null || point.unemployed == null ? "尚無資料" : formatPct(point.employed + point.unemployed)}</td></tr>)}</tbody></table></div></details>
      <EvidenceDetails evidence={evidence} />
    </section>
  );
}

type LaborRateMetric = "勞動力參與率" | "就業人口比率" | "失業率";

function LaborLifeStageChart({ laborSource }: { laborSource: { name: string; url: string } }) {
  const [metric, setMetric] = useState<LaborRateMetric>("失業率");
  const [benchmarkYear, setBenchmarkYear] = useState(dashboardData.meta.years.at(-1) ?? dashboardData.meta.defaultYear);
  const [activePoint, setActivePoint] = useState<{ age: string; year: number; value: number; x: number; y: number } | null>(null);
  const years = dashboardData.meta.years;
  const componentAges: AgeBand[] = ["18-24", "25-29", "30-35"];
  const values = componentAges.flatMap((age) => years.map((year) => getLabor(year, age)?.metrics[metric] ?? null)).filter((value): value is number => value != null);
  const benchmark = getLabor(benchmarkYear, "18-35")?.metrics[metric] ?? null;
  const maximum = Math.max(10, roundUpToTen(Math.max(1, ...values, benchmark ?? 0)));
  const width = 1120;
  const height = 420;
  const left = 76;
  const right = 42;
  const top = 52;
  const bottom = 86;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const groupWidth = plotWidth / componentAges.length;
  const barGap = 7;
  const barWidth = Math.min(40, (groupWidth - 58) / years.length - barGap);
  const yearColors = ["#0B2F47", "#0F766E", "#2563EB", "#D97706", "#7C3AED"];
  const y = (value: number) => top + (1 - value / maximum) * plotHeight;
  const identity = componentAges.some((age) => years.some((year) => getLabor(year, age)?.meta[metric]?.origin.includes("模型"))) ? "官方人力資源調查估計；部分年齡帶為模型換算" : "官方人力資源調查估計";
  const chartTransition = useChartTransition(chartMotionKey(metric, benchmarkYear, values));
  return (
    <section className="labor-life-stage section-shell" aria-labelledby="labor-life-stage-title">
      <div className="section-heading"><div><p className="kicker">生命階段整合比較</p><div className="title-help-row"><h2 id="labor-life-stage-title">三個青年年齡層放在同一尺度上</h2><HelpTip label="生命階段比較閱讀說明"><p><strong>這張圖要回答：</strong>哪個青年生命階段的勞動指標較高，五年間是否呈現持續變化？</p><p>18–35歲是三子群的整體基準，不和子群相加；虛線顯示所選年度的18–35歲值。</p><p><strong>不能直接判讀：</strong>18–24歲非勞動力可能包含就學者；年齡差異也不是政策效果。</p></HelpTip></div></div><span className="universe-badge green">新北市全市・男女合計</span></div>
      <div className="chart-filter-row labor-life-stage-filters" aria-label="生命階段圖篩選條件">
        <label htmlFor="labor-life-metric">指標<select id="labor-life-metric" value={metric} onChange={(event) => setMetric(event.target.value as LaborRateMetric)}><option value="勞動力參與率">勞動力參與率</option><option value="就業人口比率">就業人口比率</option><option value="失業率">失業率</option></select></label>
        <label htmlFor="labor-life-benchmark">整體基準年度<select id="labor-life-benchmark" value={benchmarkYear} onChange={(event) => setBenchmarkYear(Number(event.target.value))}>{years.map((year) => <option key={year} value={year}>{year}年</option>)}</select></label>
        <span className="fixed-filter-value"><small>比較範圍</small><strong>110–114年・男女合計</strong></span>
      </div>
      <DataReadingSummary facts={categoryFacts(componentAges.map((age) => ({ label: ageBandLabel(age), value: getLabor(benchmarkYear, age)?.metrics[metric] })), `${benchmarkYear}年${metric}`)} identity={identity} />
      <ChartCanvas ref={chartTransition} className="joint-chart-canvas chart-canvas" onMouseLeave={() => setActivePoint(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`18至35歲三個年齡層${metric}110至114年比較，Y軸0至${maximum}%`}>
          {Array.from({ length: 5 }, (_, index) => maximum - maximum * index / 4).map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="grid-line" /><text x={left - 10} y={y(tick) + 4} textAnchor="end">{formatNumber(tick, 1)}%</text></g>)}
          <line x1={left} x2={left} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="axis-line" />
          <text className="axis-title" transform={`translate(18 ${top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">{metric}（%）</text>
          {componentAges.flatMap((age, ageIndex) => years.map((year, yearIndex) => {
            const value = getLabor(year, age)?.metrics[metric];
            if (value == null) return null;
            const totalBarWidth = years.length * barWidth + (years.length - 1) * barGap;
            const x = left + ageIndex * groupWidth + (groupWidth - totalBarWidth) / 2 + yearIndex * (barWidth + barGap);
            const barTop = y(value);
            const center = x + barWidth / 2;
            return <rect key={`${age}-${year}`} x={x} y={barTop} width={barWidth} height={height - bottom - barTop} rx="5" fill={yearColors[yearIndex]} tabIndex={0} role="button" aria-label={`${ageBandLabel(age)}，${year}年，${metric}${formatPct(value)}`} onMouseEnter={() => setActivePoint({ age: ageBandLabel(age), year, value, x: center, y: barTop })} onFocus={() => setActivePoint({ age: ageBandLabel(age), year, value, x: center, y: barTop })} onBlur={() => setActivePoint(null)}><title>{ageBandLabel(age)} {year}年 {metric} {formatPct(value)}</title></rect>;
          }))}
          {componentAges.map((age, index) => <text key={age} x={left + index * groupWidth + groupWidth / 2} y={height - 40} textAnchor="middle" className="life-stage-label">{ageBandLabel(age)}</text>)}
          {benchmark != null && <><line x1={left} x2={width - right} y1={y(benchmark)} y2={y(benchmark)} className="labor-benchmark-line" /><text x={width - right - 4} y={Math.max(y(benchmark) - 8, 16)} textAnchor="end" className="labor-benchmark-label">{benchmarkYear}年18–35歲基準 {formatNumber(benchmark, 2)}%</text></>}
        </svg>
        {activePoint && <QuadrantPointTooltip x={activePoint.x} y={activePoint.y} width={width} height={height} title={<>{activePoint.age}・{activePoint.year}年</>} identity="">{metric} {formatPct(activePoint.value)}<small>{getLabor(activePoint.year, activePoint.age.replace("歲", "").replace("–", "-") as AgeBand)?.meta[metric]?.origin ?? identity}</small></QuadrantPointTooltip>}
      </ChartCanvas>
      <ul className="chart-legend joint-year-legend">{years.map((year, index) => <li key={year}><i style={{ background: yearColors[index] }} />{year}年</li>)}<li><i className="benchmark-legend" />18–35歲整體基準</li></ul>
      <details className="data-table-details"><summary>查看各年齡層完整數值</summary><div className="table-scroll"><table><thead><tr><th>年齡層</th>{years.map((year) => <th key={year}>{year}年</th>)}</tr></thead><tbody>{componentAges.map((age) => <tr key={age}><td>{ageBandLabel(age)}</td>{years.map((year) => <td key={year}>{formatPct(getLabor(year, age)?.metrics[metric])}</td>)}</tr>)}<tr><td>18–35歲整體基準</td>{years.map((year) => <td key={year}>{formatPct(getLabor(year, "18-35")?.metrics[metric])}</td>)}</tr></tbody></table></div></details>
      <EvidenceDetails evidence={{ universe: metric === "失業率" ? "新北市勞動力人口" : "新北市民間人口", period: `${years.at(0)}–${years.at(-1)}年全年12個月平均`, identity, method: `${metric}依同年度P、LF、E、U重算；PCLM主模型、Sprague敏感度`, source: laborSource.name, sourceUrl: laborSource.url, availability: "新北市全市、男女合計、四個青年年齡組可發布" }} />
    </section>
  );
}

function AllYearLaborDashboard({ laborSource, showPolicy }: { laborSource: { name: string; url: string }; showPolicy: boolean }) {
  const [employmentAge, setEmploymentAge] = useState<AgeBand>("18-35");
  const [participationAge, setParticipationAge] = useState<AgeBand>("18-35");
  const [compositionAge, setCompositionAge] = useState<AgeBand>("18-35");
  const [nonLaborAge, setNonLaborAge] = useState<AgeBand>("18-35");
  const [policyAge, setPolicyAge] = useState<AgeBand>("18-35");
  const years = dashboardData.meta.years;
  const latestYear = years.at(-1) ?? dashboardData.meta.defaultYear;
  const evidenceFor = (age: AgeBand, countMetric: string, rateMetric: string, universe: string): ChartEvidence => {
    const records = years.map((year) => getLabor(year, age)).filter(Boolean);
    const rateMetaMetric = rateMetric === "非勞動力率" ? "勞動力參與率" : rateMetric;
    const modeled = records.some((record) => record?.meta[countMetric]?.origin.includes("模型") || record?.meta[rateMetaMetric]?.origin.includes("模型"));
    const rateMethod = rateMetric === "非勞動力率"
      ? "非勞動力率＝非勞動力人口÷民間人口×100＝100－勞動力參與率"
      : `${rateMetric}依同年度對應母數重算`;
    return {
      universe,
      period: `${years.at(0)}–${years.at(-1)}年全年12個月平均`,
      identity: modeled ? "官方人力資源調查估計再模型換算" : "官方人力資源調查估計",
      method: `人數採${records.at(-1)?.meta[countMetric]?.method ?? "官方調查估計"}；${rateMethod}；PCLM主模型、Sprague敏感度`,
      source: laborSource.name,
      sourceUrl: laborSource.url,
      availability: "新北市全市・男女合計・110–114年",
    };
  };
  const pointsFor = (age: AgeBand, countMetric: string, rateMetric: string): LaborDualAxisPoint[] => years.map((year) => {
    const row = getLabor(year, age);
    return { year, count: row?.metrics[countMetric] ?? null, rate: rateMetric === "非勞動力率" ? row == null ? null : 100 - row.metrics["勞動力參與率"] : row?.metrics[rateMetric] ?? null };
  });
  const latestPolicy = getLabor(latestYear, policyAge);
  const previousPolicy = getLabor(latestYear - 1, policyAge);
  const policyMedian = median(years.map((year) => getLabor(year, policyAge)?.metrics["失業率"]).filter((value): value is number => value != null));
  const policySignal = buildLaborPolicySignal({
    ageLabel: ageBandLabel(policyAge),
    unemploymentRate: latestPolicy?.metrics["失業率"] ?? null,
    previousUnemploymentRate: previousPolicy?.metrics["失業率"] ?? null,
    fiveYearMedian: policyMedian,
    laborParticipationRate: latestPolicy?.metrics["勞動力參與率"] ?? null,
  });
  return (
    <>
      <section className="annual-analysis-intro section-shell" aria-labelledby="annual-labor-analysis-title">
        <div><p className="kicker">全年度比較分析｜110–114年全年平均</p><div className="title-help-row"><h2 id="annual-labor-analysis-title">從勞動參與，讀到就業與失業結果</h2><HelpTip label="勞動四象限閱讀順序">先看就業人口與就業人口比率，再看勞動力人口與勞參率；接著確認勞動力中的就業、失業組成，最後觀察未進入勞動市場者。每張圖可獨立切換年齡，但性別固定為男女合計。</HelpTip></div></div>
        <ol><li><span>1</span>確認就業結果</li><li><span>2</span>檢視勞動參與</li><li><span>3</span>拆解就業與失業</li><li><span>4</span>補上非勞動力</li></ol>
      </section>
      <div className="scope-availability-note annual-labor-scope"><strong>民間人口與勞動力母體</strong><span>新北市全市・男女合計・110–114年全年平均</span><span>官方調查估計；部分年齡組為模型估計</span></div>
      <section className="annual-quadrant-grid annual-labor-grid" aria-label="新北市全市勞動市場四象限年度分析">
        <article className="annual-quadrant-card quadrant-one"><span className="quadrant-label">有多少人就業</span><LaborDualAxisChart chartId="annual-employment" title={`${ageBandLabel(employmentAge)}就業規模與就業人口比率`} question="就業人數改變，是人口規模變化，還是實際就業程度也同步改變？" countLabel="就業人口" rateLabel="就業人口比率" points={pointsFor(employmentAge, "就業人口", "就業人口比率")} filters={<LaborAgeFilter idPrefix="annual-employment" ageBand={employmentAge} onAgeBandChange={setEmploymentAge} />} caveat="就業人口比率使用民間人口為分母，不能改除以戶籍人口；年度變化也不能直接歸因於單一政策。" evidence={evidenceFor(employmentAge, "就業人口", "就業人口比率", "新北市民間人口")} /></article>
        <article className="annual-quadrant-card quadrant-two"><span className="quadrant-label">多少人參與勞動</span><LaborDualAxisChart chartId="annual-participation" title={`${ageBandLabel(participationAge)}勞動力規模與勞動力參與率`} question="有多少青年進入勞動市場，參與程度在五年間如何改變？" countLabel="勞動力人口" rateLabel="勞動力參與率" points={pointsFor(participationAge, "勞動力人口", "勞動力參與率")} filters={<LaborAgeFilter idPrefix="annual-participation" ageBand={participationAge} onAgeBandChange={setParticipationAge} />} caveat="勞參率下降可能與就學、家務、照顧或其他狀態有關，不能直接解釋為求職困難。" evidence={evidenceFor(participationAge, "勞動力人口", "勞動力參與率", "新北市民間人口")} /></article>
        <article className="annual-quadrant-card quadrant-three"><span className="quadrant-label">就業與失業各占多少</span><LaborCompositionChart ageBand={compositionAge} onAgeBandChange={setCompositionAge} evidence={evidenceFor(compositionAge, "就業人口", "失業率", "新北市民間人口中的勞動力人口")} /></article>
        <article className="annual-quadrant-card quadrant-four"><span className="quadrant-label">多少人未參與勞動</span><LaborDualAxisChart chartId="annual-non-labor" title={`${ageBandLabel(nonLaborAge)}非勞動力人口與非勞動力率`} question="未進入勞動市場的人數與占民間人口比率，五年間如何變化？" countLabel="非勞動力人口" rateLabel="非勞動力率" points={pointsFor(nonLaborAge, "非勞動力人口", "非勞動力率")} filters={<LaborAgeFilter idPrefix="annual-non-labor" ageBand={nonLaborAge} onAgeBandChange={setNonLaborAge} />} caveat="18–24歲非勞動力可能包含就學者；非勞動力人口增加不等同失業人口增加。" evidence={evidenceFor(nonLaborAge, "非勞動力人口", "非勞動力率", "新北市民間人口")} /></article>
      </section>
      <StoryBridge index={2} title="哪些年齡層的勞動狀況不同？">接著比較18–24、25–29與30–35歲的勞參率、就業人口比率或失業率。</StoryBridge>
      <LaborLifeStageChart laborSource={laborSource} />
      {showPolicy && <>
        <StoryBridge index={3} title="最後把趨勢轉成待查核的政策問題">只有失業率同時高於五年中位數且較前一年上升，才列為優先盤點；這是監測門檻，不是因果結論。</StoryBridge>
        <section className="labor-policy-selector section-shell" aria-labelledby="labor-policy-selector-title"><div className="section-heading"><div><p className="kicker">動態政策初篩</p><div className="title-help-row"><h2 id="labor-policy-selector-title">選擇要檢查的青年年齡層</h2><HelpTip label="政策初篩限制">政策訊號使用最新年度、前一年度與五年中位數。結果仍需另行核對職缺、技能需求、服務量能與調查誤差。</HelpTip></div></div><LaborAgeFilter idPrefix="labor-policy" ageBand={policyAge} onAgeBandChange={setPolicyAge} /></div></section>
        <PolicyDecisionPanel signal={policySignal} evidenceSources={[laborSource.name]} contextLabel={`${latestYear}年・${ageBandLabel(policyAge)}・男女合計・新北市全市`} />
      </>}
    </>
  );
}

type WageDualAxisPoint = { year: number; value: number | null; growth: number | null };

function WageDualAxisChart({
  chartId,
  title,
  valueLabel,
  growthLabel,
  points,
  filters,
  evidence,
  question,
  caveat,
}: {
  chartId: string;
  title: string;
  valueLabel: string;
  growthLabel: string;
  points: WageDualAxisPoint[];
  filters: ReactNode;
  evidence: ChartEvidence;
  question: string;
  caveat: string;
}) {
  const [activePoint, setActivePoint] = useState<{ year: number; label: string; value: number; unit: string; x: number; y: number } | null>(null);
  const width = 720;
  const height = 360;
  const left = 82;
  const right = 92;
  const top = 48;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const slot = plotWidth / Math.max(points.length, 1);
  const xCenter = (index: number) => left + slot * index + slot / 2;
  const valueMaximum = Math.max(10, Math.ceil(Math.max(1, ...points.map((point) => point.value ?? 0)) / 10) * 10);
  const growthValues = points.flatMap((point) => point.growth == null ? [] : [point.growth]);
  const growthMinimum = Math.min(0, Math.floor(Math.min(0, ...growthValues)));
  const growthMaximum = Math.max(1, Math.ceil(Math.max(1, ...growthValues)));
  const growthRange = Math.max(1, growthMaximum - growthMinimum);
  const yValue = (value: number) => top + (1 - value / valueMaximum) * plotHeight;
  const yGrowth = (value: number) => top + (growthMaximum - value) / growthRange * plotHeight;
  const valueTicks = Array.from({ length: 5 }, (_, index) => valueMaximum - valueMaximum * index / 4);
  const growthTicks = Array.from({ length: 5 }, (_, index) => growthMaximum - growthRange * index / 4);
  const linePositions = points.map((point, index) => point.growth == null ? null : { x: xCenter(index), y: yGrowth(point.growth), value: point.growth, year: point.year }).filter((point): point is { x: number; y: number; value: number; year: number } => point != null);
  const growthPath = linePositions.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const barWidth = Math.min(58, slot * 0.5);
  const chartTransition = useChartTransition(chartMotionKey(points, title, valueLabel));
  return (
    <section className="dual-axis-chart wage-dual-axis" aria-labelledby={`${chartId}-title`}>
      <div className="chart-title-row">
        <div><p className="chart-overline">薪資數值 × 年增率</p><div className="title-help-row"><h3 id={`${chartId}-title`}>{title}</h3><HelpTip label={`${title}閱讀說明`}>
          <p><strong>這張圖要回答：</strong>{question}</p>
          <p><strong>長條：</strong>{valueLabel}，使用左軸且從0開始。</p>
          <p><strong>折線：</strong>{growthLabel}＝（本年薪資－前一年薪資）÷前一年薪資×100，使用右軸。</p>
          <p><strong>缺值：</strong>110年沒有109年同口徑輸入，年增率留白；114年尚未發布，薪資與年增率均不代填。</p>
          <p><strong>不能直接判讀：</strong>{caveat}</p>
        </HelpTip></div></div>
        <span className="five-point-note">110–114年；114年留白</span>
      </div>
      {filters}
      <DataReadingSummary facts={[trendFact(points, valueLabel, "萬元／年", 1), trendFact(points.map((point) => ({ year: point.year, value: point.growth })), growthLabel, "%")]} identity={evidence.identity} />
      <div className="annual-change-strip wage-change-strip" aria-label={`${valueLabel}與前一年度相比`}>
        {points.map((point) => <div key={point.year}><span>{point.year}年</span><strong>{point.value == null ? "尚未發布" : `${formatNumber(point.value, 1)}萬元`}</strong><small className={point.growth == null ? "change-base" : point.growth > 0 ? "change-up" : point.growth < 0 ? "change-down" : "change-base"}>{point.growth == null ? (point.value == null ? "年增率：無資料" : "與前一年度相比：無前期資料") : `與前一年度相比：${point.growth > 0 ? "↑ +" : point.growth < 0 ? "↓ " : "→ "}${formatNumber(point.growth, 2)}%`}</small></div>)}
      </div>
      <ChartCanvas ref={chartTransition} className="chart-canvas" onMouseLeave={() => setActivePoint(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}。長條為萬元每年，折線為相較前一年增減百分比`}>
          {valueTicks.map((tick, index) => {
            const gy = top + plotHeight * index / 4;
            return <g key={tick}><line x1={left} x2={width - right} y1={gy} y2={gy} className="grid-line" /><text x={left - 10} y={gy + 4} textAnchor="end">{formatNumber(tick, 0)}</text><text x={width - right + 10} y={gy + 4} textAnchor="start">{formatNumber(growthTicks[index], 1)}%</text></g>;
          })}
          {growthMinimum < 0 && <line x1={left} x2={width - right} y1={yGrowth(0)} y2={yGrowth(0)} className="rate-zero-line" />}
          <line x1={left} x2={left} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={width - right} x2={width - right} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="axis-line" />
          <text className="axis-title axis-title-left" transform={`translate(18 ${top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">{valueLabel}（萬元／年）</text>
          <text className="axis-title axis-title-right" transform={`translate(${width - 18} ${top + plotHeight / 2}) rotate(90)`} textAnchor="middle">{growthLabel}（%）</text>
          {points.map((point, index) => {
            const center = xCenter(index);
            const barTop = point.value == null ? height - bottom : yValue(point.value);
            return <g key={point.year}>
              {point.value != null ? <>
                <rect x={center - barWidth / 2} y={barTop} width={barWidth} height={height - bottom - barTop} rx="7" className="dual-bar wage-value-bar" tabIndex={0} role="button" aria-label={`${point.year}年${valueLabel}${formatNumber(point.value, 1)}萬元`} onMouseEnter={() => setActivePoint({ year: point.year, label: valueLabel, value: point.value as number, unit: "萬元／年", x: center, y: barTop })} onFocus={() => setActivePoint({ year: point.year, label: valueLabel, value: point.value as number, unit: "萬元／年", x: center, y: barTop })} onBlur={() => setActivePoint(null)}><title>{point.year}年 {valueLabel} {formatNumber(point.value, 1)}萬元／年</title></rect>
              </> : <text className="missing-chart-label" x={center} y={height - bottom - 16} textAnchor="middle">尚未發布</text>}
              <text x={center} y={height - 24} textAnchor="middle">{point.year}年</text>
            </g>;
          })}
          <path d={growthPath} fill="none" className="dual-line wage-growth-line" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {linePositions.map((point) => <circle key={point.year} cx={point.x} cy={point.y} r="7" className="dual-line-point wage-growth-point" tabIndex={0} role="button" aria-label={`${point.year}年${growthLabel}${formatNumber(point.value, 2)}%`} onMouseEnter={() => setActivePoint({ year: point.year, label: growthLabel, value: point.value, unit: "%", x: point.x, y: point.y })} onFocus={() => setActivePoint({ year: point.year, label: growthLabel, value: point.value, unit: "%", x: point.x, y: point.y })} onBlur={() => setActivePoint(null)}><title>{point.year}年 {growthLabel} {formatNumber(point.value, 2)}%</title></circle>)}
        </svg>
        {activePoint && <QuadrantPointTooltip x={activePoint.x} y={activePoint.y} width={width} height={height} title={<>{activePoint.year}年・{activePoint.label}</>} identity="">{formatNumber(activePoint.value, activePoint.unit === "%" ? 2 : 1)}{activePoint.unit}<small>{evidence.identity}</small></QuadrantPointTooltip>}
      </ChartCanvas>
      <ul className="chart-legend"><li><i className="legend-bar" />{valueLabel}（左軸）</li><li><i className="legend-line" />{growthLabel}（右軸）</li></ul>
      <details className="data-table-details"><summary>查看圖表資料表</summary><div className="table-scroll"><table><thead><tr><th>年度</th><th>{valueLabel}（萬元／年）</th><th>{growthLabel}</th></tr></thead><tbody>{points.map((point) => <tr key={point.year}><td>{point.year}年</td><td>{point.value == null ? "尚未發布" : formatNumber(point.value, 1)}</td><td>{point.growth == null ? "無比較值" : `${formatNumber(point.growth, 2)}%`}</td></tr>)}</tbody></table></div></details>
      <EvidenceDetails evidence={evidence} />
    </section>
  );
}

type WageStatistic = "全年總薪資平均數" | "全年總薪資中位數";

type WageGapPoint = {
  year: number;
  mean: number | null;
  median: number | null;
  gap: number | null;
  gapShare: number | null;
  meanGrowth: number | null;
  medianGrowth: number | null;
  growthDifference: number | null;
};

function WageGapChart({ ageBand, points, evidence }: { ageBand: AgeBand; points: WageGapPoint[]; evidence: ChartEvidence }) {
  const [activePoint, setActivePoint] = useState<{ year: number; label: string; value: number; unit: string; x: number; y: number } | null>(null);
  const width = 720;
  const height = 360;
  const left = 82;
  const right = 92;
  const top = 48;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const slot = plotWidth / Math.max(points.length, 1);
  const xCenter = (index: number) => left + slot * index + slot / 2;
  const gapValues = points.flatMap((point) => point.gap == null ? [] : [point.gap]);
  const shareValues = points.flatMap((point) => point.gapShare == null ? [] : [point.gapShare]);
  const gapMaximum = Math.max(5, Math.ceil(Math.max(1, ...gapValues) / 5) * 5);
  const shareMaximum = Math.max(5, Math.ceil(Math.max(1, ...shareValues) / 5) * 5);
  const yGap = (value: number) => top + (1 - value / gapMaximum) * plotHeight;
  const yShare = (value: number) => top + (1 - value / shareMaximum) * plotHeight;
  const gapTicks = Array.from({ length: 5 }, (_, index) => gapMaximum - gapMaximum * index / 4);
  const shareTicks = Array.from({ length: 5 }, (_, index) => shareMaximum - shareMaximum * index / 4);
  const linePositions = points.map((point, index) => point.gapShare == null ? null : { x: xCenter(index), y: yShare(point.gapShare), value: point.gapShare, year: point.year }).filter((point): point is { x: number; y: number; value: number; year: number } => point != null);
  const linePath = linePositions.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const barWidth = Math.min(58, slot * 0.5);
  const chartTransition = useChartTransition(chartMotionKey(ageBand, points));
  return (
    <section className="dual-axis-chart wage-gap-chart" aria-labelledby="annual-wage-gap-title">
      <div className="chart-title-row">
        <div><p className="chart-overline">分布距離｜絕對額 × 相對比</p><div className="title-help-row"><h3 id="annual-wage-gap-title">{ageBandLabel(ageBand)}平均數與中位數差距</h3><HelpTip label="平均數與中位數差距閱讀說明">
          <p><strong>長條：</strong>同年度平均數－中位數，使用左軸。</p>
          <p><strong>折線：</strong>（平均數－中位數）÷平均數×100，使用右軸；這是分布偏斜代理值，不是正式偏態係數。</p>
          <p><strong>資料表：</strong>另列平均數、中位數、兩者年增率及成長速度差，避免把不同單位硬塞進同一座標軸。</p>
        </HelpTip></div></div>
        <span className="five-point-note">110–114年；114年留白</span>
      </div>
      <DataReadingSummary facts={[trendFact(points.map((point) => ({ year: point.year, value: point.gap })), "平均數與中位數差額", "萬元／年", 1), trendFact(points.map((point) => ({ year: point.year, value: point.gapShare })), "差額占平均數比率", "%")]} identity={evidence.identity} />
      <ChartCanvas ref={chartTransition} className="chart-canvas" onMouseLeave={() => setActivePoint(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${ageBandLabel(ageBand)}平均數與中位數差距；長條為萬元每年，折線為差距占平均數百分比`}>
          {gapTicks.map((tick, index) => {
            const gy = top + plotHeight * index / 4;
            return <g key={tick}><line x1={left} x2={width - right} y1={gy} y2={gy} className="grid-line" /><text x={left - 10} y={gy + 4} textAnchor="end">{formatNumber(tick, 1)}</text><text x={width - right + 10} y={gy + 4} textAnchor="start">{formatNumber(shareTicks[index], 1)}%</text></g>;
          })}
          <line x1={left} x2={left} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={width - right} x2={width - right} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="axis-line" />
          <text className="axis-title axis-title-left" transform={`translate(18 ${top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">平均—中位數差額（萬元／年）</text>
          <text className="axis-title axis-title-right" transform={`translate(${width - 18} ${top + plotHeight / 2}) rotate(90)`} textAnchor="middle">差額占平均數（%）</text>
          {points.map((point, index) => {
            const center = xCenter(index);
            const barTop = point.gap == null ? height - bottom : yGap(point.gap);
            return <g key={point.year}>
              {point.gap != null ? <rect x={center - barWidth / 2} y={barTop} width={barWidth} height={height - bottom - barTop} rx="7" className="dual-bar wage-gap-bar" tabIndex={0} role="button" aria-label={`${point.year}年平均數與中位數差額${formatNumber(point.gap, 1)}萬元`} onMouseEnter={() => setActivePoint({ year: point.year, label: "平均—中位數差額", value: point.gap as number, unit: "萬元／年", x: center, y: barTop })} onFocus={() => setActivePoint({ year: point.year, label: "平均—中位數差額", value: point.gap as number, unit: "萬元／年", x: center, y: barTop })} onBlur={() => setActivePoint(null)}><title>{point.year}年 平均—中位數差額 {formatNumber(point.gap, 1)}萬元／年</title></rect> : <text className="missing-chart-label" x={center} y={height - bottom - 16} textAnchor="middle">尚未發布</text>}
              <text x={center} y={height - 24} textAnchor="middle">{point.year}年</text>
            </g>;
          })}
          <path d={linePath} fill="none" className="dual-line wage-gap-share-line" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {linePositions.map((point) => <circle key={point.year} cx={point.x} cy={point.y} r="7" className="dual-line-point wage-gap-share-point" tabIndex={0} role="button" aria-label={`${point.year}年差額占平均數${formatNumber(point.value, 2)}%`} onMouseEnter={() => setActivePoint({ year: point.year, label: "差額占平均數", value: point.value, unit: "%", x: point.x, y: point.y })} onFocus={() => setActivePoint({ year: point.year, label: "差額占平均數", value: point.value, unit: "%", x: point.x, y: point.y })} onBlur={() => setActivePoint(null)}><title>{point.year}年 差額占平均數 {formatNumber(point.value, 2)}%</title></circle>)}
        </svg>
        {activePoint && <QuadrantPointTooltip x={activePoint.x} y={activePoint.y} width={width} height={height} title={<>{activePoint.year}年・{activePoint.label}</>} identity="">{formatNumber(activePoint.value, activePoint.unit === "%" ? 2 : 1)}{activePoint.unit}<small>{evidence.identity}</small></QuadrantPointTooltip>}
      </ChartCanvas>
      <ul className="chart-legend"><li><i className="legend-bar wage-gap-legend-bar" />平均—中位數差額（左軸）</li><li><i className="legend-line wage-gap-legend-line" />差額占平均數（右軸）</li></ul>
      <details className="data-table-details"><summary>查看平均數、中位數、差額與成長速度</summary><div className="table-scroll"><table><thead><tr><th>年度</th><th>平均數</th><th>中位數</th><th>差額</th><th>差額占平均數</th><th>平均數年增率</th><th>中位數年增率</th><th>成長速度差</th></tr></thead><tbody>{points.map((point) => <tr key={point.year}><td>{point.year}年</td><td>{point.mean == null ? "尚未發布" : `${formatNumber(point.mean, 1)}萬元`}</td><td>{point.median == null ? "尚未發布" : `${formatNumber(point.median, 1)}萬元`}</td><td>{point.gap == null ? "—" : `${formatNumber(point.gap, 1)}萬元`}</td><td>{point.gapShare == null ? "—" : `${formatNumber(point.gapShare, 2)}%`}</td><td>{point.meanGrowth == null ? "無比較值" : `${formatNumber(point.meanGrowth, 2)}%`}</td><td>{point.medianGrowth == null ? "無比較值" : `${formatNumber(point.medianGrowth, 2)}%`}</td><td>{point.growthDifference == null ? "無比較值" : `${point.growthDifference > 0 ? "+" : ""}${formatNumber(point.growthDifference, 2)}個百分點`}</td></tr>)}</tbody></table></div></details>
      <EvidenceDetails evidence={evidence} />
    </section>
  );
}

function WageRangeComparisonChart({ ageBand, evidence }: { ageBand: AgeBand; evidence: ChartEvidence }) {
  const years = dashboardData.meta.years;
  const series = (metric: WageStatistic) => years.map((year) => {
    const row = getWage(year, ageBand);
    const value = row?.metrics[metric] ?? null;
    const meta = row?.meta[metric];
    const hasBand = value != null && meta?.low != null && meta?.high != null;
    return {
      year,
      value,
      low: value == null ? null : (meta?.low ?? value),
      high: value == null ? null : (meta?.high ?? value),
      hasBand,
      identity: meta?.origin ?? "尚未發布",
    };
  });
  const first = series("全年總薪資平均數");
  const second = series("全年總薪資中位數");
  const allBounds = [...first, ...second].flatMap((point) => point.low == null || point.high == null ? [] : [point.low, point.high]);
  const yMinimum = Math.max(0, Math.floor((Math.min(...allBounds, 40) - 5) / 10) * 10);
  const yMaximum = Math.ceil((Math.max(...allBounds, 70) + 5) / 10) * 10;
  const width = 720;
  const height = 390;
  const left = 78;
  const right = 24;
  const top = 50;
  const bottom = 60;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index: number) => left + plotWidth * index / Math.max(1, years.length - 1);
  const y = (value: number) => top + (yMaximum - value) / Math.max(1, yMaximum - yMinimum) * plotHeight;
  const visible = (items: ReturnType<typeof series>) => items.map((point, index) => ({ ...point, index })).filter((point) => point.value != null && point.low != null && point.high != null);
  const firstVisible = visible(first);
  const secondVisible = visible(second);
  const linePath = (items: ReturnType<typeof visible>) => items.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.index)},${y(point.value as number)}`).join(" ");
  const bandPath = (items: ReturnType<typeof visible>) => {
    const ranged = items.filter((point) => point.hasBand);
    if (ranged.length < 2) return "";
    const upper = ranged.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.index)},${y(point.high as number)}`).join(" ");
    const lower = [...ranged].reverse().map((point) => `L${x(point.index)},${y(point.low as number)}`).join(" ");
    return `${upper} ${lower} Z`;
  };
  const boundaryPath = (items: ReturnType<typeof visible>, boundary: "low" | "high") => items
    .filter((point) => point.hasBand)
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.index)},${y(point[boundary] as number)}`)
    .join(" ");
  const rows = years.map((year, index) => {
    const a = first[index];
    const b = second[index];
    const overlap = a.hasBand && b.hasBand ? estimateRangesOverlap(a.low, a.high, b.low, b.high) : null;
    return { year, a, b, overlap, gap: a.value == null || b.value == null ? null : b.value - a.value };
  });
  const [activePoint, setActivePoint] = useState<{ year: number; age: string; value: number; low: number; high: number; identity: string; x: number; y: number } | null>(null);
  const chartTransition = useChartTransition(chartMotionKey(ageBand, first, second));
  return (
    <section className="wage-range-chart" aria-labelledby="wage-range-title">
      <div className="chart-title-row">
        <div><p className="chart-overline">{ageBandLabel(ageBand)}估計範圍比較</p><div className="title-help-row"><h3 id="wage-range-title">平均數、中位數與方法敏感度帶</h3><HelpTip label="估計範圍比較說明">
          <p><strong>實線／虛線：</strong>{ageBandLabel(ageBand)}全年總薪資的平均數與中位數點估計。</p>
          <p><strong>灰色寬帶：</strong>同一筆資料以既定替代方法重算所得的最低值至最高值；上下邊線分別是上限與下限。這是方法敏感度，不是抽樣信賴區間。</p>
          <p><strong>深灰交疊：</strong>平均數與中位數的方法敏感度範圍重疊。重疊只表示目前無法判定有明顯差異，不等於已做統計顯著性檢定。</p>
          <p><strong>紅色差距：</strong>同年度平均數與中位數的點估計差額，單位為萬元／年。</p>
        </HelpTip></div></div>
        <span className="five-point-note">114年尚未發布</span>
      </div>
      <DataReadingSummary facts={[firstVisible, secondVisible].flatMap((items, index) => { const point = items.at(-1); return point?.hasBand ? [`${point.year}年${index === 0 ? "平均數" : "中位數"}點估計${formatNumber(point.value!, 1)}萬元／年，方法敏感度下限${formatNumber(point.low!, 1)}、上限${formatNumber(point.high!, 1)}萬元／年。`] : []; })} />
      <ChartCanvas ref={chartTransition} className="chart-canvas wage-range-canvas" onMouseLeave={() => setActivePoint(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${ageBandLabel(ageBand)}全年總薪資平均數與中位數點估計及方法敏感度範圍`}>
          {Array.from({ length: 5 }, (_, index) => yMaximum - (yMaximum - yMinimum) * index / 4).map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="grid-line" /><text x={left - 10} y={y(tick) + 4} textAnchor="end">{formatNumber(tick, 0)}</text></g>)}
          <line x1={left} x2={left} y1={top} y2={height - bottom} className="axis-line" />
          <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="axis-line" />
          <text className="axis-title" transform={`translate(18 ${top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">全年總薪資（萬元／年）</text>
          {years.map((year, index) => <g key={year}><text x={x(index)} y={height - 25} textAnchor="middle">{year}年</text>{first[index].value == null && second[index].value == null && <text className="missing-chart-label" x={x(index)} y={height - bottom - 14} textAnchor="middle">尚未發布</text>}</g>)}
          {bandPath(firstVisible) && <path d={bandPath(firstVisible)} className="wage-band wage-band-first" />}
          {bandPath(secondVisible) && <path d={bandPath(secondVisible)} className="wage-band wage-band-second" />}
          {boundaryPath(firstVisible, "high") && <path d={boundaryPath(firstVisible, "high")} className="wage-band-boundary wage-band-boundary-first" />}
          {boundaryPath(firstVisible, "low") && <path d={boundaryPath(firstVisible, "low")} className="wage-band-boundary wage-band-boundary-first" />}
          {boundaryPath(secondVisible, "high") && <path d={boundaryPath(secondVisible, "high")} className="wage-band-boundary wage-band-boundary-second" />}
          {boundaryPath(secondVisible, "low") && <path d={boundaryPath(secondVisible, "low")} className="wage-band-boundary wage-band-boundary-second" />}
          <path d={linePath(firstVisible)} className="wage-estimate-line wage-estimate-first" />
          <path d={linePath(secondVisible)} className="wage-estimate-line wage-estimate-second" />
          {rows.map((row, index) => {
            if (row.gap == null || row.a.value == null || row.b.value == null) return null;
            const firstY = y(row.a.value);
            const secondY = y(row.b.value);
            const middleY = (firstY + secondY) / 2;
            return <g key={`gap-${row.year}`} className="wage-gap-annotation">
              <line x1={x(index)} x2={x(index)} y1={firstY} y2={secondY} />
              <text x={x(index) + 9} y={middleY + 4}>差 {formatNumber(Math.abs(row.gap), 1)}萬</text>
            </g>;
          })}
          {firstVisible.map((point) => <circle key={point.year} cx={x(point.index)} cy={y(point.value as number)} r="6" className="wage-estimate-point wage-estimate-point-first" tabIndex={0} role="button" aria-label={`${point.year}年${ageBandLabel(ageBand)}平均數${formatNumber(point.value as number, 1)}萬元`} onMouseEnter={() => setActivePoint({ year: point.year, age: "平均數", value: point.value as number, low: point.low as number, high: point.high as number, identity: point.identity, x: x(point.index), y: y(point.value as number) })} onFocus={() => setActivePoint({ year: point.year, age: "平均數", value: point.value as number, low: point.low as number, high: point.high as number, identity: point.identity, x: x(point.index), y: y(point.value as number) })} onBlur={() => setActivePoint(null)} />)}
          {secondVisible.map((point) => <circle key={point.year} cx={x(point.index)} cy={y(point.value as number)} r="6" className="wage-estimate-point wage-estimate-point-second" tabIndex={0} role="button" aria-label={`${point.year}年${ageBandLabel(ageBand)}中位數${formatNumber(point.value as number, 1)}萬元`} onMouseEnter={() => setActivePoint({ year: point.year, age: "中位數", value: point.value as number, low: point.low as number, high: point.high as number, identity: point.identity, x: x(point.index), y: y(point.value as number) })} onFocus={() => setActivePoint({ year: point.year, age: "中位數", value: point.value as number, low: point.low as number, high: point.high as number, identity: point.identity, x: x(point.index), y: y(point.value as number) })} onBlur={() => setActivePoint(null)} />)}
        </svg>
        {activePoint && <QuadrantPointTooltip x={activePoint.x} y={activePoint.y} width={width} height={height} title={<>{activePoint.year}年・{activePoint.age}</>} identity={activePoint.identity}>{formatNumber(activePoint.value, 1)}萬元／年<small>{activePoint.low === activePoint.high ? "官方點值；未另造上下限" : `方法敏感度 ${formatNumber(activePoint.low, 1)}–${formatNumber(activePoint.high, 1)}萬元`}</small></QuadrantPointTooltip>}
      </ChartCanvas>
      <ul className="chart-legend wage-range-legend"><li><i className="wage-legend-first" />{ageBandLabel(ageBand)}平均數（實線）</li><li><i className="wage-legend-second" />{ageBandLabel(ageBand)}中位數（虛線）</li><li><i className="wage-legend-band" />灰色＝方法敏感度上下限</li><li><i className="wage-legend-overlap" />深灰＝兩帶重疊</li><li><b className="wage-legend-gap">差 X萬</b>平均數與中位數差額</li></ul>
      <details className="data-table-details"><summary>查看逐年比較與重疊判讀</summary><div className="table-scroll"><table><thead><tr><th>年度</th><th>平均數點估計</th><th>平均數敏感度範圍</th><th>中位數點估計</th><th>中位數敏感度範圍</th><th>中位數－平均數</th><th>範圍判讀</th></tr></thead><tbody>{rows.map((row) => <tr key={row.year}><td>{row.year}年</td><td>{row.a.value == null ? "尚未發布" : formatNumber(row.a.value, 1)}</td><td>{row.a.value == null ? "—" : row.a.hasBand ? `${formatNumber(row.a.low as number, 1)}–${formatNumber(row.a.high as number, 1)}` : "官方點值；無估計帶"}</td><td>{row.b.value == null ? "尚未發布" : formatNumber(row.b.value, 1)}</td><td>{row.b.value == null ? "—" : row.b.hasBand ? `${formatNumber(row.b.low as number, 1)}–${formatNumber(row.b.high as number, 1)}` : "官方點值；無估計帶"}</td><td>{row.gap == null ? "—" : `${row.gap > 0 ? "+" : ""}${formatNumber(row.gap, 1)}萬元`}</td><td>{row.a.value == null || row.b.value == null ? "無資料" : row.overlap === true ? "範圍重疊，尚無法判定有明顯差異" : row.overlap === false ? "範圍未重疊；差異方向一致，仍非顯著性檢定" : "一方無估計帶，僅比較點值"}</td></tr>)}</tbody></table></div></details>
      <EvidenceDetails evidence={evidence} />
    </section>
  );
}

const youthIndustryWageAgeLabels: Record<YouthIndustryWageAgeBand, string> = {
  "18-35": "18–35歲",
  "18-24": "18–24歲",
  "25-29": "25–29歲",
  "30-35": "30–35歲",
};

function YouthIndustryWageMatrix({ ageBand }: { ageBand: AgeBand }) {
  const data = youthIndustryWage;
  const ageBands: YouthIndustryWageAgeBand[] = [ageBand];
  const values = data.rows.flatMap((row) => ageBands.map((band) => row.estimates[band].value)).filter((value): value is number => value != null);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const intensity = (value: number | null) => value == null ? 0 : (value - minimum) / Math.max(1, maximum - minimum);
  const maxReaggregationError = Math.max(...Object.values(data.validation.reaggregation).map((item) => item.absoluteError));
  const evidence: ChartEvidence = {
    universe: "工作場所位於新北市之本國籍全時受僱員工；全國行業資料僅作結構輔助",
    period: `${data.meta.rocYear}年全年`,
    identity: data.meta.identity,
    method: `${data.meta.formula}；${data.meta.calibration}`,
    source: data.meta.sources.slice(0, 2).map((source) => source.name).join("；"),
    sourceUrl: data.meta.sources[0].url,
    availability: `${data.validation.availableIndustryCount}類可估計；${data.validation.unavailableIndustryCount}類因不在官方表2詳細行業範圍而保留缺值`,
  };
  const chartTransition = useChartTransition(chartMotionKey(ageBand, data.rows));
  return (
    <section className="salary-matrix youth-industry-wage-matrix section-shell" aria-labelledby="youth-industry-wage-title">
      <div className="chart-title-row"><div><p className="chart-overline">青年年齡 × 行業統合分析</p><div className="title-help-row"><h3 id="youth-industry-wage-title">青年各行業全年總薪資平均數</h3><HelpTip label="青年行業薪資估計說明">
        <p><strong>這不是官方直接交叉表：</strong>官方尚未發布新北市、青年年齡與行業三者同時交叉的薪資。</p>
        <p><strong>點估計：</strong>以新北市同年齡全年總薪資平均數作錨點，再乘上全國同行業、同年齡薪資相對指數。</p>
        <p><strong>年齡範圍：</strong>使用本頁選定的青年年齡層；四組皆保留相同的模型身分與資料限制。</p>
        <p><strong>年度限制：</strong>薪資錨點為113年；目前勞退公開端點僅提供114年，因此全年齡行業人數只作跨一年的中心化權重，不作113年青年行業人數或薪資值。</p>
        <p><strong>灰字範圍：</strong>比較全國年齡×行業結構與年齡邊界替代法所得的包絡範圍。它是方法敏感度，不是信賴區間。</p>
      </HelpTip></div></div><span className="five-point-note">{data.meta.rocYear}年｜{data.meta.identity}｜單位：萬元／年</span></div>
      <DataReadingSummary facts={categoryFacts(data.rows.map((row) => ({ label: row.industry, value: row.estimates[ageBand].value })), `${data.meta.rocYear}年${ageBandLabel(ageBand)}・可用行業`, "萬元／年", 1)} identity="模型估計" />
      <div className="salary-heat-legend" aria-label={`青年行業全年總薪資平均數點估計最低${formatNumber(minimum, 1)}萬元，最高${formatNumber(maximum, 1)}萬元`}><span>較低</span><i /><span>較高</span><strong>{formatNumber(minimum, 1)}–{formatNumber(maximum, 1)}萬元／年</strong></div>
      <div ref={chartTransition} className="salary-matrix-scroll" aria-label="青年行業薪資模型估計表；可向下捲動查看更多行業">
        <table>
          <thead><tr><th scope="col">行業</th>{ageBands.map((band) => <th key={band} scope="col">{youthIndustryWageAgeLabels[band]}</th>)}</tr></thead>
          <tbody>{data.rows.map((row) => <tr key={row.industry}><th scope="row">{row.industry}</th>{ageBands.map((band) => {
            const estimate = row.estimates[band];
            const ratio = intensity(estimate.value);
            const unavailable = estimate.value == null;
            return <td key={band} className={unavailable ? "salary-matrix-empty" : ratio > .62 ? "salary-matrix-cell is-dark" : "salary-matrix-cell"} style={unavailable ? undefined : { backgroundColor: `rgba(15,118,110,${(0.1 + ratio * 0.8).toFixed(3)})` }} title={unavailable ? `${row.industry}：不在主計總處表2詳細行業薪資範圍，未估計` : `${row.industry}・${youthIndustryWageAgeLabels[band]}：點估計${formatNumber(estimate.value as number, 1)}萬元／年；方法敏感度${formatNumber(estimate.low as number, 1)}–${formatNumber(estimate.high as number, 1)}萬元；${estimate.status === "MODEL_ESTIMATE" ? "模型估計" : "資料缺口"}`}><strong data-motion-label="true">{unavailable ? "—" : formatNumber(estimate.value as number, 1)}</strong><small data-motion-label="true">{unavailable ? "官方表未涵蓋" : `${formatNumber(estimate.low as number, 1)}–${formatNumber(estimate.high as number, 1)}`}</small></td>;
          })}</tr>)}</tbody>
        </table>
      </div>
      <p className="salary-context-guardrail">本表為{data.meta.rocYear}年{ageBandLabel(ageBand)}的行業薪資模型估計，單位為萬元／年；灰字列出方法敏感度範圍。</p>
      <details className="data-table-details"><summary>查看公式、驗證與資料限制</summary>
        <p><strong>計算公式：</strong>{data.meta.formula}</p>
        <p><strong>回加驗證：</strong>17個可用行業以校準權重回加後，各年齡組與新北市薪資錨點最大差{formatNumber(maxReaggregationError, 3)}萬元；差異來自前台顯示至小數1位的四捨五入。</p>
        <p><strong>敏感度：</strong>{data.meta.uncertainty}</p>
        <ul>{data.meta.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      </details>
      <EvidenceDetails evidence={evidence} />
    </section>
  );
}

function MolIndustrySizeMatrix({ evidence }: { evidence: ChartEvidence }) {
  const matrix = molSalaryContext.industrySizeMatrix;
  const cells = matrix.rows.flatMap((row) => row.cells).filter((cell) => cell.averageContributionWage != null && cell.headcount > 0);
  const minimum = Math.min(...cells.map((cell) => cell.averageContributionWage as number));
  const maximum = Math.max(...cells.map((cell) => cell.averageContributionWage as number));
  const intensity = (value: number | null) => value == null ? 0 : (value - minimum) / Math.max(1, maximum - minimum);
  return (
    <section className="salary-matrix" aria-labelledby="salary-matrix-title">
      <div className="chart-title-row"><div><p className="chart-overline">全年齡背景資料｜行業 × 事業規模</p><div className="title-help-row"><h3 id="salary-matrix-title">平均提繳工資交叉矩陣（非青年薪資）</h3><HelpTip label="行業與事業規模矩陣說明">
        <p><strong>列：</strong>勞動部官方19類行業。</p><p><strong>欄：</strong>官方19個規模帶彙整為六組，避免欄位過碎。</p>
        <p><strong>每格數值：</strong>來源格的提繳工資是全年平均；本頁以12月底提繳人數加權，重算行業與規模群組的平均月提繳工資近似值。格內同步列出支持該重算值的人數。</p>
        <p><strong>顏色：</strong>只表示同表數值由低至高；格內數字與下方資料表是可讀替代，不靠顏色判斷。</p>
        <p><strong>限制：</strong>本表為全年齡勞退新制提繳者，不能當成18–35歲青年薪資。</p>
      </HelpTip></div></div><span className="five-point-note">{molSalaryContext.meta.rocYear}年全年平均｜人數為{molSalaryContext.meta.month}月底</span></div>
      <div className="salary-heat-legend" aria-label={`平均提繳工資最低${formatNumber(minimum)}元，最高${formatNumber(maximum)}元`}><span>較低</span><i /><span>較高</span><strong>{formatNumber(minimum)}–{formatNumber(maximum)}元／月</strong></div>
      <div className="salary-matrix-scroll" aria-label="可水平捲動的行業與事業規模平均提繳工資矩陣">
        <table>
          <thead><tr><th scope="col">行業</th><th scope="col">行業平均提繳工資</th>{matrix.sizeGroups.map((group) => <th key={group.name} scope="col" title={`官方規模帶：${group.sourceBands.join("、")}`}>{group.name}</th>)}</tr></thead>
          <tbody>{matrix.rows.map((row) => <tr key={row.industry}><th scope="row">{row.industry}</th><td className="salary-matrix-total"><strong>{formatNumber(row.total.averageContributionWage ?? 0)}</strong><small>{formatNumber(row.total.headcount)}人</small></td>{row.cells.map((cell) => {
            const ratio = intensity(cell.averageContributionWage);
            return <td key={cell.sizeGroup} className={cell.headcount === 0 ? "salary-matrix-empty" : ratio > .62 ? "salary-matrix-cell is-dark" : "salary-matrix-cell"} style={cell.headcount === 0 ? undefined : { backgroundColor: `rgba(15,118,110,${(0.1 + ratio * 0.8).toFixed(3)})` }} title={cell.headcount === 0 ? `${row.industry}・${cell.sizeGroup}：無資料` : `${row.industry}・${cell.sizeGroup}：平均月提繳工資（分組重算）${formatNumber(cell.averageContributionWage as number)}元；12月底支持人數${formatNumber(cell.headcount)}人`}><strong>{cell.headcount === 0 ? "—" : formatNumber(cell.averageContributionWage as number)}</strong><small>{cell.headcount === 0 ? "無資料" : `${formatNumber(cell.headcount)}人`}</small></td>;
          })}</tr>)}</tbody>
        </table>
      </div>
      <p className="salary-context-guardrail"><strong>矩陣用途：</strong>先找出「哪一類行業、哪一種事業規模」的申報月提繳工資相對較低或較高，再決定要補查實際薪資、職業、工時、年資與青年年齡交叉資料；不可把分組重算值稱為實際平均薪資，也不可由本表直接認定青年低薪或政策效果。</p>
      <details className="data-table-details"><summary>查看規模分組與計算公式</summary><p>{molSalaryContext.meta.matrixGroupMethod}</p><ul>{matrix.sizeGroups.map((group) => <li key={group.name}><strong>{group.name}：</strong>{group.sourceBands.join("、")}</li>)}</ul></details>
      <EvidenceDetails evidence={evidence} />
    </section>
  );
}

function MolSalaryContextPanel() {
  const data = molSalaryContext;
  const evidence: ChartEvidence = {
    universe: "提繳單位登記地址位於新北市的勞退新制提繳者（全年齡）",
    period: `${data.meta.rocYear}年全年平均；支持人數為${data.meta.month}月底`,
    identity: "官方行政資料之分組重算近似值",
    method: data.meta.aggregationMethod,
    source: data.meta.sourceName,
    sourceUrl: data.meta.sourceUrl,
    availability: "可比較縣市、19類行業×六組事業單位規模；無新北市×青年年齡交叉",
  };
  return (
    <section className="mol-salary-context section-shell" aria-labelledby="mol-salary-context-title">
      <div className="section-heading"><div><p className="kicker">勞動部薪資行情補充層</p><div className="title-help-row"><h2 id="mol-salary-context-title">用申報的月提繳工資比較行業與事業規模</h2><HelpTip label="兩種薪資證據為何不能合併"><p>全年總薪資是薪資調查的全年平均數或中位數；月提繳工資則由投保單位依月薪資總額，或適用者依月提繳執行業務所得，對照分級表申報。</p><p><strong>不是由退休金提繳金額倒推平均薪資：</strong>它是級距化申報值。本頁再以12月底人數加權重算群組平均，因此只能作工作場域的薪資水準代理，不能與全年總薪資相加、換算或串成同一條趨勢線。</p></HelpTip></div></div><a className="text-link" href={data.meta.salarySystemUrl} target="_blank" rel="noreferrer">開啟勞動部薪資行情系統</a></div>
      <div className="salary-context-kpis">
        <article><span>新北市平均月提繳工資</span><strong>{formatNumber(data.newTaipei.averageContributionWage)}<em>元／月</em></strong><small>全年平均之分組重算值・全年齡</small></article>
        <article><span>全國平均月提繳工資</span><strong>{formatNumber(data.newTaipei.nationalAverageContributionWage)}<em>元／月</em></strong><small>相同年度與重算方式</small></article>
        <article><span>新北市與全國差距</span><strong>{data.newTaipei.differenceFromNationalPct > 0 ? "+" : ""}{formatNumber(data.newTaipei.differenceFromNationalPct, 2)}<em>%</em></strong><small>（新北市－全國）÷全國</small></article>
        <article><span>縣市平均提繳工資排名</span><strong>第{data.newTaipei.countyRank}<em>／{data.newTaipei.countyCount}</em></strong><small>數值高低排名，不是政策績效</small></article>
      </div>
      <MolIndustrySizeMatrix evidence={{ ...evidence, method: `${data.meta.aggregationMethod}；${data.meta.matrixGroupMethod}` }} />
      <p className="salary-context-guardrail"><strong>解讀邊界：</strong>{data.meta.metricDefinition}；地理口徑為{data.meta.geographyBasis}。本區只能作全年齡的工作場域補充證據，不能代替青年全年總薪資。</p>
    </section>
  );
}

function AllYearWageDashboard({ wageSource, showPolicy }: { wageSource: { name: string; url: string }; showPolicy: boolean }) {
  const [youthAge, setYouthAge] = useState<AgeBand>("18-35");
  const years = dashboardData.meta.years;
  const availableYears = years.filter((year) => dashboardData.wage.some((row) => row.year === year && row.ageBand === youthAge));
  const latestYear = availableYears.at(-1) ?? null;
  const meanLevelGrowthPoints: WageDualAxisPoint[] = years.map((year) => {
    const value = getWage(year, youthAge)?.metrics["全年總薪資平均數"] ?? null;
    const previous = getWage(year - 1, youthAge)?.metrics["全年總薪資平均數"] ?? null;
    return { year, value, growth: growthRatePct(value, previous) };
  });
  const medianLevelGrowthPoints: WageDualAxisPoint[] = years.map((year) => {
    const value = getWage(year, youthAge)?.metrics["全年總薪資中位數"] ?? null;
    const previous = getWage(year - 1, youthAge)?.metrics["全年總薪資中位數"] ?? null;
    return { year, value, growth: growthRatePct(value, previous) };
  });
  const gapPoints: WageGapPoint[] = years.map((year) => {
    const row = getWage(year, youthAge);
    const previous = getWage(year - 1, youthAge);
    const mean = row?.metrics["全年總薪資平均數"] ?? null;
    const medianValue = row?.metrics["全年總薪資中位數"] ?? null;
    const meanGrowth = growthRatePct(mean, previous?.metrics["全年總薪資平均數"] ?? null);
    const medianGrowth = growthRatePct(medianValue, previous?.metrics["全年總薪資中位數"] ?? null);
    return {
      year,
      mean,
      median: medianValue,
      gap: meanMedianGap({ mean, median: medianValue }),
      gapShare: meanMedianGapSharePct({ mean, median: medianValue }),
      meanGrowth,
      medianGrowth,
      growthDifference: meanGrowth == null || medianGrowth == null ? null : meanGrowth - medianGrowth,
    };
  });
  const latestComparison = latestYear == null ? undefined : getWage(latestYear, youthAge);
  const latestComparisonGap = meanMedianGap({ mean: latestComparison?.metrics["全年總薪資平均數"], median: latestComparison?.metrics["全年總薪資中位數"] });
  const latestComparisonSkew = meanMedianGapSharePct({ mean: latestComparison?.metrics["全年總薪資平均數"], median: latestComparison?.metrics["全年總薪資中位數"] });
  const elapsedYears = latestYear == null || availableYears.length === 0 ? 0 : latestYear - availableYears[0];
  const evidenceFor = (age: AgeBand, metric: "全年總薪資平均數" | "全年總薪資中位數"): ChartEvidence => {
    const records = availableYears.map((year) => getWage(year, age)).filter(Boolean);
    const modeled = records.some((record) => record?.meta[metric]?.origin.includes("模型"));
    const methods = Array.from(new Set(records.flatMap((record) => record?.meta[metric]?.method ? [record.meta[metric].method] : [])));
    return {
      universe: "工作場所位於新北市的本國籍全時受僱員工",
      period: `${availableYears.at(0) ?? "—"}–${latestYear ?? "—"}年全年；114年尚未發布`,
      identity: modeled ? "官方調查統計與官方薪資錨定模型估計並列" : "官方調查統計值",
      method: methods.join("；") || "依原始資料保留缺值",
      source: wageSource.name,
      sourceUrl: wageSource.url,
      availability: `110–113年${ageBandLabel(age)}可發布；114年同口徑資料尚未發布並保留缺值`,
    };
  };
  const latestPolicyWage = latestYear == null ? undefined : getWage(latestYear, youthAge);
  const earliestPolicyWage = availableYears.length ? getWage(availableYears[0], youthAge) : undefined;
  const latestPolicyGap = meanMedianGap({ mean: latestPolicyWage?.metrics["全年總薪資平均數"], median: latestPolicyWage?.metrics["全年總薪資中位數"] });
  const latestPolicyGapShare = meanMedianGapSharePct({ mean: latestPolicyWage?.metrics["全年總薪資平均數"], median: latestPolicyWage?.metrics["全年總薪資中位數"] });
  const firstPolicyGapShare = meanMedianGapSharePct({ mean: earliestPolicyWage?.metrics["全年總薪資平均數"], median: earliestPolicyWage?.metrics["全年總薪資中位數"] });
  const policyMeanCagr = compoundAnnualGrowthRatePct(latestPolicyWage?.metrics["全年總薪資平均數"], earliestPolicyWage?.metrics["全年總薪資平均數"], elapsedYears);
  const policySignal = buildWagePolicySignal({
    ageLabel: ageBandLabel(youthAge),
    selectedYear: dashboardData.meta.defaultYear,
    latestYear,
    latestMean: latestPolicyWage?.metrics["全年總薪資平均數"] ?? null,
    latestMedian: latestPolicyWage?.metrics["全年總薪資中位數"] ?? null,
    latestGap: latestPolicyGap,
    latestGapSharePct: latestPolicyGapShare,
    firstGapSharePct: firstPolicyGapShare,
    meanCagrPct: policyMeanCagr,
    contributionWage: null,
    contributionDifferenceFromNationalPct: null,
    contributionCountyRank: null,
    contributionCountyCount: null,
    identity: latestPolicyWage?.meta["全年總薪資平均數"]?.origin ?? "尚無資料",
    medianIdentity: latestPolicyWage?.meta["全年總薪資中位數"]?.origin ?? "尚無資料",
  });
  return (
    <>
      <section className="annual-analysis-intro section-shell" aria-labelledby="annual-wage-analysis-title">
        <div><p className="kicker">青年薪資全年度比較｜110–113年全年總薪資</p><div className="title-help-row"><h2 id="annual-wage-analysis-title">從薪資水準，讀到分布與成長速度</h2><HelpTip label="薪資頁閱讀順序">先選青年年齡層，再並讀平均數與中位數、兩者差額與方法敏感度，最後查看同行業的薪資估計。114年同口徑青年薪資尚未發布，不以前一年或全年齡資料代填。</HelpTip></div></div>
        <ol><li><span>1</span>確認青年薪資水準</li><li><span>2</span>觀察分布距離</li><li><span>3</span>比較年度成長</li><li><span>4</span>查看行業估計</li></ol>
      </section>
      <section className="wage-page-filter section-shell" aria-labelledby="wage-page-filter-title">
        <div><p className="kicker">本頁共用條件</p><h2 id="wage-page-filter-title">選擇青年年齡層</h2><p>下方摘要、四象限與行業矩陣會同步更新。</p></div>
        <div className="wage-page-filter-controls">
          <label htmlFor="wage-page-age">年齡<select id="wage-page-age" value={youthAge} onChange={(event) => setYouthAge(event.target.value as AgeBand)}>{ageOrder.map((item) => <option key={item} value={item}>{ageBandLabel(item)}</option>)}</select></label>
          <span className="fixed-filter-value"><small>性別</small><strong>男女合計</strong><HelpTip label="薪資性別限制">目前沒有可形成110–113年完整青年年齡×性別薪資序列的公開交叉資料，因此不提供男女性別篩選。</HelpTip></span>
          <span className="fixed-filter-value"><small>母體</small><strong>新北市工作場所</strong></span>
        </div>
      </section>
      <div className="scope-availability-note annual-wage-scope"><strong>工作場所受僱員工母體</strong><span>新北市工作場所・{ageBandLabel(youthAge)}・男女合計</span><span>最新可用：113年；114年尚未發布</span><span>官方值／模型估計依指標標示</span></div>
      <section className="wage-summary section-shell" aria-labelledby="wage-summary-title">
        <div className="section-heading"><div><p className="kicker">{ageBandLabel(youthAge)}｜最新可用年度{latestYear ?? "—"}年</p><div className="title-help-row"><h2 id="wage-summary-title">先用四個數字定位薪資狀況</h2><HelpTip label="薪資摘要公式">差額＝平均數－中位數；偏斜代理值＝差額÷平均數×100。代理值只能描述兩個位置量數的距離，沒有微資料時不能稱為正式偏態係數或所得不均。</HelpTip></div></div></div>
        <div className="wage-summary-kpis">
          <article><span>全年總薪資平均數</span><strong>{latestComparison ? formatNumber(latestComparison.metrics["全年總薪資平均數"], 1) : "—"}<em>萬元／年</em></strong><small>{latestComparison?.meta["全年總薪資平均數"]?.origin ?? "尚無資料"}</small></article>
          <article><span>全年總薪資中位數</span><strong>{latestComparison ? formatNumber(latestComparison.metrics["全年總薪資中位數"], 1) : "—"}<em>萬元／年</em></strong><small>{latestComparison?.meta["全年總薪資中位數"]?.origin ?? "尚無資料"}</small></article>
          <article><span>平均—中位數差額</span><strong>{latestComparisonGap == null ? "—" : formatNumber(latestComparisonGap, 1)}<em>萬元／年</em></strong><small>同年度同年齡帶相減</small></article>
          <article><span>薪資分布偏斜代理值</span><strong>{latestComparisonSkew == null ? "—" : formatNumber(latestComparisonSkew, 1)}<em>%</em></strong><small>不是正式偏態係數</small></article>
        </div>
      </section>
      <section className="annual-quadrant-grid annual-wage-grid" aria-label="新北市工作場所薪資四象限年度分析">
        <article className="annual-quadrant-card quadrant-one"><span className="quadrant-label">平均薪資怎麼變</span><WageDualAxisChart chartId="annual-wage-mean" title={`${ageBandLabel(youthAge)}平均薪資與年增率`} valueLabel="全年總薪資平均數" growthLabel="平均薪資年增率" points={meanLevelGrowthPoints} filters={null} question="整體薪資水準提高時，成長速度是加快、放慢，還是持平？" caveat="工作場所薪資不等於設籍青年所得；名目薪資成長尚未扣除物價。" evidence={{ ...evidenceFor(youthAge, "全年總薪資平均數"), method: `${evidenceFor(youthAge, "全年總薪資平均數").method}；年增率＝（本年平均數－前一年平均數）÷前一年平均數×100` }} /></article>
        <article className="annual-quadrant-card quadrant-two"><span className="quadrant-label">中位薪資怎麼變</span><WageDualAxisChart chartId="annual-wage-median" title={`${ageBandLabel(youthAge)}中位薪資與年增率`} valueLabel="全年總薪資中位數" growthLabel="中位薪資年增率" points={medianLevelGrowthPoints} filters={null} question="排序後位於中間位置的典型薪資，是否穩定向上？" caveat="模型估計中位數不取代微資料加權中位數；名目薪資成長尚未扣除物價。" evidence={{ ...evidenceFor(youthAge, "全年總薪資中位數"), method: `${evidenceFor(youthAge, "全年總薪資中位數").method}；年增率＝（本年中位數－前一年中位數）÷前一年中位數×100` }} /></article>
        <article className="annual-quadrant-card quadrant-three"><span className="quadrant-label">兩者差多少</span><WageGapChart ageBand={youthAge} points={gapPoints} evidence={{ ...evidenceFor(youthAge, "全年總薪資中位數"), method: "差額＝同年度平均數－同年度中位數；差額占平均數＝差額÷平均數×100；平均數與中位數各自年增率＝（本年÷前一年－1）×100；成長速度差＝平均數年增率－中位數年增率" }} /></article>
        <article className="annual-quadrant-card quadrant-four"><span className="quadrant-label">估計範圍在哪裡</span><WageRangeComparisonChart ageBand={youthAge} evidence={{ ...evidenceFor(youthAge, "全年總薪資平均數"), method: `${ageBandLabel(youthAge)}點估計沿用各指標既定換算；方法敏感度帶取替代方法重算的最低值與最高值；平均數與中位數分開呈現` }} /></article>
      </section>
      <StoryBridge index={2} title={`再比較${ageBandLabel(youthAge)}的不同行業薪資`}>看完整體薪資，再看同一年齡層在各行業的全年薪資平均數估計。</StoryBridge>
      <YouthIndustryWageMatrix ageBand={youthAge} />
      {showPolicy && <>
        <StoryBridge index={4} title="最後形成可以查核的政策問題">把薪資水準、分布距離、年齡成長速度與青年行業估計放在一起，政策卡只提出下一步的查核與工具選項，不把相關性寫成因果。</StoryBridge>
        <PolicyDecisionPanel signal={policySignal} evidenceSources={[wageSource.name]} contextLabel={`${latestYear == null ? "尚無最新年度" : `${latestYear}年`}・${ageBandLabel(youthAge)}・男女合計・新北市工作場所`} />
      </>}
    </>
  );
}

function allCoordinates(geometry: Geometry): Position[] {
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  return geometry.coordinates.flat(2);
}

function projectMapPoint([lon, lat]: Position, bounds: { minX: number; minY: number; maxX: number; maxY: number }): Position {
  const width = 720;
  const height = 520;
  const pad = 20;
  const scale = Math.min((width - pad * 2) / (bounds.maxX - bounds.minX), (height - pad * 2) / (bounds.maxY - bounds.minY));
  return [pad + (lon - bounds.minX) * scale, height - pad - (lat - bounds.minY) * scale];
}

function featurePath(feature: DistrictFeature, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  const polygonPath = (polygon: Position[][]) => polygon.map((ring) => ring.map((point, index) => {
    const [px, py] = projectMapPoint(point, bounds);
    return `${index === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(" ") + " Z").join(" ");
  return feature.geometry.type === "Polygon" ? polygonPath(feature.geometry.coordinates) : feature.geometry.coordinates.map(polygonPath).join(" ");
}

const mapMetricLabels: Record<MapMetric, { label: string; unit: string; description: string }> = {
  population: { label: "青年人口數", unit: "人", description: "戶籍青年人口規模" },
  share: { label: "青年人口占比", unit: "%", description: "青年占該區同一性別戶籍人口" },
  density: { label: "青年人口密度", unit: "人／平方公里", description: "戶籍青年人口除以官方公告土地面積" },
  change: { label: "青年人口變動率", unit: "%", description: "展示窗起始年到所選年度" },
};

function policyStateClass(state: PolicySignalState) {
  return state === "已觸發" ? "is-triggered" : state === "持續觀察" ? "is-watch" : state === "目前未觸發" ? "is-clear" : "is-unknown";
}

function signedPct(value: number | null) {
  if (value == null) return "尚無比較值";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value, 2)}%`;
}

function signedPoints(value: number | null) {
  if (value == null) return "尚無前期比較";
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized > 0 ? "+" : ""}${formatNumber(normalized, 2)}個百分點`;
}

function RankMovementBadge({ metric }: { metric: DistrictRankingMetric }) {
  const { movement } = metric;
  if (movement.direction === "unavailable") return <small className="rank-movement unavailable" title={movement.reason}>— {movement.reason ?? "無前期資料"}</small>;
  if (movement.direction === "same") return <small className="rank-movement same">→ 與去年持平</small>;
  return <small className={`rank-movement ${movement.direction}`} aria-label={movement.label}>{movement.direction === "up" ? "↑" : "↓"}{movement.places}名</small>;
}

function AnnualDistrictDashboard({
  selected,
  onSelect,
  registeredSource,
  educationSource,
  marriageSource,
  onFilterApply,
}: {
  selected: string;
  onSelect: (name: string) => void;
  registeredSource: { name: string; url: string };
  educationSource: { name: string; url: string };
  marriageSource: { name: string; url: string };
  onFilterApply: (year: number, ageBand: AgeBand, sex: Sex) => void;
}) {
  const [draftYear, setDraftYear] = useState(dashboardData.meta.defaultYear);
  const [draftAgeBand, setDraftAgeBand] = useState<AgeBand>(dashboardData.meta.defaultAgeBand);
  const [draftSex, setDraftSex] = useState<Sex>(dashboardData.meta.defaultSex);
  const [applied, setApplied] = useState({ year: dashboardData.meta.defaultYear, ageBand: dashboardData.meta.defaultAgeBand, sex: dashboardData.meta.defaultSex });
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [filterNotice, setFilterNotice] = useState(`${dashboardData.meta.defaultYear}年・${ageBandLabel(dashboardData.meta.defaultAgeBand)}・${dashboardData.meta.defaultSex}`);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/ntpc-districts.geojson", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("行政區地圖載入失敗");
        return await response.json() as FeatureCollection;
      })
      .then(setGeojson)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError("行政區地圖暫時無法載入，請使用下方29區資料表選取行政區。");
      });
    return () => controller.abort();
  }, []);

  const districtRecords = useMemo(() => dashboardData.registered.filter((row) => (
    row.year === applied.year
    && row.geography !== "新北市"
    && row.ageBand === applied.ageBand
    && row.sex === applied.sex
  )), [applied]);
  const recordMap = useMemo(() => new Map(districtRecords.map((record) => [geographyLabel(record.geography), record])), [districtRecords]);
  const pooledValues = useMemo(() => dashboardData.registered.filter((row) => (
    row.geography !== "新北市" && row.ageBand === applied.ageBand && row.sex === applied.sex
  )).map((row) => row.population), [applied.ageBand, applied.sex]);
  const colorDomain = numericDomain(pooledValues);
  const fillFor = (name: string) => {
    const value = recordMap.get(name)?.population;
    return value == null ? "#E5E9EC" : interpolateGradientColor(value, colorDomain.min, colorDomain.max, sequentialGradientColors);
  };
  const features = useMemo(() => geojson?.features.filter((feature) => feature.properties.TOWNNAME !== "全區") ?? [], [geojson]);
  const bounds = useMemo(() => {
    const coordinates = features.flatMap((feature) => allCoordinates(feature.geometry));
    return coordinates.length ? {
      minX: Math.min(...coordinates.map(([lon]) => lon)),
      minY: Math.min(...coordinates.map(([, lat]) => lat)),
      maxX: Math.max(...coordinates.map(([lon]) => lon)),
      maxY: Math.max(...coordinates.map(([, lat]) => lat)),
    } : null;
  }, [features]);
  const rankedPopulation = [...districtRecords].sort((a, b) => b.population - a.population);
  const hoveredRecord = hovered ? recordMap.get(hovered) : undefined;
  const hoveredRank = hovered ? rankedPopulation.findIndex((row) => geographyLabel(row.geography) === hovered) + 1 : null;
  const rankingMetrics = useMemo(() => selected === "新北市" ? [] : buildDistrictRankings(applied.year, applied.ageBand, applied.sex, selected), [applied.year, applied.ageBand, applied.sex, selected]);
  const hasPendingFilters = draftYear !== applied.year || draftAgeBand !== applied.ageBand || draftSex !== applied.sex;
  const selectDistrict = (name: string) => { setHovered(null); onSelect(name); };
  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    const next = { year: draftYear, ageBand: draftAgeBand, sex: draftSex };
    setApplied(next);
    onFilterApply(draftYear, draftAgeBand, draftSex);
    setFilterNotice(`${draftYear}年・${ageBandLabel(draftAgeBand)}・${draftSex}，地圖已重新著色`);
  };
  const handleKey = (event: KeyboardEvent<SVGPathElement>, name: string) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectDistrict(name); }
  };
  const legendMid = (colorDomain.min + colorDomain.max) / 2;

  return <>
    <section className="annual-district-explorer section-shell" aria-labelledby="annual-district-map-title">
      <div className="section-heading">
        <div><p className="kicker">29行政區｜最新預設{dashboardData.meta.defaultYear}年</p><div className="title-help-row"><h2 id="annual-district-map-title">先用地圖找出要查看的行政區</h2><HelpTip label="年度行政區地圖說明"><p>地圖一律以所選條件的戶籍人口數著色，並以110至114年共同範圍固定色階。</p><p>紅色只代表人口數較高，不代表政策風險。</p><p>篩選條件按下「套用並重新著色」後才會更新，避免選單操作中途反覆閃動。</p></HelpTip></div></div>
        <span className="official-badge">官方行政精確值</span>
      </div>
      <form className="annual-map-filters" onSubmit={applyFilters}>
        <label>年度<select value={draftYear} onChange={(event) => setDraftYear(Number(event.target.value))}>{dashboardData.meta.years.map((item) => <option key={item} value={item}>{item}年</option>)}</select></label>
        <label>年齡<select value={draftAgeBand} onChange={(event) => setDraftAgeBand(event.target.value as AgeBand)}>{dashboardData.meta.ageBands.map((item) => <option key={item} value={item}>{ageBandLabel(item)}</option>)}</select></label>
        <label>性別<select value={draftSex} onChange={(event) => setDraftSex(event.target.value as Sex)}>{dashboardData.meta.sexes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <button type="submit" className="primary-button">套用並重新著色</button>
      </form>
      <p className="applied-map-context" aria-live="polite"><span>目前地圖</span><strong>{filterNotice}</strong><em>接著請選一個行政區查看排名與五年分析。</em></p>
      {hasPendingFilters && <p role="status" className="filter-pending-note">已修改篩選條件，請按「套用並重新著色」同步更新地圖與下方排名。</p>}
      <DataReadingSummary facts={categoryFacts(districtRecords.map((row) => ({ label: geographyLabel(row.geography), value: row.population })), `${applied.year}年・${ageBandLabel(applied.ageBand)}・${applied.sex}`, "人", 0)} identity="官方行政精確值" />
      <div className={`annual-map-hover-summary${hovered ? " is-visible" : ""}`} aria-live="polite" aria-hidden={!hovered}>
        <strong>{hovered ?? "行政區"}</strong>
        <span>{applied.year}年・{ageBandLabel(applied.ageBand)}・{applied.sex}</span>
        <b>{hoveredRecord ? `${formatNumber(hoveredRecord.population)}人` : hovered ? "尚無資料" : "000,000人"}</b>
        <small>{hoveredRank ? `戶籍人口第${hoveredRank}名／29區` : hovered ? "尚無排名" : "戶籍人口第00名／29區"}</small>
      </div>
      <div className="annual-district-map-canvas">
        {loadError && <p role="alert" className="error-message">{loadError}</p>}
        {!geojson && !loadError && <div className="map-skeleton" aria-label="行政區地圖載入中" />}
        {geojson && bounds && <svg viewBox="0 0 720 520" role="group" aria-label={`${applied.year}年${ageBandLabel(applied.ageBand)}${applied.sex}29區戶籍人口熱度圖`}>
          {features.map((feature) => {
            const name = feature.properties.TOWNNAME;
            const record = recordMap.get(name);
            return <path key={name} d={featurePath(feature, bounds)} fill={fillFor(name)} fillRule="evenodd" className={`annual-map-district${selected === name ? " selected" : ""}${hovered === name ? " hovered" : ""}`} tabIndex={0} role="button" aria-label={`${name}，${record ? `${formatNumber(record.population)}人` : "尚無資料"}，按Enter查看`} onMouseEnter={() => setHovered(name)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(name)} onBlur={() => setHovered(null)} onClick={() => selectDistrict(name)} onKeyDown={(event) => handleKey(event, name)}><title>{name}：{record ? `${formatNumber(record.population)}人` : "尚無資料"}</title></path>;
          })}
        </svg>}
      </div>
      <div className="annual-map-legend" aria-label="戶籍人口數連續漸層圖例">
        <div><strong>戶籍人口數</strong><span>低至高</span></div>
        <i style={{ background: `linear-gradient(90deg, ${sequentialGradientColors.join(", ")})` }} />
        <div><span>{formatNumber(colorDomain.min)}人</span><span>{formatNumber(legendMid)}人</span><span>{formatNumber(colorDomain.max)}人</span></div>
        <small>固定色階：110–114年共同範圍。紅色只表示人口數較高。</small>
      </div>
      <details className="data-table-details"><summary>使用29區資料表選取</summary><div className="table-scroll"><table><thead><tr><th>本年排名</th><th>行政區</th><th>戶籍人口</th><th>人口密度</th><th>青年占比</th></tr></thead><tbody>{rankedPopulation.map((row, index) => { const name = geographyLabel(row.geography); return <tr key={row.geography}><td>第{index + 1}名</td><td><button type="button" className="table-district-button" onClick={() => selectDistrict(name)}>{name}</button></td><td>{formatNumber(row.population)}人</td><td>{formatNumber(row.populationDensityPerKm2, 2)}人／平方公里</td><td>{formatPct(row.populationSharePct)}</td></tr>; })}</tbody></table></div></details>
      <EvidenceDetails evidence={{ universe: "戶籍登記現住人口", period: `${applied.year}年12月31日`, identity: "官方行政精確值", method: "各行政區單一年齡戶籍人口依所選年齡及性別直接加總；連續色階以同條件110–114年共同最小值與最大值固定換算", source: registeredSource.name, sourceUrl: registeredSource.url }} />
    </section>

    {selected === "新北市" ? <section className="district-selection-prompt section-shell" aria-live="polite"><strong>請先選擇一個行政區</strong><p>選取後會先顯示七項29區排名，再開啟該區四象限年度分析與教育×婚姻交叉比較。</p></section> : <>
      <section className="district-ranking-board section-shell" aria-labelledby="district-ranking-title" data-ranking-context={`${applied.year}|${applied.ageBand}|${applied.sex}|${selected}`}>
        <div className="section-heading"><div><p className="kicker">{applied.year}年度・{ageBandLabel(applied.ageBand)}・{applied.sex}</p><div className="title-help-row"><h2 id="district-ranking-title">{selected}在29區中的相對位置</h2><HelpTip label="行政區排名規則"><p>排名皆由高至低；同值採競賽排名，因此可能並列且跳號。</p><p>紅色上箭頭代表名次數字變小、排名上升；綠色下箭頭代表排名下降，不代表政策好壞。</p><p>110年人口變化率可用109年人口作基期，但要比較其排名升降仍需要108年；婚姻缺109年同口徑估計；據點僅有115年快照。</p></HelpTip></div></div><button type="button" className="secondary-button" onClick={() => onSelect("新北市")}>重新選區</button></div>
        <div className="district-ranking-grid">{rankingMetrics.map((metric) => <article key={metric.key}><span>{metric.label}</span><div><strong>{metric.rank == null ? "—" : metric.rank}<em>/29</em></strong><RankMovementBadge metric={metric} /></div><p>{metric.valueLabel}</p><small>{metric.evidenceIdentity}</small>{metric.periodNote && <small className="rank-period-note">{metric.periodNote}</small>}</article>)}</div>
        <details className="data-table-details"><summary>排名與年度變化率怎麼算？</summary><p>年度變化率＝（本年度戶籍人口÷前一年度戶籍人口－1）×100；排名升降＝前一年度名次－本年度名次。排名描述相對位置，不等於政策績效。</p></details>
      </section>
      <StoryBridge index={2} title={`接著看${selected}五年間的變化`}>先看人口數與占比，再比較教育程度與婚姻狀態；每張圖都可切換年齡與性別。</StoryBridge>
      <AllYearRegisteredDashboard registeredSource={registeredSource} educationSource={educationSource} marriageSource={marriageSource} geography={selected} />
    </>}
  </>;
}

function PolicyDistrictMap({
  records,
  selected,
  onSelect,
  year,
  ageBand,
  sex,
}: {
  records: RegisteredRecord[];
  selected: string;
  onSelect: (name: string) => void;
  year: number;
  ageBand: AgeBand;
  sex: Sex;
}) {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredFacility, setHoveredFacility] = useState<ServiceFacility | null>(null);
  const [activeTrendPoint, setActiveTrendPoint] = useState<{ year: number; value: number; x: number; y: number } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [metric, setMetric] = useState<MapMetric>("population");
  const [facilityLayerOn, setFacilityLayerOn] = useState(true);
  const baseYear = dashboardData.meta.years[0];
  useEffect(() => {
    fetch("/data/ntpc-districts.geojson")
      .then(async (response) => {
        if (!response.ok) throw new Error("行政區地圖載入失敗");
        return await response.json() as FeatureCollection;
      })
      .then((value) => setGeojson(value))
      .catch(() => setLoadError("行政區地圖暫時無法載入，請使用下方行政區資料表。"));
  }, []);

  const recordMap = useMemo(() => new Map(records.map((record) => [geographyLabel(record.geography), record])), [records]);
  const features = useMemo(() => geojson?.features.filter((feature) => feature.properties.TOWNNAME !== "全區") ?? [], [geojson]);
  const bounds = useMemo(() => {
    const coordinates = features.flatMap((feature) => allCoordinates(feature.geometry));
    return coordinates.length ? {
      minX: Math.min(...coordinates.map(([lon]) => lon)),
      minY: Math.min(...coordinates.map(([, lat]) => lat)),
      maxX: Math.max(...coordinates.map(([lon]) => lon)),
      maxY: Math.max(...coordinates.map(([, lat]) => lat)),
    } : null;
  }, [features]);

  const pooledRecords = useMemo(() => dashboardData.registered.filter((row) => (
    row.geography !== "新北市" && row.ageBand === ageBand && row.sex === sex
  )), [ageBand, sex]);
  const pooledSequentialValues = pooledRecords.map((record) => metric === "share"
    ? record.populationSharePct
    : metric === "density"
      ? record.populationDensityPerKm2
      : record.population);
  const rawSequentialDomain = numericDomain(pooledSequentialValues);
  const fixedSequentialDomain = metric === "share"
    ? { min: 0, max: roundUpToTen(rawSequentialDomain.max) }
    : rawSequentialDomain;
  const pooledChangeValues = pooledRecords
    .filter((record) => record.year > baseYear)
    .map((record) => percentChange(record.population, getRegistered(baseYear, geographyLabel(record.geography), ageBand, sex)?.population))
    .filter((value): value is number => value != null);
  const fixedChangeMaximum = symmetricDomain(pooledChangeValues);

  const metricValue = (record?: RegisteredRecord) => {
    if (!record) return null;
    if (metric === "population") return record.population;
    if (metric === "share") return record.populationSharePct;
    if (metric === "density") return record.populationDensityPerKm2;
    if (metric === "change") return percentChange(record.population, getRegistered(baseYear, geographyLabel(record.geography), ageBand, sex)?.population);
    return null;
  };
  const fillFor = (name: string) => {
    const value = metricValue(recordMap.get(name));
    if (value == null) return "#E5E9EC";
    if (metric === "change") return interpolateGradientColor(value, -fixedChangeMaximum, fixedChangeMaximum, divergingGradientColors);
    return interpolateGradientColor(value, fixedSequentialDomain.min, fixedSequentialDomain.max, sequentialGradientColors);
  };
  const valueLabel = (value: number | null) => value == null
    ? "尚無資料"
    : metric === "population"
      ? `${formatNumber(value)}人`
      : metric === "density"
        ? `${formatNumber(value, 2)}人／平方公里`
        : `${formatNumber(value, 2)}%`;

  const choose = (name: string) => { setHovered(null); onSelect(name); };
  const handleKey = (event: KeyboardEvent<SVGPathElement>, name: string) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(name); }
  };
  const ranked = [...records].sort((a, b) => b.population - a.population);
  const hoverName = hovered ?? (selected === "新北市" ? null : selected);
  const hoverRecord = hoverName ? recordMap.get(hoverName) : undefined;
  const hoverRank = hoverName ? ranked.findIndex((record) => geographyLabel(record.geography) === hoverName) + 1 : null;
  const hoverPrevious = hoverName ? getRegistered(year - 1, hoverName, ageBand, sex) : undefined;
  const hoverBase = hoverName ? getRegistered(baseYear, hoverName, ageBand, sex) : undefined;
  const hoverYearChange = percentChange(hoverRecord?.population, hoverPrevious?.population);
  const hoverWindowChange = percentChange(hoverRecord?.population, hoverBase?.population);
  const hoverFacilities = hoverName ? getServiceFacilities(hoverName) : [];
  const mappedFacilities = dashboardData.service.facilities.filter((facility) => (
    facility.latitude != null
    && facility.longitude != null
    && Number.isFinite(facility.latitude)
    && Number.isFinite(facility.longitude)
    && (facility.coordinateQaStatus === "VERIFIED_OFFICIAL" || facility.coordinateQaStatus === "VERIFIED_ADDRESS")
  ));

  const selectedRecord = selected === "新北市" ? undefined : recordMap.get(selected);
  const selectedRank = selectedRecord ? ranked.findIndex((record) => geographyLabel(record.geography) === selected) + 1 : null;
  const selectedPrevious = selectedRecord ? getRegistered(year - 1, selected, ageBand, sex) : undefined;
  const selectedBase = selectedRecord ? getRegistered(baseYear, selected, ageBand, sex) : undefined;
  const selectedYearChange = percentChange(selectedRecord?.population, selectedPrevious?.population);
  const selectedWindowChange = percentChange(selectedRecord?.population, selectedBase?.population);
  const selectedFacilities = selected === "新北市" ? [] : getServiceFacilities(selected);
  const selectedActiveFacilities = selectedFacilities.filter((facility) => facility.active);
  const cityRecord = getRegistered(year, "新北市", ageBand, sex);
  const selectedPolicyEvidence = selected === "新北市" ? null : getDistrictPolicyEvidence(year, selected, ageBand, sex);
  const districtSignal = buildDistrictPolicySignal({
    district: selected,
    ageLabel: ageBandLabel(ageBand),
    population: selectedPolicyEvidence?.population ?? null,
    rank: selectedPolicyEvidence?.populationRank ?? null,
    districtCount: selectedPolicyEvidence?.districtCount ?? ranked.length,
    sharePct: selectedPolicyEvidence?.sharePct ?? null,
    citySharePct: selectedPolicyEvidence?.citySharePct ?? null,
    yearChangePct: selectedPolicyEvidence?.yearChangePct ?? null,
    windowChangePct: selectedPolicyEvidence?.windowChangePct ?? null,
    windowPopulationChange: selectedPolicyEvidence?.windowPopulationChange,
    windowStartYear: selectedPolicyEvidence?.windowStartYear,
    windowEndYear: selectedPolicyEvidence?.windowEndYear,
    growthRank: selectedPolicyEvidence?.growthRank,
    growingDistrictCount: selectedPolicyEvidence?.growingDistrictCount,
    positiveAnnualIntervals: selectedPolicyEvidence?.positiveAnnualIntervals,
    annualIntervalCount: selectedPolicyEvidence?.annualIntervalCount,
    educationLowerPct: selectedPolicyEvidence?.educationLowerPct,
    cityEducationLowerPct: selectedPolicyEvidence?.cityEducationLowerPct,
    educationConservativeGapPct: selectedPolicyEvidence?.educationConservativeGapPct,
    educationDifferenceRank: selectedPolicyEvidence?.educationDifferenceRank,
    marriedPct: selectedPolicyEvidence?.marriedPct,
    cityMarriedPct: selectedPolicyEvidence?.cityMarriedPct,
    marriageConservativeGapPct: selectedPolicyEvidence?.marriageConservativeGapPct,
    marriageDifferenceRank: selectedPolicyEvidence?.marriageDifferenceRank,
    maleSharePct: selectedPolicyEvidence?.maleSharePct,
    cityMaleSharePct: selectedPolicyEvidence?.cityMaleSharePct,
    genderDifferenceRank: selectedPolicyEvidence?.genderDifferenceRank,
    demographicEstimated: selectedPolicyEvidence?.demographicEstimated,
    serviceSiteCount: selectedPolicyEvidence?.serviceSiteCount,
    activeServiceSiteCount: selectedPolicyEvidence?.activeServiceSiteCount,
    districtExposureIntensity: null,
  });
  const showServicePolicyEvidence = districtSignal.evidenceDomains.includes("青年據點");
  const districtDisplayState = leaderState(districtSignal.state);
  const ageStructure = (["18-24", "25-29", "30-35"] as AgeBand[]).map((band) => ({
    band,
    value: selectedRecord ? getRegistered(year, selected, band, sex)?.population ?? null : null,
  }));
  const ageTotal = ageStructure.reduce((sum, item) => sum + (item.value ?? 0), 0);
  const trend = dashboardData.meta.years.map((trendYear) => getRegistered(trendYear, selected, ageBand, sex)?.population ?? null);
  const trendMax = roundedCountCeiling(Math.max(1, ...pooledRecords.map((record) => record.population)));
  const miniTrendY = (value: number) => 92 - (value / trendMax) * 68;
  const trendPath = trend.map((value, index) => value == null ? null : `${index === 0 ? "M" : "L"}${42 + index * 64},${miniTrendY(value)}`).filter(Boolean).join(" ");

  const sequentialMidpoint = (fixedSequentialDomain.min + fixedSequentialDomain.max) / 2;
  const legendTicks = metric === "change"
    ? [valueLabel(-fixedChangeMaximum), valueLabel(0), valueLabel(fixedChangeMaximum)]
    : [valueLabel(fixedSequentialDomain.min), valueLabel(sequentialMidpoint), valueLabel(fixedSequentialDomain.max)];
  const legendGradient = `linear-gradient(90deg, ${(metric === "change" ? divergingGradientColors : sequentialGradientColors).join(", ")})`;

  return (
    <section className="map-card policy-map" aria-labelledby="district-map-title">
      <div className="section-heading map-heading">
        <div><p className="kicker">新北市29區｜戶籍人口母體</p><div className="title-help-row"><h2 id="district-map-title">行政區青年人口與變動</h2><HelpTip label="行政區地圖判讀限制">紅色只代表數值較高，不代表政策風險；服務不足必須另有行政區參與人次、活動場次、據點及量能證據才能判定。</HelpTip></div></div>
        <button type="button" className="secondary-button" onClick={() => choose("新北市")}>清除行政區選取</button>
      </div>
      <div className="map-mode-switch" aria-label="地圖指標模式">
        {(["population", "share", "density", "change"] as MapMetric[]).map((item) => <button
          key={item}
          type="button"
          aria-pressed={metric === item}
          title={mapMetricLabels[item].description}
          onClick={() => setMetric(item)}
        ><span>{mapMetricLabels[item].label}</span><small>{mapMetricLabels[item].unit}</small></button>)}
      </div>
      <div className="map-layer-row">
        <label className="layer-toggle"><input type="checkbox" checked={facilityLayerOn} onChange={(event) => setFacilityLayerOn(event.target.checked)} /><span>青年服務據點圖層</span><small>{mappedFacilities.length ? `${mappedFacilities.length}處具可查核座標` : "目前沒有可查核經緯度"}</small></label>
        <HelpTip label="據點座標顯示規則" align="end">只有官方或已完成地址查核的絕對經緯度才畫點；行政區清冊數量仍保留於資訊卡。</HelpTip>
      </div>
      <div className="map-layout policy-map-layout">
        <div className="map-visual">
          {loadError && <p role="alert" className="error-message">{loadError}</p>}
          {!geojson && !loadError && <div className="map-skeleton" aria-label="行政區地圖載入中" />}
          {geojson && bounds && (
            <svg viewBox="0 0 720 520" role="group" aria-label={`新北市29區${mapMetricLabels[metric].label}地圖`}>
              {features.map((feature) => {
                const name = feature.properties.TOWNNAME;
                const value = metricValue(recordMap.get(name));
                const classes = ["district", selected === name ? "selected" : "", hovered === name ? "hovered" : ""].filter(Boolean).join(" ");
                return <path key={name} d={featurePath(feature, bounds)} className={classes} fill={fillFor(name)} fillRule="evenodd" tabIndex={0} role="button" aria-label={`${name}，${mapMetricLabels[metric].label}${valueLabel(value)}，按Enter查看`} onMouseEnter={() => setHovered(name)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(name)} onBlur={() => setHovered(null)} onClick={() => choose(name)} onKeyDown={(event) => handleKey(event, name)}><title>{name}：{valueLabel(value)}</title></path>;
              })}
              {facilityLayerOn && mappedFacilities.map((facility) => {
                const [cx, cy] = projectMapPoint([facility.longitude as number, facility.latitude as number], bounds);
                return <g key={facility.facilityCode} className="facility-map-marker" transform={`translate(${cx} ${cy})`} tabIndex={0} role="button" aria-label={`${facility.name}，${facility.district}，${facility.active ? "營運中" : "暫停開放"}`} onMouseEnter={() => setHoveredFacility(facility)} onMouseLeave={() => setHoveredFacility(null)} onFocus={() => setHoveredFacility(facility)} onBlur={() => setHoveredFacility(null)} onClick={() => choose(facility.district)}><circle r="10" /><circle r="4" /><title>{facility.name}｜{facility.address}</title></g>;
              })}
            </svg>
          )}
          {facilityLayerOn && mappedFacilities.length === 0 && <p className="map-coordinate-note">據點清冊已有地址，但官方頁面未提供可直接查核的經緯度；本版不以地址推測座標。</p>}
          {hoveredFacility && <div className="facility-map-card" role="status"><strong>{hoveredFacility.name}</strong><span>{hoveredFacility.district}・{hoveredFacility.active ? "營運中" : "暫停開放"}</span><p>{hoveredFacility.address}</p><small>{hoveredFacility.coordinateSource}</small></div>}
          <div className={`map-quick-card ${hoverName ? "is-visible" : ""}`} aria-live="polite">
            {hoverName && <><div><strong>{hoverName}</strong><span>{year}年・{ageBandLabel(ageBand)}・{sex}</span></div><dl><div><dt>青年人口</dt><dd>{hoverRecord ? `${formatNumber(hoverRecord.population)}人` : "尚無資料"}</dd></div><div><dt>全市排名</dt><dd>{hoverRank ? `第${hoverRank}名／29區` : "—"}</dd></div><div><dt>青年占比</dt><dd>{formatPct(hoverRecord?.populationSharePct)}</dd></div><div><dt>人口密度</dt><dd>{hoverRecord ? `${formatNumber(hoverRecord.populationDensityPerKm2, 2)}人／平方公里` : "尚無資料"}</dd></div><div><dt>服務據點</dt><dd>{hoverFacilities.length}處（營運中{hoverFacilities.filter((facility) => facility.active).length}處）</dd></div><div><dt>年增率</dt><dd>{signedPct(hoverYearChange)}</dd></div><div><dt>{baseYear}→{year}變動</dt><dd>{signedPct(hoverWindowChange)}</dd></div></dl><p><span>人口與面積為官方行政值；據點為官方頁面清冊</span><time>{formatGeneratedAt(dashboardData.meta.generatedAt)}</time></p></>}
          </div>
          <div className="continuous-map-legend" aria-label={`${mapMetricLabels[metric].label}連續漸層圖例`}>
            <div><strong>{mapMetricLabels[metric].label}</strong><span>{metric === "change" ? `${baseYear}年至${year}年方向` : "連續漸層｜低至高"}</span></div>
            <i className="continuous-map-gradient" style={{ background: legendGradient }} aria-hidden="true" />
            <div className="continuous-map-ticks">{legendTicks.map((tick) => <span key={tick}>{tick}</span>)}</div>
            <p>{metric === "change" ? "藍色表示減少、接近白色表示接近零、紅色表示增加；方向不代表政策好壞。" : "藍→黃→橘→紅依數值連續換算；紅色只代表數值較高，不等於政策風險。"}</p>
            <small>色階固定使用110–114年共同範圍，切換年度不重算；精確值請查看上方資訊列或29區資料表。</small>
          </div>
        </div>
        <aside className="district-insight-panel" aria-live="polite">
          {!selectedRecord ? <div className="district-panel-empty"><span>行政區分析</span><strong>請選取一個行政區</strong><p>點擊地圖或下方排行後，這裡會固定保留五年趨勢、年齡結構、政策訊號與資料限制。</p></div> : <>
            <div className="district-panel-title"><div><span>{year}年行政區分析</span><h3>{selected}</h3></div><span className={`policy-state ${policyStateClass(districtSignal.state)}`}><i aria-hidden="true">{districtDisplayState.icon}</i>{districtDisplayState.label}</span></div>
            <div className="district-headline"><strong>{formatNumber(selectedRecord.population)}<em>人</em></strong><p>全市第{selectedRank}名｜占該區人口{formatPct(selectedRecord.populationSharePct)}</p></div>
            <section className="mini-trend" onMouseLeave={() => setActiveTrendPoint(null)}><div><div className="title-help-row"><h4>五年人口趨勢</h4><HelpTip label="五年趨勢座標尺度">同一個年齡與性別條件下，Y軸固定使用29區五年共同上限。</HelpTip></div><span>{signedPct(selectedWindowChange)}</span></div><div className="mini-trend-canvas"><svg viewBox="0 0 320 126" role="img" aria-label={`${selected}${ageBandLabel(ageBand)}五年人口趨勢，Y軸0至${formatNumber(trendMax)}人`}><line x1="42" x2="298" y1="24" y2="24" className="grid-line" /><line x1="42" x2="298" y1="58" y2="58" className="grid-line" /><line x1="42" x2="298" y1="92" y2="92" className="axis-line" /><text x="36" y="28" textAnchor="end">{formatNumber(trendMax)}</text><text x="36" y="62" textAnchor="end">{formatNumber(trendMax / 2)}</text><text x="36" y="96" textAnchor="end">0</text><path d={trendPath} fill="none" stroke="#0F766E" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />{trend.map((value, index) => { if (value == null) return null; const px = 42 + index * 64; const py = miniTrendY(value); const trendYear = dashboardData.meta.years[index]; return <g key={trendYear}><circle cx={px} cy={py} r="6" fill="white" stroke="#0F766E" strokeWidth="3" tabIndex={0} role="button" aria-label={`${trendYear}年${formatNumber(value)}人`} onMouseEnter={() => setActiveTrendPoint({ year: trendYear, value, x: px, y: py })} onFocus={() => setActiveTrendPoint({ year: trendYear, value, x: px, y: py })} onBlur={() => setActiveTrendPoint(null)}><title>{trendYear}年：{formatNumber(value)}人</title></circle><text x={px} y="118" textAnchor="middle">{trendYear}</text></g>; })}</svg>{activeTrendPoint && <div className="mini-point-tooltip" style={{ left: `${activeTrendPoint.x / 320 * 100}%`, top: `${activeTrendPoint.y / 126 * 100}%` }}><strong>{activeTrendPoint.year}年</strong><span>{formatNumber(activeTrendPoint.value)}人</span></div>}</div></section>
            <section className="age-structure"><h4>三個青年年齡層</h4>{ageStructure.map((item) => <div key={item.band}><span>{ageBandLabel(item.band)}</span><i><b style={{ width: `${ageTotal ? (item.value ?? 0) / ageTotal * 100 : 0}%` }} /></i><strong>{item.value == null ? "—" : `${formatNumber(item.value)}人`}</strong></div>)}</section>
            <dl className="district-comparison"><div><dt>相較全市占比</dt><dd>{selectedRecord.populationSharePct >= (cityRecord?.populationSharePct ?? 0) ? "高於或等於" : "低於"}全市{formatPct(cityRecord?.populationSharePct)}</dd></div><div><dt>前一年變動</dt><dd>{signedPct(selectedYearChange)}</dd></div></dl>
            {showServicePolicyEvidence && <section className="district-service-evidence" aria-labelledby="district-service-title">
              <div><div className="title-help-row"><h4 id="district-service-title">服務據點與量能脈絡</h4><HelpTip label="據點與量能資料範圍">據點為官方頁面快照；沒有分區活動場次與參與人次時，不推論行政區服務不足。</HelpTip></div><span>據點快照：{dashboardData.service.snapshotYear}年</span></div>
              <dl><div><dt>公告土地面積</dt><dd>{formatNumber(selectedRecord.landAreaKm2, 2)}平方公里</dd></div><div><dt>青年人口密度</dt><dd>{formatNumber(selectedRecord.populationDensityPerKm2, 2)}人／平方公里</dd></div><div><dt>列管據點</dt><dd>{selectedFacilities.length}處</dd></div><div><dt>目前營運</dt><dd>{selectedActiveFacilities.length}處</dd></div></dl>
              {selectedFacilities.length ? <ul className="facility-list">{selectedFacilities.map((facility) => <li key={facility.facilityCode}><div><strong>{facility.name}</strong><span className={facility.active ? "facility-status active" : "facility-status paused"}>{facility.active ? "營運中" : "暫停開放"}</span></div><p>{facility.address}</p><small>{facility.capacitySummary || "官方頁面未提供統一量能數值"}</small><a href={facility.sourceUrl}>查看官方據點頁面</a></li>)}</ul> : <p className="no-facility-note">目前官方青年服務據點清冊未列本區據點；這不代表本區沒有其他局處、巡迴或線上服務。</p>}
              <div className="exposure-context-note"><strong>行政區每場平均服務人次：尚無分區值</strong><p>全市年度人次與場次可計算每場平均服務人次，但官方年報未提供行政區交叉，不能把全市人次依人口比例拆到各區。</p></div>
            </section>}
            <section className="district-policy-signal" aria-label={`${selected}政策分析`}>
              <header className="district-policy-result-heading"><div><span>政策結果</span><h4>{districtSignal.recommendedAction}</h4>{districtSignal.evidenceDomains.length > 0 && <ul className="policy-domain-list" aria-label="本次政策建議使用的資料面向">{districtSignal.evidenceDomains.map((item) => <li key={item}>{item}</li>)}</ul>}</div><HelpTip label={`${selected}政策建議如何產生`} align="end"><p><strong>觸發規則：</strong>{districtSignal.rule}</p><p><strong>本次使用面向：</strong>{districtSignal.evidenceDomains.length ? districtSignal.evidenceDomains.join("、") : "目前沒有面向達到初篩門檻"}。</p><p><strong>資料身分：</strong>人口與男女為官方行政值；行政區教育與婚姻為PCLM、IPF校準推估。</p><p><strong>使用定位：</strong>這是需求查核與方案盤點的排序建議，不是自動核定政策。</p></HelpTip></header>
              <dl className="policy-summary-list district-policy-summary" aria-label={`${selected}政策判讀重點`}>
                <div><dt>資料訊號</dt><dd><ul>{districtSignal.actionBasis.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></dd></div>
                <div><dt>可選政策工具</dt><dd><ol>{districtSignal.policyTools.slice(0, 2).map((item) => <li key={item}>{item}</li>)}</ol></dd></div>
                <div><dt>建議主責／協辦</dt><dd>{districtSignal.agencies}</dd></div>
                <div><dt>後續監測指標</dt><dd><ul>{districtSignal.monitoring.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></dd></div>
              </dl>
              <div className="policy-evidence-accordion district-policy-accordion" aria-label={`${selected}政策詳細資訊`}>
                <details><summary><span>完整證據與判讀</span><small>查看所有支持數據與可判讀範圍</small></summary><div><ul>{districtSignal.actionBasis.map((item) => <li key={item}>{item}</li>)}</ul><p><strong>可以判讀：</strong>{districtSignal.supportedInterpretation}</p></div></details>
                <details><summary><span>限制與送交決策條件</span><small>查看不能推論與資料缺口</small></summary><div className="policy-limit-section"><p><strong>不能直接下的結論：</strong>{districtSignal.unsupportedConclusion}</p><p><strong>送交決策前：</strong>{districtSignal.decisionGate}</p><ul>{districtSignal.missingData.map((item) => <li key={item}>{item}</li>)}</ul></div></details>
              </div>
            </section>
            {showServicePolicyEvidence && <div className="coverage-missing"><strong>設點建議仍須補充服務證據</strong><p>{districtSignal.missingData.join("、")}仍須人工查核，因此本頁只建議辦理可行性評估，不直接判定服務不足。</p></div>}
            <a className="secondary-button district-full-link" href="?view=registered" onClick={(event) => { event.preventDefault(); window.history.pushState({ view: "registered" }, "", "?view=registered"); window.dispatchEvent(new PopStateEvent("popstate")); }}>查看行政區完整分析</a>
          </>}
        </aside>
      </div>
      <details className="data-table-details map-data-table"><summary>查看29區完整資料表</summary><div className="table-scroll"><table><thead><tr><th>排名</th><th>行政區</th><th>青年人口</th><th>青年占比</th><th>青年人口密度</th><th>服務據點</th><th>前一年變動</th><th>{baseYear}→{year}變動</th></tr></thead><tbody>{ranked.map((record, index) => { const name = geographyLabel(record.geography); const previous = getRegistered(year - 1, name, ageBand, sex); const baseline = getRegistered(baseYear, name, ageBand, sex); const facilities = getServiceFacilities(name); return <tr key={record.geography}><td>{index + 1}</td><td><button type="button" className="table-district-button" onClick={() => choose(name)}>{name}</button></td><td>{formatNumber(record.population)}人</td><td>{formatPct(record.populationSharePct)}</td><td>{formatNumber(record.populationDensityPerKm2, 2)}人／平方公里</td><td>{facilities.length}處（營運中{facilities.filter((facility) => facility.active).length}處）</td><td>{signedPct(percentChange(record.population, previous?.population))}</td><td>{signedPct(percentChange(record.population, baseline?.population))}</td></tr>; })}</tbody></table></div></details>
      <EvidenceDetails evidence={{
        universe: "戶籍登記現住人口",
        period: `${year}年12月31日｜${ageBandLabel(ageBand)}｜${sex}`,
        identity: "人口與面積為官方行政精確值；密度、排名與變動率為系統直接計算；據點為官方網頁行政清冊",
        method: `密度＝戶籍青年人口÷行政區公告面積；年增率＝（本年÷前一年－1）×100；展示窗變動率＝（本年÷${baseYear}年－1）×100；地圖使用110–114年共同固定範圍的連續色階，版本${mapThresholdVersion}`,
        source: `${dashboardData.sources[0].name}＋新北市行政區面積＋青年服務據點官方頁面`,
        sourceUrl: dashboardData.sources.find((source) => source.name === "新北市行政區面積")?.url ?? dashboardData.sources[0].url,
      }} />
    </section>
  );
}

function ComparisonComposition({
  title,
  question,
  firstName,
  secondName,
  firstValues,
  secondValues,
  order,
  colors,
  estimated,
}: {
  title: string;
  question: string;
  firstName: string;
  secondName: string;
  firstValues: Record<string, CategoryMetric>;
  secondValues: Record<string, CategoryMetric>;
  order: string[];
  colors: Record<string, string>;
  estimated: boolean;
}) {
  return (
    <section className="comparison-composition" aria-labelledby={`${title}-comparison-title`}>
      <div className="chart-title-row"><div><p className="chart-overline">同年度組成比較</p><div className="title-help-row"><h3 id={`${title}-comparison-title`}>{title}</h3><HelpTip label={`${title}閱讀說明`}><p><strong>這張圖要回答：</strong>{question}</p><p><strong>不能直接判讀：</strong>組成差異只描述戶籍人口結構，不代表政策成效或個人選擇原因。</p></HelpTip></div></div>{estimated && <span className="estimate-badge">含模型估計</span>}</div>
      <div className="comparison-stacks">
        {[{ name: firstName, values: firstValues }, { name: secondName, values: secondValues }].map((district) => <article key={district.name}>
          <strong>{district.name}</strong>
          <div className="stacked-bar" aria-hidden="true">{order.map((name) => district.values[name] ? <span key={name} style={{ width: `${district.values[name].value}%`, background: colors[name] }} /> : null)}</div>
          <dl>{order.map((name) => district.values[name] ? <div key={name}><dt><i style={{ background: colors[name] }} />{name}</dt><dd>{formatPct(district.values[name].value)}</dd></div> : null)}</dl>
        </article>)}
      </div>
    </section>
  );
}

function DistrictComparison({ year, ageBand, sex, primaryDistrict }: { year: number; ageBand: AgeBand; sex: Sex; primaryDistrict: string }) {
  const districts = useMemo(() => dashboardData.geographies.filter((item) => item.level === "DISTRICT").map((item) => geographyLabel(item.name)), []);
  const fallbackA = primaryDistrict !== "新北市" ? primaryDistrict : (districts.includes("板橋區") ? "板橋區" : districts[0]);
  const fallbackB = districts.find((item) => item !== fallbackA) ?? fallbackA;
  const [firstDistrict, setFirstDistrict] = useState(fallbackA);
  const [secondDistrict, setSecondDistrict] = useState(fallbackB);

  const firstRecord = getRegistered(year, firstDistrict, ageBand, sex);
  const secondRecord = getRegistered(year, secondDistrict, ageBand, sex);
  const populationPoints = dashboardData.meta.years.map((item) => ({
    year: item,
    values: {
      [firstDistrict]: getRegistered(item, firstDistrict, ageBand, sex)?.population ?? null,
      [secondDistrict]: getRegistered(item, secondDistrict, ageBand, sex)?.population ?? null,
    },
  }));
  const sharePoints = dashboardData.meta.years.map((item) => ({
    year: item,
    values: {
      [firstDistrict]: getRegistered(item, firstDistrict, ageBand, sex)?.populationSharePct ?? null,
      [secondDistrict]: getRegistered(item, secondDistrict, ageBand, sex)?.populationSharePct ?? null,
    },
  }));
  const pooledDistrictRows = dashboardData.registered.filter((record) => record.geography !== "新北市" && record.ageBand === ageBand && record.sex === sex);
  const populationMaximum = roundedCountCeiling(Math.max(1, ...pooledDistrictRows.map((record) => record.population)));
  const shareMaximum = roundUpToTen(Math.max(1, ...pooledDistrictRows.map((record) => record.populationSharePct)));
  const latestPopulationDifference = firstRecord && secondRecord ? firstRecord.population - secondRecord.population : null;
  const latestShareDifference = firstRecord && secondRecord ? firstRecord.populationSharePct - secondRecord.populationSharePct : null;
  const firstAgeValues = (["18-24", "25-29", "30-35"] as AgeBand[]).map((band) => getRegistered(year, firstDistrict, band, sex)?.population ?? 0);
  const secondAgeValues = (["18-24", "25-29", "30-35"] as AgeBand[]).map((band) => getRegistered(year, secondDistrict, band, sex)?.population ?? 0);
  const ageMaximum = roundedCountCeiling(Math.max(1, ...firstAgeValues, ...secondAgeValues));
  const registeredSource = dashboardData.sources[0];
  const educationEstimated = Boolean(firstRecord && secondRecord && [...Object.values(firstRecord.education), ...Object.values(secondRecord.education)].some((item) => item.origin.includes("估計")));
  const marriageEstimated = Boolean(firstRecord && secondRecord && [...Object.values(firstRecord.marriage), ...Object.values(secondRecord.marriage)].some((item) => item.origin.includes("估計")));

  return (
    <section className="district-compare section-shell" aria-labelledby="district-compare-title">
      <div className="section-heading"><div><p className="kicker">雙行政區比較｜戶籍人口母體</p><div className="title-help-row"><h2 id="district-compare-title">把兩區放在同一尺度上比較</h2><HelpTip label="雙行政區比較範圍">只比較有行政區資料的戶籍人口、教育、婚姻與性別；勞動市場及薪資維持全市口徑。</HelpTip></div></div><img className="section-generated-icon" src="/icons/district-compare.png" alt="兩個行政區比較圖示" /></div>
      <div className="compare-controls" aria-label="雙行政區比較條件">
        <label>行政區A<select value={firstDistrict} onChange={(event) => { const value = event.target.value; setFirstDistrict(value); if (value === secondDistrict) setSecondDistrict(districts.find((item) => item !== value) ?? secondDistrict); }}>{districts.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <span aria-hidden="true">比較</span>
        <label>行政區B<select value={secondDistrict} onChange={(event) => setSecondDistrict(event.target.value)}>{districts.map((item) => <option key={item} value={item} disabled={item === firstDistrict}>{item}</option>)}</select></label>
        <div><span>{year}年・{ageBandLabel(ageBand)}・{sex}</span><small>兩區共用年度、年齡、性別與座標尺度</small></div>
      </div>
      <div className="comparison-summary">
        <article><span>{firstDistrict}青年人口</span><strong>{firstRecord ? formatNumber(firstRecord.population) : "—"}<em>人</em></strong></article>
        <article><span>{secondDistrict}青年人口</span><strong>{secondRecord ? formatNumber(secondRecord.population) : "—"}<em>人</em></strong></article>
        <article><span>人口絕對差</span><strong>{latestPopulationDifference == null ? "—" : `${latestPopulationDifference > 0 ? "+" : ""}${formatNumber(latestPopulationDifference)}`}<em>人</em></strong></article>
        <article><span>青年占比差</span><strong>{latestShareDifference == null ? "—" : signedPoints(latestShareDifference)}</strong></article>
      </div>
      <div className="comparison-chart-grid">
        <TrendChart title="戶籍青年人口五年趨勢" points={populationPoints} unit="人" yMin={0} yMax={populationMaximum} colors={{ [firstDistrict]: "#0F766E", [secondDistrict]: "#2563EB" }} question="兩區的青年人口規模在110–114年間如何變化？" trendNotes={[`${firstDistrict}與${secondDistrict}使用同一個0至${formatNumber(populationMaximum)}人的Y軸。`, "折線位置反映實際人口存量，不因切換行政區重新縮放。"]} actionNotes={["若人口長期增加，可先盤點服務量能是否同步調整。", "若人口持續減少，可再查就學、就業與遷徙資料，不直接歸因。"]} caveat="人口多寡不能單獨判定服務不足，也不能說明遷入或遷出的原因。" evidence={{ universe: "戶籍登記現住人口", period: "110–114年12月31日", identity: "官方行政精確值", method: "戶政司單一年齡人口依青年級距直接加總；兩區使用29區共同固定Y軸", source: registeredSource.name, sourceUrl: registeredSource.url }} />
        <TrendChart title="青年占該區人口比率五年趨勢" points={sharePoints} unit="%" yMin={0} yMax={shareMaximum} colors={{ [firstDistrict]: "#0F766E", [secondDistrict]: "#2563EB" }} question="兩區青年占各自戶籍人口的比率是否朝不同方向變化？" trendNotes={[`Y軸上限依29區實際最大值無條件進位至10的倍數，本次為${shareMaximum}%。`, "百分比的分母是各區同年度、同性別戶籍人口。"]} actionNotes={["占比變化可作為跨區人口結構監測訊號。", "若要研判原因，需另接遷徙、出生與死亡等人口變動資料。"]} caveat="青年占比不是服務覆蓋率，也不能與全市勞動率或薪資直接相減。" evidence={{ universe: "戶籍登記現住人口", period: "110–114年12月31日", identity: "官方行政精確值直接計算", method: "青年戶籍人口÷同區同年度同性別戶籍人口×100；Y軸上限向上取整至10的倍數", source: registeredSource.name, sourceUrl: registeredSource.url }} />
      </div>
      <section className="age-compare-chart" aria-labelledby="age-compare-title"><div className="chart-title-row"><div><p className="chart-overline">生命階段比較</p><div className="title-help-row"><h3 id="age-compare-title">三個青年年齡層</h3><HelpTip label="青年年齡層比較說明"><p><strong>這張圖要回答：</strong>兩區的青年人口主要集中在哪個生命階段？</p><p><strong>不能直接判讀：</strong>年齡層人口規模不代表教育、就業或婚育需求已被滿足。</p></HelpTip></div></div><span>單位：人</span></div><div className="age-compare-bars">{(["18-24", "25-29", "30-35"] as AgeBand[]).map((band, index) => <article key={band}><strong>{ageBandLabel(band)}</strong><div><span>{firstDistrict}</span><i><b style={{ width: `${firstAgeValues[index] / ageMaximum * 100}%` }} /></i><em>{formatNumber(firstAgeValues[index])}人</em></div><div><span>{secondDistrict}</span><i><b className="second" style={{ width: `${secondAgeValues[index] / ageMaximum * 100}%` }} /></i><em>{formatNumber(secondAgeValues[index])}人</em></div></article>)}</div></section>
      {firstRecord && secondRecord && <div className="comparison-composition-grid">
        <ComparisonComposition title="教育程度結構" question="兩區同齡戶籍人口的教育程度組成有何差異？" firstName={firstDistrict} secondName={secondDistrict} firstValues={firstRecord.education} secondValues={secondRecord.education} order={["研究所", "大學", "專科", "高中職", "國中及以下"]} colors={educationColors} estimated={educationEstimated} />
        <ComparisonComposition title="婚姻狀態結構" question="兩區同齡戶籍人口的婚姻狀態組成有何差異？" firstName={firstDistrict} secondName={secondDistrict} firstValues={firstRecord.marriage} secondValues={secondRecord.marriage} order={["未婚", "有偶", "離婚或終止結婚", "喪偶"]} colors={marriageColors} estimated={marriageEstimated} />
      </div>}
      <EvidenceDetails evidence={{ universe: "戶籍登記現住人口", period: `${year}年12月31日；趨勢110–114年`, identity: "人口為官方行政精確值；教育與婚姻依欄位顯示官方值或模型估計", method: "人口直接加總；教育與婚姻採PCLM年齡拆分＋IPF行政區校準；所有比較使用相同篩選與尺度", source: `${dashboardData.sources[0].name}、${dashboardData.sources[1].name}、${dashboardData.sources[2].name}`, sourceUrl: dashboardData.sources[0].url, availability: "行政區戶籍資料可比較；勞動與薪資不提供行政區比較" }} />
    </section>
  );
}

function MonthlyPopulationAnalysis({ geography, ageBand, sex, onAgeBandChange, onSexChange }: { geography: string; ageBand: AgeBand; sex: Sex; onAgeBandChange?: (ageBand: AgeBand) => void; onSexChange?: (sex: Sex) => void }) {
  const [monthlyResponse, setMonthlyResponse] = useState<MonthlyAnalysisResponse | null>(null);
  const [monthlyLoading,setMonthlyLoading]=useState(false);
  const [monthlyError, setMonthlyError] = useState("");
  const [monthlyMode, setMonthlyMode] = useState<MonthlyViewMode>("continuous");
  const [comparisonMonth, setComparisonMonth] = useState(12);
  const [activeMonth, setActiveMonth] = useState<{ year: number; month: number; value: number; monthChange: number | null; yearChange: number | null; x: number; y: number } | null>(null);
  const normalizedGeography = fullGeography(geography);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ startYear: "110", endYear: "114", geography: normalizedGeography, ageBand, sex });
    setMonthlyLoading(true);
    setActiveMonth(null);
    setMonthlyError("");
    fetch(`/api/monthly-population?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("月資料載入失敗");
        return await response.json() as MonthlyAnalysisResponse;
      })
      .then((value) => {if(!controller.signal.aborted){setMonthlyResponse(value);setMonthlyLoading(false)}})
      .catch((error: Error) => { if (error.name !== "AbortError") {setMonthlyError("月資料暫時無法載入，請稍後重試。");setMonthlyLoading(false)} });
    return () => controller.abort();
  }, [normalizedGeography, ageBand, sex]);

  const monthlyView = monthlyPopulationView(monthlyResponse?.rows ?? [], monthlyMode, comparisonMonth);
  const analyzed = monthlyView.rows;
  const sameMonth = monthlyMode === "same-month";
  const minimum = monthlyResponse?.scale.minimum ?? 0;
  const maximum = monthlyResponse?.scale.maximum ?? 1;
  const {width,height,left,right,top,bottom}=monthlyChartLayout(minimum,maximum);
  const shown=monthlyResponse?.rows[0];
  const chartScope=shown?`${geographyLabel(shown.geography)}${ageBandLabel(shown.ageBand)} · ${shown.sex}`:'';
  const x = (index: number) => left + (index / Math.max(analyzed.length - 1, 1)) * (width - left - right);
  const y = (value: number) => top + ((maximum - value) / Math.max(maximum - minimum, 1)) * (height - top - bottom);
  const tickIndices=monthlyTickIndices(analyzed,x,sameMonth);
  const path = analyzed.map((row, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(row.population).toFixed(1)}`).join(" ");
  const { latest, first, windowChange } = monthlyView;
  const periodText = (row: { year: number; month: number } | undefined) => row ? `${row.year}年${row.month}月底` : "尚無資料";
  const chartDescription = sameMonth ? `各可用年度${comparisonMonth}月底的青年人口如何變化？` : `${monthlyPeriodLabel}的青年人口如何連續變動？`;

  const chartTransition = useChartTransition(chartMotionKey(monthlyMode, comparisonMonth, analyzed));
  return (
    <section className="monthly-analysis section-shell" aria-labelledby="monthly-population-title">
      <div className="section-heading">
        <div><p className="kicker">官方逐月資料｜{monthlyPeriodLabel}</p><div className="title-help-row"><h2 id="monthly-population-title">戶籍青年人口跨年度月度分析</h2><HelpTip label="月資料計算口徑">每一點都是該月底的戶籍人口存量，不是把年度值拆成月份，也不能把12個月底值相加當作年度人口。月增率比較相鄰月底，同月年增率比較前一年同月份。</HelpTip></div></div>
        {(onAgeBandChange || onSexChange) && <div className="monthly-inline-filters" aria-label="月度戶籍人口篩選條件">
          {onAgeBandChange && <label className="inline-filter">年齡<select value={ageBand} onChange={(event) => onAgeBandChange(event.target.value as AgeBand)}>{ageOrder.map((item) => <option key={item} value={item}>{ageBandLabel(item)}</option>)}</select></label>}
          {onSexChange && <label className="inline-filter">性別<select value={sex} onChange={(event) => onSexChange(event.target.value as Sex)}>{dashboardData.meta.sexes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
        </div>}
      </div>
      <div className="monthly-view-filters chart-filter-row" aria-label="月人口比較方式">
        <label className="inline-filter">比較方式<select value={monthlyMode} onChange={event => { setMonthlyMode(event.target.value as MonthlyViewMode); setActiveMonth(null); }}><option value="continuous">連續月份分析</option><option value="same-month">各年度同月份比較</option></select></label>
        {sameMonth && <label className="inline-filter">比較月份<select value={comparisonMonth} onChange={event => { setComparisonMonth(Number(event.target.value)); setActiveMonth(null); }}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}月</option>)}</select></label>}
        <span>{sameMonth ? `比較各可用年度${comparisonMonth}月底，不加總月份。` : `依時間順序查看${monthlyPeriods.length}個月底人口值。`}</span>
      </div>
      {!monthlyResponse && !monthlyError && <div className="empty-state"><strong>正在載入月資料</strong><p>依目前行政區、年齡與性別擷取{monthlyPeriodLabel}共{monthlyPeriods.length}個月底值。</p></div>}
      {monthlyError && <div className="empty-state"><strong>月資料暫時無法載入</strong><p>{monthlyError}</p></div>}
      {monthlyResponse&&(monthlyLoading||monthlyError)&&<p role="status">{monthlyLoading?'正在更新條件':'新條件資料未取得'}；圖表暫保留上次資料：{chartScope}。</p>}
      {monthlyResponse && <>
      {latest && first && <DataReadingSummary facts={[`${latest.year}年${latest.month}月底，${chartScope}戶籍人口為${formatNumber(latest.population)}人；較${first.year}年${first.month}月底${changeFact(latest.population, first.population, "人", 0)}。`]} identity="官方行政精確值・月底人口" />}
      <div className="monthly-summary-grid">
        <article><span>最新月底值</span><strong>{latest ? formatNumber(latest.population) : "—"}<em>人</em></strong><small>{latest ? `${latest.year}年${latest.month}月底` : "—"}・{chartScope}</small></article>
        <article><span>跨期變動</span><strong>{formatPct(windowChange)}</strong><small>{periodText(latest)}相對{periodText(first)}</small></article>
        <article><span>{sameMonth ? "與前一年同月相比" : "最新月增率"}</span><strong>{sameMonth ? monthlyView.difference == null ? "—" : `${monthlyView.difference > 0 ? "+" : ""}${formatNumber(monthlyView.difference)}人` : formatPct(latest?.monthChange)}</strong><small>{sameMonth ? `${periodText(latest)}相對${periodText(monthlyView.previousYear)}` : latest ? `${periodText(latest)}相對${latest.month === 1 ? `${latest.year - 1}年12月底` : `${latest.year}年${latest.month - 1}月底`}` : "尚無資料"}</small></article>
        <article><span>最新同月年增率</span><strong>{formatPct(monthlyView.annualChange)}</strong><small>{periodText(latest)}相對{periodText(monthlyView.previousYear)}</small></article>
      </div>
      <div className="monthly-chart">
        <div className="chart-title-row"><div className="title-help-row"><h3>{shown ? `${geographyLabel(shown.geography)}${ageBandLabel(shown.ageBand)}` : geography}{sameMonth ? `各年度${comparisonMonth}月底人口` : "每月底人口"}</h3><HelpTip label="每月底人口圖閱讀說明"><p><strong>這張圖要回答：</strong>{chartDescription}</p><p><strong>座標尺度：</strong>{monthlyResponse.scale.rule}：{formatNumber(minimum)}至{formatNumber(maximum)}人。</p><h4>數據呈現的趨勢</h4><ul><li>月值是月底存量，不是當月新增人口。</li><li>游標移到任一點，可查看該月人口、月增率與同月年增率。</li></ul><h4>可以進行的措施</h4><ul><li>辨識連續數月增減後，再查遷徙及人口事件資料。</li><li>相同月份可作跨年比較，降低季節差異造成的誤讀。</li></ul><p><strong>不能直接判讀：</strong>單月增減不能直接歸因於就業、居住或政策措施。</p></HelpTip></div><span>單位：人</span></div>
        <ChartCanvas ref={chartTransition} className="chart-canvas" onMouseLeave={() => setActiveMonth(null)}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${chartDescription}Y軸${formatNumber(minimum)}至${formatNumber(maximum)}人`}>
          <line x1={left} x2={left} y1={top} y2={height - bottom} className="axis-line" /><line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="axis-line" /><text className="axis-title" x="8" y="16">人口（人）</text>
          {Array.from({ length: 5 }, (_, index) => index).map((index) => {
            const ratio = index / 4;
            const value = maximum - (maximum - minimum) * ratio;
            const gy = top + (height - top - bottom) * ratio;
            return <g key={index}><line x1={left} x2={width - right} y1={gy} y2={gy} className="grid-line" /><text x={left - 10} y={gy + 4} textAnchor="end">{formatNumber(value)}</text></g>;
          })}
          <path data-motion-follow-points="monthly" data-motion-key="monthly-line" data-motion-target={JSON.stringify({ d: path })} d={path} fill="none" stroke="#075985" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
          {analyzed.map((row, index) => { const px = x(index); const py = y(row.population); const showLabel = tickIndices.includes(index); return <g key={row.period}><circle data-motion-series="monthly" data-motion-key={row.period} data-motion-target={JSON.stringify({ cx: px, cy: py, r: 4 })} cx={px} cy={py} r="4" fill="white" stroke="#075985" strokeWidth="2" tabIndex={0} role="button" aria-label={`${row.year}年${row.month}月，${formatNumber(row.population)}人`} onMouseEnter={() => setActiveMonth({ year: row.year, month: row.month, value: row.population, monthChange: row.monthChange, yearChange: row.yearChange, x: px, y: py })} onFocus={() => setActiveMonth({ year: row.year, month: row.month, value: row.population, monthChange: row.monthChange, yearChange: row.yearChange, x: px, y: py })} onBlur={() => setActiveMonth(null)}><title>{`${row.year}年${row.month}月：${formatNumber(row.population)}人`}</title></circle>{showLabel && <text x={px} y={height - 18} textAnchor={index === analyzed.length - 1 ? "end" : index === 0 ? "start" : "middle"}>{sameMonth ? `${row.year}年` : `${row.year}/${String(row.month).padStart(2, "0")}`}</text>}</g>; })}
        </svg>{activeMonth && <QuadrantPointTooltip x={activeMonth.x} y={activeMonth.y} width={width} height={height} title={<>{activeMonth.year}年{activeMonth.month}月</>} identity="官方行政精確值">{formatNumber(activeMonth.value)}人<small>{!sameMonth && `月增率 ${formatPct(activeMonth.monthChange)}｜`}同月年增率 {formatPct(activeMonth.yearChange)}</small></QuadrantPointTooltip>}</ChartCanvas>
      </div>
      <details className="data-table-details"><summary>{sameMonth ? `查看${analyzed.length}個年度的${comparisonMonth}月底人口與年增率` : `查看${monthlyPeriods.length}個月底值、月增率與同月年增率`}</summary><div className="table-scroll"><table><thead><tr><th>月份</th><th>月底人口</th>{!sameMonth && <th>相較前月</th>}<th>相較前一年同月</th><th>數值身分</th></tr></thead><tbody>{analyzed.map((row) => <tr key={row.period}><td>{row.year}年{row.month}月</td><td>{formatNumber(row.population)}人</td>{!sameMonth && <td>{formatPct(row.monthChange)}</td>}<td>{formatPct(row.yearChange)}</td><td>官方行政精確值</td></tr>)}</tbody></table></div></details>
      <EvidenceDetails evidence={{ universe: "戶籍登記現住人口", period: `${monthlyPeriodLabel}，各月底存量`, identity: monthlyResponse.meta.identity, method: `${monthlyResponse.meta.method}；月增率＝（本月底÷前月底－1）×100；同月年增率＝（本月底÷前一年同月底－1）×100；跨期變動＝（所選序列末期÷首期－1）×100；同月模式依月份擷取官方月底值`, source: monthlyResponse.meta.sourceName, sourceUrl: monthlyResponse.meta.sourceUrl, availability: monthlyResponse.meta.availability, updatedAt: monthlyResponse.meta.generatedAt }} />
      </>}
    </section>
  );
}

type IndustryRow = ReturnType<typeof getResidentEmploymentIndustry>[number];

const youthIndustryAges: AgeBand[] = ["18-24", "25-29", "30-35", "18-35"];
const industryOptions = getResidentEmploymentIndustry(114, "合計", "18-35");

function industrySexLabel(value: IndustrySex) {
  return value === "合計" ? "男女合計" : value === "男" ? "男性" : "女性";
}

function IndustryFilters({ idPrefix, year, age, sex, industryCode, onYearChange, onAgeChange, onSexChange, onIndustryChange }: {
  idPrefix: string;
  year?: number;
  age?: AgeBand;
  sex?: IndustrySex;
  industryCode?: string;
  onYearChange?: (value: number) => void;
  onAgeChange?: (value: AgeBand) => void;
  onSexChange?: (value: IndustrySex) => void;
  onIndustryChange?: (value: string) => void;
}) {
  return <div className="chart-filter-row industry-chart-filters" aria-label="本圖篩選條件">
    <span className="filter-scope-note">只影響本圖</span>
    {year != null && onYearChange && <label htmlFor={`${idPrefix}-year`}>年度<select id={`${idPrefix}-year`} value={year} onChange={(event) => onYearChange(Number(event.target.value))}>{residentEmploymentIndustryData.meta.years.map((item) => <option key={item} value={item}>{item}年</option>)}</select></label>}
    {age != null && onAgeChange && <label htmlFor={`${idPrefix}-age`}>年齡<select id={`${idPrefix}-age`} value={age} onChange={(event) => onAgeChange(event.target.value as AgeBand)}>{youthIndustryAges.map((item) => <option key={item} value={item}>{ageBandLabel(item)}</option>)}</select></label>}
    {sex != null && onSexChange && <label htmlFor={`${idPrefix}-sex`}>性別<select id={`${idPrefix}-sex`} value={sex} onChange={(event) => onSexChange(event.target.value as IndustrySex)}><option value="合計">男女合計</option><option value="男">男性</option><option value="女">女性</option></select></label>}
    {industryCode != null && onIndustryChange && <label htmlFor={`${idPrefix}-industry`}>行業<select id={`${idPrefix}-industry`} value={industryCode} onChange={(event) => onIndustryChange(event.target.value)}>{industryOptions.map((item) => <option key={item.industryCode} value={item.industryCode}>{item.industry}</option>)}</select></label>}
  </div>;
}

function IndustryRankingChart({ rows, year, age, sex, onYearChange, onAgeChange, onSexChange, evidence }: {
  rows: IndustryRow[];
  year: number;
  age: AgeBand;
  sex: IndustrySex;
  onYearChange: (value: number) => void;
  onAgeChange: (value: AgeBand) => void;
  onSexChange: (value: IndustrySex) => void;
  evidence: ChartEvidence;
}) {
  const [active, setActive] = useState<{ row: IndustryRow; x: number; y: number } | null>(null);
  const ranked = [...rows].sort((a, b) => b.sharePct - a.sharePct);
  const visible = ranked.slice(0, 10);
  const maximum = Math.max(10, roundUpToTen(Math.max(1, ...visible.map((row) => row.sharePct))));
  const width = 760;
  const height = 500;
  const left = 210;
  const right = 80;
  const top = 42;
  const bottom = 54;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const rowHeight = plotHeight / Math.max(visible.length, 1);
  const x = (value: number) => left + value / maximum * plotWidth;
  const ticks = Array.from({ length: 6 }, (_, index) => maximum * index / 5);
  const chartTransition = useChartTransition(chartMotionKey(rows, year, age, sex));
  return <section className="industry-ranking-chart" aria-labelledby="industry-ranking-title">
    <div className="chart-title-row"><div><p className="chart-overline">主要行業排序</p><div className="title-help-row"><h3 id="industry-ranking-title">青年就業者集中在哪些行業？</h3><HelpTip label="主要行業排序閱讀說明"><p><strong>這張圖要回答：</strong>所選年度、年齡與性別的青年就業者，主要分布於哪些行業？</p><p><strong>分母：</strong>同年度、同年齡、同性別的居住於新北市就業者。</p><p><strong>不能直接判讀：</strong>行業占比高不等於缺工、低薪或政策需求較高。</p></HelpTip></div></div><span>前10名｜單位：%</span></div>
    <IndustryFilters idPrefix="industry-ranking" year={year} age={age} sex={sex} onYearChange={onYearChange} onAgeChange={onAgeChange} onSexChange={onSexChange} />
    <DataReadingSummary facts={categoryFacts(rows.map((row) => ({ label: row.industry, value: row.sharePct })), `${year}年・${ageBandLabel(age)}・${industrySexLabel(sex)}`)} identity="模型估計" />
    <ChartCanvas ref={chartTransition} className="chart-canvas industry-ranking-canvas" onMouseLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${year}年${ageBandLabel(age)}${industrySexLabel(sex)}青年就業者主要行業占比前10名`}>
        {ticks.map((tick) => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1={top} y2={height - bottom} className="grid-line" /><text x={x(tick)} y={height - 20} textAnchor="middle">{formatNumber(tick, 0)}%</text></g>)}
        <line x1={left} x2={left} y1={top} y2={height - bottom} className="axis-line" />
        <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="axis-line" />
        <text className="axis-title" x={left + plotWidth / 2} y={height - 2} textAnchor="middle">占同年齡、同性別就業者比率（%）</text>
        {visible.map((row, index) => {
          const cy = top + rowHeight * index + rowHeight / 2;
          const barTop = cy - Math.min(13, rowHeight * .32);
          const end = x(row.sharePct);
          return <g key={row.industryCode}>
            <text x={left - 12} y={cy + 4} textAnchor="end">{chartLabelLines(row.industry).map((line, lineIndex, lines) => <tspan key={lineIndex} x={left - 12} y={cy + 4 + (lineIndex - (lines.length - 1) / 2) * 18}>{line}</tspan>)}</text>
            <rect data-motion-key={row.industryCode} data-motion-target={JSON.stringify({ x: left, y: barTop, width: Math.max(end - left, 1), height: Math.min(26, rowHeight * .64) })} x={left} y={barTop} width={Math.max(end - left, 1)} height={Math.min(26, rowHeight * .64)} rx="5" className="industry-rank-bar" tabIndex={0} role="button" aria-label={`${row.industry}，${formatNumber(row.sharePct, 2)}%，${formatNumber(row.employedThousands, 2)}千人`} onMouseEnter={() => setActive({ row, x: end, y: cy })} onFocus={() => setActive({ row, x: end, y: cy })} onBlur={() => setActive(null)}><title>{row.industry}：{formatNumber(row.sharePct, 2)}%，{formatNumber(row.employedThousands, 2)}千人；敏感度{formatNumber(row.sharePctLow, 2)}%–{formatNumber(row.sharePctHigh, 2)}%</title></rect>
            <text data-motion-label="true" x={Math.min(end + 8, width - right - 2)} y={cy + 4} className="industry-bar-value">{formatNumber(row.sharePct, 2)}%</text>
          </g>;
        })}
      </svg>
      {active && <QuadrantPointTooltip x={active.x} y={active.y} width={width} height={height} title={active.row.industry} identity="">{formatNumber(active.row.sharePct, 2)}%・{formatNumber(active.row.employedThousands, 2)}千人<small>敏感度：{formatNumber(active.row.sharePctLow, 2)}%–{formatNumber(active.row.sharePctHigh, 2)}%</small></QuadrantPointTooltip>}
    </ChartCanvas>
    <details className="data-table-details"><summary>查看完整19類行業資料表</summary><div className="table-scroll"><table><thead><tr><th>排序</th><th>行業</th><th>就業人數</th><th>占比</th><th>方法敏感度</th></tr></thead><tbody>{ranked.map((row, index) => <tr key={row.industryCode}><td>{index + 1}</td><td>{row.industry}</td><td>{formatNumber(row.employedThousands, 2)}千人</td><td>{formatPct(row.sharePct)}</td><td>{formatNumber(row.sharePctLow, 2)}%–{formatNumber(row.sharePctHigh, 2)}%</td></tr>)}</tbody></table></div></details>
    <EvidenceDetails evidence={evidence} />
  </section>;
}

function IndustryCrossMatrix({ year, sex, onYearChange, onSexChange, evidence }: {
  year: number;
  sex: IndustrySex;
  onYearChange: (value: number) => void;
  onSexChange: (value: IndustrySex) => void;
  evidence: ChartEvidence;
}) {
  const [active, setActive] = useState<IndustryRow | null>(null);
  const componentAges: AgeBand[] = ["18-24", "25-29", "30-35"];
  const columns: Array<{ age: AgeBand; label: string; benchmark?: boolean }> = [
    ...componentAges.map((item) => ({ age: item, label: ageBandLabel(item) })),
    { age: "18-35", label: "18–35歲整體基準", benchmark: true },
  ];
  const rowsByAge = Object.fromEntries(columns.map((column) => [column.age, getResidentEmploymentIndustry(year, sex, column.age)])) as Record<AgeBand, IndustryRow[]>;
  const maximum = Math.max(1, ...columns.flatMap((column) => rowsByAge[column.age].map((row) => row.sharePct)));
  const colorFor = (value: number) => {
    const strength = .08 + value / maximum * .84;
    return `rgba(15, 118, 110, ${strength.toFixed(3)})`;
  };
  const chartTransition = useChartTransition(chartMotionKey(year, sex, rowsByAge));
  return <section className="industry-matrix section-shell" aria-labelledby="industry-matrix-title">
    <div className="section-heading"><div><p className="kicker">行業 × 年齡 × 性別交叉矩陣</p><div className="title-help-row"><h2 id="industry-matrix-title">不同生命階段的行業結構有何差異？</h2><HelpTip label="青年行業交叉矩陣閱讀說明"><p>每一格是同年度、同性別、同年齡就業者中，該行業所占比率。顏色越深代表占比越高，格內仍直接顯示數值。</p><p>18–35歲整體基準是以18–35歲人數重新計算，不與前三個子群相加，也不是三個比例的平均。</p><p>敏感度範圍比較PCLM主模型與替代拆分法，並非抽樣信賴區間。</p></HelpTip></div></div><span className="availability-badge is-estimated">青年模型估計</span></div>
    <IndustryFilters idPrefix="industry-matrix" year={year} sex={sex} onYearChange={onYearChange} onSexChange={onSexChange} />
    <DataReadingSummary facts={componentAges.flatMap((band) => categoryFacts(rowsByAge[band].map((row) => ({ label: row.industry, value: row.sharePct })), `${year}年${ageBandLabel(band)}・${industrySexLabel(sex)}`))} identity="模型估計" />
    <div ref={chartTransition} className="industry-matrix-wrap">
      <div className="industry-heatmap" role="grid" aria-label={`${year}年${industrySexLabel(sex)}青年就業者19類行業與年齡交叉矩陣`}>
        <div className="industry-matrix-header" role="columnheader">行業</div>
        {columns.map((column) => <div className={`industry-matrix-header ${column.benchmark ? "benchmark" : ""}`} role="columnheader" key={column.age}>{column.label}</div>)}
        {industryOptions.map((industry) => <div className="industry-matrix-row" role="row" key={industry.industryCode}>
          <div className="industry-matrix-label" role="rowheader">{industry.industry}</div>
          {columns.map((column) => {
            const row = rowsByAge[column.age].find((item) => item.industryCode === industry.industryCode);
            if (!row) return <span key={column.age} className="industry-matrix-cell empty">—</span>;
            const dark = row.sharePct / maximum > .5;
            return <button key={column.age} type="button" className={`industry-matrix-cell ${column.benchmark ? "benchmark" : ""} ${dark ? "dark" : ""}`} style={{ backgroundColor: colorFor(row.sharePct) }} onMouseEnter={() => setActive(row)} onFocus={() => setActive(row)} onMouseLeave={() => setActive(null)} onBlur={() => setActive(null)} aria-label={`${industry.industry}，${column.label}，${formatNumber(row.sharePct, 2)}%，${formatNumber(row.employedThousands, 2)}千人`}><strong>{formatNumber(row.sharePct, 2)}%</strong><small>{formatNumber(row.employedThousands, 1)}千人</small><title>{industry.industry}｜{column.label}｜{formatNumber(row.sharePct, 2)}%｜敏感度{formatNumber(row.sharePctLow, 2)}%–{formatNumber(row.sharePctHigh, 2)}%</title></button>;
          })}
        </div>)}
      </div>
      <aside className="industry-matrix-reader" aria-live="polite"><span>目前指向</span>{active ? <><strong>{active.industry}・{ageBandLabel(active.ageBand as AgeBand)}</strong><b>{formatNumber(active.sharePct, 2)}%</b><p>{formatNumber(active.employedThousands, 2)}千人</p><small>方法敏感度：{formatNumber(active.sharePctLow, 2)}%–{formatNumber(active.sharePctHigh, 2)}%</small></> : <><strong>選擇任一格</strong><p>可查看人數、占比與方法敏感度。</p></>}</aside>
    </div>
    <div className="industry-heatmap-legend" aria-label={`色階由0%至${formatNumber(maximum, 1)}%`}><span>占比較低</span><i /><b>{formatNumber(maximum, 1)}%</b><span>占比較高</span></div>
    <details className="data-table-details"><summary>查看交叉矩陣資料表</summary><div className="table-scroll"><table><thead><tr><th>行業</th>{columns.map((column) => <th key={column.age}>{column.label}</th>)}</tr></thead><tbody>{industryOptions.map((industry) => <tr key={industry.industryCode}><td>{industry.industry}</td>{columns.map((column) => { const row = rowsByAge[column.age].find((item) => item.industryCode === industry.industryCode); return <td key={column.age}>{row ? `${formatNumber(row.sharePct, 2)}%（${formatNumber(row.employedThousands, 2)}千人）` : "尚無資料"}</td>; })}</tr>)}</tbody></table></div></details>
    <EvidenceDetails evidence={evidence} />
  </section>;
}

function WorkCategoryAudit({ year, ageBand, onYearChange, onAgeBandChange, showPolicy }: { year: number; ageBand: AgeBand; onYearChange: (year: number) => void; onAgeBandChange: (ageBand: AgeBand) => void; showPolicy: boolean }) {
  const latestYear = residentEmploymentIndustryData.meta.years.at(-1) ?? year;
  const [overviewAge, setOverviewAge] = useState<AgeBand>(ageBand);
  const [overviewSex, setOverviewSex] = useState<IndustrySex>("合計");
  const [rankingYear, setRankingYear] = useState(year);
  const [rankingAge, setRankingAge] = useState<AgeBand>(ageBand);
  const [rankingSex, setRankingSex] = useState<IndustrySex>("合計");
  const [trendIndustry, setTrendIndustry] = useState("C");
  const [trendSex, setTrendSex] = useState<IndustrySex>("合計");
  const [sexAge, setSexAge] = useState<AgeBand>(ageBand);
  const [sexIndustry, setSexIndustry] = useState("C");
  const [matrixYear, setMatrixYear] = useState(year);
  const [matrixSex, setMatrixSex] = useState<IndustrySex>("合計");
  const trendIndustryLabel = industryOptions.find((row) => row.industryCode === trendIndustry)?.industry ?? "製造業";
  const sexIndustryLabel = industryOptions.find((row) => row.industryCode === sexIndustry)?.industry ?? "製造業";
  const evidenceFor = (selectedYear: number): ChartEvidence => ({
    universe: residentEmploymentIndustryData.meta.universe,
    period: `${selectedYear}年；上、下半年平均形成年度寬帶矩陣`,
    identity: "官方調查寬年齡帶與青年就業母數雙重錨定之模型估計值",
    method: `${residentEmploymentIndustryData.meta.method}；${residentEmploymentIndustryData.meta.sensitivity}`,
    source: `${residentEmploymentIndustryData.meta.sourceName}（${selectedYear}年）`,
    sourceUrl: residentEmploymentIndustryData.meta.halfYearSourcePages[String(selectedYear)].H2,
    availability: "可發布（模型估計，須附方法敏感度）",
    updatedAt: residentEmploymentIndustryData.meta.generatedAt,
  });
  const concentrationPoints = residentEmploymentIndustryData.meta.years.map((annualYear) => {
    const rows = [...getResidentEmploymentIndustry(annualYear, overviewSex, overviewAge)].sort((a, b) => b.sharePct - a.sharePct);
    return { year: annualYear, count: getResidentEmploymentTotal(annualYear, overviewSex, overviewAge) ?? null, rate: rows.slice(0, 5).reduce((sum, row) => sum + row.sharePct, 0) };
  });
  const rankingRows = getResidentEmploymentIndustry(rankingYear, rankingSex, rankingAge);
  const lifeStagePoints = residentEmploymentIndustryData.meta.years.map((annualYear) => ({
    year: annualYear,
    values: Object.fromEntries(youthIndustryAges.map((band) => {
      const label = band === "18-35" ? "18–35歲整體基準" : ageBandLabel(band);
      const value = getResidentEmploymentIndustry(annualYear, trendSex, band).find((row) => row.industryCode === trendIndustry)?.sharePct ?? null;
      return [label, value];
    })),
  }));
  const sexTrendPoints = residentEmploymentIndustryData.meta.years.map((annualYear) => ({
    year: annualYear,
    values: {
      男性: getResidentEmploymentIndustry(annualYear, "男", sexAge).find((row) => row.industryCode === sexIndustry)?.sharePct ?? null,
      女性: getResidentEmploymentIndustry(annualYear, "女", sexAge).find((row) => row.industryCode === sexIndustry)?.sharePct ?? null,
    },
  }));
  const selectedLatestRows = [...getResidentEmploymentIndustry(latestYear, overviewSex, overviewAge)].sort((a, b) => b.sharePct - a.sharePct);
  const selectedPreviousRows = [...getResidentEmploymentIndustry(latestYear - 1, overviewSex, overviewAge)].sort((a, b) => b.sharePct - a.sharePct);
  const policyIndustry = getResidentEmploymentIndustry(latestYear, overviewSex, overviewAge).find((row) => row.industryCode === trendIndustry);
  const priorPolicyIndustry = getResidentEmploymentIndustry(latestYear - 1, overviewSex, overviewAge).find((row) => row.industryCode === trendIndustry);
  const policySignal = buildIndustryPolicySignal({
    ageLabel: ageBandLabel(overviewAge),
    sexLabel: industrySexLabel(overviewSex),
    industry: trendIndustryLabel,
    currentSharePct: policyIndustry?.sharePct ?? null,
    previousSharePct: priorPolicyIndustry?.sharePct ?? null,
    threeYearShares: [latestYear - 2, latestYear - 1, latestYear].map((annualYear) => getResidentEmploymentIndustry(annualYear, overviewSex, overviewAge).find((row) => row.industryCode === trendIndustry)?.sharePct ?? null),
    topFiveSharePct: selectedLatestRows.slice(0, 5).reduce((sum, row) => sum + row.sharePct, 0),
    previousTopFiveSharePct: selectedPreviousRows.slice(0, 5).reduce((sum, row) => sum + row.sharePct, 0),
    lifeStageShares: (["18-24", "25-29", "30-35"] as AgeBand[]).map((band) => getResidentEmploymentIndustry(latestYear, overviewSex, band).find((row) => row.industryCode === trendIndustry)?.sharePct).filter((value): value is number => value != null),
    maleSharePct: getResidentEmploymentIndustry(latestYear, "男", overviewAge).find((row) => row.industryCode === trendIndustry)?.sharePct ?? null,
    femaleSharePct: getResidentEmploymentIndustry(latestYear, "女", overviewAge).find((row) => row.industryCode === trendIndustry)?.sharePct ?? null,
    previousMaleSharePct: getResidentEmploymentIndustry(latestYear - 1, "男", overviewAge).find((row) => row.industryCode === trendIndustry)?.sharePct ?? null,
    previousFemaleSharePct: getResidentEmploymentIndustry(latestYear - 1, "女", overviewAge).find((row) => row.industryCode === trendIndustry)?.sharePct ?? null,
    sensitivityLowPct: policyIndustry?.sharePctLow ?? null,
    sensitivityHighPct: policyIndustry?.sharePctHigh ?? null,
  });
  const youthQa = residentEmploymentIndustryData.qa.youthYears.find((item) => item.year === latestYear);
  return <>
    <section className="industry-audit section-shell" aria-labelledby="industry-audit-title">
      <div className="section-heading"><div><p className="kicker">全年度比較分析｜110–114年</p><div className="title-help-row"><h2 id="industry-audit-title">從就業規模，讀到青年所在行業</h2><HelpTip label="青年行業頁資料口徑">本頁回答「平常居住於新北市的青年就業者主要分布在哪些行業」。行業依工作場所主要經濟活動分類，職業依個人工作內容分類，兩者不混用。</HelpTip></div></div><span className="availability-badge is-estimated">青年分析層・模型估計</span></div>
      <ol className="industry-reading-path" aria-label="本頁閱讀順序"><li><span>01</span><strong>確認青年就業者規模</strong></li><li><span>02</span><strong>查看主要行業分布</strong></li><li><span>03</span><strong>比較不同生命階段</strong></li><li><span>04</span><strong>檢查男女性別差異</strong></li></ol>
      <div className="scope-availability-note industry-scope-note"><strong>居住於新北市的青年就業者</strong><span>110–114年</span><span>男性、女性與合計</span><span>行業分類・模型估計</span></div>
      <div className="annual-quadrant-grid industry-quadrant-grid">
        <article className="annual-quadrant-card quadrant-one"><span className="quadrant-label">工作集中在哪</span><LaborDualAxisChart chartId="industry-scale-concentration" title="青年就業規模與行業集中度" question="青年就業者總數與前五大行業合計占比，五年間是否同向改變？" countLabel="青年就業者" rateLabel="前五大行業合計占比" points={concentrationPoints} filters={<IndustryFilters idPrefix="industry-overview" age={overviewAge} sex={overviewSex} onAgeChange={(value) => { setOverviewAge(value); onAgeBandChange(value); }} onSexChange={setOverviewSex} />} evidence={{ ...evidenceFor(latestYear), period: "110–114年；各年上、下半年平均形成年度矩陣", method: `就業者總數取青年就業母數；前五大行業合計占比＝同年齡同性別占比最高五類之和；${residentEmploymentIndustryData.meta.method}` }} caveat="集中度上升只表示就業分布更集中，不能單獨推論產業風險、缺工或工作品質。" /></article>
        <article className="annual-quadrant-card quadrant-two"><span className="quadrant-label">哪些行業最多</span><IndustryRankingChart rows={rankingRows} year={rankingYear} age={rankingAge} sex={rankingSex} onYearChange={(value) => { setRankingYear(value); onYearChange(value); }} onAgeChange={(value) => { setRankingAge(value); onAgeBandChange(value); }} onSexChange={setRankingSex} evidence={evidenceFor(rankingYear)} /></article>
        <article className="annual-quadrant-card quadrant-three"><span className="quadrant-label">不同年齡做什麼</span><IndustryFilters idPrefix="industry-life-stage" sex={trendSex} industryCode={trendIndustry} onSexChange={setTrendSex} onIndustryChange={setTrendIndustry} /><TrendChart title={`${trendIndustryLabel}在各生命階段的年度比較`} points={lifeStagePoints} unit="%" yMin={0} yMax={Math.max(10, roundUpToTen(Math.max(1, ...lifeStagePoints.flatMap((point) => Object.values(point.values).filter((value): value is number => value != null)))))} colors={{ "18–24歲": "#2563eb", "25–29歲": "#0f766e", "30–35歲": "#d97706", "18–35歲整體基準": "#475569" }} dashedSeries={["18–35歲整體基準"]} question={`居住於新北市的青年就業者中，${trendIndustryLabel}占比在三個生命階段有何不同？`} trendNotes={["實線比較18–24、25–29及30–35歲，虛線是18–35歲整體基準。", "只有5個年度觀測點，應視為年度比較，不延伸為短期波動。"]} actionNotes={["差距達門檻時，可優先補查各年齡層職缺、技能與服務使用結果。", "18–35歲整體基準不與三個子群相加。"]} caveat="年齡差異是結構線索，不代表年齡造成行業選擇，也不能直接證明服務不足。" evidence={{ ...evidenceFor(latestYear), period: "110–114年；各年上、下半年平均形成年度矩陣" }} /></article>
        <article className="annual-quadrant-card quadrant-four"><span className="quadrant-label">男女分布有何不同</span><IndustryFilters idPrefix="industry-sex-gap" age={sexAge} industryCode={sexIndustry} onAgeChange={setSexAge} onIndustryChange={setSexIndustry} /><TrendChart title={`${sexIndustryLabel}的男女結構差異`} points={sexTrendPoints} unit="%" yMin={0} yMax={Math.max(10, roundUpToTen(Math.max(1, ...sexTrendPoints.flatMap((point) => Object.values(point.values).filter((value): value is number => value != null)))))} colors={{ 男性: "#2563eb", 女性: "#d97706" }} question={`${ageBandLabel(sexAge)}男性與女性就業者中，${sexIndustryLabel}各自所占比率有何差異？`} trendNotes={["男性與女性各自使用同性別就業者作分母，兩條線不相加成100%。", "游標與資料表可查看每年精確占比及差距方向。"]} actionNotes={["差距持續擴大時，先補查職務、工時、薪資與服務成果。", "性別差異不能直接解讀為偏好、能力或政策效果。"]} caveat="本圖只描述調查估計的行業結構；政策研議前仍需職業、工時、薪資與服務使用資料。" evidence={{ ...evidenceFor(latestYear), period: "110–114年；各年上、下半年平均形成年度矩陣" }} /></article>
      </div>
    </section>
    <IndustryCrossMatrix year={matrixYear} sex={matrixSex} onYearChange={setMatrixYear} onSexChange={setMatrixSex} evidence={evidenceFor(matrixYear)} />
    {showPolicy && <PolicyDecisionPanel signal={policySignal} evidenceSources={[residentEmploymentIndustryData.meta.sourceName, "新北市青年就業母數", "PCLM與IPF方法敏感度"]} contextLabel={`${latestYear}年・${ageBandLabel(overviewAge)}・${industrySexLabel(overviewSex)}・${trendIndustryLabel}`} />}
    <details className="industry-method section-shell reading-method-details" aria-labelledby="industry-method-title"><summary>行業資料來源與年齡換算方法</summary><div className="section-heading compact-heading"><div><p className="kicker">資料、方法與限制</p><div className="title-help-row"><h2 id="industry-method-title">青年行業資料如何形成</h2><HelpTip label="青年行業資料查核結果">{youthQa ? `模型回加官方性別×行業×寬年齡格的最大誤差為${formatNumber(youthQa.sourceBandReaggregationMaxErrorThousands, 6)}千人；與青年就業母數的最大誤差為${formatNumber(youthQa.laborTargetReconciliationMaxErrorThousands, 6)}千人；19類比例合計誤差為${formatNumber(youthQa.shareClosureMaxErrorPercentagePoints, 6)}個百分點；主模型與替代法最大差為${formatNumber(youthQa.methodSensitivityMaxPercentagePoints, 2)}個百分點。敏感度範圍不是信賴區間。` : "青年模型查核資料暫無。"}</HelpTip></div></div></div><div className="availability-matrix"><dl><div><dt>四組青年年齡</dt><dd><span className="status-partial">模型估計</span>PCLM形成初始輪廓，IPF同時校準官方性別×行業×寬年齡邊際與青年就業母數。</dd></div><div><dt>總量檢核</dt><dd><span className="status-ready">已通過</span>全年齡官方表只作總量與四捨五入殘差查核，不作前台青年數值。</dd></div><div><dt>男性、女性與合計</dt><dd><span className="status-ready">可比較</span>先估計男性與女性，再加總為合計；每列保留方法敏感度。</dd></div><div><dt>工作地與職業</dt><dd><span className="status-partial">不可推論</span>本頁是居住地×行業；不能改寫為在新北工作，也不能把行業改稱職業。</dd></div></dl></div><EvidenceDetails evidence={{ ...evidenceFor(latestYear), period: "110–114年；各年上、下半年平均形成年度矩陣" }} /></details>
  </>;
}

function ServiceEvidencePanel({ year }: { year: number }) {
  const annualYears = [...new Set(dashboardData.service.annual.map((row) => row.year))].sort((a, b) => a - b);
  const annualSummary = annualYears.map((annualYear) => {
    const rows = getServiceAnnual(annualYear);
    return {
      year: annualYear,
      activities: rows.reduce((sum, row) => sum + row.activityCount, 0),
      personTimes: rows.reduce((sum, row) => sum + row.participationPersonTimes, 0),
      domains: rows,
    };
  });
  const selectedSummary = annualSummary.find((row) => row.year === year);
  const selectedExposureIntensity = selectedSummary && selectedSummary.activities > 0 ? selectedSummary.personTimes / selectedSummary.activities : null;
  const maximumPersonTimes = Math.max(...dashboardData.service.annual.map((row) => row.participationPersonTimes), 1);
  const facilities = getServiceFacilities();
  const activeFacilities = facilities.filter((facility) => facility.active);
  const serviceSource = dashboardData.sources.find((source) => source.name === "新北市政府青年局統計年報");
  const facilitySource = dashboardData.sources.find((source) => source.name === "新北市青年服務據點官方頁面");

  return (
    <section className="service-evidence section-shell" aria-labelledby="service-evidence-title">
      <div className="section-heading">
        <div><p className="kicker">政策服務輔助證據</p><div className="title-help-row"><h2 id="service-evidence-title">服務量能與據點</h2><HelpTip label="服務資料口徑">年度服務量是全市彙整人次與場次；據點是{dashboardData.service.snapshotYear}年官方頁面快照。每場平均服務人次允許同一人重複計入，不等於不同受服務人數。</HelpTip></div></div>
        <span className="availability-badge is-ready">政策服務輔助資料</span>
      </div>
      <div className="service-summary-grid">
        <article><span>{year}年服務參與量</span><strong>{selectedSummary ? formatNumber(selectedSummary.personTimes) : "尚無資料"}{selectedSummary && <em>人次</em>}</strong><small>{selectedSummary ? "職涯發展＋創新創業；不是去重人數" : "110年未見同口徑官方年報，不補造"}</small></article>
        <article><span>{year}年活動量</span><strong>{selectedSummary ? formatNumber(selectedSummary.activities) : "尚無資料"}{selectedSummary && <em>場</em>}</strong><small>官方年度行政彙整</small></article>
        <article><span>列管青年服務據點</span><strong>{facilities.length}<em>處</em></strong><small>目前營運{activeFacilities.length}處；依官方頁面逐站建檔</small></article>
        <article><span>{year}年每場平均服務人次</span><strong>{selectedExposureIntensity == null ? "尚無資料" : formatNumber(selectedExposureIntensity, 2)}{selectedExposureIntensity != null && <em>人次／場</em>}</strong><small>參與人次÷活動場次；同一人可能重複計入</small></article>
      </div>
      <div className="service-evidence-layout">
        <section className="service-volume-chart" aria-labelledby="service-volume-title">
          <div className="chart-title-row"><div><p className="chart-overline">111–114年全市年度量</p><div className="title-help-row"><h3 id="service-volume-title">兩類服務參與人次比較</h3><HelpTip label="服務參與人次說明">人次可重複計入同一人多次參與，不能視為受服務人數；114年創業表分類曾調整，跨年只比較總量。</HelpTip></div></div><span>單位：人次</span></div>
          <div className="service-chart-legend"><span><i className="career" />職涯發展</span><span><i className="startup" />創新創業</span></div>
          <div className="service-year-groups" role="img" aria-label="111年至114年職涯發展與創新創業活動參與人次長條圖">
            {annualSummary.map((summary) => <div className="service-year-group" key={summary.year}><strong>{summary.year}年</strong><div>{summary.domains.map((domain) => <div key={domain.domain}><span>{domain.domainLabel.replace("活動", "")}</span><i><b className={domain.domain === "CAREER_DEVELOPMENT" ? "career" : "startup"} style={{ width: `${domain.participationPersonTimes / maximumPersonTimes * 100}%` }} /></i><em>{formatNumber(domain.participationPersonTimes)}</em></div>)}</div></div>)}
          </div>
        </section>
        <aside className="service-guardrail">
          <span className="status-ready">可發布衍生指標</span>
          <h3>每場平均服務人次保留重複參與</h3>
          <p>同一人參加多場活動會重複計入；此數值描述每場活動承載的人次，不是不同青年占比。</p>
          <dl><div><dt>計算公式</dt><dd>{dashboardData.service.exposure.formula}</dd></div><div><dt>數值單位</dt><dd>{dashboardData.service.exposure.unit}，不是百分比</dd></div><div><dt>仍不能推論</dt><dd>不同青年人數、行政區覆蓋率、服務效果或據點不足</dd></div></dl>
        </aside>
      </div>
      <details className="data-table-details"><summary>查看111–114年服務量資料表</summary><div className="table-scroll"><table><thead><tr><th>年度</th><th>服務領域</th><th>活動場次</th><th>參與人次</th><th>平均每場人次</th><th>資料身分</th></tr></thead><tbody>{dashboardData.service.annual.map((row) => <tr key={`${row.year}-${row.domain}`}><td>{row.year}年</td><td>{row.domainLabel}</td><td>{formatNumber(row.activityCount)}場</td><td>{formatNumber(row.participationPersonTimes)}人次</td><td>{formatNumber(row.personTimesPerActivity, 2)}人次／場</td><td>{row.meta.participationPersonTimes.origin}</td></tr>)}</tbody></table></div></details>
      <div className="service-evidence-notes">
        <EvidenceDetails evidence={{ universe: "青年政策服務行政資料（輔助層，非三母體）", period: "111–114年全年動態累計", identity: "官方行政彙整值及其直接加總", method: "依青年局統計年報逐年轉錄活動場次及參與人次；平均每場人次＝參與人次÷場次；不推算去重人數", source: serviceSource?.name ?? "新北市政府青年局統計年報", sourceUrl: serviceSource?.url, availability: year === 110 ? "110年無同口徑資料；111–114年可發布" : "可發布；人次不得解讀為人數", updatedAt: dashboardData.meta.generatedAt }} />
        <EvidenceDetails evidence={{ universe: "青年政策服務據點官方清冊", period: `${dashboardData.service.snapshotYear}年網站快照`, identity: "官方行政頁面逐站建檔", method: "據點名稱、地址、營運狀態及公開量能元件直接轉錄；不同單位的席、間、人、座不加總", source: facilitySource?.name ?? "新北市青年服務據點官方頁面", sourceUrl: facilitySource?.url, availability: "11處已建檔；部分據點無統一量能數值", updatedAt: dashboardData.meta.generatedAt }} />
      </div>
      <details className="data-table-details source-file-detail"><summary>查看服務輔助資料來源明細</summary><p>系統內部檔案：<code>06_政策服務與曝光_長格式.csv</code>。此檔為政策服務輔助層，不是第四個人口母體，也不改寫前三個母體的分母。</p></details>
    </section>
  );
}

type PolicyEvidenceSeries = { label: string; value: number; display: string; tone: "blue" | "teal" };
type PolicyEvidenceRow = { label: string; series: PolicyEvidenceSeries[] };

function JointMarriageEvidenceComparison({ year, ageBand, sex, district }: { year: number; ageBand: AgeBand; sex: Sex; district: string }) {
  const [comparison, setComparison] = useState<{
    districtValue: number;
    districtLow: number;
    districtHigh: number;
    cityValue: number;
    cityLow: number;
    cityHigh: number;
    sourceUrl: string;
    identity: string;
  } | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    const geography = dashboardData.geographies.find((item) => item.level === "DISTRICT" && geographyLabel(item.name) === district);
    if (!geography) {
      setComparison(null);
      setLoadState("missing");
      return;
    }
    const controller = new AbortController();
    setLoadState("loading");
    Promise.all([
      fetch(JOINT_DATA_URL, { signal: controller.signal }),
      fetch(`/data/joint-education-marriage-districts/${geography.code}.json`, { signal: controller.signal }),
    ]).then(async ([cityResponse, districtResponse]) => {
      if (!cityResponse.ok || !districtResponse.ok) throw new Error("教育與婚姻交叉資料載入失敗");
      return await Promise.all([
        cityResponse.json() as Promise<JointEducationMarriagePayload>,
        districtResponse.json() as Promise<JointEducationMarriagePayload>,
      ]);
    }).then(([cityPayload, districtPayload]) => {
      const cityEstimate = higherEducationMarriedShare(cityPayload, year, ageBand, sex);
      const districtEstimate = higherEducationMarriedShare(districtPayload, year, ageBand, sex);
      if (!cityEstimate || !districtEstimate) {
        setComparison(null);
        setLoadState("missing");
        return;
      }
      setComparison({
        districtValue: districtEstimate.value,
        districtLow: districtEstimate.low,
        districtHigh: districtEstimate.high,
        cityValue: cityEstimate.value,
        cityLow: cityEstimate.low,
        cityHigh: cityEstimate.high,
        sourceUrl: cityPayload.meta.sourceUrl,
        identity: `${districtEstimate.origin}；${districtPayload.meta.sensitivity}`,
      });
      setLoadState("ready");
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setComparison(null);
      setLoadState("missing");
    });
    return () => controller.abort();
  }, [year, ageBand, sex, district]);

  if (loadState === "loading") return <section className="policy-drawer-joint" aria-live="polite"><p>正在載入教育×婚姻比較資料…</p></section>;
  if (!comparison) return <section className="policy-drawer-joint"><p>目前條件缺少可發布的教育×婚姻交叉值。</p></section>;

  const gap = comparison.districtValue - comparison.cityValue;
  const conservativeGap = comparison.cityLow - comparison.districtHigh;
  const triggersPilot = gap <= -2 && conservativeGap > 0;
  const ceiling = roundUpToTen(Math.max(comparison.districtHigh, comparison.cityHigh));
  const bars = [
    { label: district, value: comparison.districtValue, low: comparison.districtLow, high: comparison.districtHigh, tone: "blue" },
    { label: "新北市", value: comparison.cityValue, low: comparison.cityLow, high: comparison.cityHigh, tone: "teal" },
  ];

  return <section className="policy-drawer-joint" aria-labelledby="policy-drawer-joint-title">
    <header><span>教育×婚姻交叉證據</span><h3 id="policy-drawer-joint-title">大學及研究所青年有偶率比較</h3><p>分母為同年度、同年齡與同性別的大學及研究所戶籍人口；分子為其中有偶人口。</p></header>
    <div className="policy-joint-bars" role="img" aria-label={`${district}與新北市大學及研究所青年有偶率比較`}>
      {bars.map((item) => <article key={item.label}><strong>{item.label}</strong><div><i><b className={item.tone} style={{ width: `${item.value / ceiling * 100}%` }} /></i><em>{formatPct(item.value)}</em></div><small>模型包絡 {formatPct(item.low)}–{formatPct(item.high)}</small></article>)}
      <span className={gap < 0 ? "is-lower" : "is-higher"}>{district}相較全市{gap < 0 ? "低" : "高"}{formatPct(Math.abs(gap))}</span>
    </div>
    <div className={triggersPilot ? "policy-joint-verdict is-triggered" : "policy-joint-verdict"}>
      <strong>{triggersPilot ? "已達青年交流試辦門檻" : "未達『低於全市』試辦門檻"}</strong>
      <p>{triggersPilot ? "區級點估計至少低2個百分點，且兩套模型包絡的方向一致；可提出有停止條件的小規模試辦。" : gap >= 0 ? `${district}目前不是低於全市；不能用這項證據主張有偶率偏低。` : "差距未達2個百分點或模型包絡方向未一致，暫不以此項證據觸發介入。"}</p>
    </div>
    <dl className="policy-drawer-facts"><div><dt>數值身分</dt><dd>{comparison.identity}</dd></div><div><dt>判讀限制</dt><dd>模型包絡不是信賴區間；婚姻狀態不代表社交需求，也不以結婚作政策績效。</dd></div></dl>
    <nav className="policy-drawer-sources" aria-label="教育婚姻交叉資料來源"><a href={comparison.sourceUrl} target="_blank" rel="noreferrer">15歲以上現住人口按教育程度分</a></nav>
  </section>;
}

function PolicyEvidencePreview({ signal, year, ageBand, sex, district }: { signal: PolicySignal; year: number; ageBand: AgeBand; sex: Sex; district: string }) {
  let title = "證據資料";
  let identity = "依指標保留官方值、調查值或模型估計身分";
  let scope = "新北市全市";
  let rows: PolicyEvidenceRow[] = [];
  let sources: Array<{ name: string; url: string }> = [];

  if (signal.id === "district-population-scale") {
    scope = district;
    title = `${district}戶籍青年人口趨勢`;
    rows = dashboardData.meta.years.map((item) => {
      const record = getRegistered(item, district, ageBand, sex);
      return { label: `${item}年`, series: record ? [{ label: "戶籍人口", value: record.population, display: `${formatNumber(record.population)}人`, tone: "blue" }] : [] };
    });
    identity = getRegistered(year, district, ageBand, sex)?.meta.population.origin ?? "目前條件尚無可發布值";
    sources = dashboardData.sources.slice(0, 3).map((source) => ({ name: source.name, url: source.url }));
  } else if (signal.id === "life-stage-composition") {
    const record = getRegistered(year, "新北市", ageBand, sex);
    title = `${year}年教育與婚姻結構`;
    rows = record ? [
      ...Object.entries(record.education).map(([label, item]) => ({ label: `教育・${label}`, series: [{ label: "占比", value: item.value, display: formatPct(item.value), tone: "blue" as const }] })),
      ...Object.entries(record.marriage).map(([label, item]) => ({ label: `婚姻・${label}`, series: [{ label: "占比", value: item.value, display: formatPct(item.value), tone: "teal" as const }] })),
    ] : [];
    identity = record ? "戶籍人口為官方行政值；教育與婚姻保留各欄位模型估計身分" : "目前條件尚無可發布值";
    sources = dashboardData.sources.slice(0, 3).map((source) => ({ name: source.name, url: source.url }));
  } else if (signal.id === "labor-unemployment-movement") {
    title = `${ageBandLabel(ageBand)}勞動市場五年趨勢`;
    rows = dashboardData.meta.years.map((item) => {
      const record = getLabor(item, ageBand);
      return { label: `${item}年`, series: record ? [
        { label: "失業率", value: record.metrics["失業率"], display: formatPct(record.metrics["失業率"]), tone: "blue" as const },
        { label: "勞參率", value: record.metrics["勞動力參與率"], display: formatPct(record.metrics["勞動力參與率"]), tone: "teal" as const },
      ] : [] };
    });
    identity = getLabor(year, ageBand)?.meta["失業率"]?.origin ?? "目前條件尚無可發布值";
    sources = dashboardData.sources.slice(3, 4).map((source) => ({ name: source.name, url: source.url }));
  } else if (signal.id === "industry-youth-structure") {
    title = `${year}年青年就業者前五大行業`;
    rows = [...getResidentEmploymentIndustry(year, sex as IndustrySex, ageBand)].sort((a, b) => b.sharePct - a.sharePct).slice(0, 5).map((row) => ({
      label: row.industry,
      series: [{ label: "就業占比", value: row.sharePct, display: formatPct(row.sharePct), tone: "teal" as const }],
    }));
    identity = residentEmploymentIndustryData.meta.identity;
    const sourceUrl = residentEmploymentIndustryData.meta.sourcePages[String(year)] ?? dashboardData.sources[3]?.url;
    if (sourceUrl) sources = [{ name: residentEmploymentIndustryData.meta.sourceName, url: sourceUrl }];
  } else if (signal.id === "wage-freshness-and-identity") {
    title = `${ageBandLabel(ageBand)}全年薪資平均數與中位數`;
    rows = dashboardData.meta.years.map((item) => {
      const record = getWage(item, ageBand);
      return { label: `${item}年`, series: record ? [
        { label: "平均數", value: record.metrics["全年總薪資平均數"], display: `${formatNumber(record.metrics["全年總薪資平均數"], 1)}萬元`, tone: "blue" as const },
        { label: "中位數", value: record.metrics["全年總薪資中位數"], display: `${formatNumber(record.metrics["全年總薪資中位數"], 1)}萬元`, tone: "teal" as const },
      ] : [] };
    });
    identity = getWage(Math.min(year, 113), ageBand)?.meta["全年總薪資平均數"]?.origin ?? "所選年度尚無可發布青年值";
    sources = dashboardData.sources.slice(4, 5).map((source) => ({ name: source.name, url: source.url }));
  }

  const maximum = Math.max(1, ...rows.flatMap((row) => row.series.map((item) => item.value)));
  return <section className="policy-drawer-evidence" aria-labelledby="policy-drawer-evidence-title">
    <div className="policy-drawer-chart-heading"><div><span>實際資料</span><h3 id="policy-drawer-evidence-title">{title}</h3></div><small>{scope}・{ageBandLabel(ageBand)}・{sex}</small></div>
    {rows.some((row) => row.series.length) ? <div className="policy-drawer-bars" role="img" aria-label={`${title}圖表`}>
      {rows.map((row) => <article key={row.label}><strong>{row.label}</strong><div>{row.series.map((item) => <span key={item.label} title={`${row.label} ${item.label} ${item.display}`}><small>{item.label}</small><i><b className={item.tone} style={{ width: `${item.value / maximum * 100}%` }} /></i><em>{item.display}</em></span>)}</div></article>)}
    </div> : <p className="empty-policy-state">目前條件沒有可發布圖表值；保留缺值，不以其他年度或母體代填。</p>}
    <dl className="policy-drawer-facts"><div><dt>資料範圍</dt><dd>{scope}・{year}年條件，趨勢圖使用110–114年可用值</dd></div><div><dt>數值身分</dt><dd>{identity}</dd></div><div><dt>讀圖限制</dt><dd>圖表用來檢查規模、結構或趨勢，不單獨證明政策需求或政策效果。</dd></div></dl>
    {sources.length > 0 && <nav className="policy-drawer-sources" aria-label="證據官方來源">{sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.name}</a>)}</nav>}
    {signal.id === "district-population-scale" && <JointMarriageEvidenceComparison year={year} ageBand={ageBand} sex={sex} district={district} />}
  </section>;
}

function PolicySignalDrawer({ signal, year, ageBand, sex, district, onClose }: { signal: PolicySignal | null; year: number; ageBand: AgeBand; sex: Sex; district: string; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement>(null);
  useModalInteraction(!!signal, drawerRef, onClose);
  if (!signal) return null;
  const display = leaderState(signal.state);
  return <>
    <button className="signal-drawer-backdrop" type="button" aria-label="關閉政策訊號詳情" onClick={onClose} />
    <aside ref={drawerRef} tabIndex={-1} className="signal-drawer" role="dialog" aria-modal="true" aria-labelledby="signal-drawer-title">
      <header><div><span className={`policy-state ${policyStateClass(signal.state)}`}><i aria-hidden="true">{display.icon}</i>{display.label}</span><h2 id="signal-drawer-title">{signal.title}</h2></div><button type="button" onClick={onClose}>關閉</button></header>
      <PolicyEvidencePreview signal={signal} year={year} ageBand={ageBand} sex={sex} district={district} />
      <section><h3>數據呈現的趨勢</h3><ul><li><strong>資料訊號：</strong>{signal.signal}</li><li><strong>相對位置：</strong>{signal.relativePosition}</li><li><strong>目前可判讀：</strong>{signal.supportedInterpretation}</li></ul></section>
      <section className="drawer-actions"><div className="title-help-row"><h3>可以進行的措施</h3><HelpTip label="政策選項產生方式">依資料訊號、相對位置與版本化觸發規則列出可討論的工具；不是自動決策。送交執行前，仍須確認資料口徑、資源、適法性與執行條件。</HelpTip></div><ul>{signal.policyTools.map((item) => <li key={item}>{item}</li>)}</ul><p><strong>下一個政策問題</strong>{signal.policyQuestion}</p><p><strong>主責／協辦</strong>{signal.agencies}</p></section>
      <section className="drawer-guardrail"><h3>資料限制</h3><p>{signal.unsupportedConclusion}</p><strong>尚缺資料</strong><ul>{signal.missingData.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section><h3>後續監測</h3><ul>{signal.monitoring.map((item) => <li key={item}>{item}</li>)}</ul><p className="policy-rule-note"><strong>規則：</strong>{signal.rule}</p></section>
    </aside>
  </>;
}

const policyVisuals: Record<string, { src: string; alt: string; theme: string }> = {
  "life-stage-composition": { src: "/icons/life-stage.png", alt: "青年生命階段、教育與家庭結構示意圖", theme: "生命階段" },
  "district-population-scale": { src: "/icons/district-compare.png", alt: "行政區人口與服務配置比較示意圖", theme: "地區差異" },
  "labor-unemployment-movement": { src: "/icons/employment.png", alt: "青年就業轉銜與勞動市場示意圖", theme: "就業轉銜" },
  "industry-youth-structure": { src: "/icons/employment.png", alt: "青年就業者行業結構與生命階段比較示意圖", theme: "行業結構" },
  "wage-freshness-and-identity": { src: "/icons/salary.png", alt: "青年薪資水準與發展趨勢示意圖", theme: "薪資發展" },
};

function PolicyDecisionPanel({ signal, evidenceSources, contextLabel }: { signal: PolicySignal; evidenceSources: string[]; contextLabel: string }) {
  const display = leaderState(signal.state);
  const visual = policyVisuals[signal.id] ?? { src: "/icons/overview.png", alt: "政策資料判讀示意圖", theme: "政策研議" };
  const briefId = `policy-brief-${signal.id}`;
  return (
    <section className="policy-decision policy-brief section-shell" aria-labelledby={briefId}>
      <header className="policy-brief-header">
        <figure className="policy-brief-visual"><img src={visual.src} alt={visual.alt} width={54} height={54} loading="lazy" /><figcaption>{visual.theme}</figcaption></figure>
        <div className="policy-brief-heading"><p className="kicker">政策判讀摘要</p><h2 id={briefId}>{signal.title}</h2><p>{contextLabel}</p></div>
        <span className={`policy-state ${policyStateClass(signal.state)}`}><i aria-hidden="true">{display.icon}</i>{display.label}</span>
      </header>
      <div className="policy-recommendation-callout" role="note" aria-label="建議處理方向">
        <span>建議處理方向</span><strong>{signal.recommendedAction}</strong><p><b>下一個政策問題：</b>{signal.policyQuestion}</p>
      </div>
      <dl className="policy-summary-list" aria-label="政策判讀重點">
        <div><dt>資料訊號</dt><dd><strong>{signal.signal}</strong><span>{signal.relativePosition}</span></dd></div>
        <div><dt>可選政策工具</dt><dd><ul>{signal.policyTools.slice(0, 2).map((item) => <li key={item}>{item}</li>)}</ul></dd></div>
        <div><dt>建議主責／協辦</dt><dd>{signal.agencies}</dd></div>
        <div><dt>後續監測指標</dt><dd><ul>{signal.monitoring.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></dd></div>
      </dl>
      <div className="policy-evidence-accordion" aria-label="政策判讀詳細資訊">
        <details><summary><span>證據與可支持的判讀</span><small>資料來源、相對位置與計算結果</small></summary><div><p><strong>使用資料：</strong>{evidenceSources.join("、")}。</p><p><strong>可以判讀：</strong>{signal.supportedInterpretation}</p><ul>{signal.actionBasis.map((item) => <li key={item}>{item}</li>)}</ul></div></details>
        <details><summary><span>完整政策工具與執行條件</span><small>供承辦單位盤點可行性</small></summary><div><ul>{signal.policyTools.map((item) => <li key={item}>{item}</li>)}</ul><p><strong>主責／協辦：</strong>{signal.agencies}</p><p><strong>送交決策前：</strong>{signal.decisionGate}</p></div></details>
        <details><summary><span>限制與尚缺資料</span><small>避免超出證據範圍</small></summary><div className="policy-limit-section"><p><strong>不能直接推論：</strong>{signal.unsupportedConclusion}</p><ul>{signal.missingData.map((item) => <li key={item}>{item}</li>)}</ul></div></details>
        <details><summary><span>監測方式與版本化規則</span><small>追蹤政策意圖是否逐步實現</small></summary><div><ul>{signal.monitoring.map((item) => <li key={item}>{item}</li>)}</ul><p className="policy-rule-note"><strong>規則：</strong>{signal.rule}</p></div></details>
      </div>
    </section>
  );
}

function OverviewAiEntry({ onOpen, questions }: { onOpen: () => void; questions: string[] }) {
  return (
    <section className="ai-entry section-shell" aria-labelledby="ai-entry-title">
      <div><p className="kicker">AI問資料</p><div className="title-help-row"><h2 id="ai-entry-title">帶著目前篩選條件追問證據</h2><HelpTip label="AI問答範圍">問答會附資料來源、母體與限制；缺資料時明確回答無法判定，不跨母體或行政區補造。</HelpTip></div></div>
      <div><ul>{questions.map((question) => <li key={question}>{question}</li>)}</ul><button type="button" className="primary-button" onClick={onOpen}>開啟AI問答面板</button></div>
    </section>
  );
}

const entryCardCopy: Record<Exclude<DashboardView, "overview">, {
  question: string;
  coverage: string;
  identity: string;
  limitation: string;
}> = {
  registered: {
    question: "全市青年人口如何改變？教育、婚姻與男女結構有何差異？",
    coverage: "110–114年｜新北市全市｜可選年齡與性別",
    identity: "人口與男女為官方行政值；教育與婚姻含標示模型估計",
    limitation: "不延伸為行政區、勞動或薪資結論",
  },
  district: {
    question: "青年集中在哪些行政區？兩區的生命階段結構有何不同？",
    coverage: "110–114年｜29行政區｜地圖與雙區比較",
    identity: "人口與男女為官方行政值；教育與婚姻含標示模型估計",
    limitation: "勞動與薪資沒有行政區數值",
  },
  labor: {
    question: "青年是否進入勞動市場？進入後的就業與失業情況如何？",
    coverage: "110–114年｜新北市全市｜四個青年年齡層",
    identity: "官方抽樣調查估計；非原生年齡帶含模型換算",
    limitation: "目前18–35歲勞動指標只發布男女合計",
  },
  industry: {
    question: "不同青年年齡與性別主要分布在哪些行業？五年間如何變化？",
    coverage: "110–114年｜新北市全市｜四組青年年齡×男女性別×19類行業",
    identity: "官方行業寬帶與青年就業母數雙重錨定之PCLM＋IPF模型估計",
    limitation: "居住地口徑；不是工作地在新北市，也不是職業分類",
  },
  wage: {
    question: "不同青年年齡階段的平均薪資與典型薪資如何變化？",
    coverage: "110–113年｜新北市工作場所｜四組青年年齡",
    identity: "25–29歲為官方原生值；其他平均數與中位數含模型估計",
    limitation: "目前只發布男女合計；114年尚未發布",
  },
  policy: {
    question: "哪些資料訊號應優先盤點？可比較哪些政策選項？",
    coverage: "110–114年｜全市及29區｜決策內網",
    identity: "沿用各資料頁的官方值、調查值或模型估計標籤",
    limitation: "只形成查核順序與選項，不自動核定政策",
  },
  custom: {
    question: "如何用可用欄位建立自己的趨勢、比較或結構圖？",
    coverage: "依單一資料母體與可用維度設定",
    identity: "每個資料點保留數值身分與來源",
    limitation: "圖表軸不等於因果模型的自變項與應變項",
  },
  export: {
    question: "需要哪些欄位與篩選條件？如何取得可追溯的CSV？",
    coverage: "三種母體分檔｜可選年度、年齡、性別、地區與欄位",
    identity: "保留來源、公式、方法、數值身分與Code Book",
    limitation: "系統會依母體停用不存在的交叉條件",
  },
};

function EvidenceEntryHub({ views, onNavigate, onChat, showPolicy }: {
  views: Exclude<DashboardView, "overview">[];
  onNavigate: (view: Exclude<DashboardView, "overview">) => void;
  onChat: (view: Exclude<DashboardView, "overview">) => void;
  showPolicy: boolean;
}) {
  const analysisViews = views.filter((view) => dataEntryViews.includes(view));
  const toolViews = views.filter((view) => !dataEntryViews.includes(view));
  const renderCards = (items: Exclude<DashboardView, "overview">[]) => items.map((view) => {
    const copy = entryCardCopy[view];
    return <article className={`entry-card entry-${view}`} key={view}>
      <div className="entry-card-top"><span>{viewConfig[view].index}</span><img src={viewIcons[view]} alt="" aria-hidden="true" /></div>
      <div><p className="entry-scope">{viewConfig[view].scope} · {entryPeriods[view]}</p><div className="title-help-row"><h3>{navigationLabels[view]}</h3><HelpTip label={`${viewConfig[view].label}資料說明`}><p>{viewConfig[view].label}</p><p>{copy.coverage}</p><p>{copy.identity}</p><p>{copy.limitation}</p></HelpTip></div><p className="entry-question">{copy.question}</p></div>
      <div className="entry-card-actions"><button type="button" className="primary-button" onClick={() => onNavigate(view)}>{dataEntryViews.includes(view) ? "進入分析" : "開啟工具"}</button><button type="button" className="entry-chat-button" onClick={() => onChat(view)}>詢問AI</button></div>
    </article>;
  });
  return (
    <section className="entry-hub" aria-labelledby="entry-hub-title">
      <header className="entry-hub-heading">
        <div><p className="kicker">110–114年｜全年度比較分析與決策工具</p><h2 id="entry-hub-title">接著選擇要處理的問題</h2></div>
        <p>選一個主題，比較五年間的數值；也可使用下方工具，整理自己的分析。</p>
      </header>
        <div className="entry-hub-group"><div className="entry-group-heading"><span>01</span><div><strong>資料分析</strong><small>人口、教育婚姻、勞動與薪資</small></div></div><div className="entry-card-grid annual-entry-card-grid">{renderCards(analysisViews)}</div></div>
        {toolViews.length > 0 && <div className="entry-hub-group entry-tool-group"><div className="entry-group-heading"><span>02</span><div><strong>決策工具</strong><small>依帳號權限顯示</small></div></div><div className="entry-card-grid tool-entry-card-grid">{renderCards(toolViews)}</div></div>}
        <aside className="entry-reading-note" aria-label="閱讀方式"><strong>進入後怎麼看</strong><ol><li>選擇年齡、性別或行政區</li><li>先讀數據重點，再看圖表比較</li><li>{showPolicy ? "需要討論介入方案時，前往政策研判" : "點開資料表，查看每一筆數值與來源"}</li></ol></aside>
    </section>
  );
}

export function DashboardClient() {
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("monthly");
  const [year, setYear] = useState(dashboardData.meta.defaultYear);
  const [ageBand, setAgeBand] = useState<AgeBand>(dashboardData.meta.defaultAgeBand);
  const [sex, setSex] = useState<Sex>(dashboardData.meta.defaultSex);
  const [district, setDistrict] = useState("新北市");
  const [question, setQuestion] = useState('依目前條件，青年人口與前一年相比如何變化？');
  const [roaChatContext,setRoaChatContext]=useState<ChatContext|null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<PolicySignal | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuFirstLinkRef = useRef<HTMLAnchorElement>(null);
  const pageTitleRef = useRef<HTMLHeadingElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const menuPanelRef = useRef<HTMLElement>(null);
  const chatPanelRef = useRef<HTMLElement>(null);
  useModalInteraction(menuOpen, menuPanelRef, () => setMenuOpen(false), menuFirstLinkRef);
  useModalInteraction(chatOpen, chatPanelRef, () => setChatOpen(false), chatInputRef);
  const canViewPolicy = import.meta.env.NTPC_INTERNAL && authStatus?.permissions?.viewPolicy === true;
  const canExportData = import.meta.env.NTPC_INTERNAL && authStatus?.permissions?.exportData === true;
  const isAuthenticated = authStatus?.authenticated === true;
  const visibleEntryViews: Exclude<DashboardView, "overview">[] = [
    ...dataEntryViews,
    ...(canViewPolicy ? ["policy" as const, "custom" as const] : []),
    ...(canExportData ? ["export" as const] : []),
  ];

  useEffect(() => {
    const syncView = () => {
      const search = new URL(window.location.href).searchParams;
      const requested = search.get("view");
      const requestedView = isDashboardView(requested) ? requested : "overview";
      setActiveView(requestedView);
      setAnalysisMode(requestedView === "overview" ? "monthly" : "trend");
    };
    syncView();
    window.addEventListener("popstate", syncView);
    return () => window.removeEventListener("popstate", syncView);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/auth/status")
      .then(async (response) => response.ok ? await response.json() as AuthStatus : null)
      .then((value) => {
        if (!active) return;
        setAuthStatus(value);
        const requestedView = new URL(window.location.href).searchParams.get("view");
        const internalDenied = (requestedView === "policy" || requestedView === "custom") && value?.permissions?.viewPolicy !== true;
        const exportDenied = requestedView === "export" && value?.permissions?.exportData !== true;
        if (!internalDenied && !exportDenied) return;
        const url = new URL(window.location.href);
        url.searchParams.set("view", "overview");
        url.searchParams.set("mode", "monthly");
        window.history.replaceState({ view: "overview", mode: "monthly" }, "", url);
        setActiveView("overview");
        setAnalysisMode("monthly");
        setQuestion(viewerQuickQuestionsByView.overview[0]);
      })
      .catch(() => { if (active) setAuthStatus(null); });
    return () => { active = false; };
  }, []);

  const displayDistrict = activeView === "registered" ? "新北市" : district;
  const registered = getRegistered(year, displayDistrict, ageBand, sex) ?? getRegistered(year, "新北市", ageBand, sex);
  const labor = getLabor(year, ageBand);
  const wage = getWage(year, ageBand);
  const districtRecords = dashboardData.registered.filter((row) => row.year === year && row.ageBand === ageBand && row.sex === sex && row.geography !== "新北市");
  const populationTrend = dashboardData.meta.years.map((item) => ({ year: item, values: { 戶籍人口: getRegistered(item, displayDistrict, ageBand, sex)?.population ?? null } }));
  const populationTrendPool = dashboardData.registered.filter((row) => row.ageBand === ageBand && row.sex === sex && (displayDistrict === "新北市" ? row.geography === "新北市" : row.geography !== "新北市"));
  const populationTrendMaximum = roundedCountCeiling(Math.max(1, ...populationTrendPool.map((row) => row.population)));
  const laborParticipationTrend = dashboardData.meta.years.map((item) => {
    const record = getLabor(item, ageBand);
    return { year: item, value: record?.metrics["勞動力參與率"] ?? null };
  });
  const employmentRateTrend = dashboardData.meta.years.map((item) => {
    const record = getLabor(item, ageBand);
    return { year: item, value: record?.metrics["就業人口比率"] ?? null };
  });
  const laborComplementTrend = dashboardData.meta.years.map((item) => {
    const record = getLabor(item, ageBand);
    return {
      year: item,
      employed: record?.metrics["勞動力中就業占比"] ?? null,
      unemployed: record?.metrics["失業率"] ?? null,
    };
  });
  const wageTrend = dashboardData.meta.years.map((item) => {
    const record = getWage(item, ageBand);
    return { year: item, values: { 平均數: record?.metrics["全年總薪資平均數"] ?? null, 中位數: record?.metrics["全年總薪資中位數"] ?? null } };
  });
  const registeredSource = dashboardData.sources[0];
  const educationSource = dashboardData.sources[1];
  const marriageSource = dashboardData.sources[2];
  const laborSource = dashboardData.sources[3];
  const wageSource = dashboardData.sources[4];
  const overviewRegistered = getRegistered(year, "新北市", ageBand, sex);
  const previousRegistered = getRegistered(year - 1, "新北市", ageBand, sex);
  const previousLabor = getLabor(year - 1, ageBand);
  const laborFiveYearMedian = median(dashboardData.meta.years.map((item) => getLabor(item, ageBand)?.metrics["失業率"]).filter((value): value is number => value != null));
  const wageAge: AgeBand = "18-35";
  const latestWageYear = dashboardData.wage.filter((record) => record.ageBand === wageAge && record.year <= year).reduce<number | null>((latest, record) => latest == null || record.year > latest ? record.year : latest, null);
  const latestWage = latestWageYear == null ? undefined : getWage(latestWageYear, wageAge);
  const earliestWageYear = dashboardData.wage.filter((record) => record.ageBand === wageAge && record.year <= year).reduce<number | null>((earliest, record) => earliest == null || record.year < earliest ? record.year : earliest, null);
  const earliestWage = earliestWageYear == null ? undefined : getWage(earliestWageYear, wageAge);
  const rankedDistricts = [...districtRecords].sort((a, b) => b.population - a.population);
  const policyDistrictRecord = district !== "新北市" ? getRegistered(year, district, ageBand, sex) : rankedDistricts[0];
  const policyDistrictName = policyDistrictRecord ? geographyLabel(policyDistrictRecord.geography) : district;
  const policyDistrictEvidence = getDistrictPolicyEvidence(year, policyDistrictName, ageBand, sex);
  const policyDistrictRank = policyDistrictEvidence.populationRank;
  const districtPolicySignal = buildDistrictPolicySignal({
    district: policyDistrictName,
    ageLabel: ageBandLabel(wageAge),
    population: policyDistrictEvidence.population,
    rank: policyDistrictEvidence.populationRank,
    districtCount: policyDistrictEvidence.districtCount,
    sharePct: policyDistrictEvidence.sharePct,
    citySharePct: policyDistrictEvidence.citySharePct,
    yearChangePct: policyDistrictEvidence.yearChangePct,
    windowChangePct: policyDistrictEvidence.windowChangePct,
    windowPopulationChange: policyDistrictEvidence.windowPopulationChange,
    windowStartYear: policyDistrictEvidence.windowStartYear,
    windowEndYear: policyDistrictEvidence.windowEndYear,
    growthRank: policyDistrictEvidence.growthRank,
    growingDistrictCount: policyDistrictEvidence.growingDistrictCount,
    positiveAnnualIntervals: policyDistrictEvidence.positiveAnnualIntervals,
    annualIntervalCount: policyDistrictEvidence.annualIntervalCount,
    educationLowerPct: policyDistrictEvidence.educationLowerPct,
    cityEducationLowerPct: policyDistrictEvidence.cityEducationLowerPct,
    educationConservativeGapPct: policyDistrictEvidence.educationConservativeGapPct,
    educationDifferenceRank: policyDistrictEvidence.educationDifferenceRank,
    marriedPct: policyDistrictEvidence.marriedPct,
    cityMarriedPct: policyDistrictEvidence.cityMarriedPct,
    marriageConservativeGapPct: policyDistrictEvidence.marriageConservativeGapPct,
    marriageDifferenceRank: policyDistrictEvidence.marriageDifferenceRank,
    maleSharePct: policyDistrictEvidence.maleSharePct,
    cityMaleSharePct: policyDistrictEvidence.cityMaleSharePct,
    genderDifferenceRank: policyDistrictEvidence.genderDifferenceRank,
    demographicEstimated: policyDistrictEvidence.demographicEstimated,
    serviceSiteCount: policyDistrictEvidence.serviceSiteCount,
    activeServiceSiteCount: policyDistrictEvidence.activeServiceSiteCount,
    districtExposureIntensity: null,
  });
  const laborPolicySignal = buildLaborPolicySignal({
    ageLabel: ageBandLabel(ageBand),
    unemploymentRate: labor?.metrics["失業率"] ?? null,
    previousUnemploymentRate: previousLabor?.metrics["失業率"] ?? null,
    fiveYearMedian: laborFiveYearMedian,
    laborParticipationRate: labor?.metrics["勞動力參與率"] ?? null,
  });
  const wagePolicySignal = buildWagePolicySignal({
    ageLabel: ageBandLabel(ageBand),
    selectedYear: year,
    latestYear: latestWageYear,
    latestMean: latestWage?.metrics["全年總薪資平均數"] ?? null,
    latestMedian: latestWage?.metrics["全年總薪資中位數"] ?? null,
    latestGap: meanMedianGap({ mean: latestWage?.metrics["全年總薪資平均數"], median: latestWage?.metrics["全年總薪資中位數"] }),
    latestGapSharePct: meanMedianGapSharePct({ mean: latestWage?.metrics["全年總薪資平均數"], median: latestWage?.metrics["全年總薪資中位數"] }),
    firstGapSharePct: meanMedianGapSharePct({ mean: earliestWage?.metrics["全年總薪資平均數"], median: earliestWage?.metrics["全年總薪資中位數"] }),
    meanCagrPct: compoundAnnualGrowthRatePct(latestWage?.metrics["全年總薪資平均數"], earliestWage?.metrics["全年總薪資平均數"], latestWageYear == null || earliestWageYear == null ? 0 : latestWageYear - earliestWageYear),
    contributionWage: null,
    contributionDifferenceFromNationalPct: null,
    contributionCountyRank: null,
    contributionCountyCount: null,
    identity: latestWage?.meta["全年總薪資平均數"]?.origin ?? "尚無資料",
    medianIdentity: latestWage?.meta["全年總薪資中位數"]?.origin ?? "尚無資料",
  });
  const educationLeading = registered ? Object.entries(registered.education).sort((a, b) => b[1].value - a[1].value)[0] : null;
  const marriageLeading = registered ? Object.entries(registered.marriage).sort((a, b) => b[1].value - a[1].value)[0] : null;
  const lifeStagePolicySignal = buildLifeStagePolicySignal({
    district: displayDistrict,
    ageLabel: ageBandLabel(ageBand),
    leadingEducation: educationLeading?.[0] ?? null,
    leadingEducationPct: educationLeading?.[1].value ?? null,
    leadingMarriage: marriageLeading?.[0] ?? null,
    leadingMarriagePct: marriageLeading?.[1].value ?? null,
    estimated: Boolean(educationLeading?.[1].origin.includes("估計") || marriageLeading?.[1].origin.includes("估計")),
  });
  const overviewSignals = [districtPolicySignal, laborPolicySignal, wagePolicySignal];
  const overviewPrimarySignal = [...overviewSignals].sort((a, b) => {
    const priority: Record<PolicySignalState, number> = { "已觸發": 0, "持續觀察": 1, "無法判定": 2, "目前未觸發": 3 };
    return priority[a.state] - priority[b.state];
  })[0];
  const pagePolicySignal = activeView === "district" ? districtPolicySignal : activeView === "registered" ? lifeStagePolicySignal : activeView === "labor" ? laborPolicySignal : activeView === "wage" ? wagePolicySignal : null;
  const accountLabel = authStatus?.name?.trim() || authStatus?.email || "公開資料";
  const currentView = viewConfig[activeView];
  const quickQuestions = (canViewPolicy ? quickQuestionsByView : viewerQuickQuestionsByView)[activeView];
  const selectedPopulationPrevious = getRegistered(year - 1, displayDistrict, ageBand, sex);
  const selectedPopulationChange = percentChange(registered?.population, selectedPopulationPrevious?.population);
  const unemploymentPointChange = labor && previousLabor ? labor.metrics["失業率"] - previousLabor.metrics["失業率"] : null;
  const pageEvidenceSources = activeView === "overview"
    ? [registeredSource.name, laborSource.name, wageSource.name]
    : activeView === "district"
      ? [registeredSource.name, educationSource.name, marriageSource.name, ...(districtPolicySignal.evidenceDomains.includes("青年據點") ? ["新北市青年服務據點官方清冊"] : [])]
      : activeView === "registered"
        ? [registeredSource.name, educationSource.name, marriageSource.name]
        : activeView === "labor"
          ? [laborSource.name]
          : activeView === "industry"
            ? [residentEmploymentIndustryData.meta.sourceName]
            : activeView === "wage"
            ? [wageSource.name]
            : dashboardData.sources.map((source) => source.name);
  const pageStory: PageStory = activeView === "overview" ? {
    title: `${year}年${ageBandLabel(ageBand)}：把三種母體拼成一張情勢圖`,
    lead: `${changePhrase(percentChange(overviewRegistered?.population, previousRegistered?.population), "戶籍青年人口")}；${pointChangePhrase(unemploymentPointChange, "失業率")}；薪資最新可用年度為${latestWageYear ?? "尚無"}年。三項訊號可以並列，不能混成一個總分。`,
    steps: [
      { label: "先看現況", title: "青年規模", detail: overviewRegistered ? `${formatNumber(overviewRegistered.population)}名戶籍青年，掌握政策可能觸及的規模。` : "本期戶籍人口尚無可發布值。" },
      { label: "再看轉折", title: "就業變化", detail: labor ? `失業率${formatPct(labor.metrics["失業率"])}，和五年中位數${formatPct(laborFiveYearMedian)}對照。` : "本期勞動資料尚未完整。" },
      { label: "確認時效", title: "薪資背景", detail: latestWage ? `${latestWageYear}年平均${formatNumber(latestWage.metrics["全年總薪資平均數"], 1)}萬元、中位數${formatNumber(latestWage.metrics["全年總薪資中位數"], 1)}萬元，只作工作場所薪資背景。` : "尚無完成查核的薪資背景值。" },
      { label: "形成問題", title: "決策焦點", detail: overviewPrimarySignal.policyQuestion },
    ],
    evidenceNote: `依${pageEvidenceSources.join("、")}組成；三種母體各自計算，只有在年份與定義可比時才並列閱讀。`,
  } : activeView === "district" ? {
    title: `從${policyDistrictName}的結構差異，走到可查核的政策問題`,
    lead: `${policyDistrictName}${ageBandLabel(ageBand)}戶籍人口在29區排名第${policyDistrictRank ?? "—"}。本頁再把人口趨勢、教育、婚姻與男女結構放回全市比較，只顯示達到初篩門檻的建議。`,
    steps: [
      { label: "先看分布", title: "找出相對位置", detail: `${year}年地圖同時呈現人口、占比、密度或變動，先確認區域差異。` },
      { label: "再看時間", title: "檢查五年方向", detail: policyDistrictEvidence.windowChangePct == null ? "尚無完整五年可比值。" : `${policyDistrictEvidence.windowStartYear}至${year}年${policyDistrictEvidence.windowChangePct >= 0 ? "增加" : "減少"}${formatNumber(Math.abs(policyDistrictEvidence.windowChangePct), 2)}%。` },
      { label: "接著比較", title: "檢查生命階段", detail: `教育、婚姻與男女結構都和同年全市基準比較；推估欄位保留方法身分。` },
      { label: "最後查證", title: "形成政策問題", detail: districtPolicySignal.recommendedAction },
    ],
    evidenceNote: `依戶籍人口與男女官方行政值、教育及婚姻行政邊際推估組成${districtPolicySignal.evidenceDomains.includes("青年據點") ? "，並核對青年服務據點官方清冊" : ""}；結構差異只形成查核順序，不代表因果。`,
  } : activeView === "registered" ? {
    title: `從新北市全市人口變化，讀到不同生命階段`,
    lead: `${changePhrase(selectedPopulationChange, `新北市${ageBandLabel(ageBand)}戶籍人口`)}；教育以${educationLeading?.[0] ?? "尚無資料"}、婚姻以${marriageLeading?.[0] ?? "尚無資料"}為主要結構。結構描述需求線索，不代表個人處境。`,
    steps: [
      { label: "先定母體", title: "戶籍人口規模", detail: registered ? `${year}年12月31日為${formatNumber(registered.population)}人。` : "本期尚無可發布人口。" },
      { label: "再看組成", title: "教育與婚姻", detail: `在同一戶籍人口母體內比較結構，避免和勞動或薪資母體混用。` },
      { label: "放入比較", title: "行政區與全市", detail: `用相同年齡、性別和年度比較兩區，辨識差異而不推論原因。` },
      { label: "回到時間", title: "月度監測", detail: `人口用真正的月底存量看月增率與同月年增率，不把年度值拆成月份。` },
    ],
    evidenceNote: `依戶政單一年齡人口、教育程度與婚姻狀態資料組成；估計欄位保留PCLM與IPF方法身分。`,
  } : activeView === "labor" ? {
    title: `從勞動母數，走到${ageBandLabel(ageBand)}就業轉銜問題`,
    lead: labor ? `勞動力為${formatNumber(labor.metrics["勞動力人口"], 2)}千人，失業率為${formatPct(labor.metrics["失業率"])}；勞動參與率與就業人口比率須回到民間人口母體解讀。` : "本期缺少完整勞動市場資料，暫不形成政策判讀。",
    steps: [
      { label: "先看母數", title: "誰進入勞動市場", detail: labor ? `民間人口${formatNumber(labor.metrics["民間人口"], 2)}千人、勞動力${formatNumber(labor.metrics["勞動力人口"], 2)}千人。` : "尚無可發布母數。" },
      { label: "再看結果", title: "就業與失業", detail: labor ? `就業${formatNumber(labor.metrics["就業人口"], 2)}千人、失業${formatNumber(labor.metrics["失業人口"], 2)}千人。` : "尚無可發布結果。" },
      { label: "比較五年", title: "辨識轉折", detail: `${pointChangePhrase(unemploymentPointChange, "失業率")}；再和五年中位數比較。` },
      { label: "確認方法", title: "保留估計身分", detail: `非原生青年年齡帶保留PCLM與Sprague敏感度，不把模型值改稱官方值。` },
    ],
    evidenceNote: `依人力資源調查組成；比率均由對應母數重算，非原生年齡帶保留模型估計標籤。`,
  } : activeView === "industry" ? {
    title: `從${ageBandLabel(ageBand)}就業者行業結構，找出職涯服務的查核順序`,
    lead: "先看青年就業者主要集中在哪些行業，再比較五年方向與男女性別差異。這些數值可形成後續查核問題，不能單獨證明人才供需或政策成效。",
    steps: [
      { label: "先定母體", title: "居住地就業者", detail: "母體是平常居住於新北市的就業者，不是工作場所位於新北市的人員。" },
      { label: "再選年齡", title: "青年分析層", detail: "18–24、25–29、30–35與18–35歲由官方寬帶經PCLM與IPF換算。" },
      { label: "比較結構", title: "19類行業與性別", detail: "同年度、同年齡、同性別內計算行業比例，再比較110–114年趨勢。" },
      { label: "最後查核", title: "連同敏感度閱讀", detail: "主模型與替代分配法差距較大時，只列為探索線索，不作單點政策判定。" },
    ],
    evidenceNote: "依主計總處新北市就業者行業×年齡×性別上下半年表與全年行業表組成；青年值均保留模型估計及方法敏感度。",
  } : activeView === "wage" ? {
    title: `先確認資料年度，再談${ageBandLabel(ageBand)}薪資發展`,
    lead: latestWage ? `${year}年${year === latestWageYear ? "有同年度" : "尚無同年度"}薪資；最新可用${latestWageYear}年平均為${formatNumber(latestWage.metrics["全年總薪資平均數"], 1)}萬元。工作場所薪資不能改寫成設籍青年所得。` : "目前沒有完成查核的可比薪資資料，先維持缺值。",
    steps: [
      { label: "先看可用性", title: "年度是否一致", detail: latestWageYear === year ? `${year}年已有可比資料。` : `${year}年尚未發布；${latestWageYear ?? "—"}年只作背景。` },
      { label: "再看統計量", title: "平均與中位數", detail: `平均數描述總體水準；中位數缺少個體分布時不補造。` },
      { label: "確認身分", title: "官方值或估計值", detail: latestWage?.meta["全年總薪資平均數"]?.origin ?? "尚無數值身分" },
      { label: "形成問題", title: "發展脈絡", detail: wagePolicySignal.policyQuestion },
    ],
    evidenceNote: `依受僱員工薪資資料組成；母體為工作場所位於新北市的本國籍全時受僱員工。`,
  } : {
    title: "先選母體與條件，再下載可追溯資料",
    lead: "匯出中心把戶籍、勞動與薪資分成三份CSV。不存在的行政區、性別或中位數交叉條件不會被補造。",
    steps: [
      { label: "先選母體", title: "確認資料在說誰", detail: "戶籍人口、勞動市場與受僱員工薪資使用不同母體。" },
      { label: "設定條件", title: "只選可用範圍", detail: "依年度、年齡、性別與行政區篩選；系統保留資料缺口。" },
      { label: "選擇欄位", title: "一般或研究查核", detail: "可保留來源、公式、方法、估計上下界與更新資訊。" },
      { label: "匯出查核", title: "用Code Book核對", detail: "下載後仍可確認欄位定義、數值身分與來源網址。" },
    ],
    evidenceNote: "匯出遵守三母體分檔規則；勞動與薪資固定為新北市全市，薪資目前只發布男女合計。",
  };

  function navigateView(view: DashboardView) {
    if ((view === "policy" || view === "custom") && !canViewPolicy) {
      setError("政策研判與自訂分析限決策內網授權帳號使用。");
      return;
    }
    if (view === "export" && !canExportData) {
      setError("資料匯出限決策內網授權帳號使用。");
      return;
    }
    const url = new URL(window.location.href);
    const resolvedMode: AnalysisMode = view === "overview" ? "monthly" : "trend";
    url.searchParams.set("view", view);
    url.searchParams.set("mode", resolvedMode);
    window.history.pushState({ view, mode: resolvedMode }, "", url);
    setAnalysisMode(resolvedMode);
    if (view === "registered" || view === "labor" || view === "wage") setDistrict("新北市");
    if (view === "labor" || view === "wage") setSex("合計");
    setActiveView(view);
    setMenuOpen(false);
    setQuestion((canViewPolicy ? quickQuestionsByView : viewerQuickQuestionsByView)[view][0]);
    setAnswer(null);
    setError("");
    setSelectedSignal(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.requestAnimationFrame(() => pageTitleRef.current?.focus());
  }

  function openViewChat(view: Exclude<DashboardView, "overview">) {
    navigateView(view);
    window.setTimeout(() => {
      setChatOpen(true);
      window.requestAnimationFrame(() => chatInputRef.current?.focus());
    }, 80);
  }

  function navigateSection(view: DashboardView, sectionId: string) {
    navigateView(view);
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  function resetFilters() {
    setYear(dashboardData.meta.defaultYear);
    setAgeBand(dashboardData.meta.defaultAgeBand);
    setSex(dashboardData.meta.defaultSex);
    setDistrict("新北市");
  }

  async function ask(event?: FormEvent) {
    event?.preventDefault();
    if (!question.trim()) { setError("請先輸入問題。"); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, context: { year, ageBand, sex, district: displayDistrict, view: activeView } }) });
      const result = await response.json() as Answer & { error?: string };
      if (!response.ok) throw new Error(result.error || "問答暫時無法使用。");
      setAnswer(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "問答暫時無法使用。");
    } finally { setLoading(false); }
  }

  const isAnnualTrendView = analysisMode === "trend" && (activeView === "registered" || activeView === "district" || activeView === "labor" || activeView === "industry" || activeView === "wage");
  const annualTrendAnchor = activeView === "district" ? "#annual-district-map-title" : activeView === "registered" ? "#annual-analysis-title" : activeView === "labor" ? "#annual-labor-analysis-title" : activeView === "industry" ? "#industry-audit-title" : activeView === "policy" ? "#policy-context-title" : activeView === "custom" ? "#custom-builder-title" : "#annual-wage-analysis-title";

  return (
    <>
      <a className="skip-link" href="#main-content">跳至主要內容</a>
      <header className="topbar">
        <a className="brand-lockup" href="?view=overview" aria-label="回到資料入口" onClick={(event) => { event.preventDefault(); navigateView("overview"); }}>
          <span className="brand-mark" aria-hidden="true">NT</span>
          <span><small>新北市青年政策研究原型</small><strong>青年資料證據台</strong></span>
        </a>
        <div className="topbar-actions">
          <button type="button" className="topbar-ai-button" aria-label="AI問資料" onClick={() => setChatOpen(true)}><span aria-hidden="true">AI</span><strong>問資料</strong></button>
          <span className={`access-mode-badge ${canViewPolicy ? "decision" : "viewer"}`}>{canViewPolicy ? "決策內網" : isAuthenticated ? "資料檢視" : "公開檢視"}</span>
          <div className="account-chip" title={authStatus?.email ?? "公開資料模式"}><span aria-hidden="true">{accountLabel.slice(0, 1).toUpperCase()}</span><small>{accountLabel}</small></div>
          <div className="status-line"><i aria-hidden="true" /><span>{uiVersion}<small>介面更新 {formatGeneratedAt(siteRelease.updatedAt)}</small></span></div>
          {isAuthenticated && <a className="logout-link" href={import.meta.env.NTPC_INTERNAL ? "/" : "/internal/?view=policy"}>{import.meta.env.NTPC_INTERNAL ? "回公開資料" : "進入決策內網"}</a>}
          <button
            ref={menuButtonRef}
            type="button"
            className={`menu-toggle ${menuOpen ? "is-open" : ""}`}
            aria-label={menuOpen ? "關閉主要選單" : "開啟主要選單"}
            aria-expanded={menuOpen}
            aria-controls="mobile-main-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true"><i /><i /><i /></span>
          </button>
        </div>
      </header>
      <nav ref={menuPanelRef} tabIndex={-1} role="dialog" aria-modal="true" id="mobile-main-menu" className="mobile-menu" aria-label="儀表板主要選單" hidden={!menuOpen}>
          <div className="mobile-menu-heading"><span>切換儀表板頁面</span><button type="button" onClick={() => setMenuOpen(false)}>關閉</button></div>
          <div className="mobile-menu-links">
            {visibleEntryViews.map((view, index) => <a
              key={view}
              ref={index === 0 ? menuFirstLinkRef : undefined}
              href={`?view=${view}`}
              aria-label={viewConfig[view].label}
              aria-current={activeView === view ? "page" : undefined}
              onClick={(event) => { event.preventDefault(); navigateView(view); }}
            ><span>{viewConfig[view].index}</span><div><strong>{navigationLabels[view]}</strong><small>{viewConfig[view].scope}</small></div></a>)}
          </div>
          <div className="mobile-menu-tools"><a href="?view=overview" onClick={(event) => { event.preventDefault(); navigateView("overview"); }}>回到資料入口</a>{canExportData && <a href="?view=export#method-section" onClick={(event) => { event.preventDefault(); navigateSection("export", "method-section"); }}>資料與方法</a>}</div>
          <div className="mobile-menu-footer">
            <div className="mobile-menu-account"><span aria-hidden="true">{accountLabel.slice(0, 1).toUpperCase()}</span><div><strong>{accountLabel}</strong><small>{authStatus?.email ?? "公開資料模式"}</small></div></div>
            <div className="mobile-menu-status"><span><i aria-hidden="true" />每日審視正常</span><small>{uiVersion}・介面 {formatGeneratedAt(siteRelease.updatedAt)}</small></div>
            {isAuthenticated && <a className="mobile-logout-link" href={import.meta.env.NTPC_INTERNAL ? "/" : "/internal/?view=policy"}>{import.meta.env.NTPC_INTERNAL ? "回公開資料" : "進入決策內網"}</a>}
          </div>
      </nav>
      <button className="menu-backdrop" type="button" aria-label="關閉主要選單" hidden={!menuOpen} onClick={() => { setMenuOpen(false); window.requestAnimationFrame(() => menuButtonRef.current?.focus()); }} />
      <div className={`dashboard-layout ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
        <aside className="side-nav" aria-label="儀表板主要導覽">
          <div className="side-nav-heading"><span>{canViewPolicy ? "決策內網" : isAuthenticated ? "資料檢視" : "公開資料"}</span><button type="button" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? "展開左側導覽" : "收合左側導覽"} aria-expanded={!sidebarCollapsed}><i aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</i></button></div>
          <nav>{visibleEntryViews.map((view) => <button type="button" key={view} aria-label={viewConfig[view].label} aria-current={activeView === view ? "page" : undefined} title={viewConfig[view].label} onClick={() => navigateView(view)}><img src={viewIcons[view]} alt="" aria-hidden="true" /><span><strong>{navigationLabels[view]}</strong><small>{viewConfig[view].scope}</small></span></button>)}</nav>
          <footer><span><i aria-hidden="true" />資料每日審視</span><small>{formatGeneratedAt(dashboardData.meta.generatedAt)}</small></footer>
        </aside>
        <main id="main-content" className="shell">
        {activeView !== "overview" && activeView !== "policy" && <section id="overview" className="intro module-intro inner-intro" aria-labelledby="page-title">
          <div className="hero-copy"><img className="hero-generated-icon" src={viewIcons[activeView]} alt="" aria-hidden="true" /><div><p className="kicker">{currentView.eyebrow}</p><div className="title-help-row"><h1 id="page-title" ref={pageTitleRef} tabIndex={-1}>{currentView.title}</h1><HelpTip label={`${currentView.label}頁面說明`}>{currentView.description}</HelpTip></div><div className="hero-actions"><a className="primary-button" href={activeView === "export" ? "#export-center" : activeView === "overview" ? "#entry-hub-title" : activeView === "policy" || activeView === "custom" ? annualTrendAnchor : isAnnualTrendView ? annualTrendAnchor : "#filter-section"}>{activeView === "export" ? "設定匯出條件" : activeView === "overview" ? "選擇分析方式" : activeView === "policy" ? "開始研判" : activeView === "custom" ? "建立分析" : isAnnualTrendView ? "查看五年分析" : "查看本期指標"}</a><button type="button" className="text-button" onClick={() => setChatOpen(true)}>{activeView === "overview" ? "先問AI" : "AI問本頁資料"}</button></div></div></div>
          <aside className="period-note module-note compact-meta">
            <div className="meta-chip-row"><span className="status-badge"><i aria-hidden="true" />{currentView.label}</span><span className="meta-chip">{activeView === "overview" ? analysisMode === "trend" ? "全年度比較" : analysisMode === "monthly" ? `${monthlyPeriodCompact}月度` : "先選時間視角" : analysisMode === "trend" ? "110–114年比較" : `${monthlyPeriodCompact}月度`}</span><span className="meta-chip">每日09:15審視</span></div>
            <strong>{currentView.universe}</strong>
            <details><summary>資料範圍與更新</summary><dl><div><dt>地理範圍</dt><dd>{currentView.scope}</dd></div><div><dt>時間基準</dt><dd>{currentView.timeBasis}</dd></div><div><dt>更新日期</dt><dd>{formatGeneratedAt(dashboardData.meta.generatedAt)}</dd></div><div><dt>顯示期間</dt><dd>{dashboardData.meta.years.at(0)}–{dashboardData.meta.years.at(-1)}年</dd></div></dl></details>
          </aside>
        </section>}

        {!["overview", "policy", "custom", "export"].includes(activeView) && !isAnnualTrendView && <section id="filter-section" className="filter-bar" aria-label="儀表板篩選條件">
          <div className="filter-heading"><div className="title-help-row"><span>{currentView.label}頁面篩選條件</span><HelpTip label="篩選條件說明">只顯示本頁資料真正支援的維度，不把不存在的交叉資料做成選項。</HelpTip></div></div>
          <div className="filter-controls">
            {analysisMode === "monthly" && activeView !== "export" ? <div className="filter-scope"><span>固定期間</span><strong>{monthlyPeriodCompact}</strong><small>共{monthlyPeriods.length}個月底值</small></div> : <label>年度<select value={year} onChange={(event) => setYear(Number(event.target.value))}>{dashboardData.meta.years.map((item) => <option key={item} value={item}>{item}年</option>)}</select></label>}
            <label>年齡級距<select value={ageBand} onChange={(event) => setAgeBand(event.target.value as AgeBand)}>{ageOrder.map((item) => <option key={item} value={item}>{ageBandLabel(item)}</option>)}</select></label>
            {(activeView === "district" || activeView === "registered" || activeView === "export") && <label>性別<select value={sex} onChange={(event) => setSex(event.target.value as Sex)}>{dashboardData.meta.sexes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
            {activeView === "export" && <label>行政區<select value={district} onChange={(event) => setDistrict(event.target.value)}><option value="新北市">新北市全市</option>{dashboardData.geographies.filter((item) => item.level === "DISTRICT").map((item) => <option key={item.code} value={geographyLabel(item.name)}>{geographyLabel(item.name)}</option>)}</select></label>}
            {activeView === "district" && <div className="filter-scope"><span>行政區</span><strong>{district === "新北市" ? "板橋區" : district}</strong><small>{analysisMode === "monthly" ? "可在月度圖上方切換" : "可直接在地圖切換行政區"}</small></div>}
            {activeView === "labor" && <div className="filter-scope"><span>固定範圍</span><strong>新北市整體</strong><small>性別與行政區交叉資料不足</small></div>}
            {activeView === "wage" && <div className="filter-scope"><span>固定範圍</span><strong>新北市工作場所</strong><small>目前只發布男女合計</small></div>}
            {activeView === "registered" && <div className="filter-scope"><span>固定範圍</span><strong>新北市全市</strong><small>行政區分析請使用29區入口</small></div>}
            {activeView === "export" && <div className="filter-scope"><span>輸出規則</span><strong>依母體限制</strong><small>行政區與性別不適用時保留資料限制</small></div>}
            <button type="button" className="secondary-button" onClick={resetFilters}>重設條件</button>
          </div>
          <p className="filter-summary" aria-live="polite"><span>目前查看</span><strong>{analysisMode === "monthly" && activeView !== "export" ? monthlyPeriodLabel : `${year}年`}・{ageBandLabel(ageBand)}{activeView === "district" ? `・${sex}・${district === "新北市" ? "板橋區" : district}` : activeView === "registered" ? `・${sex}・新北市全市` : activeView === "export" ? `・${sex}・${district}・三母體分檔` : `・${currentView.scope}・男女合計`}</strong></p>
        </section>}

        {activeView === "overview" && <section className="home-monthly" aria-labelledby="home-monthly-title">
          <header className="home-monthly-heading"><div><p className="kicker">公開首頁｜跨年度月度分析</p><div className="title-help-row"><h1 id="home-monthly-title" ref={pageTitleRef} tabIndex={-1}>先看新北市青年戶籍人口每月變化</h1><HelpTip label="首頁資料範圍">首頁月度分析只呈現戶籍人口。下方另列五個資料主題，以及白名單網路可使用的ROA研判、自訂分析與資料匯出。</HelpTip></div></div><aside><span>資料期間</span><strong>{monthlyPeriodLabel}</strong><small>官方月底存量・每日審視來源更新</small></aside></header>
          <MonthlyPopulationAnalysis geography="新北市" ageBand={ageBand} sex={sex} onAgeBandChange={setAgeBand} onSexChange={setSex} />
          <EvidenceEntryHub views={visibleEntryViews} onNavigate={navigateView} onChat={openViewChat} showPolicy={canViewPolicy} />
        </section>}

        {!["overview","export","policy","custom"].includes(activeView) && !isAnnualTrendView && analysisMode !== "monthly" && <section className="kpi-grid" aria-label={`${currentView.label}主要指標`}>
          {activeView === "overview" && <>
            <article className="kpi executive-kpi primary"><div className="kpi-topline"><span>18–35歲戶籍青年人口</span><small>官方行政精確值</small></div><strong>{overviewRegistered ? formatNumber(overviewRegistered.population) : "—"}<em>人</em></strong><p><b className={percentChange(overviewRegistered?.population, previousRegistered?.population) != null && percentChange(overviewRegistered?.population, previousRegistered?.population)! < 0 ? "delta-down" : "delta-up"}>{signedPct(percentChange(overviewRegistered?.population, previousRegistered?.population))}</b> 相較前一年｜戶籍人口母體</p><EvidenceDetails evidence={{ universe: "戶籍登記現住人口", period: `${year}年12月31日`, identity: "官方行政精確值", method: "戶政司單一年齡18–35歲直接加總", source: registeredSource.name, sourceUrl: registeredSource.url }} /></article>
            <article className="kpi executive-kpi"><div className="kpi-topline"><span>就業人口比率</span><small>{labor?.meta["就業人口比率"]?.origin ?? "尚無資料"}</small></div><strong>{formatPct(labor?.metrics["就業人口比率"])}</strong><p><b>{labor && previousLabor ? signedPoints(labor.metrics["就業人口比率"] - previousLabor.metrics["就業人口比率"]) : "尚無前期比較"}</b>｜民間人口母體</p><EvidenceDetails evidence={{ universe: "新北市民間人口", period: `${year}年全年12個月平均`, identity: labor?.meta["就業人口比率"]?.origin ?? "尚無資料", method: labor?.meta["就業人口比率"]?.method ?? "就業人口÷民間人口×100", source: laborSource.name, sourceUrl: laborSource.url, availability: labor ? "可發布" : "尚無資料" }} /></article>
            <article className="kpi executive-kpi"><div className="kpi-topline"><span>失業率</span><small>{labor?.meta["失業率"]?.origin.includes("模型") ? "模型估計" : "官方調查估計"}</small></div><strong>{formatPct(labor?.metrics["失業率"])}</strong><p><b>{labor && previousLabor ? signedPoints(labor.metrics["失業率"] - previousLabor.metrics["失業率"]) : "尚無前期比較"}</b>｜分母為勞動力</p><EvidenceDetails evidence={{ universe: "新北市勞動力人口", period: `${year}年全年12個月平均`, identity: labor?.meta["失業率"]?.origin ?? "尚無資料", method: labor?.meta["失業率"]?.method ?? "失業人口÷勞動力×100", source: laborSource.name, sourceUrl: laborSource.url, availability: labor ? "可發布" : "尚無資料" }} /></article>
            <article className={`kpi executive-kpi wage-lag-card ${latestWage ? "" : "unavailable"}`}><div className="kpi-topline"><span>全年薪資平均</span><small>{latestWageYear === year ? `${year}年` : `${year}年尚未發布`}</small></div><strong>{latestWage ? formatNumber(latestWage.metrics["全年總薪資平均數"], 1) : "—"}{latestWage && <em>萬元</em>}</strong><p><b>最新可用：{latestWageYear ?? "—"}年{latestWageYear == null || latestWageYear === year ? "" : `｜落後${year - latestWageYear}年`}</b><span>工作場所口徑｜{latestWage?.meta["全年總薪資平均數"]?.origin ?? "尚無資料"}</span></p><EvidenceDetails evidence={{ universe: "工作場所位於新北市的受僱員工", period: latestWageYear ? `${latestWageYear}年全年；所選${year}年` : `${year}年`, identity: latestWage?.meta["全年總薪資平均數"]?.origin ?? "尚無資料", method: latestWage?.meta["全年總薪資平均數"]?.method ?? "維持缺值，不以前一年代填", source: wageSource.name, sourceUrl: wageSource.url, availability: latestWageYear === year ? "可發布" : `${year}年尚未發布；顯示最新可用背景值` }} /></article>
          </>}
          {(activeView === "district" || activeView === "registered") && <><article className="kpi primary"><div className="kpi-topline"><span>戶籍人口</span><small>官方行政精確值</small></div><strong>{registered ? formatNumber(registered.population) : "—"}<em>人</em></strong><p>{displayDistrict}・{ageBandLabel(ageBand)}・12月31日</p></article><article className="kpi"><div className="kpi-topline"><span>占戶籍人口</span><small>戶籍人口母體</small></div><strong>{formatPct(registered?.populationSharePct)}</strong><p>{displayDistrict}同年度同一性別戶籍人口為分母</p></article><article className="kpi"><div className="kpi-topline"><span>男性占比</span><small>同區同齡</small></div><strong>{formatPct(getRegistered(year, displayDistrict, ageBand, "男")?.sexSharePct)}</strong><p>男性÷男女合計戶籍人口</p></article><article className="kpi"><div className="kpi-topline"><span>女性占比</span><small>同區同齡</small></div><strong>{formatPct(getRegistered(year, displayDistrict, ageBand, "女")?.sexSharePct)}</strong><p>女性÷男女合計戶籍人口</p></article></>}
          {activeView === "labor" && <><article className="kpi primary"><div className="kpi-topline"><span>失業率</span><small>{labor?.meta["失業率"]?.origin.includes("模型") ? "模型估計" : "官方調查"}</small></div><strong>{labor ? formatPct(labor.metrics["失業率"]) : "—"}</strong><p>失業人口÷勞動力</p></article><article className="kpi"><div className="kpi-topline"><span>勞動力參與率</span><small>民間人口母體</small></div><strong>{labor ? formatPct(labor.metrics["勞動力參與率"]) : "—"}</strong><p>勞動力÷民間人口</p></article><article className="kpi"><div className="kpi-topline"><span>就業人口比率</span><small>民間人口母體</small></div><strong>{labor ? formatPct(labor.metrics["就業人口比率"]) : "—"}</strong><p>就業人口÷民間人口</p></article><article className="kpi"><div className="kpi-topline"><span>勞動力中就業占比</span><small>勞動力母體</small></div><strong>{labor ? formatPct(labor.metrics["勞動力中就業占比"]) : "—"}</strong><p>就業人口÷勞動力</p></article></>}
          {activeView === "wage" && <><article className={`kpi primary ${wage ? "" : "unavailable"}`}><div className="kpi-topline"><span>{year}年全年薪資平均數</span><small>{wage ? "工作場所" : "尚未發布"}</small></div><strong>{wage ? formatNumber(wage.metrics["全年總薪資平均數"], 1) : "尚未發布"}{wage && <em>萬元</em>}</strong><p>{wage ? wage.meta["全年總薪資平均數"]?.origin : `不以${latestWageYear}年代替${year}年`}</p></article><article className={`kpi ${wage ? "" : "unavailable"}`}><div className="kpi-topline"><span>{year}年全年薪資中位數</span><small>{wage ? "典型位置" : "尚未發布"}</small></div><strong>{wage ? formatNumber(wage.metrics["全年總薪資中位數"], 1) : "尚未發布"}{wage && <em>萬元</em>}</strong><p>{wage ? wage.meta["全年總薪資中位數"]?.origin : `最新可用為${latestWageYear ?? "—"}年`}</p></article><article className="kpi"><div className="kpi-topline"><span>母體地理角色</span><small>不可混用</small></div><strong className="textual-kpi">工作場所</strong><p>不是戶籍地或居住地</p></article><article className="kpi"><div className="kpi-topline"><span>資料口徑</span><small>全年統計</small></div><strong className="textual-kpi">受僱員工</strong><p>本國籍全時受僱員工；目前男女合計</p></article></>}
        </section>}

        {activeView !== "overview" && activeView !== "policy" && activeView !== "custom" && !isAnnualTrendView && analysisMode !== "monthly" && <DecisionStory story={pageStory} />}

        {activeView === "district" && analysisMode === "trend" && <><StoryBridge index={1} title="先從29區熱度圖定位">先套用年度、年齡與性別條件，再選一區查看相對排名與完整五年結構。</StoryBridge><AnnualDistrictDashboard selected={district} onSelect={setDistrict} registeredSource={registeredSource} educationSource={educationSource} marriageSource={marriageSource} onFilterApply={(nextYear, nextAgeBand, nextSex) => { setYear(nextYear); setAgeBand(nextAgeBand); setSex(nextSex); }} /></>}

        {activeView === "registered" && analysisMode === "trend" && <><StoryBridge index={1} title="先看五年人口與生活結構">四張圖各自選擇年齡與性別，先比較人口規模、密度與占比，再閱讀婚姻及教育結構。</StoryBridge><AllYearRegisteredDashboard registeredSource={registeredSource} educationSource={educationSource} marriageSource={marriageSource} /></>}

        {activeView === "labor" && analysisMode === "trend" && <><StoryBridge index={1} title="先看五年的就業與勞動變化">先辨識就業結果與勞動參與，再拆解就業、失業及非勞動力；每一張圖都保留正確分母。</StoryBridge><AllYearLaborDashboard laborSource={laborSource} showPolicy={false} /></>}

        {activeView === "industry" && analysisMode === "trend" && <><StoryBridge index={1} title="先從規模讀到結構差異">先確認青年就業規模與行業集中度，再依序查看主要行業、生命階段、男女差異與交叉矩陣。</StoryBridge><WorkCategoryAudit year={year} ageBand={ageBand} onYearChange={setYear} onAgeBandChange={setAgeBand} showPolicy={false} /></>}

        {activeView === "wage" && analysisMode === "trend" && <><StoryBridge index={1} title="先把平均數與中位數放在一起讀">平均數說明整體薪資水準，中位數補上典型位置；兩者都保留官方或模型身分。</StoryBridge><AllYearWageDashboard wageSource={wageSource} showPolicy={false} /></>}

        {activeView === "policy" && canViewPolicy && <PolicyWorkflow year={year} ageBand={ageBand} sex={sex} district={district} onYearChange={setYear} onAgeBandChange={setAgeBand} onSexChange={setSex} onDistrictChange={setDistrict} onOpenSignal={setSelectedSignal} onAiContext={setRoaChatContext} onOpenChat={(prompt) => { setQuestion(prompt); setChatOpen(true); }} />}

        {activeView === "custom" && canViewPolicy && <CustomAnalysisWorkbench initialYear={year} initialAge={ageBand} initialSex={sex} />}

        {activeView === "export" && canExportData && <>
<section className="download-zone section-shell" aria-label="資料下載與證據"><div id="export-center"><ExportCenter year={year} ageBand={ageBand} sex={sex} district={district} defaultOpen /></div></section>
          <OverviewAiEntry onOpen={() => setChatOpen(true)} questions={quickQuestions} />
        </>}

        {activeView !== "overview" && activeView !== "export" && activeView !== "policy" && activeView !== "custom" && <nav className="research-links" aria-label="資料與研究功能">{canExportData && <><button type="button" onClick={() => navigateSection("export", "export-center")}>前往資料匯出</button><button type="button" onClick={() => navigateSection("export", "method-section")}>查看資料、方法與限制</button><button type="button" onClick={() => navigateView("policy")}>前往政策研判</button></>}<button type="button" onClick={() => setChatOpen(true)}>AI問本頁資料</button></nav>}

        {activeView === "export" && canExportData && <details id="method-section" className="method-section section-shell reading-method-details" aria-labelledby="method-title">
          <summary>資料方法、更新頻率與版本紀錄</summary>
          <div className="section-heading"><div><p className="kicker">方法與更新</p><div className="title-help-row"><h2 id="method-title">每天審視，來源變更才重算</h2><HelpTip label="顯示年度與更新規則">顯示窗規則：{dashboardData.meta.yearWindowRule}。目前為110–114年；民國116年將自動成為111–115年。</HelpTip></div></div></div>
          <div className="method-grid"><article><div className="title-help-row"><strong>戶籍人口</strong><HelpTip label="戶籍人口計算方法">單一年齡直接加總；教育與婚姻採全市PCLM種子＋各區IPF校準。</HelpTip></div></article><article><div className="title-help-row"><strong>勞動市場</strong><HelpTip label="勞動市場計算方法">PCLM主模型，Sprague作敏感度；所有比率由民間人口、勞動力、就業與失業計數重算。</HelpTip></div></article><article><div className="title-help-row"><strong>薪資</strong><HelpTip label="薪資計算方法">25–29歲平均數與中位數為官方原生值；其他平均數採官方表6錨定＋PCLM輔助年齡輪廓。其他中位數採官方寬帶形狀轉移與對數常態混合分布估計，並標示方法敏感度。</HelpTip></div></article><article><div className="title-help-row"><strong>政策服務輔助層</strong><HelpTip label="政策服務資料方法">場次、人次、據點及量能另存輔助資料。每場平均服務人次＝參與人次÷活動場次；同一人可能重複計入，單位為人次／場。</HelpTip></div></article><article><div className="title-help-row"><strong>每日流程</strong><HelpTip label="每日資料審視流程">比對期間、ETag／日期／大小與SHA-256；未變更記錄NO_CHANGE。</HelpTip></div></article></div>
          <dl className="version-register"><div><dt>UI版</dt><dd>{uiVersion}</dd></div><div><dt>介面更新時間</dt><dd>{formatGeneratedAt(siteRelease.updatedAt)}</dd></div><div><dt>資料版</dt><dd>{dataVersion}</dd></div><div><dt>資料包生成時間</dt><dd>{formatGeneratedAt(dashboardData.meta.generatedAt)}</dd></div><div><dt>政策頁版</dt><dd>{siteRelease.policyExperienceVersion}</dd></div><div><dt>政策規則版</dt><dd>{policyRulesVersion}</dd></div><div><dt>服務資料版</dt><dd>{serviceDataVersion}</dd></div></dl>
          <details className="data-table-details"><summary>查看官方來源與更新頻率</summary><div className="table-scroll"><table><thead><tr><th>官方來源</th><th>原生更新</th><th>連結</th></tr></thead><tbody>{dashboardData.sources.map((source) => <tr key={source.url}><td>{source.name}</td><td>{source.cadence}</td><td><a href={source.url} target="_blank" rel="noreferrer">開啟官方來源</a></td></tr>)}</tbody></table></div></details>
        </details>}
        </main>
      </div>
      {canViewPolicy && <PolicySignalDrawer signal={selectedSignal} year={year} ageBand={ageBand} sex={sex} district={policyDistrictName} onClose={() => setSelectedSignal(null)} />}
      <button className="ai-drawer-backdrop" type="button" aria-label="關閉AI問答面板" hidden={!chatOpen} onClick={() => setChatOpen(false)} />
      <aside ref={chatPanelRef} tabIndex={-1} id="ai-question-drawer" className="ai-drawer" hidden={!chatOpen} role="dialog" aria-modal="true" aria-labelledby="ai-drawer-title">
        <header><div><span>Amazon Bedrock · {canViewPolicy?'內網研析問答':'公開資料問答'}</span><h2 id="ai-drawer-title">AI 問資料</h2></div><button type="button" aria-label="關閉AI問答面板" onClick={() => setChatOpen(false)}>關閉</button></header>
        {chatOpen&&<AwsChat initialContext={activeView==='policy'&&roaChatContext?roaChatContext:{year,ageBand,sex,district:['labor','industry','wage'].includes(activeView)?'新北市':displayDistrict,view:activeView}} isInternal={canViewPolicy} question={question} onQuestionChange={setQuestion} inputRef={chatInputRef}/>}
      </aside>
      <footer><span>新北市青年資料研究原型｜僅使用政府公開彙總資料</span><span>{uiVersion}｜資料{dashboardData.meta.version}｜同年度檢視</span></footer>
    </>
  );
}

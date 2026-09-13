"use client";

import { useMemo, useState } from "react";
import { ageBandLabel, dashboardData, geographyLabel, getLabor, getRegistered, getWage, type AgeBand, type Sex } from "./dashboard-data";
import { getDistrictPolicyEvidence } from "./district-policy-evidence";
import {
  buildDistrictPolicySignal,
  buildIndustryPolicySignal,
  buildLaborPolicySignal,
  buildLifeStagePolicySignal,
  buildWagePolicySignal,
  median,
  type PolicySignal,
  type PolicySignalState,
} from "./policy-engine";
import { getResidentEmploymentIndustry, type IndustrySex } from "./resident-employment-industry";
import { compoundAnnualGrowthRatePct, meanMedianGap, meanMedianGapSharePct } from "./wage-metrics";
import { policySourceStatus, sourceVerifiedAt, ukPolicyGuidance } from "./policy-source-status";

type Props = {
  year: number;
  ageBand: AgeBand;
  sex: Sex;
  district: string;
  onYearChange: (value: number) => void;
  onAgeBandChange: (value: AgeBand) => void;
  onSexChange: (value: Sex) => void;
  onDistrictChange: (value: string) => void;
  onOpenSignal: (signal: PolicySignal) => void;
};

const stateOrder: Record<PolicySignalState, number> = { "已觸發": 0, "持續觀察": 1, "無法判定": 2, "目前未觸發": 3 };

function statusDisplay(state: PolicySignalState) {
  if (state === "已觸發") return { label: "優先盤點", icon: "!", className: "is-priority" };
  if (state === "無法判定") return { label: "資料待補", icon: "?", className: "is-missing" };
  return { label: "持續監測", icon: "•", className: "is-monitor" };
}

function districtSignal(year: number, district: string, ageBand: AgeBand, sex: Sex) {
  const evidence = getDistrictPolicyEvidence(year, district, ageBand, sex);
  return buildDistrictPolicySignal({
    district,
    ageLabel: ageBandLabel(ageBand),
    population: evidence.population,
    rank: evidence.populationRank,
    districtCount: evidence.districtCount,
    sharePct: evidence.sharePct,
    citySharePct: evidence.citySharePct,
    yearChangePct: evidence.yearChangePct,
    windowChangePct: evidence.windowChangePct,
    windowPopulationChange: evidence.windowPopulationChange,
    windowStartYear: evidence.windowStartYear,
    windowEndYear: evidence.windowEndYear,
    growthRank: evidence.growthRank,
    growingDistrictCount: evidence.growingDistrictCount,
    positiveAnnualIntervals: evidence.positiveAnnualIntervals,
    annualIntervalCount: evidence.annualIntervalCount,
    educationLowerPct: evidence.educationLowerPct,
    cityEducationLowerPct: evidence.cityEducationLowerPct,
    educationConservativeGapPct: evidence.educationConservativeGapPct,
    educationDifferenceRank: evidence.educationDifferenceRank,
    marriedPct: evidence.marriedPct,
    cityMarriedPct: evidence.cityMarriedPct,
    marriageConservativeGapPct: evidence.marriageConservativeGapPct,
    marriageDifferenceRank: evidence.marriageDifferenceRank,
    maleSharePct: evidence.maleSharePct,
    cityMaleSharePct: evidence.cityMaleSharePct,
    genderDifferenceRank: evidence.genderDifferenceRank,
    demographicEstimated: evidence.demographicEstimated,
    serviceSiteCount: evidence.serviceSiteCount,
    activeServiceSiteCount: evidence.activeServiceSiteCount,
    districtExposureIntensity: null,
  });
}

function citySignals(year: number, ageBand: AgeBand, sex: Sex, district: string) {
  const years = dashboardData.meta.years;
  const selectedDistrict = district === "新北市" ? "板橋區" : district;
  const registered = getRegistered(year, "新北市", ageBand, sex);
  const educationLeading = registered ? Object.entries(registered.education).sort((a, b) => b[1].value - a[1].value)[0] : null;
  const marriageLeading = registered ? Object.entries(registered.marriage).sort((a, b) => b[1].value - a[1].value)[0] : null;
  const lifeStage = buildLifeStagePolicySignal({
    district: "新北市",
    ageLabel: ageBandLabel(ageBand),
    leadingEducation: educationLeading?.[0] ?? null,
    leadingEducationPct: educationLeading?.[1].value ?? null,
    leadingMarriage: marriageLeading?.[0] ?? null,
    leadingMarriagePct: marriageLeading?.[1].value ?? null,
    estimated: Boolean(educationLeading?.[1].origin.includes("估計") || marriageLeading?.[1].origin.includes("估計")),
  });

  const labor = getLabor(year, ageBand);
  const laborPrevious = getLabor(year - 1, ageBand);
  const laborMedian = median(years.map((item) => getLabor(item, ageBand)?.metrics["失業率"]).filter((value): value is number => value != null));
  const laborSignal = buildLaborPolicySignal({
    ageLabel: ageBandLabel(ageBand),
    unemploymentRate: labor?.metrics["失業率"] ?? null,
    previousUnemploymentRate: laborPrevious?.metrics["失業率"] ?? null,
    fiveYearMedian: laborMedian,
    laborParticipationRate: labor?.metrics["勞動力參與率"] ?? null,
  });

  const wageAge: AgeBand = "18-35";
  const latestWageYear = dashboardData.wage.filter((row) => row.ageBand === wageAge && row.year <= year).reduce<number | null>((latest, row) => latest == null || row.year > latest ? row.year : latest, null);
  const earliestWageYear = dashboardData.wage.filter((row) => row.ageBand === wageAge && row.year <= year).reduce<number | null>((earliest, row) => earliest == null || row.year < earliest ? row.year : earliest, null);
  const latestWage = latestWageYear == null ? undefined : getWage(latestWageYear, wageAge);
  const earliestWage = earliestWageYear == null ? undefined : getWage(earliestWageYear, wageAge);
  const wageSignal = buildWagePolicySignal({
    ageLabel: ageBandLabel(wageAge),
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

  const industrySex = sex as IndustrySex;
  const currentIndustry = [...getResidentEmploymentIndustry(year, industrySex, ageBand)].sort((a, b) => b.sharePct - a.sharePct);
  const leading = currentIndustry[0];
  const industryCode = leading?.industryCode;
  const priorRows = getResidentEmploymentIndustry(year - 1, industrySex, ageBand);
  const previous = priorRows.find((row) => row.industryCode === industryCode);
  const threeYearShares = [year - 2, year - 1, year].map((item) => getResidentEmploymentIndustry(item, industrySex, ageBand).find((row) => row.industryCode === industryCode)?.sharePct ?? null);
  const lifeStageShares = (["18-24", "25-29", "30-35"] as AgeBand[]).map((band) => getResidentEmploymentIndustry(year, "合計", band).find((row) => row.industryCode === industryCode)?.sharePct).filter((value): value is number => value != null);
  const industrySignal = buildIndustryPolicySignal({
    ageLabel: ageBandLabel(ageBand),
    sexLabel: sex === "合計" ? "男女合計" : sex,
    industry: leading?.industry ?? "主要行業",
    currentSharePct: leading?.sharePct ?? null,
    previousSharePct: previous?.sharePct ?? null,
    threeYearShares,
    topFiveSharePct: currentIndustry.slice(0, 5).reduce((sum, row) => sum + row.sharePct, 0) || null,
    previousTopFiveSharePct: priorRows.length ? [...priorRows].sort((a, b) => b.sharePct - a.sharePct).slice(0, 5).reduce((sum, row) => sum + row.sharePct, 0) : null,
    lifeStageShares,
    maleSharePct: getResidentEmploymentIndustry(year, "男", ageBand).find((row) => row.industryCode === industryCode)?.sharePct ?? null,
    femaleSharePct: getResidentEmploymentIndustry(year, "女", ageBand).find((row) => row.industryCode === industryCode)?.sharePct ?? null,
    previousMaleSharePct: getResidentEmploymentIndustry(year - 1, "男", ageBand).find((row) => row.industryCode === industryCode)?.sharePct ?? null,
    previousFemaleSharePct: getResidentEmploymentIndustry(year - 1, "女", ageBand).find((row) => row.industryCode === industryCode)?.sharePct ?? null,
    sensitivityLowPct: leading?.sharePctLow ?? null,
    sensitivityHighPct: leading?.sharePctHigh ?? null,
  });

  return [districtSignal(year, selectedDistrict, ageBand, sex), lifeStage, laborSignal, industrySignal, wageSignal];
}

function optionSet(signal: PolicySignal) {
  const pilot = signal.policyTools[0] ?? "先補齊必要資料並建立監測基線";
  return [
    { title: "維持現況", detail: `不新增措施；持續追蹤${signal.monitoring.slice(0, 2).join("、")}。` },
    { title: "最低調整", detail: signal.policyTools[1] ?? "改善既有資料蒐集與服務流程，不擴大資源。" },
    { title: "小規模試辦", detail: `${pilot}；先訂對照基準、期間、成本與停止條件。` },
  ];
}

const roamefStages = [
  { code: "R", title: "釐清問題", action: "這個訊號是否值得處理？", output: "問題範圍與不介入風險", support: "查看資料訊號、相對位置與限制" },
  { code: "O", title: "設定目標", action: "希望誰在何時改善多少？", output: "指標、基準值與期限", support: "把政策問題改寫成可追蹤成果" },
  { code: "A", title: "比較做法", action: "維持現況、調整或試辦，哪個較合適？", output: "選項、成本與取捨", support: "並列三種做法，不直接指定答案" },
  { code: "M", title: "安排追蹤", action: "由誰、多久、用什麼資料追蹤？", output: "監測表與資料責任", support: "列出監測指標、頻率與主責單位" },
  { code: "E", title: "檢查結果", action: "方案有沒有達標，代價是什麼？", output: "成果、成本與不利影響", support: "先定比較基準與停止條件" },
  { code: "F", title: "決定下一步", action: "續辦、調整、擴大或停止？", output: "下一輪決策與修正紀錄", support: "把結果送回第一步重新檢查" },
] as const;

export function PolicyWorkbench(props: Props) {
  const districts = dashboardData.geographies.filter((item) => item.level === "DISTRICT").map((item) => geographyLabel(item.name));
  const resolvedDistrict = props.district === "新北市" ? "板橋區" : props.district;
  const signals = useMemo(() => citySignals(props.year, props.ageBand, props.sex, resolvedDistrict).sort((a, b) => stateOrder[a.state] - stateOrder[b.state]), [props.year, props.ageBand, props.sex, resolvedDistrict]);
  const districtSignals = useMemo(() => districts.map((district) => districtSignal(props.year, district, props.ageBand, props.sex)).sort((a, b) => stateOrder[a.state] - stateOrder[b.state]), [props.year, props.ageBand, props.sex]);
  const [selectedId, setSelectedId] = useState(signals[0]?.id ?? "");
  const [activeRoamefCode, setActiveRoamefCode] = useState<(typeof roamefStages)[number]["code"]>("R");
  const selected = signals.find((signal) => signal.id === selectedId) ?? signals[0];
  const activeRoamef = roamefStages.find((stage) => stage.code === activeRoamefCode) ?? roamefStages[0];
  const priorities = districtSignals.filter((signal) => signal.state === "已觸發").slice(0, 5);
  const stateCounts = signals.reduce<Record<string, number>>((acc, signal) => ({ ...acc, [statusDisplay(signal.state).label]: (acc[statusDisplay(signal.state).label] ?? 0) + 1 }), {});

  return <div className="policy-workbench">
    <section className="policy-context-bar section-shell" aria-labelledby="policy-context-title">
      <div><p className="kicker">G6-POL V2｜僅限決策內網</p><h2 id="policy-context-title">先形成政策問題，再比較可行選項</h2><p>這裡把各資料頁的判讀集中管理。訊號只決定查核順序；沒有成本、成果與比較基準時，不自動核定方案。</p></div>
      <div className="policy-context-controls">
        <label>年度<select value={props.year} onChange={(event) => props.onYearChange(Number(event.target.value))}>{dashboardData.meta.years.map((year) => <option key={year} value={year}>{year}年</option>)}</select></label>
        <label>年齡<select value={props.ageBand} onChange={(event) => props.onAgeBandChange(event.target.value as AgeBand)}>{dashboardData.meta.ageBands.map((band) => <option key={band} value={band}>{ageBandLabel(band)}</option>)}</select></label>
        <label>性別<select value={props.sex} onChange={(event) => props.onSexChange(event.target.value as Sex)}>{dashboardData.meta.sexes.map((sex) => <option key={sex} value={sex}>{sex}</option>)}</select></label>
        <label>行政區<select value={resolvedDistrict} onChange={(event) => props.onDistrictChange(event.target.value)}>{districts.map((district) => <option key={district} value={district}>{district}</option>)}</select></label>
      </div>
    </section>

    <section className="policy-readiness-grid" aria-label="政策訊號總覽">
      <article><span>本次檢查</span><strong>{signals.length}<small>項</small></strong><p>{props.year}年・{ageBandLabel(props.ageBand)}・{props.sex}</p></article>
      <article><span>優先盤點</span><strong>{stateCounts["優先盤點"] ?? 0}<small>項</small></strong><p>達到版本化觸發門檻</p></article>
      <article><span>持續監測</span><strong>{stateCounts["持續監測"] ?? 0}<small>項</small></strong><p>尚未達雙重或保守門檻</p></article>
      <article><span>資料待補</span><strong>{stateCounts["資料待補"] ?? 0}<small>項</small></strong><p>缺少同年度或決策必要證據</p></article>
    </section>

    <section className="roamef-section section-shell" aria-labelledby="roamef-title">
      <div className="section-heading"><div><p className="kicker">政策研判六步驟</p><h2 id="roamef-title">先找問題，再決定是否試辦</h2><p className="roamef-intro">點選一步，查看要回答的問題與應留下的紀錄。</p></div><span className="method-badge">參考英國評估流程</span></div>
      <ol className="roamef-flow">
        {roamefStages.map((stage) => <li key={stage.code} className={activeRoamef.code === stage.code ? "is-active" : undefined}>
          <button type="button" aria-pressed={activeRoamef.code === stage.code} onClick={() => setActiveRoamefCode(stage.code)}>
            <b aria-hidden="true">{stage.code}</b><span><strong>{stage.title}</strong><small>{stage.output}</small></span>
          </button>
        </li>)}
      </ol>
      <article className="roamef-stage-detail" aria-live="polite">
        <header><span>目前步驟</span><strong><b aria-hidden="true">{activeRoamef.code}</b>{activeRoamef.title}</strong></header>
        <dl><div><dt>要回答</dt><dd>{activeRoamef.action}</dd></div><div><dt>完成後留下</dt><dd>{activeRoamef.output}</dd></div><div><dt>本頁怎麼支援</dt><dd>{activeRoamef.support}</dd></div></dl>
      </article>
      <p className="roamef-loop-note"><strong>完成 F 後：</strong>把結果送回 R，重新確認問題是否仍存在。</p>
      <details className="roamef-method-details"><summary>查看方法來源與使用界線</summary><p>本頁借用 ROAMEF 的順序整理研判紀錄，不代表已完成法規遵循、因果評估或成本效益分析。</p><div className="uk-guidance-links">{ukPolicyGuidance.map((item) => <a key={item.name} href={item.url} target="_blank" rel="noreferrer"><strong>{item.name}</strong><span>{item.role}</span></a>)}</div></details>
    </section>

    <div className="policy-main-grid">
      <section className="policy-signal-list section-shell" aria-labelledby="policy-signal-title">
        <div className="section-heading"><div><p className="kicker">證據分流</p><h2 id="policy-signal-title">五個面向，各自保留母體與限制</h2></div></div>
        <div className="policy-card-stack">{signals.map((signal) => {
          const display = statusDisplay(signal.state);
          return <article key={signal.id} className={`policy-work-card ${display.className} ${selected?.id === signal.id ? "is-selected" : ""}`}>
            <button type="button" className="policy-card-select" onClick={() => setSelectedId(signal.id)} aria-pressed={selected?.id === signal.id}>
              <span className="policy-card-state"><i aria-hidden="true">{display.icon}</i>{display.label}</span><strong>{signal.title}</strong><small>{signal.signal}</small>
            </button>
            <dl><div><dt>資料訊號</dt><dd>{signal.relativePosition}</dd></div><div><dt>可選工具</dt><dd>{signal.policyTools.slice(0, 2).join("；")}</dd></div><div><dt>主責／協辦</dt><dd>{signal.agencies}</dd></div><div><dt>後續監測</dt><dd>{signal.monitoring.slice(0, 3).join("、")}</dd></div></dl>
            <button type="button" className="text-button" onClick={() => props.onOpenSignal(signal)}>查看完整依據與限制</button>
          </article>;
        })}</div>
      </section>

      <aside className="policy-option-panel section-shell" aria-labelledby="option-panel-title">
        <p className="kicker">Green Book選項框架</p><h2 id="option-panel-title">{selected?.title ?? "先選一項訊號"}</h2>
        {selected && <><p className="policy-question"><strong>要回答的政策問題</strong>{selected.policyQuestion}</p><div className="policy-option-grid">{optionSet(selected).map((option) => <article key={option.title}><span>{option.title}</span><p>{option.detail}</p></article>)}</div><div className="policy-gate"><strong>尚不能指定首選方案</strong><p>{selected.decisionGate}</p></div><details><summary>查看評估與停止條件</summary><ul><li>試辦前登錄目標、對象、成本、基準值與資料責任。</li><li>有合理比較組或分階段導入時，才評估影響；否則只做過程與趨勢監測。</li><li>未達預先設定成果、成本過高或出現不利影響時，調整或停止。</li></ul></details></>}
      </aside>
    </div>

    <section className="district-priority-section section-shell" aria-labelledby="district-priority-title">
      <div className="section-heading"><div><p className="kicker">29區政策問題清單</p><h2 id="district-priority-title">只列出達到初篩門檻的行政區</h2></div><span>{priorities.length ? `前${priorities.length}項` : "目前未觸發"}</span></div>
      {priorities.length ? <div className="table-scroll"><table><thead><tr><th>行政區訊號</th><th>觸發原因</th><th>下一個政策問題</th><th>動作</th></tr></thead><tbody>{priorities.map((signal) => <tr key={signal.title}><td><strong>{signal.title}</strong></td><td>{signal.relativePosition}</td><td>{signal.policyQuestion}</td><td><button type="button" className="text-button" onClick={() => props.onOpenSignal(signal)}>查看</button></td></tr>)}</tbody></table></div> : <p className="empty-policy-state">目前條件下，29區沒有達到優先盤點門檻；維持同口徑監測，不為了填滿版面產生建議。</p>}
    </section>

    <section className="source-freshness-section section-shell" aria-labelledby="source-freshness-title">
      <div className="section-heading"><div><p className="kicker">最新來源查核｜{sourceVerifiedAt}</p><h2 id="source-freshness-title">能做到什麼，取決於同口徑資料是否已發布</h2></div></div>
      <div className="source-status-grid">{policySourceStatus.map((source) => <article key={source.id}><div><strong>{source.topic}</strong><span className={`source-status status-${source.status === "已是最新同口徑" ? "ready" : source.status === "最新年度背景" ? "context" : "waiting"}`}>{source.status}</span></div><dl><div><dt>官方最新</dt><dd>{source.latestOfficialPeriod}</dd></div><div><dt>儀表板使用</dt><dd>{source.dashboardPeriod}</dd></div><div><dt>數值身分</dt><dd>{source.identity}</dd></div></dl><p>{source.note}</p><a href={source.url} target="_blank" rel="noreferrer">開啟官方來源</a></article>)}</div>
      <p className="source-decision-boundary"><strong>目前可做：</strong>情勢監測、相對排序、政策問題形成、選項清單與試辦設計。<br /><strong>目前不能做：</strong>政策因果、方案成效、成本效益、個人需求判定或資源核定；這些仍需方案資料、成本、成果及評估設計。</p>
    </section>
  </div>;
}

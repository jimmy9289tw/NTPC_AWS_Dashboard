"use client";

import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { PolicyNarrativeWorkbench, PolicyStatusBoard } from "./policy-narrative-workbench";
import { buildPolicyInventory } from "./policy-synthesis";
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
import { collectIndustryPolicyInput } from "./policy-industry-input";
import { interpolateGradientColor, numericDomain, sequentialGradientColors } from "./map-metrics";
import { compoundAnnualGrowthRatePct, meanMedianGap, meanMedianGapSharePct } from "./wage-metrics";
import {
  higherEducationMarriedShare,
  educationMarriageShare,
  JOINT_EDUCATION_CATEGORIES,
  JOINT_MARRIAGE_CATEGORIES,
  JOINT_DATA_URL,
  type JointEducationMarriagePayload,
} from "./joint-education-marriage";

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
  onOpenChat: (question: string) => void;
  onAiContext?: (context: {year:number;ageBand:AgeBand;sex:Sex;district:string;view:string}|null) => void;
};

type PolicyScope = "district" | "city";
type WorkflowStep = "scope" | "map" | "context" | "roamef";
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

const stateOrder: Record<PolicySignalState, number> = { "已觸發": 0, "持續觀察": 1, "無法判定": 2, "目前未觸發": 3 };

type JointPolicyComparison = {
  key: string;
  districtPct: number;
  cityPct: number;
  conservativeGapPct: number;
  estimated: boolean;
  districtLowPct?: number;
  districtHighPct?: number;
  cityLowPct?: number;
  cityHighPct?: number;
  history?: import("./policy-narrative").JointComparison["history"];
  cells?: import("./policy-narrative").JointComparison["cells"];
};


function districtSignal(year: number, district: string, ageBand: AgeBand, sex: Sex, jointComparison: JointPolicyComparison | null) {
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
    higherEducationMarriedPct: jointComparison?.districtPct ?? null,
    cityHigherEducationMarriedPct: jointComparison?.cityPct ?? null,
    higherEducationMarriedConservativeGapPct: jointComparison?.conservativeGapPct ?? null,
    higherEducationMarriedEstimated: jointComparison?.estimated ?? false,
    maleSharePct: evidence.maleSharePct,
    cityMaleSharePct: evidence.cityMaleSharePct,
    genderDifferenceRank: evidence.genderDifferenceRank,
    demographicEstimated: evidence.demographicEstimated,
    serviceSiteCount: evidence.serviceSiteCount,
    activeServiceSiteCount: evidence.activeServiceSiteCount,
    districtExposureIntensity: null,
  });
}

export function citywideSignals(year: number, ageBand: AgeBand, sex: Sex) {
  const years = dashboardData.meta.years;
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

  const latestWageYear = dashboardData.wage.filter((row) => row.ageBand === ageBand && row.year <= year).reduce<number | null>((latest, row) => latest == null || row.year > latest ? row.year : latest, null);
  const earliestWageYear = dashboardData.wage.filter((row) => row.ageBand === ageBand && row.year <= year).reduce<number | null>((earliest, row) => earliest == null || row.year < earliest ? row.year : earliest, null);
  const latestWage = latestWageYear == null ? undefined : getWage(latestWageYear, ageBand);
  const earliestWage = earliestWageYear == null ? undefined : getWage(earliestWageYear, ageBand);
  const wageSignal = buildWagePolicySignal({
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

  const industrySignal = buildIndustryPolicySignal(collectIndustryPolicyInput(year, ageBand, sex).input);

  return [lifeStage, laborSignal, industrySignal, wageSignal].sort((a, b) => stateOrder[a.state] - stateOrder[b.state]);
}


function allCoordinates(geometry: Geometry): Position[] {
  return geometry.type === "Polygon" ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
}

function projectMapPoint([lon, lat]: Position, bounds: { minX: number; minY: number; maxX: number; maxY: number }): Position {
  const width = 720;
  const height = 520;
  const pad = 22;
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

function DistrictPicker({ onChoose }: { onChoose: (district: string) => void }) {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const year = dashboardData.meta.defaultYear;
  const ageBand = dashboardData.meta.defaultAgeBand;
  const sex = dashboardData.meta.defaultSex;

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
        setLoadError("行政區地圖暫時無法載入，請使用下方行政區清單。");
      });
    return () => controller.abort();
  }, []);

  const records = useMemo(() => dashboardData.registered.filter((row) => row.year === year && row.ageBand === ageBand && row.sex === sex && row.geography !== "新北市"), [year, ageBand, sex]);
  const recordMap = useMemo(() => new Map(records.map((record) => [geographyLabel(record.geography), record])), [records]);
  const pooled = useMemo(() => dashboardData.registered.filter((row) => row.ageBand === ageBand && row.sex === sex && row.geography !== "新北市").map((row) => row.population), [ageBand, sex]);
  const domain = numericDomain(pooled);
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
  const ranked = useMemo(() => [...records].sort((a, b) => b.population - a.population), [records]);
  const hoveredRecord = hovered ? recordMap.get(hovered) : undefined;
  const hoveredRank = hovered ? ranked.findIndex((row) => geographyLabel(row.geography) === hovered) + 1 : null;
  const handleKey = (event: KeyboardEvent<SVGPathElement>, district: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onChoose(district);
    }
  };

  return <section className="policy-map-step section-shell" aria-labelledby="policy-map-step-title">
    <header className="policy-step-heading">
      <div><span>行政區建議・第1步</span><h2 id="policy-map-step-title">先選要研判的行政區</h2><p>地圖只用來選區。顏色依{year}年{ageBandLabel(ageBand)}戶籍人口定位，不代表政策風險。</p></div>
      <div className="policy-map-hover" aria-live="polite"><small>目前指向</small><strong>{hovered ?? "請移到地圖上"}</strong><span>{hoveredRecord ? `${hoveredRecord.population.toLocaleString("zh-TW")}人・第${hoveredRank}名／29區` : `${year}年・${ageBandLabel(ageBand)}・${sex}`}</span></div>
    </header>
    <div className="policy-map-canvas">
      {loadError && <p role="alert" className="error-message">{loadError}</p>}
      {!geojson && !loadError && <div className="map-skeleton" aria-label="行政區地圖載入中" />}
      {geojson && bounds && <svg viewBox="0 0 720 520" role="group" aria-label="新北市29行政區選擇地圖">
        {features.map((feature) => {
          const name = feature.properties.TOWNNAME;
          const record = recordMap.get(name);
          const fill = record ? interpolateGradientColor(record.population, domain.min, domain.max, sequentialGradientColors) : "#E5E9EC";
          return <path
            key={name}
            d={featurePath(feature, bounds)}
            fill={fill}
            fillRule="evenodd"
            className={hovered === name ? "policy-picker-district is-hovered" : "policy-picker-district"}
            tabIndex={0}
            role="button"
            aria-label={`${name}，${record ? `${record.population.toLocaleString("zh-TW")}人` : "尚無資料"}，按Enter選取`}
            onMouseEnter={() => setHovered(name)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(name)}
            onBlur={() => setHovered(null)}
            onClick={() => onChoose(name)}
            onKeyDown={(event) => handleKey(event, name)}
          ><title>{name}</title></path>;
        })}
      </svg>}
    </div>
    <div className="policy-map-legend" aria-label="戶籍青年人口連續漸層圖例">
      <span>戶籍青年人口較少</span><i style={{ background: `linear-gradient(90deg, ${sequentialGradientColors.join(", ")})` }} /><span>戶籍青年人口較多</span>
    </div>
    <details className="policy-district-list"><summary>改用行政區清單選擇</summary><div>{ranked.map((row) => {
      const name = geographyLabel(row.geography);
      return <button type="button" key={name} onClick={() => onChoose(name)}>{name}<small>{row.population.toLocaleString("zh-TW")}人</small></button>;
    })}</div></details>
  </section>;
}

function ScopeIcon({ kind }: { kind: PolicyScope }) {
  return kind === "district"
    ? <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 11h13v12H8zM27 7h13v16H27zM8 29h13v12H8zM27 29h13v12H27z" /><path d="M21 17h6M14.5 23v6M33.5 23v6" /></svg>
    : <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 39h32M12 35V21h7v14M21 35V13h7v22M30 35V7h7v28" /><path d="m10 15 8-6 7 3 12-8" /></svg>;
}

function ScopeChooser({ onChoose }: { onChoose: (scope: PolicyScope) => void }) {
  return <section className="policy-scope-chooser section-shell" aria-labelledby="policy-scope-title">
    <header><p className="kicker">僅限決策內網</p><h2 id="policy-scope-title">這次要研判哪個範圍？</h2><p>先選範圍，系統才會顯示相符的資料與政策問題。</p></header>
    <div className="policy-scope-grid">
      <button type="button" onClick={() => onChoose("district")}>
        <ScopeIcon kind="district" /><span><small>分流1</small><strong>行政區建議</strong><em>從29區地圖選區，再設定年度與青年年齡。</em></span><b aria-hidden="true">→</b>
      </button>
      <button type="button" onClick={() => onChoose("city")}>
        <ScopeIcon kind="city" /><span><small>分流2</small><strong>新北市建議</strong><em>設定年度與青年年齡，整合全市戶籍、勞動、行業與薪資訊號。</em></span><b aria-hidden="true">→</b>
      </button>
    </div>
    <aside><strong>資料邊界</strong><p>行政區流程只呈現戶籍人口、教育、婚姻、男女與據點清冊等區級證據；全市勞動、行業與薪資不在行政區流程顯示，也不分攤成行政區數值。</p></aside>
  </section>;
}

function StepIndicator({ scope, step }: { scope: PolicyScope; step: WorkflowStep }) {
  const steps = scope === "district"
    ? [{ key: "map", label: "選行政區" }, { key: "context", label: "設定情境" }, { key: "roamef", label: "政策研判" }]
    : [{ key: "context", label: "設定情境" }, { key: "roamef", label: "政策研判" }];
  const currentIndex = Math.max(0, steps.findIndex((item) => item.key === step));
  return <ol className="policy-step-indicator" aria-label="政策研判進度">{steps.map((item, index) => <li key={item.key} className={index === currentIndex ? "is-current" : index < currentIndex ? "is-complete" : undefined} aria-current={index === currentIndex ? "step" : undefined}><b>{index + 1}</b><span>{item.label}</span></li>)}</ol>;
}

function ContextStep({ scope, district, year, ageBand, sex, onYearChange, onAgeBandChange, onSexChange, onContinue, onBack }: {
  scope: PolicyScope;
  district: string;
  year: number;
  ageBand: AgeBand;
  sex: Sex;
  onYearChange: (value: number) => void;
  onAgeBandChange: (value: AgeBand) => void;
  onSexChange: (value: Sex) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const scopeLabel = scope === "district" ? district : "新北市全市";
  return <section className="policy-context-step section-shell" aria-labelledby="policy-context-step-title">
    <header className="policy-step-heading"><div><span>{scope === "district" ? "行政區建議" : "新北市建議"}・設定情境</span><h2 id="policy-context-step-title">要看哪一段時間與青年？</h2><p>條件確認後才產生ROAMEF研判，避免尚未選定範圍就混入不相符的訊號。</p></div><strong className="policy-selected-scope">{scopeLabel}</strong></header>
    <div className="policy-context-form">
      <label>年度<select value={year} onChange={(event) => onYearChange(Number(event.target.value))}>{dashboardData.meta.years.map((item) => <option key={item} value={item}>{item}年</option>)}</select><small>使用該年度可發布資料；缺值不代填。</small></label>
      <label>年齡<select value={ageBand} onChange={(event) => onAgeBandChange(event.target.value as AgeBand)}>{dashboardData.meta.ageBands.map((item) => <option key={item} value={item}>{ageBandLabel(item)}</option>)}</select><small>18–35歲為核心青年；三個分組用於生命階段比較。</small></label>
      <label>性別<select value={sex} onChange={(event) => onSexChange(event.target.value as Sex)}>{dashboardData.meta.sexes.map((item) => <option key={item} value={item}>{item}</option>)}</select><small>{scope === "district" ? "行政區戶籍證據依所選性別呈現。" : "勞動與薪資若無同性別口徑，會明確標示男女合計。"}</small></label>
    </div>
    <div className="policy-step-actions"><button type="button" className="secondary-button" onClick={onBack}>返回上一步</button><button type="button" className="primary-button" onClick={onContinue}>產生政策研判</button></div>
  </section>;
}


export function PolicyWorkflow(props: Props) {
  const [scope, setScope] = useState<PolicyScope | null>(null);
  const [step, setStep] = useState<WorkflowStep>("scope");
  const [initialCaseId, setInitialCaseId] = useState("");
  const [jointComparison, setJointComparison] = useState<JointPolicyComparison | null>(null);
  const [jointLoad, setJointLoad] = useState<{ key: string; status: "loading" | "ready" | "unavailable" }>({ key: "", status: "loading" });
  const resolvedDistrict = props.district === "新北市" ? "板橋區" : props.district;
  const jointComparisonKey = `${props.year}|${resolvedDistrict}|${props.ageBand}|${props.sex}`;
  const citySignals = useMemo(() => citywideSignals(props.year, props.ageBand, props.sex), [props.year, props.ageBand, props.sex]);
  const activeJointComparison = jointComparison?.key === jointComparisonKey ? jointComparison : null;
  const selectedDistrictSignal = useMemo(() => scope === "district" ? districtSignal(props.year, resolvedDistrict, props.ageBand, props.sex, activeJointComparison) : null, [scope, props.year, resolvedDistrict, props.ageBand, props.sex, activeJointComparison]);
  const signals = useMemo(() => scope === "district" ? (selectedDistrictSignal ? [selectedDistrictSignal] : []) : citySignals, [scope, selectedDistrictSignal, citySignals]);
  const previewCases = useMemo(() => scope && step === "context" ? buildPolicyInventory({ scope, district: resolvedDistrict, year: props.year, ageBand: props.ageBand, sex: props.sex }, signals, activeJointComparison) : [], [scope, step, resolvedDistrict, props.year, props.ageBand, props.sex, signals, activeJointComparison]);

  useEffect(() => {
    if (scope !== "district") return;
    const geography = dashboardData.geographies.find((item) => item.level === "DISTRICT" && geographyLabel(item.name) === resolvedDistrict);
    if (!geography) return;
    const controller = new AbortController();
    // The key guard already hides prior-context values and reports loading.
    // Preserve a valid same-key result while refreshing; update state on response.
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
      if (controller.signal.aborted) return;
      const cityEstimate = higherEducationMarriedShare(cityPayload, props.year, props.ageBand, props.sex);
      const districtEstimate = higherEducationMarriedShare(districtPayload, props.year, props.ageBand, props.sex);
      if (!cityEstimate || !districtEstimate) {
        setJointLoad({ key: jointComparisonKey, status: "unavailable" });
        return;
      }
      setJointComparison({
        key: jointComparisonKey,
        cells: JOINT_EDUCATION_CATEGORIES.flatMap(education => JOINT_MARRIAGE_CATEGORIES.map(marriage => ({ education, marriage,
          history: [props.year - 1, props.year].map(year => {
            const city = educationMarriageShare(cityPayload, year, props.ageBand, props.sex, education, marriage);
            const district = educationMarriageShare(districtPayload, year, props.ageBand, props.sex, education, marriage);
            return { year, cityPct: city?.value ?? null, districtPct: district?.value ?? null,
              cityLowPct: city?.low, cityHighPct: city?.high, districtLowPct: district?.low, districtHighPct: district?.high };
          })
        }))),
        history: [props.year - 1, props.year].map(year => {
          const city = higherEducationMarriedShare(cityPayload, year, props.ageBand, props.sex);
          const district = higherEducationMarriedShare(districtPayload, year, props.ageBand, props.sex);
          return { year, cityPct: city?.value ?? null, districtPct: district?.value ?? null,
            cityLowPct: city?.low, cityHighPct: city?.high, districtLowPct: district?.low, districtHighPct: district?.high };
        }),
        districtPct: districtEstimate.value,
        cityPct: cityEstimate.value,
        conservativeGapPct: cityEstimate.low - districtEstimate.high,
        estimated: districtEstimate.origin.includes("估計") || cityEstimate.origin.includes("估計"),
        districtLowPct: districtEstimate.low,
        districtHighPct: districtEstimate.high,
        cityLowPct: cityEstimate.low,
        cityHighPct: cityEstimate.high,
      });
      setJointLoad({ key: jointComparisonKey, status: "ready" });
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setJointComparison(null);
      setJointLoad({ key: jointComparisonKey, status: "unavailable" });
    });
    return () => controller.abort();
  }, [scope, props.year, props.ageBand, props.sex, resolvedDistrict, jointComparisonKey]);

  const chooseScope = (nextScope: PolicyScope) => {
    setScope(nextScope);
    setInitialCaseId("");
    setStep(nextScope === "district" ? "map" : "context");
  };
  const reset = () => {
    setScope(null);
    setStep("scope");
  };
  const chooseDistrict = (district: string) => {
    props.onDistrictChange(district);
    setStep("context");
  };

  return <div className="policy-workbench policy-workflow">
    {scope && <nav className="policy-workflow-toolbar" aria-label="政策研判流程控制"><button type="button" onClick={reset}>重新選擇分流</button><StepIndicator scope={scope} step={step} /></nav>}
    {step === "scope" && <ScopeChooser onChoose={chooseScope} />}
    {scope === "district" && step === "map" && <DistrictPicker onChoose={chooseDistrict} />}
    {scope && step === "context" && <ContextStep
      scope={scope}
      district={resolvedDistrict}
      year={props.year}
      ageBand={props.ageBand}
      sex={props.sex}
      onYearChange={props.onYearChange}
      onAgeBandChange={props.onAgeBandChange}
      onSexChange={props.onSexChange}
      onContinue={() => setStep("roamef")}
      onBack={() => setStep(scope === "district" ? "map" : "scope")}
    />}
    {scope && step === "roamef" && <PolicyNarrativeWorkbench
      key={[scope, resolvedDistrict, props.year, props.ageBand, props.sex].join("|")}
      context={{ scope, district: resolvedDistrict, year: props.year, ageBand: props.ageBand, sex: props.sex }}
      signals={signals}
      jointComparison={activeJointComparison}
      initialCaseId={initialCaseId}
      jointStatus={jointLoad.key === jointComparisonKey ? jointLoad.status : "loading"}
      onOpenChat={props.onOpenChat}
      onBack={() => setStep("context")}
    />}
    {scope && step === "context" && <div className="pn-workbench"><PolicyStatusBoard
      context={{ scope, district: resolvedDistrict, year: props.year, ageBand: props.ageBand, sex: props.sex }}
      cases={previewCases}
      onSelect={(id) => { setInitialCaseId(id); setStep("roamef"); }}
    /></div>}
  </div>;
}

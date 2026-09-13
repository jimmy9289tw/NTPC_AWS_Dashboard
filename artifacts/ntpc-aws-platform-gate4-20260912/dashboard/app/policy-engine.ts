export type PolicySignalState = "已觸發" | "持續觀察" | "目前未觸發" | "無法判定";

export type PolicySignal = {
  id: string;
  title: string;
  state: PolicySignalState;
  signal: string;
  relativePosition: string;
  supportedInterpretation: string;
  unsupportedConclusion: string;
  policyQuestion: string;
  recommendedAction: string;
  actionBasis: string[];
  decisionGate: string;
  evidenceDomains: string[];
  policyTools: string[];
  agencies: string;
  monitoring: string[];
  missingData: string[];
  rule: string;
};

type DistrictSignalInput = {
  district: string;
  ageLabel: string;
  population: number | null;
  rank: number | null;
  districtCount: number;
  sharePct: number | null;
  citySharePct: number | null;
  yearChangePct: number | null;
  windowChangePct: number | null;
  windowPopulationChange?: number | null;
  windowStartYear?: number;
  windowEndYear?: number;
  growthRank?: number | null;
  growingDistrictCount?: number | null;
  positiveAnnualIntervals?: number | null;
  annualIntervalCount?: number | null;
  educationLowerPct?: number | null;
  cityEducationLowerPct?: number | null;
  educationConservativeGapPct?: number | null;
  educationDifferenceRank?: number | null;
  marriedPct?: number | null;
  cityMarriedPct?: number | null;
  marriageConservativeGapPct?: number | null;
  marriageDifferenceRank?: number | null;
  higherEducationMarriedPct?: number | null;
  cityHigherEducationMarriedPct?: number | null;
  higherEducationMarriedConservativeGapPct?: number | null;
  higherEducationMarriedEstimated?: boolean;
  maleSharePct?: number | null;
  cityMaleSharePct?: number | null;
  genderDifferenceRank?: number | null;
  demographicEstimated?: boolean;
  serviceSiteCount?: number;
  activeServiceSiteCount?: number;
  districtExposureIntensity?: number | null;
};

type LaborSignalInput = {
  ageLabel: string;
  unemploymentRate: number | null;
  previousUnemploymentRate: number | null;
  fiveYearMedian: number | null;
  laborParticipationRate: number | null;
};

type WageSignalInput = {
  ageLabel: string;
  selectedYear: number;
  latestYear: number | null;
  latestMean: number | null;
  latestMedian: number | null;
  latestGap: number | null;
  latestGapSharePct: number | null;
  firstGapSharePct: number | null;
  meanCagrPct: number | null;
  contributionWage: number | null;
  contributionDifferenceFromNationalPct: number | null;
  contributionCountyRank: number | null;
  contributionCountyCount: number | null;
  identity: string;
  medianIdentity: string;
};

type LifeStageSignalInput = {
  district: string;
  ageLabel: string;
  leadingEducation: string | null;
  leadingEducationPct: number | null;
  leadingMarriage: string | null;
  leadingMarriagePct: number | null;
  estimated: boolean;
};

export type IndustrySignalInput = {
  ageLabel: string;
  sexLabel: string;
  industry: string;
  currentSharePct: number | null;
  previousSharePct: number | null;
  threeYearShares: Array<number | null>;
  topFiveSharePct: number | null;
  previousTopFiveSharePct: number | null;
  lifeStageShares: number[];
  maleSharePct: number | null;
  femaleSharePct: number | null;
  previousMaleSharePct: number | null;
  previousFemaleSharePct: number | null;
  sensitivityLowPct: number | null;
  sensitivityHighPct: number | null;
};

const pct = (value: number | null, digits = 2) => value == null
  ? "尚無資料"
  : `${new Intl.NumberFormat("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}%`;

const integer = (value: number | null) => value == null
  ? "尚無資料"
  : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(value);

const points = (value: number) => new Intl.NumberFormat("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));

export function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function buildDistrictPolicySignal(input: DistrictSignalInput): PolicySignal {
  const topQuartileCutoff = Math.max(1, Math.ceil(input.districtCount * 0.25));
  const upperHalfCutoff = Math.max(1, Math.ceil(input.districtCount * 0.5));
  const hasRequired = input.population != null && input.rank != null && input.districtCount > 0;
  const hasGrowthEvidence = input.windowChangePct != null
    && input.growthRank != null
    && input.positiveAnnualIntervals != null
    && input.annualIntervalCount != null
    && input.annualIntervalCount > 0;
  const leadingGrowth = hasGrowthEvidence
    && input.windowChangePct! > 0
    && input.growthRank! <= topQuartileCutoff;
  const sustainedGrowth = hasGrowthEvidence
    && input.positiveAnnualIntervals! / input.annualIntervalCount! >= 0.75;
  const populationScaleTrigger = hasRequired && input.rank! <= topQuartileCutoff;
  const populationTrendTrigger = Boolean(leadingGrowth && sustainedGrowth);
  const noActiveOfficialSite = input.activeServiceSiteCount === 0;
  const siteAssessmentTrigger = Boolean(populationTrendTrigger && noActiveOfficialSite);
  const educationGap = input.educationLowerPct != null && input.cityEducationLowerPct != null
    ? input.educationLowerPct - input.cityEducationLowerPct
    : null;
  const educationTrigger = educationGap != null
    && educationGap >= 2
    && (!input.demographicEstimated || (input.educationConservativeGapPct != null && input.educationConservativeGapPct > 0))
    && input.educationDifferenceRank != null
    && input.educationDifferenceRank <= topQuartileCutoff;
  const marriageGap = input.marriedPct != null && input.cityMarriedPct != null
    ? input.marriedPct - input.cityMarriedPct
    : null;
  const marriageTrigger = marriageGap != null
    && marriageGap >= 2
    && (!input.demographicEstimated || (input.marriageConservativeGapPct != null && input.marriageConservativeGapPct > 0))
    && input.marriageDifferenceRank != null
    && input.marriageDifferenceRank <= topQuartileCutoff;
  const higherEducationMarriedGap = input.higherEducationMarriedPct != null && input.cityHigherEducationMarriedPct != null
    ? input.higherEducationMarriedPct - input.cityHigherEducationMarriedPct
    : null;
  const higherEducationMarriageTrigger = higherEducationMarriedGap != null
    && higherEducationMarriedGap <= -2
    && (!input.higherEducationMarriedEstimated
      || (input.higherEducationMarriedConservativeGapPct != null && input.higherEducationMarriedConservativeGapPct > 0));
  const genderGap = input.maleSharePct != null && input.cityMaleSharePct != null
    ? input.maleSharePct - input.cityMaleSharePct
    : null;
  const genderTrigger = genderGap != null
    && Math.abs(genderGap) >= 1
    && input.genderDifferenceRank != null
    && input.genderDifferenceRank <= topQuartileCutoff;
  const triggered = Boolean(populationScaleTrigger || populationTrendTrigger || educationTrigger || marriageTrigger || higherEducationMarriageTrigger || genderTrigger || siteAssessmentTrigger);
  const state: PolicySignalState = !hasRequired
    ? "無法判定"
    : triggered
      ? "已觸發"
      : input.rank! <= upperHalfCutoff
        ? "持續觀察"
        : "目前未觸發";
  const cityComparison = input.sharePct == null || input.citySharePct == null
    ? "尚無全市占比基準"
    : `${input.sharePct >= input.citySharePct ? "高於或等於" : "低於"}全市${pct(input.citySharePct)}基準`;
  const windowLabel = input.windowStartYear != null && input.windowEndYear != null
    ? `${input.windowStartYear}至${input.windowEndYear}年`
    : "展示期間";
  const growthContext = hasGrowthEvidence
    ? `${windowLabel}青年人口${input.windowChangePct! >= 0 ? "增加" : "減少"}${integer(Math.abs(input.windowPopulationChange ?? 0))}人（${pct(input.windowChangePct)}），變動率在${input.districtCount}區排名第${input.growthRank}；${input.positiveAnnualIntervals}/${input.annualIntervalCount}個年度區間呈現增加；全市有${input.growingDistrictCount ?? "尚無資料"}區為正成長`
    : "尚無足夠年度序列建立成長排序";
  const demographicIdentity = input.demographicEstimated ? "；行政區教育與婚姻為PCLM、IPF校準推估" : "";
  const recommendations: Array<{ domain: string; action: string; tool: string; basis: string; question?: string; gate?: string }> = [];
  if (higherEducationMarriageTrigger) recommendations.push({
    domain: "教育×婚姻",
    action: `在${input.district}既有公共空間試辦4場「青年交流與社群連結」活動，其中可安排自願參加的單身青年主題交流；先用報名與到場結果判斷是否續辦。`,
    tool: "以4場小規模試辦比較興趣社群、跨校跨業交流與自願聯誼三種形式，逐場記錄報名、到場、滿意度及後續參與意願",
    basis: `${input.district}大學及研究所青年有偶率為${pct(input.higherEducationMarriedPct)}，低於全市${pct(input.cityHigherEducationMarriedPct)}共${points(higherEducationMarriedGap!)}個百分點${input.higherEducationMarriedEstimated ? "；此為PCLM＋IPF模型估計" : ""}${input.higherEducationMarriedConservativeGapPct != null ? `；兩套模型結果的保守包絡仍低${points(input.higherEducationMarriedConservativeGapPct)}個百分點` : ""}。`,
    question: "青年是否有擴大在地社交連結的意願？哪一種活動形式能帶來較高到場與持續參與？",
    gate: "試辦前須完成自願參與、個資保護與不歧視設計；婚姻狀態不作績效目標。試辦後依報名、到場、滿意度、後續參與意願與單位成本決定續辦、調整或停止。",
  });
  if (siteAssessmentTrigger) recommendations.push({
    domain: "青年據點",
    action: `在${input.district}交通便利的既有公共空間試辦6個月「青年巡迴服務日」，每月至少2場，提供職涯諮詢、社群交流及需求登記；再用實際使用量判斷是否需要固定據點。`,
    tool: "以6個月巡迴服務日取得報名、到場、重複使用、轉介完成、交通時間與每服務人次成本，再與共用空間及固定據點方案比較",
    basis: `${growthContext}；官方青年服務據點清冊目前有${input.activeServiceSiteCount ?? 0}處營運中據點（清冊共${input.serviceSiteCount ?? 0}處）。`,
    question: "巡迴服務的實際使用量與交通可近性，是否足以支持共用空間或固定據點？",
    gate: "巡迴試辦可先運用既有場地；正式新增固定據點前，須完成青年需求調查、交通可近性、既有服務、預估使用量、經費與替代方案比較。",
  });
  if (populationTrendTrigger && !siteAssessmentTrigger) recommendations.push({
    domain: "人口趨勢",
    action: `在${input.district}既有服務點加開3個月晚間或假日青年服務時段，並用三個年齡層的報名與到場差異決定後續時段。`,
    tool: "試辦晚間與假日時段各至少3場，按18–24、25–29、30–35歲記錄曝光、報名、到場與轉介結果",
    basis: growthContext,
    question: "青年人口增加後，哪個年齡層與哪個服務時段出現可驗證的新增需求？",
    gate: "只有新增時段的到場與服務完成量高於既有時段，且單位成本可接受，才擴大辦理。",
  });
  if (educationTrigger) recommendations.push({
    domain: "教育程度",
    action: `在${input.district}試辦一梯次「職涯導航＋技能證照」課程，保留名額給高中職及以下青年，並串接就業媒合或進修諮詢。`,
    tool: "辦理一梯次8至12週職涯與技能課程，按教育程度追蹤報名、到場、完成及三個月後就業或進修結果",
    basis: `${input.district}高中職及以下占${pct(input.educationLowerPct)}，高於全市${pct(input.cityEducationLowerPct)}共${points(educationGap!)}個百分點，在${input.districtCount}區差距排名第${input.educationDifferenceRank}${demographicIdentity}${input.educationConservativeGapPct != null ? `；敏感度範圍下，區級下限仍高於全市上限${points(input.educationConservativeGapPct)}個百分點` : ""}。`,
    question: "課程能否提高目標教育群體的完成率，以及三個月後就業或進修比例？",
    gate: "先訂完成率、三個月後就業或進修結果與單位成本；若目標群體觸及不足，先調整招募與課程，不直接擴大。",
  });
  if (marriageTrigger) recommendations.push({
    domain: "婚姻狀態",
    action: `在${input.district}每月試辦1場「居住、照顧與職涯整合諮詢」，讓青年一次取得跨局處資訊與轉介。`,
    tool: "以3個月整合諮詢試辦記錄諮詢主題、完成轉介比例、等待時間、滿意度與重複求助情形",
    basis: `${input.district}有偶占${pct(input.marriedPct)}，高於全市${pct(input.cityMarriedPct)}共${points(marriageGap!)}個百分點，在${input.districtCount}區差距排名第${input.marriageDifferenceRank}${demographicIdentity}${input.marriageConservativeGapPct != null ? `；敏感度範圍下，區級下限仍高於全市上限${points(input.marriageConservativeGapPct)}個百分點` : ""}。`,
    question: "居住、照顧與職涯需求能否透過單一窗口更快完成轉介？",
    gate: "婚姻狀態只用來設定可能的生命階段，不視為需求本身；須以實際諮詢主題、完成轉介與使用者回饋決定續辦。",
  });
  if (genderTrigger) {
    const districtFemaleShare = 100 - input.maleSharePct!;
    const cityFemaleShare = 100 - input.cityMaleSharePct!;
    const comparisonSex = genderGap! >= 0 ? "男性" : "女性";
    const districtShare = genderGap! >= 0 ? input.maleSharePct : districtFemaleShare;
    const cityShare = genderGap! >= 0 ? input.cityMaleSharePct : cityFemaleShare;
    recommendations.push({
      domain: "性別結構",
      action: `在${input.district}下一期既有方案試辦兩種招募管道與兩個服務時段，按性別比較從曝光到完成的轉換率。`,
      tool: "用3個月A/B招募與時段試辦建立曝光、報名、到場、完成及後續成果的性別漏斗",
      basis: `${input.district}${comparisonSex}占${pct(districtShare)}，全市為${pct(cityShare)}，相差${points(genderGap!)}個百分點；絕對差距在${input.districtCount}區排名第${input.genderDifferenceRank}。`,
      question: "不同招募管道與服務時段，是否能縮小目標性別在報名到完成階段的落差？",
      gate: "只調整服務觸及方式，不把人口性別比例當成應被改變的政策成果；擴大前須檢查轉換率、成本與使用者回饋。",
    });
  }
  if (populationScaleTrigger && !populationTrendTrigger) recommendations.push({
    domain: "人口規模",
    action: input.windowChangePct == null
        ? `人口規模位居前段；先在${input.district}辦理1場跨局處青年服務日，同步補齊年度序列與實際需求。`
      : input.windowChangePct < 0
        ? `青年人口規模仍居前段但五年呈下降；把${input.district}既有方案改為3個月小額招募測試，找出仍有需求的年齡層，不依人口總量擴點。`
        : `青年人口規模位居前段；在${input.district}以季度青年服務日測試實際需求，再決定是否調整資源。`,
    tool: "辦理季度青年服務日，計算每千名青年報名、到場、完成、30分鐘交通可達比例及每服務人次成本",
    basis: `${input.district}${input.ageLabel}戶籍人口${integer(input.population)}人，在${input.districtCount}區人口規模排名第${input.rank}；${growthContext}。`,
    question: "人口規模能否轉化為可觀察的服務使用量，而不是只停留在人口排名？",
    gate: "人口規模不能單獨支持擴增預算；須以實際報名、到場、完成、交通可近性與單位成本決定後續配置。",
  });
  const recommendedAction = recommendations[0]?.action ?? "目前未達優先盤點門檻；維持年度監測，若人口、教育、婚姻或性別結構跨過門檻再啟動需求查核。";
  const actionBasis = recommendations.length
    ? recommendations.map((item) => item.basis)
    : [`${input.district}${input.ageLabel}目前未達人口、教育、婚姻或性別結構的政策初篩門檻。`];
  const evidenceDomains = [...new Set([
    ...recommendations.map((item) => item.domain),
    ...(siteAssessmentTrigger ? ["人口趨勢"] : []),
  ])];
  const missingData = new Set<string>(["行政區青年需求調查與方案曝光、報名、到場及完成成果"]);
  if (populationTrendTrigger) missingData.add("青年遷入、遷出及就學就業原因");
  if (educationTrigger) missingData.add("方案參與者教育程度與服務後成果");
  if (marriageTrigger) missingData.add("居住與家庭支持需求及方案使用情形");
  if (higherEducationMarriageTrigger) missingData.add("青年社交連結需求、活動偏好、報名、到場與後續參與意願");
  if (genderTrigger) missingData.add("方案報名、參與及完成成果的性別交叉資料");
  if (siteAssessmentTrigger) {
    missingData.add("依行政區彙整的服務活動場次與參與人次");
    missingData.add("既有跨局處、民間及巡迴服務盤點");
    missingData.add("公共運輸30分鐘可達範圍與場地成本");
  }
  const agencies = new Set(["青年局"]);
  if (educationTrigger) { agencies.add("教育局"); agencies.add("勞工局"); }
  if (marriageTrigger) { agencies.add("社會局"); agencies.add("城鄉發展局"); }
  if (higherEducationMarriageTrigger) { agencies.add("社會局"); agencies.add("教育局"); agencies.add(`${input.district.replace(/區$/, "")}區公所`); }
  if (genderTrigger) agencies.add("社會局性別平等業務單位");
  if (siteAssessmentTrigger || populationTrendTrigger) { agencies.add("區公所"); agencies.add("民政局"); }
  return {
    id: "district-population-scale",
    title: `${input.district}${input.ageLabel}政策訊號`,
    state,
    signal: hasRequired
      ? `${input.district}${input.ageLabel}戶籍人口為${integer(input.population)}人。`
      : "目前篩選條件缺少可發布的行政區戶籍人口。",
    relativePosition: hasRequired
      ? `在${input.districtCount}區中人口排名第${input.rank}；青年占比${pct(input.sharePct)}，${cityComparison}；年增率${pct(input.yearChangePct)}。${growthContext}。`
      : "缺少人口、排名或行政區比較基準，無法建立相對位置。",
    supportedInterpretation: recommendations.length
      ? `目前可用${evidenceDomains.join("、")}的相對差異，提出有停止條件的小規模介入，並用實際參與與成果資料決定是否續辦。`
      : "目前只能持續描述人口與結構變化，尚未形成優先政策訊號。",
    unsupportedConclusion: siteAssessmentTrigger
      ? "人口與結構差異只能支持優先評估，不能證明個人需求或政策效果；人口增加且官方清冊未列據點，也不等於已證明服務不足或可直接核定設點。"
      : "人口、教育、婚姻與性別結構差異只能支持優先查核，不能直接推論個人需求、服務不足、政策效果或因果關係。",
    policyQuestion: recommendations[0]?.question ?? "哪些結構差異需要進一步用需求調查與方案成果資料確認？",
    recommendedAction,
    actionBasis,
    decisionGate: recommendations[0]?.gate ?? "調整方案前須以需求調查、方案參與及服務成果驗證結構差異，並由業務、統計及法制人員確認口徑與權責。",
    evidenceDomains,
    policyTools: recommendations.length
      ? [...recommendations.map((item) => item.tool), ...(siteAssessmentTrigger ? ["先用短期巡迴或共用空間試辦，記錄到場、重複使用與轉介結果"] : [])]
      : ["按年度更新人口與結構門檻", "補充方案曝光、報名、到場、完成及後續成果"],
    agencies: `建議由${[...agencies].join("、")}共同盤點；實際主責、協辦與適法性仍待承辦確認`,
    monitoring: [
      "月底青年人口、年增率與五年變動率",
      "18–24、25–29、30–35歲分齡變動",
      ...(educationTrigger ? ["各教育程度方案曝光、報名、到場、完成與後續成果"] : ["高中職及以下占比與全市差距"]),
      ...(marriageTrigger ? ["不同家庭形成階段的居住、照顧與職涯需求"] : ["婚姻狀態結構與全市差距"]),
      ...(higherEducationMarriageTrigger ? ["青年交流活動的報名、到場、滿意度及後續參與意願"] : []),
      ...(genderTrigger ? ["各性別方案曝光至完成的轉換率"] : ["男女占比與全市差距"]),
      ...(siteAssessmentTrigger ? ["據點營運狀態、分區活動場次、參與人次與每千名青年服務人次"] : ["既有方案使用量與交通可近性"]),
    ],
    missingData: [...missingData],
    rule: `行政區政策初篩規則V7：人口規模、人口趨勢、教育、婚姻、教育×婚姻及性別分開判讀。人口趨勢須為正成長、成長排序前${topQuartileCutoff}區且至少75%年度區間增加；高中職及以下或有偶占比須高於全市至少2個百分點、差距排名前${topQuartileCutoff}區，且推估敏感度範圍方向一致；大學及研究所青年有偶率須低於全市至少2個百分點，且模型估計時兩套模型包絡方向一致，才顯示青年交流試辦；男女占比相對全市的絕對差距須至少1個百分點且排名前${topQuartileCutoff}區。婚姻狀態只作生命階段與方案測試線索，不標示好壞，也不以結婚作績效。只有人口趨勢條件成立且官方清冊無營運中據點時，才進入巡迴服務與設點評估；未觸發面向不顯示。所有門檻都是政策排序與試辦規則，不是因果或核定標準。`,
  };
}

export function buildLaborPolicySignal(input: LaborSignalInput): PolicySignal {
  const hasRequired = input.unemploymentRate != null && input.fiveYearMedian != null;
  const rawAnnualChange = input.previousUnemploymentRate != null && input.unemploymentRate != null
    ? input.unemploymentRate - input.previousUnemploymentRate
    : null;
  const annualChange = rawAnnualChange != null && Math.abs(rawAnnualChange) < 0.005 ? 0 : rawAnnualChange;
  const rising = annualChange != null && annualChange > 0;
  const aboveMedian = hasRequired && input.unemploymentRate! > input.fiveYearMedian!;
  const state: PolicySignalState = !hasRequired
    ? "無法判定"
    : aboveMedian && rising
      ? "已觸發"
      : aboveMedian
        ? "持續觀察"
        : "目前未觸發";
  return {
    id: "labor-unemployment-movement",
    title: `${input.ageLabel}就業轉銜`,
    state,
    signal: hasRequired
      ? `${input.ageLabel}失業率為${pct(input.unemploymentRate)}，勞動力參與率為${pct(input.laborParticipationRate)}。`
      : "目前年度或年齡層缺少可發布勞動市場指標。",
    relativePosition: hasRequired
      ? `五年失業率中位數為${pct(input.fiveYearMedian)}；相較前一年${annualChange == null ? "尚無比較值" : annualChange === 0 ? "持平" : `${annualChange > 0 ? "增加" : "減少"}${points(annualChange)}個百分點`}。`
      : "缺少同口徑五年序列，無法建立趨勢基準。",
    supportedInterpretation: "可判讀新北市整體青年失業率與勞動參與的相對變化，作為就業轉銜服務的監測訊號。",
    unsupportedConclusion: "抽樣調查與模型換算不能證明個別政策造成失業率變動，也不能分攤成行政區數值。",
    policyQuestion: "是否需要進一步檢視求職轉銜、職涯服務及訓練供給與年齡層需求的落差？",
    recommendedAction: state === "已觸發"
      ? "先核對求職登記、媒合、訓練完成與三個月後就業結果，確認失業上升來自哪個轉銜環節。"
      : state === "持續觀察"
        ? "失業率高於五年中位數但未同時上升；維持監測，不直接擴大方案。"
        : "目前未達雙重門檻；維持同口徑年度監測。",
    actionBasis: [
      hasRequired ? `${input.ageLabel}失業率${pct(input.unemploymentRate)}，五年中位數${pct(input.fiveYearMedian)}。` : "目前缺少完整勞動指標。",
      annualChange == null ? "尚無前一年同口徑比較。" : `相較前一年${annualChange === 0 ? "持平" : `${annualChange > 0 ? "增加" : "減少"}${points(annualChange)}個百分點`}。`,
      input.laborParticipationRate == null ? "勞動力參與率尚無可比值。" : `同年勞動力參與率${pct(input.laborParticipationRate)}，需與失業率一起閱讀。`,
    ],
    decisionGate: "擴大方案前須核對職缺、技能需求、服務使用者成果及方案容量，且不得把全市數值分攤到行政區。",
    evidenceDomains: ["勞動市場"],
    policyTools: state === "已觸發"
      ? ["按年齡層建立求職登記→媒合→到職→三個月留任漏斗", "把未媒合職缺與求職者技能需求交叉比對", "盤點職涯諮詢及訓練候補、完訓與就業成果"]
      : ["維持失業率、勞參率與就業人口比率同口徑監測", "保留服務量與就業成果資料，供門檻觸發時查核"],
    agencies: "待政策承辦確認主責及協辦局處",
    monitoring: ["失業率及其相對五年中位數差距", "勞動力參與率與就業人口比率", "求職登記、媒合、到職與三個月留任率", "訓練報名、完訓與就業結果"],
    missingData: ["按青年年齡層的服務使用者成果追蹤", "職缺技能、求職技能與媒合結果交叉資料", "調查估計的標準誤或信賴區間", "可發布的行政區勞動市場資料"],
    rule: "趨勢規則V2：失業率同時高於五年中位數且較前一年上升才列為優先盤點；只高於中位數列為持續監測。門檻只啟動原因查核，不直接證明方案不足。",
  };
}

export function evaluateIndustryPolicyConditions(input: IndustrySignalInput) {
  const required = input.currentSharePct != null && input.topFiveSharePct != null;
  const validThreeYear = input.threeYearShares.filter((value): value is number => value != null);
  const threeYearMove = validThreeYear.length === 3 ? validThreeYear[2] - validThreeYear[0] : null;
  const sustainedDirection = validThreeYear.length === 3
    && ((validThreeYear[0] < validThreeYear[1] && validThreeYear[1] < validThreeYear[2])
      || (validThreeYear[0] > validThreeYear[1] && validThreeYear[1] > validThreeYear[2]));
  const topFiveMove = input.previousTopFiveSharePct == null || input.topFiveSharePct == null
    ? null
    : input.topFiveSharePct - input.previousTopFiveSharePct;
  const lifeStageSpread = input.lifeStageShares.length
    ? Math.max(...input.lifeStageShares) - Math.min(...input.lifeStageShares)
    : null;
  const currentSexGap = input.maleSharePct == null || input.femaleSharePct == null
    ? null
    : Math.abs(input.maleSharePct - input.femaleSharePct);
  const previousSexGap = input.previousMaleSharePct == null || input.previousFemaleSharePct == null
    ? null
    : Math.abs(input.previousMaleSharePct - input.previousFemaleSharePct);
  const wideningSexGap = currentSexGap != null && previousSexGap != null && currentSexGap - previousSexGap >= 1;
  const sensitivitySpan = input.sensitivityLowPct == null || input.sensitivityHighPct == null
    ? null
    : input.sensitivityHighPct - input.sensitivityLowPct;
  const sustainedMaterialMove = sustainedDirection && threeYearMove != null && Math.abs(threeYearMove) >= 1;
  const concentrationRise = topFiveMove != null && topFiveMove >= 1;
  const lifeStageDifference = lifeStageSpread != null && lifeStageSpread >= 3;
  const triggered = required && (sustainedMaterialMove || concentrationRise || wideningSexGap);
  const state: PolicySignalState = !required ? "無法判定" : triggered ? "已觸發" : "持續觀察";
  return { required, threeYearMove, sustainedDirection, topFiveMove, lifeStageSpread, currentSexGap, previousSexGap,
    sensitivitySpan, sustainedMaterialMove, concentrationRise, wideningSexGap, lifeStageDifference, triggered, state };
}

export function buildIndustryPolicySignal(input: IndustrySignalInput): PolicySignal {
  const { required, threeYearMove, topFiveMove, lifeStageSpread, currentSexGap, previousSexGap, sensitivitySpan,
    sustainedMaterialMove, concentrationRise, wideningSexGap, lifeStageDifference, triggered, state } = evaluateIndustryPolicyConditions(input);
  const directions = [
    sustainedMaterialMove ? `${input.industry}占比連續三年同向變動${points(threeYearMove!)}個百分點` : null,
    concentrationRise ? `前五大行業合計占比較前一年增加${points(topFiveMove!)}個百分點` : null,
    wideningSexGap ? `男女占比差距較前一年擴大${points(currentSexGap! - previousSexGap!)}個百分點` : null,
    lifeStageDifference ? `三個青年年齡層的${input.industry}占比差距為${points(lifeStageSpread!)}個百分點` : null,
  ].filter((value): value is string => value != null);
  return {
    id: "industry-youth-structure",
    title: `${input.ageLabel}${input.industry}行業結構`,
    state,
    signal: required
      ? `${input.ageLabel}${input.sexLabel}就業者中，${input.industry}占比為${pct(input.currentSharePct)}；前五大行業合計占比為${pct(input.topFiveSharePct)}。`
      : "目前條件缺少可發布的青年行業占比或集中度。",
    relativePosition: directions.length
      ? directions.join("；") + "。"
      : "三項主要條件均未達門檻。",
    supportedInterpretation: "可描述居住於新北市青年就業者的行業分布、集中度、生命階段差異與男女結構變化，作為後續需求查核的排序線索。",
    unsupportedConclusion: "行業占比不能直接證明缺工、低薪、工作品質或政策效果；居住地口徑也不能改寫為工作地位於新北市。",
    policyQuestion: triggered
      ? "這項結構變動是否同時出現在職缺、職業、工時、薪資與青年服務使用結果中？"
      : "目前是否需要補接職缺、職業、工時與薪資資料，建立更完整的青年職涯監測基線？",
    recommendedAction: triggered
      ? "先把觸發的行業、年齡與性別組合列入資料核對清單，再比對職缺需求、技能條件與服務結果。"
      : "維持同口徑年度監測；先補齊職缺、職業、工時與薪資資料，不依單一行業占比調整方案。",
    actionBasis: [
      required ? `${input.industry}目前占比${pct(input.currentSharePct)}，相較前一年${input.previousSharePct == null ? "無可比值" : `${input.currentSharePct! >= input.previousSharePct ? "增加" : "減少"}${points(input.currentSharePct! - input.previousSharePct)}個百分點`}。` : "缺少目前行業占比。",
      `前五大行業合計占比${pct(input.topFiveSharePct)}${topFiveMove == null ? "，無前一年可比值" : `，較前一年${topFiveMove >= 0 ? "增加" : "減少"}${points(topFiveMove)}個百分點`}。`,
      lifeStageSpread == null ? "缺少生命階段比較。" : `三個青年年齡層的最大占比差距為${points(lifeStageSpread)}個百分點。`,
      currentSexGap == null ? "缺少男女交叉比較。" : `男性與女性占比差距為${points(currentSexGap)}個百分點。`,
      sensitivitySpan == null ? "方法敏感度範圍尚無資料。" : `主模型與替代法的敏感度區間寬度為${points(sensitivitySpan)}個百分點；此範圍不是信賴區間。`,
    ],
    decisionGate: "形成政策措施前，須由業務、統計與資料治理人員核對職缺、職業、工時、薪資、服務量及方法敏感度；不得把模型估計當成因果證據。",
    evidenceDomains: ["青年就業者行業結構", "就業人口母數", "PCLM與IPF方法敏感度"],
    policyTools: triggered
      ? ["按行業×年齡×性別建立職缺、求職、媒合與留任檢核表", "將職涯諮詢及訓練服務結果與行業結構交叉檢視", "以官方新資料重跑PCLM與IPF並比較替代法方向"]
      : ["維持19類行業年度結構監測", "補接職缺、職業、工時與薪資級距", "保留青年服務使用與就業結果供後續交叉查核"],
    agencies: "待政策承辦確認主責及協辦局處",
    monitoring: ["前五大行業合計占比", "19類行業占比與前一年差異", "三個青年年齡層的行業差距", "男女行業占比差距", "PCLM與替代拆分法敏感度"],
    missingData: ["新北市青年職缺與求職技能交叉資料", "青年就業者職業、工時及薪資交叉資料", "青年服務參與者的媒合與留任結果", "調查估計標準誤或信賴區間"],
    rule: "青年行業政策初篩規則V1：以下任一項符合，列為優先盤點。\n1. 主要行業占比連續三年同向變動，累計至少1個百分點。\n2. 前五大行業集中度較前一年增加至少1個百分點。\n3. 男女行業占比差距較前一年擴大至少1個百分點。\n年齡層差距達3個百分點另列補充線索，不單獨觸發優先盤點。\n門檻只啟動資料查核，不證明缺工或政策效果，也不是因果或資源核定標準。",
  };
}

export function buildWagePolicySignal(input: WageSignalInput): PolicySignal {
  const unavailable = input.latestYear == null || input.latestMean == null || input.latestMedian == null;
  const lag = input.latestYear == null ? null : Math.max(input.selectedYear - input.latestYear, 0);
  const selectedUnavailable = unavailable || (lag ?? 0) > 0;
  const modeled = input.identity.includes("模型") || input.identity.includes("估計");
  const gapMovement = input.latestGapSharePct == null || input.firstGapSharePct == null ? null : input.latestGapSharePct - input.firstGapSharePct;
  const state: PolicySignalState = selectedUnavailable ? "無法判定" : modeled ? "持續觀察" : "目前未觸發";
  return {
    id: "wage-freshness-and-identity",
    title: `${input.ageLabel}薪資與資料時效`,
    state,
    signal: unavailable
      ? "目前沒有完成查核的可比薪資資料。"
      : `${input.latestYear}年全年薪資平均數為${input.latestMean!.toFixed(1)}萬元、中位數為${input.latestMedian!.toFixed(1)}萬元，差額${input.latestGap?.toFixed(1) ?? "—"}萬元。`,
    relativePosition: unavailable
      ? "無法建立年度比較。"
      : lag
        ? `相對所選${input.selectedYear}年落後${lag}年；${input.identity}。`
        : `與所選年度一致；${input.identity}。`,
    supportedInterpretation: "可判讀工作場所位於新北市之18–35歲受僱員工薪資水準、平均與中位數距離、名目成長速度及資料時效。",
    unsupportedConclusion: "不能描述成新北市設籍青年所得；偏斜代理值不是正式偏態或不均指標；沒有青年交叉資料時不能推論行業或事業規模造成薪資差異。",
    policyQuestion: selectedUnavailable ? "新年度尚未發布時，應如何追蹤18–35歲同口徑資料，避免以全年齡或前一年資料代填？" : "18–35歲平均與中位數距離，是否與行業、職業、工時或事業規模結構有關？",
    recommendedAction: selectedUnavailable
      ? "維持所選年度缺值，將最新可用年度標成背景值，並追蹤同口徑資料發布。"
      : modeled
        ? "先查核18–35歲模型的敏感度與年度一致性，再建立青年行業、職業、工時與薪資交叉資料補查清單。"
        : "追蹤平均數、中位數與差額；差距擴大或特定年齡成長落後時，再按行業、職業、工時與規模拆解。",
    actionBasis: [
      unavailable ? "目前沒有完成查核的可比薪資資料。" : `${input.latestYear}年平均${input.latestMean!.toFixed(1)}萬元、中位數${input.latestMedian!.toFixed(1)}萬元。`,
      input.latestGapSharePct == null ? "偏斜代理值尚無法計算。" : `平均—中位數差額占平均數${input.latestGapSharePct.toFixed(1)}%；相較110年${gapMovement == null ? "無法比較" : `${gapMovement >= 0 ? "增加" : "減少"}${Math.abs(gapMovement).toFixed(1)}個百分點`}。`,
      input.meanCagrPct == null ? "110–113年成長速度尚無法計算。" : `110–113年平均薪資複合年成長率${input.meanCagrPct.toFixed(2)}%，屬名目成長。`,
      lag ? `全年總薪資相對所選年度落後${lag}年。` : "全年總薪資資料年度與所選年度一致。",
      `平均數：${input.identity}；中位數：${input.medianIdentity}`,
    ],
    decisionGate: "形成薪資措施前須確認工作場所口徑、資料年度、18–35歲年齡交叉、物價、行業、職業、工時與事業規模；不得用全年齡或前一年資料代替青年薪資。",
    evidenceDomains: ["18–35歲全年總薪資", "平均—中位數差額", "名目薪資成長速度"],
    policyTools: selectedUnavailable
      ? ["建立官方發布日與資料落後年數提醒", "保留缺值，不以前一年、全年齡或全國值代填", "建立18–35歲行業、職業、工時與薪資交叉資料補接清單"]
      : modeled
        ? ["以官方原生年齡帶做回代驗證", "比較18–35歲110–113年年增率與複合年成長率", "補接18–35歲薪資級距、職業與工時"]
        : ["追蹤平均數、中位數、差額與偏斜代理值", "按行業、職業、工時與事業規模拆解變動來源"],
    agencies: "建議主責：新北市政府勞工局；協辦：青年局、主計處（實際分工仍由業務單位確認）",
    monitoring: ["18–35歲平均薪資與年增率", "18–35歲薪資中位數與年增率", "平均—中位數差額及占比", "18–35歲複合年成長率", "資料落後年數", "青年行業、職業、工時、規模與薪資級距結構"],
    missingData: ["114年青年全年總薪資", "可直接計算目標年齡中位數及正式偏態的個體薪資與樣本權數", "新北市×年齡×性別×行業／職業／工時／事業規模薪資交叉資料", "青年名目薪資的物價調整基準"],
    rule: "薪資政策初篩規則V4：只使用18–35歲青年同口徑資料。先檢查資料時效，再並讀平均數、中位數、差額占比與成長速度；114年青年資料尚未發布時保留缺值。模型估計範圍重疊時，標示為尚無法判定有明顯差異，不宣稱統計上顯著或不顯著；只提出補查與工具選項，不直接判定政策對象或效果。",
  };
}

export function buildLifeStagePolicySignal(input: LifeStageSignalInput): PolicySignal {
  const hasRequired = input.leadingEducation != null && input.leadingMarriage != null;
  const state: PolicySignalState = !hasRequired ? "無法判定" : input.estimated ? "持續觀察" : "目前未觸發";
  return {
    id: "life-stage-composition",
    title: `${input.district}${input.ageLabel}生命階段`,
    state,
    signal: hasRequired
      ? `教育程度以${input.leadingEducation}${pct(input.leadingEducationPct)}為最高；婚姻狀態以${input.leadingMarriage}${pct(input.leadingMarriagePct)}為最高。`
      : "目前條件缺少完整教育或婚姻結構。",
    relativePosition: input.estimated ? "部分邊界年齡採PCLM拆分與IPF校準，應連同敏感度閱讀。" : "目前顯示欄位為官方原生或直接加總值。",
    supportedInterpretation: "可描述同一戶籍人口母體中的教育與婚姻結構，協助區分青年生命階段。",
    unsupportedConclusion: "結構占比不能直接證明個人需求、政策效果或因果關係。",
    policyQuestion: "現有青年方案是否已針對不同教育、職涯與家庭形成階段提供差異化入口？",
    recommendedAction: input.estimated
      ? "先把18–24、25–29及30–35歲結構差異列為觀察線索，核對敏感度與需求調查後再調整方案。"
      : "按三個生命階段比較服務曝光、報名、參與及完成結果，確認方案入口是否有落差。",
    actionBasis: [hasRequired ? `教育程度主要為${input.leadingEducation}${pct(input.leadingEducationPct)}。` : "教育結構尚不完整。", hasRequired ? `婚姻狀態主要為${input.leadingMarriage}${pct(input.leadingMarriagePct)}。` : "婚姻結構尚不完整。", input.estimated ? "部分年齡邊界為模型估計。" : "目前欄位為官方原生或直接加總值。"],
    decisionGate: "調整方案前須補齊青年需求、方案參與者生命階段與服務成果，避免只按人口結構推論個人需求。",
    evidenceDomains: ["教育程度", "婚姻狀態"],
    policyTools: ["按三個生命階段建立方案曝光→報名→參與→完成漏斗", "比較教育×婚姻結構與服務使用情形", "用需求調查確認居住、職涯、進修與家庭支持需求"],
    agencies: "待政策承辦確認主責及協辦局處",
    monitoring: ["三個青年年齡層人口及年增率", "教育程度與婚姻狀態結構", "各生命階段方案曝光、報名、參與及完成率", "服務後進修、就業、居住或轉介成果"],
    missingData: ["方案參與者生命階段與教育、婚姻交叉", "分齡需求調查", "政策服務成果與未參與者比較"],
    rule: "生命階段規則V2：模型估計欄位列為持續監測；官方原生值只作結構描述。教育與婚姻狀態不代表個人需求或好壞，須有服務使用與需求資料才進入方案調整。",
  };
}

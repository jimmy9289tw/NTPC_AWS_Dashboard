import assert from "node:assert/strict";
import test from "node:test";
import {
  divergingBreaks,
  divergingClass,
  interpolateGradientColor,
  mapThresholdVersion,
  numericDomain,
  percentChange,
  roundedCountCeiling,
  roundUpToTen,
  sequentialBreaks,
  sequentialClass,
  symmetricDomain,
} from "../app/map-metrics.ts";
import { getDistrictPolicyEvidence } from "../app/district-policy-evidence.ts";
import {
  buildDistrictPolicySignal,
  buildIndustryPolicySignal,
  buildLaborPolicySignal,
  buildWagePolicySignal,
  median,
} from "../app/policy-engine.ts";

test("priority matrix classes retain fixed quantile breaks", () => {
  const breaks = sequentialBreaks([10, 20, 30, 40, 50, 60, 70, 80]);
  assert.deepEqual(breaks, [27.5, 45, 62.5]);
  assert.equal(sequentialClass(10, breaks), 0);
  assert.equal(sequentialClass(35, breaks), 1);
  assert.equal(sequentialClass(55, breaks), 2);
  assert.equal(sequentialClass(80, breaks), 3);
});

test("district map uses a versioned continuous color domain", () => {
  assert.deepEqual(numericDomain([10, 20, 30]), { min: 10, max: 30 });
  assert.deepEqual(numericDomain([]), { min: 0, max: 1 });
  assert.equal(symmetricDomain([-12, 3, 9]), 12);
  assert.equal(interpolateGradientColor(0, 0, 100, ["#000000", "#FFFFFF"]), "#000000");
  assert.equal(interpolateGradientColor(50, 0, 100, ["#000000", "#FFFFFF"]), "#808080");
  assert.equal(interpolateGradientColor(100, 0, 100, ["#000000", "#FFFFFF"]), "#FFFFFF");
  assert.notEqual(
    interpolateGradientColor(21, 0, 100, ["#000000", "#FFFFFF"]),
    interpolateGradientColor(22, 0, 100, ["#000000", "#FFFFFF"]),
  );
  assert.equal(mapThresholdVersion, "G6-MAP-110-114-CONTINUOUS-V2");
});

test("chart ceilings remain comparable and round non-compositional percentages upward by ten", () => {
  assert.equal(roundUpToTen(45.6), 50);
  assert.equal(roundUpToTen(50), 50);
  assert.equal(roundUpToTen(0), 10);
  assert.equal(roundedCountCeiling(107970), 110000);
  assert.equal(roundedCountCeiling(0), 1);
});

test("change map keeps zero-centered diverging classes", () => {
  const breaks = divergingBreaks([-10, -6, -2, 2, 6, 10]);
  assert.equal(divergingClass(-20, breaks), 0);
  assert.equal(divergingClass(0, breaks), 2);
  assert.equal(divergingClass(20, breaks), 4);
  assert.equal(percentChange(90, 100), -9.999999999999998);
  assert.equal(percentChange(10, 0), null);
});

test("district scale rule omits site-capacity text when the site rule is not triggered", () => {
  const signal = buildDistrictPolicySignal({
    district: "板橋區",
    ageLabel: "18–35歲",
    population: 107970,
    rank: 1,
    districtCount: 29,
    sharePct: 19.64,
    citySharePct: 20.91,
    yearChangePct: -2.6,
    windowChangePct: -9.35,
    serviceSiteCount: 2,
    activeServiceSiteCount: 2,
    districtExposureIntensity: null,
  });
  assert.equal(signal.state, "已觸發");
  assert.match(signal.rule, /前8區/);
  assert.match(signal.recommendedAction, /規模仍居前段.*五年呈下降/);
  assert.deepEqual(signal.evidenceDomains, ["人口規模"]);
  assert.doesNotMatch(signal.actionBasis.join(" "), /據點|量能/);
  assert.ok(!signal.missingData.some((item) => item.includes("活動場次")));
  assert.match(signal.rule, /只有人口趨勢條件成立.*才進入巡迴服務與設點評估/);
});

test("sustained leading growth without an official site triggers a site feasibility review", () => {
  const signal = buildDistrictPolicySignal({
    district: "淡水區",
    ageLabel: "18–35歲",
    population: 43000,
    rank: 10,
    districtCount: 29,
    sharePct: 20.67,
    citySharePct: 20.91,
    yearChangePct: 2.13,
    windowChangePct: 5.08,
    windowPopulationChange: 2078,
    windowStartYear: 110,
    windowEndYear: 114,
    growthRank: 1,
    growingDistrictCount: 3,
    positiveAnnualIntervals: 4,
    annualIntervalCount: 4,
    serviceSiteCount: 0,
    activeServiceSiteCount: 0,
    districtExposureIntensity: null,
  });
  assert.equal(signal.state, "已觸發");
  assert.match(signal.recommendedAction, /試辦6個月.*青年巡迴服務日/);
  assert.ok(signal.actionBasis.some((item) => item.includes("增加2,078人（5.08%）")));
  assert.ok(signal.actionBasis.some((item) => item.includes("排名第1")));
  assert.ok(signal.actionBasis.some((item) => item.includes("4/4個年度區間")));
  assert.deepEqual(signal.evidenceDomains, ["青年據點", "人口趨勢"]);
  assert.match(signal.unsupportedConclusion, /不等於已證明服務不足/);
  assert.match(signal.decisionGate, /青年需求調查.*交通可近性.*經費/);
});

test("official and modeled district dimensions create non-site policy suggestions", () => {
  const evidence = getDistrictPolicyEvidence(114, "烏來區", "18-35", "合計");
  assert.equal(evidence.population, 1459);
  assert.equal(Number(evidence.educationLowerPct.toFixed(2)), 62.22);
  assert.equal(Number(evidence.cityEducationLowerPct.toFixed(2)), 42.20);
  assert.equal(Number(evidence.educationConservativeGapPct.toFixed(2)), 16.95);
  assert.equal(evidence.educationDifferenceRank, 1);
  assert.equal(Number(evidence.marriedPct.toFixed(2)), 26.62);
  assert.equal(Number(evidence.cityMarriedPct.toFixed(2)), 15.81);
  assert.equal(Number(evidence.marriageConservativeGapPct.toFixed(2)), 10.40);
  assert.equal(evidence.marriageDifferenceRank, 1);
  const signal = buildDistrictPolicySignal({
    district: "烏來區",
    ageLabel: "18–35歲",
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
  });
  assert.deepEqual(signal.evidenceDomains, ["教育程度", "婚姻狀態"]);
  assert.match(signal.recommendedAction, /試辦一梯次.*職涯導航.*技能證照/);
  assert.ok(signal.actionBasis.some((item) => item.includes("62.22%") && item.includes("20.02個百分點")));
  assert.ok(signal.actionBasis.some((item) => item.includes("26.62%") && item.includes("10.81個百分點")));
  assert.ok(signal.actionBasis.some((item) => item.includes("敏感度範圍") && item.includes("16.95個百分點")));
  assert.ok(signal.actionBasis.some((item) => item.includes("敏感度範圍") && item.includes("10.40個百分點")));
  assert.doesNotMatch(signal.actionBasis.join(" "), /據點|服務人次/);
  assert.ok(!signal.missingData.some((item) => item.includes("行政區彙整的服務")));
});

test("gender structure can trigger a reach audit without a site recommendation", () => {
  const evidence = getDistrictPolicyEvidence(114, "深坑區", "18-35", "合計");
  const signal = buildDistrictPolicySignal({
    district: "深坑區",
    ageLabel: "18–35歲",
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
    educationDifferenceRank: evidence.educationDifferenceRank,
    marriedPct: evidence.marriedPct,
    cityMarriedPct: evidence.cityMarriedPct,
    marriageDifferenceRank: evidence.marriageDifferenceRank,
    maleSharePct: evidence.maleSharePct,
    cityMaleSharePct: evidence.cityMaleSharePct,
    genderDifferenceRank: evidence.genderDifferenceRank,
    demographicEstimated: evidence.demographicEstimated,
    serviceSiteCount: evidence.serviceSiteCount,
    activeServiceSiteCount: evidence.activeServiceSiteCount,
  });
  assert.deepEqual(signal.evidenceDomains, ["性別結構"]);
  assert.match(signal.actionBasis[0], /男性占54.63%.*全市為51.88%.*2.75個百分點.*排名第1/);
  assert.match(signal.recommendedAction, /試辦兩種招募管道與兩個服務時段/);
  assert.doesNotMatch(signal.recommendedAction, /據點/);
});

test("a robustly lower higher-education married share triggers a concrete social-connection pilot", () => {
  const signal = buildDistrictPolicySignal({
    district: "平溪區",
    ageLabel: "18–35歲",
    population: 800,
    rank: 28,
    districtCount: 29,
    sharePct: 18,
    citySharePct: 20.9,
    yearChangePct: -1,
    windowChangePct: -4,
    higherEducationMarriedPct: 10.72,
    cityHigherEducationMarriedPct: 18.58,
    higherEducationMarriedConservativeGapPct: 7.57,
    higherEducationMarriedEstimated: true,
    serviceSiteCount: 0,
    activeServiceSiteCount: 0,
  });
  assert.equal(signal.state, "已觸發");
  assert.equal(signal.evidenceDomains[0], "教育×婚姻");
  assert.match(signal.recommendedAction, /試辦4場.*青年交流與社群連結/);
  assert.match(signal.policyTools[0], /自願聯誼/);
  assert.match(signal.actionBasis[0], /低於全市.*7\.86個百分點/);
  assert.match(signal.decisionGate, /婚姻狀態不作績效目標/);
  assert.match(signal.rule, /行政區政策初篩規則V7/);
});

test("labor rule needs both above-median and rising unemployment to trigger", () => {
  const triggered = buildLaborPolicySignal({
    ageLabel: "18–35歲",
    unemploymentRate: 7,
    previousUnemploymentRate: 6,
    fiveYearMedian: 6.2,
    laborParticipationRate: 82,
  });
  const clear = buildLaborPolicySignal({
    ageLabel: "18–35歲",
    unemploymentRate: 5.5,
    previousUnemploymentRate: 5.6,
    fiveYearMedian: 5.7,
    laborParticipationRate: 82,
  });
  assert.equal(triggered.state, "已觸發");
  assert.equal(clear.state, "目前未觸發");
  assert.equal(median([9, 3, 5, 7, 1]), 5);
});

test("industry policy rule requires an auditable structural trigger", () => {
  const signal = buildIndustryPolicySignal({
    ageLabel: "18–35歲",
    sexLabel: "男女合計",
    industry: "製造業",
    currentSharePct: 19.2,
    previousSharePct: 18.4,
    threeYearShares: [17.7, 18.4, 19.2],
    topFiveSharePct: 61.5,
    previousTopFiveSharePct: 60.1,
    lifeStageShares: [12.1, 18.3, 23.7],
    maleSharePct: 24.2,
    femaleSharePct: 13.9,
    previousMaleSharePct: 23.1,
    previousFemaleSharePct: 14.2,
    sensitivityLowPct: 18.7,
    sensitivityHighPct: 19.6,
  });
  assert.equal(signal.state, "已觸發");
  assert.match(signal.relativePosition, /連續三年同向變動/);
  assert.match(signal.unsupportedConclusion, /不能直接證明缺工/);
  assert.match(signal.rule, /不是因果或資源核定標準/);
});

test("wage rule exposes latest value without replacing the selected year", () => {
  const signal = buildWagePolicySignal({
    ageLabel: "18–35歲",
    selectedYear: 114,
    latestYear: 113,
    latestMean: 60.9,
    latestMedian: 51.7,
    identity: "官方薪資錨定之輔助資料模型估計值",
    medianIdentity: "官方薪資錨定之分布模型估計值",
  });
  assert.equal(signal.state, "無法判定");
  assert.match(signal.signal, /113年.*60\.9萬元/);
  assert.match(signal.signal, /中位數.*51\.7萬元/);
  assert.match(signal.relativePosition, /落後1年/);
  assert.match(signal.unsupportedConclusion, /不能描述成新北市設籍青年所得/);
});

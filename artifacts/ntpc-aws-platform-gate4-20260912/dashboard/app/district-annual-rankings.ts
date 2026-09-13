import baselinePayload from "./data/district-population-baseline-109.json";
import {
  dashboardData,
  geographyLabel,
  getRegistered,
  getServiceFacilities,
  type AgeBand,
  type Sex,
} from "./dashboard-data";
import { percentChange } from "./map-metrics";

type BaselineRecord = {
  year: 109;
  geography: string;
  ageBand: AgeBand;
  sex: Sex;
  population: number;
};

type RankingValue = { geography: string; value: number | null };

export type RankMovement = {
  direction: "up" | "down" | "same" | "unavailable";
  places: number | null;
  label: string;
  reason?: string;
};

export type DistrictRankingMetric = {
  key: "population" | "density" | "change" | "married" | "unmarried" | "divorced" | "facilities";
  label: string;
  rank: number | null;
  total: number;
  value: number | null;
  valueLabel: string;
  movement: RankMovement;
  evidenceIdentity: string;
  periodNote?: string;
};

const baselineRecords = baselinePayload.records as BaselineRecord[];

export function getPopulation(year: number, geography: string, ageBand: AgeBand, sex: Sex) {
  if (year === 109) {
    return baselineRecords.find((row) => row.geography === geography && row.ageBand === ageBand && row.sex === sex)?.population ?? null;
  }
  return getRegistered(year, geography, ageBand, sex)?.population ?? null;
}

/** Standard competition ranking: equal values receive the same rank. */
export function competitionRank(rows: RankingValue[], geography: string) {
  const target = rows.find((row) => row.geography === geography)?.value;
  if (target == null || !Number.isFinite(target)) return null;
  return 1 + rows.filter((row) => row.value != null && Number.isFinite(row.value) && (row.value as number) > target).length;
}

function movement(currentRank: number | null, previousRank: number | null, reason?: string): RankMovement {
  if (currentRank == null || previousRank == null) return { direction: "unavailable", places: null, label: "無法比較", reason };
  const places = previousRank - currentRank;
  if (places > 0) return { direction: "up", places, label: `上升${places}名` };
  if (places < 0) return { direction: "down", places: Math.abs(places), label: `下降${Math.abs(places)}名` };
  return { direction: "same", places: 0, label: "排名持平" };
}

function districtNames() {
  return dashboardData.geographies.filter((item) => item.level === "DISTRICT").map((item) => geographyLabel(item.name));
}

function populationRows(year: number, ageBand: AgeBand, sex: Sex): RankingValue[] {
  return districtNames().map((geography) => ({ geography, value: getPopulation(year, geography, ageBand, sex) }));
}

function densityRows(year: number, ageBand: AgeBand, sex: Sex): RankingValue[] {
  return districtNames().map((geography) => {
    const population = getPopulation(year, geography, ageBand, sex);
    const landArea = getRegistered(Math.max(year, 110), geography, ageBand, sex)?.landAreaKm2 ?? null;
    return { geography, value: population != null && landArea ? population / landArea : null };
  });
}

function changeRows(year: number, ageBand: AgeBand, sex: Sex): RankingValue[] {
  return districtNames().map((geography) => ({
    geography,
    value: percentChange(
      getPopulation(year, geography, ageBand, sex) ?? undefined,
      getPopulation(year - 1, geography, ageBand, sex) ?? undefined,
    ),
  }));
}

function categoryRows(year: number, ageBand: AgeBand, sex: Sex, category: string): RankingValue[] {
  return districtNames().map((geography) => ({
    geography,
    value: getRegistered(year, geography, ageBand, sex)?.marriage[category]?.value ?? null,
  }));
}

function facilityRows(): RankingValue[] {
  return districtNames().map((geography) => ({ geography, value: getServiceFacilities(geography).filter((item) => item.active).length }));
}

function selectedValue(rows: RankingValue[], geography: string) {
  return rows.find((row) => row.geography === geography)?.value ?? null;
}

function numberLabel(value: number | null, unit: string, digits = 0) {
  if (value == null) return "尚無資料";
  return `${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: digits }).format(value)}${unit}`;
}

export function buildDistrictRankings(year: number, ageBand: AgeBand, sex: Sex, geography: string): DistrictRankingMetric[] {
  const currentPopulation = populationRows(year, ageBand, sex);
  const previousPopulation = populationRows(year - 1, ageBand, sex);
  const currentDensity = densityRows(year, ageBand, sex);
  const previousDensity = densityRows(year - 1, ageBand, sex);
  const currentChange = changeRows(year, ageBand, sex);
  const previousChange = year >= 111 ? changeRows(year - 1, ageBand, sex) : [];
  const currentMarried = categoryRows(year, ageBand, sex, "有偶");
  const currentUnmarried = categoryRows(year, ageBand, sex, "未婚");
  const currentDivorced = categoryRows(year, ageBand, sex, "離婚或終止結婚");
  const previousMarried = year >= 111 ? categoryRows(year - 1, ageBand, sex, "有偶") : [];
  const previousUnmarried = year >= 111 ? categoryRows(year - 1, ageBand, sex, "未婚") : [];
  const previousDivorced = year >= 111 ? categoryRows(year - 1, ageBand, sex, "離婚或終止結婚") : [];
  const facilities = facilityRows();
  const total = districtNames().length;
  const make = (
    key: DistrictRankingMetric["key"],
    label: string,
    current: RankingValue[],
    previous: RankingValue[],
    valueLabel: (value: number | null) => string,
    evidenceIdentity: string,
    unavailableReason?: string,
    periodNote?: string,
  ): DistrictRankingMetric => {
    const rank = competitionRank(current, geography);
    const previousRank = previous.length ? competitionRank(previous, geography) : null;
    const value = selectedValue(current, geography);
    return { key, label, rank, total, value, valueLabel: valueLabel(value), movement: movement(rank, previousRank, unavailableReason), evidenceIdentity, periodNote };
  };

  return [
    make("population", "戶籍人口數排名", currentPopulation, previousPopulation, (value) => numberLabel(value, "人"), "官方行政精確值"),
    make("density", "戶籍人口密度排名", currentDensity, previousDensity, (value) => numberLabel(value, "人／平方公里", 2), "官方行政精確值直接計算"),
    make("change", "戶籍人口年度變化率排名", currentChange, previousChange, (value) => numberLabel(value, "%", 2), "官方行政精確值直接計算", year === 110 ? "需108年人口才能計算109年的變化率排名" : undefined),
    make("married", "有偶（已婚）比率排名", currentMarried, previousMarried, (value) => numberLabel(value, "%", 2), ageBand === "25-29" ? "官方行政精確值" : "官方行政邊際推估值", year === 110 ? "尚無109年同口徑婚姻估計" : undefined),
    make("unmarried", "未婚比率排名", currentUnmarried, previousUnmarried, (value) => numberLabel(value, "%", 2), ageBand === "25-29" ? "官方行政精確值" : "官方行政邊際推估值", year === 110 ? "尚無109年同口徑婚姻估計" : undefined),
    make("divorced", "離婚或終止結婚比率排名", currentDivorced, previousDivorced, (value) => numberLabel(value, "%", 2), ageBand === "25-29" ? "官方行政精確值" : "官方行政邊際推估值", year === 110 ? "尚無109年同口徑婚姻估計" : undefined),
    make("facilities", "青年據點數排名", facilities, [], (value) => numberLabel(value, "處"), "115年官方據點清冊快照", "尚無前一年度同口徑據點快照", `固定顯示${dashboardData.service.snapshotYear}年快照，不受所選年度改變`),
  ];
}

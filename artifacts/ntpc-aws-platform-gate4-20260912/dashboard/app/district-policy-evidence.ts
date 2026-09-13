import {
  dashboardData,
  geographyLabel,
  getRegistered,
  getServiceFacilities,
  type AgeBand,
  type RegisteredRecord,
  type Sex,
} from "./dashboard-data";
import { percentChange } from "./map-metrics";

export type DistrictPolicyEvidence = {
  district: string;
  population: number | null;
  populationRank: number | null;
  districtCount: number;
  sharePct: number | null;
  citySharePct: number | null;
  yearChangePct: number | null;
  windowStartYear: number;
  windowEndYear: number;
  windowPopulationChange: number | null;
  windowChangePct: number | null;
  growthRank: number | null;
  growingDistrictCount: number;
  positiveAnnualIntervals: number;
  annualIntervalCount: number;
  educationLowerPct: number | null;
  cityEducationLowerPct: number | null;
  educationConservativeGapPct: number | null;
  educationDifferenceRank: number | null;
  marriedPct: number | null;
  cityMarriedPct: number | null;
  marriageConservativeGapPct: number | null;
  marriageDifferenceRank: number | null;
  maleSharePct: number | null;
  cityMaleSharePct: number | null;
  genderDifferenceRank: number | null;
  demographicEstimated: boolean;
  serviceSiteCount: number;
  activeServiceSiteCount: number;
};

type RankedValue = { district: string; value: number };

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function categoryValue(record: RegisteredRecord | undefined, group: "education" | "marriage", category: string) {
  return finite(record?.[group]?.[category]?.value);
}

function categoryBound(record: RegisteredRecord | undefined, group: "education" | "marriage", category: string, bound: "low" | "high") {
  return finite(record?.[group]?.[category]?.[bound]);
}

function sumCategories(record: RegisteredRecord | undefined, group: "education" | "marriage", categories: string[]) {
  const values = categories.map((category) => categoryValue(record, group, category));
  return values.some((value) => value == null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function sumCategoryBounds(record: RegisteredRecord | undefined, group: "education" | "marriage", categories: string[], bound: "low" | "high") {
  const values = categories.map((category) => categoryBound(record, group, category, bound));
  return values.some((value) => value == null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function rankDescending(values: RankedValue[], district: string) {
  const ranked = [...values].sort((a, b) => b.value - a.value);
  const index = ranked.findIndex((item) => item.district === district);
  return index < 0 ? null : index + 1;
}

export function getDistrictPolicyEvidence(endYear: number, district: string, ageBand: AgeBand, sex: Sex): DistrictPolicyEvidence {
  const visibleYears = dashboardData.meta.years.filter((item) => item <= endYear);
  const windowStartYear = visibleYears[0] ?? endYear;
  const districtNames = dashboardData.geographies
    .filter((item) => item.level === "DISTRICT")
    .map((item) => geographyLabel(item.name));
  const currentRows = districtNames
    .map((name) => getRegistered(endYear, name, ageBand, sex))
    .filter((item): item is RegisteredRecord => item != null);
  const selected = getRegistered(endYear, district, ageBand, sex);
  const city = getRegistered(endYear, "新北市", ageBand, sex);
  const previous = getRegistered(endYear - 1, district, ageBand, sex);
  const windowRows = visibleYears
    .map((year) => getRegistered(year, district, ageBand, sex))
    .filter((item): item is RegisteredRecord => item != null);
  const first = windowRows[0];
  const last = windowRows.at(-1);
  let positiveAnnualIntervals = 0;
  let annualIntervalCount = 0;
  for (let index = 1; index < windowRows.length; index += 1) {
    annualIntervalCount += 1;
    if (windowRows[index].population > windowRows[index - 1].population) positiveAnnualIntervals += 1;
  }

  const growthValues = districtNames.map((name) => {
    const baseline = getRegistered(windowStartYear, name, ageBand, sex);
    const current = getRegistered(endYear, name, ageBand, sex);
    return { district: name, value: percentChange(current?.population, baseline?.population) };
  }).filter((item): item is RankedValue => item.value != null);

  const cityEducationLowerPct = sumCategories(city, "education", ["國中及以下", "高中職"]);
  const educationValues = currentRows.map((row) => ({
    district: geographyLabel(row.geography),
    value: sumCategories(row, "education", ["國中及以下", "高中職"]),
  })).filter((item): item is RankedValue => item.value != null && cityEducationLowerPct != null)
    .map((item) => ({ ...item, value: item.value - cityEducationLowerPct! }));

  const cityMarriedPct = categoryValue(city, "marriage", "有偶");
  const marriageValues = currentRows.map((row) => ({
    district: geographyLabel(row.geography),
    value: categoryValue(row, "marriage", "有偶"),
  })).filter((item): item is RankedValue => item.value != null && cityMarriedPct != null)
    .map((item) => ({ ...item, value: item.value - cityMarriedPct! }));

  const cityMaleSharePct = finite(getRegistered(endYear, "新北市", ageBand, "男")?.sexSharePct);
  const genderValues = districtNames.map((name) => ({
    district: name,
    value: finite(getRegistered(endYear, name, ageBand, "男")?.sexSharePct),
  })).filter((item): item is RankedValue => item.value != null && cityMaleSharePct != null)
    .map((item) => ({ ...item, value: Math.abs(item.value - cityMaleSharePct!) }));

  const educationLowerPct = sumCategories(selected, "education", ["國中及以下", "高中職"]);
  const educationLowerBound = sumCategoryBounds(selected, "education", ["國中及以下", "高中職"], "low");
  const cityEducationUpperBound = sumCategoryBounds(city, "education", ["國中及以下", "高中職"], "high");
  const marriedPct = categoryValue(selected, "marriage", "有偶");
  const marriedLowerBound = categoryBound(selected, "marriage", "有偶", "low");
  const cityMarriedUpperBound = categoryBound(city, "marriage", "有偶", "high");
  const maleSharePct = finite(getRegistered(endYear, district, ageBand, "男")?.sexSharePct);
  const demographicEstimated = [selected?.education?.["高中職"], selected?.marriage?.["有偶"]]
    .some((metric) => /估計|推估|PCLM|IPF/i.test(`${metric?.origin ?? ""} ${metric?.method ?? ""}`));
  const facilities = getServiceFacilities(district);

  return {
    district,
    population: selected?.population ?? null,
    populationRank: selected ? [...currentRows].sort((a, b) => b.population - a.population).findIndex((row) => row.geography === selected.geography) + 1 : null,
    districtCount: currentRows.length,
    sharePct: selected?.populationSharePct ?? null,
    citySharePct: city?.populationSharePct ?? null,
    yearChangePct: percentChange(selected?.population, previous?.population),
    windowStartYear,
    windowEndYear: endYear,
    windowPopulationChange: first && last ? last.population - first.population : null,
    windowChangePct: percentChange(last?.population, first?.population),
    growthRank: rankDescending(growthValues, district),
    growingDistrictCount: growthValues.filter((item) => item.value > 0).length,
    positiveAnnualIntervals,
    annualIntervalCount,
    educationLowerPct,
    cityEducationLowerPct,
    educationConservativeGapPct: educationLowerBound != null && cityEducationUpperBound != null ? educationLowerBound - cityEducationUpperBound : null,
    educationDifferenceRank: rankDescending(educationValues, district),
    marriedPct,
    cityMarriedPct,
    marriageConservativeGapPct: marriedLowerBound != null && cityMarriedUpperBound != null ? marriedLowerBound - cityMarriedUpperBound : null,
    marriageDifferenceRank: rankDescending(marriageValues, district),
    maleSharePct,
    cityMaleSharePct,
    genderDifferenceRank: rankDescending(genderValues, district),
    demographicEstimated,
    serviceSiteCount: facilities.length,
    activeServiceSiteCount: facilities.filter((item) => item.active).length,
  };
}

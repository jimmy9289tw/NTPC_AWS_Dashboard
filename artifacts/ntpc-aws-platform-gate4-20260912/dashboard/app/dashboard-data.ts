const payload = (window as any).__NTPC_DATA__.dashboard;

export type Sex = "合計" | "男" | "女";
export type AgeBand = "18-24" | "25-29" | "30-35" | "18-35";

export type CategoryMetric = {
  value: number;
  origin: string;
  method: string;
  low: number | null;
  high: number | null;
};

export type MetricMeta = Omit<CategoryMetric, "value"> & { unit: string };

export type RegisteredRecord = {
  year: number;
  geography: string;
  ageBand: AgeBand;
  sex: Sex;
  population: number;
  populationSharePct: number;
  sexSharePct: number | null;
  landAreaKm2: number;
  populationDensityPerKm2: number;
  populationOrigin: string;
  education: Record<string, CategoryMetric>;
  marriage: Record<string, CategoryMetric>;
};

export type LaborRecord = {
  year: number;
  ageBand: AgeBand;
  metrics: Record<string, number>;
  meta: Record<string, MetricMeta>;
};

export type WageRecord = {
  year: number;
  ageBand: AgeBand;
  metrics: Record<string, number>;
  meta: Record<string, MetricMeta>;
};

export type Geography = {
  code: string;
  name: string;
  level: "CITY" | "DISTRICT";
};

export type ServiceAnnualRecord = {
  year: number;
  domain: string;
  domainLabel: string;
  activityCount: number;
  participationPersonTimes: number;
  personTimesPerActivity: number;
  meta: Record<string, { origin: string; method: string; unit: string; sourceUrl: string }>;
};

export type ServiceFacility = {
  facilityCode: string;
  name: string;
  facilityType: "STARTUP_BASE" | "CAREER_SERVICE_BASE";
  districtCode: string;
  district: string;
  address: string;
  operatingStatus: string;
  active: boolean;
  capacityComponentCount: number;
  capacitySummary: string;
  latitude?: number | null;
  longitude?: number | null;
  coordinateSource?: string | null;
  coordinateQaStatus?: "VERIFIED_OFFICIAL" | "VERIFIED_ADDRESS" | "UNAVAILABLE" | null;
  sourceUrl: string;
  qaStatus: string;
};

export type ServiceCapacityComponent = {
  facilityCode: string;
  facilityName: string;
  districtCode: string;
  district: string;
  componentCode: string;
  componentName: string;
  value: number;
  unit: string;
  method: string;
  formula: string;
  operatingStatus: string;
  sourceUrl: string;
};

type DashboardPayload = {
  meta: {
    version: string;
    externalDataVersion: string;
    generatedAt: string;
    defaultView: string;
    years: number[];
    defaultYear: number;
    ageBands: AgeBand[];
    defaultAgeBand: AgeBand;
    sexes: Sex[];
    defaultSex: Sex;
    completeCommonYear: number;
    dailyReviewTime: string;
    yearWindowRule: string;
  };
  geographies: Geography[];
  registered: RegisteredRecord[];
  labor: LaborRecord[];
  wage: WageRecord[];
  service: {
    annual: ServiceAnnualRecord[];
    facilities: ServiceFacility[];
    capacityComponents: ServiceCapacityComponent[];
    exposure: { status: string; label: string; unit: string; formula: string; caveat: string };
    snapshotYear: number;
  };
  sources: Array<{ name: string; url: string; cadence: string }>;
  files: Array<{ name: string; sha256: string }>;
};

export const dashboardData = payload as unknown as DashboardPayload;

export const ageBandLabel = (value: AgeBand) => value.replace("-", "–") + "歲";

export const geographyLabel = (value: string) => value === "新北市" ? value : value.replace(/^新北市/, "");

export function getRegistered(year: number, geography: string, ageBand: AgeBand, sex: Sex) {
  return dashboardData.registered.find(
    (row) => row.year === year && (row.geography === geography || geographyLabel(row.geography) === geography) && row.ageBand === ageBand && row.sex === sex,
  );
}

export function getRegisteredTotalPopulation(record: RegisteredRecord | undefined): number | null {
  if (record === undefined || record.populationSharePct <= 0) return null;
  return Math.round(record.population * 100 / record.populationSharePct);
}

export function getLabor(year: number, ageBand: AgeBand) {
  return dashboardData.labor.find((row) => row.year === year && row.ageBand === ageBand);
}

export function getWage(year: number, ageBand: AgeBand) {
  return dashboardData.wage.find((row) => row.year === year && row.ageBand === ageBand);
}

export function getServiceAnnual(year: number) {
  return dashboardData.service.annual.filter((row) => row.year === year);
}

export function getServiceFacilities(district?: string) {
  return dashboardData.service.facilities.filter((row) => !district || district === "新北市" || row.district === district);
}

export function getServiceCapacityComponents(district?: string) {
  return dashboardData.service.capacityComponents.filter((row) => !district || district === "新北市" || row.district === district);
}

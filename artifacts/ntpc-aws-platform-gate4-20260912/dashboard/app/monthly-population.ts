const payload = (window as any).__NTPC_DATA__.monthly;
import type { AgeBand, Sex } from "./dashboard-data";

export type MonthlyPopulationRecord = {
  period: string;
  year: number;
  month: number;
  geography: string;
  ageBand: AgeBand;
  sex: Sex;
  population: number;
};

type MonthlyPopulationPayload = {
  meta: {
    generatedAt: string;
    sourceName: string;
    sourceUrl: string;
    apiTemplate: string;
    periods: string[];
    identity: string;
    timeBasis: string;
    method: string;
    availability: string;
  };
  qa: {
    ageBandReconciliation: string;
    districtReconciliation: string;
    annualSnapshot11412: { expected: number; actual: number; status: string };
  };
  records: MonthlyPopulationRecord[];
};

export const monthlyPopulationData = payload as MonthlyPopulationPayload;

export function getMonthlyPopulation(year: number, geography: string, ageBand: AgeBand, sex: Sex) {
  return monthlyPopulationData.records
    .filter((row) => row.year === year && row.geography === geography && row.ageBand === ageBand && row.sex === sex)
    .sort((a, b) => a.month - b.month);
}

export function getMonthlyPopulationValue(period: string, geography: string, ageBand: AgeBand, sex: Sex) {
  return monthlyPopulationData.records.find(
    (row) => row.period === period && row.geography === geography && row.ageBand === ageBand && row.sex === sex,
  )?.population;
}

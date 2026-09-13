import payload from "./data/mol-salary-context.json";
import matrixPayload from "./data/mol-salary-matrix.json";

export type MolSalaryContextItem = {
  name: string;
  headcount: number;
  averageContributionWage: number | null;
};

export type MolSalaryMatrixCell = {
  sizeGroup: string;
  sourceBands: string[];
  headcount: number;
  averageContributionWage: number | null;
};

type MolSalaryContextPayload = {
  meta: {
    sourceName: string;
    sourceUrl: string;
    salarySystemUrl: string;
    sourceApiUrl: string;
    rocYear: number;
    month: number;
    geographyBasis: string;
    population: string;
    metricDefinition: string;
    aggregationMethod: string;
    matrixGroupMethod: string;
  };
  newTaipei: {
    headcount: number;
    averageContributionWage: number;
    countyRank: number;
    countyCount: number;
    nationalAverageContributionWage: number;
    differenceFromNationalPct: number;
  };
  industries: MolSalaryContextItem[];
  organizationSizes: MolSalaryContextItem[];
  industrySizeMatrix: {
    sizeGroups: Array<{ name: string; sourceBands: string[] }>;
    rows: Array<{
      industry: string;
      total: MolSalaryContextItem;
      cells: MolSalaryMatrixCell[];
    }>;
  };
};

export const molSalaryContext = {
  ...payload,
  meta: {
    ...payload.meta,
    matrixGroupMethod: "先依行業保留官方19類，再將官方19個規模帶彙整為1–9、10–49、50–199、200–999、1,000人以上及其他；每格彙整平均＝Σ（來源格12月底人數×來源格全年平均提繳工資）÷Σ來源格12月底人數。此為分組重算近似值，不等同實際平均薪資",
  },
  industrySizeMatrix: matrixPayload,
} as MolSalaryContextPayload;

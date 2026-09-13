const payload = (window as any).__NTPC_DATA__.industry;

export type IndustrySex = "合計" | "男" | "女";
export type IndustryAgeBand = "18-24" | "25-29" | "30-35" | "18-35" | "ALL";

export type ResidentEmploymentIndustryRecord = {
  year: number;
  ageBand: IndustryAgeBand;
  industryCode: string;
  industry: string;
  sex: IndustrySex;
  employedThousands: number;
  employedThousandsLow: number;
  employedThousandsHigh: number;
  sharePct: number;
  sharePctLow: number;
  sharePctHigh: number;
  origin: string;
  method: string;
  methodCode: string;
};

type ResidentEmploymentIndustryPayload = {
  meta: {
    generatedAt: string;
    years: number[];
    ageBands: IndustryAgeBand[];
    sourceName: string;
    sourcePages: Record<string, string>;
    sourceTables: Record<string, string>;
    halfYearSourcePages: Record<string, Record<"H1" | "H2", string>>;
    halfYearSourceTables: Record<string, Record<"H1" | "H2", string>>;
    sourceFiles: Record<string, Record<"annualSha256" | "h1Sha256" | "h2Sha256", string>>;
    laborLayerSha256: string;
    laborTargetSource: string;
    universe: string;
    identity: string;
    timeBasis: string;
    classification: string;
    method: string;
    sensitivity: string;
    availability: string;
  };
  qa: {
    years: Array<{
      year: number;
      employedThousands: Record<IndustrySex, number>;
      categorySumResidualThousands: Record<IndustrySex, number>;
      maximumCategorySexGapThousands: number;
      maximumOfficialShareGapPercentagePoints: number;
      status: string;
    }>;
    youthYears: Array<{
      year: number;
      sourceBandReaggregationMaxErrorThousands: number;
      shareClosureMaxErrorPercentagePoints: number;
      officialCombinedSexResidualMaxThousands: number;
      officialCategorySumResidualMaxThousands: number;
      halfYearToAnnualTableMaxGapThousands: number;
      laborTargetReconciliationMaxErrorThousands: number;
      methodSensitivityMaxPercentagePoints: number;
      selectedPclmLambdas: number[];
      status: string;
    }>;
    youthTotals: Array<{
      year: number;
      ageBand: Exclude<IndustryAgeBand, "ALL">;
      employedThousands: Record<IndustrySex, number>;
    }>;
    categoryCount: number;
    recordCount: number;
    status: string;
  };
  records: ResidentEmploymentIndustryRecord[];
};

export const residentEmploymentIndustryData = payload as ResidentEmploymentIndustryPayload;

export function getResidentEmploymentIndustry(year: number, sex: IndustrySex, ageBand: IndustryAgeBand = "ALL") {
  return residentEmploymentIndustryData.records.filter((row) => row.year === year && row.sex === sex && row.ageBand === ageBand);
}

export function getResidentEmploymentIndustryTrend(industryCode: string, sex: IndustrySex, ageBand: IndustryAgeBand = "ALL") {
  return residentEmploymentIndustryData.records
    .filter((row) => row.industryCode === industryCode && row.sex === sex && row.ageBand === ageBand)
    .sort((a, b) => a.year - b.year);
}

export function getResidentEmploymentTotal(year: number, sex: IndustrySex, ageBand: IndustryAgeBand = "ALL") {
  if (ageBand === "ALL") return residentEmploymentIndustryData.qa.years.find((row) => row.year === year)?.employedThousands[sex];
  return residentEmploymentIndustryData.qa.youthTotals.find((row) => row.year === year && row.ageBand === ageBand)?.employedThousands[sex];
}

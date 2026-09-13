const payload = (window as any).__NTPC_DATA__.wageIndustry;

export type YouthIndustryWageAgeBand = "18-35" | "18-24" | "25-29" | "30-35";

export type YouthIndustryWageEstimate = {
  value: number | null;
  low: number | null;
  high: number | null;
  sourceAgeBand: string | null;
  nationalAgeIndustryIndex: number | null;
  localAllAgeContributionIndex: number | null;
  anchor: number;
  anchorOrigin: string;
  status: "MODEL_ESTIMATE" | "SOURCE_UNIVERSE_EXCLUDED";
};

export type YouthIndustryWageRow = {
  industry: string;
  supportingAllAgeHeadcount: number;
  estimates: Record<YouthIndustryWageAgeBand, YouthIndustryWageEstimate>;
  availability: "MODEL_ESTIMATE_AVAILABLE" | "NOT_IN_DGBAS_TABLE2_INDUSTRY_UNIVERSE";
};

type YouthIndustryWagePayload = {
  meta: {
    version: string;
    rocYear: number;
    ageBands: YouthIndustryWageAgeBand[];
    unit: string;
    statistic: string;
    population: string;
    geographyBasis: string;
    identity: string;
    formula: string;
    calibration: string;
    uncertainty: string;
    limitations: string[];
    sources: Array<{
      alias: string;
      name: string;
      url: string;
      snapshot: string;
      sha256: string;
    }>;
    generatedAt: string;
  };
  rows: YouthIndustryWageRow[];
  validation: {
    availableIndustryCount: number;
    displayedIndustryCount: number;
    unavailableIndustryCount: number;
    reaggregation: Record<YouthIndustryWageAgeBand, {
      anchor: number;
      reaggregated: number;
      absoluteError: number;
    }>;
    pclmSelectedLambda: number;
    pclmPostCalibrationMaxMarginError: number;
    native2529AnchorMatchesTable6: boolean;
    methodEnvelopeIsConfidenceInterval: boolean;
  };
};

export const youthIndustryWage = payload as YouthIndustryWagePayload;

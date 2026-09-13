import type { AgeBand, Sex } from "./dashboard-data";

export type JointEducationMarriageRecord = {
  year: number;
  ageBand: AgeBand;
  sex: Sex;
  education: string;
  marriage: string;
  population: number;
  populationLow: number;
  populationHigh: number;
  educationPopulation: number;
  marriageSharePct: number;
  origin: string;
  method: string;
  methodCode: string;
};

export type JointEducationMarriagePayload = {
  meta: {
    version: string;
    years: number[];
    ageBands: AgeBand[];
    sexes: Sex[];
    educationCategories: string[];
    marriageCategories: string[];
    geography: string;
    universe: string;
    periodBasis: string;
    sourceName: string;
    sourceUrl: string;
    sourceFile: string;
    sourceSha256: string;
    method: string;
    sensitivity: string;
    denominator: string;
  };
  records: JointEducationMarriageRecord[];
};

export const JOINT_EDUCATION_CATEGORIES = ["國中及以下", "高中職", "專科", "大學", "研究所"] as const;
export const JOINT_MARRIAGE_CATEGORIES = ["未婚", "有偶", "離婚或終止結婚", "喪偶"] as const;
export const JOINT_DATA_URL = "/data/joint-education-marriage.json";

export type JointShareEstimate = {
  value: number;
  low: number;
  high: number;
  numerator: number;
  denominator: number;
  origin: string;
  method: string;
};

/** One education group is the denominator; never multiply separate margins. */
export function educationMarriageShare(payload: JointEducationMarriagePayload, year: number, ageBand: AgeBand, sex: Sex, education: string, marriage: string): JointShareEstimate | null {
  const rows = payload.records.filter(row => row.year === year && row.ageBand === ageBand && row.sex === sex && row.education === education);
  if (rows.length !== JOINT_MARRIAGE_CATEGORIES.length || new Set(rows.map(row => row.marriage)).size !== JOINT_MARRIAGE_CATEGORIES.length) return null;
  const selected = rows.find(row => row.marriage === marriage);
  if (!selected) return null;
  const denominator = rows.reduce((s,r) => s + r.population, 0);
  const lowDenominator = rows.reduce((s,r) => s + r.populationLow, 0), highDenominator = rows.reduce((s,r) => s + r.populationHigh, 0);
  if (denominator <= 0 || lowDenominator <= 0 || highDenominator <= 0) return null;
  return { value: selected.population / denominator * 100, low: selected.populationLow / highDenominator * 100, high: Math.min(100, selected.populationHigh / lowDenominator * 100), numerator: selected.population, denominator, origin: selected.origin, method: selected.method };
}

export function findJointEducationMarriage(
  payload: JointEducationMarriagePayload,
  year: number,
  ageBand: AgeBand,
  sex: Sex,
  education: string,
  marriage: string,
) {
  return payload.records.find(
    (row) => row.year === year
      && row.ageBand === ageBand
      && row.sex === sex
      && row.education === education
      && row.marriage === marriage,
  );
}

/**
 * 計算「大學及研究所人口中，有偶者所占比率」。
 * 上下界是兩套模型結果的保守包絡，不是抽樣誤差或信賴區間。
 */
export function higherEducationMarriedShare(
  payload: JointEducationMarriagePayload,
  year: number,
  ageBand: AgeBand,
  sex: Sex,
): JointShareEstimate | null {
  const educationSet = new Set(["大學", "研究所"]);
  const rows = payload.records.filter((row) => row.year === year
    && row.ageBand === ageBand
    && row.sex === sex
    && educationSet.has(row.education));
  const expectedRows = educationSet.size * JOINT_MARRIAGE_CATEGORIES.length;
  if (rows.length !== expectedRows) return null;

  const marriedRows = rows.filter((row) => row.marriage === "有偶");
  const numerator = marriedRows.reduce((sum, row) => sum + row.population, 0);
  const denominator = rows.reduce((sum, row) => sum + row.population, 0);
  const numeratorLow = marriedRows.reduce((sum, row) => sum + row.populationLow, 0);
  const numeratorHigh = marriedRows.reduce((sum, row) => sum + row.populationHigh, 0);
  const denominatorLow = rows.reduce((sum, row) => sum + row.populationLow, 0);
  const denominatorHigh = rows.reduce((sum, row) => sum + row.populationHigh, 0);
  if (denominator <= 0 || denominatorLow <= 0 || denominatorHigh <= 0) return null;

  return {
    value: numerator / denominator * 100,
    low: numeratorLow / denominatorHigh * 100,
    high: numeratorHigh / denominatorLow * 100,
    numerator,
    denominator,
    origin: rows.some((row) => row.origin.includes("估計")) ? "模型估計值" : rows[0]?.origin ?? "尚無資料",
    method: rows[0]?.method ?? payload.meta.method,
  };
}

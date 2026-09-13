import { ageBandLabel, type AgeBand, type Sex } from "./dashboard-data";
import { type IndustrySignalInput } from "./policy-engine";
import { getResidentEmploymentIndustry, type IndustrySex } from "./resident-employment-industry";

// Shared by the classification engine and its evidence charts. The latest year's
// leading industry is held fixed for history and gender comparisons; top five is
// re-ranked independently in each year, exactly as in the existing V1 rule.
export function collectIndustryPolicyInput(year: number, ageBand: AgeBand, sex: Sex) {
  const industrySex = sex as IndustrySex;
  const currentIndustry = [...getResidentEmploymentIndustry(year, industrySex, ageBand)].sort((a, b) => b.sharePct - a.sharePct);
  const leading = currentIndustry[0];
  const industryCode = leading?.industryCode;
  const priorRows = getResidentEmploymentIndustry(year - 1, industrySex, ageBand);
  const previous = priorRows.find((row) => row.industryCode === industryCode);
  const threeYearShares = [year - 2, year - 1, year].map((item) => getResidentEmploymentIndustry(item, industrySex, ageBand).find((row) => row.industryCode === industryCode)?.sharePct ?? null);
  const lifeStageShares = (["18-24", "25-29", "30-35"] as AgeBand[]).map((band) => getResidentEmploymentIndustry(year, "合計", band).find((row) => row.industryCode === industryCode)?.sharePct).filter((value): value is number => value != null);
  const input: IndustrySignalInput = {
    ageLabel: ageBandLabel(ageBand),
    sexLabel: sex === "合計" ? "男女合計" : sex,
    industry: leading?.industry ?? "主要行業",
    currentSharePct: leading?.sharePct ?? null,
    previousSharePct: previous?.sharePct ?? null,
    threeYearShares,
    topFiveSharePct: currentIndustry.slice(0, 5).reduce((sum, row) => sum + row.sharePct, 0) || null,
    previousTopFiveSharePct: priorRows.length ? [...priorRows].sort((a, b) => b.sharePct - a.sharePct).slice(0, 5).reduce((sum, row) => sum + row.sharePct, 0) : null,
    lifeStageShares,
    maleSharePct: getResidentEmploymentIndustry(year, "男", ageBand).find((row) => row.industryCode === industryCode)?.sharePct ?? null,
    femaleSharePct: getResidentEmploymentIndustry(year, "女", ageBand).find((row) => row.industryCode === industryCode)?.sharePct ?? null,
    previousMaleSharePct: getResidentEmploymentIndustry(year - 1, "男", ageBand).find((row) => row.industryCode === industryCode)?.sharePct ?? null,
    previousFemaleSharePct: getResidentEmploymentIndustry(year - 1, "女", ageBand).find((row) => row.industryCode === industryCode)?.sharePct ?? null,
    sensitivityLowPct: leading?.sharePctLow ?? null,
    sensitivityHighPct: leading?.sharePctHigh ?? null,
  };
  return { input, industryCode, leading, currentIndustry, priorRows };

}


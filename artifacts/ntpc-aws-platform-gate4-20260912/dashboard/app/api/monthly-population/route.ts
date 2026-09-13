import { NextRequest, NextResponse } from "next/server";
import { getMonthlyPopulation, getMonthlyPopulationValue, monthlyPopulationData } from "../../monthly-population";
import type { AgeBand, Sex } from "../../dashboard-data";

const validYears = new Set([110, 111, 112, 113, 114]);
const validAgeBands = new Set<AgeBand>(["18-24", "25-29", "30-35", "18-35"]);
const validSexes = new Set<Sex>(["合計", "男", "女"]);

function changeRate(current?: number, previous?: number) {
  return current == null || previous == null || previous === 0 ? null : ((current / previous) - 1) * 100;
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const selectedYear = params.get("year");
  const startYear = Number(params.get("startYear") ?? selectedYear);
  const endYear = Number(params.get("endYear") ?? selectedYear);
  const geography = params.get("geography") ?? "新北市";
  const ageBand = params.get("ageBand") as AgeBand;
  const sex = params.get("sex") as Sex;
  if (!validYears.has(startYear) || !validYears.has(endYear) || startYear > endYear || !validAgeBands.has(ageBand) || !validSexes.has(sex) || !geography.startsWith("新北市")) {
    return NextResponse.json({ error: "月資料篩選條件無效。" }, { status: 400 });
  }

  const years = [...validYears].filter((year) => year >= startYear && year <= endYear).sort((a, b) => a - b);
  const rows = years.flatMap((year) => getMonthlyPopulation(year, geography, ageBand, sex)).map((row) => {
    const previousPeriod = row.month === 1 ? `${row.year - 1}12` : `${row.year}${String(row.month - 1).padStart(2, "0")}`;
    const previousYearPeriod = `${row.year - 1}${String(row.month).padStart(2, "0")}`;
    return {
      ...row,
      monthChange: changeRate(row.population, getMonthlyPopulationValue(previousPeriod, geography, ageBand, sex)),
      yearChange: changeRate(row.population, getMonthlyPopulationValue(previousYearPeriod, geography, ageBand, sex)),
    };
  });
  const scaleRows = [...validYears].flatMap((scaleYear) => getMonthlyPopulation(scaleYear, geography, ageBand, sex));
  const scaleValues = scaleRows.map((row) => row.population);
  const rawMinimum = scaleValues.length ? Math.min(...scaleValues) : 0;
  const rawMaximum = scaleValues.length ? Math.max(...scaleValues) : 1;
  const rawRange = Math.max(rawMaximum - rawMinimum, 1);
  const step = 10 ** Math.max(0, Math.floor(Math.log10(rawRange)));
  const scale = {
    minimum: Math.floor(rawMinimum / step) * step,
    maximum: Math.ceil(rawMaximum / step) * step,
    rule: "同一行政區、年齡與性別採110–114年月資料共同固定Y軸",
  };
  return NextResponse.json({ rows, meta: monthlyPopulationData.meta, scale });
}

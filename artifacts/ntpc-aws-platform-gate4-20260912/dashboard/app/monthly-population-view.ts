export type MonthlyViewMode = "continuous" | "same-month";
type MonthValue = { year: number; month: number; population: number };

/** Select observed month-end stocks only; never convert annual values to months. */
export function monthlyPopulationView<T extends MonthValue>(input: readonly T[], mode: MonthlyViewMode, month: number) {
  const rows = input.filter(row => mode === "continuous" || row.month === month).slice().sort((a, b) => a.year - b.year || a.month - b.month);
  const first = rows.at(0), latest = rows.at(-1);
  const previousYear = latest ? input.find(row => row.year === latest.year - 1 && row.month === latest.month) : undefined;
  const difference = latest && previousYear ? latest.population - previousYear.population : null;
  const annualChange = difference != null && previousYear && previousYear.population !== 0 ? difference / previousYear.population * 100 : null;
  const windowChange = first && latest && first.population !== 0 ? (latest.population - first.population) / first.population * 100 : null;
  return { rows, first, latest, previousYear, difference, annualChange, windowChange };
}

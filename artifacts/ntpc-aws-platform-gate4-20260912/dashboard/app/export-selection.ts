import { dashboardData, geographyLabel, type AgeBand, type Sex } from "./dashboard-data";
import { buildLaborRows, buildRegisteredRows, buildWageRows, metricRow, type ExportRow } from "./export-contract";
import { exportTopic, exportGroupLabels, type ExportSelection } from "./export-catalogue";
import { monthlyPopulationData } from "./monthly-population";
import { youthIndustryWage } from "./youth-industry-wage";
import { educationMarriageShare, type JointEducationMarriagePayload } from "./joint-education-marriage";
import { getPopulation } from "./district-annual-rankings";
import { percentChange } from "./map-metrics";

export const exportDistricts = dashboardData.geographies.map(row => geographyLabel(row.name));
export const exportMaxRows = 15000;
export function validateExportSelection(input: unknown): ExportSelection {
  if (!input || typeof input !== "object") throw Error("請選擇資料主題與範圍。");
  const selection = input as ExportSelection, topic = exportTopic(selection.topic);
  if (!topic) throw Error("資料主題不存在。");
  const choose = <T extends string | number>(values: unknown, allowed: readonly T[], label: string): T[] => {
    if (!Array.isArray(values) || !values.length || values.length > allowed.length || values.some(value => !allowed.includes(value))) throw Error(label + "包含不支援的選項。");
    return [...new Set(values)] as T[];
  };
  const years = choose(selection.years, topic.id === "facilities" ? [dashboardData.service.snapshotYear] : topic.id === "monthly" ? [...new Set(monthlyPopulationData.records.map(r=>r.year))] : dashboardData.meta.years, "年度");
  const ages = choose(selection.ages, topic.ages ? dashboardData.meta.ageBands : ["不適用"], "年齡");
  const sexes = choose(selection.sexes, topic.sex ? dashboardData.meta.sexes : [topic.ages ? "合計" : "不適用"], "性別");
  const districts = choose(selection.districts, topic.region ? exportDistricts : ["新北市"], "行政區");
  if (topic.id === "facilities" && districts.includes("新北市") && districts.length > 1) throw Error("全新北市清冊已包含29區，請只選全新北市，或改選個別行政區。");
  // This is a per-request memory bound, not a silent truncation.
  const rowsPerCell = topic.id === "joint" ? 40 : topic.id === "industry" ? 38 : topic.id === "wage-industry" ? 19 : topic.id === "monthly" ? 12 : 12;
  if (years.length * ages.length * sexes.length * districts.length * rowsPerCell > exportMaxRows) throw Error("此次範圍較大，請分年度或分行政區下載（每次上限15,000列）。");
  return { topic: topic.id, years: years.sort((a,b) => a-b), ages, sexes, districts };
}
export function selectionRequiredFields(topic: string) {
  const specific = topic === "monthly" ? ["roc_month"] : topic === "joint" ? ["education_name_zh", "marriage_name_zh"] : topic === "facilities" ? ["facility_name", "facility_address", "operating_status"] : [];
  return ["category_dimension_name_zh", "category_name_zh", ...specific];
}

type JointLoader = (district: string) => Promise<JointEducationMarriagePayload>;
export async function buildSelectionRows(input: ExportSelection, loadJoint?: JointLoader): Promise<ExportRow[]> {
  const selection = validateExportSelection(input), topic = exportTopic(selection.topic)!;
  const result: ExportRow[] = [];
  const jointCache = new Map<string, JointEducationMarriagePayload>();
  const append = (rows: ExportRow[]) => { result.push(...rows); if (result.length > exportMaxRows) throw Error("超過每次15,000列上限，請縮小年度或行政區範圍。"); };
  for (const year of selection.years) for (const age of selection.ages) for (const sex of selection.sexes) for (const district of selection.districts) {
    const ageBand = age as AgeBand, selectedSex = sex as Sex;
    if (["population", "education", "marriage"].includes(topic.id)) {
      const rows = buildRegisteredRows(year, ageBand, selectedSex, district);
      const prefixes = topic.id === "population" ? ["REGISTERED_", "SEX_"] : topic.id === "education" ? ["EDUCATION_"] : ["MARITAL_"];
      append(rows.filter(row => prefixes.some(prefix => String(row.metric_code).startsWith(prefix))));
      if (topic.id === "population" && rows.length) {
        const record = dashboardData.registered.find(row => row.year === year && geographyLabel(row.geography) === district && row.ageBand === ageBand && row.sex === selectedSex)!;
        const meta = { origin: record.populationOrigin, method: "單一年齡直接加總後計算", low: null, high: null };
        append([
          metricRow("registered", year, ageBand, selectedSex, district, "青年戶籍人口密度", record.populationDensityPerKm2, "人／平方公里", meta, { metric_code: "REGISTERED_DENSITY", numerator: record.population, denominator: record.landAreaKm2, formula_zh: "戶籍人口數÷行政區土地面積", source_name: "戶籍人口與官方行政區土地面積", source_url: dashboardData.sources.find(s => s.name.includes("面積"))?.url ?? rows[0].source_url }),
          metricRow("registered", year, ageBand, selectedSex, district, "戶籍人口年度變化率", percentChange(record.population, getPopulation(year - 1, district, ageBand, selectedSex) ?? undefined), "%", meta, { metric_code: "REGISTERED_YOY", formula_zh: "（本年人口÷前一年人口－1）×100%", source_name: rows[0].source_name, source_url: rows[0].source_url }),
        ]);
      }
    } else if (topic.id === "labor" || topic.id === "industry") {
      append(buildLaborRows(year, ageBand).filter(row => topic.id === "labor" ? row.category_dimension_name_zh !== "行業" : row.category_dimension_name_zh === "行業" && row.sex_name_zh === sex));
    } else if (topic.id === "wage") {
      append(buildWageRows(year, ageBand));
    } else if (topic.id === "monthly") {
      const meta = monthlyPopulationData.meta;
      append(monthlyPopulationData.records.filter(row => row.year === year && geographyLabel(row.geography) === district && row.ageBand === age && row.sex === sex).map(row =>
        metricRow("registered", year, ageBand, selectedSex, district, "每月戶籍人口數", row.population, "人", { origin: meta.identity, method: meta.method, low: null, high: null }, { metric_code: "MONTH_END_POPULATION", roc_month: row.month, period_basis: meta.timeBasis, formula_zh: meta.method, source_name: meta.sourceName, source_url: meta.sourceUrl, data_updated_at: meta.generatedAt })));
    } else if (topic.id === "joint") {
      if (!loadJoint) throw Error("教育×婚姻資料暫時無法讀取，請稍後重試。");
      if (!jointCache.has(district)) jointCache.set(district, await loadJoint(district));
      const payload = jointCache.get(district)!;
      for (const row of payload.records.filter(row => row.year === year && row.ageBand === age && row.sex === sex)) {
        const share = educationMarriageShare(payload, year, ageBand, selectedSex, row.education, row.marriage);
        const common = { education_name_zh: row.education, marriage_name_zh: row.marriage, category_dimension_name_zh: "教育×婚姻", category_name_zh: row.education + "／" + row.marriage, source_name: payload.meta.sourceName, source_url: payload.meta.sourceUrl };
        append([
          metricRow("registered", year, ageBand, selectedSex, district, "教育×婚姻人口數", row.population, "人", { origin: row.origin, method: row.method, low: row.populationLow, high: row.populationHigh }, { ...common, metric_code: "JOINT_COUNT", formula_zh: row.method }),
          metricRow("registered", year, ageBand, selectedSex, district, "該教育程度內婚姻占比", share?.value ?? null, "%", share ?? null, { ...common, metric_code: "JOINT_SHARE", numerator: share?.numerator ?? null, denominator: share?.denominator ?? null, formula_zh: "同年齡性別該教育程度該婚姻人口÷該教育程度所有婚姻人口×100%" }),
        ]);
      }
    } else if (topic.id === "wage-industry") {
      const meta = youthIndustryWage.meta;
      append(youthIndustryWage.rows.map(row => {
        const estimate = row.estimates[ageBand], available = year === meta.rocYear && estimate.value != null;
        return metricRow("wage", year, ageBand, "合計", district, meta.statistic, available ? estimate.value : null, meta.unit, available ? { origin: meta.identity, method: meta.formula, low: estimate.low, high: estimate.high } : null, { metric_code: "YOUTH_INDUSTRY_WAGE", category_dimension_name_zh: "行業", category_name_zh: row.industry, formula_zh: meta.formula, source_name: meta.sources.map(s => s.name).join("；"), source_url: meta.sources.map(s => s.url).join("；"), data_updated_at: meta.generatedAt, note_zh: year !== meta.rocYear ? "此年度尚無同口徑行業薪資資料。" : available ? meta.uncertainty : "不在本薪資統計的行業母體。" });
      }));
    } else if (topic.id === "service") {
      for (const row of dashboardData.service.annual.filter(row => row.year === year)) {
        append([["服務場次", row.activityCount, "場"], ["參與人次", row.participationPersonTimes, "人次"], ["每場平均服務人次", row.personTimesPerActivity, "人次／場"]].map(([name, value, unit]) => {
          const evidence = Object.values(row.meta).find(m => m.unit === unit);
          return { universe_name_zh: exportGroupLabels.service, roc_year: year, age_band: "不適用", sex_name_zh: "不適用", geography_name_zh: "新北市", period_basis: "全年服務量", category_dimension_name_zh: "服務主題", category_name_zh: row.domainLabel, metric_name_zh: name, value, unit, value_origin_label_zh: evidence?.origin ?? "官方服務統計", method_name_zh: evidence?.method ?? "官方服務紀錄", source_name: "新北市青年服務統計", source_url: evidence?.sourceUrl ?? "", data_updated_at: dashboardData.meta.generatedAt, availability_status_zh: "可用", note_zh: "參與人次未去重，同一人可能重複計入。" };
        }));
      }
    } else if (topic.id === "facilities") {
      append(dashboardData.service.facilities.filter(row => district === "新北市" || row.district === district).map(row => ({ universe_name_zh: exportGroupLabels.service, roc_year: year, period_basis: "據點清冊快照", age_band: "不適用", sex_name_zh: "不適用", geography_name_zh: row.district, facility_name: row.name, facility_address: row.address, operating_status: row.operatingStatus, metric_name_zh: "營運中青年據點", value: row.active ? 1 : 0, unit: "處", value_origin_label_zh: "官方清冊", method_name_zh: "官方清冊逐筆列示", source_name: "新北市青年據點官方頁面", source_url: row.sourceUrl, data_updated_at: dashboardData.meta.generatedAt, availability_status_zh: "可用", note_zh: row.capacitySummary, metric_code: row.facilityCode })));
    }
  }
  return result.map((row, index) => ({ ...row, record_id: ["EXPORT", topic.id, row.roc_year, row.roc_month, row.geography_name_zh, row.age_band, row.sex_name_zh, row.metric_code ?? row.metric_name_zh, row.category_name_zh, index].map(value => encodeURIComponent(String(value ?? ""))).join("-") }));
}

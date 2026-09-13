import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputDir = resolve(root, "data", "policy-ranking");
const districtOutput = resolve(outputDir, "01_新北市29行政區青年指標排名.csv");
const cityOutput = resolve(outputDir, "02_新北市全市青年指標年度與結構排名.csv");

const dashboard = JSON.parse(await readFile(resolve(root, "app", "data", "g5-dashboard-data.json"), "utf8"));
const baseline = JSON.parse(await readFile(resolve(root, "app", "data", "district-population-baseline-109.json"), "utf8"));
const industry = JSON.parse(await readFile(resolve(root, "app", "data", "resident-employment-industry.json"), "utf8"));
const youthIndustryWage = JSON.parse(await readFile(resolve(root, "app", "data", "youth-industry-wage.json"), "utf8"));

const VERSION = "G6-POLICY-RANKING-2.1";
const SOURCE_VERIFIED_AT = "2026-09-07";
const generatedAt = new Date().toISOString();
const ageLabel = { "18-24": "18–24歲", "25-29": "25–29歲", "30-35": "30–35歲", "18-35": "18–35歲" };
const sourceUrls = Object.fromEntries(dashboard.sources.map((source) => [source.name, source.url]));
const populationUrl = sourceUrls["村里戶數、單一年齡人口"];
const educationUrl = sourceUrls["15歲以上現住人口按教育程度分"];
const marriageUrl = sourceUrls["15歲以上現住人口按婚姻狀況分"];
const laborUrl = sourceUrls["人力資源調查統計年報"];
const wageUrl = sourceUrls["受僱員工全年總薪資統計"];
const areaUrl = sourceUrls["新北市行政區面積"];
const facilityUrl = sourceUrls["新北市青年服務據點官方頁面"];

function safeText(value) {
  if (value == null) return "";
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const text = safeText(value).replaceAll('"', '""');
  return /[",\r\n]/.test(text) ? `"${text}"` : text;
}

function toCsv(headers, rows) {
  return `\uFEFF${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function rankDescending(values, target) {
  if (target == null || !Number.isFinite(target)) return null;
  return 1 + values.filter((value) => value != null && Number.isFinite(value) && value > target).length;
}

function percentileBand(rank, total) {
  if (rank == null || !total) return "";
  if (rank <= Math.ceil(total * 0.2)) return "前20%";
  if (rank > Math.floor(total * 0.8)) return "後20%";
  return "中間60%";
}

function round(value, digits = 6) {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function districtName(name) {
  return name.replace(/^新北市/, "");
}

const districts = dashboard.geographies.filter((item) => item.level === "DISTRICT").map((item) => districtName(item.name));
const districtRecords = dashboard.registered.filter((row) => row.geography !== "新北市");
const baselineRecords = baseline.records;

function districtRecord(year, district, band, sex) {
  return districtRecords.find((row) => row.year === year && row.geography === district && row.ageBand === band && row.sex === sex);
}

function baselinePopulation(district, band, sex) {
  return baselineRecords.find((row) => row.geography === district && row.ageBand === band && row.sex === sex)?.population ?? null;
}

function activeFacilityCount(district) {
  return dashboard.service.facilities.filter((item) => item.active && item.district === district).length;
}

const districtRows = [];
for (const year of dashboard.meta.years) {
  for (const band of dashboard.meta.ageBands) {
    for (const sex of dashboard.meta.sexes) {
      const cohort = districts.map((district) => {
        const record = districtRecord(year, district, band, sex);
        const previous = year === 110 ? baselinePopulation(district, band, sex) : districtRecord(year - 1, district, band, sex)?.population ?? null;
        const changePct = record?.population != null && previous ? (record.population / previous - 1) * 100 : null;
        return { district, record, changePct, facilities: activeFacilityCount(district) };
      });
      const populationValues = cohort.map((item) => item.record?.population ?? null);
      const densityValues = cohort.map((item) => item.record?.populationDensityPerKm2 ?? null);
      const changeValues = cohort.map((item) => item.changePct);
      const facilityValues = cohort.map((item) => item.facilities);
      for (const item of cohort) {
        const row = {
          資料版本: VERSION,
          資料更新日期: generatedAt,
          來源查核日期: SOURCE_VERIFIED_AT,
          民國年度: year,
          新北市行政區: item.district,
          年齡層: ageLabel[band],
          性別: sex,
          戶籍人口數: item.record?.population ?? "",
          戶籍人口數排名: rankDescending(populationValues, item.record?.population ?? null),
          戶籍人口密度_人每平方公里: round(item.record?.populationDensityPerKm2),
          戶籍人口密度排名: rankDescending(densityValues, item.record?.populationDensityPerKm2 ?? null),
          戶籍人口年度變化率_百分比: round(item.changePct),
          戶籍人口年度變化率排名: rankDescending(changeValues, item.changePct),
          青年據點數: item.facilities,
          青年據點數排名: rankDescending(facilityValues, item.facilities),
          青年據點資料年度: dashboard.service.snapshotYear,
          人口資料身分: item.record?.populationOrigin ?? "",
          教育婚姻資料身分: band === "25-29" ? "官方行政精確值" : "官方行政邊際推估值",
          政策分析可用性: "可做相對排序、門檻初篩與待查核問題",
          政策分析限制: "排名只表示同年度同條件的相對位置，不代表政策成效、因果或資源核定；服務據點數不等於服務量能或覆蓋率",
          資料來源: `${populationUrl}；${educationUrl}；${marriageUrl}；${areaUrl}；${facilityUrl}`,
        };
        for (const category of ["國中及以下", "高中職", "專科", "大學", "研究所"]) {
          const values = cohort.map((entry) => entry.record?.education?.[category]?.value ?? null);
          const value = item.record?.education?.[category]?.value ?? null;
          row[`${category}比例_百分比`] = round(value);
          row[`${category}比例排名`] = rankDescending(values, value);
        }
        for (const category of ["未婚", "有偶", "離婚或終止結婚", "喪偶"]) {
          const values = cohort.map((entry) => entry.record?.marriage?.[category]?.value ?? null);
          const value = item.record?.marriage?.[category]?.value ?? null;
          row[`${category}比例_百分比`] = round(value);
          row[`${category}比例排名`] = rankDescending(values, value);
        }
        districtRows.push(row);
      }
    }
  }
}

const districtHeaders = [
  "資料版本", "資料更新日期", "來源查核日期", "民國年度", "新北市行政區", "年齡層", "性別",
  "戶籍人口數", "戶籍人口數排名", "戶籍人口密度_人每平方公里", "戶籍人口密度排名",
  "戶籍人口年度變化率_百分比", "戶籍人口年度變化率排名",
  "國中及以下比例_百分比", "國中及以下比例排名", "高中職比例_百分比", "高中職比例排名",
  "專科比例_百分比", "專科比例排名", "大學比例_百分比", "大學比例排名", "研究所比例_百分比", "研究所比例排名",
  "未婚比例_百分比", "未婚比例排名", "有偶比例_百分比", "有偶比例排名",
  "離婚或終止結婚比例_百分比", "離婚或終止結婚比例排名", "喪偶比例_百分比", "喪偶比例排名",
  "青年據點數", "青年據點數排名", "青年據點資料年度", "人口資料身分", "教育婚姻資料身分", "政策分析可用性", "政策分析限制", "資料來源",
];

const cityRows = [];
function addCityRow(row) {
  cityRows.push({
    資料版本: VERSION,
    資料更新日期: generatedAt,
    來源查核日期: SOURCE_VERIFIED_AT,
    新北市地區名: "新北市",
    民國年度: row.year ?? "",
    年齡層: ageLabel[row.ageBand] ?? row.ageBand ?? "",
    性別: row.sex ?? "男女合計",
    資料主題: row.topic,
    指標名稱: row.metric,
    分類維度: row.categoryDimension ?? "",
    分類名稱: row.categoryName ?? "",
    數值: round(row.value),
    下限: round(row.low),
    上限: round(row.high),
    單位: row.unit,
    資料身分: row.identity,
    計算方法: row.method,
    來源代號: row.sourceAlias,
    來源網址: row.sourceUrl,
    可用性狀態: row.availability ?? (row.value == null ? "資料缺口" : "可發布"),
    限制說明: row.limitation ?? "",
    政策分析可用性: row.policyReadiness ?? "可做描述、趨勢、相對位置與政策問題初篩",
    政策分析限制: row.policyLimit ?? "不得由描述性關聯宣稱因果、政策效果或直接核定資源",
  });
}

for (const row of dashboard.registered.filter((item) => item.geography === "新北市")) {
  addCityRow({ year: row.year, ageBand: row.ageBand, sex: row.sex, topic: "戶籍人口", metric: "戶籍人口數", value: row.population, unit: "人", identity: row.populationOrigin, method: "單一年齡戶籍人口直接加總", sourceAlias: "MOI-POP1Y", sourceUrl: populationUrl });
  addCityRow({ year: row.year, ageBand: row.ageBand, sex: row.sex, topic: "戶籍人口", metric: "占該地區同年齡性別戶籍人口比率", value: row.populationSharePct, unit: "%", identity: "官方行政精確值直接計算", method: "青年戶籍人口÷該地區同年度同性別戶籍人口×100", sourceAlias: "MOI-POP1Y", sourceUrl: populationUrl });
  addCityRow({ year: row.year, ageBand: row.ageBand, sex: row.sex, topic: "戶籍人口", metric: "戶籍人口密度", value: row.populationDensityPerKm2, unit: "人/平方公里", identity: "官方行政精確值直接計算", method: "戶籍人口數÷官方土地面積", sourceAlias: "MOI-POP1Y+NTPC-AREA", sourceUrl: `${populationUrl}；${areaUrl}` });
  if (row.sexSharePct != null) addCityRow({ year: row.year, ageBand: row.ageBand, sex: row.sex, topic: "男女結構", metric: "性別占比", value: row.sexSharePct, unit: "%", identity: "官方行政精確值直接計算", method: "該性別人口÷男女合計人口×100", sourceAlias: "MOI-POP1Y", sourceUrl: populationUrl });
  for (const [category, item] of Object.entries(row.education)) addCityRow({ year: row.year, ageBand: row.ageBand, sex: row.sex, topic: "教育程度", metric: "教育程度占比", categoryDimension: "教育程度", categoryName: category, value: item.value, low: item.low, high: item.high, unit: "%", identity: item.origin, method: item.method, sourceAlias: "MOI-EDU", sourceUrl: educationUrl });
  for (const [category, item] of Object.entries(row.marriage)) addCityRow({ year: row.year, ageBand: row.ageBand, sex: row.sex, topic: "婚姻狀態", metric: "婚姻狀態占比", categoryDimension: "婚姻狀態", categoryName: category, value: item.value, low: item.low, high: item.high, unit: "%", identity: item.origin, method: item.method, sourceAlias: "MOI-MARITAL", sourceUrl: marriageUrl });
}

for (const row of dashboard.labor) {
  for (const [metric, value] of Object.entries(row.metrics)) {
    const meta = row.meta[metric];
    addCityRow({ year: row.year, ageBand: row.ageBand, topic: "民間人口與勞動市場", metric, value, low: meta.low, high: meta.high, unit: meta.unit, identity: meta.origin, method: meta.method, sourceAlias: "DGBAS-NTPC-LABOR-AGE", sourceUrl: laborUrl, limitation: "新北市全市、男女合計；不得與戶籍人口母體畫上等號" });
  }
}

for (const row of industry.records.filter((item) => item.ageBand !== "ALL")) {
  const sourceUrl = industry.meta.sourcePages[String(row.year)];
  addCityRow({ year: row.year, ageBand: row.ageBand, sex: row.sex, topic: "居住於新北市青年就業者行業", metric: "就業人數", categoryDimension: "行業", categoryName: row.industry, value: row.employedThousands, low: row.employedThousandsLow, high: row.employedThousandsHigh, unit: "千人", identity: row.origin, method: row.method, sourceAlias: "DGBAS-NTPC-INDUSTRY-PCLM-IPF", sourceUrl, limitation: "居住地口徑；行業不是職業，也不是工作地" });
  addCityRow({ year: row.year, ageBand: row.ageBand, sex: row.sex, topic: "居住於新北市青年就業者行業", metric: "行業占就業者比率", categoryDimension: "行業", categoryName: row.industry, value: row.sharePct, low: row.sharePctLow, high: row.sharePctHigh, unit: "%", identity: row.origin, method: row.method, sourceAlias: "DGBAS-NTPC-INDUSTRY-PCLM-IPF", sourceUrl, limitation: "居住地口徑；行業不是職業，也不是工作地" });
}

for (const row of dashboard.wage.filter((item) => item.ageBand === "18-35")) {
  const mean = row.metrics["全年總薪資平均數"];
  const median = row.metrics["全年總薪資中位數"];
  for (const metric of ["全年總薪資平均數", "全年總薪資中位數"]) {
    const meta = row.meta[metric];
    addCityRow({ year: row.year, ageBand: row.ageBand, topic: "受僱員工薪資", metric, value: row.metrics[metric], low: meta.low, high: meta.high, unit: meta.unit, identity: meta.origin, method: meta.method, sourceAlias: "DGBAS-WAGE-T6", sourceUrl: wageUrl, limitation: "工作場所位於新北市；男女合計；不得描述成設籍青年所得" });
  }
  const meanMeta = row.meta["全年總薪資平均數"];
  const medianMeta = row.meta["全年總薪資中位數"];
  addCityRow({ year: row.year, ageBand: row.ageBand, topic: "受僱員工薪資", metric: "平均數與中位數差額", value: mean - median, low: (meanMeta.low ?? mean) - (medianMeta.high ?? median), high: (meanMeta.high ?? mean) - (medianMeta.low ?? median), unit: "萬元/年", identity: "由官方或模型薪資值直接計算", method: "全年總薪資平均數－全年總薪資中位數", sourceAlias: "DGBAS-WAGE-T6", sourceUrl: wageUrl, limitation: "差額描述分布位置，不等同所得不均指標" });
  addCityRow({ year: row.year, ageBand: row.ageBand, topic: "受僱員工薪資", metric: "薪資分布偏斜代理值", value: (mean / median - 1) * 100, low: ((meanMeta.low ?? mean) / (medianMeta.high ?? median) - 1) * 100, high: ((meanMeta.high ?? mean) / (medianMeta.low ?? median) - 1) * 100, unit: "%", identity: "由官方或模型薪資值直接計算", method: "（全年總薪資平均數÷全年總薪資中位數－1）×100", sourceAlias: "DGBAS-WAGE-T6", sourceUrl: wageUrl, limitation: "僅為平均數與中位數差異的代理量，不是統計偏度係數" });
}

for (const row of youthIndustryWage.rows) {
  const band = "18-35";
  const estimate = row.estimates[band];
  addCityRow({ year: youthIndustryWage.meta.rocYear, ageBand: band, topic: "受僱員工薪資", metric: "青年各行業全年總薪資平均數", categoryDimension: "行業", categoryName: row.industry, value: estimate.value, low: estimate.low, high: estimate.high, unit: youthIndustryWage.meta.unit, identity: estimate.value == null ? "資料缺口" : youthIndustryWage.meta.identity, method: youthIndustryWage.meta.formula, sourceAlias: "DGBAS-WAGE-T2+DGBAS-WAGE-T6+BLI-AGE-REGION-SEX", sourceUrl: youthIndustryWage.meta.sources[0].url, availability: estimate.status, limitation: youthIndustryWage.meta.limitations.join("；") });
}

const groupKey = (row) => [row.年齡層, row.性別, row.資料主題, row.指標名稱, row.分類維度, row.分類名稱].join("|");
const peerKey = (row) => [row.民國年度, row.年齡層, row.性別, row.資料主題, row.指標名稱, row.分類維度].join("|");
const series = Map.groupBy(cityRows, groupKey);
const peers = Map.groupBy(cityRows, peerKey);

for (const row of cityRows) {
  const timeline = series.get(groupKey(row)).filter((item) => item.數值 !== null && item.數值 !== "" && Number.isFinite(item.數值));
  const values = timeline.map((item) => item.數值);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const previous = timeline.find((item) => item.民國年度 === row.民國年度 - 1)?.數值 ?? null;
  const timeRank = rankDescending(values, row.數值);
  const maximum = values.length ? Math.max(...values) : null;
  const minimum = values.length ? Math.min(...values) : null;
  let position = "";
  if (row.數值 != null && values.length > 1) {
    if (maximum === minimum) position = "可得年度持平";
    else if (row.數值 === maximum) position = "可得年度最高";
    else if (row.數值 === minimum) position = "可得年度最低";
    else {
      const near = row.單位 === "%" ? Math.abs(row.數值 - mean) <= 0.5 : Math.abs((row.數值 - mean) / mean) <= 0.02;
      position = near ? "接近可得年度平均" : row.數值 > mean ? "高於可得年度平均" : "低於可得年度平均";
    }
  }
  const peerValues = peers.get(peerKey(row)).map((item) => item.數值).filter((value) => value !== null && value !== "" && Number.isFinite(value));
  const peerRank = row.分類名稱 && peerValues.length > 1 ? rankDescending(peerValues, row.數值) : null;
  row.同類排名 = peerRank ?? "";
  row.同類項目數 = peerRank == null ? "" : peerValues.length;
  row.同類分位帶 = percentileBand(peerRank, peerValues.length);
  row.可比較年度數 = values.length;
  row.時間排名 = timeRank ?? "";
  row.歷史位置 = position;
  row.可得年度平均 = round(mean);
  row.與可得年度平均差值 = row.數值 == null || mean == null ? "" : round(row.數值 - mean);
  row.與可得年度平均差率_百分比 = row.數值 == null || !mean ? "" : round((row.數值 / mean - 1) * 100);
  row.前一年數值 = previous ?? "";
  row.與前一年差值 = row.數值 == null || previous == null ? "" : round(row.數值 - previous);
  row.與前一年變化率_百分比 = row.數值 == null || !previous ? "" : round((row.數值 / previous - 1) * 100);
}

const cityHeaders = [
  "資料版本", "資料更新日期", "來源查核日期", "新北市地區名", "民國年度", "年齡層", "性別", "資料主題", "指標名稱", "分類維度", "分類名稱",
  "數值", "下限", "上限", "單位", "同類排名", "同類項目數", "同類分位帶", "可比較年度數", "時間排名", "歷史位置",
  "可得年度平均", "與可得年度平均差值", "與可得年度平均差率_百分比", "前一年數值", "與前一年差值", "與前一年變化率_百分比",
  "資料身分", "計算方法", "來源代號", "來源網址", "可用性狀態", "限制說明", "政策分析可用性", "政策分析限制",
];

await mkdir(dirname(districtOutput), { recursive: true });
await writeFile(districtOutput, toCsv(districtHeaders, districtRows), "utf8");
await writeFile(cityOutput, toCsv(cityHeaders, cityRows), "utf8");

const youthWageRows = cityRows.filter((row) => row.指標名稱 === "青年各行業全年總薪資平均數");
const youthWageAvailable = youthWageRows.filter((row) => row.數值 !== null && row.數值 !== "");
console.log(JSON.stringify({
  districtOutput,
  districtRows: districtRows.length,
  cityOutput,
  cityRows: cityRows.length,
  youthIndustryWageRows: youthWageRows.length,
  youthIndustryWageAvailable: youthWageAvailable.length,
  youthIndustryWageMissing: youthWageRows.length - youthWageAvailable.length,
}, null, 2));

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [inputArg, outputArg = "app/data/mol-salary-context.json", matrixOutputArg] = process.argv.slice(2);

if (!inputArg) {
  throw new Error("用法：node scripts/build-mol-salary-context.mjs <勞動部JSON> [輸出JSON]");
}

const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);
const matrixOutputPath = resolve(matrixOutputArg ?? (outputArg === "app/data/mol-salary-context.json" ? "app/data/mol-salary-matrix.json" : outputArg.replace(/\.json$/i, "-matrix.json")));
const records = JSON.parse(await readFile(inputPath, "utf8"));
const requiredFields = ["計費年度", "計費月份", "地區別", "行業別", "規模別", "月底人數", "平均提繳工資金額"];

if (!Array.isArray(records) || records.length === 0) {
  throw new Error("勞動部資料不是非空陣列。");
}

for (const field of requiredFields) {
  if (!(field in records[0])) throw new Error(`勞動部資料缺少欄位：${field}`);
}

const years = [...new Set(records.map((row) => Number(row["計費年度"])))].sort((a, b) => a - b);
const latestYear = years.at(-1);
const latestMonth = Math.max(...records.filter((row) => Number(row["計費年度"]) === latestYear).map((row) => Number(row["計費月份"])));
const snapshot = records.filter((row) => Number(row["計費年度"]) === latestYear && Number(row["計費月份"]) === latestMonth);

const number = (value) => {
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const summarize = (rows) => {
  const headcount = rows.reduce((sum, row) => sum + number(row["月底人數"]), 0);
  const weightedWage = rows.reduce((sum, row) => sum + number(row["月底人數"]) * number(row["平均提繳工資金額"]), 0);
  return {
    headcount,
    averageContributionWage: headcount > 0 ? Math.round(weightedWage / headcount) : null,
  };
};

const groupBy = (rows, field) => {
  const groups = new Map();
  for (const row of rows) {
    const key = row[field];
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([name, group]) => ({ name, ...summarize(group) }));
};

const countyRows = groupBy(snapshot, "地區別").sort((a, b) => (b.averageContributionWage ?? 0) - (a.averageContributionWage ?? 0));
const ntpcRows = snapshot.filter((row) => row["地區別"] === "新北市");
const newTaipei = summarize(ntpcRows);
const national = summarize(snapshot);
const countyRank = countyRows.findIndex((row) => row.name === "新北市") + 1;

if (!ntpcRows.length || countyRank === 0) throw new Error("來源資料找不到新北市。");

const sizeGroups = [
  { name: "1–9人", sourceBands: ["1-2人", "3-4人", "5-9人"] },
  { name: "10–49人", sourceBands: ["10-19人", "20-29人", "30-39人", "40-49人"] },
  { name: "50–199人", sourceBands: ["50-99人", "100-199人"] },
  { name: "200–999人", sourceBands: ["200-299人", "300-399人", "400-499人", "500-999人"] },
  { name: "1,000人以上", sourceBands: ["1000-1999人", "2000-2999人", "3000-3999人", "4000-4999人", "5000-9999人"] },
  { name: "其他", sourceBands: ["其他"] },
];

const industries = groupBy(ntpcRows, "行業別").sort((a, b) => (b.averageContributionWage ?? 0) - (a.averageContributionWage ?? 0));
const industrySizeMatrix = industries.map((industry) => ({
  industry: industry.name,
  total: industry,
  cells: sizeGroups.map((sizeGroup) => ({
    sizeGroup: sizeGroup.name,
    sourceBands: sizeGroup.sourceBands,
    ...summarize(ntpcRows.filter((row) => row["行業別"] === industry.name && sizeGroup.sourceBands.includes(row["規模別"]))),
  })),
}));
const matrixPayload = { sizeGroups, rows: industrySizeMatrix };

const payload = {
  meta: {
    sourceName: "勞工退休金提繳統計年報－按地區、行業及規模別",
    sourceUrl: "https://data.gov.tw/dataset/102667",
    salarySystemUrl: "https://yoursalary.taiwanjobs.gov.tw/Salary/SalaryHome",
    sourceApiUrl: "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030214-zBS",
    rocYear: latestYear,
    month: latestMonth,
    geographyBasis: "提繳單位登記地址；自營作業者依戶籍地址",
    population: "勞退新制提繳者；本頁補充層為全年齡，不是18–35歲受僱員工統計",
    metricDefinition: "勞工與相關提繳者依月薪資總額，或自營作業者等依月提繳執行業務所得，對照分級表申報之月提繳工資；本資料欄位為全年平均。屬級距化申報值，不是由提繳金額回推，也不等同實領薪資或全年總薪資",
    aggregationMethod: "來源每格平均提繳工資金額為全年平均；本頁以各格12月底人數加權重算新北市、全國與彙整群組的平均月提繳工資近似值。因權重不是全年平均提繳人數，屬分組重算值，不等同實際平均薪資",
    matrixGroupMethod: "先依行業保留官方19類，再將官方19個規模帶彙整為1–9、10–49、50–199、200–999、1,000人以上及其他；每格彙整平均＝Σ（來源格12月底人數×來源格全年平均提繳工資）÷Σ來源格12月底人數。此為分組重算近似值，不等同實際平均薪資",
  },
  newTaipei: {
    ...newTaipei,
    countyRank,
    countyCount: countyRows.length,
    nationalAverageContributionWage: national.averageContributionWage,
    differenceFromNationalPct: national.averageContributionWage
      ? Number((((newTaipei.averageContributionWage - national.averageContributionWage) / national.averageContributionWage) * 100).toFixed(2))
      : null,
  },
  industries,
  organizationSizes: groupBy(ntpcRows, "規模別").sort((a, b) => (b.averageContributionWage ?? 0) - (a.averageContributionWage ?? 0)),
};

await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await writeFile(matrixOutputPath, `${JSON.stringify(matrixPayload, null, 2)}\n`, "utf8");
console.log(`已輸出 ${outputPath} 與 ${matrixOutputPath}`);

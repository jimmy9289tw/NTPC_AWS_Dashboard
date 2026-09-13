import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";

const project = "D:/github/work/019fe05e-e1a3-71f2-840e-c026180d9474/NtpcYouthAI";
const packageRoot = path.join(
  project,
  "deliverables/NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826",
);

const files = [
  "09_發布資料包/01_戶籍人口母體_長格式.csv",
  "09_發布資料包/02_民間人口與勞動市場母體_長格式.csv",
  "09_發布資料包/03_受僱員工薪資母體_長格式.csv",
  "09_發布資料包/06_政策服務與曝光_長格式.csv",
  "09_發布資料包/07_三母體與外部政策資料整合狀態.csv",
  "09_發布資料包/external_metric_code_book.csv",
  "10_官方原始資料與處理結果/07_行政區面積與政策服務/processed/NTPC_District_Land_Area_Official.csv",
  "10_官方原始資料與處理結果/07_行政區面積與政策服務/processed/NTPC_Youth_Service_Participation_111_114.csv",
];

const excelErrors = ["#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A"];
const results = [];

for (const relativePath of files) {
  const absolutePath = path.join(packageRoot, relativePath);
  const csvText = await fs.readFile(absolutePath, "utf8");
  const lineCount = csvText.split(/\r?\n/).filter((line) => line.length > 0).length;
  const useSample = Buffer.byteLength(csvText, "utf8") > 5_000_000;
  const importText = useSample
    ? csvText.split(/\r?\n/).slice(0, 201).join("\n")
    : csvText;
  const workbook = await Workbook.fromCSV(importText, { sheetName: "Data" });
  const overview = await workbook.inspect({
    kind: "workbook,sheet,region",
    sheetId: "Data",
    range: "A1:H4",
    maxChars: 3000,
    tableMaxRows: 4,
    tableMaxCols: 8,
    tableMaxCellChars: 100,
  });
  const errorHits = excelErrors.filter((token) => csvText.includes(token));
  results.push({
    file: relativePath,
    bytes: Buffer.byteLength(csvText, "utf8"),
    csvRowsIncludingHeader: lineCount,
    inspectionMode: useSample ? "前200筆資料列；全檔另做錯誤字串掃描" : "全檔",
    artifactToolImport: "PASS",
    excelErrorTokenScan: errorHits.length === 0 ? "PASS" : "FAIL",
    errorHits,
    inspection: overview.ndjson,
  });
}

const report = {
  generatedAtUtc: new Date().toISOString(),
  artifactTool: "@oai/artifact-tool",
  inspectedFiles: results.length,
  overallStatus: results.every(
    (item) => item.artifactToolImport === "PASS" && item.excelErrorTokenScan === "PASS",
  )
    ? "PASS"
    : "FAIL",
  results,
};

const output = path.join(
  packageRoot,
  "08_人工查核與異常處理/machine_qa/artifact_tool_csv_inspection.json",
);
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output,
  inspectedFiles: report.inspectedFiles,
  overallStatus: report.overallStatus,
}, null, 2));

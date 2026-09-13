import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const [key, ...rest] = item.split("=");
    return [key.replace(/^--/, ""), rest.join("=")];
  }),
);

if (!args.input || !args.output || !args.preview) {
  throw new Error("usage: --input=<json> --output=<csv> --preview=<png>");
}

const payload = JSON.parse(await fs.readFile(args.input, "utf8"));
const rows = payload.rows;
if (!Array.isArray(rows) || rows.length === 0) {
  throw new Error("input rows are empty");
}

const headers = [
  "record_id",
  "phase",
  "topic",
  "source_alias",
  "source_name",
  "source_period",
  "source_geography",
  "geography_role",
  "population_scope",
  "measure_code",
  "measure_name",
  "source_age_band",
  "target_age_band",
  "sex",
  "education_level",
  "source_value",
  "source_unit",
  "adjustment_method_code",
  "adjusted_value",
  "adjusted_unit",
  "value_status",
  "evidence_class",
  "value_origin_class",
  "value_origin_label_zh",
  "official_published_value",
  "is_statistical_estimate",
  "calculation_or_estimation_method",
  "uncertainty_precision_note",
  "method_verification_status",
  "interval_overlap_percent",
  "can_answer_18_35",
  "publish_status",
  "source_url",
  "local_snapshot",
  "sha256",
  "definition_conflict",
  "human_review_id",
  "human_review_required",
  "notes",
];

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

const csvLines = [
  headers.map(csvEscape).join(","),
  ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
];
const csvText = csvLines.join("\r\n") + "\r\n";

// Import through artifact-tool so the final flat file is structurally verified
// by the same spreadsheet runtime used for standalone spreadsheet artifacts.
const workbook = await Workbook.fromCSV(csvText, { sheetName: "AgeIntegration" });
const sheet = workbook.worksheets.getItem("AgeIntegration");
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);
sheet.getRange("A1:AM1").format = {
  fill: "#1F4D78",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
  verticalAlignment: "center",
};
sheet.getRange(`A2:AM${rows.length + 1}`).format = {
  font: { color: "#1F2937" },
  wrapText: true,
  verticalAlignment: "center",
};
const widths = [
  105, 155, 75, 130, 210, 90, 105, 115,
  170, 190, 220, 135, 105, 70, 120, 95,
  90, 210, 95, 90, 210, 175, 120, 125,
  210, 220, 135, 145, 420, 360, 220,
  120, 125, 175, 235, 250, 250, 300, 110, 130, 310,
];
for (let index = 0; index < widths.length; index += 1) {
  sheet.getRangeByIndexes(0, index, rows.length + 1, 1).format.columnWidthPx = widths[index];
}
sheet.getRange("A1:AM1").format.rowHeightPx = 40;
sheet.getRange(`A2:AM${rows.length + 1}`).format.rowHeightPx = 96;
const summary = await workbook.inspect({
  kind: "workbook,sheet,region",
  sheetId: "AgeIntegration",
  range: `A1:AM${Math.min(rows.length + 1, 12)}`,
  maxChars: 7000,
  tableMaxRows: 12,
  tableMaxCols: 39,
});
console.log(summary.ndjson);

const errorScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final CSV error scan",
});
console.log(errorScan.ndjson);

const previewLeft = await workbook.render({
  sheetName: "AgeIntegration",
  range: `A1:M${Math.min(rows.length + 1, 10)}`,
  scale: 1,
  format: "png",
});
const previewRight = await workbook.render({
  sheetName: "AgeIntegration",
  range: `N1:Z${Math.min(rows.length + 1, 10)}`,
  scale: 1,
  format: "png",
});
const previewGovernance = await workbook.render({
  sheetName: "AgeIntegration",
  range: `AA1:AM${Math.min(rows.length + 1, 10)}`,
  scale: 1,
  format: "png",
});

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.mkdir(path.dirname(args.preview), { recursive: true });
await fs.writeFile(args.output, `\uFEFF${csvText}`, "utf8");
await fs.writeFile(args.preview, new Uint8Array(await previewLeft.arrayBuffer()));
const previewExtension = path.extname(args.preview);
const previewStem = args.preview.slice(0, -previewExtension.length);
await fs.writeFile(`${previewStem}-2${previewExtension}`, new Uint8Array(await previewRight.arrayBuffer()));
await fs.writeFile(`${previewStem}-3${previewExtension}`, new Uint8Array(await previewGovernance.arrayBuffer()));

const required = ["record_id", "source_alias", "source_age_band", "target_age_band", "value_status"];
for (const [index, row] of rows.entries()) {
  for (const key of required) {
    if (row[key] === null || row[key] === undefined || row[key] === "") {
      throw new Error(`row ${index + 2} missing required field ${key}`);
    }
  }
}

const duplicateIds = rows
  .map((row) => row.record_id)
  .filter((id, index, all) => all.indexOf(id) !== index);
if (duplicateIds.length) {
  throw new Error(`duplicate record IDs: ${duplicateIds.join(", ")}`);
}

console.log(JSON.stringify({ output: args.output, rowCount: rows.length, columnCount: headers.length }, null, 2));

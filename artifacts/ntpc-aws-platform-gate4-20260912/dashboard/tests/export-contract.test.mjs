import assert from "node:assert/strict";
import test from "node:test";
import * as contract from "../app/export-contract.ts";

test("export contract keeps three universes separate and preserves wage gaps", () => {
  const rows = contract.buildDashboardExportRows({ year: 114, ageBand: "18-35", sex: "合計", district: "板橋區" });
  assert.equal(rows.registered.length, 11);
  assert.equal(rows.labor.length, 123);
  assert.equal(rows.wage.length, 2);
  assert.ok(rows.registered.every((row) => row.universe_name_zh === "戶籍人口母體"));
  assert.ok(rows.labor.every((row) => row.geography_name_zh === "新北市"));
  assert.equal(rows.labor.filter((row) => row.metric_code === "EMPLOYED_BY_INDUSTRY_SHARE_PCT").length, 57);
  assert.ok(rows.labor.filter((row) => row.metric_code === "EMPLOYED_BY_INDUSTRY_SHARE_PCT").every((row) => row.age_band === "18–35歲"));
  assert.ok(rows.labor.filter((row) => row.metric_code === "EMPLOYED_BY_INDUSTRY_SHARE_PCT").every((row) => row.value_origin_label_zh === "官方調查寬年齡帶與青年就業母數雙重錨定之模型估計值"));
  assert.ok(rows.labor.filter((row) => row.metric_code === "EMPLOYED_BY_INDUSTRY_SHARE_PCT").every((row) => row.uncertainty_low != null && row.uncertainty_high != null));
  assert.ok(rows.wage.every((row) => row.availability_status_zh === "資料缺口／未估計"));
  assert.ok(rows.wage.every((row) => row.value == null));
});

test("available wage export includes both mean and median with distinct evidence identities", () => {
  const rows = contract.buildDashboardExportRows({ year: 113, ageBand: "18-35", sex: "合計", district: "新北市" }).wage;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.metric_name_zh).sort(), ["全年總薪資中位數", "全年總薪資平均數"]);
  assert.deepEqual(rows.map((row) => row.value).sort((a, b) => Number(a) - Number(b)), [51.7, 60.9]);
  assert.ok(rows.every((row) => row.availability_status_zh === "可發布（模型估計，須附方法標籤）"));
  const medianRow = rows.find((row) => row.metric_code === "ANNUAL_TOTAL_SALARY_MEDIAN");
  assert.match(String(medianRow?.formula_zh), /對數常態混合分布之第50百分位/);
  assert.match(String(medianRow?.source_alias), /STAT-WAGE-LOC\+BLI-AGE-REGION-SEX\+BLI-PENSION-AGE-WAGE/);
});

test("wage export follows the selected youth age band", () => {
  const rows = contract.buildDashboardExportRows({ year: 113, ageBand: "25-29", sex: "合計", district: "新北市" }).wage;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.age_band === "25–29歲"));
  assert.equal(rows.find(row => row.metric_code === "ANNUAL_TOTAL_SALARY_MEAN").value, 59.9);
});

test("code book and CSV output enforce traceable required fields", () => {
  assert.equal(contract.exportCodeBook.length, 34);
  assert.equal(contract.exportCodeBookVersion, "1.1.0");
  const required = contract.exportCodeBook.filter((field) => field.required);
  assert.equal(required.length, 13);
  const fields = contract.exportCodeBook.filter((field) => field.defaultIncluded || field.required).map((field) => field.fieldCode);
  const rows = contract.buildDashboardExportRows({ year: 114, ageBand: "18-35", sex: "合計", district: "新北市" });
  const csv = contract.rowsToCsv(rows.labor, fields);
  assert.ok(csv.startsWith("\ufeff"));
  assert.match(csv, /母體定義/);
  assert.match(csv, /失業人口÷勞動力人口×100%/);
  assert.match(csv, /AUX:DGBAS-NTPC-H2-T41\+T42\|QA:DGBAS-HR-T28/);
  const codeBookCsv = contract.codeBookToCsv();
  assert.match(codeBookCsv, /Code Book版本/);
  assert.match(codeBookCsv, /"1\.1\.0","2026-09-08"/);
});

test("CSV writer neutralizes spreadsheet formula-like text", () => {
  const csv = contract.rowsToCsv([{ value: "=1+1" }], ["value"]);
  assert.match(csv, /"'=1\+1"/);
});

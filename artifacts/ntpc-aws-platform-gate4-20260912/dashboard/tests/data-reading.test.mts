import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { changeFact, trendFact, categoryFacts, seriesFacts } from "../app/data-reading.ts";
import { getRegistered, getWage, getLabor } from "../app/dashboard-data.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataReadingSummary } from "../app/data-reading-summary.tsx";

test("摘要以清楚條列呈現並保留數值身分；沒有內容不增加空框", () => {
  const html = renderToStaticMarkup(createElement(DataReadingSummary, { facts: ["114年人口較110年減少67,407人。"], identity: "官方行政精確值" }));
  assert.match(html, /aria-label="數據重點"/);
  assert.match(html, /<ul><li>114年人口較110年減少67,407人。<\/li><\/ul>/);
  assert.match(html, /官方行政精確值/);
  assert.equal(renderToStaticMarkup(createElement(DataReadingSummary, { facts: [] })), "");
});

test("敘述依顯示精度比較；比率差用百分點，零不當缺值", () => {
  assert.equal(changeFact(45.644, 40.555, "%", 2), "增加5.08個百分點");
  assert.equal(changeFact(10.001, 10.004, "%", 2), "顯示值持平");
  assert.equal(changeFact(0, 1, "人", 0), "減少1人");
  assert.equal(changeFact(-3, -1, "千人", 2), "減少2.00千人");
});

test("跨年敘述明列真正比較年度，不把不連續年份稱為去年", () => {
  const points = [{ year: 114, value: 8 }, { year: 110, value: 10 }, { year: 113, value: null }];
  const original = JSON.stringify(points);
  assert.equal(trendFact(points, "人口", "人", 0), "114年人口為8人，較110年減少2人。");
  assert.equal(JSON.stringify(points), original, "敘述不得修改圖表序列");
});

test("缺值年份保留，最新薪資不能改標114年；NaN不進入結果", () => {
  assert.equal(trendFact([{ year: 110, value: 50 }, { year: 113, value: 60.9 }, { year: 114, value: null }], "薪資", "萬元／年", 1), "114年尚無資料；最新可用為113年薪資為60.9萬元／年，較110年增加10.9萬元／年。");
  assert.equal(trendFact([{ year: 114, value: Number.NaN }], "薪資", "萬元／年"), "薪資：目前條件尚無資料。");
  assert.match(trendFact([{ year: 114, value: 0 }], "人口", "人", 0), /為0人/);
});

test("同值並列，不把最高值描述為政策風險或統計顯著", () => {
  assert.match(categoryFacts([{ label: "甲", value: 50 }, { label: "乙", value: 50 }, { label: "丙", value: null }], "114年")[0], /均為50.00%/);
  assert.match(categoryFacts([{ label: "甲", value: 50 }, { label: "乙", value: 50.001 }, { label: "丙", value: 30 }], "114年")[0], /甲、乙並列最高/);
  assert.match(categoryFacts([{ label: "甲", value: undefined }], "114年")[0], /尚無資料/);
});

test("分類折線只比較所選系列；沒有共同端點不虛構變化", () => {
  const points = [{ year: 110, values: { 未婚: 40, 有偶: 55, 離婚: null } }, { year: 114, values: { 未婚: 50, 有偶: 45, 離婚: 5 } }];
  const facts = seriesFacts(points, ["未婚", "有偶"]);
  assert.match(facts[0], /未婚.*50.00%/);
  assert.match(facts[1], /未婚增加10.00個百分點；有偶減少10.00個百分點/);
  assert.doesNotMatch(facts.join(""), /離婚|顯著|風險|造成/);
  assert.equal(seriesFacts([{ year: 110, values: { 甲: null } }, { year: 114, values: { 甲: 4 } }], ["甲"]).length, 1);
});

test("實際110–114人口、勞動與薪資摘要保持各自資料和年齡條件", () => {
  const years = [110, 111, 112, 113, 114];
  const population = years.map((year) => ({ year, value: getRegistered(year, "新北市", "18-35", "合計")?.population }));
  assert.match(trendFact(population, "青年戶籍人口", "人", 0), /845,938人.*減少67,407人/);
  const district = years.map((year) => ({ year, value: getRegistered(year, "淡水區", "30-35", "合計")?.population }));
  assert.match(trendFact(district, "戶籍人口", "人", 0), /17,449人/);
  const labor = years.map((year) => ({ year, value: getLabor(year, "25-29")?.metrics["失業率"] }));
  assert.match(trendFact(labor, "失業率", "%"), /百分點/);
  const wage = years.map((year) => ({ year, value: getWage(year, "18-35")?.metrics["全年總薪資平均數"] }));
  assert.match(trendFact(wage, "平均薪資", "萬元／年", 1), /114年尚無資料；最新可用為113年/);
});

test("公開各分析元件接圖中資料；詳細方法收合；權限設定不受影響", () => {
  const source = readFileSync(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
  const functions = ["TrendChart", "DualAxisPopulationChart", "JointEducationMarriageChart", "LaborDualAxisChart", "LaborCompositionChart", "LaborLifeStageChart", "WageDualAxisChart", "WageGapChart", "WageRangeComparisonChart", "YouthIndustryWageMatrix", "AnnualDistrictDashboard", "MonthlyPopulationAnalysis", "IndustryRankingChart", "IndustryCrossMatrix"];
  for (const name of functions) {
    const section = source.split(`function ${name}(`)[1]?.split("\nfunction ")[0] ?? "";
    assert.match(section, /DataReadingSummary/, name);
  }
  assert.match(source, /<details className="industry-method/);
  assert.match(source, /資料來源與計算方式/);
  assert.doesNotMatch(source, /7項查核資訊/);
  assert.match(source, /showPolicy={false}/);
  const custom = readFileSync(new URL("../app/custom-analysis-workbench.tsx", import.meta.url), "utf8");
  assert.match(custom, /categoryFacts\(presentedRows.map/);
  assert.match(custom, /<details className="custom-evidence/);
  const exports = readFileSync(new URL("../app/export-center.tsx", import.meta.url), "utf8");
  assert.match(exports, /含公式、來源及上下限/);
  assert.match(exports, /aria-pressed={preset === "full"}/);
});

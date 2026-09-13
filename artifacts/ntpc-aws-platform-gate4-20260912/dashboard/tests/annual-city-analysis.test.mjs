import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  dashboardData,
  getRegistered,
  getRegisteredTotalPopulation,
} from "../app/dashboard-data.ts";

const dashboardSource = await readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const jointPayload = JSON.parse(await readFile(new URL("../public/data/joint-education-marriage.json", import.meta.url), "utf8"));

test("home shows citywide monthly population before permission-aware analysis and decision entries", () => {
  const home = dashboardSource.indexOf('className="home-monthly"');
  const monthly = dashboardSource.indexOf("<MonthlyPopulationAnalysis", home);
  const annual = dashboardSource.indexOf("<EvidenceEntryHub", home);
  assert.ok(home > 0 && monthly > home && annual > monthly);
  assert.match(dashboardSource, /跨年度月度分析/);
  assert.match(dashboardSource, /110年1月至114年12月/);
  assert.match(dashboardSource, /const visibleEntryViews:[^\n]+\[/);
  assert.match(dashboardSource, /<EvidenceEntryHub views=\{visibleEntryViews\}/);
  assert.match(dashboardSource, /政策研判/);
  assert.match(dashboardSource, /自訂分析/);
  assert.match(dashboardSource, /資料匯出/);
  assert.doesNotMatch(dashboardSource, /五個入口各自保留/);
  assert.doesNotMatch(dashboardSource, /先決定要比較年度，還是逐月追蹤/);
});

test("citywide annual view contains the requested quadrant sequence and per-chart filters", () => {
  const first = dashboardSource.indexOf("quadrant-one");
  const second = dashboardSource.indexOf("quadrant-two");
  const third = dashboardSource.indexOf("quadrant-three");
  const fourth = dashboardSource.indexOf("quadrant-four");
  assert.ok(first > 0 && first < second && second < third && third < fourth);
  assert.match(dashboardSource, /人口占戶籍總人口比率/);
  assert.match(dashboardSource, /人口與密度變化/);
  assert.match(dashboardSource, /婚姻狀態占比變化/);
  assert.match(dashboardSource, /教育程度占比變化/);
  assert.match(dashboardSource, /idPrefix="share"/);
  assert.match(dashboardSource, /idPrefix="population"/);
  assert.match(dashboardSource, /idPrefix="marriage"/);
  assert.match(dashboardSource, /idPrefix="education"/);
  assert.match(styles, /annual-quadrant-grid/);
});

test("joint education-marriage payload has complete governed dimensions", () => {
  assert.equal(jointPayload.records.length, 1200);
  assert.deepEqual(jointPayload.meta.years, [110, 111, 112, 113, 114]);
  assert.deepEqual(jointPayload.meta.ageBands, ["18-24", "25-29", "30-35", "18-35"]);
  assert.deepEqual(jointPayload.meta.sexes, ["合計", "男", "女"]);
  assert.deepEqual(jointPayload.meta.educationCategories, ["國中及以下", "高中職", "專科", "大學", "研究所"]);
  assert.deepEqual(jointPayload.meta.marriageCategories, ["未婚", "有偶", "離婚或終止結婚", "喪偶"]);
  assert.ok(jointPayload.records.every((row) => row.population >= 0));
  assert.ok(jointPayload.records.every((row) => row.populationLow <= row.population + 1e-6));
  assert.ok(jointPayload.records.every((row) => row.population <= row.populationHigh + 1e-6));
});

test("joint shares close to 100 percent within each education denominator", () => {
  const groups = new Map();
  for (const row of jointPayload.records) {
    const key = [row.year, row.ageBand, row.sex, row.education].join("|");
    groups.set(key, (groups.get(key) ?? 0) + row.marriageSharePct);
  }
  assert.equal(groups.size, 300);
  for (const value of groups.values()) assert.ok(Math.abs(value - 100) <= 0.00001);
});

test("native and converted age bands keep distinct evidence identities", () => {
  assert.ok(jointPayload.records.filter((row) => row.ageBand === "25-29").every((row) => row.origin === "官方行政精確值"));
  assert.ok(jointPayload.records.filter((row) => row.ageBand !== "25-29").every((row) => row.origin === "模型估計值"));
  assert.match(jointPayload.meta.method, /PCLM/);
  assert.match(jointPayload.meta.method, /IPF/);
  assert.match(jointPayload.meta.sensitivity, /不是信賴區間/);
  assert.ok(jointPayload.meta.yearDiagnostics.every((row) => row.scaledMarginFits === 0));
  assert.ok(jointPayload.meta.yearDiagnostics.every((row) => row.exact2529MaxDifference < 1e-6));
  assert.ok(jointPayload.meta.yearDiagnostics.every((row) => row.targetPopulationMaxDifference < 1e-4));
});

test("dual-axis charts preserve exact values, axes, accessible hover and evidence details", () => {
  assert.match(dashboardSource, /長條使用左軸人數，折線使用右軸/);
  assert.match(dashboardSource, /tabIndex=\{0\}/);
  assert.match(dashboardSource, /與前一年度相比（人）/);
  assert.match(dashboardSource, /與前一年度相比：無前期資料/);
  assert.doesNotMatch(dashboardSource, /比較基期/);
  assert.match(dashboardSource, /change-up/);
  assert.match(dashboardSource, /change-down/);
  assert.match(dashboardSource, /查看圖表資料表/);
  assert.match(dashboardSource, /資料來源與計算方式/);
});

test("population-share chart uses the official all-age denominator on its left axis", () => {
  assert.match(dashboardSource, /barValue: getRegisteredTotalPopulation\(row\)/);
  assert.match(dashboardSource, /戶籍總人口/);
  assert.match(dashboardSource, /折線＝選定年齡戶籍人口÷同年度同地區同一性別全年齡戶籍人口×100/);

  assert.equal(getRegisteredTotalPopulation(getRegistered(110, "新北市", "18-35", "合計")), 4_008_113);
  assert.equal(getRegisteredTotalPopulation(getRegistered(114, "新北市", "18-35", "合計")), 4_044_831);
  assert.equal(getRegisteredTotalPopulation(getRegistered(114, "板橋區", "18-35", "合計")), 549_762);

  const denominators = new Map();
  for (const row of dashboardData.registered) {
    const key = `${row.year}|${row.geography}|${row.sex}`;
    const denominator = getRegisteredTotalPopulation(row);
    if (!denominators.has(key)) denominators.set(key, new Set());
    denominators.get(key).add(denominator);
  }
  assert.ok([...denominators.values()].every((values) => values.size === 1));
});

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildDistrictRankings,
  competitionRank,
  getPopulation,
} from "../app/district-annual-rankings.ts";

const dashboardSource = await readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const baseline = JSON.parse(await readFile(new URL("../app/data/district-population-baseline-109.json", import.meta.url), "utf8"));
const districtDirectory = new URL("../public/data/joint-education-marriage-districts/", import.meta.url);
const districtIndex = JSON.parse(await readFile(new URL("index.json", districtDirectory), "utf8"));
const dashboardPayload = JSON.parse(await readFile(new URL("../app/data/g5-dashboard-data.json", import.meta.url), "utf8"));

test("annual district map uses explicit apply filters and a continuous transition", () => {
  assert.match(dashboardSource, /function AnnualDistrictDashboard/);
  assert.match(dashboardSource, /套用並重新著色/);
  assert.match(dashboardSource, /draftYear/);
  assert.match(dashboardSource, /draftAgeBand/);
  assert.match(dashboardSource, /draftSex/);
  assert.match(dashboardSource, /同條件110–114年共同最小值與最大值固定換算/);
  assert.match(styles, /annual-map-district[^}]+transition: fill 2000ms/s);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("annual district hover summary reserves its layout slot to prevent map jumping", () => {
  assert.doesNotMatch(dashboardSource, /\{hovered && <div className="annual-map-hover-summary"/);
  assert.match(dashboardSource, /annual-map-hover-summary\$\{hovered \? " is-visible" : ""\}/);
  assert.match(styles, /\.annual-map-hover-summary \{[^}]*visibility: hidden;[^}]*opacity: 0;/s);
  assert.match(styles, /\.annual-map-hover-summary\.is-visible \{[^}]*visibility: visible;[^}]*opacity: 1;/s);
});

test("109 baseline contains the governed 29 by 4 by 3 population cells", () => {
  assert.equal(baseline.records.length, 29 * 4 * 3);
  assert.equal(new Set(baseline.records.map((row) => row.geography)).size, 29);
  assert.equal(baseline.meta.period, "10912");
  assert.equal(baseline.meta.identity, "官方行政精確值");
  assert.equal(baseline.meta.qa.ageBandReconciliation, "PASS");
  assert.ok(getPopulation(109, "板橋區", "18-35", "合計") > 0);
});

test("competition ranking retains ties instead of arbitrary district ordering", () => {
  const rows = [
    { geography: "甲區", value: 30 },
    { geography: "乙區", value: 20 },
    { geography: "丙區", value: 20 },
    { geography: "丁區", value: 10 },
  ];
  assert.equal(competitionRank(rows, "甲區"), 1);
  assert.equal(competitionRank(rows, "乙區"), 2);
  assert.equal(competitionRank(rows, "丙區"), 2);
  assert.equal(competitionRank(rows, "丁區"), 4);
});

test("ranking board contains seven metrics and preserves unavailable comparisons", () => {
  const metrics110 = buildDistrictRankings(110, "18-35", "合計", "板橋區");
  assert.equal(metrics110.length, 7);
  assert.ok(metrics110.every((metric) => metric.total === 29));
  assert.notEqual(metrics110.find((metric) => metric.key === "change")?.value, null);
  assert.equal(metrics110.find((metric) => metric.key === "change")?.movement.direction, "unavailable");
  assert.match(metrics110.find((metric) => metric.key === "change")?.movement.reason ?? "", /108年/);
  assert.equal(metrics110.find((metric) => metric.key === "married")?.movement.direction, "unavailable");
  assert.equal(metrics110.find((metric) => metric.key === "facilities")?.movement.direction, "unavailable");

  const metrics114 = buildDistrictRankings(114, "18-35", "合計", "淡水區");
  assert.notEqual(metrics114.find((metric) => metric.key === "change")?.movement.direction, "unavailable");
  assert.match(metrics114.find((metric) => metric.key === "facilities")?.periodNote ?? "", /115年快照/);
});

test("all 29 district joint payloads are complete and close by education denominator", async () => {
  assert.equal(districtIndex.districts.length, 29);
  const files = (await readdir(districtDirectory)).filter((name) => /^65\d{6}\.json$/.test(name));
  assert.equal(files.length, 29);
  for (const file of files) {
    const payload = JSON.parse(await readFile(new URL(file, districtDirectory), "utf8"));
    assert.equal(payload.records.length, 1200, file);
    assert.equal(payload.meta.universe, "戶籍登記現住人口", file);
    assert.ok(payload.records.filter((row) => row.ageBand === "25-29").every((row) => row.origin === "官方行政精確值"), file);
    const groups = new Map();
    const populations = new Map();
    for (const row of payload.records) {
      if (row.educationPopulation <= 0) continue;
      const key = [row.year, row.ageBand, row.sex, row.education].join("|");
      groups.set(key, (groups.get(key) ?? 0) + row.marriageSharePct);
      const populationKey = [row.year, row.ageBand, row.sex].join("|");
      populations.set(populationKey, (populations.get(populationKey) ?? 0) + row.population);
    }
    for (const value of groups.values()) assert.ok(Math.abs(value - 100) <= 0.00001, `${file}: ${value}`);
    const geography = payload.meta.geography;
    for (const [key, value] of populations) {
      const [year, ageBand, sex] = key.split("|");
      const target = dashboardPayload.registered.find((row) => row.year === Number(year) && row.geography === geography && row.ageBand === ageBand && row.sex === sex)?.population;
      assert.notEqual(target, undefined, `${file}: missing ${key} population target`);
      assert.ok(Math.abs(value - target) <= 0.0001, `${file}: ${key} ${value} != ${target}`);
    }
  }
});

test("district trend branch reuses the citywide four quadrants and district joint chart", () => {
  assert.match(dashboardSource, /activeView === "district" && analysisMode === "trend"/);
  assert.match(dashboardSource, /AllYearRegisteredDashboard[^>]+geography=\{selected\}/);
  assert.match(dashboardSource, /JointEducationMarriageChart geography=\{geography\}/);
  const labels = buildDistrictRankings(114, "18-35", "合計", "板橋區").map((metric) => metric.label);
  assert.deepEqual(labels, [
    "戶籍人口數排名",
    "戶籍人口密度排名",
    "戶籍人口年度變化率排名",
    "有偶（已婚）比率排名",
    "未婚比率排名",
    "離婚或終止結婚比率排名",
    "青年據點數排名",
  ]);
});

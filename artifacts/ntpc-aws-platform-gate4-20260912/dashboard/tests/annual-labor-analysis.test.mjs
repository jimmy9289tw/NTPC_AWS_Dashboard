import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardSource = await readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const payload = JSON.parse(await readFile(new URL("../app/data/g5-dashboard-data.json", import.meta.url), "utf8"));

test("annual labor view has four quadrants, independent age filters, and life-stage comparison", () => {
  assert.match(dashboardSource, /function AllYearLaborDashboard/);
  assert.match(dashboardSource, /activeView === "labor" && analysisMode === "trend"/);
  assert.match(dashboardSource, /就業規模與就業人口比率/);
  assert.match(dashboardSource, /勞動力規模與勞動力參與率/);
  assert.match(dashboardSource, /勞動力中的就業與失業/);
  assert.match(dashboardSource, /非勞動力人口與非勞動力率/);
  assert.match(dashboardSource, /三個青年年齡層放在同一尺度上/);
  assert.match(dashboardSource, /idPrefix="annual-employment"/);
  assert.match(dashboardSource, /idPrefix="annual-participation"/);
  assert.match(dashboardSource, /idPrefix="labor-composition"/);
  assert.match(dashboardSource, /idPrefix="annual-non-labor"/);
  assert.match(styles, /annual-labor-grid/);
  assert.match(styles, /labor-benchmark-line/);
});

test("labor payload has complete 110-114 by four youth age bands", () => {
  assert.equal(payload.labor.length, 20);
  assert.deepEqual([...new Set(payload.labor.map((row) => row.year))].sort(), [110, 111, 112, 113, 114]);
  assert.deepEqual([...new Set(payload.labor.map((row) => row.ageBand))].sort(), ["18-24", "18-35", "25-29", "30-35"]);
});

test("labor stock identities and rate denominators reconcile", () => {
  for (const row of payload.labor) {
    const metric = row.metrics;
    assert.ok(Math.abs(metric["民間人口"] - metric["勞動力人口"] - metric["非勞動力人口"]) < 0.00001, `${row.year}/${row.ageBand}: P=LF+NLF`);
    assert.ok(Math.abs(metric["勞動力人口"] - metric["就業人口"] - metric["失業人口"]) < 0.00001, `${row.year}/${row.ageBand}: LF=E+U`);
    assert.ok(Math.abs(metric["失業率"] - metric["失業人口"] / metric["勞動力人口"] * 100) < 0.00001, `${row.year}/${row.ageBand}: UR=U/LF`);
    assert.ok(Math.abs(metric["勞動力參與率"] - metric["勞動力人口"] / metric["民間人口"] * 100) < 0.00001, `${row.year}/${row.ageBand}: LFPR=LF/P`);
    assert.ok(Math.abs(metric["就業人口比率"] - metric["就業人口"] / metric["民間人口"] * 100) < 0.00001, `${row.year}/${row.ageBand}: EPR=E/P`);
    assert.ok(Math.abs(metric["勞動力中就業占比"] + metric["失業率"] - 100) < 0.00001, `${row.year}/${row.ageBand}: ESLF+UR=100`);
  }
});

test("annual labor view labels survey identity, annual average, and sex limitation", () => {
  assert.match(dashboardSource, /110–114年全年平均/);
  assert.match(dashboardSource, /民間人口與勞動力母體/);
  assert.match(dashboardSource, /性別固定為男女合計/);
  assert.match(dashboardSource, /PCLM主模型、Sprague敏感度/);
  assert.match(dashboardSource, /失業人口÷勞動力/);
  assert.match(dashboardSource, /就業人口÷民間人口/);
});

test("annual labor charts expose exact values, keyboard focus, evidence, and table alternatives", () => {
  assert.match(dashboardSource, /5個全年平均值/);
  assert.match(dashboardSource, /tabIndex=\{0\}/);
  assert.match(dashboardSource, /人數與前一年度相比/);
  assert.match(dashboardSource, /比率與前一年度相比/);
  assert.doesNotMatch(dashboardSource, /比率比較基期/);
  assert.match(dashboardSource, /rateLabel\}的年度差異保留於下方可展開資料表/);
  assert.match(dashboardSource, /查看各年齡層完整數值/);
  assert.match(dashboardSource, /資料來源與計算方式/);
});

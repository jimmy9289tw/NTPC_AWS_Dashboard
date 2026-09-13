import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const dataUrl = new URL("../app/data/g5-dashboard-data.json", import.meta.url);

test("wage model retains age-band validation inputs while publication is governed separately", async () => {
  const payload = JSON.parse(await readFile(dataUrl, "utf8"));
  const ageBands = ["18-24", "25-29", "30-35", "18-35"];
  for (const year of [110, 111, 112, 113]) {
    for (const ageBand of ageBands) {
      const row = payload.wage.find((item) => item.year === year && item.ageBand === ageBand);
      assert.ok(row, `missing wage row ${year}/${ageBand}`);
      assert.equal(typeof row.metrics["全年總薪資平均數"], "number");
      assert.equal(typeof row.metrics["全年總薪資中位數"], "number");
      assert.ok(row.metrics["全年總薪資中位數"] <= row.metrics["全年總薪資平均數"]);
    }
  }
  assert.equal(payload.wage.some((item) => item.year === 114), false);
});

test("native 25-29 medians remain official and modeled medians retain method ranges", async () => {
  const payload = JSON.parse(await readFile(dataUrl, "utf8"));
  const expected = new Map([
    [110, { "18-24": 40.8, "25-29": 47.3, "30-35": 50.9, "18-35": 46.5 }],
    [111, { "18-24": 42.0, "25-29": 48.7, "30-35": 51.7, "18-35": 47.7 }],
    [112, { "18-24": 44.1, "25-29": 50.4, "30-35": 53.2, "18-35": 49.4 }],
    [113, { "18-24": 46.1, "25-29": 52.4, "30-35": 55.6, "18-35": 51.7 }],
  ]);
  for (const [year, bands] of expected) {
    for (const [ageBand, value] of Object.entries(bands)) {
      const row = payload.wage.find((item) => item.year === year && item.ageBand === ageBand);
      const meta = row.meta["全年總薪資中位數"];
      assert.equal(row.metrics["全年總薪資中位數"], value);
      if (ageBand === "25-29") {
        assert.match(meta.origin, /官方調查統計值/);
        assert.equal(meta.low, null);
        assert.equal(meta.high, null);
      } else {
        assert.match(meta.origin, /模型估計值/);
        assert.match(meta.method, /對數常態形狀轉移/);
        assert.equal(typeof meta.low, "number");
        assert.equal(typeof meta.high, "number");
        assert.ok(meta.low <= value && value <= meta.high);
      }
    }
  }
});

test("annual wage view uses two salary bar-and-growth charts, a gap chart and sensitivity bands", async () => {
  const source = await readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
  assert.match(source, /AllYearWageDashboard/);
  assert.match(source, /從薪資水準，讀到分布與成長速度/);
  assert.match(source, /平均—中位數差額/);
  assert.match(source, /薪資分布偏斜代理值/);
  assert.match(source, /平均薪資與年增率/);
  assert.match(source, /中位薪資與年增率/);
  assert.match(source, /WageDualAxisChart/);
  assert.match(source, /WageGapChart/);
  assert.match(source, /WageRangeComparisonChart/);
  assert.match(source, /平均數年增率/);
  assert.match(source, /中位數年增率/);
  assert.match(source, /成長速度差/);
  assert.match(source, /灰色寬帶/);
  assert.match(source, /wage-gap-annotation/);
  assert.doesNotMatch(source, /wage-bar-label/);
  assert.match(source, /方法敏感度帶/);
  assert.match(source, /點估計沿用各指標既定換算/);
  assert.match(source, /114年同口徑青年薪資尚未發布/);
  assert.match(source, /青年各行業全年總薪資平均數/);
  const wagePage = source.slice(source.indexOf("function AllYearWageDashboard"), source.indexOf("function allCoordinates"));
  assert.match(wagePage, /id="wage-page-age"/);
  assert.match(wagePage, /ageOrder\.map/);
  assert.match(wagePage, /下方摘要、四象限與行業矩陣會同步更新/);
  assert.match(wagePage, /新北市工作場所・\{ageBandLabel\(youthAge\)\}・男女合計/);
  assert.match(wagePage, /110–113年全年總薪資/);
  assert.match(wagePage, /最新可用：113年；114年尚未發布/);
  assert.match(wagePage, /<YouthIndustryWageMatrix ageBand=\{youthAge\}/);
  assert.match(wagePage, /<WageRangeComparisonChart ageBand=\{youthAge\}/);
  assert.doesNotMatch(wagePage, /<LaborAgeFilter/);
  assert.doesNotMatch(wagePage, /<MolSalaryContextPanel/);
  assert.doesNotMatch(wagePage, /114年背景已納入/);
});

test("youth industry wage model publishes four age bands and keeps unsupported industries missing", async () => {
  const payload = JSON.parse(await readFile(new URL("../app/data/youth-industry-wage.json", import.meta.url), "utf8"));
  assert.equal(payload.meta.rocYear, 113);
  assert.deepEqual(payload.meta.ageBands, ["18-35", "18-24", "25-29", "30-35"]);
  assert.equal(payload.meta.statistic, "全年總薪資平均數");
  assert.match(payload.meta.identity, /模型估計/);
  assert.match(payload.meta.formula, /新北市目標年齡全年總薪資平均數錨點/);
  assert.match(payload.meta.uncertainty, /不是信賴區間/);
  assert.ok(payload.meta.limitations.some((item) => /勞退公開端點僅提供114年/.test(item)));
  assert.equal(payload.rows.length, 19);
  assert.equal(payload.validation.availableIndustryCount, 17);
  assert.equal(payload.validation.unavailableIndustryCount, 2);
  assert.equal(payload.validation.native2529AnchorMatchesTable6, true);
  assert.equal(payload.validation.methodEnvelopeIsConfidenceInterval, false);
  for (const item of Object.values(payload.validation.reaggregation)) {
    assert.ok(item.absoluteError <= 0.05, `reaggregation error ${item.absoluteError}`);
  }
  for (const row of payload.rows) {
    for (const band of payload.meta.ageBands) {
      const estimate = row.estimates[band];
      if (row.availability === "MODEL_ESTIMATE_AVAILABLE") {
        assert.equal(typeof estimate.value, "number");
        assert.ok(estimate.low <= estimate.value && estimate.value <= estimate.high);
        assert.equal(estimate.status, "MODEL_ESTIMATE");
      } else {
        assert.equal(estimate.value, null);
        assert.equal(estimate.status, "SOURCE_UNIVERSE_EXCLUDED");
      }
    }
  }
  const unavailable = payload.rows.filter((row) => row.availability !== "MODEL_ESTIMATE_AVAILABLE").map((row) => row.industry).sort();
  assert.deepEqual(unavailable, ["公共行政及國防；強制性社會安全", "農、林、漁、牧業"].sort());
});

test("MOL context remains an all-age supplemental layer with a traceable industry-size matrix", async () => {
  const payload = JSON.parse(await readFile(new URL("../app/data/mol-salary-context.json", import.meta.url), "utf8"));
  const matrix = JSON.parse(await readFile(new URL("../app/data/mol-salary-matrix.json", import.meta.url), "utf8"));
  assert.equal(payload.meta.rocYear, 114);
  assert.equal(payload.meta.month, 12);
  assert.match(payload.meta.geographyBasis, /提繳單位登記地址/);
  assert.match(payload.meta.population, /全年齡/);
  assert.match(payload.meta.metricDefinition, /不是由提繳金額回推/);
  assert.match(payload.meta.aggregationMethod, /12月底人數加權/);
  assert.match(payload.meta.aggregationMethod, /分組重算值/);
  assert.equal(payload.newTaipei.averageContributionWage, 44604);
  assert.equal(payload.newTaipei.countyRank, 5);
  assert.equal(payload.newTaipei.countyCount, 22);
  assert.equal(payload.industries.length, 19);
  assert.equal(payload.organizationSizes.length, 19);
  assert.deepEqual(matrix.sizeGroups.map((item) => item.name), ["1–9人", "10–49人", "50–199人", "200–999人", "1,000人以上", "其他"]);
  assert.equal(matrix.rows.length, 19);
  for (const row of matrix.rows) {
    assert.equal(row.cells.length, 6);
    assert.equal(row.cells.reduce((sum, cell) => sum + cell.headcount, 0), row.total.headcount);
    for (const cell of row.cells) {
      if (cell.headcount === 0) assert.equal(cell.averageContributionWage, null);
      else assert.equal(typeof cell.averageContributionWage, "number");
    }
  }
});

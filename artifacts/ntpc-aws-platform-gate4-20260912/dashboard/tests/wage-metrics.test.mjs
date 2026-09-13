import assert from "node:assert/strict";
import test from "node:test";
import {
  compoundAnnualGrowthRatePct,
  estimateRangesOverlap,
  growthRatePct,
  meanMedianGap,
  meanMedianGapSharePct,
} from "../app/wage-metrics.ts";

test("平均數與中位數差距及偏斜代理值依公式計算", () => {
  assert.ok(Math.abs(meanMedianGap({ mean: 60.9, median: 51.7 }) - 9.2) < 1e-10);
  assert.ok(Math.abs(meanMedianGapSharePct({ mean: 60.9, median: 51.7 }) - 15.10673235) < 1e-8);
});

test("年增率與複合年成長率依實際經過年數計算", () => {
  assert.equal(growthRatePct(110, 100), 10);
  assert.ok(Math.abs(compoundAnnualGrowthRatePct(133.1, 100, 3) - 10) < 1e-10);
});

test("估計範圍重疊時應標示尚無法判定有明顯差異", () => {
  assert.equal(estimateRangesOverlap(55, 60, 58, 63), true);
  assert.equal(estimateRangesOverlap(55, 57, 58, 63), false);
  assert.equal(estimateRangesOverlap(null, 57, 58, 63), null);
});

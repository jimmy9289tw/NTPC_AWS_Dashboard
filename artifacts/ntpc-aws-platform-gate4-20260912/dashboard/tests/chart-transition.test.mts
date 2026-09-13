import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { chartMotionKey, chartTransitionDuration, startChartTransition, interpolateGeometry } from "../app/chart-transition.ts";

function fakePlot(initial: Record<string,string>) {
  const attributes = {...initial};
  const mark = { tagName: "rect", dataset: {}, hasAttribute: (name: string) => name in attributes, getAttribute: (name: string) => attributes[name], setAttribute: (name: string, value: string) => { attributes[name] = value; } };
  return { element: { querySelectorAll: () => [mark] } as unknown as Element, attributes };
}
test("長條從60到80以2000毫秒移動，中途不是直接跳到終值", () => {
  const oldRaf = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  let next: FrameRequestCallback | null = null;
  globalThis.requestAnimationFrame = callback => { next = callback; return 1; };
  globalThis.cancelAnimationFrame = () => { next = null; };
  try {
    const plot = fakePlot({y:"20",height:"80"});
    const motion = startChartTransition(plot.element, new Map([["rect:0",{y:"40",height:"60"}]]), false);
    assert.equal(chartTransitionDuration, 2000);
    assert.equal(plot.attributes.height, "60");
    (next as unknown as FrameRequestCallback)(0);
    (next as unknown as FrameRequestCallback)(1000);
    assert.equal(plot.attributes.height, "70"); assert.equal(plot.attributes.y, "30");
    (next as unknown as FrameRequestCallback)(2000);
    assert.equal(plot.attributes.height, "80"); assert.equal(plot.attributes.y, "20");
    motion.cancel();
  } finally { globalThis.requestAnimationFrame = oldRaf; globalThis.cancelAnimationFrame = oldCancel; }
});
test("快速重選從當下高度接續，減少動態立即到終值", () => {
  const oldRaf=globalThis.requestAnimationFrame, oldCancel=globalThis.cancelAnimationFrame;
  let next: FrameRequestCallback | null = null;
  globalThis.requestAnimationFrame = callback => { next=callback; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const plot=fakePlot({height:"80"});
    const first=startChartTransition(plot.element,new Map([["rect:0",{height:"60"}]]),false);
    (next as unknown as FrameRequestCallback)(0); (next as unknown as FrameRequestCallback)(1000);
    first.cancel(); plot.attributes.height="50";
    const second=startChartTransition(plot.element,first.snapshot,false);
    assert.equal(plot.attributes.height,"70");
    second.cancel(true); assert.equal(plot.attributes.height,"50");
    plot.attributes.height="90"; startChartTransition(plot.element,second.snapshot,true);
    assert.equal(plot.attributes.height,"90");
  } finally { globalThis.requestAnimationFrame=oldRaf; globalThis.cancelAnimationFrame=oldCancel; }
});
test("路徑同拓樸才插值，缺值段落不同不跨越缺值連線",()=>{
  assert.equal(interpolateGeometry("M 0 60 L 1 40","M 0 80 L 1 20",.5),"M 0 70 L 1 30");
  assert.equal(interpolateGeometry("M 0 60 L 1 40","M 0 80 M 1 20",.5),"M 0 80 M 1 20");
  assert.equal(interpolateGeometry("60","80",1),"80");
  const plot=fakePlot({height:"80"});
  startChartTransition(plot.element,new Map(),false).cancel();
  assert.equal(plot.attributes.height,"80");
});
test("相同資料重繪不換key，條件與缺值變更才換key", () => {
  const points = [{ year: 114, value: 0 }];
  const before = JSON.stringify(points);
  assert.equal(chartMotionKey("18-35", points), chartMotionKey("18-35", [{ year: 114, value: 0 }]));
  assert.notEqual(chartMotionKey("18-35", points), chartMotionKey("25-29", points));
  assert.notEqual(chartMotionKey(points), chartMotionKey([{ year: 114, value: null }]));
  assert.equal(JSON.stringify(points), before);
});

test("15種圖表共用動態更新，hover與焦點不觸發重播", () => {
  const client = readFileSync(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
  for (const name of ["TrendChart", "DualAxisPopulationChart", "JointEducationMarriageChart", "LaborDualAxisChart", "LaborCompositionChart", "LaborLifeStageChart", "WageDualAxisChart", "WageGapChart", "WageRangeComparisonChart", "YouthIndustryWageMatrix", "MonthlyPopulationAnalysis", "IndustryRankingChart", "IndustryCrossMatrix"]) {
    const section = client.split(`function ${name}(`)[1].split("\nfunction ")[0];
    assert.match(section, /ref={chartTransition}/, name);
    const keyLine = section.split("\n").find(line => line.includes("useChartTransition"))!;
    assert.doesNotMatch(keyLine, /activePoint|activeMonth|hover|active,|selectedX/);
  }
  for (const filename of ["custom-analysis-chart.tsx", "policy-evidence-chart.tsx"]) {
    const source = readFileSync(new URL(`../app/${filename}`, import.meta.url), "utf8");
    assert.match(source, /useChartTransition\(chartMotionKey/);
    assert.match(source, /ref={chartTransition}/);
  }
});

test("非同步讀取、動畫清理、地圖色階及減少動態模式保留", () => {
  const hook = readFileSync(new URL("../app/chart-transition.ts", import.meta.url), "utf8");
  assert.match(hook, /prefers-reduced-motion: reduce/);
  assert.match(hook, /removeEventListener/);
  assert.match(hook, /\[signature, animateOnMount\]/);
  assert.doesNotMatch(hook, /cloneNode|setState/);
  assert.match(hook, /clearTimeout\(timer\)/);
  const client = readFileSync(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
  const joint = client.split("function JointEducationMarriageChart(")[1].split("\nfunction ")[0];
  assert.ok(joint.indexOf("useChartTransition") < joint.indexOf("if (!payload) return"), "hooks不能跨越條件式return");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /transition: fill 2000ms/);
  assert.match(css, /\.annual-map-district { transition: none; }/);
});

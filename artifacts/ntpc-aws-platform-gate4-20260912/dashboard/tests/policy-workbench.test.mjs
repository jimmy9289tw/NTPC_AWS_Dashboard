import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("G6-POL V3 connects district/city evidence, objectives and options without claiming causality", async () => {
  const source = (await Promise.all(["policy-workflow.tsx", "policy-narrative-workbench.tsx", "policy-narrative.ts", "policy-action-flow.ts"].map((name) => readFile(new URL("../app/" + name, import.meta.url), "utf8")))).join("\n");
  const status = await readFile(new URL("../app/policy-source-status.ts", import.meta.url), "utf8");
  assert.match(source, /行政區建議/);
  assert.match(source, /新北市建議/);
  assert.match(source, /先選要研判的行政區/);
  assert.match(source, /不分攤成行政區數值/);
  assert.match(source, /ROAMEF政策研判流程/);
  assert.match(source, /<details/);
  assert.match(source, /問題依據/);
  assert.match(source, /政策目標/);
  assert.match(source, /方案比較/);
  assert.match(source, /執行與追蹤/);
  assert.match(source, /成效評估/);
  assert.match(source, /後續決定/);
  assert.match(source, /<NarrativeChart/);
  assert.match(source, /政策目標草案/);
  assert.match(source, /維持現況/);
  assert.match(source, /最低調整/);
  assert.match(source, /小規模試辦/);
  assert.match(source, /programKpis\(program\)/);
  assert.match(source, /不分攤成行政區數值/);
  assert.match(source, /scope === "district" \? \(selectedDistrictSignal \? \[selectedDistrictSignal\] : \[\]\) : citySignals/);
  assert.match(source, /AI問政策證據/);
  assert.match(status, /The Green Book 2026/);
  assert.match(status, /The Magenta Book 2026/);
  assert.match(status, /Test and Learn/);
});

test("latest-source register keeps 18-35 youth wage at 113 and excludes all-age salary context", async () => {
  const status = await readFile(new URL("../app/policy-source-status.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
  assert.match(status, /新北市青年全年總薪資[\s\S]*latestOfficialPeriod: "113年"/);
  assert.match(status, /114年全國平均或其他調查不能代填新北市青年值/);
  assert.doesNotMatch(status, /114年工作場域薪資背景/);
  const wagePage = client.slice(client.indexOf("function AllYearWageDashboard"), client.indexOf("function allCoordinates"));
  assert.match(wagePage, /新北市工作場所・\{ageBandLabel\(youthAge\)\}・男女合計/);
  assert.match(wagePage, /110–113年全年總薪資/);
  assert.match(wagePage, /最新可用：113年；114年尚未發布/);
  assert.doesNotMatch(wagePage, /<MolSalaryContextPanel/);
  assert.doesNotMatch(wagePage, /可並列、不可接續/);
});

test("custom analysis exposes drag and keyboard alternatives and locks one universe", async () => {
  const source = await readFile(new URL("../app/custom-analysis-workbench.tsx", import.meta.url), "utf8");
  assert.match(source, /const rows = rowsByDomain\[domain\]/);
  assert.match(source, /draggable/);
  assert.match(source, /X軸（比較順序）<select/);
  assert.match(source, /Y軸（數值）<select/);
  assert.match(source, /圖例（分組）<select/);
  assert.match(source, /X軸與Y軸是圖表角色，不代表因果關係/);
  assert.match(source, /<details className="custom-evidence/);
  assert.match(source, /chartKind === "table"/);
  const chart = await readFile(new URL("../app/custom-analysis-chart.tsx", import.meta.url), "utf8");
  assert.match(chart, /tabIndex={0}/);
  assert.match(chart, /role: "button", tabIndex: 0/);
  assert.match(source, /filter\(\(row\) => row\.ageBand === "18-35"\)/);
  assert.doesNotMatch(source, /molSalaryContext/);
});

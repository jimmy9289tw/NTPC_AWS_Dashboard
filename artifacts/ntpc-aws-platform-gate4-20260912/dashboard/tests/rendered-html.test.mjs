import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { createSignedToken } from "../worker/auth.ts";
import { siteRelease } from "../app/release.ts";

async function getWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

const sessionSecret = "test-session-secret-that-is-longer-than-thirty-two-bytes";
const sessionToken = await createSignedToken({ subject: "1", email: "decision-reviewer@example.invalid", name: "Demo Reviewer", exp: 1_900_000_000 }, sessionSecret);
const viewerSessionToken = await createSignedToken({ subject: "2", email: "public-viewer@example.invalid", name: "Demo Viewer", exp: 1_900_000_000 }, sessionSecret);
const env = {
  ASSETS: { fetch: async (request) => new Response(`asset:${new URL(request.url).pathname}`, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  }) },
  APP_ORIGIN: "https://ntpc-youth.the-weekly-blend.com",
  GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
  SESSION_COOKIE_NAME: "__Host-ntpc_youth_session",
  SESSION_TTL_SECONDS: "28800",
  SESSION_SECRET: sessionSecret,
  ALLOWED_EMAILS: "decision-reviewer@example.invalid,public-viewer@example.invalid",
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
function authenticatedRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", `__Host-ntpc_youth_session=${sessionToken}`);
  return new Request(`https://ntpc-youth.the-weekly-blend.com${path}`, { ...init, headers });
}

function viewerRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", `__Host-ntpc_youth_session=${viewerSessionToken}`);
  return new Request(`https://ntpc-youth.the-weekly-blend.com${path}`, { ...init, headers });
}

test("decision and viewer roles are enforced by the worker and APIs", async () => {
  const worker = await getWorker();
  const roleEnv = { ...env, DECISION_EMAILS: "decision-reviewer@example.invalid" };
  const decisionStatus = await worker.fetch(authenticatedRequest("/auth/status"), roleEnv, ctx);
  const viewerStatus = await worker.fetch(viewerRequest("/auth/status"), roleEnv, ctx);
  assert.deepEqual((await decisionStatus.json()).permissions, { viewPolicy: true, exportData: true });
  assert.deepEqual((await viewerStatus.json()).permissions, { viewPolicy: false, exportData: false });

  const viewerExport = await worker.fetch(viewerRequest("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "codebook" }),
  }), roleEnv, ctx);
  assert.equal(viewerExport.status, 403);

  const viewerPolicy = await worker.fetch(viewerRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "淡水區有哪些政策建議？", context: { year: 114, ageBand: "18-35", district: "淡水區" } }),
  }), roleEnv, ctx);
  assert.equal(viewerPolicy.status, 403);

  const decisionExport = await worker.fetch(authenticatedRequest("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "data", universe: "wage", year: 113, ageBand: "25-29", sex: "合計", district: "新北市", fields: ["age_band", "metric_name_zh", "value"] }),
  }), roleEnv, ctx);
  assert.equal(decisionExport.status, 200);
  assert.match(decisionExport.headers.get("content-type") ?? "", /text\/csv/);
  const wageCsv = await decisionExport.text();
  assert.match(wageCsv, /全年總薪資平均數/);
  assert.match(wageCsv, /25–29歲/);
  assert.doesNotMatch(wageCsv, /18–35歲/);
});

test("topic export previews the same selection, preserves mandatory identifiers and enforces permissions", async () => {
  const worker = await getWorker();
  const roleEnv = { ...env, DECISION_EMAILS: "decision-reviewer@example.invalid" };
  const selection = { topic: "wage", years: [110, 111, 112, 113], ages: ["18-35", "18-24", "25-29", "30-35"], sexes: ["合計"], districts: ["新北市"] };
  const post = (body, viewer = false) => worker.fetch((viewer ? viewerRequest : authenticatedRequest)("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), roleEnv, ctx);
  const preview = await post({ kind: "summary", selection });
  assert.equal(preview.status, 200);
  const data = await preview.json();
  assert.deepEqual(data.selection, selection);
  assert.deepEqual([data.count, data.available, data.missing, data.preview.length], [32, 32, 0, 8]);
  const csv = await post({ kind: "data", selection, fields: ["value", "source_url"] });
  assert.equal(csv.status, 200);
  const csvText = await csv.text();
  for (const age of ["18–35歲", "18–24歲", "25–29歲", "30–35歲"]) assert.ok(csvText.includes(age));
  assert.equal((await post({ kind: "summary", selection }, true)).status, 403);
  assert.equal((await post({ kind: "summary", selection: { ...selection, topic: "labor", sexes: ["女"] } })).status, 400);
  const missing = await (await post({ kind: "summary", selection: { ...selection, years: [114], ages: ["18-35"] } })).json();
  assert.deepEqual([missing.count, missing.available, missing.missing], [2, 0, 2]);
  const monthlySelection = { ...selection, topic: "monthly", years: [114], ages: ["18-35"] };
  const monthly = await (await post({ kind: "summary", selection: monthlySelection })).json();
  assert.equal(monthly.count, 12);
  assert.ok(monthly.fields.includes("roc_month"));
  const monthlyCsv = await (await post({ kind: "data", selection: monthlySelection, fields: ["value"] })).text();
  assert.ok(monthlyCsv.split(/\r?\n/)[0].includes("月份"));
});

test("server-renders monthly population first and permission-aware analysis entrances", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/", { headers: { accept: "text/html" } }), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
  const html = await response.text();
  assert.ok(html.includes(siteRelease.uiVersion), "HTML must carry the current UI release, not an older deployment label");
  assert.match(html, /介面更新/);
  assert.match(html, /<html lang="zh-Hant">/);
  assert.match(html, /<title>新北青年資料證據台｜三母體互動儀表板<\/title>/);
  assert.match(html, /切換儀表板頁面/);
  assert.match(html, /href="\?view=registered"/);
  assert.match(html, /href="\?view=district"/);
  assert.match(html, /href="\?view=labor"/);
  assert.match(html, /href="\?view=wage"/);
  assert.doesNotMatch(html, /href="\?view=export"/);
  assert.match(html, /登入首頁｜跨年度月度分析/);
  assert.match(html, /先看新北市青年戶籍人口每月變化/);
  assert.match(html, /戶籍青年人口跨年度月度分析/);
  assert.match(html, /全年度比較分析/);
  assert.match(html, /戶籍人口／教育程度／婚姻狀態／男女（全新北市）/);
  assert.match(html, /戶籍人口／教育程度／婚姻狀態／男女（29個行政區）/);
  assert.match(html, /就業率／失業率（全新北市）/);
  assert.match(html, /薪資資料（全新北市）/);
  assert.doesNotMatch(html, /依條件匯出三種母體/);
  assert.match(html, /110–114年｜全年度比較分析/);
  assert.match(html, /接著選擇要處理的問題/);
  assert.match(html, /AI問(?:<!-- -->)?資料入口(?:<!-- -->)?資料/);
  assert.match(html, /資料檢視模式只回答已發布數據/);
  assert.match(html, /class="help-tip/);
  assert.match(html, /查看「首頁資料範圍」說明/);
  assert.doesNotMatch(html, /先選時間視角/);
  assert.match(html, /跳至主要內容/);
  assert.match(html, /aria-label="開啟主要選單"/);
  assert.match(html, /aria-controls="mobile-main-menu"/);
  assert.match(html, /儀表板主要選單/);
  assert.match(html, /資料檢視/);
  assert.doesNotMatch(html, /数据|资料|显示|页面|计算|估计|下一觀測期外推|115年7月|PENDING_HUMAN_REVIEW|codex-preview|Your site is taking shape/);
});

test("district map keeps the click surface clear and exposes readable structured analysis", async () => {
  const client = await readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(client, /數據呈現的趨勢/);
  assert.match(client, /可以進行的措施/);
  assert.match(client, /不能直接下的結論/);
  assert.match(client, /連續漸層圖例/);
  assert.match(css, /\.map-quick-card\s*\{[^}]*position:\s*static/);
  assert.match(css, /\.policy-map-layout\s*\{[^}]*align-items:\s*start/);
  assert.match(css, /\.district-analysis-list li[^}]*font-size:\s*14px/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.filter-controls, \.kpi-grid\s*\{\s*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /\.map-quick-card\s*\{[^}]*position:\s*absolute/);
});

test("contextual help uses progressive disclosure without relying on hover alone", async () => {
  const client = await readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(client, /className={`help-tip/);
  assert.match(client, /<details[\s\S]*<summary className="help-tip-trigger"[\s\S]*aria-label={`查看「\$\{label\}」說明`}/);
  assert.match(css, /\.help-tip:hover > \.help-tip-panel/);
  assert.match(css, /\.help-tip:focus-within > \.help-tip-panel/);
  assert.match(css, /\.help-tip > details\[open\] \+ \.help-tip-panel/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.help-tip-trigger\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
  assert.match(css, /\.help-tip-panel,[\s\S]*?position:\s*fixed/);
});

test("mobile menu owns an iOS-safe touch scroll region", async () => {
  const client = await readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(client, /const uiVersion = siteRelease\.uiVersion/);
  assert.match(client, /<\/header>\s*<nav [^>]*id="mobile-main-menu"/);
  assert.match(client, /useModalInteraction\(menuOpen, menuPanelRef/);
  assert.match(css, /\.mobile-menu\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?max-height:\s*calc\(100dvh/);
  assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(css, /touch-action:\s*pan-y/);
  assert.match(css, /overscroll-behavior:\s*contain/);
});

test("release information distinguishes interface updates from unchanged source-data generation", async () => {
  const client = await readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
  assert.match(client, /介面更新時間<\/dt><dd>\{formatGeneratedAt\(siteRelease.updatedAt\)\}/);
  assert.match(client, /資料包生成時間<\/dt><dd>\{formatGeneratedAt\(dashboardData.meta.generatedAt\)\}/);
  assert.match(client, /政策頁版<\/dt><dd>\{siteRelease.policyExperienceVersion\}/);
  assert.ok(Number.isFinite(Date.parse(siteRelease.updatedAt)));
  assert.equal(siteRelease.policyExperienceVersion, "G6-POL V3.6");
});

test("decision narrative is consolidated into the internal policy workbench", async () => {
  const client = await readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
  const policy = (await Promise.all(["policy-workflow.tsx", "policy-narrative-workbench.tsx", "policy-narrative.ts"].map((name) => readFile(new URL("../app/" + name, import.meta.url), "utf8")))).join("\n");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(client, /function DecisionStory/);
  assert.match(client, /function StoryBridge/);
  assert.match(client, /activeView === "policy" && canViewPolicy && <PolicyWorkflow/);
  assert.match(client, /function PolicyEvidencePreview/);
  assert.match(client, /<PolicyEvidencePreview signal=\{signal\}/);
  assert.match(client, /證據官方來源/);
  assert.match(client, /showPolicy={false}/);
  assert.match(policy, /行政區建議/);
  assert.match(policy, /新北市建議/);
  assert.match(policy, /戶籍登記現住人口/);
  assert.match(policy, /scope === "district" \? \(selectedDistrictSignal \? \[selectedDistrictSignal\] : \[\]\) : citySignals/);
  assert.match(policy, /不分攤成行政區數值/);
  assert.match(policy, /建議青年局主責/);
  assert.match(policy, /執行與追蹤/);
  assert.match(policy, /維持現況/);
  assert.match(policy, /最低調整/);
  assert.match(policy, /小規模試辦/);
  assert.match(policy, /四種可比較的做法/);
  assert.match(policy, /AI問政策證據/);
  assert.match(client, /showServicePolicyEvidence && <section className="district-service-evidence"/);
  assert.match(client, /showServicePolicyEvidence && <div className="coverage-missing"/);
  assert.match(client, /不能直接推論/);
  assert.doesNotMatch(client, /需人工審核|須人工審核|人工審核/);
  assert.match(css, /\.decision-story\s*\{/);
  assert.match(css, /\.policy-workbench/);
  assert.match(css, /\.policy-scope-grid\s*\{/);
  assert.match(css, /\.policy-vertical-flow\s*\{/);
  assert.match(css, /\.policy-ai-entry\s*\{/);
  assert.match(css, /\.policy-drawer-bars\s*\{/);
  assert.match(css, /\.district-policy-result-heading\s*\{/);
  assert.match(css, /\.policy-domain-list/);
  assert.doesNotMatch(css, /\.human-review-badge\s*\{/);
});

test("youth industry page follows the shared annual-analysis reading pattern", async () => {
  const client = await readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(client, /從就業規模，讀到青年所在行業/);
  assert.match(client, /青年就業規模與行業集中度/);
  assert.match(client, /青年就業者集中在哪些行業/);
  assert.match(client, /在各生命階段的年度比較/);
  assert.match(client, /的男女結構差異/);
  assert.match(client, /行業 × 年齡 × 性別交叉矩陣/);
  assert.match(client, /18–35歲整體基準/);
  assert.match(client, /前五大行業合計占比＝同年齡同性別占比最高五類之和/);
  assert.match(client, /查看完整19類行業資料表/);
  assert.match(client, /<WorkCategoryAudit[^>]*showPolicy={false}/);
  assert.match(css, /\.industry-heatmap\s*\{/);
  assert.match(css, /\.industry-rank-bar:focus-visible/);
});

test("authenticated static assets are served from the asset binding", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/_next/static/css/dashboard.css"), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset:/_next/static/css/dashboard.css");
});

test("public static assets support the outward-facing data view", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(
    new Request("https://ntpc-youth.the-weekly-blend.com/_next/static/css/dashboard.css"),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset:/_next/static/css/dashboard.css");
});

test("public users can read data but cannot reach policy or export functions", async () => {
  const worker = await getWorker();
  const status = await worker.fetch(
    new Request("https://ntpc-youth.the-weekly-blend.com/auth/status"),
    env,
    ctx,
  );
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    authenticated: false,
    role: "viewer",
    permissions: { viewPolicy: false, exportData: false },
  });

  const page = await worker.fetch(
    new Request("https://ntpc-youth.the-weekly-blend.com/", { headers: { accept: "text/html" } }),
    env,
    ctx,
  );
  assert.equal(page.status, 200);
  assert.match(await page.text(), /先看新北市青年戶籍人口每月變化/u);

  const policyQuestion = await worker.fetch(new Request("https://ntpc-youth.the-weekly-blend.com/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "淡水區可以採取哪些政策？", context: { year: 114, ageBand: "18-35", district: "淡水區" } }),
  }), env, ctx);
  assert.equal(policyQuestion.status, 403);

  const exportResponse = await worker.fetch(new Request("https://ntpc-youth.the-weekly-blend.com/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "codebook" }),
  }), env, ctx);
  assert.equal(exportResponse.status, 403);
});

test("local population answer uses the published 114-year record", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "114年新北市18–35歲核心青年有多少人？", context: { year: 114, ageBand: "18-35", sex: "合計", district: "新北市" } }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.mode, "LOCAL_EVIDENCE_FALLBACK");
  assert.match(payload.answer, /845,938人/);
  assert.match(payload.caveat, /戶籍登記現住人口/);
  assert.equal(payload.sources[0].label, "戶政司單一年齡人口");
});

test("data-scope answer distinguishes available sex dimensions", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "哪些資料可以分男女，哪些只有男女合計？", context: { year: 114, ageBand: "18-35", view: "overview" } }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /戶籍人口、教育程度與婚姻狀態可依男性、女性或合計查看/);
  assert.match(body.answer, /青年勞動市場與青年薪資目前只發布男女合計/);
  assert.match(body.caveat, /不按人口比例分攤/);
});

test("export answer preserves three-universe files and unavailable dimensions", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "CSV怎麼選欄位匯出？", context: { year: 114, ageBand: "18-35", sex: "合計", district: "新北市", view: "export" } }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /分成三份CSV/);
  assert.match(body.answer, /Code Book/);
  assert.match(body.caveat, /行政區適用戶籍相關資料及青年據點/);
  assert.match(body.caveat, /18–35、18–24、25–29及30–35歲/);
});

test("monthly population dataset reconciles to the annual snapshot", async () => {
  const payload = JSON.parse(await readFile(new URL("../app/data/monthly-population.json", import.meta.url), "utf8"));
  assert.equal(payload.records.length, 21600);
  assert.equal(payload.qa.ageBandReconciliation, "PASS");
  assert.equal(payload.qa.sexReconciliation, "PASS");
  assert.equal(payload.qa.districtReconciliation, "PASS");
  assert.deepEqual(payload.qa.annualSnapshot11412, { expected: 845938, actual: 845938, status: "PASS" });
  assert.equal(payload.meta.identity, "官方行政精確值");
  assert.equal(payload.meta.periods[0], "11001");
  assert.equal(payload.meta.periods.at(-1), "11412");
});

test("dashboard evidence payload includes official area and the fourth auxiliary CSV with exposure intensity", async () => {
  const payload = JSON.parse(await readFile(new URL("../app/data/g5-dashboard-data.json", import.meta.url), "utf8"));
  const banqiao = payload.registered.find((row) => row.year === 114 && row.geography.endsWith("板橋區") && row.ageBand === "18-35" && row.sex === "合計");
  assert.ok(banqiao.landAreaKm2 > 0);
  assert.equal(Number((banqiao.population / banqiao.landAreaKm2).toFixed(6)), banqiao.populationDensityPerKm2);
  assert.equal(payload.service.annual.length, 8);
  assert.equal(payload.service.facilities.length, 11);
  assert.equal(payload.service.facilities.filter((row) => row.active).length, 10);
  assert.equal(payload.service.capacityComponents.length, 16);
  assert.equal(payload.service.exposure.status, "PUBLISH_EXACT_DERIVED");
  assert.equal(payload.service.exposure.unit, "人次／場");
  assert.ok(payload.files.some((file) => file.name === "06_政策服務與曝光_長格式.csv"));
});

test("youth resident employment industry layer covers five years and closes to official broad-age margins", async () => {
  const payload = JSON.parse(await readFile(new URL("../app/data/resident-employment-industry.json", import.meta.url), "utf8"));
  assert.deepEqual(payload.meta.years, [110, 111, 112, 113, 114]);
  assert.equal(payload.qa.categoryCount, 19);
  assert.equal(payload.qa.recordCount, 1425);
  assert.equal(payload.qa.status, "PASS");
  assert.ok(payload.qa.years.every((row) => row.status === "PASS"));
  assert.ok(payload.qa.youthYears.every((row) => row.status === "PASS"));
  assert.ok(payload.qa.youthYears.every((row) => row.sourceBandReaggregationMaxErrorThousands === 0));
  assert.ok(payload.qa.youthYears.every((row) => row.laborTargetReconciliationMaxErrorThousands === 0));
  assert.ok(payload.qa.youthYears.every((row) => row.shareClosureMaxErrorPercentagePoints === 0));
  const officialManufacturing = payload.records.find((row) => row.year === 114 && row.ageBand === "ALL" && row.industry === "製造業" && row.sex === "合計");
  assert.equal(officialManufacturing.employedThousands, 488);
  assert.equal(officialManufacturing.sharePct, 23.51);
  assert.equal(officialManufacturing.origin, "官方人力資源調查估計值");
  const youth = payload.records.filter((row) => row.year === 114 && row.ageBand === "18-35" && row.sex === "合計");
  assert.equal(youth.length, 19);
  assert.ok(Math.abs(youth.reduce((sum, row) => sum + row.sharePct, 0) - 100) < 0.02);
  assert.ok(youth.every((row) => row.origin === "官方調查寬年齡帶與青年就業母數雙重錨定之模型估計值"));
  assert.ok(youth.every((row) => row.employedThousandsLow <= row.employedThousands && row.employedThousands <= row.employedThousandsHigh));
});

test("monthly population answer explains stock and comparison formulas", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "114年新北市18–35歲戶籍人口每月變化？", context: { year: 114, ageBand: "18-35", sex: "合計", district: "新北市", view: "registered" } }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /114年12月底.*845,938人.*月增率.*同月年增率/);
  assert.match(body.caveat, /月底存量.*月增率＝.*同月年增率＝/);
});

test("monthly population API returns one selected year without sending the full dataset to the browser", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/monthly-population?year=110&geography=%E6%96%B0%E5%8C%97%E5%B8%82&ageBand=18-35&sex=%E5%90%88%E8%A8%88"), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.rows.length, 12);
  assert.equal(body.rows[0].period, "11001");
  assert.equal(body.rows.at(-1).period, "11012");
  assert.equal(body.meta.identity, "官方行政精確值");
});

test("monthly population API returns the governed five-year monthly window", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/monthly-population?startYear=110&endYear=114&geography=%E6%96%B0%E5%8C%97%E5%B8%82&ageBand=18-35&sex=%E5%90%88%E8%A8%88"), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.rows.length, 60);
  assert.equal(body.rows[0].period, "11001");
  assert.equal(body.rows.at(-1).period, "11412");
  assert.equal(new Set(body.rows.map((row) => row.period)).size, 60);
  assert.match(body.scale.rule, /110–114年月資料共同固定Y軸/);
});

test("industry answer keeps residence and workplace scopes separate", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "在新北市工作的18–35歲有哪些工作類別？", context: { year: 114, ageBand: "18-35", view: "labor" } }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /居住地口徑.*不能回答「工作地在新北市」/);
  assert.match(body.caveat, /行業.*職業.*不可互換/);
});

test("density answer combines official population and land area with the disclosed formula", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "114年板橋區18–35歲青年人口密度？", context: { year: 114, ageBand: "18-35", sex: "合計", district: "板橋區" } }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /板橋區.*人／平方公里.*平方公里/);
  assert.match(body.caveat, /人口密度＝.*戶籍青年人口÷官方公告行政區土地面積/);
});

test("facility answer uses the official inventory and keeps absence from becoming a coverage conclusion", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "板橋區有幾個青年服務據點？", context: { year: 114, ageBand: "18-35", district: "板橋區" } }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /板橋區官方清冊.*3處.*3處營運中/);
  assert.match(body.caveat, /清冊未列據點不等於沒有/);
});

test("district policy answer makes the Tamsui action and evidence auditable", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "淡水區是否建議新增青年據點？", context: { year: 114, ageBand: "18-35", sex: "合計", district: "淡水區", view: "district" } }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /試辦6個月.*青年巡迴服務日/);
  assert.match(body.answer, /增加2,078人（5\.08%）/);
  assert.match(body.answer, /29區排名第1/);
  assert.match(body.answer, /全市有3區為正成長/);
  assert.match(body.answer, /4\/4個年度區間.*增加/);
  assert.match(body.answer, /0處營運中據點/);
  assert.match(body.caveat, /不等於已證明服務不足/);
  assert.match(body.caveat, /青年需求.*交通可近性.*經費.*替代方案/);
});

test("district policy answer uses education and marriage without irrelevant site-capacity copy", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "烏來區有哪些政策建議與教育婚姻數據依據？", context: { year: 114, ageBand: "18-35", sex: "合計", district: "烏來區", view: "district" } }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /職涯導航.*技能證照.*就業媒合或進修諮詢/);
  assert.match(body.answer, /高中職及以下占62\.22%.*高於全市42\.20%.*20\.02個百分點/);
  assert.match(body.answer, /有偶占26\.62%.*高於全市15\.81%.*10\.81個百分點/);
  assert.doesNotMatch(body.answer, /據點|服務人次|場次/);
  assert.ok(!body.sources.some((source) => source.id === "NTPC-YOUTH-FACILITY"));
  assert.match(body.caveat, /不能直接推論個人需求.*政策效果/);
});

test("service participation answer distinguishes person-times from unique participants", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "114年青年服務參與人數與活動場次？", context: { year: 114, ageBand: "18-35" } }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /11,081人次.*233場/);
  assert.match(body.caveat, /可重複計入.*人次÷場次.*不能發布分區值/);
});

test("exposure answer preserves repeated person-times and does not call the value a percentage", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "114年青年服務曝光率是多少？", context: { year: 114, ageBand: "18-35" } }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /每場平均服務人次為47\.56人次／場.*11,081參與人次÷233活動場次/);
  assert.match(body.caveat, /不是百分比.*重複計入/);
});

test("labor answer discloses rates, population identity and method", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "114年18–35歲失業率與勞參率是多少？" }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.answer, /失業率為5\.56%/);
  assert.match(payload.answer, /勞動力參與率為82\.52%/);
  assert.match(payload.caveat, /PCLM年齡拆分/);
  assert.match(payload.caveat, /失業率分母是勞動力/);
});

test("district labor question refuses unsupported granularity", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "板橋區可以看勞參率嗎？" }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.answer, /不能切到板橋區/);
  assert.match(payload.caveat, /不要把全市.*分攤到各行政區/);
});

test("114-year wage question preserves the empty state", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "114年18–35歲平均薪資有資料嗎？" }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.answer, /114年尚無/);
  assert.match(payload.answer, /不會自動用113年.*代替114年/);
});

test("113-year wage question supports the modeled 18–35 average", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "113年18–35歲平均薪資是多少？" }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.answer, /60\.9萬元/);
  assert.match(payload.answer, /中位數為51\.7萬元/);
  assert.match(payload.answer, /模型估計/);
  assert.match(payload.caveat, /前台只發布18–35歲/);
});

test("rejects an empty question and removes starter artifacts", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(authenticatedRequest("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "" }),
  }), env, ctx);
  assert.equal(response.status, 400);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

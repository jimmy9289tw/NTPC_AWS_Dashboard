import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { budgetOptionId, calculatePolicyBudget, emptyBudgetDraft, policyBudgetChatContext, policyBudgetRules } from "../app/policy-budget.ts";
import { PolicyBudgetTable } from "../app/policy-budget-table.tsx";

const example = { personnel: "400000", books: "1", operations: "540500", management: "50000" };
const options = [
  { id: "current", title: "維持現況", action: "維持既有服務並整理使用紀錄。" },
  { id: "adjust", title: "最低調整", action: "依參與者回饋調整服務內容。" },
  { id: "pilot", title: "小規模試辦", action: "在既有場地辦理候選方案。" },
].map((item) => ({ ...item, benefit: "", tradeoff: "", timing: "" }));
function render(option = "adjust", draft = emptyBudgetDraft) {
  return renderToStaticMarkup(createElement(PolicyBudgetTable, { options, selectedOption: options.find((item) => item.id === option), onSelect() {}, draft, onDraftChange() {}, budget: calculatePolicyBudget(option, draft) }));
}

test("three mutually exclusive scenarios use the user's totals and personnel ceilings", () => {
  assert.deepEqual(policyBudgetRules.totals, { current: 0, adjust: 1000000, pilot: 2000000 });
  assert.equal(calculatePolicyBudget("adjust", emptyBudgetDraft).personnelCap, 500000);
  assert.equal(calculatePolicyBudget("pilot", emptyBudgetDraft).personnelCap, 1000000);
  assert.throws(() => budgetOptionId("unknown"), /無對應/);
});

test("maintaining current services means zero incremental budget, not zero opportunity cost", () => {
  const result = calculatePolicyBudget("current", example);
  assert.equal(result.total, 0);
  assert.equal(result.enteredSubtotal, 0);
  assert.equal(result.personnelShare, null, "no 0/0 percentage");
  assert.equal(result.status, "不新增經費");
  assert.equal(result.reconciled, true);
  assert.match(render("current"), /既有人力與資源承接/);
  assert.doesNotMatch(render("current"), /type="number"/);
});

test("blank items remain unknown and a real zero is distinct", () => {
  const missing = calculatePolicyBudget("adjust", emptyBudgetDraft);
  assert.equal(missing.values.personnel, null);
  assert.equal(missing.bookCost, null);
  assert.equal(missing.complete, false);
  assert.equal(missing.status, "分項待編列");
  assert.equal(missing.missing.length, 4);
  const zero = calculatePolicyBudget("adjust", { personnel: "0", books: "0", operations: "0", management: "0" });
  assert.equal(zero.bookCost, 0);
  assert.equal(zero.complete, true);
  assert.equal(zero.reconciled, false);
  assert.equal(zero.status, "尚有未編列額度");
});

test("personnel cap accepts exactly 50 percent and rejects one yuan over in either scenario", () => {
  for (const [option, cap] of [["adjust", 500000], ["pilot", 1000000]]) {
    assert.equal(calculatePolicyBudget(option, { ...emptyBudgetDraft, personnel: String(cap) }).errors.personnel, undefined);
    assert.match(calculatePolicyBudget(option, { ...emptyBudgetDraft, personnel: String(cap + 1) }).errors.personnel, /不得超過/);
  }
});

test("books cost exactly 9500 per whole book and are counted only once", () => {
  assert.equal(policyBudgetRules.bookUnitPrice, 9500);
  const result = calculatePolicyBudget("adjust", example);
  assert.equal(result.bookCost, 9500);
  assert.equal(result.enteredSubtotal, 1000000);
  assert.equal(result.remaining, 0);
  assert.equal(result.personnelShare, 0.4);
  assert.equal(result.status, "試算平衡，尚未核定");
  const pilot = calculatePolicyBudget("pilot", { personnel: "1000000", books: "2", operations: "881000", management: "100000" });
  assert.equal(pilot.bookCost, 19000);
  assert.equal(pilot.enteredSubtotal, 2000000);
  assert.equal(pilot.reconciled, true);
});

test("invalid amounts, over-budget books, and total overspending cannot pass", () => {
  for (const input of ["-1", "1.5", "NaN", "Infinity", "1e3", "9007199254740992"]) {
    const result = calculatePolicyBudget("adjust", { ...example, books: input });
    assert.equal(result.valid, false);
    assert.equal(result.reconciled, false);
    assert.ok(result.errors.books);
  }
  assert.ok(calculatePolicyBudget("adjust", { ...emptyBudgetDraft, books: "106" }).errors.books);
  const result = calculatePolicyBudget("adjust", { ...example, operations: "540501" });
  assert.match(result.errors.total, /超出概估總額1元/);
  assert.equal(result.status, "金額需修正");
});

test("the source stays reference-only and user drafts are not mutated", () => {
  const before = JSON.stringify(example);
  calculatePolicyBudget("adjust", example);
  calculatePolicyBudget("pilot", example);
  assert.equal(JSON.stringify(example), before);
  assert.equal(policyBudgetRules.reference.sheet, "109_經常門經費分析表");
  assert.equal(policyBudgetRules.reference.bookCell, "C13");
  assert.match(render(), /不沿用原案金額、60本數量、管理費率或支用規定/);
  assert.match(render(), /不是引用法定上限/);
  assert.match(render(), /未將|不將概估視為所選歷史年度的支出/);
});

test("the table shows three options and accessible validation without adding data exports", () => {
  const html = render("adjust", { ...example, personnel: "600000" });
  assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
  assert.equal((html.match(/type="number"/g) ?? []).length, 4);
  assert.match(html, /100萬元/);
  assert.match(html, /200萬元/);
  assert.match(html, /不超過50萬元/);
  assert.match(html, /不超過100萬元/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /9,500元/);
  assert.match(html, /<summary>經費分項、計算方式與編列檢查/);
  assert.doesNotMatch(html, /href=".*\.xls/);
});

test("AI context carries budget provenance, missing inputs and no fabricated cost-effectiveness", () => {
  const prompt = policyBudgetChatContext(calculatePolicyBudget("pilot", emptyBudgetDraft));
  assert.match(prompt, /2,000,000元/);
  assert.match(prompt, /人事費上限1,000,000元/);
  assert.match(prompt, /本數待確認/);
  assert.match(prompt, /圖書費待編列/);
  assert.match(prompt, /不得從概估金額推算服務人次/);
  assert.match(prompt, /不是歷史實支或核定預算/);
});

test("budget reference is retained but removed from the current policy experience", async () => {
  const source = await readFile(new URL("../app/policy-narrative-workbench.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /PolicyBudgetTable|policyBudgetChatContext|經費控管/);
  assert.match(source, /policyActionFlow\(context, displayCase, programId\)/);
  const flow = await readFile(new URL("../app/policy-action-flow.ts", import.meta.url), "utf8");
  assert.match(flow, /policyPrograms\(context, item\)/);
  assert.match(flow, /item.state === "已觸發"/);
  assert.doesNotMatch(source, /localStorage\.setItem|sessionStorage\.setItem/);
  const client = await readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8");
  assert.match(client, /activeView === "policy" && canViewPolicy && <PolicyWorkflow/);
});

/** Planning assumptions supplied by the user, not observed expenditure or reimbursement rules. */
export const policyBudgetRules = {
  version: "政策經費概估 V1｜2026-09-08",
  currency: "新臺幣",
  personnelMaxShare: 0.5,
  bookUnitPrice: 9500,
  totals: { current: 0, adjust: 1000000, pilot: 2000000 },
  reference: {
    file: "附件1_115TFDA-D-073_經費分析概算表.xls",
    sheet: "109_經常門經費分析表",
    headingCell: "A1",
    columns: "A2:C2",
    bookCell: "C13",
    sha256: "35fd28433f83ae43a0577f118ef163fbfa79a1dbc90e8091036f1105b060a082",
  },
} as const;

export type BudgetOptionId = keyof typeof policyBudgetRules.totals;
export type BudgetDraft = { personnel: string; books: string; operations: string; management: string };
export const emptyBudgetDraft: BudgetDraft = { personnel: "", books: "", operations: "", management: "" };
export const budgetFieldLabels: Record<keyof BudgetDraft, string> = {
  personnel: "人事費", books: "圖書本數", operations: "其他業務費", management: "管理費",
};
export const budgetMoney = (value: number) => value.toLocaleString("zh-TW") + "元";

export function budgetOptionId(id: string): BudgetOptionId {
  if (id !== "current" && id !== "adjust" && id !== "pilot") throw new Error("無對應的預算方案");
  return id;
}

export function calculatePolicyBudget(option: BudgetOptionId, draft: BudgetDraft) {
  const total = policyBudgetRules.totals[option];
  const personnelCap = total * policyBudgetRules.personnelMaxShare;
  const errors: Partial<Record<keyof BudgetDraft | "total", string>> = {};
  const missing: (keyof BudgetDraft)[] = [];
  const values: Record<keyof BudgetDraft, number | null> = { personnel: null, books: null, operations: null, management: null };
  for (const key of Object.keys(values) as (keyof BudgetDraft)[]) {
    if (option === "current") { values[key] = 0; continue; }
    const raw = draft[key].trim();
    if (raw === "") { missing.push(key); continue; }
    const amount = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(amount)) {
      errors[key] = budgetFieldLabels[key] + "請填0或正整數；未確認請留白。";
      continue;
    }
    if (amount > (key === "books" ? Math.floor(total / policyBudgetRules.bookUnitPrice) : total)) {
      errors[key] = budgetFieldLabels[key] + "超出本方案概估總額。";
    }
    values[key] = amount;
  }
  if (values.personnel != null && values.personnel > personnelCap) {
    errors.personnel = `人事費不得超過${budgetMoney(personnelCap)}（方案總額的50%）。`;
  }
  const bookCost = values.books == null ? null : values.books * policyBudgetRules.bookUnitPrice;
  // Missing inputs stay null. This is explicitly the sum of entered amounts, not a completed budget.
  const enteredSubtotal = [values.personnel, bookCost, values.operations, values.management].reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const remaining = total - enteredSubtotal;
  if (remaining < 0) errors.total = `已填分項超出概估總額${budgetMoney(-remaining)}。`;
  const valid = Object.keys(errors).length === 0;
  const complete = valid && missing.length === 0;
  const reconciled = complete && remaining === 0;
  const status = option === "current" ? "不新增經費"
    : !valid ? "金額需修正"
      : !complete ? "分項待編列"
        : remaining > 0 ? "尚有未編列額度" : "試算平衡，尚未核定";
  return { option, total, personnelCap, values, bookCost, enteredSubtotal, remaining, errors, missing, valid, complete, reconciled, status,
    personnelShare: total > 0 && values.personnel != null ? values.personnel / total : null };
}

export type PolicyBudgetCalculation = ReturnType<typeof calculatePolicyBudget>;

export function policyBudgetChatContext(budget: PolicyBudgetCalculation) {
  const pendingMoney = (value: number | null) => value == null ? "待編列" : budgetMoney(value);
  return [
    `經費假設（${policyBudgetRules.version}）：單一議題方案新增總額概估${budgetMoney(budget.total)}；不是歷史實支或核定預算，不與其他替代方案加總。`,
    `人事費上限${budgetMoney(budget.personnelCap)}；包含雇主負擔保險、退休提撥及臨時人力。人事試編${pendingMoney(budget.values.personnel)}。`,
    `圖書固定${budgetMoney(policyBudgetRules.bookUnitPrice)}/本；本數${budget.values.books ?? "待確認"}；圖書費${pendingMoney(budget.bookCost)}。`,
    `其他業務費${pendingMoney(budget.values.operations)}（不重複含圖書或人事）；管理費${pendingMoney(budget.values.management)}。`,
    `試算狀態：${budget.status}。${Object.values(budget.errors).join(" ")}`,
    "維持現況僅指新增預算為0，既有資源不是零成本；管理費率、執行期間、報價及可服務規模尚未確認。不得從概估金額推算服務人次或宣稱成本效益成立。",
  ].join("\n");
}

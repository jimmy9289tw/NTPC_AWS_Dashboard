"use client";

import { useId } from "react";
import type { PolicyOption } from "./policy-narrative";
import { budgetFieldLabels, budgetMoney, budgetOptionId, policyBudgetRules, type BudgetDraft, type PolicyBudgetCalculation } from "./policy-budget";

export function PolicyBudgetTable({ options, selectedOption, onSelect, draft, onDraftChange, budget }: {
  options: PolicyOption[]; selectedOption: PolicyOption; onSelect: (id: string) => void;
  draft: BudgetDraft; onDraftChange: (key: keyof BudgetDraft, value: string) => void; budget: PolicyBudgetCalculation;
}) {
  const id = useId();
  return <section className="pn-budget" aria-labelledby={id + "-heading"}>
    <header><h4 id={id + "-heading"}>方案與經費概估</h4><p>單一議題、單次計畫的新增預算，單位：新臺幣。三方案擇一比較，不加總。</p></header>
    <table className="pn-budget-comparison">
      <caption className="sr-only">選擇政策方案，查看新增預算概估及人事費上限</caption>
      <thead><tr><th scope="col">比較方案</th><th scope="col">新增預算概估</th><th scope="col">人事費上限</th></tr></thead>
      <tbody>{options.map((option) => {
        const total = policyBudgetRules.totals[budgetOptionId(option.id)];
        return <tr key={option.id} className={selectedOption.id === option.id ? "is-selected" : ""}>
          <th scope="row"><label><input type="radio" name={id + "-option"} checked={selectedOption.id === option.id} onChange={() => onSelect(option.id)} /><span>{option.title}</span></label></th>
          <td>{total === 0 ? "0元" : total / 10000 + "萬元"}</td><td>{total === 0 ? "不新增" : "不超過" + total * policyBudgetRules.personnelMaxShare / 10000 + "萬元"}</td>
        </tr>;
      })}</tbody>
    </table>
    <p className="pn-budget-action"><strong>{selectedOption.title}的作法：</strong>{selectedOption.action}</p>
    <p className="pn-budget-note">維持現況由既有人力與資源承接，不代表整體成本為0。100萬及200萬元是規劃情境，不是報價、核定額或預期效益。</p>
    <details className="pn-details">
      <summary>經費分項、計算方式與編列檢查</summary>
      {budget.option === "current" ? <p>本方案不新增人事、圖書或其他費用。若需新購圖書或新增人力，請改選其他方案；既有經費另依原計畫管理。</p> : <>
        <p>先填確認的分項；確定不編列請填0，尚未確認請留白。只供本頁試算，離開頁面後不儲存。</p>
        <div className="pn-budget-inputs">{(Object.keys(budgetFieldLabels) as (keyof BudgetDraft)[]).map((key) => <label key={key} htmlFor={id + key}>
          <span>{key === "books" ? "圖書本數（本）" : budgetFieldLabels[key] + "（元）"}</span>
          <input id={id + key} type="number" inputMode="numeric" min="0" step="1" max={key === "personnel" ? budget.personnelCap : key === "books" ? Math.floor(budget.total / policyBudgetRules.bookUnitPrice) : budget.total} value={draft[key]} placeholder="待編列" onChange={(event) => onDraftChange(key, event.target.value)} aria-invalid={Boolean(budget.errors[key])} aria-describedby={id + key + "-note"} />
          <small id={id + key + "-note"}>{budget.errors[key] ?? (key === "books" ? "單價固定9,500元／本；不預設本數。" : key === "personnel" ? "含薪資、雇主保險、退休提撥及臨時人力。" : key === "operations" ? "不含另列的圖書、人事及管理費。" : "不自動套用附件費率；依核定條件編列。")}</small>
        </label>)}</div>
        <table className="pn-budget-detail"><caption>{selectedOption.title}經費分項</caption><thead><tr><th scope="col">項目</th><th scope="col">試編金額</th><th scope="col">計算／用途</th></tr></thead><tbody>
          <tr><th scope="row">人事費</th><td>{budget.values.personnel == null ? "待編列" : budgetMoney(budget.values.personnel)}</td><td>人數 × 期間 × 薪酬，另加雇主負擔；合計不得超過{budgetMoney(budget.personnelCap)}。</td></tr>
          <tr><th scope="row">圖書費</th><td>{budget.bookCost == null ? "待編列" : budgetMoney(budget.bookCost)}</td><td>9,500元 × {budget.values.books ?? "待確認"}本；限本計畫需要的參考書籍。</td></tr>
          <tr><th scope="row">其他業務費</th><td>{budget.values.operations == null ? "待編列" : budgetMoney(budget.values.operations)}</td><td>依方案列出場地、資料蒐集、印刷、出席、差旅等必要費用；單價 × 數量後加總。</td></tr>
          <tr><th scope="row">管理費</th><td>{budget.values.management == null ? "待編列" : budgetMoney(budget.values.management)}</td><td>計費基礎 × 經確認的費率；避免與直接費重複。</td></tr>
        </tbody></table>
        <div className="pn-budget-result" aria-live="polite" aria-atomic="true">
          <strong>{budget.status}</strong><p>已填分項小計：{budgetMoney(budget.enteredSubtotal)}／概估總額：{budgetMoney(budget.total)}</p>
          {budget.remaining >= 0 && <p>尚未編列：{budgetMoney(budget.remaining)}。未填分項不視為0元，也不以雜支湊足總額。</p>}
          {budget.personnelShare != null && <p>人事費 ÷ 方案概估總額＝{(budget.personnelShare * 100).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}%；上限50%。</p>}
          {Object.keys(budget.errors).length > 0 && <ul className="pn-budget-errors">{Object.entries(budget.errors).map(([key, error]) => <li key={key}>{error}</li>)}</ul>}
          {budget.missing.length > 0 && <p>待確認：{budget.missing.map((key) => budgetFieldLabels[key]).join("、")}。</p>}
        </div>
      </>}
      <p className="pn-budget-note">人事上限是本次規劃條件，不是引用法定上限。本頁保守把臨時人力納入50%控管；正式科目歸屬由主計確認。執行期間、報價及服務規模仍待確認，不將概估視為所選歷史年度的支出。</p>
      <p className="pn-budget-note">附件參考：{policyBudgetRules.reference.file}，工作表「{policyBudgetRules.reference.sheet}」的A2:C2欄位及C13圖書單價。只參考結構與單價，不沿用原案金額、60本數量、管理費率或支用規定。</p>
    </details>
  </section>;
}

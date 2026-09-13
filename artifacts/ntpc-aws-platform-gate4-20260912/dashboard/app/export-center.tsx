import {awsExportFetch} from './aws-export';
import {monthlyPopulationData} from './monthly-population';
"use client";

import { useEffect, useState } from "react";
import { exportCodeBook, universeLabels, type ExportUniverse, type ExportRow } from "./export-contract";
import { ageBandLabel, dashboardData, geographyLabel, type AgeBand, type Sex } from "./dashboard-data";
import { exportTopics, exportTopic, exportGroupLabels, quickAnnualExportContext, type ExportSelection, type ExportTopic } from "./export-catalogue";

type Props = { year: number; ageBand: AgeBand; sex: Sex; district: string; defaultOpen?: boolean };
type Preview = { count: number; available: number; missing: number; preview: ExportRow[]; selection: ExportSelection };
const required = exportCodeBook.filter(field => field.required).map(field => field.fieldCode);
const fullFields = exportCodeBook.filter(field => field.required || field.defaultIncluded).map(field => field.fieldCode);
const simpleFields = exportCodeBook.filter(field => field.required || ["category_dimension_name_zh", "category_name_zh", "source_url"].includes(field.fieldCode)).map(field => field.fieldCode);
const districts = dashboardData.geographies.map(row => geographyLabel(row.name));
const themeRequired = (topic: ExportTopic) => topic === "monthly" ? ["roc_month"] : topic === "joint" ? ["education_name_zh", "marriage_name_zh"] : topic === "facilities" ? ["facility_name", "facility_address", "operating_status"] : [];

function triggerDownload(filename: string, content: Blob) {
  const url = URL.createObjectURL(content), link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function CheckChoices<T extends string | number>({ legend, values, selected, label, onChange }: { legend: string; values: readonly T[]; selected: T[]; label: (value: T) => string; onChange: (values: T[]) => void }) {
  const toggle = (value: T) => onChange(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
  return <fieldset className="export-choice-group"><legend>{legend}</legend><div className="export-choice-actions"><button type="button" onClick={() => onChange([...values])}>全選</button><button type="button" onClick={() => onChange([])}>清除</button></div><div className="export-choice-list">{values.map(value => <label key={value}><input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} /><span>{label(value)}</span></label>)}</div></fieldset>;
}
export function ExportCenter({ year, ageBand, sex, district, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [selection, setSelection] = useState<ExportSelection>({ topic: "population", years: [year], ages: [ageBand], sexes: [sex], districts: [districts.includes(district) ? district : "新北市"] });
  const [fields, setFields] = useState(simpleFields), [preset, setPreset] = useState("simple");
  const [preview, setPreview] = useState<Preview | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [codeBookSearch, setCodeBookSearch] = useState("");
  const topic = exportTopic(selection.topic)!;
  const locked = [...required, "category_dimension_name_zh", "category_name_zh", ...themeRequired(topic.id)];
  const effectiveFields = [...new Set([...locked, ...fields])];
  const visibleFields = exportCodeBook.filter(field => effectiveFields.includes(field.fieldCode));
  const key = JSON.stringify(selection);
  const valid = selection.years.length > 0 && selection.ages.length > 0 && selection.sexes.length > 0 && selection.districts.length > 0;
  const current = preview && JSON.stringify(preview.selection) === key ? preview : null;
  const ready = !!current?.count && valid;
  const quickContext = quickAnnualExportContext(selection);

  useEffect(() => {
    if (!open || !valid) return;
    const controller = new AbortController();
    let active = true;
    awsExportFetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "summary", selection: JSON.parse(key) }), signal: controller.signal })
      .then(async response => { const result = await response.json() as Preview & { error?: { message?: string } }; if (!response.ok) throw Error(result.error?.message ?? "無法讀取預覽。"); return result; })
      .then(result => { if (active) setPreview(result); })
      .catch(error => { if (active && error.name !== "AbortError") setMessage(error.message ?? "無法讀取預覽。"); });
    return () => { active = false; controller.abort(); };
  }, [key, open, valid]);

  function update(next: Partial<ExportSelection>) { setSelection(value => ({ ...value, ...next, years: [...(next.years ?? value.years)].sort((a,b) => a-b) })); setPreview(null); setMessage(""); }
  function updateDistricts(values: string[]) {
    if (topic.id !== "facilities" || !values.includes("新北市") || values.length < 2) return update({ districts: values });
    const choseCity = !selection.districts.includes("新北市") && values.length !== districts.length;
    update({ districts: choseCity ? ["新北市"] : values.filter(value => value !== "新北市") });
  }
  function chooseTopic(id: ExportTopic) {
    const next = exportTopic(id)!;
    update({ topic: id, years: id === "facilities" ? [dashboardData.service.snapshotYear] : selection.years.filter(value => dashboardData.meta.years.includes(value)).length ? selection.years.filter(value => dashboardData.meta.years.includes(value)) : [year],
      ages: next.ages ? selection.ages.filter(value => dashboardData.meta.ageBands.includes(value as AgeBand)).length ? selection.ages : [ageBand] : ["不適用"],
      sexes: next.sex ? selection.sexes.filter(value => dashboardData.meta.sexes.includes(value as Sex)).length ? selection.sexes : [sex] : [next.ages ? "合計" : "不適用"],
      districts: next.region ? id === "facilities" && selection.districts.length > 1 ? selection.districts.filter(value => value !== "新北市") : selection.districts : ["新北市"] });
  }
  async function download(kind: "data" | "codebook") {
    setBusy(true); setMessage("");
    try {
      const response = await awsExportFetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(kind === "data" ? { kind, selection, fields: effectiveFields } : { kind }) });
      if (!response.ok) { const error = await response.json() as { error?: { message?: string } }; throw Error(error.error?.message ?? "下載失敗。"); }
      triggerDownload(kind === "codebook" ? "新北青年_Code_Book.csv" : `新北青年_${topic.label}_${selection.years.join("-")}年.csv`, await response.blob());
      setMessage(kind === "codebook" ? "欄位說明已下載。" : `已下載${topic.label}：${current?.count ?? ""}列。 `);
    } catch (error) { setMessage(error instanceof Error ? error.message : "下載失敗。"); } finally { setBusy(false); }
  }
  async function downloadThree() {
    if (!quickContext) return;
    setBusy(true); setMessage("");
    try {
      for (const universe of ["registered", "labor", "wage"] as ExportUniverse[]) {
        const response = await awsExportFetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "data", universe, ...quickContext, fields: fullFields }) });
        if (!response.ok) throw Error("三母體下載未全部完成，請稍後重試。");
        triggerDownload(`新北青年_${universeLabels[universe]}_${quickContext.year}年.csv`, await response.blob());
      }
      setMessage("三份年度CSV已產生；瀏覽器可能要求允許多檔下載。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "下載失敗。"); } finally { setBusy(false); }
  }
  return <section className="export-workspace" aria-labelledby="export-center-title">
    {!defaultOpen && <button type="button" className="secondary-button" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "收合資料匯出" : "開啟資料匯出"}</button>}
    {open && <>
      <header className="export-workspace-heading"><div><p className="kicker">選資料，再下載</p><h2 id="export-center-title">資料匯出</h2><p>每份檔案保留所選主題的母體、時間、數值身分及來源。</p></div><button type="button" className="secondary-button" disabled={busy} onClick={() => download("codebook")}>下載欄位說明</button></header>
      <ol className="export-steps" aria-label="匯出流程"><li>1 選資料主題</li><li>2 選範圍</li><li>3 選欄位</li><li>4 預覽與下載</li></ol>
      <fieldset className="export-controls" disabled={busy}><legend className="sr-only">匯出設定</legend>
        <section className="export-step-card"><h3>1. 要下載哪一類資料？</h3><div className="export-universe-grid">{Object.entries(exportGroupLabels).map(([group, label]) => <button type="button" key={group} className={topic.group === group ? "is-selected" : ""} aria-pressed={topic.group === group} onClick={() => chooseTopic(exportTopics.find(item => item.group === group)!.id)}>{label}</button>)}</div><label className="export-topic-select">資料主題<select value={topic.id} onChange={event => chooseTopic(event.target.value as ExportTopic)}>{exportTopics.filter(item => item.group === topic.group).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><p className="export-topic-note">{topic.note}</p></section>
        <section className="export-step-card"><h3>2. 要比較哪些範圍？</h3><div className="export-filter-grid">
          <CheckChoices legend={topic.id === "facilities" ? "清冊年度" : "資料年度"} values={topic.id === "facilities" ? [dashboardData.service.snapshotYear] : topic.id === "monthly" ? [...new Set(monthlyPopulationData.records.map(r=>r.year))] : dashboardData.meta.years} selected={selection.years} label={value => value + "年"} onChange={years => update({ years })} />
          {topic.ages ? <CheckChoices legend="年齡" values={dashboardData.meta.ageBands} selected={selection.ages} label={value => ageBandLabel(value as AgeBand)} onChange={ages => update({ ages })} /> : <p className="export-fixed-condition">此主題不按年齡拆分。</p>}
          {topic.sex ? <CheckChoices legend="性別" values={dashboardData.meta.sexes} selected={selection.sexes} label={value => value} onChange={sexes => update({ sexes })} /> : <p className="export-fixed-condition">性別：{topic.ages ? "男女合計" : "不適用"}</p>}
          {topic.region ? <details className="export-region-picker" open={selection.districts.length !== 1 || selection.districts[0] !== "新北市"}><summary>地理範圍：{selection.districts.length === 1 ? selection.districts[0] : `已選${selection.districts.length}個地區`}</summary><CheckChoices legend="全新北市與29行政區" values={districts} selected={selection.districts} label={value => value} onChange={updateDistricts} /></details> : <p className="export-fixed-condition">地理範圍：新北市全市</p>}
        </div><details className="export-small-note"><summary>多選時怎麼分列？</summary><p>各年度、年齡、性別與地區分開列示。18–35歲包含三個子年齡組，全市包含29行政區；合計與子群資料不應重複加總。</p></details></section>
        <section className="export-step-card"><h3>3. 需要哪些欄位？</h3><div className="export-preset-buttons"><button type="button" aria-pressed={preset === "simple"} onClick={() => { setFields(simpleFields); setPreset("simple"); }}>精簡資料</button><button type="button" aria-pressed={preset === "full"} onClick={() => { setFields(fullFields); setPreset("full"); }}>含公式、來源及上下限</button><span>將輸出{visibleFields.length}欄</span></div><details className="field-picker"><summary>自訂輸出欄位</summary><div className="field-groups">{[...new Set(exportCodeBook.map(field => field.group))].map(group => <fieldset key={group}><legend>{group}</legend>{exportCodeBook.filter(field => field.group === group).map(field => <label className="field-option" key={field.fieldCode} title={field.definitionZh}><input type="checkbox" checked={effectiveFields.includes(field.fieldCode)} disabled={locked.includes(field.fieldCode)} onChange={() => { setPreset("custom"); setFields(value => value.includes(field.fieldCode) ? value.filter(code => code !== field.fieldCode) : [...value, field.fieldCode]); }} /><span>{field.fieldNameZh}<small>{locked.includes(field.fieldCode) ? "必要" : field.definitionZh}</small></span></label>)}</fieldset>)}</div></details></section>
      </fieldset>
      <section className="export-step-card export-preview" aria-labelledby="export-preview-title"><div className="section-heading"><div><h3 id="export-preview-title">4. 預覽與下載</h3><p>{topic.label} · {selection.years.join("、")}年 · {selection.ages.map(age => age === "不適用" ? age : ageBandLabel(age as AgeBand)).join("、")} · {selection.sexes.join("、")} · {selection.districts.join("、")}</p></div><button type="button" className="primary-button" onClick={() => download("data")} disabled={busy || !ready}>{busy ? "正在產生檔案…" : "下載這份CSV"}</button></div>
        <p role="status" aria-live="polite">{!valid ? "請在各篩選項目中至少選擇一個條件。" : current ? `符合條件：${current.count}列；有數值${current.available}列，缺值${current.missing}列。` : message || "正在讀取符合條件的資料…"}</p>
        {current && current.count > 0 && <><p className="export-small-note">以下顯示前{current.preview.length}列；下載檔案含全部{current.count}列。缺值保留空白與原因。</p><div className="table-scroll"><table><thead><tr>{visibleFields.map(field => <th key={field.fieldCode}>{field.fieldNameZh}</th>)}</tr></thead><tbody>{current.preview.map((row, index) => <tr key={String(row.record_id ?? index)}>{visibleFields.map(field => <td key={field.fieldCode}>{row[field.fieldCode] == null ? "—" : String(row[field.fieldCode])}</td>)}</tr>)}</tbody></table></div></>}
        {message && <p className="download-message" role="status">{message}</p>}
      </section>
      <details className="export-step-card"><summary>欄位說明 Code Book</summary><label>查詢欄位<input type="search" value={codeBookSearch} onChange={event => setCodeBookSearch(event.target.value)} placeholder="例如：分母、來源、月份" /></label><div className="table-scroll"><table><thead><tr><th>欄位名稱</th><th>代碼</th><th>定義</th></tr></thead><tbody>{exportCodeBook.filter(field => (field.fieldNameZh + field.fieldCode + field.definitionZh).toLowerCase().includes(codeBookSearch.toLowerCase())).map(field => <tr key={field.fieldCode}><th>{field.fieldNameZh}</th><td>{field.fieldCode}</td><td>{field.definitionZh}</td></tr>)}</tbody></table></div></details>
      <details className="export-step-card"><summary>三母體年度快速下載</summary><p>{quickContext ? `使用上方所選範圍：${quickContext.year}年、${ageBandLabel(quickContext.ageBand as AgeBand)}、${quickContext.sex}、${quickContext.district}。` : "請在上方各選一個年度、青年年齡組、性別與地區，再使用三母體快速下載。"}</p><p>另下載戶籍、勞動、薪資各一份完整年度檔，不套用單一主題或精簡欄位。行政區僅套用戶籍；核心勞動及薪資為全新北市、男女合計，勞動檔另含所選性別行業資料。</p><button type="button" className="secondary-button" disabled={busy || !quickContext} onClick={downloadThree}>下載三份年度CSV</button></details>
      <details className="export-small-note"><summary>檔案格式與範圍</summary><p>CSV採UTF-8 BOM，Excel可直接開啟。每次上限15,000列，可分年度或地區下載。服務輔助資料另存，不與戶籍、勞動、薪資母體合併。公式、來源及估計範圍可在欄位選項中加入。</p></details>
    </>}
  </section>;
}

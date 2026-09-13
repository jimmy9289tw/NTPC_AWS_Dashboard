"use client";

import "./policy-narrative.css";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { ageBandLabel, dashboardData } from "./dashboard-data";
import { type PolicySignal } from "./policy-engine";
import { ukPolicyGuidance } from "./policy-source-status";
import { policyChatPrompt, policyNarrativeVersion, policyProposalSource, policyStateLabel, type JointComparison, type PolicyCase, type PolicyContext } from "./policy-narrative";
import { buildPolicyInventory, policySynthesisVersion, type IntegratedPolicyCase } from "./policy-synthesis";

import { NarrativeChart } from "./policy-evidence-chart";
import { programSources, programSourcesVerifiedAt } from "./policy-program-options";
import { policyActionFlow } from "./policy-action-flow";
import { FacilityReferences } from "./policy-facility-references";
import { useModalInteraction } from "./modal-interaction";
export { NarrativeChart } from "./policy-evidence-chart";

function Stage({ code, title, prompt, children }: { code: string; title: string; prompt: string; children: ReactNode }) {
  return <section className={"pn-stage pn-stage-" + code} aria-labelledby={"pn-title-" + code}>
    <header><b aria-hidden="true">{code}</b><div><small>{prompt}</small><h3 id={"pn-title-" + code}>{title}</h3></div></header><div className="pn-stage-body">{children}</div>
  </section>;
}

export function EvidenceDrawer({ policyCase, onClose }: { policyCase: PolicyCase; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useModalInteraction(true, ref, onClose, ref);
  const [focused, setFocused] = useState<{ source: PolicyCase; value: PolicyCase } | null>(null);
  const visibleCase = focused?.source === policyCase ? focused.value : policyCase;
  const chart = visibleCase.chart;
  return <div className="pn-drawer-layer">
    <button type="button" className="pn-drawer-scrim" aria-label="關閉支持證據" onClick={onClose} />
    <aside ref={ref} tabIndex={-1} className="pn-evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="pn-evidence-title">
      <header><div><small>目前議題的支持資料</small><h2 id="pn-evidence-title">{visibleCase.topic}</h2></div><button type="button" onClick={onClose}>關閉</button></header>
      <p className="pn-lead">{visibleCase.headline}</p><NarrativeChart chart={chart} />
      <dl className="pn-facts"><div><dt>母體定義</dt><dd>{chart.universe}；{chart.sex}</dd></div><div><dt>資料年度</dt><dd>{chart.period}</dd></div><div><dt>數值身分</dt><dd>{chart.identity}</dd></div><div><dt>計算方法</dt><dd>{chart.method}</dd></div><div><dt>資料包生成時間</dt><dd>{dashboardData.meta.generatedAt}</dd></div><div><dt>資料來源</dt><dd>{chart.sources.map((item) => <a key={item.url} href={item.url} target="_blank" rel="noreferrer">{item.name}</a>)}</dd></div></dl>
      <RuleDiagram item={policyCase} onOpen={value => setFocused({ source: policyCase, value })} />
    </aside>
  </div>;
}

export function PolicyStatusBoard({ context, cases, selectedId, onSelect }: { context: PolicyContext; cases: IntegratedPolicyCase[]; selectedId?: string; onSelect: (id: string) => void }) {
  const [evidence, setEvidence] = useState<PolicyCase | null>(null);
  const groups = ["優先盤點", "持續監測", "資料待補"];
  return <section className="pn-status-board" aria-label="政策議題分類清單">
    <header><h3>{context.scope === "district" ? context.district + "｜行政區議題清單" : "新北市｜全市議題清單"}</h3><p>{context.year}年 · {ageBandLabel(context.ageBand)} · {context.sex}。點選議題查看方案；展開分類原因查看數值。</p></header>
    <div className="pn-status-grid">{groups.map((group, index) => {
      const items = cases.filter((item) => policyStateLabel(item.state) === group);
      return <section key={group} className={"pn-status-column pn-status-column-" + index + (!items.length ? " is-empty" : "")} aria-label={group}>
        <h4><span aria-hidden="true">{index === 0 ? "!" : index === 1 ? "○" : "?"}</span>{group}<b>{items.length}</b></h4>
        {!items.length ? <p className="pn-list-empty">目前沒有此類議題。</p> : <ul>{items.map((item) => <li key={item.id}>
          <button type="button" aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}><strong>{item.topic}</strong><span>{item.baseline}</span></button>
          <details><summary>分類原因</summary>{item.overviewChart ? <>
            <NarrativeChart chart={item.overviewChart} />
            <button type="button" className="pn-evidence-link" onClick={() => setEvidence({ ...item, chart: item.overviewChart!, headline: `${context.year}年${context.district}、${ageBandLabel(context.ageBand)}、${context.sex}：比較五種教育程度內的四種婚姻占比。` })}>展開交叉圖與計算方式 →</button>
          </> : item.ruleMode !== "any" && <FactLinks item={item} onOpen={setEvidence} compact />}<RuleDiagram item={item} onOpen={setEvidence} /></details>
        </li>)}</ul>}
      </section>;
    })}</div>{evidence && <EvidenceDrawer policyCase={evidence} onClose={() => setEvidence(null)} />}
  </section>;
}


export function RuleDiagram({ item, onOpen }: { item: PolicyCase; onOpen?: (item: PolicyCase) => void }) {
  const steps = item.ruleSteps ?? [{ label: "同口徑資料", observed: item.chart.period + " · " + item.chart.identity, met: item.chart.series.some(s => s.points.some(p => p.value != null)) }, { label: "現行分類條件", observed: item.signal.rule, met: null }];
  const any = item.ruleMode === "any";
  const renderStep = (step: typeof steps[number], index: number) => {
    const fact = item.facts?.find(f => f.id === step.factId);
    return <li key={step.label} className={step.met == null ? "unknown" : step.met ? "met" : "unmet"}>
      <span className="pn-rule-index">{step.supplementary ? "＋" : index + 1}</span>
      <div><strong>{step.label}</strong><p>{step.observed}</p>{fact && onOpen && <button type="button" className="pn-evidence-link" onClick={() => onOpen(factCase(item, fact))}>查看{fact.label}圖表 →</button>}</div>
      <small>{step.met == null ? any ? "— 資料不足" : "—" : step.met ? "✓ 符合" : "○ 未符合"}</small>
    </li>;
  };
  return <figure className={"pn-rule-diagram" + (any ? " pn-rule-any" : "")} aria-label={item.topic + "判斷流程圖"}>
    <figcaption>本次主議題的判斷規則</figcaption>
    {any && <p className="pn-rule-logic">以下三項任一符合 → 優先盤點</p>}
    <ol>{steps.filter(s => !s.supplementary).map(renderStep)}</ol>
    <div className="pn-rule-result"><span aria-hidden="true">↓</span><strong>{policyStateLabel(item.state)}</strong>
      {any && <span>{item.state === "無法判定" ? "當年主要行業占比或集中度資料待補" : steps.some(s => !s.supplementary && s.met) ? "符合條件：" + steps.flatMap((s, i) => !s.supplementary && s.met ? [i + 1] : []).join("、") : steps.some(s => !s.supplementary && s.met == null) ? "可比較項目未達門檻；其他項目待資料更新" : "三項主要條件均未達門檻"}</span>}
    </div>
    {steps.some(s => s.supplementary) && <details className="pn-rule-supplement"><summary>年齡層差距｜補充線索，不單獨列為優先盤點</summary><ol>{steps.filter(s => s.supplementary).map(renderStep)}</ol></details>}
  </figure>;
}
function factCase(item: PolicyCase, fact: NonNullable<PolicyCase["facts"]>[number]): PolicyCase {
  return { ...item, topic: fact.label, headline: fact.comparison, chart: fact.chart, caution: fact.chart.limitation };
}
function FactLinks({ item, onOpen, compact = false }: { item: PolicyCase; onOpen: (item: PolicyCase) => void; compact?: boolean }) {
  return <ul className="pn-fact-links">{item.facts?.length ? item.facts.map(fact => <li key={fact.id}><button type="button" onClick={() => onOpen(factCase(item, fact))}><span><strong>{fact.label}</strong><span className="pn-fact-value">{compact ? fact.statement : fact.comparison}</span></span><span aria-hidden="true">↗</span></button></li>) : <li><button type="button" onClick={() => onOpen(item)}><span>{item.headline}</span><span aria-hidden="true">↗</span></button></li>}</ul>;
}

export function PolicyNarrativeWorkbench({ context, signals, jointComparison = null, jointStatus = "ready", initialCaseId = "", onBack, onOpenChat }: {
  context: PolicyContext; signals: PolicySignal[]; jointComparison?: JointComparison | null; jointStatus?: "loading" | "ready" | "unavailable"; initialCaseId?: string; onBack: () => void; onOpenChat: (question: string) => void;
}) {
  const cases = useMemo(() => buildPolicyInventory(context, signals, jointComparison), [context, signals, jointComparison]);
  const [selectedId, setSelectedId] = useState(() => initialCaseId || cases[0]?.id || "");
  const [programId, setProgramId] = useState("");
  const [selectedFactId, setSelectedFactId] = useState("");
  const [question, setQuestion] = useState("");
  const [drawerCase, setDrawerCase] = useState<PolicyCase | null>(null);
  const selected = cases.find(item => item.id === selectedId) ?? cases[0];
  if (!selected) return <section className="section-shell"><h2>目前條件沒有可用的政策證據</h2><button type="button" onClick={onBack}>修改條件</button></section>;
  const activeFact = selected.facts?.find(f => f.id === selectedFactId) ?? selected.facts?.find(f => f.chart === selected.chart) ?? selected.facts?.[0];
  const displayCase = activeFact ? { ...selected, chart: activeFact.chart, headline: activeFact.comparison } : selected;
  const { mode, programs, program, kpis, timing } = policyActionFlow(context, displayCase, programId);
  const priority = mode === "priority";
  const scope = context.scope === "district" ? context.district : "新北市全市";
  const selectCase = (id: string) => { setSelectedId(id); setSelectedFactId(""); setProgramId(""); setQuestion(""); setDrawerCase(null); };
  const sendQuestion = (text: string) => onOpenChat(policyChatPrompt(context, { ...displayCase, objective: program.outcome }, { ...selected.options[0], id: program.id, title: program.title, action: program.action, timing }, text)
    + "\n本議題狀態：" + policyStateLabel(selected.state) + "；目前安排：" + timing + (priority ? "" : "。備選工具僅供參考，不視為已選定的試辦。")
    + "\n參考活動（只作方案形式參考）:" + program.sourceIds.map(id => programSources[id].url).join("、")
    + "\n跨議題證據:" + cases.map(item => item.headline + "；" + item.chart.period + "；" + item.chart.identity).join("\n")
    + "\n建議追蹤KPI:" + kpis.map(k => k.metric + "：" + k.formula).join("；"));
  const related = context.scope === "district" ? cases : [selected, ...selected.supporting.map(s => cases.find(c => c.id === s.id) ?? ({ ...selected, id: s.id, topic: s.topic, headline: s.finding, chart: s.chart, facts: undefined, ruleMode: undefined, ruleSteps: [{ label: "戶籍結構背景", observed: s.finding, met: null }], state: "持續觀察" as const }))];
  return <div className="pn-workbench policy-roamef-result">
    {context.scope === "district" && jointStatus !== "ready" && <p role="status">{jointStatus === "loading" ? "教育×婚姻交叉資料載入中。" : "教育×婚姻交叉資料暫時無法取得。"}</p>}
    <header className="pn-context"><div><p>{context.scope === "district" ? "行政區建議" : "新北市建議"}</p><h2>{scope}政策研判</h2><span>{context.year}年 · {ageBandLabel(context.ageBand)} · {context.sex}</span></div><button type="button" className="secondary-button" onClick={onBack}>修改條件</button></header>
    <PolicyStatusBoard context={context} cases={cases} selectedId={selected.id} onSelect={selectCase} />
    <section className="pn-issue"><label>本次討論的議題<select value={selected.id} onChange={event => selectCase(event.target.value)}>{cases.map(item => <option key={item.id} value={item.id}>{item.topic} · {policyStateLabel(item.state)}</option>)}</select></label><div><span className={"pn-status " + (selected.state === "已觸發" ? "pn-priority" : "")}>{policyStateLabel(selected.state)}</span><p>{selected.baseline}</p></div></section>
    <div className="pn-evidence-badges"><span>{displayCase.chart.universe}</span><span>{displayCase.chart.sex}</span><span>{displayCase.chart.identity}</span><span>{displayCase.chart.period}</span></div>
    <div className="pn-flow" aria-label="ROAMEF政策研判流程"><div className="pn-pair pn-foundation">
      <Stage code="R" title="問題依據" prompt="數據顯示了什麼？"><h4 className="pn-lead">{displayCase.headline}</h4>{(selected.facts?.length ?? 0) > 1 && <label className="pn-indicator-select">比較指標<select value={activeFact?.id} onChange={event => { setSelectedFactId(event.target.value); setProgramId(""); }}>{selected.facts!.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>}<NarrativeChart chart={displayCase.chart} />{(selected.facts?.length ?? 0) > 4 ? <details className="pn-details"><summary>其他對照指標</summary><FactLinks item={selected} onOpen={setDrawerCase} /></details> : <FactLinks item={selected} onOpen={setDrawerCase} />}<button type="button" className="pn-evidence-link" onClick={() => setDrawerCase(displayCase)}>查看支持證據與計算方式 →</button><details className="pn-details"><summary>本次主議題的判斷規則</summary><RuleDiagram item={selected} onOpen={setDrawerCase} /></details></Stage>
      <Stage code="O" title="政策目標" prompt="希望改善什麼？"><h4 className="pn-lead">{program.outcome}</h4><span className="pn-draft">政策目標草案</span>
        <section className="pn-objective-block"><h4>目前觀察到的數據</h4><FactLinks item={{ ...displayCase, facts: activeFact ? [activeFact] : undefined }} onOpen={setDrawerCase} /><p>{selected.state === "已觸發" ? "本議題符合下列條件，建議啟動方案評估。" : "依下列條件持續檢視本議題。"}</p><RuleDiagram item={selected} onOpen={setDrawerCase} /></section>
        <section className="pn-objective-block"><h4>服務希望改善的結果</h4><p>{program.action}</p><ul className="pn-fact-links">{related.filter(i => i.id !== selected.id).slice(0, 6).map(item => <li key={item.id}><button type="button" onClick={() => setDrawerCase(item)}><span><strong>{item.topic}：</strong>{item.headline}</span><span aria-hidden="true">↗</span></button></li>)}</ul></section>
        <div className="pn-pilot-card"><h4>{priority ? "對象與試辦規模" : "觀察對象與安排"}</h4><p><strong>對象：</strong>{scope}、{ageBandLabel(context.ageBand)}、{context.sex}，有相關需求且自願參與的青年。</p>{priority ? <p><strong>試辦草案：</strong>初步建議6個月並試辦2場次，實際試辦名額與舉辦期間將另訂。</p> : <p>{mode === "missing" ? "先取得同條件比較資料，再評估適合的做法。" : "依既有服務及資料更新週期檢視；目前不設定新增試辦場次。"}</p>}</div>
      </Stage>
    </div><p className="pn-connection"><span aria-hidden="true">↓</span>把問題與目標，轉成可執行的服務</p><div className="pn-pair">
      <Stage code="A" title={priority ? "方案比較" : mode === "missing" ? "資料整理安排" : "現行措施與備選工具"} prompt="可以採取哪些做法？"><div className="pn-synthesis"><h4>綜合判讀</h4><p>以{selected.topic}為主軸，搭配以下資料比較服務安排。</p><div className="pn-evidence-topics">{related.map(item => <article key={item.id}><button type="button" className="pn-evidence-link" onClick={() => setDrawerCase(item)}><strong>{item.topic}</strong>｜{item.facts?.[0]?.statement ?? item.headline} ↗</button>{(item.facts?.length ?? 0) > 1 && <details className="pn-details"><summary>更多{item.topic}比較指標</summary><FactLinks item={item} onOpen={setDrawerCase} /></details>}</article>)}</div></div>
        <p className="pn-lead">{program.action}</p>{priority ? <fieldset className="pn-options"><legend>四種可比較的做法｜點選後同步更新目標與追蹤指標</legend>{programs.map(p => <label key={p.id} className={program.id === p.id ? "is-selected" : ""}><span><input type="radio" name="policy-program" checked={program.id === p.id} onChange={() => setProgramId(p.id)} /><strong>{p.title}</strong></span><small className="pn-program-mechanism">{p.mechanism}</small><p>{p.outcome}</p><p><strong>適用需求：</strong>{p.suitableFor}</p></label>)}</fieldset> : mode === "monitor" ? <details className="pn-details"><summary>可參考的工具｜尚未選為本次方案</summary><p>以下依議題列出參考做法；目前安排仍為維持現行措施。</p>{programs.map(p => <article key={p.id} className="pn-reference-option"><h4>{p.title}</h4><p>{p.outcome}</p><p>適用需求：{p.suitableFor}</p>{p.sourceIds.map(id => <a key={id} href={programSources[id].url} target="_blank" rel="noreferrer">{programSources[id].title} ↗</a>)}</article>)}</details> : <ul className="pn-monitoring">{selected.missing.filter(text => !/預算|核定/.test(text)).map(text => <li key={text}>{text}</li>)}</ul>}
        {priority && <section className="pn-program-references"><h4>官方案例與可參考做法</h4>{program.sourceIds.map(id => { const source = programSources[id]; return <article key={id}><small>{source.agency} · {source.period}</small><h4><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></h4><p>{source.description}</p><p><strong>可參考：</strong>{source.adaptation}</p></article>; })}</section>}
      </Stage>
      {priority ? <Stage code="M" title="執行與追蹤" prompt="誰負責，記錄哪些資料？"><div aria-live="polite"><h4 className="pn-lead">{program.title}</h4><p className="pn-owner">{program.agencies}</p></div><ol className="pn-timeline"><li><strong>第1–2個月｜規劃與招募</strong><span>確認場地與合作單位，登記活動偏好、報名人數及可參加時段。</span></li><li><strong>第3–5個月｜試辦2場</strong><span>記錄各場報名、簽到、服務主題與回饋；依首場結果調整第二場內容。</span></li><li><strong>第6個月｜彙整與追蹤</strong><span>比較兩場的到場與回饋，追蹤{program.metric}。</span></li></ol>
        <details className="pn-details"><summary>{program.title}｜執行準備與取捨</summary><p>{program.preparation}</p><p>搭配左側官方案例，整理場地、合作單位與執行方式。</p></details>
        <FacilityReferences district={context.scope === "district" ? context.district : "新北市"} />
        <ul className="pn-monitoring">{kpis.map(k => <li key={k.metric}><strong>{k.metric}</strong><span>{k.frequency} · {k.source}</span></li>)}</ul><details className="pn-details"><summary>指標算法與紀錄欄位</summary>{kpis.map(k => <section key={k.metric}><h4>{k.metric}</h4><p>{k.formula}</p><p>紀錄來源：{k.source}。</p></section>)}<p>比率分母為0時顯示「無有效分母」。政府資料每日審視更新；活動紀錄依上述頻率彙整。</p></details>
      </Stage> : <Stage code="M" title="執行與追蹤" prompt="誰負責，記錄哪些資料？"><h4 className="pn-lead">{program.title}</h4><p className="pn-owner">{program.agencies}</p><ul className="pn-monitoring">{kpis.map(k => <li key={k.metric}><strong>{k.metric}</strong><span>{k.frequency} · {k.source}</span><p>{k.formula}</p></li>)}</ul><FacilityReferences district={context.scope === "district" ? context.district : "新北市"} /></Stage>}
    </div><p className="pn-connection"><span aria-hidden="true">↓</span>比較參與與回饋，決定下一輪服務</p><div className="pn-pair pn-outcomes">
      {priority ? <Stage code="E" title="成效評估" prompt="用哪些結果比較做法？"><h4 className="pn-lead">建議成效評估之KPI</h4><p>以兩場試辦的到場、滿意度及「{program.metric}」比較活動安排。</p><ul className="pn-monitoring">{[kpis[0], kpis[3], kpis[4]].map(k => <li key={k.metric}><strong>{k.metric}</strong><span>{k.formula}</span></li>)}</ul><details className="pn-details"><summary>建議比較方式</summary><ul><li>分列第一場與第二場的分子、分母及比率。</li><li>按年齡、性別與自選服務主題比較參與情形。</li><li>採相同問卷題目與追蹤期間，保留改善意見。</li></ul><p>上述為本計畫建議評估設計，參考官方案例的服務形式；目標值由承辦另訂。</p></details></Stage> : <Stage code="E" title="成效評估" prompt="下次要比較什麼？"><h4 className="pn-lead">{mode === "missing" ? "檢查新增資料是否可比較" : "比較年度訊號與既有服務紀錄"}</h4><ul className="pn-monitoring">{kpis.map(k => <li key={k.metric}><strong>{k.metric}</strong><span>{k.formula}</span></li>)}</ul></Stage>}
      {priority ? <Stage code="F" title="後續決定" prompt="下一輪如何安排？"><ul className="pn-feedback"><li><strong>續辦</strong><span>到場與滿意度達預定目標，延續表現較好的活動形式。</span></li><li><strong>調整</strong><span>依未到場原因、參與偏好與回饋，修改地點、時段或內容。</span></li><li><strong>改採其他方式</strong><span>比較線上諮詢、共用空間或不同活動形式的參與結果。</span></li></ul><details className="pn-details"><summary>未來可整理之資訊</summary><ul><li>青年自選的服務主題、活動偏好與可參加時段。</li><li>各場報名、簽到、性別組成與重複參與情形。</li><li>{program.metric}、滿意度與改善意見。</li><li>場地交通時間、合作單位與服務成本。</li></ul></details></Stage> : <Stage code="F" title="後續決定" prompt="下一輪如何安排？"><ul className="pn-feedback"><li><strong>更新資料</strong><span>{mode === "missing" ? "補齊同條件資料後，重新計算並分類。" : "按相同年度、年齡與性別口徑重新比較。"}</span></li><li><strong>重新檢視分類</strong><span>符合本議題的優先條件時，再比較可調整的措施；其餘持續追蹤。</span></li></ul></Stage>}
    </div></div>
    <section className="pn-ai" aria-labelledby="pn-ai-title"><h2 id="pn-ai-title">AI問政策證據</h2><p>目前議題：{selected.topic} · {program.title}</p><form onSubmit={event => { event.preventDefault(); sendQuestion(question.trim() || "請用目前的實際數據說明這項方案可以怎麼安排。"); }}><label htmlFor="pn-question">想進一步了解什麼？</label><textarea id="pn-question" value={question} onChange={event => setQuestion(event.target.value)} rows={2} placeholder={priority ? "例如：兩場活動可以怎麼安排？要記錄哪些數據？" : "例如：為什麼是持續監測？下次要比較哪些資料？"} /><button type="submit" className="primary-button">送到AI問答</button></form><div className="pn-prompts">{["這個數據和誰比較？", "可以參考哪些活動做法？", priority ? "如何檢查試辦是否有效？" : "什麼變化會改列優先盤點？"].map(prompt => <button key={prompt} type="button" onClick={() => sendQuestion(prompt)}>{prompt}</button>)}</div></section>
    <details className="pn-method"><summary>方法、來源與版本</summary><RuleDiagram item={selected} onOpen={setDrawerCase} /><p>政策敘事版：{policyNarrativeVersion}；資料版：{dashboardData.meta.version}；服務資料版：{dashboardData.meta.externalDataVersion}。資料包生成：{dashboardData.meta.generatedAt}。</p><p>方案流程參考：{policyProposalSource}。官方活動連結核對日期：{programSourcesVerifiedAt}。</p><div className="uk-guidance-links">{ukPolicyGuidance.map(item => <a key={item.name} href={item.url} target="_blank" rel="noreferrer">{item.name}</a>)}</div></details>
    <p className="pn-version-note">{policySynthesisVersion}</p>{drawerCase && <EvidenceDrawer policyCase={drawerCase} onClose={() => setDrawerCase(null)} />}
  </div>;
}

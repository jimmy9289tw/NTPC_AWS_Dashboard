"use client";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import raw from './data/lsf-evidence.json';
import { domainEvidence, externalValue, populationEvidence, round2, lsfRules, type LsfContext, type LsfSnapshot } from './lsf-engine';
import { type AgeBand, type Sex } from './dashboard-data';
import { ChartCanvas } from './chart-canvas';
import { useChartTransition, chartMotionKey } from './chart-transition';
import { QuadrantPointTooltip } from './quadrant-chart-primitives';
import { useModalInteraction } from './modal-interaction';
import './lsf-workbench.css';

const data=raw as unknown as LsfSnapshot;
const fmt=(n:number|null|undefined,d=2)=>n==null?'尚無資料':n.toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d});
type PlotRow={label:string;values:(number|null)[];lows?:(number|null)[];highs?:(number|null)[]};
function EvidencePlot({title,rows:inputRows,series,unit,line=false}:{title:string;rows:PlotRow[];series:string[];unit:string;line?:boolean}) {
  const rows=inputRows.map(r=>({...r,values:r.values.slice(0,series.length),lows:r.lows?.slice(0,series.length),highs:r.highs?.slice(0,series.length)}));
  const [tip,setTip]=useState<{x:number;y:number;label:string;value:number}|null>(null);
  const signature=chartMotionKey(title,rows);
  const motion=useChartTransition<HTMLDivElement>(signature,true);
  useEffect(()=>setTip(null),[signature]);
  const values=rows.flatMap(r=>[...r.values,...(r.highs??[])]).filter((v):v is number=>v!==null),max=Math.ceil(Math.max(1,...values)*1.14/5)*5;
  const w=620,h=290,left=68,right=22,top=34,bottom=64,pw=w-left-right,ph=h-top-bottom;
  const x=(i:number)=>left+pw*(i+.5)/Math.max(1,rows.length),y=(v:number)=>top+ph*(1-v/max),colors=['#2563EB','#0F766E','#B45309'];
  return <div className="lsf-plot"><h4>{title}</h4><p className="lsf-caption">單位：{unit}</p><ChartCanvas ref={motion}>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title}>
      {[0,1,2,3,4].map(t=><g key={t}><line x1={left} x2={w-right} y1={y(max*t/4)} y2={y(max*t/4)} stroke="#D9E2EC" strokeDasharray="3 4"/><text x={left-9} y={y(max*t/4)+5} textAnchor="end" fontSize="14" fill="#475F70">{fmt(max*t/4,1)}</text></g>)}
      <line className="axis-line" x1={left} x2={left} y1={top} y2={h-bottom} stroke="#475F70"/>
      {line&&series.map((s,j)=>{
        // Missing observations split the path rather than connecting across a gap.
        let open=false;const path=rows.map((r,i)=>{const v=r.values[j];if(v==null){open=false;return '';}const p=`${open?'L':'M'}${x(i)},${y(v)}`;open=true;return p;}).join(' ');
        return <path key={s} data-motion-key={`series-${j}`} d={path} fill="none" stroke={colors[j]} strokeWidth="3"/>;
      })}
      {rows.map((r,i)=><g key={r.label}><text x={x(i)} y={h-bottom+27} textAnchor="middle" fontSize="14" fill="#19324A">{r.label}</text>{r.values.map((v,j)=>{
        if(v==null)return null;
        const bw=Math.min(42,pw/rows.length/(series.length+1)),cx=line?x(i):x(i)+(j-(series.length-1)/2)*bw;
        const label=`${r.label} ${series[j]} ${fmt(v)}${unit}`;
        const attrs={tabIndex:0,role:'button',"aria-label":label,onMouseEnter:()=>setTip({x:cx,y:y(v),label:r.label+' '+series[j],value:v}),onMouseLeave:()=>setTip(null),onFocus:()=>setTip({x:cx,y:y(v),label:r.label+' '+series[j],value:v}),onBlur:()=>setTip(null),onClick:()=>setTip({x:cx,y:y(v),label:r.label+' '+series[j],value:v}),onKeyDown:(e:KeyboardEvent)=>{if(e.key==='Escape')setTip(null);},fill:colors[j],"data-motion-key":`mark-${i}-${j}`};
        const lo=r.lows?.[j],hi=r.highs?.[j];
        return line?<circle key={j} {...attrs} cx={cx} cy={y(v)} r="6" stroke="white" strokeWidth="2"/>:<g key={j}><rect {...attrs} x={cx-bw*.45} y={y(v)} width={bw*.9} height={h-bottom-y(v)} rx="3"/>{lo!=null&&hi!=null&&<g stroke="#475569" strokeWidth="2" pointerEvents="none"><line data-motion-key={`range-${i}-${j}`} x1={cx} x2={cx} y1={y(lo)} y2={y(hi)}/><line data-motion-key={`low-${i}-${j}`} x1={cx-5} x2={cx+5} y1={y(lo)} y2={y(lo)}/><line data-motion-key={`high-${i}-${j}`} x1={cx-5} x2={cx+5} y1={y(hi)} y2={y(hi)}/></g>}</g>;
      })}</g>)}
    </svg>
    {tip&&<QuadrantPointTooltip x={tip.x} y={tip.y} width={w} height={h} title={tip.label} identity={unit}>{fmt(tip.value)} {unit}</QuadrantPointTooltip>}
  </ChartCanvas><div className="lsf-legend">{series.map((s,i)=><span key={s}><i style={{background:colors[i]}}/>{s}</span>)}</div>
  <details><summary>查看圖表資料表</summary><div className="lsf-table-wrap"><table><thead><tr><th>比較項目</th>{series.map(s=><th key={s}>{s}（{unit}）</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.label}><th>{r.label}</th>{r.values.map((v,i)=><td key={i}>{fmt(v)}{r.lows?.[i]!=null&&r.highs?.[i]!=null&&<small style={{display:'block'}}>範圍 {fmt(r.lows[i])}–{fmt(r.highs[i])}</small>}</td>)}</tr>)}</tbody></table></div></details></div>;
}

export function LsfWorkbench() {
  const [context,setContext]=useState<LsfContext>({geography:'新北市淡水區',year:114,ageBand:'18-35',sex:'合計'});
  const [domain,setDomain]=useState('family'),[drawer,setDrawer]=useState(false);
  const modal=useRef<HTMLElement>(null);useModalInteraction(drawer,modal,()=>setDrawer(false));
  const pop=useMemo(()=>populationEvidence(data,context),[context]);
  const evidence=domainEvidence(data,context,domain);
  const domains=lsfRules.domains.map(rule=>domainEvidence(data,context,rule.id));
  const localBase=pop.local[0]?.population, cityBase=pop.city.find(r=>r.year===pop.local[0]?.year)?.population;
  const rows=pop.local.map(r=>{const cityValue=pop.city.find(c=>c.year===r.year)?.population;return {label:`${r.year}年`,values:[localBase?round2(r.population/localBase*100):null,cityBase&&cityValue!=null?round2(cityValue/cityBase*100):null]};});
  const n=externalValue(data,context,'NET_MIGRATION'),natural=externalValue(data,context,'NATURAL_CHANGE');
  const label=context.geography.replace(/^新北市(?=.+區)/,'');
  const update=(part:Partial<LsfContext>)=>{setDrawer(false);setContext(c=>({...c,...part}));};
  function structureChart(kind:'marriage'|'education',title:string) {
    const order=kind==='marriage'?['未婚','有偶','離婚或終止結婚','喪偶']:['國中及以下','高中職','專科','大學','研究所'];
    if(!pop.current)return null;
    return <><EvidencePlot title={title} unit="%" series={context.geography==='新北市'?['新北市']:[label,'新北市']} rows={Object.entries(pop.current[kind]).sort(([a],[b])=>order.indexOf(a)-order.indexOf(b)).map(([name,m])=>{const city=pop.city.find(r=>r.year===context.year)?.[kind][name];return {label:name,values:[round2(m.value),city?round2(city.value):null],lows:[m.low,city?.low??null],highs:[m.high,city?.high??null]};})}/><p className="lsf-caption">{context.year}年 · {context.ageBand}歲 · {context.sex} · {Object.values(pop.current[kind])[0]?.origin}。灰線為原資料方法範圍，數值可展開資料表查看。</p></>;
  }
  function renderDetailCharts() {
    if(domain==='family') return <>
      {structureChart('marriage','所選戶籍青年的婚姻結構')}
      {evidence.birth.length>0&&<EvidencePlot title="粗出生率的變化" unit="‰" series={context.geography==='新北市'?['新北市']:[label,'新北市']} rows={evidence.birth.map(r=>({label:`${r.roc_year}年`,values:[Number(r.value),externalValue(data,{...context,geography:'新北市',year:Number(r.roc_year)},'CRUDE_BIRTH_RATE')]}))}/>}
      {n!==null&&natural!==null&&<div className="lsf-composition"><h4>{context.year}年全年齡人口增減構成</h4><p>遷入減遷出 <strong>{fmt(n,0)} 人</strong></p><p>出生減死亡 <strong>{fmt(natural,0)} 人</strong></p><p>兩者合計 <strong>{fmt(n+natural,0)} 人</strong></p><small>這是全年齡戶籍變化，不能當成所選青年年齡的遷徙人數。</small></div>}
      {!evidence.birth.length&&<p>{context.year}年尚未納入所選地區的出生率資料。</p>}
    </>;
    if(domain==='housing') {
      const rentRows=data.external.filter(r=>r.geography_name_zh===context.geography&&r.metric_code==='RENT_MEDIAN');
      return <><p className="lsf-notice">{data.rentPeriod}單期背景。年齡及性別篩選不適用此租約樣本。</p>{rentRows.length>0?<EvidencePlot title="不同租屋型態的月租金中位數" unit="元／月" series={['有效租約中位數']} rows={rentRows.map(r=>({label:r.category_name_zh==='分租套（雅）房'?'分租房':String(r.category_name_zh),values:[r.value===''?null:Number(r.value)]}))}/>:<p>目前只有各區租金分位數；不以29區中位數的平均數代替全市中位數。</p>}<p>官方僅揭露至少40筆契約的統計。第25、50、75百分位數可在來源資料表查閱；這是租金分布，不是估計上下限。</p></>;
    }
    if(domain==='services') return <><p>{data.service.snapshotYear}年青年據點快照，非{context.year}年服務覆蓋率。</p>{evidence.localFacilities.length?evidence.localFacilities.map(f=><article className="lsf-facility" key={f.facilityCode}><a href={f.sourceUrl} target="_blank" rel="noreferrer">{f.name} ↗</a><p>{f.address}</p><p>{f.active?'營運中':'尚未營運'} · {f.capacitySummary||'未提供容量'}</p></article>):<p>名錄未列出{label}的青年據點。另需查鄰區、線上及其他局處服務。</p>}</>;
    if(domain==='career'&&pop.current) return <>{structureChart('education','戶籍青年的教育結構')}{context.geography==='新北市'&&context.sex==='合計'&&<><EvidencePlot title="居民青年就業與勞動參與" unit="%" series={['就業人口比率','勞動力參與率']} line rows={data.labor.filter(r=>r.ageBand===context.ageBand&&r.year<=context.year).map(r=>({label:`${r.year}年`,values:[r.metrics['就業人口比率'],r.metrics['勞動力參與率']]}))}/><p>官方調查再作青年年齡模型估計；分母為民間人口。</p><EvidencePlot title="工作場所青年薪資" unit="萬元／年" series={['全年平均數','全年中位數']} rows={[110,111,112,113,114].filter(y=>y<=context.year).map(y=>{const r=data.wage.find(r=>r.ageBand===context.ageBand&&r.year===y);return {label:`${y}年`,values:[r?.metrics['全年總薪資平均數']??null,r?.metrics['全年總薪資中位數']??null],lows:[r?.meta['全年總薪資平均數']?.low??null,r?.meta['全年總薪資中位數']?.low??null],highs:[r?.meta['全年總薪資平均數']?.high??null,r?.meta['全年總薪資中位數']?.high??null]};})}/><p>25–29歲原生值及其他年齡模型值沿用原資料；114年尚無青年值。此母體是新北市工作場所受僱員工，不是設籍青年所得。</p></>}{context.geography==='新北市'&&<p>行業最高占比的數字見上方線索；完整行業結構與其方法範圍保留於既有行業頁及資料包。</p>}</>;
    return <div className="lsf-empty"><h4>下一次應接入的證據</h4><ul>{evidence.rule.requiredMetrics.map(s=><li key={s}>{s}</li>)}</ul><p>目前尚無可用數值，不繪製空值長條或示範數據。</p></div>;
  }
  return <section className="lsf-workbench" aria-label="生活條件與證據分流">
    <header className="lsf-heading"><div><p className="lsf-kicker">生活條件與證據分流</p><h2>人口變了，接下來看什麼？</h2><p>先辨認變化，再從生活條件找支持或相反的線索。</p></div><span className="lsf-version">LSF 原型 V1<br/>資料查核 2026/09/12</span></header>
    <div className="lsf-controls">
      <label>分析範圍<select value={context.geography} onChange={e=>update({geography:e.target.value})}>{data.geographies.map(g=><option key={g.code}>{g.name}</option>)}</select></label>
      <label>戶籍資料年度<select value={context.year} onChange={e=>update({year:Number(e.target.value)})}>{[110,111,112,113,114].map(y=><option key={y} value={y}>{y}年</option>)}</select></label>
      <label>青年年齡<select value={context.ageBand} onChange={e=>update({ageBand:e.target.value as AgeBand})}>{['18-35','18-24','25-29','30-35'].map(a=><option key={a} value={a}>{a}歲</option>)}</select></label>
      <label>青年性別<select value={context.sex} onChange={e=>update({sex:e.target.value as Sex})}>{['合計','男','女'].map(s=><option key={s}>{s}</option>)}</select></label>
    </div>
    <div className="lsf-step-title"><span>起點</span><h3>{label}的青年人口變化</h3></div>
    <div className="lsf-kpis"><article><small>年底戶籍青年</small><strong>{fmt(pop.current?.population,0)}<em>人</em></strong></article><article><small>與前一年度相比</small><strong>{fmt(pop.rate)}<em>%</em></strong><span>{pop.direction}</span></article><article><small>{context.geography==='新北市'?'與前一年人口數之差':'同條件全市年增率'}</small><strong>{context.geography==='新北市'?fmt(pop.current&&pop.previous?pop.current.population-pop.previous.population:null,0):fmt(pop.cityRate)}<em>{context.geography==='新北市'?'人':'%'}</em></strong></article><article><small>{context.geography==='新北市'?'自110年至所選年度變動':'與全市年增率之差'}</small><strong>{fmt(context.geography==='新北市'?pop.window:pop.gap)}<em>{context.geography==='新北市'?'%':'個百分點'}</em></strong></article></div>
    <div className="lsf-start-grid"><EvidencePlot title="青年人口五年變化（基期＝100）" rows={rows} series={context.geography==='新北市'?['新北市']:[label,'新北市']} unit="指數" line/><aside className="lsf-context"><h4>這一輪要分清楚</h4><p>{pop.rate===null?'尚無前一年資料，先看當年人口結構。':context.geography==='新北市'?`新北市青年人口年增率 ${fmt(pop.rate)}%。接著區分生命階段，再看生活條件。`:`${label}${pop.direction}，年增率與全市相差 ${fmt(pop.gap)} 個百分點。`}</p><p>{pop.window!==null?`從${pop.local[0]?.year}年至${context.year}年，所選青年人口變動 ${fmt(pop.window)}%。`:''}</p>{pop.restRate!==null&&<p>排除{label}後，其他28區同條件合計年增率為 {fmt(pop.restRate)}%。</p>}<details><summary>篩選與比較方式</summary><p>年齡與性別只改變青年人口及教育結構。出生、遷徙、租約與據點各依原來的母體及期間，不跟著變成年輕族群資料。</p><p>圖中基期為{pop.local[0]?.year}年，各地人口分別除以自己的基期人口乘100。</p></details></aside></div>
    <div className="lsf-step-title"><span>第一輪</span><h3>哪個生活面向值得往下查？</h3></div>
    <div className="lsf-domains">{domains.map(e=><button type="button" key={e.rule.id} aria-pressed={domain===e.rule.id} onClick={()=>setDomain(e.rule.id)}><span className="lsf-status">{e.status}</span><h4>{e.rule.label}</h4><p>{e.rule.question}</p><small>{e.facts[0]||e.next}</small><span className="lsf-card-action">查看這條證據支線 →</span></button>)}</div>
    <div className="lsf-step-title"><span>第二輪</span><h3>{evidence.rule.label}：把問題問得更具體</h3></div>
    <div className="lsf-detail-grid"><article className="lsf-evidence"><h4>已看到的線索</h4><ul>{evidence.facts.map(f=><li key={f}>{f}</li>)}</ul><button type="button" className="lsf-primary" onClick={()=>setDrawer(true)}>查看支持證據與來源</button>{renderDetailCharts()}</article>
      <ol className="lsf-flow" aria-label="第二輪證據判斷流程"><li><span>01</span><h4>先確認比較對象</h4><p>{evidence.rule.comparison}</p></li><li><span>02</span><h4>{evidence.stage2}</h4><p>{evidence.next}</p></li><li><span>03</span><h4>資料補上後，看哪個群體遇到什麼事</h4><p>{evidence.rule.round2}</p><details><summary>所需資料與相反線索</summary><ul>{evidence.rule.requiredMetrics.map(m=><li key={m}>{m}</li>)}</ul><p>{evidence.rule.counterBranch}</p></details></li><li><span>04</span><h4>可延伸的研究方向</h4><p>{evidence.rule.allowedConclusion}</p><small>待需求與負擔證據相符，再進入既有 ROAMEF 比較具體方案。</small></li></ol></div>
    <details className="lsf-method"><summary>方法、來源、完整分流規則與資料缺口</summary><p><a href="https://lsfdashboard.treasury.govt.nz/wellbeing/" target="_blank" rel="noreferrer">紐西蘭財政部 LSF Dashboard ↗</a>提供多面向及群體比較的參考。本頁規則為新北市資料的在地化研究設計，不是LSF官方評分。</p><p>沒有將不同母體拼成個人福祉分數，也沒有以人口規模自動核定資源。</p><p><a href={data.sourceYearbook.url} target="_blank" rel="noreferrer">新北市民政局114年統計年報（表11、表13）↗</a>；<a href="https://moisagis.moi.gov.tw/rent/index.html" target="_blank" rel="noreferrer">內政部租金查詢系統 ↗</a>。</p><p>資料版：{data.version}；分流規則：{lsfRules.version}。完整CSV與Code Book位於新版資料包。</p><p>交通、用電、幼兒人口、等候與實際服務負擔尚未接入。本頁不因資料缺口輸出具體新增設施建議。</p></details>
    {drawer&&<div className="lsf-scrim" onClick={()=>setDrawer(false)}><aside ref={modal} className="lsf-drawer" role="dialog" aria-modal="true" aria-label={`${evidence.rule.label}支持證據`} tabIndex={-1} onClick={e=>e.stopPropagation()}><button className="lsf-close" type="button" onClick={()=>setDrawer(false)}>關閉 ×</button><h3>{evidence.rule.label}支持證據</h3><p>{label} · {context.year}年 · {context.ageBand}歲 · {context.sex}</p>{renderDetailCharts()}<details open><summary>資料來源及定義</summary><p>{evidence.rule.comparison}</p><p>不可由此推論：{evidence.rule.forbiddenConclusion}。</p><p>查核日期2026/09/12。來源實際統計期間以各圖說明為準。</p><a href={domain==='housing'?'https://moisagis.moi.gov.tw/rent/index.html':domain==='career'?'https://data.gov.tw/dataset/117988':domain==='services'?'https://www.youth.ntpc.gov.tw/youth/ch/app/folder/59':data.sourceYearbook.url} target="_blank" rel="noreferrer">官方資料入口 ↗</a></details></aside></div>}
  </section>;
}

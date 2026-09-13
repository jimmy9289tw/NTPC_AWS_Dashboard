import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {dashboardData as data} from './dashboard-data';
import type {analyzeRoa,RoaSelection} from './aws-roa-analysis';
import type {RoaDirection} from './aws-roa-directions';
import {buildRoaCharts} from './aws-roa-evidence';
import {NarrativeChart} from './policy-evidence-chart';

export function RoaEvidenceDrawer({selection,rule,analysis,joint,direction,initial,onClose}:{selection:RoaSelection;rule:any;analysis:ReturnType<typeof analyzeRoa>;joint:Record<string,any>;direction:RoaDirection|null;initial:'both'|'x'|'y';onClose:()=>void}){
  const [axis,setAxis]=useState(initial),[cross,setCross]=useState(0);
  const root=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null);
  const charts=buildRoaCharts(selection,rule,analysis,joint);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
    const siblings=[...document.body.children].filter(el=>el!==root.current) as HTMLElement[];
    const inert=siblings.map(el=>el.inert);siblings.forEach(el=>el.inert=true);
    document.body.style.overflow='hidden';close.current?.focus();
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();return;}
      if(e.key!=='Tab')return;
      const targets=[...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select,summary,[tabindex="0"]')].filter(el=>el.getClientRects().length>0);
      const first=targets[0],last=targets.at(-1);
      if(e.shiftKey&&(document.activeElement===first||!root.current?.contains(document.activeElement))){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('keydown',key,true);document.body.style.overflow=overflow;siblings.forEach((el,i)=>el.inert=inert[i]);if(previous?.isConnected)previous.focus()};
  },[onClose]);
  const facilities=data.service.facilities.filter(f=>selection.scope==='city'||f.district===selection.place);
  return createPortal(<div ref={root} className="roa-evidence-layer"><div className="roa-evidence-backdrop" onClick={onClose}/><section className="roa-evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="roa-evidence-title">
    <header><div><p>本次位置的支持證據</p><h2 id="roa-evidence-title">{rule.name} · {selection.place}</h2><small>{selection.year}年 · {charts.scope}</small></div><button ref={close} onClick={onClose}>關閉</button></header>
    <div className="roa-evidence-body">
      <p className="roa-evidence-status">{analysis.classification.status==='stable'?'兩軸皆可確定：下方呈現本次分級使用的值。':analysis.classification.status==='boundary'?'點估計可查看；部分估計範圍跨過門檻，尚無單一象限。':'以下保留已有的值；缺少的比較不填0，也不補作分級。'}</p>
      {!!analysis.reasons.length&&<ul>{analysis.reasons.map((r,i)=><li key={i}>{r.axis} 軸：{r.text}</li>)}</ul>}
      <div className="roa-evidence-tabs" aria-label="選擇支持證據">{(['both','x','y'] as const).map(k=><button key={k} aria-pressed={axis===k} onClick={()=>setAxis(k)}>{k==='both'?'X 與 Y 一起看':`${k.toUpperCase()} 軸依據`}</button>)}</div>
      {(['x','y'] as const).filter(k=>axis==='both'||axis===k).map(k=>{const reading=analysis.classification.axes[k],chart=charts[k];return <section key={k} className="roa-evidence-section"><h3>{k.toUpperCase()} 軸：{rule[k].label}</h3><p><b>判斷條件：</b>{rule[k].condition}。</p><p><b>目前數值：</b>{reading.value?`${reading.value.value.toLocaleString('zh-TW',{maximumFractionDigits:2})}${rule[k].unit}`:'尚無同口徑資料'}{reading.reference?`；比較門檻 ${reading.reference.value.toLocaleString('zh-TW',{maximumFractionDigits:2})}${rule[k].unit}`:''}。</p>
        {selection.topic==='service_sites'&&k==='y'?<p>目前只有{data.service.snapshotYear}年青年據點名冊，位置與連結列於下方，未代入{selection.year}年。</p>:<NarrativeChart chart={chart}/>}
        <details><summary>計算方式與資料來源</summary><p>{chart.method}</p><p>母體：{chart.universe}。數值身分：{chart.identity}。</p><ul>{chart.sources.map(src=><li key={src.url}><a href={src.url} target="_blank" rel="noreferrer">{src.name} ↗</a></li>)}</ul></details>
      </section>})}
      <section className="roa-evidence-section"><h3>還能交叉看什麼？</h3><p>先看同一地區的年齡、教育及婚姻組成；每張圖保留自己的母體與年度。</p><label>選擇補充面向<select value={cross} onChange={e=>setCross(Number(e.target.value))}>{charts.cross.map((c,i)=><option key={c.title} value={i}>{c.title}</option>)}</select></label><p>{charts.cross[cross].universe}</p><NarrativeChart chart={charts.cross[cross]}/></section>
      <section className="roa-evidence-section"><h3>已有什麼基礎，可以往哪裡走？</h3>{direction?<><h4>{direction.title}</h4><p><b>待確認的問題：</b>{direction.question}</p><p><b>可研擬方向：</b>{direction.action}</p><details><summary>地方資料與既有政策參考</summary>{direction.evidence.map((e,i)=><article key={i}><p>{e.text}</p><small>{e.period} · {e.url?<a href={e.url} target="_blank" rel="noreferrer">{e.source} ↗</a>:e.source}</small></article>)}</details><p>{direction.followup}</p></>:<p>先從上方可用的歷年資料及族群結構確認變化；取得同口徑比較後，再選擇服務內容或投入方向。</p>}</section>
      <details className="roa-evidence-section"><summary>青年據點｜地點與官方資訊</summary><p>{data.service.snapshotYear}年名冊快照，不代表所選年度的據點數。</p>{facilities.length?facilities.map(f=><article key={f.facilityCode}><a href={f.sourceUrl} target="_blank" rel="noreferrer">{f.name} ↗</a><p>{f.address} · {f.operatingStatus}</p></article>):<p>此份名冊未列{selection.place}據點。</p>}</details>
    </div>
  </section></div>,document.body);
}

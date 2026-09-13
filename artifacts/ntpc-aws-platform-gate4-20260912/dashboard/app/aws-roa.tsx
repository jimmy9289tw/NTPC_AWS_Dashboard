import {useCallback,useEffect,useState} from 'react';
import {RoaEvidenceDrawer} from './aws-roa-evidence-drawer';
import {buildRoaCharts} from './aws-roa-evidence';
import {NarrativeChart} from './policy-evidence-chart';
import './policy-narrative.css';
import {dashboardData as data,geographyLabel,ageBandLabel,type AgeBand,type Sex} from './dashboard-data';
import {analyzeRoa,type RoaSelection} from './aws-roa-analysis';
import {buildRoaDirection,type RoaContext} from './aws-roa-directions';
import {RoaQuadrants} from './aws-roa-quadrants';
import type {AxisReading} from './aws-roa-model';
import {selectDistrictFeatures,type DistrictFeature} from './aws-region-map';

const education=['國中及以下','高中職','專科','大學','研究所'];
const marriage=['未婚','有偶','離婚或終止結婚','喪偶'];
const f=(v:number|null|undefined)=>v==null?'—':v.toLocaleString('zh-TW',{maximumFractionDigits:2});
function AxisExplanation({axis,rule,label}:{axis:AxisReading;rule:any;label:string}) {
  const text=axis.state==='missing'?'缺少比較資料':axis.state==='boundary'?'範圍跨越門檻':axis.result?'條件成立':'條件未成立';
  return <div className={`aws-axis-reading ${axis.state}`}><strong>{label} · {rule.label}</strong><span>{text}</span>
    <p>{rule.condition}</p>
    {axis.value&&<p>{axis.value.low===axis.value.high?'數值':'點估計'} <b>{f(axis.value.value)}{rule.unit}</b>{axis.value.low!==axis.value.high&&<>；範圍 {f(axis.value.low)}–{f(axis.value.high)}{rule.unit}</>}</p>}
    {axis.reference&&<p>門檻 {f(axis.reference.value)}{rule.unit}{axis.reference.low!==axis.reference.high?`（基準範圍 ${f(axis.reference.low)}–${f(axis.reference.high)}${rule.unit}）`:''}</p>}
    {axis.state==='boundary'&&<p>範圍內同時有符合與不符合條件的數值，因此此軸還不能固定在一側。</p>}
  </div>;
}
function CompareChart({points,unit}:{points:any[];unit:string}) {
  const raw=Math.max(1,...points.flatMap(p=>[p.value?.high??0,p.base?.high??0]))*1.18;
  const step=raw>1000?10**(Math.floor(Math.log10(raw))-1):raw>100?10:raw>10?5:1;
  const max=Math.ceil(raw/step)*step;
  const y=(n:number)=>230-n/max*180;
  return <><svg className="aws-evidence-chart" viewBox="0 0 620 290" role="img" aria-label={`所選地區與比較基準，單位${unit}`}>
    {[0,.25,.5,.75,1].map(t=><g key={t}><line x1="66" x2="595" y1={y(max*t)} y2={y(max*t)} stroke="#D9E2EC" strokeDasharray="4 4"/><text x="58" y={y(max*t)+5} textAnchor="end" fontSize="12">{f(max*t)}</text></g>)}
    {points.map((p,i)=>{const center=195+i*265;const delta=p.value&&p.base?p.value.value-p.base.value:null;return <g key={p.year}>
      {[p.base,p.value].map((v,j)=>v&&<g key={j}><rect tabIndex={0} x={center-62+j*66} y={y(v.value)} width="52" height={230-y(v.value)} fill={j?'#0F766E':'#2563EB'} rx="4" style={{transition:'y 2s, height 2s'}}><title>{p.year}年・{j?'所選地區':'比較基準'}：{f(v.value)}{unit}；範圍{f(v.low)}–{f(v.high)}</title></rect><path d={`M${center-36+j*66},${y(v.low)}V${y(v.high)}m-8,0h16m-16,${y(v.low)-y(v.high)}h16`} fill="none" stroke="#526477" strokeWidth="2"/></g>)}
      {delta!=null&&<g><path d={`M${center-36},${y(Math.max(p.value.high,p.base.high))-7}v-13h66v13`} fill="none" stroke="#526477"/><text x={center-3} y={y(Math.max(p.value.high,p.base.high))-26} textAnchor="middle" fill={delta>0?'#B42318':delta<0?'#087F5B':'#19324A'} fontWeight="700" fontSize="15">{delta>0?'+':''}{f(delta)}</text></g>}
      <text x={center} y="256" textAnchor="middle" fontSize="16">{p.year}年</text></g>})}
    <text x="15" y="30" fontSize="13">{unit}</text>
  </svg><p className="aws-chart-legend"><span>● 比較基準</span><span>● 所選地區</span>　差距＝所選地區−比較基準</p><details><summary>查看圖表資料表</summary><div className="aws-table-wrap"><table><thead><tr><th>年度</th><th>比較基準</th><th>所選地區</th><th>差距</th></tr></thead><tbody>{points.map(p=><tr key={p.year}><th>{p.year}</th><td>{f(p.base?.value)}</td><td>{f(p.value?.value)}</td><td>{f(p.value&&p.base?p.value.value-p.base.value:null)}</td></tr>)}</tbody></table></div></details></>;
}
function RegionMap({onPick}:{onPick:(name:string)=>void}) {
  const [features,setFeatures]=useState<DistrictFeature[]|null>(null),[loadError,setLoadError]=useState(''),[hovered,setHovered]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    const names=data.geographies.filter(g=>g.name!=='新北市').map(g=>geographyLabel(g.name));
    fetch('/data/ntpc-districts.geojson',{signal:controller.signal})
      .then(r=>{if(!r.ok)throw Error('地圖載入失敗');return r.json()})
      .then(geo=>{if(!controller.signal.aborted)setFeatures(selectDistrictFeatures(geo,names))})
      .catch(()=>{if(!controller.signal.aborted)setLoadError('行政區地圖暫時無法載入，請使用下方地區清單選取。')});
    return()=>controller.abort();
  },[]);
  if(loadError)return <p role="alert">{loadError}</p>;
  if(!features)return <p role="status">地圖載入中…</p>;
  const coords=features.flatMap((f:any)=>f.geometry.coordinates.flat(Infinity));
  const xs=coords.filter((_:any,i:number)=>i%2===0),ys=coords.filter((_:any,i:number)=>i%2===1);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const point=(c:number[])=>`${30+(c[0]-minX)/(maxX-minX)*560},${440-(c[1]-minY)/(maxY-minY)*410}`;
  return <><svg className="aws-region-map" viewBox="0 0 620 470" role="group" aria-label="選擇新北市29個行政區">{features.map((feature:any)=>{
    const name=feature.properties.TOWNNAME; const polygons=feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[feature.geometry.coordinates];
    return <path key={name} d={polygons.map((p:any)=>p.map((ring:any)=>'M'+ring.map(point).join('L')+'Z').join('')).join('')} fillRule="evenodd" vectorEffect="non-scaling-stroke" tabIndex={0} role="button" aria-label={name} onMouseEnter={()=>setHovered(name)} onMouseLeave={()=>setHovered('')} onFocus={()=>setHovered(name)} onBlur={()=>setHovered('')} onClick={()=>onPick(name)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onPick(name)}}}><title>{name}：查看ROA</title></path>;
  })}</svg><p className="aws-map-caption" role="status">{hovered?`${hovered}｜點選或按 Enter 查看`:'請點選行政區，或使用下方地區清單。'}</p></>;
}
export function PolicyWorkflow(props:any) {
  const [evidence,setEvidence]=useState<'both'|'x'|'y'|null>(null);
  const closeEvidence=useCallback(()=>setEvidence(null),[]);
  const [scope,setScope]=useState<'district'|'city'|null>(null),[region,setRegion]=useState(''),[ready,setReady]=useState(false);
  const [year,setYear]=useState(props.year),[age,setAge]=useState<AgeBand>(props.ageBand),[sex,setSex]=useState<Sex>(props.sex);
  const [topic,setTopic]=useState('population'),[category,setCategory]=useState('大學'),[marital,setMarital]=useState('未婚'),[salary,setSalary]=useState('全年總薪資中位數');
  const [rules,setRules]=useState<any>(null),[joint,setJoint]=useState<Record<string,any>>({}),[error,setError]=useState('');
  const [jointLoading,setJointLoading]=useState(false),[jointError,setJointError]=useState('');
  const [localContext,setLocalContext]=useState<RoaContext|null>(null),[contextError,setContextError]=useState('');
  useEffect(()=>{fetch('/api/roa/rules').then(r=>{if(!r.ok)throw Error('此入口限白名單網路');return r.json()}).then(setRules).catch(e=>setError(e.message))},[]);
  useEffect(()=>{const controller=new AbortController();fetch('/api/roa/context',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error('地方背景資料暫時無法載入；仍可查看戶籍等主題資料。');return r.json() as Promise<RoaContext>}).then(value=>{if(!controller.signal.aborted)setLocalContext(value)}).catch(e=>{if(!controller.signal.aborted)setContextError(e.message)});return()=>controller.abort()},[]);
  useEffect(()=>{if(topic!=='education_marriage')return;let active=true;
    setJointLoading(true);setJointError('');setJoint({});
    const geos=scope==='city'?data.geographies.filter(g=>g.name==='新北市'):data.geographies.filter(g=>g.name!=='新北市');
    (async()=>{
      const entries:any[]=[];
      for(let start=0;start<geos.length;start+=3){
        if(!active)return;
        entries.push(...await Promise.all(geos.slice(start,start+3).map(async g=>[geographyLabel(g.name),await fetch(g.name==='新北市'?'/data/joint-education-marriage.json':`/data/joint-education-marriage-districts/${g.code}.json`).then(r=>{if(!r.ok)throw Error('交叉資料載入失敗，請重選此主題再試。');return r.json()})])));
      }
      if(active){setJoint(Object.fromEntries(entries));setJointLoading(false)}
    })().catch(e=>{if(active){setJointError(e.message);setJointLoading(false)}});
    return()=>{active=false};
  },[topic,scope]);
  const rule=rules?.topics.find((r:any)=>r.id===topic);
  const isCombined=['employment','unemployment','salary','salary_gap'].includes(topic);
  const actualSex=isCombined?'合計':sex;
  useEffect(()=>setEvidence(null),[scope,region,year,age,actualSex,topic,category,marital,salary,ready]);
  const place=scope==='city'?'新北市':region;
  useEffect(()=>{props.onAiContext?.(ready?{year,ageBand:age,sex:actualSex,district:place,view:'policy'}:null)},[ready,year,age,actualSex,place,props.onAiContext]);
  const selection:RoaSelection={scope:scope??'district',place,year,age,sex:actualSex,topic,category,marital,salary};
  const analysis=ready&&rule?analyzeRoa(selection,rule,joint):null;
  const {current=null,previous=null,growth=null,baseline=null,history=[],points=[]}=analysis??{};
  const classification=analysis?.classification;
  const key=classification?.stableKey??null;
  const selected=key?rules.quadrants[key]:null;
  const pending=topic==='education_marriage'&&(jointLoading||(!joint[place]&&!jointError));
  const direction=analysis&&!pending&&!(jointError&&topic==='education_marriage')?buildRoaDirection(selection,analysis,localContext):null;
  const charts=analysis?buildRoaCharts(selection,rule,analysis,joint):null;
  const exportRecord=async()=>{
    if(!(await fetch('/api/export/authorize',{cache:'no-store'})).ok){setError('此網路位置未授權匯出');return}
    const record={version:rules.version,explanationVersion:'ROA-EXPLANATION-V1.1',scope,region:place,year,age,sex:actualSex,topic,category,marital,salary,R:{current,previous,growth,baseline,history:scope==='city'?history:null},O:rule.goal,A:{quadrant:key,level:selected?.label??(classification?.status==='boundary'?'象限待確認':'比較資料未齊'),classification,reasons:analysis?.reasons,direction,contextVersion:localContext?.version??null,contextReviewedAt:localContext?.reviewedAt??null}};
    const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`ROA_${place}_${year}_${age}_${topic}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  };
  return <section className="aws-roa"><header><p className="kicker">決策內網 · ROA 四象限</p><h1>從青年變化，看下一步關注方向</h1><p>先選範圍，再把資料依據、關注目標與研擬方向放在一起。</p></header>
    {error&&<p role="alert">{error}</p>}
    <div className="aws-scope"><button aria-pressed={scope==='district'} onClick={()=>{setScope('district');setRegion('');setReady(false);setTopic('population')}}><strong>29個行政區</strong><span>人口、教育、婚姻與青年據點</span></button><button aria-pressed={scope==='city'} onClick={()=>{setScope('city');setRegion('新北市');setReady(false);setTopic('population')}}><strong>全新北市</strong><span>戶籍、勞動、行業與薪資分開判讀</span></button></div>
    {scope==='district'&&!region&&<div className="aws-card"><h2>先點選想了解的行政區</h2><RegionMap onPick={setRegion}/><label>或使用地區清單<select value={region} onChange={e=>setRegion(e.target.value)}><option value="">請選擇</option>{data.geographies.filter(g=>g.name!=='新北市').map(g=><option key={g.code}>{geographyLabel(g.name)}</option>)}</select></label></div>}
    {scope&&region&&<div className="aws-context"><strong>{place}</strong>{scope==='district'&&<button onClick={()=>{setRegion('');setReady(false)}}>重新選區</button>}<label>年度<select value={year} onChange={e=>{setYear(Number(e.target.value));setReady(false)}}>{data.meta.years.map(y=><option key={y} value={y}>{y}年</option>)}</select></label><label>年齡<select value={age} onChange={e=>{setAge(e.target.value as AgeBand);setReady(false)}}>{data.meta.ageBands.map(a=><option key={a} value={a}>{ageBandLabel(a)}</option>)}</select></label><label>性別<select value={sex} onChange={e=>{setSex(e.target.value as Sex);setReady(false)}}>{data.meta.sexes.map(s=><option key={s}>{s}</option>)}</select></label><button className="aws-primary" onClick={()=>setReady(true)}>套用並查看 ROA</button></div>}
    {ready&&rule&&<><div className="aws-context"><label>關注主題<select value={topic} onChange={e=>setTopic(e.target.value)}>{rules.topics.filter((t:any)=>t.scope.includes(scope)).map((t:any)=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>{['education','education_marriage'].includes(topic)&&<label>教育<select value={category} onChange={e=>setCategory(e.target.value)}>{education.map(e=><option key={e}>{e}</option>)}</select></label>}{['marriage','education_marriage'].includes(topic)&&<label>婚姻<select value={marital} onChange={e=>setMarital(e.target.value)}>{marriage.map(m=><option key={m}>{m}</option>)}</select></label>}{topic==='salary'&&<label>薪資統計<select value={salary} onChange={e=>setSalary(e.target.value)}>{['全年總薪資中位數','全年總薪資平均數'].map(s=><option key={s}>{s}</option>)}</select></label>}</div>
      <p className="aws-context-note">{year}年 · {place} · {ageBandLabel(age)} · {actualSex}　｜　{rule.universe}{isCombined?'（此資料提供男女合計）':''}</p>
      <div className="aws-ro-pair"><article className="aws-card"><span className="aws-step">R · 資料依據</span><h2>{rule.name}，相對位置在哪裡？</h2>{pending?<p role="status">正在載入同條件交叉資料與比較基準…</p>:<><p className="aws-main-value">{f(current?.value)}<small>{rule.y.unit}</small></p><ul><li>與前一年度相比：{f(growth?.value)}{rule.x.unit}。</li><li>{scope==='district'?'同條件29區中位數':`${history.join('、')}年平均`}：{f(baseline?.value)}{rule.y.unit}。</li></ul>{charts&&points.some(p=>p.value||p.base)&&<NarrativeChart chart={charts.y}/>}<small>{jointError&&topic==='education_marriage'?'交叉資料暫時無法載入':current?.origin??'目前所選條件無同口徑值，原因列於下方。'}</small></>}</article>
      <article className="aws-card"><span className="aws-step">O · 關注目標</span><h2>{rule.goal}</h2>{classification&&!pending?<><AxisExplanation label="X" axis={classification.axes.x} rule={rule.x}/><AxisExplanation label="Y" axis={classification.axes.y} rule={rule.y}/></>:<p role="status">正在載入同條件交叉資料與比較基準…</p>}<p>兩條線索一起成立時，列為較高關注；僅一條成立時，整理對應的改善方向。</p><details><summary>比較資料與來源</summary><p>比較使用畫面顯示至小數第2位的數值。範圍來自原模型的上下限，差值以兩期上下限交叉相減（或換算年增率）。這是保守的分級敏感度檢查，不是統計顯著性檢定。</p>{data.sources.filter(s=>/^https:\/\//.test(s.url)).map(s=><p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a></p>)}<p>{rule.notes.join(' ')}</p></details></article></div>
      <div className="aws-flow-arrow" aria-hidden="true">↓</div><article className="aws-card"><span className="aws-step">A · 四象限與研擬方向</span><h2>{pending?'交叉資料載入中':jointError&&topic==='education_marriage'?'交叉資料暫時無法載入':selected?`${selected.label}：${rule.name}`:classification?.status==='boundary'?'數值可比較，象限尚未固定':'比較資料未齊：保留已知數值'}</h2>
      <button className="aws-evidence-entry" onClick={()=>setEvidence('both')}>查看支持證據與可交叉分析 →</button>
      {pending?<p role="status">正在整理所選地區及完整比較基準，這不是資料缺值。</p>:jointError&&topic==='education_marriage'?<p role="alert">{jointError}</p>:<>
        {classification?.status==='boundary'&&<div className="aws-classification-note"><strong>為什麼沒有單一結果？</strong><p>{['x','y'].filter(k=>classification.axes[k as 'x'|'y'].state==='boundary').map(k=>k.toUpperCase()).join('、')}軸的估計範圍跨越分級門檻。資料仍能用來看規模、差距及變化。</p><p>只看點估計：{rules.quadrants[classification.pointKey!].position}（{rules.quadrants[classification.pointKey!].label}）；這是參考位置，不是已確定分級。</p><details><summary>區間重疊是否代表不能使用？</summary><p>不是。只有範圍跨過本次 X 或 Y 的判斷門檻，才無法指定單一象限。兩組範圍彼此重疊，但仍都在門檻同一側時，仍可分級。範圍重疊也不能直接寫成「統計上無顯著差異」。</p><p>逐軸上下限可能涵蓋的位置：{classification.possibleKeys.map(k=>`${rules.quadrants[k].position}（${rules.quadrants[k].label}）`).join('、')}。此範圍未使用兩軸聯合機率，並不是各象限的發生機率。</p></details></div>}
        {!!analysis?.reasons.length&&<div className="aws-classification-note"><strong>本次缺少哪一段比較？</strong><ul>{analysis.reasons.map((r,i)=><li key={i}><b>{r.axis}軸：</b>{r.text}</li>)}</ul></div>}
        <div className="aws-a-layout"><div><RoaQuadrants rule={rule} quadrants={rules.quadrants} selectedKey={key} pointKey={classification?.pointKey} onEvidence={setEvidence}/><small>高、中、低表示本議題的政策關注程度，不是地區整體好壞。</small></div>
        <div className="aws-directions">{direction?<><p className="aws-proposal-label">依所選條件整理的概念提案</p><h3>{direction.title}</h3><dl><dt>值得確認的痛點</dt><dd>{direction.question}</dd><dt>可以怎麼做</dt><dd>{direction.action}</dd></dl><p className="aws-delivery">{direction.delivery}</p></>:<p>已知數值可先查看。取得缺少的年度或類別資料後，再整理與本議題相符的方向。</p>}<button disabled={pending||!!jointError&&topic==='education_marriage'} onClick={exportRecord}>下載本次 ROA 紀錄</button></div></div>
        {direction&&<div className="aws-local-evidence"><h3>為什麼是這個方向？</h3><ul>{direction.evidence.slice(0,3).map((e,i)=><li key={i}><p>{e.text}</p><small>{e.period} · {e.url?<a href={e.url} target="_blank" rel="noreferrer">{e.source}</a>:e.source}</small></li>)}</ul><details><summary>更多地方依據與下一步確認</summary><ul>{direction.evidence.slice(3).map((e,i)=><li key={i}><p>{e.text}</p><small>{e.period} · {e.url?<a href={e.url} target="_blank" rel="noreferrer">{e.source}</a>:e.source}</small></li>)}</ul><p>{direction.followup}</p><p>地方背景只用於構思服務方向，不代入四象限。背景快照查閱日期：{localContext?.reviewedAt??'尚未載入'}。</p></details>{contextError&&<p role="status">{contextError}</p>}</div>}
      </>}</article>
      {topic==='service_sites'&&<article className="aws-card"><h3>{data.service.snapshotYear}年列冊青年據點</h3>{data.service.facilities.filter(f=>f.district===region).map(f=><p key={f.facilityCode}><a href={f.sourceUrl} target="_blank" rel="noreferrer">{f.name}</a> · {f.address} · {f.operatingStatus}</p>)}</article>}
      <button className="aws-question" onClick={()=>props.onOpenChat(`${year}年${place}${ageBandLabel(age)}的${rule.name}資料，請說明數值與比較基準。`)}>問資料：了解這張圖的數值與來源</button>
    </>}
    {ready&&analysis&&evidence&&<RoaEvidenceDrawer selection={selection} rule={rule} analysis={analysis} joint={joint} direction={direction} initial={evidence} onClose={closeEvidence}/>}
  </section>;
}

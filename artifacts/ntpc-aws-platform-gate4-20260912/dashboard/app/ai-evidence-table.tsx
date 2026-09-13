import {useState} from 'react';

export type EvidenceInput={label:string;period:string;universe:string;rows?:unknown};
export type EvidenceValue={period:string;group:string;metric:string;value:number|null;unit:string;low:number|null;high:number|null;origin:string;method:string};
const names:Record<string,string>={population:'戶籍人口',populationSharePct:'人口占比',populationDensityPerKm2:'人口密度',monthChange:'月增率',yearChange:'同月年增率',sharePct:'行業占比',employedThousand:'就業人數',employedThousands:'就業人數',populationLow:'人數下限',populationHigh:'人數上限'};
const contextKeys=new Set(['year','年度','month','period','ageBand','sex','geography','district','地區','行政區','education','教育','marriage','婚姻','industry','industryCode','industryGroup','行業','meta','origin','身分','method','unit','populationOrigin','sharePctLow','sharePctHigh','下限%','上限%','populationLow','populationHigh']);
export const evidenceNumber=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value.trim())?Number(value):null;
export const formatEvidence=(value:number|null)=>value==null?'—':value.toLocaleString('zh-TW',{maximumFractionDigits:2});
const object=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const text=(v:unknown)=>typeof v==='string'||typeof v==='number'?String(v):'';

/** Presentation only: unwrap known estimates without changing values or inferring zero. */
export function normalizeEvidence(source:EvidenceInput) {
  const payload=source.rows;
  const rows=Array.isArray(payload)?payload:payload&&typeof payload==='object'?Object.entries(payload).map(([metric,row])=>({分類:metric,...object(row)})):[];
  const values:EvidenceValue[]=[];
  const records:Record<string,string>[]=[];
  for(const input of rows){
    const r=object(input),meta=object(r.meta);
    const year=r['年度']??r.year;
    const period=year!=null?`${year}年${r.month!=null?`${r.month}月`:''}`:source.period;
    const group=[r['地區']??r.geography??r.district,r['分類'],r['教育']??r.education,r['婚姻']??r.marriage,r['行業']??r.industry,r.ageBand?`${r.ageBand}歲`:null,r.sex].filter(v=>v!=null&&text(v)).join(' · ');
    const items=r.metrics?Object.entries(object(r.metrics)):Object.entries(r).filter(([k])=>!contextKeys.has(k)&&k!=='分類');
    const before=values.length;
    for(const [key,raw] of items){
      const nested=object(raw),detail={...object(meta[key]),...nested};
      const value=Object.hasOwn(nested,'value')?evidenceNumber(nested.value):evidenceNumber(raw);
      if(value==null&&raw!=null&&!Object.hasOwn(nested,'value'))continue;
      if(value==null&&raw==null&&!names[key]&&!Object.hasOwn(meta,key)&&!/(人數|率|比|薪資)/.test(key))continue;
      const unit=text(detail.unit)||(/%|Pct|Change|率|占比/.test(key)||source.label.includes('占比')?'%':/密度/.test(key)||key==='populationDensityPerKm2'?'人／平方公里':/薪資|工資/.test(key)?'萬元／年':/Thousand/.test(key)?'千人':/population|人數/.test(key)?'人':key==='排名'?'名':'');
      const low=detail.low??(key==='sharePct'?r.sharePctLow:key==='population'?r.populationLow:key==='占比%'?r['下限%']:undefined);
      const high=detail.high??(key==='sharePct'?r.sharePctHigh:key==='population'?r.populationHigh:key==='占比%'?r['上限%']:undefined);
      values.push({period,group,metric:names[key]??key,value,unit,low:evidenceNumber(low),high:evidenceNumber(high),origin:text(detail.origin??r.origin??r['身分']??r.populationOrigin),method:text(detail.method??r.method)});
    }
    if(before===values.length){
      const labels:Record<string,string>={name:'名稱',district:'行政區',address:'地址',operatingStatus:'營運狀態',sourceUrl:'官方網址',ageBand:'年齡',sex:'性別',year:'年度',geography:'地區'};
      records.push(Object.fromEntries(Object.entries(r).filter(([,v])=>v==null||typeof v!=='object').map(([k,v])=>[labels[k]??k,v==null?'—':text(v)])));
    }
  }
  return {values,records};
}

export function AiEvidenceTable({source}:{source:EvidenceInput}){
  const {values,records}=normalizeEvidence(source);
  const metrics=[...new Set(values.map(v=>v.metric))];
  const [choice,setChoice]=useState('');
  const metric=metrics.includes(choice)?choice:metrics[0];
  const rows=values.filter(v=>v.metric===metric);
  const methods=[...new Set(rows.map(r=>r.method).filter(Boolean))];
  const origins=[...new Set(rows.map(r=>r.origin).filter(Boolean))];
  const hasRange=rows.some(r=>r.low!=null||r.high!=null);
  const min=Math.min(0,...rows.map(r=>r.value??0)),max=Math.max(1,...rows.map(r=>r.value??0));
  const y=(v:number)=>200-(v-min)/(max-min)*150;
  return <>
    {metrics.length>0&&<label>支持資料指標<select value={metric} onChange={e=>setChoice(e.target.value)}>{metrics.map(m=><option key={m}>{m}</option>)}</select></label>}
    {rows.length>1&&rows.length<=12&&<svg viewBox="0 0 560 290" role="img" aria-label={`${metric}；單位${rows[0].unit}`}>
      {[0,.5,1].map(t=><g key={t}><line x1="76" x2="545" y1={200-t*150} y2={200-t*150} stroke="#D9E2EC"/><text x="68" y={205-t*150} textAnchor="end" fontSize="13">{formatEvidence(min+(max-min)*t)}</text></g>)}
      {rows.map((r,i)=>{const space=464/rows.length,x=76+i*space;return <g key={`${r.period}-${r.group}-${i}`}>
        {r.value!=null&&<rect tabIndex={0} x={x+7} width={space-14} y={Math.min(y(r.value),y(0))} height={Math.abs(y(r.value)-y(0))} fill="#0F766E" rx="3"><title>{r.period} {r.group}：{formatEvidence(r.value)}{r.unit}{hasRange?`；下限${formatEvidence(r.low)}，上限${formatEvidence(r.high)}`:''}</title></rect>}
        <text x={x+space/2} y="224" textAnchor="middle" fontSize="12">{r.period}</text><text x={x+space/2} y="246" textAnchor="middle" fontSize="11">{r.group.split(' · ')[0]}</text>
      </g>})}<text x="76" y="24" fontSize="14">{rows[0].unit}</text></svg>}
    {values.length>0&&<details><summary>查看支持資料表（{rows.length}列）</summary><div className="aws-chat-table readable-evidence-table"><table>
      <thead><tr><th>期間／對象</th><th>{metric}</th>{hasRange&&<th>估計範圍</th>}</tr></thead>
      <tbody>{rows.map((r,i)=><tr key={i}><th scope="row">{r.period}<small>{r.group}</small></th><td>{formatEvidence(r.value)}{r.value!=null&&<small>{r.unit}</small>}</td>{hasRange&&<td>{r.low==null&&r.high==null?'—':`${formatEvidence(r.low)}–${formatEvidence(r.high)}`}<small>{r.unit}</small></td>}</tr>)}</tbody>
    </table></div></details>}
    {!!origins.length&&<p className="aws-chat-value-origin">數值身分：{origins.join('；')}</p>}
    {!!methods.length&&<details><summary>指標計算與來源說明</summary>{methods.map(m=><p key={m}>{m}</p>)}</details>}
    {!!records.length&&<details><summary>查看官方名冊與文字資料（{records.length}列）</summary><div className="aws-chat-records">{records.map((r,i)=><dl key={i}>{Object.entries(r).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{k==='官方網址'&&v.startsWith('https://')?<a href={v} target="_blank" rel="noreferrer">官方資訊 ↗</a>:v}</dd></div>)}</dl>)}</div></details>}
    {!values.length&&!records.length&&<p>此來源提供文字說明，沒有可繪製的數值資料。</p>}
  </>;
}

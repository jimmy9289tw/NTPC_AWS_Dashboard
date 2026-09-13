import {useEffect,useRef,useState,type RefObject} from 'react';
import {dashboardData,geographyLabel,type AgeBand,type Sex} from './dashboard-data';
import './aws-chat.css';
import {AiEvidenceTable} from './ai-evidence-table';

export type ChatContext={year:number;ageBand:AgeBand;sex:Sex;district:string;view:string};
type Source={id:string;label:string;url:string;kind:'platform'|'external';universe:string;period:string;retrievedAt?:string;excerpt?:string;rows?:any};
type Block={text:string;sources:string[]};
type Reply={jobId?:string;status?:string;error?:string;answer:string;summary:Block[];directions:Block[];sources:Source[];notices:string[];context:ChatContext};
const format=(v:any)=>typeof v==='number'?v.toLocaleString('zh-TW',{maximumFractionDigits:2}):v==null?'—':typeof v==='object'?JSON.stringify(v):String(v);
const safeLink=(url:string)=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username?url:undefined}catch{return undefined}};
const privateInput=/(?:AKIA|ASIA)[A-Z0-9]{16}|[A-Z][12]\d{8}|09\d{8}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|身分證|身份證|病歷|信用卡|我的地址|我的電話|我的姓名|https?:\/\//i;

function Evidence({source}:{source:Source}){
  return <section className="aws-chat-evidence"><h3>{source.label}</h3><p>{source.period} · {source.universe}</p>
    <AiEvidenceTable source={source}/>
    {source.excerpt&&<details><summary>查看本次取得的官方摘錄</summary><p className="aws-chat-excerpt">{source.excerpt}</p></details>}
    {source.retrievedAt&&<small>查閱時間：{new Date(source.retrievedAt).toLocaleString('zh-TW')}</small>}
    {safeLink(source.url)&&<p><a href={source.url} target="_blank" rel="noreferrer">開啟官方來源 ↗</a></p>}
  </section>;
}

export function AwsChat({initialContext,isInternal,question,onQuestionChange,inputRef}:{initialContext:ChatContext;isInternal:boolean;question:string;onQuestionChange:(q:string)=>void;inputRef:RefObject<HTMLTextAreaElement|null>}){
  const [ctx,setCtx]=useState(initialContext),[mode,setMode]=useState('official'),[reply,setReply]=useState<Reply|null>(null),[error,setError]=useState(''),[phase,setPhase]=useState(''),[activeSource,setActiveSource]=useState<string|null>(null);
  const controller=useRef<AbortController|null>(null);const sourceRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{setCtx(initialContext)},[initialContext.year,initialContext.ageBand,initialContext.sex,initialContext.district,initialContext.view]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const currentSource=reply?.sources.find(s=>s.id===activeSource);
  function openSource(id:string){setActiveSource(id);window.setTimeout(()=>{sourceRef.current?.focus();sourceRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'})},30)}
  async function ask(e:React.FormEvent){
    e.preventDefault();setError('');setReply(null);setActiveSource(null);
    if(privateInput.test(question)){setError('請只詢問公開彙總資料，不要輸入姓名、聯絡方式、證號、憑證或網址。');return}
    const abort=new AbortController();controller.current=abort;setPhase('正在排入問答佇列…');
    try{
      let session=sessionStorage.getItem('ntpc-ai-session');
      if(!session){session=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');sessionStorage.setItem('ntpc-ai-session',session)}
      const headers={'content-type':'application/json','x-ntpc-chat-session':session};
      const res=await fetch('/api/ask',{method:'POST',headers,signal:abort.signal,body:JSON.stringify({question,context:ctx,sourceMode:mode,audience:isInternal?'internal':'public',requestId:crypto.randomUUID()})});
      const job=await res.json() as {jobId?:string;error?:string};if(!res.ok)throw new Error(job.error||'問答暫時無法使用。');
      if(!job.jobId)throw new Error('未取得問答編號，請稍後再試。');
      for(let i=0;i<90;i++){
        await new Promise<void>((resolve,reject)=>{const handle=window.setTimeout(()=>{abort.signal.removeEventListener('abort',cancel);resolve()},2000);const cancel=()=>{clearTimeout(handle);reject(new DOMException('Aborted','AbortError'))};abort.signal.addEventListener('abort',cancel,{once:true})});
        const poll=await fetch('/api/ask/'+job.jobId,{headers,cache:'no-store',signal:abort.signal});const result=await poll.json() as Reply;
        if(!poll.ok||result.status==='failed')throw new Error(result.error||'本次回答未完成。');
        if(result.status==='complete'){setReply(result);setPhase('');return}
        setPhase(({queued:'排隊中，請稍候…',reading:'正在查詢同條件平台數據…',sources:'正在讀取相關官方來源…',answering:'AI 正在整理數據與引用…'} as Record<string,string>)[result.status??'']||'處理中…');
      }
      throw new Error('本次等候超過3分鐘，請稍後再試。');
    }catch(e){if((e as Error).name!=='AbortError')setError((e as Error).message)}finally{setPhase('')}
  }
  return <div className="aws-chat"><p className="aws-chat-intro">{isInternal?'先看數據，再查官方資料，整理一個值得深入的方向。':'查詢人口、就業、薪資數據及官方服務資訊。'}</p>
    <form onSubmit={ask}><fieldset disabled={!!phase}><legend>這次問答的條件</legend><div className="aws-chat-filters">
      <label>年度<select value={ctx.year} onChange={e=>setCtx({...ctx,year:+e.target.value})}>{[110,111,112,113,114,115].map(y=><option key={y} value={y}>{y}年</option>)}</select></label>
      <label>年齡<select value={ctx.ageBand} onChange={e=>setCtx({...ctx,ageBand:e.target.value as AgeBand})}>{['18-35','18-24','25-29','30-35'].map(a=><option key={a} value={a}>{a}歲</option>)}</select></label>
      <label>性別<select value={ctx.sex} onChange={e=>setCtx({...ctx,sex:e.target.value as Sex})}>{['合計','男','女'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>地區<select value={geographyLabel(ctx.district)} onChange={e=>setCtx({...ctx,district:e.target.value})}>{dashboardData.geographies.map(g=><option key={g.code} value={geographyLabel(g.name)}>{geographyLabel(g.name)}</option>)}</select></label>
    </div><label>資料範圍<select value={mode} onChange={e=>setMode(e.target.value)}><option value="official">平台＋已串接的外部官方來源</option><option value="platform">只查平台資料</option></select></label>
    <label htmlFor="question">想了解什麼？</label><textarea ref={inputRef} id="question" value={question} onChange={e=>onQuestionChange(e.target.value)} maxLength={500} required minLength={2} placeholder="例如：114年淡水區30–35歲人口如何變化？" aria-describedby="aws-chat-safety"/>
    <small id="aws-chat-safety">只接受公開統計與服務問題，請勿輸入個資。外部查詢限已串接官方來源，不是全網搜尋。</small>
    <button className="primary-button" type="submit">查詢並整理</button></fieldset></form>
    {phase&&<div role="status" className="aws-chat-progress">{phase}<button type="button" onClick={()=>controller.current?.abort()}>停止等候</button></div>}
    <div aria-live="polite">{error&&<p role="alert" className="error-message">{error}</p>}{reply&&<article className="aws-chat-answer"><header><strong>資料回答</strong><span>Amazon Bedrock</span></header>
      <p className="aws-chat-scope">{reply.context.year}年 · {reply.context.district} · {reply.context.ageBand}歲 · {reply.context.sex}</p>
      {reply.summary?.length?<ul>{reply.summary.map((b,i)=><li key={i}>{b.text}<span className="aws-chat-citations">{b.sources.map(id=><button key={id} onClick={()=>openSource(id)} aria-label={`查看支持證據${id}`}>{id}</button>)}</span></li>)}</ul>:<p>{reply.answer}</p>}
      {isInternal&&reply.directions?.length>0&&<section><h3>可進一步探討</h3>{reply.directions.map((b,i)=><p key={i}>{b.text}<span className="aws-chat-citations">{b.sources.map(id=><button key={id} onClick={()=>openSource(id)}>{id}</button>)}</span></p>)}</section>}
      <nav className="aws-chat-source-list" aria-label="本次查閱資料">{reply.sources.map(s=><button key={s.id} onClick={()=>openSource(s.id)}><small>{s.kind==='platform'?'平台數據':'外部官方'}</small>{s.label}</button>)}</nav>
      {reply.notices?.length>0&&<details><summary>資料範圍與本次未取得的內容</summary><ul>{reply.notices.map((n,i)=><li key={i}>{n}</li>)}</ul></details>}
    </article>}</div>
    {currentSource&&<section ref={sourceRef} tabIndex={-1} className="aws-chat-source-detail"><button type="button" onClick={()=>setActiveSource(null)}>收合支持證據</button><Evidence key={currentSource.id} source={currentSource}/></section>}
  </div>;
}

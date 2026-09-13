import rules from './lsf-rules.json';
import type { AgeBand, Sex, RegisteredRecord, LaborRecord, WageRecord, ServiceFacility } from './dashboard-data';
import type { ResidentEmploymentIndustryRecord } from './resident-employment-industry';
export { rules as lsfRules };
export type LsfContext = { geography: string; year: number; ageBand: AgeBand; sex: Sex };
export type ExternalRow = Record<string, string | number>;
export type LsfSnapshot = { version:string; generatedAt:string; rentPeriod:string; registered:RegisteredRecord[]; labor:LaborRecord[]; wage:WageRecord[]; industry:ResidentEmploymentIndustryRecord[]; service:{facilities:ServiceFacility[];snapshotYear:number}; geographies:{code:string;name:string;level:string}[]; external:ExternalRow[]; sourceYearbook:{url:string;retrieved_at:string} };
export const round2 = (n:number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const changePct = (n:number|undefined,p:number|undefined) => n==null || p==null || p<=0 ? null : round2((n-p)/p*100);
export function populationEvidence(data:LsfSnapshot,c:LsfContext) {
  const local=data.registered.filter(r=>r.geography===c.geography&&r.ageBand===c.ageBand&&r.sex===c.sex&&r.year<=c.year).sort((a,b)=>a.year-b.year);
  const city=data.registered.filter(r=>r.geography==='新北市'&&r.ageBand===c.ageBand&&r.sex===c.sex&&r.year<=c.year);
  const current=local.find(r=>r.year===c.year), previous=local.find(r=>r.year===c.year-1);
  const cityNow=city.find(r=>r.year===c.year),cityPrev=city.find(r=>r.year===c.year-1);
  const rate=changePct(current?.population,previous?.population), cityRate=changePct(cityNow?.population,cityPrev?.population);
  const restRate=c.geography==='新北市'||!current||!previous||!cityNow||!cityPrev?null:changePct(cityNow.population-current.population,cityPrev.population-previous.population);
  return {current,previous,rate,cityRate,restRate,gap:rate===null||cityRate===null?null:round2(rate-cityRate),window:changePct(current?.population,local[0]?.population),local,city,
    direction:rate===null?'尚無前期比較':rate>0?'人口增加':rate<0?'人口減少':'人口持平'};
}
export function externalRows(data:LsfSnapshot,c:LsfContext,metric:string) {
  return data.external.filter(r=>r.geography_name_zh===c.geography&&r.metric_code===metric&&Number(r.roc_year)<=c.year);
}
export function externalValue(data:LsfSnapshot,c:LsfContext,metric:string) {
  const r=externalRows(data,c,metric).find(r=>Number(r.roc_year)===c.year);
  return !r||r.value===''?null:Number(r.value);
}
export type GateInput = { compatible:boolean; demand:boolean|null; burden:boolean|null; localized:boolean|null; counterEvidence:boolean; sameSourceOnly?:boolean };
/** Three-valued evidence gates. Missing data never becomes false or zero. */
export function secondRoundGate(i:GateInput) {
  if(!i.compatible) return '口徑待對齊';
  if(i.counterEvidence) return '先比較替代解釋';
  if(i.demand===false||i.burden===false) return '保留觀察';
  if(i.demand===null||i.burden===null) return '補足需求與負擔證據';
  if(i.sameSourceOnly) return '補獨立證據';
  if(i.localized!==true) return '第二輪：定位族群、地點與時段';
  return '整理研究方向';
}
export function domainEvidence(data:LsfSnapshot,c:LsfContext,id:string) {
  const rule=rules.domains.find(d=>d.id===id)!;
  const pop=populationEvidence(data,c), current=pop.current;
  const birth=externalRows(data,c,'CRUDE_BIRTH_RATE').sort((a,b)=>Number(a.roc_year)-Number(b.roc_year));
  const latestBirth=birth.at(-1),firstBirth=birth[0];
  const net=externalValue(data,c,'NET_MIGRATION'), natural=externalValue(data,c,'NATURAL_CHANGE');
  const localFacilities=data.service.facilities.filter(f=>c.geography==='新北市'||'新北市'+f.district===c.geography);
  let facts:string[]=[], next=rule.missingBranch, counter=false, status='資料待補';
  if(id==='family') {
    if(current) facts.push(`所選戶籍青年未婚 ${current.marriage['未婚']?.value.toFixed(2)}%、有偶 ${current.marriage['有偶']?.value.toFixed(2)}%、離婚或終止結婚 ${current.marriage['離婚或終止結婚']?.value.toFixed(2)}%（${current.marriage['未婚']?.origin}）。`);
    if(latestBirth) facts.push(`${latestBirth.roc_year}年全年齡粗出生率 ${Number(latestBirth.value).toFixed(2)}‰。`);
    if(birth.length>1) facts.push(`${firstBirth.roc_year}至${latestBirth!.roc_year}年變動 ${round2(Number(latestBirth!.value)-Number(firstBirth.value)).toFixed(2)} 個千分點。`);
    if(net!==null) facts.push(`${c.year}年全年齡遷入減遷出 ${net.toLocaleString('zh-TW')} 人；出生減死亡 ${natural?.toLocaleString('zh-TW')} 人。`);
    counter=pop.rate!==null&&pop.rate>0&&birth.length>1&&Number(latestBirth!.value)<Number(firstBirth.value);
    if(facts.length) status=counter?'線索不同向':'已有背景資料';
    if(counter) next='分開追查新遷入家戶、0–5歲人口與照顧安排。青年成長與粗出生率下降同時存在。';
  } else if(id==='housing') {
    facts=[`另有${data.rentPeriod}租金補貼有效租約快照。`, '可查看29區同型態租金分位數；未納入110–114年變動判定。']; status='單期背景';
  } else if(id==='services') {
    facts=[`${data.service.snapshotYear}年既有名錄列示 ${localFacilities.length} 處青年據點，營運中 ${localFacilities.filter(f=>f.active).length} 處。`, '目前缺少同年度地區服務使用量與到達時間。'];status='據點快照';
  } else if(id==='career') {
    if(current) facts.push(`所選戶籍青年大學占比 ${current.education['大學']?.value.toFixed(2)}%，研究所占比 ${current.education['研究所']?.value.toFixed(2)}%（${current.education['大學']?.origin}）。`);
    if(c.geography==='新北市') {
      const leading=data.industry.filter(r=>r.year===c.year&&r.ageBand===c.ageBand&&r.sex===c.sex).sort((a,b)=>b.sharePct-a.sharePct)[0];
      if(leading)facts.push(`所選居民青年就業者以${leading.industry}占比最高：${round2(leading.sharePct)}%（模型估計）。`);
    }
    if(c.geography==='新北市'&&c.sex==='合計') {
      const l=data.labor.find(r=>r.year===c.year&&r.ageBand===c.ageBand),w=data.wage.find(r=>r.year===c.year&&r.ageBand===c.ageBand);
      if(l) facts.push(`全市居住勞動母體失業率 ${l.metrics['失業率'].toFixed(2)}%（模型估計）。`);
      facts.push(w?`新北市工作場所全年薪資平均 ${w.metrics['全年總薪資平均數'].toFixed(1)} 萬元、中位 ${w.metrics['全年總薪資中位數'].toFixed(1)} 萬元（模型估計）。`:`${c.year}年無青年薪資值；可用年度至113年。`);
    }
    status=facts.length?'已有結構資料':'資料待補';
  } else if(id==='transport') facts=['尚未納入同年度、同路線與同時段的通勤負擔或載客量。'];
  else facts=['尚未納入行政區住宅用電及供電品質；全市資料不分攤至各區。'];
  // None of the currently ingested sources measures matched target-group service burden.
  const stage2=secondRoundGate({compatible:true,demand:null,burden:null,localized:null,counterEvidence:counter});
  return {rule,facts,next,status,stage2,counter,birth,localFacilities};
}

import {dashboardData as data,getRegistered,getLabor,getWage,geographyLabel,type AgeBand,type Sex} from './dashboard-data';
import {getResidentEmploymentIndustry} from './resident-employment-industry';
import {educationMarriageShare} from './joint-education-marriage';
import {aggregate,difference,estimate,explainQuadrant,type Estimate} from './aws-roa-model';

export type RoaSelection={scope:'district'|'city';place:string;year:number;age:AgeBand;sex:Sex;topic:string;category:string;marital:string;salary:string};
export function getRoaEstimate(s:RoaSelection,y:number,g:string,joint:Record<string,any>={}):Estimate|null {
  const {topic,age,category,marital,salary}=s;
  const sex=['employment','unemployment','salary','salary_gap'].includes(topic)?'合計':s.sex;
  const r=getRegistered(y,g,age,sex),l=getLabor(y,age),w=getWage(y,age);
  if(topic==='population'||topic==='density')return estimate(topic==='population'?r?.population:r?.populationDensityPerKm2);
  if(topic==='education'||topic==='marriage'){const c=topic==='education'?r?.education[category]:r?.marriage[marital];return c?estimate(c.value,c.low,c.high,c.origin):null}
  if(topic==='education_marriage'){const p=joint[g];const c=p?educationMarriageShare(p,y,age,sex,category,marital):null;return c?estimate(c.value,c.low,c.high,c.origin):null}
  if(topic==='service_sites')return null;
  if(topic==='employment'||topic==='unemployment'){const m=topic==='employment'?'就業人口比率':'失業率';return estimate(l?.metrics[m],l?.meta[m]?.low,l?.meta[m]?.high,l?.meta[m]?.origin)}
  if(topic==='salary')return estimate(w?.metrics[salary],w?.meta[salary]?.low,w?.meta[salary]?.high,w?.meta[salary]?.origin);
  if(topic==='salary_gap')return difference(estimate(w?.metrics['全年總薪資平均數'],w?.meta['全年總薪資平均數']?.low,w?.meta['全年總薪資平均數']?.high,'模型估計'),estimate(w?.metrics['全年總薪資中位數'],w?.meta['全年總薪資中位數']?.low,w?.meta['全年總薪資中位數']?.high,'模型估計'),true);
  if(topic==='industry'){
    const rows=getResidentEmploymentIndustry(y,sex,age).filter(r=>Number.isFinite(r.sharePct));
    if(rows.length<5)return null;
    const top=[...rows].sort((a,b)=>b.sharePct-a.sharePct).slice(0,5);
    return estimate(top.reduce((s,r)=>s+r.sharePct,0),top.reduce((s,r)=>s+(r.sharePctLow??r.sharePct),0),Math.min(100,top.reduce((s,r)=>s+(r.sharePctHigh??r.sharePct),0)),'模型估計');
  }return null;
}
export function analyzeRoa(s:RoaSelection,rule:any,joint:Record<string,any>={}) {
  const get=(y:number,g:string)=>getRoaEstimate(s,y,g,joint);
  const history=s.topic.startsWith('salary')?[110,111,112,113]:[110,111,112,113,114];
  const peers=(y:number)=>s.scope==='district'?data.geographies.filter(g=>g.name!=='新北市').map(g=>({label:geographyLabel(g.name),value:get(y,geographyLabel(g.name))})):history.map(y=>({label:`${y}年`,value:get(y,'新北市')}));
  const base=(y:number)=>aggregate(peers(y).map(p=>p.value),s.scope==='district'?'median':'mean');
  const current=get(s.year,s.place),previous=get(s.year-1,s.place),baseline=base(s.year);
  const populationAxis=['population','density','service_sites'].includes(s.topic);
  const xCurrent=populationAxis?estimate(getRegistered(s.year,s.place,s.age,s.sex)?.population):current;
  const xPrevious=populationAxis?estimate(getRegistered(s.year-1,s.place,s.age,s.sex)?.population):previous;
  const growth=difference(xCurrent,xPrevious,populationAxis||s.topic==='salary');
  const reasons:{axis:'X'|'Y';code:string;text:string}[]=[];
  if(!xCurrent)reasons.push({axis:'X',code:'current_missing',text:`缺少${s.year}年、所選年齡性別的數值，尚無法計算年度變化。`});
  else if(!xPrevious)reasons.push({axis:'X',code:'previous_missing',text:`缺少${s.year-1}年同條件數值；${s.year}年的資料仍可查看，但無法計算與前一年相比的變化。`});
  else if(!growth)reasons.push({axis:'X',code:'denominator',text:'前一年分母為零，或估計範圍包含零，無法計算年增率。'});
  if(s.topic==='service_sites')reasons.push({axis:'Y',code:'period_mismatch',text:`青年據點名冊為${data.service.snapshotYear}年快照，不是${s.year}年的據點數；保留位置資訊，不代入當年象限。`});
  else if(!current)reasons.push({axis:'Y',code:'current_missing',text:s.topic.startsWith('salary')?`${s.year}年尚無同口徑青年薪資資料；目前可用110–113年。`:`缺少${s.year}年此地區、年齡、性別與類別組合的數值。`});
  if(rule.y.reference!=='zero'&&!baseline){const missing=peers(s.year).filter(p=>!p.value).map(p=>p.label);reasons.push({axis:'Y',code:'baseline_incomplete',text:`比較基準缺少${missing.length}筆：${missing.slice(0,5).join('、')}${missing.length>5?'等':''}。不以剩餘資料替代完整基準。`})}
  return {current,previous,growth,baseline,history,reasons,classification:explainQuadrant(growth,current,baseline,rule),points:[s.year-1,s.year].map(year=>({year,value:get(year,s.place),base:base(year)}))};
}

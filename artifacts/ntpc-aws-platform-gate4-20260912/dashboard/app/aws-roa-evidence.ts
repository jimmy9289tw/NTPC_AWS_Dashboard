import {dashboardData as data,getRegistered,ageBandLabel,type AgeBand} from './dashboard-data';
import {analyzeRoa,getRoaEstimate,type RoaSelection} from './aws-roa-analysis';
import {estimate,type Estimate} from './aws-roa-model';
import type {EvidenceChart} from './policy-narrative';

const point=(label:string,v:Estimate|null)=>({label,value:v?.value??null,...(v&&v.low!==v.high?{low:v.low,high:v.high}:{})});
export function buildRoaCharts(s:RoaSelection,rule:any,a:ReturnType<typeof analyzeRoa>,joint:Record<string,any>={}) {
  const scope=`${s.place} · ${ageBandLabel(s.age)} · ${s.sex}`;
  const category=s.topic==='education'?s.category:s.topic==='marriage'?s.marital:s.topic==='education_marriage'?`${s.category}內${s.marital}`:s.topic==='salary'?s.salary:'';
  const title=category||rule.name;
  const common={kind:'bar' as const,universe:rule.universe,period:`${s.year-1}、${s.year}年`,sex:scope,identity:a.current?.origin??'沿用已發布資料身分',sources:data.sources.filter(r=>/^https:\/\//.test(r.url)),limitation:''};
  const populationAxis=['population','density','service_sites'].includes(s.topic);
  const original=(year:number)=>populationAxis?estimate(getRegistered(year,s.place,s.age,s.sex)?.population):getRoaEstimate(s,year,s.place,joint);
  const x:EvidenceChart={...common,title:`X 軸｜${rule.x.label}`,unit:rule.x.unit,reference:{label:rule.x.condition,value:0},
    series:[{name:scope,points:[s.year-1,s.year].map(y=>point(`${y}年`,y===s.year?a.growth:analyzeRoa({...s,year:y},rule,joint).growth))}],
    method:populationAxis||s.topic==='salary'?'（當年值 − 前一年值）÷ 前一年值 × 100%。':'當年占比 − 前一年占比，單位為百分點。',
    detailTable:{title:'年度變化的原始數值',columns:['年度',populationAxis?'青年人口（人）':`${title}（${rule.y.unit}）`],rows:[s.year-2,s.year-1,s.year].map(y=>[`${y}年`,original(y)?.value.toLocaleString('zh-TW',{maximumFractionDigits:2})??'尚無資料'])}};
  const baseline=s.scope==='district'?'同條件29區中位數':`${a.history[0]}–${a.history.at(-1)}年平均`;
  const y:EvidenceChart={...common,title:`Y 軸｜${title}與比較基準`,unit:rule.y.unit,
    series:[{name:baseline,points:a.points.map(p=>point(`${p.year}年`,p.base))},{name:s.place,points:a.points.map(p=>point(`${p.year}年`,p.value))}],
    method:s.scope==='district'?'同年度、同年齡、同性別、同類別的29區數值取中位數。':`同條件${a.history.join('、')}年數值取算術平均；不把缺年當成0。`};
  const cross:EvidenceChart[]=[];
  function add(label:string,unit:string,labels:string[],get:(year:number,label:string)=>Estimate|null,universe='戶籍登記人口'){
    cross.push({...common,title:label,unit,universe,method:'沿用各類別已發布值，不把不同母體相乘或互作分母。',series:[s.year-1,s.year].map(year=>({name:`${year}年`,points:labels.map(l=>point(l,get(year,l)))}))});
  }
  add('哪個青年年齡層增加或減少？','人',['18-24','25-29','30-35'],(year,age)=>estimate(getRegistered(year,s.place,age as AgeBand,s.sex)?.population));
  cross[0].series.forEach(series=>series.points.forEach(p=>p.label=`${p.label}歲`));
  cross[0].sex=`${s.place} · 三個青年年齡層 · ${s.sex}`;
  add('教育程度分布','%',['國中及以下','高中職','專科','大學','研究所'],(year,category)=>getRoaEstimate({...s,topic:'education',category},year,s.place));
  add('不同婚姻狀態的占比','%',['未婚','有偶','離婚或終止結婚','喪偶'],(year,marital)=>getRoaEstimate({...s,topic:'marriage',marital},year,s.place));
  if(s.topic==='education_marriage')add(`${s.category}內的婚姻分布`,'%',['未婚','有偶','離婚或終止結婚','喪偶'],(year,marital)=>getRoaEstimate({...s,marital},year,s.place,joint),'同年齡、性別與教育類別之戶籍登記人口');
  if(s.scope==='city'){
    add('就業人口比率與失業率','%',['就業人口比率','失業率'],(year,label)=>getRoaEstimate({...s,topic:label==='失業率'?'unemployment':'employment'},year,s.place),'新北市民間人口／勞動力；男女合計，兩指標分母不同');
    cross.at(-1)!.sex=`${s.place} · ${ageBandLabel(s.age)} · 合計`;
    add('薪資平均數與中位數','萬元／年',['全年總薪資平均數','全年總薪資中位數'],(year,salary)=>getRoaEstimate({...s,topic:'salary',salary},year,s.place),'工作場所在新北市的受僱員工；男女合計');
    cross.at(-1)!.sex=`${s.place} · ${ageBandLabel(s.age)} · 合計`;
  }
  if(s.topic.startsWith('salary'))cross.unshift({...y,title:'可查看的青年薪資歷年數值',period:'110–113年',series:[{name:s.place,points:a.history.map(year=>point(`${year}年`,getRoaEstimate(s,year,s.place)))}]});
  return {x,y,cross,scope,baseline};
}

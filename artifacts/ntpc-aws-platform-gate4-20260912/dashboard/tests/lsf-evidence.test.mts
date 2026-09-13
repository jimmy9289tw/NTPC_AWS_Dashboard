import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { populationEvidence,domainEvidence,secondRoundGate,externalValue,changePct,type LsfSnapshot,type LsfContext } from '../app/lsf-engine.ts';
const data=JSON.parse(readFileSync(new URL('../app/data/lsf-evidence.json',import.meta.url),'utf8')) as LsfSnapshot;
const c:LsfContext={geography:'新北市淡水區',year:114,ageBand:'18-35',sex:'合計'};
test('LSF Tamsui uses youth count, same-age city and display-rounded gap',()=>{
 const p=populationEvidence(data,c);assert.equal(p.current?.population,43000);assert.equal(p.rate,2.13);assert.equal(p.cityRate,-1.97);assert.equal(p.gap,4.1);assert.notEqual(p.restRate,p.cityRate);
});
test('LSF controls select all 1800 contexts without mixing geography/age/sex',()=>{
 for(const g of data.geographies)for(const year of [110,111,112,113,114])for(const ageBand of ['18-35','18-24','25-29','30-35'] as const)for(const sex of ['合計','男','女'] as const){const p=populationEvidence(data,{geography:g.name,year,ageBand,sex});assert.ok(p.current);assert.equal(p.current.ageBand,ageBand);assert.equal(p.current.sex,sex);assert.equal(p.local.length,year-109);if(year===110)assert.equal(p.rate,null);}
});
test('LSF declining and near-stable examples are real, not demo rows',()=>{
 assert.equal(populationEvidence(data,{...c,geography:'新北市瑞芳區'}).rate,-4.07);
 assert.equal(populationEvidence(data,{...c,geography:'新北市八里區'}).rate,-.11);
});
test('LSF city population is exactly the mutually exclusive district sum',()=>{
 for(const year of [110,111,112,113,114])for(const age of ['18-35','18-24','25-29','30-35'])for(const sex of ['合計','男','女']){const rows=data.registered.filter(r=>r.year===year&&r.ageBand===age&&r.sex===sex);assert.equal(rows.find(r=>r.geography==='新北市')?.population,rows.filter(r=>r.geography!=='新北市').reduce((s,r)=>s+r.population,0));}
});
test('LSF preserves age-independent contextual data and counter-evidence',()=>{
 const a=domainEvidence(data,c,'family'),b=domainEvidence(data,{...c,ageBand:'30-35',sex:'女'},'family');
 assert.deepEqual(a.birth,b.birth);assert.equal(externalValue(data,c,'CRUDE_BIRTH_RATE'),3.52);assert.equal(externalValue(data,c,'NET_MIGRATION'),7996);assert.equal(externalValue(data,c,'NATURAL_CHANGE'),-718);assert.equal(a.stage2,'先比較替代解釋');
});
test('LSF no silent period fill or city-only metrics on district branch',()=>{
 assert.equal(externalValue(data,{...c,year:111},'CRUDE_BIRTH_RATE'),null);
 assert.equal(changePct(undefined,42),null);assert.equal(changePct(42,0),null);
 assert.ok(!domainEvidence(data,c,'career').facts.some(f=>f.includes('失業率')||f.includes('薪資平均')));
 assert.ok(domainEvidence(data,{...c,geography:'新北市'},'career').facts.some(f=>f.includes('114年無青年薪資值')));
 assert.ok(domainEvidence(data,c,'housing').facts[0].includes('115年3月31日'));
});
test('LSF second-round rule covers missing, negative, incompatible and supportive branches',()=>{
 const good={compatible:true,demand:true,burden:true,localized:true,counterEvidence:false};
 assert.equal(secondRoundGate({...good,compatible:false}),'口徑待對齊');
 assert.equal(secondRoundGate({...good,counterEvidence:true}),'先比較替代解釋');
 assert.equal(secondRoundGate({...good,demand:false}),'保留觀察');
 assert.equal(secondRoundGate({...good,burden:null}),'補足需求與負擔證據');
 assert.equal(secondRoundGate({...good,sameSourceOnly:true}),'補獨立證據');
 assert.equal(secondRoundGate({...good,localized:null}),'第二輪：定位族群、地點與時段');
 assert.equal(secondRoundGate(good),'整理研究方向');
});
test('LSF current data never invents matched demand or service burden',()=>{
 for(const g of data.geographies)for(const d of ['housing','family','transport','services','career','environment'])assert.notEqual(domainEvidence(data,{...c,geography:g.name},d).stage2,'整理研究方向');
});

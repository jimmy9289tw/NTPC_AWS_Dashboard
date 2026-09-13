import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {normalizeEvidence,AiEvidenceTable,evidenceNumber} from '../app/ai-evidence-table.tsx';
import {analyzeRoa,type RoaSelection} from '../app/aws-roa-analysis.ts';
import {buildRoaCharts} from '../app/aws-roa-evidence.ts';
import {compareDimension} from '../app/dimension-order.ts';
import {monthlyChartLayout,monthlyTickIndices} from '../app/monthly-chart-layout.ts';
const rules=JSON.parse(readFileSync(new URL('../../roa-rules.json',import.meta.url),'utf8'));
const s:RoaSelection={scope:'district',place:'淡水區',year:114,age:'30-35',sex:'合計',topic:'population',category:'大學',marital:'未婚',salary:'全年總薪資中位數'};
const read=(selection:RoaSelection)=>{const rule=rules.topics.find((r:any)=>r.id===selection.topic);const a=analyzeRoa(selection,rule);return {a,...buildRoaCharts(selection,rule,a)}};
test('AI salary nested metrics become numbers, units and ranges; never JSON columns',()=>{
 const source={label:'青年薪資',period:'110年',universe:'工作場所',rows:[{year:110,ageBand:'18-35',metrics:{全年總薪資平均數:54.5,全年總薪資中位數:46.5},meta:{全年總薪資平均數:{unit:'萬元／年',origin:'模型估計',low:54.5,high:55.8}}}]};
 const result=normalizeEvidence(source);assert.equal(result.values.length,2);assert.equal(result.values[0].value,54.5);assert.equal(result.values[0].high,55.8);
 const html=renderToStaticMarkup(createElement(AiEvidenceTable,{source}));assert.ok(html.includes('54.5'));assert.ok(html.includes('55.8'));assert.ok(!html.includes('<pre'));assert.ok(!html.includes('metrics'));assert.ok(!html.includes('[object Object]'));
});
test('Missing and nonnumeric fields do not become zero or invalid numbers',()=>{
 for(const v of [null,undefined,NaN,Infinity,{},'無資料',false])assert.equal(evidenceNumber(v),null);
 const r=normalizeEvidence({label:'人口',period:'114年',universe:'戶籍',rows:[{year:114,population:null,populationOrigin:'缺值'}]});assert.equal(r.values[0].value,null);
});
test('No quadrant still has observed data: 110 base missing, 114 wage, site snapshot',()=>{
 const first=read({...s,year:110});assert.equal(first.a.classification.stableKey,null);assert.ok(first.y.series[1].points[1].value);
 const salary=read({...s,scope:'city',place:'新北市',topic:'salary'});assert.equal(salary.a.current,null);assert.ok(salary.cross[0].series[0].points.every(p=>p.value!=null));assert.equal(salary.y.series[1].points[1].value,null);
 const site=read({...s,topic:'service_sites'});assert.equal(site.a.current,null);assert.equal(site.x.series[0].points[1].value,site.a.growth?.value);
});
test('X and Y supporting charts match classifier exactly; district does not acquire city wages',()=>{
 const c=read(s);assert.equal(c.x.series[0].points[1].value,c.a.growth?.value);assert.equal(c.y.series[0].points[1].value,c.a.baseline?.value);assert.equal(c.y.series[1].points[1].value,17449);assert.ok(!c.cross.some(p=>p.title.includes('薪資')));
});
test('Sex dimensions are total, male, female; numeric years remain ordered',()=>{
 assert.deepEqual(['女','合計','男'].sort((a,b)=>compareDimension(a,b,'sex')),['合計','男','女']);assert.deepEqual(['114','110','112'].sort((a,b)=>compareDimension(a,b,'year')),['110','112','114']);
});
test('Monthly million-person tick has margin; last year and final month do not overlap',()=>{
 const g=monthlyChartLayout(800000,1000000);assert.ok(g.left>=121);
 const rows=Array.from({length:68},(_,i)=>({year:110+Math.floor(i/12),month:i%12+1}));const x=(i:number)=>g.left+i*(g.width-g.left-g.right)/67;
 const labels=monthlyTickIndices(rows,x,false);assert.equal(labels.at(-1),67);assert.ok(!labels.includes(60));for(let i=1;i<labels.length;i++)assert.ok(x(labels[i])-x(labels[i-1])>=80);
});
test('Missing-state evidence entry is outside conditional result; heading is semantic',()=>{
 const roa=readFileSync(new URL('../app/aws-roa.tsx',import.meta.url),'utf8');assert.ok(roa.indexOf('className="aws-evidence-entry"')<roa.indexOf('{pending?<p role="status">正在整理'));
 const page=readFileSync(new URL('../app/dashboard-client.tsx',import.meta.url),'utf8');assert.match(page,/<h2><small>第/);assert.match(page,/tickIndices.includes\(index\)/);assert.match(page,/data-motion-follow-points="monthly"/);
});

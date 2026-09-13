import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {tooltipPosition} from "../app/quadrant-chart-primitives.tsx";
import {buildSelectionRows,validateExportSelection} from "../app/export-selection.ts";
import {buildDistrictRankings,getPopulation} from "../app/district-annual-rankings.ts";
import {dashboardData, geographyLabel} from "../app/dashboard-data.ts";
import {exportTopics, type ExportSelection} from "../app/export-catalogue.ts";
import type {JointEducationMarriagePayload} from "../app/joint-education-marriage.ts";

const basic: ExportSelection={topic:"population",years:[114],ages:["18-35"],sexes:["合計"],districts:["蘆洲區"]};
test("提示層遇到上緣向下翻轉，左右均維持完整可讀",()=>{
  const top=tooltipPosition({left:50,top:40},{width:300,height:160},{width:375,height:667});
  assert.deepEqual(top,{left:8,top:52});
  const right=tooltipPosition({left:360,top:400},{width:300,height:160},{width:375,height:667});
  assert.deepEqual(right,{left:67,top:228});
});
test("蘆洲114年18–35合計和使用者圖片七項排名相符",()=>{
  const rows=buildDistrictRankings(114,"18-35","合計","蘆洲區");
  assert.deepEqual(rows.map(row=>row.rank),[8,2,18,22,9,17,7]);
  assert.equal(rows[0].value,45673);
  assert.equal(rows.at(-1)?.value,0);
});
test("5年×4組年齡×3種性別×29區：六項人口排名獨立重算一致",()=>{
  const names=dashboardData.geographies.filter(g=>g.level==="DISTRICT").map(g=>geographyLabel(g.name));
  const index=new Map(dashboardData.registered.map(row=>[[row.year,geographyLabel(row.geography),row.ageBand,row.sex].join("|"),row]));
  let checked=0;
  for(const year of dashboardData.meta.years) for(const age of dashboardData.meta.ageBands) for(const sex of dashboardData.meta.sexes){
    const read=(g:string)=>index.get([year,g,age,sex].join("|"))!;
    const values={
      population:names.map(g=>read(g).population),
      density:names.map(g=>read(g).population/read(g).landAreaKm2),
      change:names.map(g=>(read(g).population/getPopulation(year-1,g,age,sex)!-1)*100),
      married:names.map(g=>read(g).marriage["有偶"].value),
      unmarried:names.map(g=>read(g).marriage["未婚"].value),
      divorced:names.map(g=>read(g).marriage["離婚或終止結婚"].value),
    };
    for(const district of names){
      for(const row of buildDistrictRankings(year,age,sex,district)){
        if(row.key==="facilities") continue;
        const own=values[row.key][names.indexOf(district)];
        assert.equal(row.rank,1+values[row.key].filter(v=>v>own).length,[year,age,sex,district,row.key].join("|"));
        assert.ok(Math.abs(row.value!-own)<1e-7);
        checked++;
      }
    }
  }
  assert.equal(checked,10440);
});
test("新匯出主題涵蓋三母體及服務輔助層；拒絕不存在的交叉條件",()=>{
  assert.equal(exportTopics.length,11);
  assert.throws(()=>validateExportSelection({...basic,topic:"labor",sexes:["女"],districts:["新北市"]}),/性別/);
  assert.throws(()=>validateExportSelection({...basic,topic:"wage",districts:["淡水區"]}),/行政區/);
  assert.throws(()=>validateExportSelection({...basic,topic:"facilities",ages:["不適用"],sexes:["不適用"]}),/年度/);
  assert.throws(()=>validateExportSelection({...basic,districts:["不存在區"]}),/行政區/);
});
test("匯出男女不混用：行業可分女性，核心勞動固定合計",async()=>{
  const rows=await buildSelectionRows({...basic,topic:"industry",sexes:["女"],districts:["新北市"]});
  assert.equal(rows.length,38);assert.ok(rows.every(row=>row.sex_name_zh==="女"));
  const labor=await buildSelectionRows({...basic,topic:"labor",districts:["新北市"]});
  assert.equal(labor.length,9);assert.ok(labor.every(row=>row.sex_name_zh==="合計"));
});
test("薪資四年×四組×平均中位數共32列；114不代填",async()=>{
  const rows=await buildSelectionRows({...basic,topic:"wage",years:[110,111,112,113],ages:["18-24","25-29","30-35","18-35"],districts:["新北市"]});
  assert.equal(rows.length,32);assert.ok(rows.every(row=>row.value!=null));
  const missing=await buildSelectionRows({...basic,topic:"wage",districts:["新北市"]});
  assert.equal(missing.length,2);assert.ok(missing.every(row=>row.value===null));
});
test("月資料保留月份和年底值，不把12個月加總",async()=>{
  const rows=await buildSelectionRows({...basic,topic:"monthly",districts:["新北市"]});
  assert.equal(rows.length,12);assert.equal(rows.find(row=>row.roc_month===12)?.value,845938);
  assert.equal(new Set(rows.map(row=>row.record_id)).size,12);
});
test("教育×婚姻每組20格，保留計數、分母、方法與上下限",async()=>{
  const payload=JSON.parse(readFileSync(new URL("../public/data/joint-education-marriage-districts/65000100.json",import.meta.url),"utf8")) as JointEducationMarriagePayload;
  const rows=await buildSelectionRows({...basic,topic:"joint",districts:["淡水區"]},async()=>payload);
  assert.equal(rows.length,40);
  const shares=rows.filter(row=>row.metric_code==="JOINT_SHARE");
  assert.equal(shares.length,20);assert.ok(shares.every(row=>row.education_name_zh&&row.marriage_name_zh&&Number(row.denominator)>0&&row.source_url));
  assert.equal(new Set(rows.map(row=>row.record_id)).size,40);
});
test("據點只使用115清冊；記錄地址與官方連結",async()=>{
  const rows=await buildSelectionRows({topic:"facilities",years:[115],ages:["不適用"],sexes:["不適用"],districts:["新北市"]});
  assert.ok(rows.length>0);assert.ok(rows.every(row=>row.facility_address&&row.source_url&&row.roc_year===115));
});
test("政策分類連結具名；執行準備移到M，圖表的查看資料表保留",()=>{
  const src=readFileSync(new URL("../app/policy-narrative-workbench.tsx",import.meta.url),"utf8");
  assert.match(src,/<strong>{fact.label}<\/strong>/);
  const a=src.split('<Stage code="A"')[1].split('<Stage code="M"')[0];
  const m=src.split('<Stage code="M"')[1].split('<Stage code="E"')[0];
  assert.doesNotMatch(a,/執行準備與取捨/);assert.match(m,/執行準備與取捨/);
});

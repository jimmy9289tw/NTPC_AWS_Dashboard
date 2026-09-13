import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {estimate,explainQuadrant,testAxis,quadrant} from '../app/aws-roa-model.ts';
import {analyzeRoa,type RoaSelection} from '../app/aws-roa-analysis.ts';
import {buildRoaDirection} from '../app/aws-roa-directions.ts';
import {dashboardData as data,geographyLabel} from '../app/dashboard-data.ts';
const rules=JSON.parse(readFileSync(new URL('../../roa-rules.json',import.meta.url),'utf8'));
const context=JSON.parse(readFileSync(new URL('../../roa-context.json',import.meta.url),'utf8'));
const rule=(topic:string)=>rules.topics.find((r:any)=>r.id===topic);
const pick:RoaSelection={scope:'district',place:'淡水區',year:114,age:'30-35',sex:'合計',topic:'population',category:'大學',marital:'未婚',salary:'全年總薪資中位數'};
const analyze=(overrides:Partial<RoaSelection>={})=>{const s={...pick,...overrides};return analyzeRoa(s,rule(s.topic))};

test('範圍跨界保留點估計參考，不改正式象限',()=>{
  const r=explainQuadrant(estimate(1,-1,2),estimate(20,19,21),estimate(10),rule('population'));
  assert.equal(r.stableKey,null);assert.equal(r.pointKey,'11');assert.equal(r.axes.x.state,'boundary');assert.deepEqual(r.possibleKeys,['01','11']);
});
test('兩組原始範圍重疊不代表所有規則都不能使用',()=>{
  assert.equal(testAxis(estimate(6,5,7),estimate(0),'gt'),true);
  assert.equal(testAxis(estimate(7,6,8),estimate(0),'gt'),true);
});
test('相等邊界保留原有 > 與 >= 定義',()=>{
  assert.equal(explainQuadrant(estimate(0),estimate(10),estimate(10),rule('population')).stableKey,'01');
  assert.equal(explainQuadrant(estimate(0,0,1),estimate(10),estimate(10),rule('population')).axes.x.state,'boundary');
});
test('110年缺109比較不是估計跨界，仍有當年值',()=>{
  const a=analyze({year:110});assert.ok(a.current);assert.equal(a.classification.status,'missing');
  assert.ok(a.reasons.some(r=>r.code==='previous_missing'&&r.text.includes('109')));
});
test('青年據點115快照不冒充114，不缺值補零',()=>{
  const a=analyze({topic:'service_sites'});assert.equal(a.current,null);assert.equal(a.classification.stableKey,null);
  assert.ok(a.reasons.some(r=>r.code==='period_mismatch'&&r.text.includes('115')));
});
test('114青年薪資缺值不冒充跨界，不借全年齡薪資',()=>{
  const a=analyze({scope:'city',place:'新北市',topic:'salary'});assert.equal(a.current,null);assert.equal(a.classification.status,'missing');
  assert.ok(a.reasons.some(r=>r.text.includes('110–113')));
});
test('未載入交叉資料被診斷為缺資料，不能當範圍跨界',()=>{
  const a=analyze({topic:'education_marriage'});assert.equal(a.classification.status,'missing');assert.ok(a.reasons.some(r=>r.code==='baseline_incomplete'));
});
test('淡水實際青年人口與特定地方證據，不指稱已完成工程尚有缺口',()=>{
  const a=analyze(),d=buildRoaDirection(pick,a,context)!;
  assert.equal(a.current!.value,17449);assert.equal(a.previous!.value,16451);assert.equal(a.growth!.value,6.07);
  assert.equal(a.classification.stableKey,'11');
  assert.ok(d.evidence.some(e=>e.text.includes('998')));
  assert.ok(d.evidence.some(e=>e.text.includes('445')&&e.text.includes('完工')));
  assert.ok(d.evidence.some(e=>e.text.includes('3.95')&&e.text.includes('3.52')));
  assert.ok(d.evidence.some(e=>e.text.includes('17,000')&&e.period.includes('11503')));
  assert.ok(d.action.includes('轉乘資訊'));assert.ok(d.followup.includes('不重複'));
});
test('改行政區不殘留淡水專案；性別、年齡與數字同步',()=>{
  const s={...pick,place:'新莊區',sex:'女' as const,age:'18-24' as const};
  const a=analyzeRoa(s,rule(s.topic)),d=buildRoaDirection(s,a,context)!;
  assert.ok(d.evidence.some(e=>e.text.includes('新莊區18–24歲・女')));
  assert.ok(!JSON.stringify(d).includes('淡海路'));assert.ok(!JSON.stringify(d).includes('淡水'));
  assert.notEqual(d.title,buildRoaDirection(pick,analyze(),context)!.title);
});
test('未婚／有偶／離婚／喪偶提案各有不同主題',()=>{
  const texts=['未婚','有偶','離婚或終止結婚','喪偶'].map(marital=>{const s={...pick,topic:'marriage',marital};return buildRoaDirection(s,analyzeRoa(s,rule(s.topic)),context)!.action});
  assert.equal(new Set(texts).size,4);
  assert.ok(texts[0].includes('興趣活動'));assert.ok(texts[1].includes('家庭諮詢'));assert.ok(texts[2].includes('法律資訊'));
});
test('地方背景缺值保持空缺，不補成零租金，並與分類完全隔離',()=>{
  assert.equal(context.rentDistrictsWithAnyValue,23);
  assert.ok(context.facts.every((r:any)=>Number.isFinite(r.value)));
  const before=analyze();buildRoaDirection(pick,before,null);buildRoaDirection(pick,before,context);
  assert.deepEqual(before,analyze());
});
test('29區完整分齡性別年份各主題：說明不改動原四象限運算',()=>{
  let count=0;
  for(const g of data.geographies.filter(g=>g.name!=='新北市'))for(const year of [110,111,112,113,114])for(const age of data.meta.ageBands)for(const sex of data.meta.sexes)for(const topic of ['population','density','education','marriage','service_sites']){
    const s={...pick,place:geographyLabel(g.name),year,age,sex,topic};const a=analyzeRoa(s,rule(topic));
    assert.equal(a.classification.stableKey,quadrant(a.growth,a.current,a.baseline,rule(topic)));
    if(a.classification.status==='boundary')assert.ok(a.classification.pointKey&&a.classification.possibleKeys.includes(a.classification.pointKey));
    count++;
  }assert.equal(count,8700);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {estimate,difference,aggregate,quadrant} from '../app/aws-roa-model.ts';
const rule={x:{operator:'gt'},y:{operator:'gte',reference:'scope_baseline'}};
test('四象限完全對應X與Y，不以顏色代替規則',()=>{
  for(const [x,y,key] of [[1,11,'11'],[-1,11,'01'],[1,9,'10'],[-1,9,'00']] as const)assert.equal(quadrant(estimate(x),estimate(y),estimate(10),rule),key);
});
test('缺值與估計跨界不分級',()=>{
  assert.equal(quadrant(null,estimate(11),estimate(10),rule),null);
  assert.equal(quadrant(estimate(1,-1,2),estimate(11),estimate(10),rule),null);
  assert.equal(quadrant(estimate(1),estimate(11,9,12),estimate(10),rule),null);
});
test('使用顯示數值計算相鄰年度差距',()=>assert.equal(difference(estimate(30.126),estimate(29.114))?.value,1.02));
test('比率年增以百分點；人口年增使用百分比',()=>{
  assert.equal(difference(estimate(20),estimate(10))?.value,10);
  assert.equal(difference(estimate(20),estimate(10),true)?.value,100);
});
test('完整基準和零分母保護',()=>{
  assert.equal(aggregate([estimate(1),null],'median'),null);
  assert.equal(aggregate([estimate(1),estimate(7),estimate(3)],'median')?.value,3);
  assert.equal(difference(estimate(20),estimate(0),true),null);
});

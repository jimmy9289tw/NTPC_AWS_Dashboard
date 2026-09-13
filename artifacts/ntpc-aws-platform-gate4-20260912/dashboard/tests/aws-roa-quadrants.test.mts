import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RoaQuadrants} from '../app/aws-roa-quadrants.tsx';

const rules=JSON.parse(readFileSync(new URL('../../roa-rules.json',import.meta.url),'utf8'));
const render=(topic:string,selectedKey:string|null='11',pointKey:string|null=null)=>renderToStaticMarkup(createElement(RoaQuadrants,{
  rule:rules.topics.find((r:{id:string})=>r.id===topic),quadrants:rules.quadrants,selectedKey,pointKey,
}));

test('每個主題的X、Y標籤都在四象限圖內，而非圖後說明',()=>{
  for(const rule of rules.topics){
    const html=render(rule.id);
    assert.ok(html.startsWith('<figure'));
    assert.match(html,/class="aws-quadrant-y" data-axis="y"/);
    assert.match(html,/class="aws-quadrant-x" data-axis="x"/);
    assert.ok(html.includes(`<span>${rule.x.label}</span>`));
    assert.ok(html.includes(`<span>${rule.y.label}</span>`));
    assert.deepEqual([...html.matchAll(/data-quadrant="(\d\d)"/g)].map(m=>m[1]),['01','11','00','10']);
    assert.ok(html.endsWith('</figure>'));
  }
});
test('薪資與據點保留原條件方向，不誤標成越高越需關注',()=>{
  for(const topic of ['salary','service_sites','employment']){
    const rule=rules.topics.find((r:{id:string})=>r.id===topic);
    const html=render(topic);
    assert.ok(html.includes(`右側：${rule.x.yes}；左側：${rule.x.no}。上方：${rule.y.yes}；下方：${rule.y.no}。`));
  }
});
test('正式位置、點估計參考與無值三種狀態仍分開',()=>{
  assert.equal((render('population').match(/aria-current="true"/g)||[]).length,1);
  const tentative=render('marriage',null,'01');
  assert.ok(tentative.includes('tentative'));
  assert.ok(tentative.includes('◇ 點估計參考'));
  assert.ok(!tentative.includes('aria-current="true"'));
  assert.ok(!render('service_sites',null).includes('◇ 點估計參考'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {selectDistrictFeatures} from '../app/aws-region-map.ts';

const geo=JSON.parse(readFileSync(new URL('../public/data/ntpc-districts.geojson',import.meta.url),'utf8'));
const bootstrap=JSON.parse(readFileSync(new URL('../../live-bootstrap.json',import.meta.url),'utf8'));
const names=bootstrap.dashboard.geographies.filter((g:any)=>g.name!=='新北市').map((g:any)=>g.name.replace(/^新北市/,''));

test('實際地圖30筆只繪製29區，不讓最後的全區輪廓遮住行政區',()=>{
  assert.equal(geo.features.length,30);
  assert.equal(geo.features.at(-1).properties.TOWNNAME,'全區');
  const selected=selectDistrictFeatures(geo,names);
  assert.equal(selected.length,29);
  assert.deepEqual(new Set(selected.map(f=>f.properties.TOWNNAME)),new Set(names));
  assert.ok(!selected.some(f=>f.properties.TOWNNAME==='全區'));
  for(const feature of selected)assert.ok(geo.features.includes(feature),'保留原始行政區座標');
});
test('缺區、重複區或缺少幾何時不繪製不完整地圖',()=>{
  assert.throws(()=>selectDistrictFeatures({features:geo.features.slice(1)},names));
  assert.throws(()=>selectDistrictFeatures({features:[...geo.features,geo.features[0]]},names));
  assert.throws(()=>selectDistrictFeatures({features:geo.features.map((f:any,i:number)=>i===0?{...f,geometry:null}:f)},names));
  assert.throws(()=>selectDistrictFeatures(null,names));
});
test('非新北市、全市合併輪廓與不在29區清單的項目不得變成可點區域',()=>{
  const extra={...geo.features[0],properties:{COUNTYNAME:'其他縣市',TOWNNAME:'石門區'}};
  assert.equal(selectDistrictFeatures({features:[...geo.features,extra]},names).length,29);
  assert.throws(()=>selectDistrictFeatures(geo,[...names.slice(1),'全區']));
});
test('政策選區保留鍵盤、焦點提示、載入錯誤與地區清單替代方案',()=>{
  const source=readFileSync(new URL('../app/aws-roa.tsx',import.meta.url),'utf8');
  assert.match(source,/setFeatures\(selectDistrictFeatures\(geo,names\)\)/);
  assert.match(source,/features\.map\(\(feature:any\)/);
  assert.doesNotMatch(source,/geo\.features\.map/);
  assert.match(source,/role="group" aria-label="選擇新北市29個行政區"/);
  assert.match(source,/e\.key==='Enter'\|\|e\.key===' '/);
  assert.match(source,/fillRule="evenodd" vectorEffect="non-scaling-stroke"/);
  assert.match(source,/或使用地區清單/);
  assert.match(source,/setScope\('district'\);setRegion\(''\)/,'從全市返回行政區時重新顯示地圖');
  assert.match(source,/if\(loadError\)return <p role="alert">/);
});

test('地圖以行政區輪廓取代矩形焦點框，其他控制項不受影響',()=>{
  const css=readFileSync(new URL('../app/workspace-ui.css',import.meta.url),'utf8');
  const scoped=css.slice(css.indexOf('/* SVG districts use their geographic contour'));
  assert.match(scoped,/svg path:is\(\.annual-map-district, \.policy-picker-district, \.district\):focus,/);
  assert.match(scoped,/svg\.aws-region-map path\[role="button"\]:focus \{\s*outline: none;/);
  assert.match(scoped,/:focus-visible \{\s*stroke: #0b2f47;\s*stroke-width: 5;/);
  assert.match(css,/\.shell :is\(button, select, input, textarea, summary\):focus-visible/);
});

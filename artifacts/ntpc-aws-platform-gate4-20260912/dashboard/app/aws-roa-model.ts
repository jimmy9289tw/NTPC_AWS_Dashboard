export type Estimate={value:number;low:number;high:number;origin:string};
export const rounded=(n:number,places=2)=>Number(n.toFixed(places));
export function estimate(value:any, low?:any, high?:any, origin='官方值'):Estimate|null {
  if(value==null||!Number.isFinite(Number(value))) return null;
  const v=rounded(Number(value));
  return {value:v,low:rounded(Math.min(v,low??v)),high:rounded(Math.max(v,high??v)),origin};
}
export function difference(a:Estimate|null,b:Estimate|null,pct=false):Estimate|null {
  if(!a||!b||(pct&&b.low<=0))return null;
  const f=(x:number,y:number)=>pct?(x/y-1)*100:x-y;
  return estimate(f(a.value,b.value),f(a.low,b.high),f(a.high,b.low),a.origin===b.origin?a.origin:'同口徑資料計算');
}
export function aggregate(values:(Estimate|null)[],kind:'median'|'mean'):Estimate|null {
  if(!values.length||values.some(v=>!v))return null;
  const get=(key:keyof Estimate)=>{
    const v=values.map(x=>x![key] as number).sort((a,b)=>a-b);
    return kind==='mean'?v.reduce((a,b)=>a+b,0)/v.length:v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2;
  };
  return estimate(get('value'),get('low'),get('high'),'同口徑比較基準');
}
export function testAxis(a:Estimate|null,b:Estimate|null,op:string):boolean|null {
  if(!a||!b)return null;
  const test=(x:number,y:number)=>op==='gt'?x>y:op==='gte'?x>=y:op==='lt'?x<y:op==='lte'?x<=y:x===y;
  const tests=[test(a.low,b.low),test(a.low,b.high),test(a.high,b.low),test(a.high,b.high)];
  return tests.every(v=>v===tests[0])?tests[0]:null;
}
export function quadrant(x:Estimate|null,y:Estimate|null,baseline:Estimate|null,rule:any) {
  const xb=testAxis(x,estimate(0),rule.x.operator),yb=testAxis(y,rule.y.reference==='zero'?estimate(0):baseline,rule.y.operator);
  return xb===null||yb===null?null:`${Number(xb)}${Number(yb)}`;
}

export type AxisReading={state:'stable'|'boundary'|'missing';result:boolean|null;point:boolean|null;value:Estimate|null;reference:Estimate|null};
// The existing endpoint-envelope test is a sensitivity check, not a significance test.
export function axisReading(a:Estimate|null,b:Estimate|null,operator:string):AxisReading {
  if(!a||!b)return {state:'missing',result:null,point:null,value:a,reference:b};
  const result=testAxis(a,b,operator);
  const point=testAxis(estimate(a.value),estimate(b.value),operator);
  return {state:result===null?'boundary':'stable',result,point,value:a,reference:b};
}
export function explainQuadrant(x:Estimate|null,y:Estimate|null,baseline:Estimate|null,rule:any) {
  const axes={x:axisReading(x,estimate(0),rule.x.operator),y:axisReading(y,rule.y.reference==='zero'?estimate(0):baseline,rule.y.operator)};
  const stableKey=quadrant(x,y,baseline,rule);
  const pointKey=axes.x.point===null||axes.y.point===null?null:`${Number(axes.x.point)}${Number(axes.y.point)}`;
  const possibleKeys=axes.x.state==='missing'||axes.y.state==='missing'?[]:
    ['00','01','10','11'].filter(k=>(axes.x.result===null||Number(k[0])===Number(axes.x.result))&&(axes.y.result===null||Number(k[1])===Number(axes.y.result)));
  return {axes,stableKey,pointKey,possibleKeys,status:stableKey?'stable':pointKey?'boundary':'missing'};
}

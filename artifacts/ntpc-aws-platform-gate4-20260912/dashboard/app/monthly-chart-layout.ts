export function monthlyChartLayout(minimum:number,maximum:number){
  const labels=Array.from({length:5},(_,i)=>(maximum-(maximum-minimum)*i/4).toLocaleString('zh-TW',{maximumFractionDigits:0}));
  const left=Math.max(92,Math.max(...labels.map(s=>s.length))*9+40);
  return {width:760,height:308,left,right:22,top:38,bottom:56,labels};
}
export function monthlyTickIndices(rows:{year:number;month:number}[],x:(i:number)=>number,sameMonth:boolean){
  if(!rows.length)return [];
  const last=rows.length-1,chosen=[0];
  for(let i=1;i<last;i++)if((sameMonth||rows[i].month===1)&&x(i)-x(chosen.at(-1)!)>=80&&x(last)-x(i)>=90)chosen.push(i);
  if(last>0)chosen.push(last);
  return chosen;
}

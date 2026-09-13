const sexOrder:Record<string,number>={'合計':0,'男女合計':0,'男':1,'男性':1,'女':2,'女性':2};
export function compareDimension(a:string,b:string,dimension:string){
  return dimension==='sex'?(sexOrder[a]??99)-(sexOrder[b]??99)||a.localeCompare(b,'zh-TW'):a.localeCompare(b,'zh-TW',{numeric:true});
}

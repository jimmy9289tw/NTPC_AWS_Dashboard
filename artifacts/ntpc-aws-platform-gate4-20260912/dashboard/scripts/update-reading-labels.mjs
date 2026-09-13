// Bounded mechanical copy update; does not touch metric bindings or calculations.
import {readFileSync,writeFileSync} from 'node:fs';
const file=new URL('../app/dashboard-client.tsx',import.meta.url);
const labels=['先看青年占多少','再看人口怎麼變','了解婚姻分布','了解教育結構','有多少人就業','多少人參與勞動','就業與失業各占多少','多少人未參與勞動','平均薪資怎麼變','中位薪資怎麼變','兩者差多少','估計範圍在哪裡','工作集中在哪','哪些行業最多','不同年齡做什麼','男女分布有何不同'];
let input=readFileSync(file,'utf8'),index=0;
const pattern=/<span className="quadrant-label">第[一二三四]象限<\/span>/g;
if([...input.matchAll(pattern)].length!==labels.length)throw Error('Unexpected label count; no write');
input=input.replace(pattern,()=>`<span className="quadrant-label">${labels[index++]}</span>`)
  .replace('label="四象限閱讀順序"','label="圖表閱讀順序"')
  .replace('戶籍人口四象限年度分析','戶籍人口年度比較分析');
writeFileSync(file,input);
console.log(`Updated ${index} reading labels; metric bindings unchanged.`);

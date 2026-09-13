import fs from 'node:fs';
function edit(path,pairs){let source=fs.readFileSync(path,'utf8').replaceAll('\r\n','\n');for(const [from,to] of pairs){if(source.includes(to))continue;if(!source.includes(from))throw Error(`Missing match in ${path}: ${from.slice(0,60)}`);source=source.replace(from,to);}fs.writeFileSync(path,source);}
edit('app/aws-roa.tsx',[
 ['{points.some(p=>p.value||p.base)&&<CompareChart points={points} unit={rule.y.unit}/>}','{charts&&points.some(p=>p.value||p.base)&&<NarrativeChart chart={charts.y}/>}'],
 ['pointKey={classification?.pointKey}/>','pointKey={classification?.pointKey} onEvidence={setEvidence}/>'],
 ['{pending?<p role="status">正在整理所選地區', '<button className="aws-evidence-entry" onClick={()=>setEvidence(\'both\')}>查看支持證據與可交叉分析 →</button>\n      {pending?<p role="status">正在整理所選地區'],
 ['  </section>;\n}', '    {ready&&analysis&&evidence&&<RoaEvidenceDrawer selection={selection} rule={rule} analysis={analysis} joint={joint} direction={direction} initial={evidence} onClose={closeEvidence}/>}\n  </section>;\n}']
]);
edit('app/dashboard-client.tsx',[
 ['<span>{String(index).padStart(2, "0")}</span>\n      <div><strong>{title}</strong>', '<span aria-hidden="true">{String(index).padStart(2, "0")}</span>\n      <div><h2><small>第{["", "一", "二", "三", "四"][index] ?? index}部分</small>{title}</h2>'],
 ['title="先用四象限讀完五年變化"','title="先看五年人口與生活結構"'],
 ['title="先用四象限讀完五年勞動變化"','title="先看五年的就業與勞動變化"'],
 ['const showLabel = sameMonth || row.month === 1 || index === analyzed.length - 1;', 'const showLabel = tickIndices.includes(index);'],
 ['textAnchor={index === analyzed.length - 1 ? "end" : "middle"}', 'textAnchor={index === analyzed.length - 1 ? "end" : index === 0 ? "start" : "middle"}'],
 ['<h3>{geography}{ageBandLabel(ageBand)}{sameMonth ?', '<h3>{shown ? `${geographyLabel(shown.geography)}${ageBandLabel(shown.ageBand)}` : geography}{sameMonth ?'],
 ['<path data-motion-key="monthly-line"','<path data-motion-follow-points="monthly" data-motion-key="monthly-line"'],
 ['<circle data-motion-key={row.period}', '<circle data-motion-series="monthly" data-motion-key={row.period}']
]);
edit('app/custom-analysis-workbench.tsx',[[ 'unique(rows.map((row) => row.sex)).map', 'unique(rows.map((row) => row.sex)).sort((a,b)=>compareDimension(a,b,"sex")).map' ]]);
console.log('Updated ROA evidence links, section hierarchy, monthly labels and sex ordering.');

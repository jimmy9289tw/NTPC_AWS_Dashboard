type AxisLabel = {label:string;yes:string;no:string};
type QuadrantLabel = {level:string;label:string};

/** Axes describe the rule's two conditions, not a universal numeric increase. */
export function RoaQuadrants({rule,quadrants,selectedKey,pointKey,onEvidence}:{
  rule:{x:AxisLabel;y:AxisLabel};
  quadrants:Record<string,QuadrantLabel>;
  selectedKey:string|null;
  pointKey?:string|null;
  onEvidence?:(axis:'both'|'x'|'y')=>void;
}) {
  return <figure className="aws-quadrant-figure" aria-label={`四象限：X軸 ${rule.x.label}；Y軸 ${rule.y.label}`}>
    <div className="aws-quadrant-y" data-axis="y"><b>Y 軸</b><span>{rule.y.label}</span></div>
    <div className="aws-quadrant-plot">
      <div className="aws-quadrants">
        {['01','11','00','10'].map(k=><div key={k} data-quadrant={k}
          className={`aws-quadrant ${quadrants[k].level} ${selectedKey===k?'selected':''} ${!selectedKey&&pointKey===k?'tentative':''}`}
          aria-current={selectedKey===k?'true':undefined}>
          {onEvidence&&(selectedKey===k||!selectedKey&&pointKey===k)?<>
            <button className="aws-quadrant-evidence" onClick={()=>onEvidence('both')}><strong>{selectedKey===k?'● 本次位置 · ':'◇ 點估計參考 · '}{quadrants[k].label} ↗</strong></button>
            <button className="aws-quadrant-evidence" onClick={()=>onEvidence('x')}>{k[0]==='1'?rule.x.yes:rule.x.no} ↗</button>
            <button className="aws-quadrant-evidence" onClick={()=>onEvidence('y')}>{k[1]==='1'?rule.y.yes:rule.y.no} ↗</button>
          </>:<><strong>{selectedKey===k?'● 本次位置 · ':!selectedKey&&pointKey===k?'◇ 點估計參考 · ':''}{quadrants[k].label}</strong><span>{k[0]==='1'?rule.x.yes:rule.x.no}</span><span>{k[1]==='1'?rule.y.yes:rule.y.no}</span></>}
        </div>)}
      </div>
    </div>
    <div className="aws-quadrant-x" data-axis="x"><b>X 軸</b><span>{rule.x.label}</span></div>
    <figcaption className="aws-quadrant-caption">右側：{rule.x.yes}；左側：{rule.x.no}。上方：{rule.y.yes}；下方：{rule.y.no}。</figcaption>
  </figure>;
}

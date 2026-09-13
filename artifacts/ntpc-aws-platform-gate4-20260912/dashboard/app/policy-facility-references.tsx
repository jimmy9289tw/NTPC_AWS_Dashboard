import { dashboardData, getServiceFacilities, type ServiceFacility } from "./dashboard-data";

function FacilityList({ facilities }: { facilities: ServiceFacility[] }) {
  return <ul className="pn-facility-list">{facilities.map(f => <li key={f.facilityCode}>
    <div><a href={f.sourceUrl} target="_blank" rel="noreferrer">{f.name} ↗</a><span>{f.active ? "營運中" : "暫停營運（清冊狀態）"}</span></div>
    <p>{f.district}｜{f.address || "清冊未提供地址"}</p>
  </li>)}</ul>;
}

export function FacilityReferences({ district }: { district: string }) {
  const local = getServiceFacilities(district);
  const others = district === "新北市" ? [] : getServiceFacilities("新北市").filter(f => f.district !== district);
  return <section className="pn-facility-references" aria-label="青年據點地址與官方連結">
    <h4>青年據點｜地點與官方資訊</h4>
    <p>{dashboardData.service.snapshotYear}年清冊快照 · {district}列有{local.length}處，其中{local.filter(f => f.active).length}處營運中。</p>
    {local.length > 0 ? <details className="pn-details"><summary>查看{district}據點地址與連結（{local.length}處）</summary><FacilityList facilities={local} /></details> : <p>這份清冊未列出{district}據點。</p>}
    {others.length > 0 && <details className="pn-details"><summary>其他行政區據點，供合作洽詢參考（{others.length}處）</summary><FacilityList facilities={others} /></details>}
  </section>;
}

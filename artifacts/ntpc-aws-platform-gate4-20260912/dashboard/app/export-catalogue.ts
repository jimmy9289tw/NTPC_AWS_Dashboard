/** UI-only catalogue: no population data or source credentials in this module. */
export const exportTopics = [
  { id: "population", label: "人口數、占比與密度", group: "registered", region: true, sex: true, ages: true, note: "110–114年年底；全新北市或29行政區。" },
  { id: "education", label: "教育程度", group: "registered", region: true, sex: true, ages: true, note: "五種教育程度，占同條件戶籍人口比率。" },
  { id: "marriage", label: "婚姻狀態", group: "registered", region: true, sex: true, ages: true, note: "四種婚姻狀態，占同條件戶籍人口比率。" },
  { id: "joint", label: "教育×婚姻交叉", group: "registered", region: true, sex: true, ages: true, note: "各教育程度內的婚姻占比與人數；保留模型上下限。" },
  { id: "monthly", label: "每月戶籍人口", group: "registered", region: true, sex: true, ages: true, note: "月末存量；一個月一列，不把12個月人口加總。" },
  { id: "labor", label: "就業、失業與勞參率", group: "labor", region: false, sex: false, ages: true, note: "全新北市、男女合計；含各人數及比率。" },
  { id: "industry", label: "青年就業者行業結構", group: "labor", region: false, sex: true, ages: true, note: "居住於新北市的就業者，可分年齡及性別。" },
  { id: "wage", label: "全年薪資平均數與中位數", group: "wage", region: false, sex: false, ages: true, note: "110–113年；114年保留缺值，不以前一年代填。" },
  { id: "wage-industry", label: "行業別青年薪資", group: "wage", region: false, sex: false, ages: true, note: "113年模型估計；不適用的行業保留缺值及原因。" },
  { id: "service", label: "服務場次與參與人次", group: "service", region: false, sex: false, ages: false, note: "服務輔助層；不按青年年齡或性別拆分，不與三母體合併。" },
  { id: "facilities", label: "青年據點與量能", group: "service", region: true, sex: false, ages: false, note: "115年清冊快照，含地址與官方連結；非歷年據點數。" },
] as const;
export type ExportTopic = typeof exportTopics[number]["id"];
export const exportGroupLabels = { registered: "戶籍人口母體", labor: "民間人口及勞動市場母體", wage: "受僱員工薪資母體", service: "服務輔助資料（另存第4類）" };
export type ExportSelection = { topic: ExportTopic; years: number[]; ages: string[]; sexes: string[]; districts: string[] };
export const exportTopic = (id: string) => exportTopics.find(topic => topic.id === id);

/** The optional three-file shortcut uses the same visible selection, never hidden page props. */
export function quickAnnualExportContext(selection: ExportSelection) {
  if (selection.years.length !== 1 || selection.ages.length !== 1 || selection.sexes.length !== 1 || selection.districts.length !== 1) return null;
  const [year] = selection.years, [ageBand] = selection.ages, [sex] = selection.sexes, [district] = selection.districts;
  if (!Number.isInteger(year) || year < 110 || year > 114 || !district.trim() || !["18-35", "18-24", "25-29", "30-35"].includes(ageBand) || !["合計", "男", "女"].includes(sex)) return null;
  return { year, ageBand, sex, district };
}

/** Display names only; routes, permissions and statistical definitions stay unchanged. */
export const navigationLabels = {
  overview: "資料入口",
  registered: "人口結構｜全市",
  district: "人口結構｜29區",
  labor: "就業與失業",
  industry: "青年就業行業",
  wage: "青年薪資",
  policy: "政策研判",
  custom: "自訂分析",
  export: "資料匯出",
} as const;

export const entryPeriods = {
  registered: "110–114年",
  district: "110–114年",
  labor: "110–114年",
  industry: "110–114年",
  wage: "110–113年；114年待發布",
  policy: "依所選議題資料年度",
  custom: "依所選資料可用年度",
  export: "依所選主題資料年度",
} as const;

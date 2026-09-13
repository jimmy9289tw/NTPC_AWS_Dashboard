export type PolicySourceStatus = {
  id: string;
  topic: string;
  latestOfficialPeriod: string;
  dashboardPeriod: string;
  status: "已是最新同口徑" | "等待同口徑發布";
  identity: string;
  note: string;
  url: string;
};

export const sourceVerifiedAt = "2026-09-07";

export const policySourceStatus: PolicySourceStatus[] = [
  {
    id: "population",
    topic: "戶籍人口",
    latestOfficialPeriod: "115年7月",
    dashboardPeriod: "110年1月–114年12月",
    status: "已是最新同口徑",
    identity: "官方行政精確值",
    note: "官方單一年齡月資料已發布到115年；依既定完整年度窗規則，本期仍比較110–114年，115年只列入每日更新監測。",
    url: "https://data.gov.tw/dataset/77132",
  },
  {
    id: "education-marriage",
    topic: "教育×婚姻×年齡×性別",
    latestOfficialPeriod: "114年",
    dashboardPeriod: "110–114年",
    status: "已是最新同口徑",
    identity: "官方行政資料；部分青年邊界為模型估計",
    note: "114年交叉表已納入；25–29歲可直接使用，其他青年帶保留PCLM與IPF身分及敏感度。",
    url: "https://data.gov.tw/dataset/117988",
  },
  {
    id: "labor",
    topic: "就業、失業與勞動參與",
    latestOfficialPeriod: "114年",
    dashboardPeriod: "110–114年",
    status: "已是最新同口徑",
    identity: "官方人力資源調查估計；部分青年帶為模型換算",
    note: "年度數值是全年12個月平均；不得改稱12月底存量，也不得分攤成行政區數值。",
    url: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
  },
  {
    id: "wage-youth",
    topic: "新北市青年全年總薪資",
    latestOfficialPeriod: "113年",
    dashboardPeriod: "110–113年；114年保留缺值",
    status: "等待同口徑發布",
    identity: "官方大數據統計錨定之18–35歲模型估計",
    note: "官方表6目前仍以113年為最新的新北市×年齡同口徑資料；114年全國平均或其他調查不能代填新北市青年值。",
    url: "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642",
  },
  {
    id: "industry",
    topic: "居住於新北市青年就業者行業",
    latestOfficialPeriod: "114年",
    dashboardPeriod: "110–114年",
    status: "已是最新同口徑",
    identity: "官方調查邊際經PCLM與IPF模型估計",
    note: "採居住地口徑與19類行業；不是工作地、職業別或薪資因果證據。",
    url: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
  },
];

export const ukPolicyGuidance = [
  {
    name: "The Green Book 2026",
    role: "用ROAMEF把政策理由、目標、選項評估、監測、評估與回饋串成同一條決策鏈。",
    url: "https://www.gov.uk/government/publications/the-green-book-appraisal-and-evaluation-in-central-government/the-green-book-2026",
  },
  {
    name: "The Magenta Book 2026",
    role: "在方案形成前先規劃過程、影響與成本效益評估，並區分描述性證據與因果證據。",
    url: "https://www.gov.uk/government/publications/the-magenta-book",
  },
  {
    name: "Test and Learn",
    role: "證據不足時先做小規模、可衡量、可比較的試辦，再決定是否擴大。",
    url: "https://www.gov.uk/government/publications/the-magenta-book/test-and-learn-html",
  },
];

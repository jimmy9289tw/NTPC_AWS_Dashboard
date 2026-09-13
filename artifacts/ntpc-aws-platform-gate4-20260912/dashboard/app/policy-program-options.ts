import type { IntegratedPolicyCase } from "./policy-synthesis";
import type { PolicyContext } from "./policy-narrative";

// Descriptions are paraphrases of verified official pages. KPI definitions below
// are this project's proposed evaluation design, not reported program outcomes.
export const programSourcesVerifiedAt = "2026-09-08";
export const programSources = {
  adjustment: { title: "家庭生活調適與婚姻資源諮詢", period: "115年5月更新的官方資源整理", agency: "我的E政府／教育部等機關",
    url: "https://www.gov.tw/News_Content_26_778871",
    description: "彙整家庭生活調適、家庭教育諮詢、社區心理諮商及家事服務等管道。", adaptation: "以需求自選的個別諮詢協助資源連結；有子女照顧需求者再轉介親職或家事服務。" },
  career: { title: "新北有課：一對一職涯諮詢", period: "115年9–10月活動", agency: "新北市青年局",
    url: "https://www.youth.ntpc.gov.tw/youth/ch/app/course/view?id=181&module=course&serno=88ae6056-bc68-4075-91fc-2795c5623752",
    description: "採預約制個別諮詢，協助釐清能力與職涯方向；原活動以18–40歲青年為優先對象。", adaptation: "借鏡預約時段與個別諮詢的辦理方式。" },
  family: { title: "育兒神隊友：親職講座與家長工作坊", period: "114年方案案例", agency: "新北市政府教育局／家庭教育中心",
    url: "https://www.ntpc.edu.tw/home.jsp?act=be4f48068b2b0031&dataserno=ad58c34858ffca10cdecf25e3a1d6c6e&id=d127e0ce0f4f407b",
    description: "結合教養教材、親職講座及工作坊，提供有育兒需求者溝通與支持資源。", adaptation: "借鏡教材加小組工作坊，讓參與者自選溝通、照顧或生活諮詢主題。" },
  social: { title: "淡水晴花鹿苑單身聯誼", period: "115年3月28日既有活動", agency: "新北市政府民政局",
    url: "https://www.ca.ntpc.gov.tw/home.jsp?act=43c8cd4505626cc5&dataserno=ff43905810743139b064fa2e65971e4b&id=30",
    description: "以團體互動、趣味闖關及手作安排面對面交流。", adaptation: "借鏡興趣活動的交流形式；聯誼另採自願報名。" },
  online: { title: "新北青年線上職涯諮詢", period: "113年服務案例", agency: "新北市青年局",
    url: "https://www.ntpc.gov.tw/ch/home.jsp?dataserno=f147c1b23294afdfb60e1ae7b2a535b7&id=e8ca970cde5c00e1",
    description: "提供線上職涯諮詢，作為實體青職基地以外的服務方式。", adaptation: "借鏡線上預約與遠距諮詢，與區內實體場次並行。" },
  taoyuan: { title: "青年職場體驗：企業一日體驗", period: "115年6月更新的計畫說明", agency: "桃園市政府青年事務局",
    url: "https://youth.tycg.gov.tw/News_Content.aspx?n=11611&s=1470449",
    description: "與全臺企業合作，透過一日職場體驗認識產業及技能；原方案對象為15–30歲青年。", adaptation: "借鏡企業現場體驗形式；本計畫的18–35歲對象與名額另與合作企業協調。" },
  kaohsiung: { title: "職場任我行：職涯工作坊與企業參訪", period: "115年活動案例", agency: "高雄市政府勞工局",
    url: "https://www.kcg.gov.tw/CityNews_Detail1.aspx?n=3A379BB94CA5F12D&ss=A2637DE78BCDEBC5",
    description: "結合就業力課程、企業參訪及職涯工作坊，內容包括求職準備、勞動權益與職場適應。", adaptation: "借鏡實作課程與企業對話，分別設計技能練習及職務條件交流。" },
  tainan: { title: "單身聯誼：戶外走讀與在地體驗", period: "115年及歷年活動案例", agency: "臺南市政府民政局",
    url: "https://people.tainan.gov.tw/cp.aspx?n=32000",
    description: "官方專區列有濱海、健行等不同主題的單身交流活動。", adaptation: "借鏡戶外共同體驗，設計自願參加的交流活動；原活動年齡及設籍資格不直接套用。" },
  volunteer: { title: "青志季：技能培力與主題服務行動", period: "115年7–9月活動案例", agency: "教育部青年發展署",
    url: "https://youthvolunteer.yda.gov.tw/content/m_news_content.php?sid=309",
    description: "由全臺青年志工中心辦理服務技能課程及主題式志願服務行動。", adaptation: "借鏡先培訓、再共同服務的安排，讓青年透過合作建立在地連結。" },
  deliberation: { title: "青年好政：Let’s Talk審議討論", period: "歷年計畫方法參考", agency: "教育部青年發展署",
    url: "https://www.yda.gov.tw/plan.aspx?p=1060",
    description: "以18–35歲青年為主要對象，透過公共議題討論及審議培力，整理青年對政策的想法。", adaptation: "借鏡有主持人的小組討論，把青年需求整理為具體方案及機關回應。" },
};
export type ProgramOption = { id: string; title: string; action: string; outcome: string; sourceIds: Array<keyof typeof programSources>; metric: string; formula: string; frequency: string; agencies: string };
type ProgramPresentation = { mechanism: string; suitableFor: string; preparation: string };
const programPresentation: Record<string, ProgramPresentation> = {
  mobile: { mechanism: "在地服務", suitableFor: "希望在區內或線上取得諮詢的青年。", preparation: "借用場地、排定專業人員及遠距時段；需要持續維護預約與轉介。" },
  family: { mechanism: "溝通練習", suitableFor: "自選伴侶溝通、照顧或親職主題的青年。", preparation: "安排家庭教育講師與小組練習；親職單元依實際需求開設。" },
  adjustment: { mechanism: "個別支持", suitableFor: "有生活調適、照顧或資源轉介需求的青年。", preparation: "由合適專業人員諮詢，保護個別資料；每個預約時段可服務人數較少。" },
  social: { mechanism: "興趣交流", suitableFor: "希望拓展交友圈、且自願參與交流或聯誼的青年。", preparation: "設計共同活動、分組與安全安排；戶外形式需雨天備案。" },
  career: { mechanism: "職涯諮詢", suitableFor: "正在考慮求職、轉職或進修的青年。", preparation: "安排個別諮詢與後續追蹤；職缺及進修資訊需定期更新。" },
  volunteer: { mechanism: "社區共作", suitableFor: "希望投入社區服務並認識在地夥伴的青年，不限婚姻狀態。", preparation: "先與社區確認服務需求、培訓及安全分工；需接洽承接團隊。" },
  deliberation: { mechanism: "方案共議", suitableFor: "希望參與地點、時段與服務內容設計的青年。", preparation: "準備資料、主持人及機關回應窗口；討論後仍需安排執行。" },
  immersion: { mechanism: "企業體驗", suitableFor: "想了解特定行業工作內容、尚未確定方向的青年。", preparation: "協調企業、現場任務與安全保險；參訪名額受場地限制。" },
  skills: { mechanism: "技能實作", suitableFor: "已選定技能方向、希望完成練習或銜接職訓的青年。", preparation: "確認課程程度、設備及師資；短期試辦先聚焦一項可練習的技能。" },
  workplace: { mechanism: "職務對話", suitableFor: "希望比較職務內容、薪資結構與工時條件的青年。", preparation: "邀請願意說明條件的雇主與勞動諮詢人員；資料按職務及工時分列。" },
};
export function policyPrograms(context: PolicyContext, item: IntegratedPolicyCase): Array<ProgramOption & ProgramPresentation> {
  const place = context.scope === "district" ? context.district : "新北市";
  const topic = item.topic;
  const growth = item.facts?.find(f => f.id === "change")?.chart.series[1]?.points.at(-1)?.value;
  const marriedSupport = item.supporting.find(s => s.topic === "婚姻狀態");
  const marriagePrimary = topic === "婚姻狀態" || topic === "教育×婚姻";
  const marriedChart = marriagePrimary ? item.chart : marriedSupport?.chart;
  const marriedHigh = context.scope === "district" && marriedChart != null &&
    (marriedChart.series[1]?.points.at(-1)?.value ?? -Infinity) > (marriedChart.series[0]?.points.at(-1)?.value ?? Infinity);
  const mobile: ProgramOption = { id: "mobile", title: growth != null && growth < 0 ? "既有公共空間的預約服務日" : "區內巡迴服務日＋線上預約",
    action: `在${place}可借用的公共空間安排諮詢與需求登記，提供線上預約及遠距時段。依各場報名主題調整下一場的服務內容。`,
    outcome: "讓青年能在區內或線上取得諮詢，縮短往返時間並完成後續轉介。", sourceIds: ["career", "online"], metric: "完成轉介比例", formula: "完成轉介件數 ÷ 已接受轉介件數 × 100%；同一需求案件只計一次。", frequency: "每月", agencies: "建議青年局主責，區公所、民政局協辦；實際分工待確認。" };
  const family: ProgramOption = { id: "family", title: "生活與伴侶溝通工作坊＋諮詢", action: `在${place}提供生活安排、伴侶溝通及資源轉介等可選主題；有親職需求者可另選親職單元。`, outcome: "協助有相關需求的青年找到合適資源，練習溝通並完成諮詢或轉介。", sourceIds: ["family"], metric: "服務後資源使用比例", formula: "回覆已使用所介紹資源者 ÷ 該題有效追蹤回覆者 × 100%；另列有效回覆者 ÷ 應追蹤者。", frequency: "活動後1個月", agencies: "建議青年局主責，教育局家庭教育中心、區公所協辦；實際分工待確認。" };
  const adjustment: ProgramOption = { ...family, id: "adjustment", title: "生活調適與資源轉介諮詢", action: `在${place}安排可預約的個別諮詢，由參與者自選生活調適、支持資源或照顧安排；有親職或家事服務需求者再連結相應單位。`, outcome: "協助有需求的青年取得生活支持與諮詢資源，追蹤轉介後的實際使用情形。", sourceIds: ["adjustment"], agencies: "建議青年局主責，教育局家庭教育中心、社會局、區公所協辦；實際分工待確認。" };
  const social: ProgramOption = { id: "social", title: "興趣交流活動／自願單身聯誼", action: `在${place}以手作、走讀或團體合作安排青年交流；單身聯誼採獨立報名，依參與者選擇安排。`, outcome: "增加自願參與者的在地交流機會，了解願意持續參與的活動形式。", sourceIds: ["social"], metric: "後續參與意願", formula: "表示願意再次參加的有效答卷數 ÷ 該題有效答卷數 × 100%；另列問卷回收率。", frequency: "每場結束", agencies: "建議青年局主責，民政局、區公所協辦；實際分工待確認。" };
  const career: ProgramOption = { id: "career", title: topic === "薪資與發展" ? "薪資與職務條件諮詢" : topic === "行業結構" ? "行業職務探索＋個別職涯諮詢" : "職涯導航＋進修轉介", action: `安排${place}青年預約職涯諮詢，整理${topic === "薪資與發展" ? "薪資區間、工時與職務條件" : "自身技能、工作選擇與進修路徑"}；讓參與者帶走一份可執行的下一步清單。`, outcome: "協助有需求者完成職涯行動計畫，追蹤求職、進修或職務選擇的進展。", sourceIds: ["career", "online"], metric: "職涯行動完成比例", formula: "回覆已完成至少一項事前約定職涯行動者 ÷ 有效追蹤回覆者 × 100%；並列回覆率及行動類別。", frequency: "服務後1個月", agencies: "建議青年局主責，勞工局、教育局協辦；實際分工待確認。" };
  social.sourceIds = ["tainan", "social"];
  adjustment.metric = "預約諮詢完成比例";
  adjustment.formula = "有效預約者中完成諮詢人數 ÷ 有效預約人數 × 100%；另列取消、未到場與轉介件數。";
  adjustment.frequency = "每月";
  const volunteer: ProgramOption = { id: "volunteer", title: "青年社區共作＋志工培訓", action: `在${place}邀請青年與社區團隊選定一項服務任務，第一場練習分工及服務技巧，第二場完成共同服務。`, outcome: "讓青年透過共同任務認識在地夥伴，累積持續參與社區的經驗。", sourceIds: ["volunteer"], metric: "共同服務任務完成比例", formula: "已完成且有紀錄的事前約定任務數 ÷ 事前約定任務總數 × 100%；另列參與人數與服務時數。", frequency: "每場及期末", agencies: "建議青年局主責，社會局、區公所及社區團隊協辦；實際分工待確認。" };
  const deliberation: ProgramOption = { id: "deliberation", title: "青年服務方案共議工作坊", action: `提供${place}的人口與生活結構圖表，邀請青年比較服務地點、時段與內容，再由承辦單位逐項回應可採行的提案。`, outcome: "把青年提出的需求轉成有執行條件、承辦窗口及回應日期的方案。", sourceIds: ["deliberation"], metric: "提案回應完成比例", formula: "期限內取得正式回應的有效提案數 ÷ 本輪有效提案總數 × 100%；另列採行、修改及未採行理由。", frequency: "活動後1個月", agencies: "建議青年局主責，區公所及議題相關局處協辦；實際分工待確認。" };
  const immersion: ProgramOption = { id: "immersion", title: "企業現場體驗＋職務探索", action: `依${place}青年想了解的行業洽談企業，以現場參訪、工作任務體驗及從業者對話，協助參與者比較職務選擇。`, outcome: "讓參與者能說明工作內容及所需技能，選定下一步探索方向。", sourceIds: ["taoyuan", "kaohsiung"], metric: "完成職務探索紀錄比例", formula: "完成工作內容、技能需求及下一步三欄紀錄者 ÷ 實際參與體驗人數 × 100%。", frequency: "每場結束", agencies: "建議青年局主責，勞工局、經發局及合作企業協辦；實際分工待確認。" };
  const skills: ProgramOption = { id: "skills", title: "短期技能實作＋職訓銜接", action: `先讓${place}報名青年選擇技能主題，安排實作練習與作品回饋，再提供可銜接的進修或職訓管道。`, outcome: "協助參與者完成一項技能練習，知道如何繼續學習。", sourceIds: ["kaohsiung"], metric: "實作任務完成比例", formula: "依事前相同評分規準完成實作任務者 ÷ 實際參與實作人數 × 100%；另記錄進修或職訓報名人數。", frequency: "每場及活動後1個月", agencies: "建議青年局主責，勞工局、教育局及職訓單位協辦；實際分工待確認。" };
  const workplace: ProgramOption = { id: "workplace", title: "雇主職務條件交流會", action: `邀請${place}工作場所的雇主說明職務、薪資構成、工時及技能要求，搭配勞動權益問答，讓青年按相同欄位比較選項。`, outcome: "讓青年取得可比較的工作條件，也讓雇主了解求職者的關注事項。", sourceIds: ["kaohsiung"], metric: "職務條件資訊完整比例", formula: "完整填寫職務、薪資構成、工時及技能要求的職務數 ÷ 參與交流的職務總數 × 100%；不以平均薪資推定個別職務待遇。", frequency: "每場", agencies: "建議勞工局主責，青年局、經發局及合作企業協辦；實際分工待確認。" };
  let choices: ProgramOption[];
  if (marriagePrimary) {
    choices = /離婚|喪偶/.test(item.chart.title) ? [adjustment, family, volunteer, career]
      : /未婚/.test(item.chart.title) ? [social, volunteer, career, deliberation]
      : marriedHigh ? [family, adjustment, volunteer, social] : [social, volunteer, family, deliberation];
  } else if (topic === "薪資與發展") choices = [career, workplace, skills, immersion];
  else if (["教育程度", "就業轉銜", "行業結構"].includes(topic)) choices = [career, skills, immersion, mobile];
  else if (topic === "性別結構") choices = [mobile, deliberation, volunteer, career];
  else choices = [mobile, deliberation, volunteer, marriedHigh ? family : social];
  return choices.map(p => ({ ...p, ...programPresentation[p.id] }));
}

export function programKpis(program: ProgramOption) {
  return [
    { metric: "報名與實際到場", formula: "各場有效報名人數、簽到人數；到場率＝有效報名者中實際到場人數 ÷ 有效報名人數 × 100%。現場報名另列。", source: "報名表、簽到表", frequency: "每場" },
    { metric: "累計服務人次與實際人數", formula: "服務人次＝各場到場人數加總；實際人數＝同期間以去識別化參與代碼去重的人數。", source: "簽到表與參與代碼", frequency: "每月" },
    { metric: "男女參與比例", formula: "各性別到場人次 ÷ 全部到場人次 × 100%；未填／其他分列，與報名端使用相同分類。", source: "自願填答欄位、簽到表", frequency: "每場及每月" },
    { metric: "滿意度與問卷回收率", formula: "滿意度＝5分量表中4或5分答卷數 ÷ 該題有效答卷數 × 100%；回收率＝有效問卷份數 ÷ 到場人數 × 100%。", source: "場後匿名問卷", frequency: "每場結束" },
    { metric: program.metric, formula: program.formula, source: "諮詢紀錄、服務後追蹤問卷", frequency: program.frequency },
  ];
}

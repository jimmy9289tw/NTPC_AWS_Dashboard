import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ageBandLabel, dashboardData, geographyLabel, getLabor, getRegistered, getServiceAnnual, getServiceFacilities, getWage, type AgeBand, type Sex } from "../../dashboard-data";
import { getDistrictPolicyEvidence } from "../../district-policy-evidence";
import { getMonthlyPopulation, getMonthlyPopulationValue } from "../../monthly-population";
import { buildDistrictPolicySignal } from "../../policy-engine";

function asksForPolicyRecommendation(question: string): boolean {
  const normalized = question.replaceAll("政策服務", "服務");
  return /政策|建議|措施|行動|方案|改善|可以.*(?:做|採取)|應該.*(?:做|採取)|新增.*據點|增設.*據點|設立.*據點|據點.*(?:增設|新增|設立)/u.test(normalized);
}

function asksForRestrictedContent(question: string): boolean {
  return asksForPolicyRecommendation(question)
    || /資料匯出|下載.*CSV|Code\s*Book/iu.test(question);
}
import { getResidentEmploymentIndustry, residentEmploymentIndustryData, type IndustryAgeBand, type IndustrySex } from "../../resident-employment-industry";

const SOURCES = {
  population: [{ id: "MOI-POP1Y", label: "戶政司單一年齡人口", url: "https://data.gov.tw/dataset/77132" }],
  education: [{ id: "MOI-EDU-SINGLEAGE", label: "戶政司教育程度統計", url: "https://data.gov.tw/dataset/117988" }],
  marriage: [{ id: "MOI-MARITAL5Y", label: "戶政司婚姻狀況統計", url: "https://data.gov.tw/dataset/117986" }],
  labor: [{ id: "DGBAS-NTPC-LABOR-AGE", label: "主計總處人力資源調查統計年報", url: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078" }],
  wage: [
    { id: "DGBAS-WAGE-LOC", label: "主計總處受僱員工全年總薪資統計", url: "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642" },
    { id: "BLI-AGE-REGION-SEX", label: "勞保年齡、地區、性別人數", url: "https://data.gov.tw/dataset/162821" },
    { id: "BLI-PENSION-AGE-WAGE", label: "勞退年齡別平均提繳工資", url: "https://data.gov.tw/dataset/46103" },
  ],
  land: [{ id: "NTPC-AREA", label: "新北市行政區面積", url: "https://data.ntpc.gov.tw/datasets/13f881c7-53c4-4f8c-b693-816584562666" }],
  service: [{ id: "NTPC-YOUTH-ANNUAL", label: "新北市政府青年局統計年報", url: "https://www.youth.ntpc.gov.tw/youth/ch/app/data/list?id=136&module=youth0008" }],
  facility: [{ id: "NTPC-YOUTH-FACILITY", label: "新北市青年服務據點官方頁面", url: "https://www.youth.ntpc.gov.tw/youth/ch/app/data/view?id=101&module=youth0009&serno=fff05b70-3f77-4b85-806b-3cb0cf89194c" }],
  platforms: [
    { id: "PLAT-GOV-DATA", label: "政府資料開放平臺", url: "https://data.gov.tw/" },
    { id: "PLAT-NTPC-OPENAPI", label: "新北市資料開放平臺", url: "https://data.ntpc.gov.tw/openapi/" },
    { id: "PLAT-NTPC-OAS", label: "新北市統計資料庫", url: "https://oas.bas.ntpc.gov.tw/DgbasWeb/Page/Default.aspx" },
  ],
};

function industrySources(year: number) {
  const key = String(year);
  return [
    { id: `DGBAS-NTPC-${year}-H1-INDUSTRY-AGE`, label: `${year}年上半年新北市就業者之行業與年齡分配`, url: residentEmploymentIndustryData.meta.halfYearSourcePages[key].H1 },
    { id: `DGBAS-NTPC-${year}-H2-INDUSTRY-AGE`, label: `${year}年下半年新北市就業者之行業與年齡分配`, url: residentEmploymentIndustryData.meta.halfYearSourcePages[key].H2 },
    { id: `DGBAS-NTPC-${year}-ANNUAL-INDUSTRY`, label: `${year}年人力資源調查年報表33`, url: residentEmploymentIndustryData.meta.sourcePages[key] },
  ];
}

type AskContext = { year?: number; ageBand?: AgeBand; sex?: Sex; district?: string; view?: string };

const number = (value: number, digits = 0) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: digits }).format(value);
const percent = (value: number) => `${number(value, 2)}%`;

function resolveScope(question: string, context: AskContext) {
  const yearMatch = question.match(/(110|111|112|113|114)年?/);
  const ageMatch = question.match(/(18[–-]24|25[–-]29|30[–-]35|18[–-]35)/);
  const districts = dashboardData.geographies.filter((item) => item.level === "DISTRICT").map((item) => geographyLabel(item.name));
  const district = districts.find((item) => question.includes(item)) ?? context.district ?? "新北市";
  return {
    year: yearMatch ? Number(yearMatch[1]) : context.year ?? dashboardData.meta.defaultYear,
    ageBand: (ageMatch ? ageMatch[1].replace("–", "-") : context.ageBand ?? dashboardData.meta.defaultAgeBand) as AgeBand,
    sex: context.sex ?? "合計" as Sex,
    district,
  };
}

function topCategory<T extends { value: number }>(values: Record<string, T>) {
  return Object.entries(values).sort((a, b) => b[1].value - a[1].value)[0];
}

function localAnswer(question: string, context: AskContext) {
  const scope = resolveScope(question, context);
  const registered = getRegistered(scope.year, scope.district, scope.ageBand, scope.sex);
  const labor = getLabor(scope.year, scope.ageBand);
  const wageAge: AgeBand = "18-35";
  const wage = getWage(scope.year, wageAge);

  if (/青年訊號|本期重點|情勢總覽|重要訊號/.test(question)) {
    const latestWageYear = dashboardData.wage.filter((record) => record.ageBand === wageAge && record.year <= scope.year).reduce<number | null>((latest, record) => latest == null || record.year > latest ? record.year : latest, null);
    const latestWage = latestWageYear == null ? undefined : getWage(latestWageYear, wageAge);
    return {
      answer: `${scope.year}年${ageBandLabel(scope.ageBand)}總覽可先確認三項訊號：戶籍人口${registered ? `${number(registered.population)}人` : "尚無資料"}；新北市整體失業率${labor ? percent(labor.metrics["失業率"]) : "尚無資料"}、就業人口比率${labor ? percent(labor.metrics["就業人口比率"]) : "尚無資料"}；18–35歲全年薪資平均${latestWage ? `${latestWageYear}年${number(latestWage.metrics["全年總薪資平均數"], 1)}萬元` : "尚無資料"}${latestWageYear != null && latestWageYear < scope.year ? `，相對所選年度落後${scope.year - latestWageYear}年` : ""}。`,
      sources: [...SOURCES.population, ...SOURCES.labor, ...SOURCES.wage],
      caveat: "三項訊號分屬戶籍人口、民間人口／勞動力及工作場所受僱員工母體，只能並列閱讀，不能相加或互換分母；政策警示也不等於因果判定。",
    };
  }

  if (/匯出|下載|CSV|Code ?Book|欄位說明|欄位代碼/i.test(question)) {
    return {
      answer: "資料匯出先選主題，再多選年度、年齡、性別及地區；頁面只提供該資料支援的條件。可下載人口、教育、婚姻、教育×婚姻、月人口、勞動、行業結構、薪資及服務輔助資料，先預覽列數及缺值再下載。可選精簡欄位、含公式來源與上下限，或自訂欄位；Code Book說明每個欄位。三母體年度快速下載仍分成三份CSV。",
      sources: SOURCES.platforms,
      caveat: "行政區適用戶籍相關資料及青年據點；核心勞動與薪資目前只發布男女合計，青年就業者行業結構可分男女。薪資可選18–35、18–24、25–29及30–35歲，114年保留缺值。月人口為月底存量；115年據點清冊另列，不當成110–114年的歷史資料。",
    };
  }

  if (/性別資料|男女資料|性別分組|男女合計|男生.*女生|男性.*女性/.test(question)) {
    return {
      answer: "戶籍人口、教育程度與婚姻狀態可依男性、女性或合計查看，並支援全市與29行政區。青年勞動市場與青年薪資目前只發布男女合計；現有官方檔案雖有部分整體性別統計，但沒有足以建立110–114年、18–35歲三個子群的完整年齡×性別交叉母數。",
      sources: [...SOURCES.population, ...SOURCES.education, ...SOURCES.marriage, ...SOURCES.labor, ...SOURCES.wage],
      caveat: "缺少交叉母數時不按人口比例分攤，也不把全年齡男女值改稱青年男女值。",
    };
  }

  if (/工作類別|行業|職業/.test(question)) {
    const industrySex: IndustrySex = /女性|女生|女/.test(question) ? "女" : /男性|男生|男/.test(question) ? "男" : "合計";
    const industryAgeBand = scope.ageBand as IndustryAgeBand;
    const rows = getResidentEmploymentIndustry(scope.year, industrySex, industryAgeBand).sort((a, b) => b.sharePct - a.sharePct);
    const leading = rows.slice(0, 3).map((row) => `${row.industry}${percent(row.sharePct)}`).join("、");
    if (/在新北.*工作|工作地/.test(question)) {
      return {
        answer: `${scope.year}年${ageBandLabel(scope.ageBand)}、${industrySex === "合計" ? "男女合計" : industrySex}的居住地口徑青年行業估計中，前三類為${leading || "尚無資料"}。但這代表「平常居住於新北市的就業者」，不能回答「工作地在新北市」的青年行業分布。`,
        sources: industrySources(scope.year),
        caveat: `${residentEmploymentIndustryData.meta.method}。青年年齡為模型估計；行業依場所主要經濟活動分類，職業依個人工作內容分類，居住地、戶籍地與工作地不可互換。`,
      };
    }
    return {
      answer: `${scope.year}年居住於新北市的${ageBandLabel(scope.ageBand)}${industrySex === "合計" ? "全體" : industrySex === "男" ? "男性" : "女性"}就業者行業估計中，前三類為${leading || "尚無資料"}。儀表板可查看110–114年、四組青年年齡、男女性別與完整19類。`,
      sources: industrySources(scope.year),
      caveat: `${residentEmploymentIndustryData.meta.method}；${residentEmploymentIndustryData.meta.sensitivity}。本表是居住地口徑，青年值不是官方原生年齡帶；行業與職業不可互換。`,
    };
  }
  if (/每月|月增|同月|月份|月底/.test(question) && /人口|戶籍/.test(question)) {
    const monthlyYear = scope.year;
    const geography = scope.district === "新北市" || scope.district.startsWith("新北市") ? scope.district : `新北市${scope.district}`;
    const rows = getMonthlyPopulation(monthlyYear, geography, scope.ageBand, scope.sex);
    const latest = rows.at(-1);
    if (!latest) return { answer: "目前月資料區發布110–114年戶籍人口，請指定這五個年度。", sources: SOURCES.population, caveat: "其他指標若官方只發布年度值，不會由年度值推造月份。" };
    const priorMonthPeriod = latest.month === 1 ? `${latest.year - 1}12` : `${latest.year}${String(latest.month - 1).padStart(2, "0")}`;
    const priorYearPeriod = `${latest.year - 1}${String(latest.month).padStart(2, "0")}`;
    const priorMonth = getMonthlyPopulationValue(priorMonthPeriod, geography, scope.ageBand, scope.sex);
    const priorYear = getMonthlyPopulationValue(priorYearPeriod, geography, scope.ageBand, scope.sex);
    const mom = priorMonth ? ((latest.population / priorMonth) - 1) * 100 : null;
    const yoy = priorYear ? ((latest.population / priorYear) - 1) * 100 : null;
    return {
      answer: `${latest.year}年${latest.month}月底${scope.district}${ageBandLabel(scope.ageBand)}、${scope.sex}戶籍人口為${number(latest.population)}人；月增率${mom == null ? "尚無前月資料" : percent(mom)}，同月年增率${yoy == null ? "尚無前一年同月資料" : percent(yoy)}。`,
      sources: SOURCES.population,
      caveat: "月值是月底存量，不是月內流量，也不是12個月加總。月增率＝（本月底÷前月底－1）×100；同月年增率＝（本月底÷前一年同月底－1）×100。",
    };
  }

  if (/曝光率|曝光強度|觸達率|服務覆蓋率|每場平均服務人次|平均每場人次/.test(question)) {
    const rows = getServiceAnnual(scope.year);
    if (!rows.length) return { answer: `${scope.year}年沒有同口徑服務場次與人次，無法計算每場平均服務人次；已發布可比序列為111–114年。`, sources: SOURCES.service, caveat: "不以前一年回填。每場平均服務人次的單位是人次／場，不是百分比。" };
    const personTimes = rows.reduce((sum, row) => sum + row.participationPersonTimes, 0);
    const activities = rows.reduce((sum, row) => sum + row.activityCount, 0);
    const intensity = activities > 0 ? personTimes / activities : null;
    return {
      answer: `${scope.year}年全市每場平均服務人次為${intensity == null ? "尚無資料" : `${number(intensity, 2)}人次／場`}，計算式為${number(personTimes)}參與人次÷${number(activities)}活動場次。`,
      sources: [...SOURCES.service, ...SOURCES.facility],
      caveat: "本指標不是百分比，也不是不同青年占比。同一人參加多場會重複計入；官方未提供行政區人次與場次交叉，因此不能發布分區值。",
    };
  }

  if (asksForPolicyRecommendation(question)) {
    if (scope.district === "新北市") return { answer: "請指定一個行政區，系統才會比較該區與全市的人口趨勢、教育程度、婚姻狀態及男女結構，並只列出達到初篩門檻的政策建議。", sources: [...SOURCES.population, ...SOURCES.education, ...SOURCES.marriage], caveat: "政策建議用於安排需求查核與方案盤點，不是自動核定政策。" };
    const evidence = getDistrictPolicyEvidence(scope.year, scope.district, scope.ageBand, scope.sex);
    const signal = buildDistrictPolicySignal({
      district: scope.district,
      ageLabel: ageBandLabel(scope.ageBand),
      population: evidence.population,
      rank: evidence.populationRank,
      districtCount: evidence.districtCount,
      sharePct: evidence.sharePct,
      citySharePct: evidence.citySharePct,
      yearChangePct: evidence.yearChangePct,
      windowChangePct: evidence.windowChangePct,
      windowPopulationChange: evidence.windowPopulationChange,
      windowStartYear: evidence.windowStartYear,
      windowEndYear: evidence.windowEndYear,
      growthRank: evidence.growthRank,
      growingDistrictCount: evidence.growingDistrictCount,
      positiveAnnualIntervals: evidence.positiveAnnualIntervals,
      annualIntervalCount: evidence.annualIntervalCount,
      educationLowerPct: evidence.educationLowerPct,
      cityEducationLowerPct: evidence.cityEducationLowerPct,
      educationConservativeGapPct: evidence.educationConservativeGapPct,
      educationDifferenceRank: evidence.educationDifferenceRank,
      marriedPct: evidence.marriedPct,
      cityMarriedPct: evidence.cityMarriedPct,
      marriageConservativeGapPct: evidence.marriageConservativeGapPct,
      marriageDifferenceRank: evidence.marriageDifferenceRank,
      maleSharePct: evidence.maleSharePct,
      cityMaleSharePct: evidence.cityMaleSharePct,
      genderDifferenceRank: evidence.genderDifferenceRank,
      demographicEstimated: evidence.demographicEstimated,
      serviceSiteCount: evidence.serviceSiteCount,
      activeServiceSiteCount: evidence.activeServiceSiteCount,
      districtExposureIntensity: null,
    });
    const sources = [
      ...SOURCES.population,
      ...(signal.evidenceDomains.includes("教育程度") ? SOURCES.education : []),
      ...(signal.evidenceDomains.includes("婚姻狀態") ? SOURCES.marriage : []),
      ...(signal.evidenceDomains.includes("青年據點") ? SOURCES.facility : []),
    ];
    return {
      answer: `政策結果：${signal.recommendedAction} 支持數據：${signal.actionBasis.join("；")} 可以先做：${signal.policyTools.join("；")}。`,
      sources,
      caveat: `${signal.unsupportedConclusion} ${signal.decisionGate}`,
    };
  }

  if (/據點|服務基地|青職基地|青創基地/.test(question)) {
    const facilities = getServiceFacilities(scope.district);
    const active = facilities.filter((facility) => facility.active);
    const names = facilities.map((facility) => `${facility.name}（${facility.active ? "營運中" : "暫停開放"}）`).join("、");
    return {
      answer: `${scope.district === "新北市" ? "新北市官方青年服務據點清冊" : `${scope.district}官方清冊`}目前列有${facilities.length}處，其中${active.length}處營運中${names ? `：${names}` : ""}。`,
      sources: SOURCES.facility,
      caveat: "據點依官方網頁快照建檔；清冊未列據點不等於沒有其他局處、巡迴或線上服務。席、間、人、座等量能單位不同，不合併加總。",
    };
  }

  if (/人口密度|土地面積|平方公里/.test(question)) {
    if (!registered) return { answer: "目前條件沒有可發布的人口密度資料。", sources: [...SOURCES.population, ...SOURCES.land], caveat: "不以其他行政區或年度代替。" };
    return {
      answer: `${scope.year}年${scope.district}${ageBandLabel(scope.ageBand)}、${scope.sex}戶籍青年人口密度為${number(registered.populationDensityPerKm2, 2)}人／平方公里；公告土地面積為${number(registered.landAreaKm2, 2)}平方公里。`,
      sources: [...SOURCES.population, ...SOURCES.land],
      caveat: "人口密度＝同年度戶籍青年人口÷官方公告行政區土地面積。紅色只表示密度數值較高，不代表政策風險。",
    };
  }

  if (/服務人次|參與人次|參與人數|活動場次|政策服務/.test(question)) {
    const rows = getServiceAnnual(scope.year);
    if (!rows.length) return { answer: `${scope.year}年目前沒有同口徑且完成查核的青年局年度服務量資料；已發布的可比序列為111–114年，系統不會插補110年。`, sources: SOURCES.service, caveat: "年度人次是全市動態累計，不是行政區、18–35歲去重服務人數。" };
    const personTimes = rows.reduce((sum, row) => sum + row.participationPersonTimes, 0);
    const activities = rows.reduce((sum, row) => sum + row.activityCount, 0);
    const domains = rows.map((row) => `${row.domainLabel}${number(row.participationPersonTimes)}人次、${number(row.activityCount)}場`).join("；");
    return {
      answer: `${scope.year}年青年局職涯發展與創新創業活動合計${number(personTimes)}人次、${number(activities)}場；分項為${domains}。`,
      sources: SOURCES.service,
      caveat: "這是新北市全市官方行政彙整人次，可重複計入同一人多次參與。人次÷場次可計算每場平均服務人次；但沒有行政區×活動場次×參與人次交叉，不能發布分區值。",
    };
  }

  if (/板橋區.*勞參|行政區.*勞|各區.*勞|分區.*勞/.test(question)) {
    return {
      answer: "目前公開資料只支持新北市整體的勞動力、就業、失業與勞動力參與率，不能切到板橋區或其他行政區。行政區選取只套用戶籍人口、教育、婚姻與性別資料。",
      sources: SOURCES.labor,
      caveat: "不要把全市抽樣調查估計值分攤到各行政區；那會創造來源沒有提供的精度。",
    };
  }
  if (/薪資|薪水|中位數|平均薪資/.test(question)) {
    if (scope.year === 114 || !wage) {
      return {
        answer: `${scope.year}年尚無本儀表板可比且完成查核的新北市18–35歲全年總薪資資料。最近可用年度是113年，系統不會自動用113年、全年齡或全國值代替${scope.year}年。`,
        sources: SOURCES.wage,
        caveat: "薪資母體為工作場所位於新北市的本國籍全時受僱員工，不是新北市戶籍青年。",
      };
    }
    const median = wage.metrics["全年總薪資中位數"];
    const meanMeta = wage.meta["全年總薪資平均數"];
    const medianMeta = wage.meta["全年總薪資中位數"];
    const identity = "模型估計";
    const medianAnswer = median == null
      ? "中位數資料尚未完成更新"
      : `中位數為${number(median, 1)}萬元（分布模型估計）`;
    return {
      answer: `${scope.year}年新北市工作場所18–35歲受僱員工全年總薪資平均數為${number(wage.metrics["全年總薪資平均數"], 1)}萬元（${identity}）；${medianAnswer}。`,
      sources: SOURCES.wage,
      caveat: `平均數：${meanMeta.origin}；${meanMeta.method}。中位數：${medianMeta.origin}；${medianMeta.method}。前台只發布18–35歲，並保留模型估計標籤。母體為本國籍全時受僱員工，地理角色為工作場所；不可與戶籍人口或民間人口直接當作同一分母。`,
    };
  }
  if (/失業|勞參|就業人口比率|勞動力/.test(question)) {
    if (!labor) return { answer: `${scope.year}年${ageBandLabel(scope.ageBand)}尚無可發布勞動市場資料。`, sources: SOURCES.labor, caveat: "缺資料時不外推、不以其他年度代替。" };
    return {
      answer: `${scope.year}年新北市${ageBandLabel(scope.ageBand)}失業率為${percent(labor.metrics["失業率"])}，勞動力參與率為${percent(labor.metrics["勞動力參與率"])}，就業人口比率為${percent(labor.metrics["就業人口比率"])}；勞動力中就業占比為${percent(labor.metrics["勞動力中就業占比"])}。`,
      sources: SOURCES.labor,
      caveat: `${labor.meta["失業率"].origin}；${labor.meta["失業率"].method}。失業率分母是勞動力，勞參率與就業人口比率分母是民間人口。`,
    };
  }
  if (/教育|學歷/.test(question)) {
    if (!registered) return { answer: "目前篩選條件沒有可發布教育資料。", sources: SOURCES.education, caveat: "不以其他行政區或年度代替。" };
    const [name, value] = topCategory(registered.education);
    return {
      answer: `${scope.year}年${scope.district}${ageBandLabel(scope.ageBand)}、${scope.sex}的戶籍教育程度中，占比最高為${name}${percent(value.value)}。完整分布可由儀表板資料表查看。`,
      sources: SOURCES.education,
      caveat: `${value.origin}；${value.method}。25–29歲為官方原生五歲帶，其餘邊界年齡含PCLM與IPF估計。`,
    };
  }
  if (/婚姻|未婚|有偶|離婚|喪偶/.test(question)) {
    if (!registered) return { answer: "目前篩選條件沒有可發布婚姻資料。", sources: SOURCES.marriage, caveat: "不以其他行政區或年度代替。" };
    const [name, value] = topCategory(registered.marriage);
    return {
      answer: `${scope.year}年${scope.district}${ageBandLabel(scope.ageBand)}、${scope.sex}的戶籍婚姻狀態中，占比最高為${name}${percent(value.value)}。完整分布可由儀表板資料表查看。`,
      sources: SOURCES.marriage,
      caveat: `${value.origin}；${value.method}。25–29歲為官方原生五歲帶，其餘邊界年齡含PCLM與IPF估計。`,
    };
  }
  if (/怎麼換算|如何換算|PCLM|IPF|Sprague|估計方法|年齡轉換/.test(question)) {
    return {
      answer: "人口已有單一年齡，18–35歲直接加總。教育與婚姻先用PCLM把五歲年齡組平滑拆成單一年齡，再用IPF校準至行政區、性別與類別官方邊際；勞動市場以PCLM為主模型、Sprague作敏感度比較，最後由人口計數重算各比率。薪資平均數以主計總處表6為水準錨點，並以官方年齡人數建立PCLM年齡輪廓；中位數以官方寬年齡帶的中位數／平均數形狀比校準對數常態分布，18–35歲再以PCLM人數權重求混合分布第50百分位。前台只發布18–35歲結果。",
      sources: [...SOURCES.population, ...SOURCES.education, ...SOURCES.marriage, ...SOURCES.labor, ...SOURCES.wage],
      caveat: "模型值均標示為估計並保存方法敏感度；18–35歲中位數是分布模型結果，不是官方原生值，也不是信賴區間。取得個體薪資微資料後應以加權經驗分布重新驗證。",
    };
  }
  if (/資料庫|平台|來源|介接|API|更新/.test(question)) {
    return {
      answer: "資料來自政府資料開放平臺、戶政司、新北市資料開放平臺、新北市統計資料庫、主計總處及青年局統計年報／據點頁面。系統每天09:15審視一次來源；只有來源內容雜湊或中介資料改變時才重算，且新版本通過品質閘門後才替換三份母體CSV與一份政策服務輔助CSV。",
      sources: [...SOURCES.platforms, ...SOURCES.service, ...SOURCES.facility],
      caveat: "每日審視不代表官方每天更新；未變更會記錄為NO_CHANGE。政策服務輔助資料不是第四個人口母體，人次、據點與每場平均服務人次不改寫前三個分母。",
    };
  }
  if (/人口|多少人|男女/.test(question)) {
    if (!registered) return { answer: "目前篩選條件沒有可發布戶籍人口資料。", sources: SOURCES.population, caveat: "不以其他行政區或年度代替。" };
    return {
      answer: `${scope.year}年12月31日${scope.district}${ageBandLabel(scope.ageBand)}、${scope.sex}戶籍人口為${number(registered.population)}人，占${scope.district}同一性別戶籍人口${percent(registered.populationSharePct)}。`,
      sources: SOURCES.population,
      caveat: "這是戶籍登記現住人口的年末行政精確值，不是勞動市場的民間人口，也不是受僱員工母體。",
    };
  }
  return {
    answer: "我可以回答110–114年的戶籍人口、教育、婚姻、勞動市場，110–113年平均薪資，以及111–114年政策服務人次、活動場次、每場平均服務人次、目前青年服務據點、土地面積與人口密度。每場平均服務人次的單位是人次／場，不是百分比。請在問題中指定年度、行政區、年齡與指標。",
    sources: SOURCES.platforms,
    caveat: `目前模式使用三份母體長格式CSV與一份政策服務輔助長格式CSV，資料版本${dashboardData.meta.version}；四份資料不混用分母。`,
  };
}

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);
  const body = rawBody && typeof rawBody === "object"
    ? rawBody as { question?: unknown; context?: unknown }
    : {};
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const context = (body.context ?? {}) as AskContext;
  if (!question || question.length > 500) return NextResponse.json({ error: "問題需為1–500字。" }, { status: 400 });
  const accessRole = request.headers.get("x-ntpc-access-role") === "decision" ? "decision" : "viewer";
  if (accessRole !== "decision" && asksForRestrictedContent(question)) {
    return NextResponse.json(
      { error: "此問題涉及政策建議或資料匯出，限決策內網授權帳號使用。" },
      { status: 403 },
    );
  }

  const endpoint = process.env.AGENT_ASK_URL;
  const apiKey = process.env.AGENT_API_KEY;
  if (endpoint && apiKey) {
    const user = await getChatGPTUser();
    if (process.env.SITES_REQUIRE_AUTH === "true" && !user) return NextResponse.json({ error: "請先登入私人儀表板。" }, { status: 401 });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        question,
        context,
        dataVersion: dashboardData.meta.version,
        userId: user?.userId,
        accessRole,
        responseBoundary: accessRole === "decision"
          ? "可回覆資料解讀與政策初篩，必須附依據、限制與待補資料。"
          : "只可回覆已發布資料、來源、方法與限制，不得產生政策建議或提供匯出內容。",
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return NextResponse.json({ error: "AWS問答暫時無法使用，請稍後重試。" }, { status: 502 });
    const agentAnswer = await response.json() as Record<string, unknown>;
    return NextResponse.json({ ...agentAnswer, mode: "AWS_HARNESS" });
  }

  return NextResponse.json({ ...localAnswer(question, context), mode: "LOCAL_EVIDENCE_FALLBACK" });
}

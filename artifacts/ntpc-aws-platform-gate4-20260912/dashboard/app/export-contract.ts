import codeBookPayload from "./data/export-code-book.json";
import {
  ageBandLabel,
  dashboardData,
  geographyLabel,
  getLabor,
  getRegistered,
  getWage,
  type AgeBand,
  type Sex,
} from "./dashboard-data";
import { getResidentEmploymentIndustry, residentEmploymentIndustryData, type IndustrySex } from "./resident-employment-industry";

export type ExportUniverse = "registered" | "labor" | "wage";

export type ExportFieldDefinition = {
  fieldCode: string;
  fieldNameZh: string;
  definitionZh: string;
  dataType: string;
  unit: string;
  group: string;
  required: boolean;
  defaultIncluded: boolean;
  exampleValue: string;
};

export type ExportRow = Record<string, string | number | null>;

export const exportCodeBook: ExportFieldDefinition[] = [
  ...(codeBookPayload as ExportFieldDefinition[]).map(field => field.fieldCode === "sex_name_zh" ? { ...field, definitionZh: "戶籍人口與青年行業結構可分性別；核心勞動及薪資為男女合計；服務清冊不適用。" } : field.fieldCode === "period_basis" ? { ...field, definitionZh: "區分年底存量、月末存量、全年平均、全年薪資及據點清冊快照。" } : field),
  ...[
    ["roc_month", "月份", "逐月資料為1–12，年度資料留白。", "1"],
    ["education_name_zh", "教育程度", "教育×婚姻交叉資料的教育分組。", "大學"],
    ["marriage_name_zh", "婚姻狀態", "教育×婚姻交叉資料的婚姻分組。", "未婚"],
    ["facility_name", "據點名稱", "官方清冊的青年據點名稱。", "青年職涯發展中心"],
    ["facility_address", "據點地址", "官方據點地址。", "新北市"],
    ["operating_status", "據點狀態", "官方清冊所記載的營運狀態。", "營運中"],
  ].map(([fieldCode, fieldNameZh, definitionZh, exampleValue]) => ({ fieldCode, fieldNameZh, definitionZh, exampleValue, dataType: "文字或數值", unit: "依欄位", group: "主題識別", required: false, defaultIncluded: true })),
];
export const exportCodeBookVersion = "1.1.0";
export const exportCodeBookEffectiveDate = "2026-09-08";

export const universeLabels: Record<ExportUniverse, string> = {
  registered: "戶籍人口母體",
  labor: "民間人口及勞動市場母體",
  wage: "受僱員工薪資母體",
};

const laborMetricDefinitions: Record<string, { code: string; formula: string; numerator: string; denominator: string; alias: string }> = {
  民間人口: { code: "CIVILIAN_POPULATION", formula: "P", numerator: "", denominator: "", alias: "DGBAS-HR-T27" },
  勞動力人口: { code: "LABOR_FORCE", formula: "LF＝E＋U", numerator: "", denominator: "", alias: "DGBAS-HR-T32+DGBAS-HR-T36|QA:DGBAS-HR-T28" },
  就業人口: { code: "EMPLOYED", formula: "E", numerator: "", denominator: "", alias: "DGBAS-HR-T32" },
  失業人口: { code: "UNEMPLOYED", formula: "U", numerator: "", denominator: "", alias: "DGBAS-HR-T36" },
  非勞動力人口: { code: "NOT_IN_LABOR_FORCE", formula: "P−LF", numerator: "", denominator: "", alias: "DGBAS-HR-T27+DGBAS-HR-T32+DGBAS-HR-T36" },
  失業率: { code: "UNEMPLOYMENT_RATE", formula: "失業人口÷勞動力人口×100%", numerator: "失業人口", denominator: "勞動力人口", alias: "DGBAS-HR-T32+DGBAS-HR-T36" },
  勞動力參與率: { code: "LABOR_FORCE_PARTICIPATION_RATE", formula: "勞動力人口÷民間人口×100%", numerator: "勞動力人口", denominator: "民間人口", alias: "DGBAS-HR-T27+DGBAS-HR-T32+DGBAS-HR-T36" },
  就業人口比率: { code: "EMPLOYMENT_TO_POPULATION_RATE", formula: "就業人口÷民間人口×100%", numerator: "就業人口", denominator: "民間人口", alias: "DGBAS-HR-T27+DGBAS-HR-T32" },
  勞動力中就業占比: { code: "EMPLOYMENT_SHARE_OF_LABOR_FORCE", formula: "就業人口÷勞動力人口×100%", numerator: "就業人口", denominator: "勞動力人口", alias: "DGBAS-HR-T32+DGBAS-HR-T36" },
};

const laborSourceUrls: Record<number, string> = {
  110: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=207903",
  111: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=231112",
  112: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=234726",
  113: "https://www.stat.gov.tw/News_Content.aspx?n=4002&s=234885",
  114: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
};

const base = (universe: ExportUniverse, year: number, ageBand: AgeBand, sex: Sex, geography: string): ExportRow => ({
  universe_name_zh: universeLabels[universe],
  roc_year: year,
  period_basis: universe === "registered" ? "12月31日年末存量" : universe === "labor" ? "全年12個月平均" : "全年統計",
  geography_name_zh: universe === "registered" ? geography : "新北市",
  geography_level_zh: universe === "registered" && geography !== "新北市" ? "行政區" : "直轄市",
  age_band: ageBandLabel(ageBand),
  sex_name_zh: universe === "wage" ? "合計" : sex,
  data_updated_at: dashboardData.meta.generatedAt,
  qa_status_zh: "通過",
});

function estimateStatus(origin: string) {
  if (origin.includes("資料缺口")) return "資料缺口／未估計";
  if (origin.includes("模型") || origin.includes("推估") || origin.includes("換算")) return "可發布（模型估計，須附方法標籤）";
  if (origin.includes("調查")) return "可發布（官方抽樣調查估計值）";
  return "可發布（官方行政精確值）";
}

type EvidenceMeta = { origin: string; method: string; low: number | null; high: number | null };

function uncertaintyLabel(meta?: EvidenceMeta | null) {
  if (!meta || meta.low == null || meta.high == null) return "未提供／不適用";
  return "方法敏感度範圍（非信賴區間）";
}

export function metricRow(
  universe: ExportUniverse,
  year: number,
  ageBand: AgeBand,
  sex: Sex,
  geography: string,
  metricName: string,
  value: number | null,
  unit: string,
  meta: EvidenceMeta | null,
  extras: ExportRow,
): ExportRow {
  const origin = meta?.origin ?? "資料缺口／未估計";
  return {
    ...base(universe, year, ageBand, sex, geography),
    record_id: `DASH-${year}-${universe.toUpperCase()}-${ageBand}-${sex}-${String(extras.metric_code ?? metricName)}`,
    category_dimension_name_zh: "",
    category_name_zh: "",
    metric_name_zh: metricName,
    value,
    unit,
    numerator: "",
    denominator: "",
    formula_zh: "",
    value_origin_label_zh: origin,
    method_name_zh: meta?.method ?? "未估計",
    uncertainty_low: meta?.low ?? null,
    uncertainty_high: meta?.high ?? null,
    uncertainty_type_zh: uncertaintyLabel(meta),
    availability_status_zh: estimateStatus(origin),
    note_zh: universe === "registered" ? "行政區篩選只套用戶籍人口母體。" : "行政區篩選不套用本指標；資料代表新北市整體。",
    ...extras,
  };
}

export function buildRegisteredRows(year: number, ageBand: AgeBand, sex: Sex, district: string) {
  const record = getRegistered(year, district, ageBand, sex);
  const geography = record ? geographyLabel(record.geography) : district;
  if (!record) return [];
  const sourceUrl = "https://data.gov.tw/dataset/77132";
  const rows: ExportRow[] = [
    metricRow("registered", year, ageBand, sex, geography, "戶籍人口數", record.population, "人", {
      origin: record.populationOrigin, method: "單一年齡直接加總", low: null, high: null,
    }, {
      metric_code: "REGISTERED_POPULATION_COUNT", formula_zh: "加總目標年齡範圍內各單一年齡戶籍人口", source_alias: "MOI-POP1Y", source_name: "村里戶數、單一年齡人口", source_url: sourceUrl,
    }),
    metricRow("registered", year, ageBand, sex, geography, "占該地區戶籍人口比率", record.populationSharePct, "%", {
      origin: record.populationOrigin, method: "單一年齡直接加總", low: null, high: null,
    }, {
      metric_code: "REGISTERED_POPULATION_SHARE_PCT", numerator: "目標年齡戶籍人口數", denominator: "該地區同一性別全年齡戶籍人口數", formula_zh: "目標年齡戶籍人口數÷該地區同一性別全年齡戶籍人口數×100%", source_alias: "MOI-POP1Y", source_name: "村里戶數、單一年齡人口", source_url: sourceUrl,
    }),
  ];
  if (record.sexSharePct != null) {
    rows.push(metricRow("registered", year, ageBand, sex, geography, "目標年齡性別占比", record.sexSharePct, "%", {
      origin: record.populationOrigin, method: "單一年齡直接加總", low: null, high: null,
    }, {
      metric_code: "SEX_SHARE_WITHIN_AGE_BAND_PCT", numerator: "該性別目標年齡人口數", denominator: "目標年齡男女合計戶籍人口數", formula_zh: "該性別目標年齡人口數÷目標年齡男女合計戶籍人口數×100%", source_alias: "MOI-POP1Y", source_name: "村里戶數、單一年齡人口", source_url: sourceUrl,
    }));
  }
  for (const [category, meta] of Object.entries(record.education)) {
    rows.push(metricRow("registered", year, ageBand, sex, geography, "教育程度占比", meta.value, "%", meta, {
      metric_code: "EDUCATION_SHARE_PCT", category_dimension_name_zh: "教育程度", category_name_zh: category, numerator: `${category}目標年齡人口數`, denominator: "同地區同性別目標年齡全部教育程度人口數", formula_zh: "該教育程度目標年齡人口數÷同地區同性別目標年齡全部教育程度人口數×100%", source_alias: "MOI-EDU5Y+MOI-POP1Y", source_name: "15歲以上現住人口按性別、年齡、婚姻及教育程度分＋單一年齡人口", source_url: "https://data.gov.tw/dataset/117988",
    }));
  }
  for (const [category, meta] of Object.entries(record.marriage)) {
    rows.push(metricRow("registered", year, ageBand, sex, geography, "婚姻狀態占比", meta.value, "%", meta, {
      metric_code: "MARITAL_STATUS_SHARE_PCT", category_dimension_name_zh: "婚姻狀態", category_name_zh: category, numerator: `${category}目標年齡人口數`, denominator: "同地區同性別目標年齡全部婚姻狀態人口數", formula_zh: "該婚姻狀態目標年齡人口數÷同地區同性別目標年齡全部婚姻狀態人口數×100%", source_alias: "MOI-MARITAL5Y+MOI-POP1Y", source_name: "15歲以上現住人口按性別、年齡及婚姻狀況分＋單一年齡人口", source_url: "https://data.gov.tw/dataset/117986",
    }));
  }
  return rows;
}

export function buildLaborRows(year: number, ageBand: AgeBand) {
  const record = getLabor(year, ageBand);
  if (!record) return [];
  const coreRows = Object.entries(laborMetricDefinitions).map(([metricName, definition]) => {
    const meta = record.meta[metricName];
    const aux = year === 114 ? "+AUX:DGBAS-NTPC-H2-T41+T42" : "";
    const [primaryAlias, qaAlias] = definition.alias.split("|", 2);
    return metricRow("labor", year, ageBand, "合計", "新北市", metricName, record.metrics[metricName] ?? null, meta.unit, meta, {
      metric_code: definition.code,
      numerator: definition.numerator,
      denominator: definition.denominator,
      formula_zh: definition.formula,
      source_alias: `${primaryAlias}${aux}${qaAlias ? `|${qaAlias}` : ""}`,
      source_name: "人力資源調查統計年報",
      source_url: laborSourceUrls[year],
    });
  });
  const industryRows = (["合計", "男", "女"] as IndustrySex[]).flatMap((industrySex) =>
    getResidentEmploymentIndustry(year, industrySex, ageBand).flatMap((industry) => {
      const common = {
        category_dimension_name_zh: "行業",
        category_name_zh: industry.industry,
        source_alias: "DGBAS-NTPC-H1H2-INDUSTRY-AGE+PCLM-IPF",
        source_name: residentEmploymentIndustryData.meta.sourceName,
        source_url: residentEmploymentIndustryData.meta.halfYearSourcePages[String(year)].H2,
        data_updated_at: residentEmploymentIndustryData.meta.generatedAt,
        note_zh: "居住地口徑、青年分析層；模型值須連同方法敏感度閱讀，不代表工作地在新北市。",
      };
      const countMeta = { value: industry.employedThousands, origin: industry.origin, method: industry.method, low: industry.employedThousandsLow, high: industry.employedThousandsHigh };
      const shareMeta = { value: industry.sharePct, origin: industry.origin, method: industry.method, low: industry.sharePctLow, high: industry.sharePctHigh };
      return [
        metricRow("labor", year, ageBand, industrySex, "新北市", "行業別就業人數", industry.employedThousands, "千人", countMeta, {
          ...common,
          record_id: `DASH-${year}-LABOR-${ageBand}-${industrySex}-EMPLOYED-INDUSTRY-${industry.industryCode}`,
          metric_code: "EMPLOYED_BY_INDUSTRY_COUNT",
          formula_zh: industry.method,
        }),
        metricRow("labor", year, ageBand, industrySex, "新北市", "行業別就業者比例", industry.sharePct, "%", shareMeta, {
          ...common,
          record_id: `DASH-${year}-LABOR-${ageBand}-${industrySex}-EMPLOYED-INDUSTRY-SHARE-${industry.industryCode}`,
          metric_code: "EMPLOYED_BY_INDUSTRY_SHARE_PCT",
          numerator: `該性別${industry.industry}就業人數`,
          denominator: `該性別新北市居住就業者總人數`,
          formula_zh: residentEmploymentIndustryData.meta.method,
        }),
      ];
    }),
  );
  return [...coreRows, ...industryRows];
}

export function buildWageRows(year: number, ageBand: AgeBand) {
  const record = getWage(year, ageBand);
  const meanMeta = record?.meta["全年總薪資平均數"] ?? null;
  const medianMeta = record?.meta["全年總薪資中位數"] ?? null;
  const native = ageBand === "25-29";
  const common = {
    category_dimension_name_zh: "統計量",
    source_url: "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642",
  };
  return [
    metricRow("wage", year, ageBand, "合計", "新北市", "全年總薪資平均數", record?.metrics["全年總薪資平均數"] ?? null, "萬元/年", meanMeta, {
      ...common,
      metric_code: "ANNUAL_TOTAL_SALARY_MEAN",
      category_name_zh: "平均數",
      formula_zh: native ? "官方表6之新北市25–29歲原生平均數" : "官方表6相鄰原生年齡帶平均數×目標年齡輔助平均提繳工資比率；18–35歲再依新北市勞保年齡人數加權",
      source_alias: native ? "STAT-WAGE-LOC" : "STAT-WAGE-LOC+BLI-AGE-REGION-SEX+BLI-PENSION-AGE-WAGE",
      source_name: native ? "表6 工業及服務業全年總薪資統計－按工作場所所在地區及年齡別分" : "主計總處表6薪資＋勞保新北市年齡人數＋勞退年齡平均提繳工資",
      note_zh: year === 114 ? "114年尚無可比官方薪資資料，不以113年代替。" : "工作場所所在地；官方未提供新北市×年齡×性別交叉表，故為男女合計。",
    }),
    metricRow("wage", year, ageBand, "合計", "新北市", "全年總薪資中位數", record?.metrics["全年總薪資中位數"] ?? null, "萬元/年", medianMeta, {
      ...common,
      metric_code: "ANNUAL_TOTAL_SALARY_MEDIAN",
      category_name_zh: "中位數",
      formula_zh: native && medianMeta ? "官方表6之新北市25–29歲原生中位數" : "目標年齡平均數×官方相鄰寬年齡帶中位數÷官方相鄰寬年齡帶平均數；18–35歲再依PCLM受僱人數權重求對數常態混合分布之第50百分位",
      source_alias: native ? "STAT-WAGE-LOC" : "STAT-WAGE-LOC+BLI-AGE-REGION-SEX+BLI-PENSION-AGE-WAGE",
      source_name: native ? "表6 工業及服務業全年總薪資統計－按工作場所所在地區及年齡別分" : "主計總處表6薪資＋勞保新北市年齡人數＋勞退年齡平均提繳工資",
      note_zh: year === 114 ? "114年尚無可比官方薪資資料，不以113年代替。" : native ? "工作場所所在地；官方未提供性別交叉表。" : "模型估計；low/high為PCLM與組內均勻替代法的敏感度範圍，不是信賴區間。",
    }),
  ];
}

export function buildDashboardExportRows(filters: { year: number; ageBand: AgeBand; sex: Sex; district: string }) {
  const { year, ageBand, sex, district } = filters;
  return {
    registered: buildRegisteredRows(year, ageBand, sex, district),
    labor: buildLaborRows(year, ageBand),
    wage: buildWageRows(year, ageBand),
  } satisfies Record<ExportUniverse, ExportRow[]>;
}

function safeCsvValue(value: string | number | null | undefined) {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const protectedValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function rowsToCsv(rows: ExportRow[], selectedFields: string[]) {
  const fields = exportCodeBook.filter((field) => selectedFields.includes(field.fieldCode));
  const lines = [fields.map((field) => safeCsvValue(field.fieldNameZh)).join(",")];
  for (const row of rows) lines.push(fields.map((field) => safeCsvValue(row[field.fieldCode])).join(","));
  return "\ufeff" + lines.join("\r\n");
}

export function codeBookToCsv() {
  const headers: Array<keyof ExportFieldDefinition> = ["fieldCode", "fieldNameZh", "definitionZh", "dataType", "unit", "group", "required", "defaultIncluded", "exampleValue"];
  const labels = ["欄位代碼", "中文欄位名稱", "定義", "資料型態", "單位", "欄位群組", "必要欄位", "預設匯出", "範例值", "Code Book版本", "生效日期"];
  const displayValue = (field: ExportFieldDefinition, key: keyof ExportFieldDefinition) => key === "required" || key === "defaultIncluded" ? (field[key] ? "是" : "否") : String(field[key]);
  return "\ufeff" + [labels.map(safeCsvValue).join(","), ...exportCodeBook.map((field) => [...headers.map((key) => displayValue(field, key)), exportCodeBookVersion, exportCodeBookEffectiveDate].map(safeCsvValue).join(","))].join("\r\n");
}

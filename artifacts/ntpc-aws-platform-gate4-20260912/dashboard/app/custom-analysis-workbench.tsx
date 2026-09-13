"use client";

import { type DragEvent, useMemo, useState } from "react";
import { ageBandLabel, dashboardData, geographyLabel, type AgeBand, type Sex } from "./dashboard-data";
import { residentEmploymentIndustryData } from "./resident-employment-industry";
import { youthIndustryWage } from "./youth-industry-wage";
import { CustomAnalysisChart } from "./custom-analysis-chart";
import { roundAxisMaximum } from "./custom-chart-layout";
import { categoryFacts } from "./data-reading";
import { DataReadingSummary } from "./data-reading-summary";

type Domain = "population" | "education" | "marriage" | "labor" | "industry" | "wage";
import {compareDimension} from './dimension-order';
type Dimension = "year" | "age" | "sex" | "geography" | "category";
type ChartKind = "bar" | "line" | "table";
type CustomRow = {
  year: number;
  age: string;
  sex: string;
  geography: string;
  category: string;
  metric: string;
  value: number | null;
  unit: string;
  identity: string;
  source: string;
  universe: string;
};

const domainLabel: Record<Domain, string> = {
  population: "戶籍人口",
  education: "教育程度",
  marriage: "婚姻狀態",
  labor: "就業與失業",
  industry: "青年就業者行業",
  wage: "工作場所薪資",
};

const dimensionLabel: Record<Dimension, string> = { year: "年度", age: "年齡", sex: "性別", geography: "地理範圍", category: "分類" };

function sourceUrl(name: string) {
  return dashboardData.sources.find((source) => source.name === name)?.url ?? "";
}

function allRows(): Record<Domain, CustomRow[]> {
  const population = dashboardData.registered.flatMap((row) => [
    { metric: "戶籍人口數", value: row.population, unit: "人", identity: row.populationOrigin },
    { metric: "占該地區同年齡性別戶籍人口比率", value: row.populationSharePct, unit: "%", identity: "官方行政精確值直接計算" },
    { metric: "戶籍人口密度", value: row.populationDensityPerKm2, unit: "人／平方公里", identity: "官方行政精確值直接計算" },
  ].map((metric) => ({ year: row.year, age: ageBandLabel(row.ageBand), sex: row.sex, geography: geographyLabel(row.geography), category: "無分類", ...metric, source: "村里戶數、單一年齡人口", universe: "戶籍登記現住人口" })));
  const education = dashboardData.registered.flatMap((row) => Object.entries(row.education).map(([category, metric]) => ({ year: row.year, age: ageBandLabel(row.ageBand), sex: row.sex, geography: geographyLabel(row.geography), category, metric: "教育程度占比", value: metric.value, unit: "%", identity: metric.origin, source: "15歲以上現住人口按教育程度分", universe: "戶籍登記現住人口" })));
  const marriage = dashboardData.registered.flatMap((row) => Object.entries(row.marriage).map(([category, metric]) => ({ year: row.year, age: ageBandLabel(row.ageBand), sex: row.sex, geography: geographyLabel(row.geography), category, metric: "婚姻狀態占比", value: metric.value, unit: "%", identity: metric.origin, source: "15歲以上現住人口按婚姻狀況分", universe: "戶籍登記現住人口" })));
  const labor = dashboardData.labor.flatMap((row) => Object.entries(row.metrics).map(([metric, value]) => ({ year: row.year, age: ageBandLabel(row.ageBand), sex: "合計", geography: "新北市", category: "無分類", metric, value, unit: row.meta[metric]?.unit ?? "", identity: row.meta[metric]?.origin ?? "官方調查估計", source: "人力資源調查統計年報", universe: metric === "失業率" || metric === "勞動力中就業占比" ? "新北市勞動力人口" : "新北市民間人口" })));
  const industry = residentEmploymentIndustryData.records.filter((row) => row.ageBand !== "ALL").flatMap((row) => [
    { metric: "就業人數", value: row.employedThousands, unit: "千人" },
    { metric: "行業占就業者比率", value: row.sharePct, unit: "%" },
  ].map((metric) => ({ year: row.year, age: ageBandLabel(row.ageBand as AgeBand), sex: row.sex, geography: "新北市", category: row.industry, ...metric, identity: row.origin, source: residentEmploymentIndustryData.meta.sourceName, universe: "平常居住於新北市的就業者" })));
  const wageBase = dashboardData.wage.filter((row) => row.ageBand === "18-35").flatMap((row) => Object.entries(row.metrics).map(([metric, value]) => ({ year: row.year, age: "18–35歲", sex: "合計", geography: "新北市工作場所", category: "無分類", metric, value, unit: row.meta[metric]?.unit ?? "萬元／年", identity: row.meta[metric]?.origin ?? "", source: "受僱員工全年總薪資統計", universe: "工作場所位於新北市的18–35歲本國籍全時受僱員工" })));
  const wageIndustry = youthIndustryWage.rows.map((row) => { const estimate = row.estimates["18-35"]; return { year: youthIndustryWage.meta.rocYear, age: "18–35歲", sex: "合計", geography: "新北市工作場所", category: row.industry, metric: "青年各行業全年總薪資平均數", value: estimate.value, unit: youthIndustryWage.meta.unit, identity: estimate.value == null ? "資料缺口" : youthIndustryWage.meta.identity, source: "受僱員工全年總薪資統計＋年齡別模型輔助資料", universe: "工作場所位於新北市的18–35歲本國籍全時受僱員工" }; });
  return { population, education, marriage, labor, industry, wage: [...wageBase, ...wageIndustry] };
}

const rowsByDomain = allRows();

function unique(values: string[]) {
  return [...new Set(values)].filter(Boolean);
}

function axisValue(row: CustomRow, dimension: Dimension) {
  if (dimension === "year") return `${row.year}年`;
  return row[dimension];
}

export function CustomAnalysisWorkbench({ initialYear, initialAge, initialSex }: { initialYear: number; initialAge: AgeBand; initialSex: Sex }) {
  const [domain, setDomain] = useState<Domain>("population");
  const [xDimension, setXDimension] = useState<Dimension>("year");
  const [seriesDimension, setSeriesDimension] = useState<Dimension>("age");
  const [metric, setMetric] = useState("戶籍人口數");
  const [chartKind, setChartKind] = useState<ChartKind>("line");
  const [filterYear, setFilterYear] = useState(String(initialYear));
  const [filterAge, setFilterAge] = useState(ageBandLabel(initialAge));
  const [filterSex, setFilterSex] = useState(initialSex);
  const [filterGeography, setFilterGeography] = useState("新北市");
  const [filterCategory, setFilterCategory] = useState("無分類");
  const rows = rowsByDomain[domain];
  const metrics = unique(rows.map((row) => row.metric));
  const availableDimensions = (["year", "age", "sex", "geography", "category"] as Dimension[]).filter((dimension) => unique(rows.map((row) => axisValue(row, dimension))).length > 1);
  const unit = rows.find((row) => row.metric === metric)?.unit ?? "";

  function changeDomain(value: Domain) {
    const domainRows = rowsByDomain[value];
    setDomain(value);
    setMetric(domainRows[0]?.metric ?? "");
    setXDimension("year");
    setSeriesDimension(value === "education" || value === "marriage" || value === "industry" ? "category" : "age");
    setFilterGeography(value === "wage" ? "新北市工作場所" : "新北市");
    setFilterCategory(domainRows[0]?.category ?? "無分類");
  }

  function acceptDimension(event: DragEvent<HTMLDivElement>, target: "x" | "series") {
    event.preventDefault();
    const value = event.dataTransfer.getData("application/x-ntpc-dimension") as Dimension;
    if (!availableDimensions.includes(value)) return;
    if (target === "x") setXDimension(value);
    else setSeriesDimension(value);
  }

  function acceptMetric(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const value = event.dataTransfer.getData("application/x-ntpc-metric");
    if (metrics.includes(value)) setMetric(value);
  }

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (row.metric !== metric || row.value == null) return false;
    const axisDimensions = new Set([xDimension, seriesDimension]);
    if (!axisDimensions.has("year") && String(row.year) !== filterYear) return false;
    if (!axisDimensions.has("age") && row.age !== filterAge) return false;
    if (!axisDimensions.has("sex") && row.sex !== filterSex) return false;
    if (!axisDimensions.has("geography") && row.geography !== filterGeography) return false;
    if (!axisDimensions.has("category") && row.category !== filterCategory) return false;
    return true;
  }), [rows, metric, xDimension, seriesDimension, filterYear, filterAge, filterSex, filterGeography, filterCategory]);

  const chartRows = useMemo(() => {
    const grouped = new Map<string, { x: string; series: string; value: number; row: CustomRow }>();
    for (const row of filteredRows) {
      const x = axisValue(row, xDimension);
      const series = axisValue(row, seriesDimension);
      const key = `${x}\u0000${series}`;
      if (!grouped.has(key)) grouped.set(key, { x, series, value: row.value!, row });
    }
    return [...grouped.values()].sort((a,b)=>compareDimension(a.x,b.x,xDimension)||compareDimension(a.series,b.series,seriesDimension));
  }, [filteredRows, xDimension, seriesDimension]);

  const xValues = unique(chartRows.map((row) => row.x)).sort((a, b) => compareDimension(a,b,xDimension));
  const allSeries = unique(chartRows.map((row) => row.series)).sort((a,b)=>compareDimension(a,b,seriesDimension));
  const seriesValues = allSeries.length > 8 ? allSeries.slice(0, 8) : allSeries;
  const visibleRows = chartRows.filter((row) => seriesValues.includes(row.series));
  const maxValue = Math.max(1, ...visibleRows.map((row) => row.value));
  const yMax = roundAxisMaximum(maxValue);
  const presentedRows = chartKind === "table" ? chartRows : visibleRows;
  const identity = unique(presentedRows.map((row) => row.row.identity)).join("；");
  const universe = unique(presentedRows.map((row) => row.row.universe)).join("；") || rows[0]?.universe;
  const source = unique(presentedRows.map((row) => row.row.source)).join("；") || rows[0]?.source;

  return <div className="custom-analysis-workbench">
    <section className="custom-builder section-shell" aria-labelledby="custom-builder-title">
      <header><div><p className="kicker">自訂分析</p><h2 id="custom-builder-title">選擇欄位，比較你關心的數值</h2><p>拖曳欄位或使用選單，即可調整圖表。</p></div><span className="universe-lock">目前主題：{domainLabel[domain]}</span></header>
      <div className="custom-domain-tabs" role="tablist" aria-label="資料主題">{(Object.keys(domainLabel) as Domain[]).map((key) => <button key={key} type="button" role="tab" aria-selected={domain === key} onClick={() => changeDomain(key)}>{domainLabel[key]}</button>)}</div>
      <div className="custom-builder-grid">
        <aside className="field-shelf" aria-label="可用欄位">
          <h3>可用欄位</h3><p>拖到右側角色，或直接使用選單。</p>
          <strong>類別欄位</strong>{availableDimensions.map((dimension) => <button key={dimension} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("application/x-ntpc-dimension", dimension)}>{dimensionLabel[dimension]}<span>拖曳</span></button>)}
          <strong>數值欄位</strong>{metrics.map((item) => <button key={item} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("application/x-ntpc-metric", item)}>{item}<span>{rows.find((row) => row.metric === item)?.unit}</span></button>)}
        </aside>
        <div className="chart-role-area">
          <div className="chart-role-wells">
            <div className="role-well" onDragOver={(event) => event.preventDefault()} onDrop={(event) => acceptDimension(event, "x")}><label>X軸（比較順序）<select value={xDimension} onChange={(event) => setXDimension(event.target.value as Dimension)}>{availableDimensions.map((dimension) => <option key={dimension} value={dimension}>{dimensionLabel[dimension]}</option>)}</select></label></div>
            <div className="role-well" onDragOver={(event) => event.preventDefault()} onDrop={(event) => acceptMetric(event)}><label>Y軸（數值）<select value={metric} onChange={(event) => setMetric(event.target.value)}>{metrics.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div>
            <div className="role-well" onDragOver={(event) => event.preventDefault()} onDrop={(event) => acceptDimension(event, "series")}><label>圖例（分組）<select value={seriesDimension} onChange={(event) => setSeriesDimension(event.target.value as Dimension)}>{availableDimensions.filter((dimension) => dimension !== xDimension).map((dimension) => <option key={dimension} value={dimension}>{dimensionLabel[dimension]}</option>)}</select></label></div>
          </div>
          <div className="custom-filter-grid" aria-label="未放入圖表的欄位篩選">
            {!new Set([xDimension, seriesDimension]).has("year") && <label>年度<select value={filterYear} onChange={(event) => setFilterYear(event.target.value)}>{unique(rows.map((row) => String(row.year))).map((value) => <option key={value} value={value}>{value}年</option>)}</select></label>}
            {!new Set([xDimension, seriesDimension]).has("age") && <label>年齡<select value={filterAge} onChange={(event) => setFilterAge(event.target.value)}>{unique(rows.map((row) => row.age)).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
            {!new Set([xDimension, seriesDimension]).has("sex") && <label>性別<select value={filterSex} onChange={(event) => setFilterSex(event.target.value)}>{unique(rows.map((row) => row.sex)).sort((a,b)=>compareDimension(a,b,"sex")).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
            {!new Set([xDimension, seriesDimension]).has("geography") && <label>地理範圍<select value={filterGeography} onChange={(event) => setFilterGeography(event.target.value)}>{unique(rows.map((row) => row.geography)).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
            {!new Set([xDimension, seriesDimension]).has("category") && <label>分類<select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)}>{unique(rows.map((row) => row.category)).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
            <fieldset><legend>圖表</legend>{(["bar", "line", "table"] as ChartKind[]).map((kind) => <button key={kind} type="button" aria-pressed={chartKind === kind} onClick={() => setChartKind(kind)}>{kind === "bar" ? "長條" : kind === "line" ? "折線" : "資料表"}</button>)}</fieldset>
          </div>
        </div>
      </div>
    </section>

    <section className="custom-result section-shell" aria-labelledby="custom-result-title">
      <div className="section-heading"><div><p className="kicker">即時預覽｜{domainLabel[domain]}</p><h2 id="custom-result-title">{metric}：依{dimensionLabel[xDimension]}比較</h2></div><span>{presentedRows.length}個資料點</span></div>
      <p className="reading-context">{universe}｜{identity || "目前條件尚無資料"}</p>
      {presentedRows.length > 0 && <DataReadingSummary facts={categoryFacts(presentedRows.map((row) => ({ label: `${row.x}・${row.series}`, value: row.value })), `目前${chartKind === "table" ? "資料表" : "圖表"}中的${metric}`, unit, unit === "人" ? 0 : 2)} />}
      {!presentedRows.length ? <div className="custom-empty"><strong>目前條件沒有資料</strong><p>請調整年齡、性別、地理範圍或分類。</p></div> : chartKind === "table" ? <div className="table-scroll"><table><thead><tr><th>{dimensionLabel[xDimension]}</th><th>{dimensionLabel[seriesDimension]}</th><th>{metric}</th><th>單位</th><th>數值身分</th></tr></thead><tbody>{presentedRows.map((row) => <tr key={`${row.x}-${row.series}`}><td>{row.x}</td><td>{row.series}</td><td>{new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(row.value)}</td><td>{row.row.unit}</td><td>{row.row.identity}</td></tr>)}</tbody></table></div> : <>
        <CustomAnalysisChart rows={visibleRows} xValues={xValues} seriesValues={seriesValues} metric={metric} unit={unit} dimension={xDimension} dimensionLabel={dimensionLabel[xDimension]} kind={chartKind} yMax={yMax} />
        {allSeries.length > seriesValues.length && <p className="custom-truncation-note">目前圖表只顯示前8個分類；切換資料表可查看完整資料。</p>}
      </>}
      <details className="custom-evidence reading-method-details"><summary>資料來源與圖表說明</summary><dl><div><dt>母體</dt><dd>{universe}</dd></div><div><dt>數值身分</dt><dd>{identity || "依個別資料點標示"}</dd></div><div><dt>來源</dt><dd>{source}</dd></div><div><dt>尺度</dt><dd>{chartKind === "table" ? "資料表列出目前篩選的全部分類；無Y軸尺度。" : `Y軸固定由0到${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 }).format(yMax)} ${unit}`}</dd></div></dl><p>本頁呈現所選欄位的數值比較。X軸與Y軸是圖表角色，不代表因果關係；政策效果需另行設計評估。</p></details>
      {source && <a className="text-link" href={sourceUrl(source.split("；")[0]) || undefined}>查看對應資料頁的官方來源</a>}
    </section>
  </div>;
}

from __future__ import annotations

import csv
import hashlib
import importlib.util
import json
from pathlib import Path


PROJECT = Path(r"D:\github\work\019fe05e-e1a3-71f2-840e-c026180d9474\NtpcYouthAI")
PACKAGE = PROJECT / "deliverables" / "NTPC_Youth_18-35_Government_Open_Data_Package_V2.3_20260825"
VERSION = "V2.3"
COLLECTED = "2026-08-25"

spec = importlib.util.spec_from_file_location(
    "doc_helpers",
    PROJECT / "scripts" / "build_government_data_package_v23.py",
)
base = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(base)
base.PACKAGE = PACKAGE
base.VERSION = VERSION
base.COLLECTED = COLLECTED


def save(doc, relative: str) -> Path:
    path = PACKAGE / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    return path


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_csv(relative: str, header: list[str], rows: list[list[object]]) -> Path:
    path = PACKAGE / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)
    return path


def source_manifest() -> None:
    excluded = {"BLI-PENSION-WAGE-AGE", "BLI-WAGEGRADE-LOC"}
    rows = []
    for row in base.SOURCES:
        if row["alias"] in excluded:
            continue
        row = dict(row)
        if row["alias"] == "STAT-WAGE-LOC":
            row.update({
                "period": "目前附件最新工作表113年；官方網頁查核日115-08-25",
                "use": "113年新北市工作地×年齡全年總薪資平均數與中位數原生值",
                "limit": "最新附件尚無114年新北市×年齡表；不得用全國114年或投保薪資替代",
            })
        if row["alias"] == "STAT-WAGE-EDU":
            row.update({
                "period": "目前附件最新工作表113年；官方網頁查核日115-08-25",
                "use": "113年全國年齡×教育全年總薪資參考",
                "limit": "不是新北市資料，亦不能補成114年新北市值",
            })
        if row["alias"] == "BLI-INS-AGE-LOC":
            row.update({
                "use": "僅作投保涵蓋與年齡結構診斷；不進入薪資估計公式",
                "limit": "投保人數母體不等於本國籍全時受僱員工；不可作薪資權數除非完成正式母體適配驗證",
            })
        if row["alias"] == "MOF-SALARY-AGE":
            row.update({
                "use": "全國薪資所得描述性參考，不進入新北18–35薪資估計",
                "limit": "全國、稅務薪資所得口徑；不得替代新北工作地全年總薪資",
            })
        rows.append(row)

    rows.extend([
        {
            "alias": "MOI-MARITAL5Y-113",
            "title": "15歲以上現住人口按性別、年齡及婚姻狀況分",
            "authority": "內政部戶政司",
            "dataset_url": "https://data.gov.tw/dataset/117986",
            "resource_url": "https://www.ris.gov.tw/AS2/infocenter/opendata113Y031.zip",
            "local_path": "07_婚姻狀態/raw/opendata113Y031.zip",
            "period": "113年年底",
            "geography": "戶籍登記地（縣市／區／里）",
            "age": "五歲年齡組",
            "evidence": "OFFICIAL_ADMIN_EXACT",
            "use": "113年婚姻狀態基準與114年年對年比較",
            "limit": "年齡邊界18、19、35歲須以PCLM＋IPF估計；不是實際居住地",
            "download_status": "DOWNLOADED_AND_PROCESSED",
        },
        {
            "alias": "MOI-MARITAL5Y-114",
            "title": "15歲以上現住人口按性別、年齡及婚姻狀況分",
            "authority": "內政部戶政司",
            "dataset_url": "https://data.gov.tw/dataset/117986",
            "resource_url": "https://www.ris.gov.tw/AS2/infocenter/opendata114Y031.zip",
            "local_path": "07_婚姻狀態/raw/opendata114Y031.zip",
            "period": "114年年底",
            "geography": "戶籍登記地（縣市／區／里）",
            "age": "五歲年齡組",
            "evidence": "OFFICIAL_ADMIN_EXACT",
            "use": "婚姻四分類、衍生二分類與18–35估計",
            "limit": "25–29可精確加總；18–24、30–35、18–35含模型邊界",
            "download_status": "DOWNLOADED_AND_PROCESSED",
        },
        {
            "alias": "MOI-POP1Y-11312-CAL",
            "title": "113年12月單一年齡戶籍人口校準邊際",
            "authority": "內政部戶政司",
            "dataset_url": "https://data.gov.tw/dataset/77132",
            "resource_url": "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/11312?page={page}",
            "local_path": "07_婚姻狀態/raw/MOI-POP1Y-11312.json",
            "period": "113年12月",
            "geography": "戶籍登記地",
            "age": "單一年齡",
            "evidence": "OFFICIAL_ADMIN_EXACT",
            "use": "婚姻五歲組拆分的單歲人口列邊際",
            "limit": "只校準人口年齡邊際，不提供單歲婚姻狀態",
            "download_status": "DOWNLOADED_AND_PROCESSED",
        },
    ])
    path = PACKAGE / "00_總覽與治理" / "source_manifest.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def governance_files() -> None:
    source_manifest()
    write_csv(
        "00_總覽與治理/openapi_registry.csv",
        ["source_alias", "access_class", "endpoint_template", "parameters", "cadence", "quality_gate", "dashboard_rule"],
        [
            ["MOI-POP1Y", "REST_JSON_PAGED", "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/{YYYMM}?page={page}", "民國年月；page=1..totalPage", "每月", "頁數、總列數、重複頁、單歲欄、SHA-256", "月末戶籍人口；年度以12月末存量"],
            ["MOI-MARITAL5Y", "REST_JSON_OR_ZIP", "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP052/{YYY}", "民國年；大檔優先官方ZIP opendataYYY Y031", "每年", "排除第二列雙語表頭、分類碼、五歲組總量、與單歲人口邊際一致", "年底婚姻存量；不得拆成月值"],
            ["DGBAS-HR", "OFFICIAL_XLSX_XML", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078", "年度附件依表頭與工作表判讀", "每年", "P≥LF≥E、LF=E+U容許四捨五入、率以分子分母重算QA", "02與03共用一個勞動事實模型"],
            ["DGBAS-WAGE", "OFFICIAL_XLSX", "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642", "先讀最新工作表年份，不以網頁更新日代替資料年", "每年探測", "工作地、母體、年齡、平均/中位、資料年、SHA-256", "目前新北×年齡僅113；跨主題用共同年或顯示不同期標章"],
            ["NTPC-OPENAPI", "REST_JSON_PAGED", "https://data.ntpc.gov.tw/openapi/", "依dataset UUID；page/size防重複", "依來源", "schema、短頁、重複頁、最新資料期", "命題平台來源與中央來源交叉查核"],
        ],
    )
    write_csv(
        "00_總覽與治理/time_granularity_policy.csv",
        ["metric_type", "official_period_basis", "annual_display", "monthly_display", "allowed_comparison", "prohibited_transformation"],
        [
            ["人口存量", "END_OF_MONTH", "12月末；非12月加總", "官方每月月末", "MOM、同月YOY、任意月份差異（季節性提示）", "不得12個月相加"],
            ["失業/勞動比率", "ANNUAL_OR_HALF_YEAR_AVERAGE", "官方年度平均；率=年度分子合計/年度分母合計", "只有官方單月分子分母才顯示", "同粒度比較；不同月份顯示季節性與抽樣誤差提示", "不得平均各月率、不得把半年當12月"],
            ["教育存量", "END_OF_YEAR", "年底戶籍註記存量", "不估月值", "年度YOY", "不得除12或複製12個月"],
            ["薪資", "ANNUAL_NATIVE", "官方全年總薪資", "若無同母體月薪系列則不估", "年度YOY且地理/母體/年齡一致", "不得用月投保薪資推估全年總薪資"],
            ["婚姻狀態存量", "END_OF_YEAR_12_31", "年底戶籍登記婚姻存量", "不估月值；婚姻登記件數屬流量不可替代", "年度YOY", "不得線性插值、平均分12份或拿月事件流量當存量"],
        ],
    )
    write_csv(
        "00_總覽與治理/issue_resolution_matrix_v2.3.csv",
        ["issue_id", "question", "decision", "status", "human_review"],
        [
            ["V23-01", "人口是否為民間人口", "人口模組採戶籍登記現住人口；勞動分母另採主計總處15歲以上民間人口，兩者不混用", "RESOLVED", "否"],
            ["V23-02", "02失業與03勞動是否同資料", "共用P/LF/E/U事實模型與取得管線；可保留兩個展示模組；實體附件依表別可能不同", "RESOLVED", "否"],
            ["V23-03", "opendata114Y051 population意義", "每列指定地理×性別×五歲年齡×婚姻×教育交叉格的人數；小格為0屬合理", "RESOLVED", "否"],
            ["V23-04", "薪資皆全國且僅113", "表6其實含新北工作地；目前最新新北×年齡工作表仍為113，114全國值不得替代", "PARTIAL_DATA_GAP", "是：是否接受共同年113或不同期標章"],
            ["V23-05", "月投保薪資能否推估薪資", "不能；已自正式估計流程移除，只保留投保人數作涵蓋診斷", "RESOLVED", "否"],
            ["V23-06", "新增婚姻狀態", "採內政部婚姻四分類；另衍生目前有/無配偶二分類；113與114已處理", "MODEL_REVIEW", "是：18/19/35歲PCLM+IPF結果發布前覆核"],
        ],
    )
    write_csv(
        "00_總覽與治理/labor_unemployment_shared_fact_model.csv",
        ["field", "definition", "relationship", "source_family", "presentation_module"],
        [
            ["P", "15歲以上民間人口", "P=LF+非勞動力", "DGBAS人力資源調查", "03"],
            ["LF", "勞動力人口", "LF=E+U", "DGBAS人力資源調查", "02與03"],
            ["E", "就業人口", "E=LF-U", "DGBAS人力資源調查", "03"],
            ["U", "失業人口", "U=LF-E", "DGBAS人力資源調查", "02"],
            ["UR", "失業率", "UR=U/LF×100", "DGBAS人力資源調查", "02"],
            ["LFPR", "勞動力參與率", "LFPR=LF/P×100", "DGBAS人力資源調查", "03"],
        ],
    )
    write_csv(
        "00_總覽與治理/human_review_checklist_v2.3.csv",
        ["review_id", "item", "evidence", "decision_needed", "recommended", "status"],
        [
            ["HR-01", "薪資跨主題期別", "新北工作地×年齡最新為113；人口/勞動可到114", "選共同年113或latest-available分頁", "政策比較用共同年113；最新監測另頁顯示資料期", "PENDING_USER"],
            ["HR-02", "婚姻二分類名稱", "官方為未婚/有偶/離婚/喪偶", "是否展示官方四分類及衍生目前有/無配偶", "兩種視圖都保留，衍生欄明標DERIVED", "RECOMMENDED"],
            ["HR-03", "婚姻邊界模型", "25–29精確；18/19/35用PCLM+IPF", "核准模型值進儀表板", "先標MODEL_ESTIMATE與敏感度範圍，通過人工抽核後發布", "PENDING_REVIEW"],
            ["HR-04", "婚姻月資料", "年度婚姻狀態是存量；月婚姻登記是流量", "是否需要月圖", "不估月存量；如需月圖另建『婚姻登記事件』指標", "RECOMMENDED"],
        ],
    )


def doc_overview() -> Path:
    doc = base.new_doc("DOC-00", "V2.3 總覽、決策與查核索引", "七項問題結論｜共同期策略｜資料充足度｜人工裁示", "已完成方法修訂")
    base.add_callout(doc, "本版結論", "人口與民間人口分流；失業與勞動共用P/LF/E/U事實模型；教育population欄位已釐清；薪資停止使用月投保薪資代理；新增113/114年婚姻狀態資料夾與PCLM＋IPF結果。", "info")
    doc.add_heading("1. 問題逐項處理", level=1)
    base.add_table(doc, ["項次", "處理結論", "資料狀態", "儀表板規則"], [
        ["01 人口", "採戶籍登記現住人口；勞動另用民間人口", "11412精確；11507最新", "不得用戶籍人口當失業率分母"],
        ["02＋03", "共用P/LF/E/U管線與資料契約", "25–29可驗證；18–35邊界待模型", "UR=U/LF；LFPR=LF/P"],
        ["04 教育population", "交叉格人數，不是百分比或全市總人口", "114官方行政精確值", "先過濾地理/性別/年齡/婚姻/教育再加總"],
        ["05 薪資年度", "表6含新北工作地；最新工作表113", "114新北×年齡尚缺", "共同年或latest-available；資料期醒目標章"],
        ["06 投保薪資", "自薪資估計移除", "只留投保人數涵蓋診斷", "不得標成實際薪資"],
        ["07 婚姻", "官方四分類＋衍生二分類", "113/114已處理", "25–29精確；邊界模型分色"],
    ], [2.1, 6.7, 4.4, 5.0])
    doc.add_heading("2. 共同期與最新期雙軌", level=1)
    base.add_flow(doc, [("研究比較", "同一資料年、同一地理、同一母體"), ("共同年", "薪資受限時採113年"), ("最新監測", "各指標顯示source_period"), ("不可比", "不計算跨定義綜合分數"), ("裁示", "HR-01")])
    base.add_table(doc, ["場景", "建議", "理由"], [
        ["政策橫向比較", "固定共同年113", "避免人口114、薪資113在同一截面互相比較"],
        ["營運最新監測", "允許latest-available", "但每張卡片顯示資料期、母體、地理角色與證據類別"],
        ["時間趨勢", "同一來源同一口徑逐年", "不以不同年份不同附件拼成趨勢"],
    ], [4.0, 6.0, 8.0])
    doc.add_heading("3. 人工查核", level=1)
    base.add_bullets(doc, [
        "HR-01：選擇薪資與其他主題的共同年呈現或latest-available分頁。",
        "HR-03：婚姻18–35模型值發布前，抽核25–29精確組、IPF邊際與兩種拆分法的敏感度。",
        "任何MODEL_ESTIMATE均顯示方法碼、低高值與來源雜湊；官方值與模型值不得同色。",
    ])
    base.add_sources(doc, [
        ("MOI", "戶籍統計資料", "https://data.gov.tw/dataset/77132"),
        ("DGBAS", "114年人力資源調查統計", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078"),
        ("WAGE", "全年總薪資統計表", "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642"),
    ])
    return save(doc, f"00_總覽與治理/00_總覽決策與查核索引_{VERSION}.docx")


def doc_population() -> Path:
    doc = base.new_doc("DOC-01", "人口年齡結構：定義、API與年度/月度處理", "戶籍登記現住人口｜非民間人口｜單歲精確加總", "可正式發布")
    base.add_callout(doc, "定義結論", "本資料包01人口指『戶籍登記現住人口』：依戶籍登記地統計的行政人口。它不是實際通常居住人口、不是工作地人口，也不是人力資源調查的15歲以上民間人口。", "warn")
    doc.add_heading("1. 三種人口不可互換", level=1)
    base.add_table(doc, ["名稱", "來源/定義", "可用處", "不可用處"], [
        ["戶籍登記現住人口", "內政部戶政登記；地理=戶籍地", "青年人口規模、婚姻/教育行政存量校準", "失業率分母"],
        ["15歲以上民間人口", "主計總處人力資源調查；排除武裝勞動力及監管人口", "勞參率分母P、勞動市場指標", "戶籍行政總人口"],
        ["實際/通常居住人口", "人口及住宅普查或相關推估", "居住服務需求研究", "未經來源轉換直接代替戶籍人口"],
    ], [4.3, 6.4, 4.2, 3.3])
    doc.add_heading("2. OpenAPI取得", level=1)
    base.add_formula(doc, "GET ODRP014/{YYYMM}?page=p；p=1…totalPage", "YYYMM為民國年月；每頁保存請求URL、HTTP狀態、totalPage、totalDataSize與SHA-256。")
    base.add_steps(doc, [
        ("期別", "共同期用11412；最新監測先找最近已發布月份。"),
        ("分頁", "從第1頁讀到totalPage；拒絕重複頁、缺頁或列數不符。"),
        ("篩選", "依COUNTY_ID/COUNTY、新北市名稱及資料字典，不以模糊字串猜地理。"),
        ("加總", "逐列加總男女各單歲欄位18…35；行政計數不需PCLM。"),
        ("時間", "月資料為月末存量；年度主要值為12月末，不把12個月相加。"),
    ])
    base.add_formula(doc, "Population(18–35,t)=Σa=18..35 [Male(a,t)+Female(a,t)]", "114年12月新北市精確加總=845,938人；證據類別OFFICIAL_ADMIN_EXACT。")
    doc.add_heading("3. 與勞動資料連接", level=1)
    base.add_callout(doc, "禁止分母替換", "失業率使用U/LF；勞參率使用LF/P，其中P為主計總處民間人口。戶籍人口只可平行顯示，不可代入分母。", "stop")
    base.add_sources(doc, [
        ("MOI-POP1Y", "村里戶數及單一年齡人口", "https://data.gov.tw/dataset/77132"),
        ("DGBAS-METHOD", "人力資源調查統計定義", "https://www.stat.gov.tw/public/Data/11122153012VTN8S5UB.pdf"),
    ])
    return save(doc, f"01_年齡人口結構/01_人口定義_OpenAPI與驗證_{VERSION}.docx")


def labor_doc(code: str, folder: str, title: str, focus: str) -> Path:
    doc = base.new_doc(code, title, "共用P/LF/E/U事實模型｜官方調查估計｜分子分母一致", "25–29可驗證；18–35待邊界模型")
    base.add_callout(doc, "整併結論", "02失業率與03勞動力/就業應共用同一取得與標準化管線；但來源附件未必是一個實體檔。表42可同時提供P/LF/E/U，年度表27/28/32/36/37則依表別分開。", "info")
    doc.add_heading("1. 共用資料模型", level=1)
    base.add_table(doc, ["符號", "欄位", "公式/一致性", "用途"], [
        ["P", "民間人口", "P≥LF", "勞參率分母"], ["LF", "勞動力", "LF=E+U", "失業率分母"],
        ["E", "就業人口", "E=LF−U", "就業人口比率"], ["U", "失業人口", "U=LF−E", "失業率分子"],
        ["UR", "失業率", "U/LF×100", "02模組"], ["LFPR", "勞參率", "LF/P×100", "03模組"],
    ], [2.0, 4.1, 5.5, 6.2])
    doc.add_heading("2. 年齡調整與驗證", level=1)
    base.add_steps(doc, [
        ("25–29第一階段", "直接讀官方原生組；114年新北官方失業率6.4%。"),
        ("計數QA", "以U=15千人、LF=230千人回算6.52%；與6.4%的差異源於千人四捨五入，正式值仍採6.4%。"),
        ("18–35第二階段", "P、LF、E、U分別對15–24與35–39做PCLM/Sprague邊界拆分；禁止直接拆比率。"),
        ("重算比率", "拆分後加總U18–35與LF18–35，再計算UR；同理LFPR=LF18–35/P18–35。"),
        ("一致性", "每個年齡/性別/期別檢查P≥LF≥E≥0、U≥0、LF≈E+U；差異門檻納入來源四捨五入。"),
    ])
    base.add_formula(doc, "UR18–35 = 100×Σa U[a] / Σa LF[a]；LFPR18–35 = 100×Σa LF[a] / Σa P[a]", "率不得做算術平均；所有分子分母須同一資料期、地理與調查母體。")
    doc.add_heading("3. 時間處理", level=1)
    base.add_bullets(doc, [
        "年度值是官方年度平均；表41/42部分欄位為半年平均，不是12月單月。",
        "若取得真正單月P/LF/E/U，可做同月YOY及不同月份比較；未季調的不同月份比較顯示季節性警示。",
        "年度失業率使用年度分子分母的比率，不能平均12個月發布率，也不能把年度率複製成12個月。",
    ])
    doc.add_heading("4. 模組重點", level=1)
    base.add_callout(doc, focus, "02與03保留不同畫面是為了政策解讀；資料底層只留一份標準化事實表與一份來源雜湊，避免數字漂移。", "warn")
    base.add_sources(doc, [
        ("DGBAS-HR", "114年人力資源調查統計年報", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078"),
        ("DGBAS-NTPC", "114年12月縣市別勞動統計", "https://www.stat.gov.tw/News_Content.aspx?n=4003&s=235759"),
    ])
    return save(doc, f"{folder}/{folder[:2]}_{'失業率' if folder.startswith('02') else '勞動力與就業'}_共用資料模型與驗證_{VERSION}.docx")


def doc_education() -> Path:
    doc = base.new_doc("DOC-04", "教育資料：population欄位、交叉格與18–35處理", "opendata114Y051｜戶籍教育註記｜五歲組×婚姻×教育", "欄位定義已釐清")
    base.add_callout(doc, "population的真正意義", "population是該列『年度×戶籍地×性別×五歲年齡組×婚姻狀態×教育程度』交叉格的人數，不是百分比、抽樣權數或全新北總人口。", "info")
    doc.add_heading("1. 為何數值看起來小或為0", level=1)
    base.add_table(doc, ["原因", "例子", "處理"], [
        ["交叉維度很細", "里×15–19×博士×有偶", "0可能是真實稀疏格，不當遺漏"],
        ["第二列是雙語欄名", "year/統計年等", "明確排除，不當資料列"],
        ["單列不是總計", "只代表一個教育與婚姻格", "按所需維度group by後sum(population)"],
        ["地理為戶籍地", "不是就學地/工作地", "欄位標REGISTERED_RESIDENCE"],
    ], [4.0, 5.1, 5.3, 3.6])
    doc.add_heading("2. 可回答與不可回答", level=1)
    base.add_bullets(doc, [
        "MOI-EDU5Y可回答新北各五歲年齡組的教育×婚姻聯合人數；原始行政數為官方精確值。",
        "表27/32的教育與年齡為同列兩組邊際，不是交叉表；可做總體教育結構、P/E年齡邊際與IPF約束，不能直接當25–29教育分布。",
        "表50有年齡×教育交叉但地理是全臺；只能作全國描述或模型種子，不可標成新北官方值。",
    ])
    doc.add_heading("3. 18–35換算", level=1)
    base.add_steps(doc, [
        ("精確組", "25–29可直接跨地理、性別、婚姻加總所需教育格。"),
        ("邊界組", "對每一教育×婚姻×性別序列以PCLM拆15–19、20–24、35–39的單歲形狀。"),
        ("校準", "IPF使單歲年齡總量精確回到MOI單歲人口邊際，並使教育/婚姻五歲組總量不變。"),
        ("彙總", "加總18–24、25–29、30–34及35歲；標MODEL_ESTIMATE_FROM_OFFICIAL_MARGINS。"),
        ("驗證", "25–29模型聚合必須等於官方精確組；列欄邊際差異近0；改用比例拆分做敏感度。"),
    ])
    base.add_formula(doc, "x[a,e,m,s] → IPF：Σe,m x[a,e,m,s]=Population1Y[a,s]；Σa∈G x[a,e,m,s]=Official5Y[G,e,m,s]", "PCLM提供非負初值；IPF只校準邊際。若無可信種子，結果只發布為模型估計。")
    base.add_sources(doc, [
        ("MOI-EDU5Y", "15歲以上現住人口按性別、年齡、婚姻及教育分", "https://data.gov.tw/dataset/117988"),
        ("MOI-REG", "戶口統計資料編製規定", "https://www.ris.gov.tw/info-liferay/app/channel/regulationDetail/22343496?p=2"),
        ("DGBAS-T50", "114年人力資源調查表50（全臺）", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078"),
    ])
    return save(doc, f"04_教育程度/04_教育population欄位與年齡轉換_{VERSION}.docx")


def doc_salary_mean() -> Path:
    doc = base.new_doc("DOC-05", "薪資平均數：113/114年度、地理與代理變數修訂", "新北工作地｜目前最新113年｜停止投保薪資推估", "18–35正式值HOLD")
    base.add_callout(doc, "查核結果", "表6不是純全國表；它按工作場所縣市列示，包含新北市列。但目前官方附件最新工作表仍為113年。114年全國薪資結果不能替代114年新北×年齡。", "warn")
    doc.add_heading("1. 可直接使用的113年原生值", level=1)
    base.add_table(doc, ["統計量", "全體", "未滿25", "25–29", "30–39", "單位/地理"], [
        ["平均數", "71.1", "48.3", "59.9", "69.0", "萬元/年；工作地新北"],
        ["中位數", "55.7", "45.1", "52.4", "57.3", "萬元/年；工作地新北"],
    ], [3.2, 2.7, 3.0, 3.0, 3.0, 5.2])
    doc.add_heading("2. 為何月投保薪資不能推估實際薪資", level=1)
    base.add_table(doc, ["差異", "投保/提繳資料", "全年總薪資"], [
        ["概念", "制度申報級距或月提繳基礎", "全年經常性＋非經常性薪資"],
        ["母體", "參加特定保險/退休制度者", "本國籍全時受僱員工"],
        ["上限/級距", "受制度級距與上限影響", "實際支付總額"],
        ["時間", "月度申報", "年度累計"],
    ], [4.2, 7.0, 7.0])
    base.add_callout(doc, "V2.3修訂", "BLI-PENSION-WAGE-AGE與BLI-WAGEGRADE-LOC已從正式薪資來源與估計流程移除。BLI投保人數只可作涵蓋率/母體差異診斷，不進入薪資公式。", "stop")
    doc.add_heading("3. 目前可做與不可做", level=1)
    base.add_table(doc, ["輸出", "狀態", "理由", "下一步"], [
        ["113新北25–29平均薪資", "PUBLISH_SOURCE_NATIVE", "官方原生年齡組", "顯示工作地與本國籍全時受僱母體"],
        ["113新北18–35平均薪資", "HOLD", "缺18–24、30–34、35歲同母體薪資與受僱權數", "申請去識別微資料或官方客製表"],
        ["114新北25–29/18–35", "HOLD", "官方表6尚無114工作表", "定期探測官方附件；不得用全國114補值"],
        ["月薪資趨勢", "HOLD", "無同母體月薪×年齡×新北資料", "另找官方同母體月資料；不可由年值拆月"],
    ], [5.2, 4.0, 6.3, 4.5])
    doc.add_heading("4. 儀表板年度規則", level=1)
    base.add_bullets(doc, [
        "跨主題政策比較優先切到共同年113；薪資卡片不可混在114截面又不標期別。",
        "最新監測頁允許人口114/115與薪資113並列，但每張卡顯示『資料期、地理角色、母體、證據類別』。",
        "114全國薪資只可另建全國參考卡，不能覆寫新北工作地欄位。",
    ])
    base.add_sources(doc, [
        ("STAT-WAGE-LOC", "表6工作場所縣市×年齡全年總薪資", "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642"),
        ("DGBAS-114", "114年薪資調查新聞（不同粒度）", "https://www.stat.gov.tw/News_Content.aspx?n=2724&s=235863"),
    ])
    return save(doc, f"05_薪資平均數/05_薪資年度地理與代理變數修訂_{VERSION}.docx")


def doc_salary_median() -> Path:
    doc = base.new_doc("DOC-06", "薪資中位數：正式停止條件與必要資料", "不可加權中位數｜不可用投保薪資代理｜缺分布則NO_ESTIMATE", "18–35正式值HOLD")
    base.add_callout(doc, "停止條件", "目前只有113年新北工作地寬年齡組中位數，沒有18–35個體分布或年齡×薪資級距×權數。中位數非線性統計量，因此不估18–35。", "stop")
    doc.add_heading("1. 為何無法由寬組中位數合併", level=1)
    base.add_bullets(doc, [
        "各年齡組中位數與人數不足以決定合併後第50百分位；需要知道組間薪資排序與交疊。",
        "把各組中位數加權平均得到的是沒有統計意義的數字，不是合併中位數。",
        "投保薪資級距的母體與概念不同，即使算出其中位數也只能稱投保薪資分布，不能稱全年總薪資中位數。",
    ])
    doc.add_heading("2. 足夠資料時的正式算法", level=1)
    base.add_steps(doc, [
        ("必要資料", "新北工作地×單歲/可拆年齡×全年總薪資級距×人數，或去識別微資料與權數。"),
        ("年齡邊界", "在每個薪資級距內以PCLM拆18、19、35歲，再以IPF校準年齡與薪資邊際。"),
        ("CDF", "將18–35權數按薪資由低到高累積，找到第一個累積權數≥N/2的級距。"),
        ("組內插值", "只在封閉級距內做線性或替代分布敏感度；開放頂端須保守處理。"),
        ("驗證", "聚合25–29應重現官方52.4萬元/年中位數的允許誤差；不同插值假設報區間。"),
    ])
    base.add_formula(doc, "Median≈L+[(0.5N−Cprev)/f]×h", "此公式僅適用同一母體的薪資級距分布；V2.3不以投保薪資代入。")
    doc.add_heading("3. 發布欄位", level=1)
    base.add_table(doc, ["欄位", "目前值"], [
        ["publish_status", "HOLD_NO_AGE_BY_ANNUAL_SALARY_DISTRIBUTION"],
        ["value", "NULL"],
        ["gap_reason", "缺新北×18–35×全年總薪資分布與權數"],
        ["prohibited_proxy", "月投保薪資、平均提繳工資、全國稅務薪資"],
    ], [6.0, 12.2])
    base.add_sources(doc, [
        ("STAT-WAGE-LOC", "表6工作場所縣市×年齡全年總薪資", "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642"),
        ("DGBAS-METHOD", "薪資中位數編製方法", "https://www.stat.gov.tw/public/Data/61111105359N4GQ42NS.pdf"),
    ])
    return save(doc, f"06_薪資中位數與分布/06_薪資中位數停止條件與必要資料_{VERSION}.docx")


def read_marital_summary() -> list[list[str]]:
    path = PACKAGE / "07_婚姻狀態" / "processed" / "114" / "MOI-MARITAL-NTPC-114-TARGET-AGE.csv"
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    result = []
    for band in ("25-29", "18-35"):
        for code in ("CURRENTLY_WITH_SPOUSE", "CURRENTLY_WITHOUT_SPOUSE"):
            matches = [r for r in rows if r["target_age_band"] == band and r["sex"] == "合計" and r["classification_view"] == "DERIVED_BINARY" and r["marital_status_code"] == code]
            if matches:
                r = matches[0]
                result.append([band, r["marital_status_zh"], f"{float(r['population_count']):,.3f}", r["share_pct"], r["value_origin_class"], r["method_code"]])
    return result


def doc_marriage() -> Path:
    doc = base.new_doc("DOC-07", "婚姻狀態：來源、定義、PCLM＋IPF與驗證", "113/114年底戶籍存量｜官方四分類｜衍生二分類", "資料已處理；模型待人工覆核")
    base.add_callout(doc, "地理與定義", "婚姻狀態依戶籍登記地統計年底存量；不是實際居住地，也不是當年結婚/離婚事件件數。官方分類為未婚、有偶、離婚或終止結婚、喪偶。", "warn")
    doc.add_heading("1. 資料血緣", level=1)
    base.add_flow(doc, [("MOI婚姻五歲組", "ODRP052／Y031 ZIP"), ("新北篩選", "戶籍地＋性別＋五歲年齡＋婚姻"), ("PCLM", "非負單歲初值"), ("IPF", "單歲人口＋婚姻總量校準"), ("18–35", "四分類＋衍生二分類")])
    doc.add_heading("2. population欄位與分類", level=1)
    base.add_table(doc, ["欄位/視圖", "定義", "證據標籤"], [
        ["population", "該列年度×戶籍地×性別×五歲年齡×婚姻狀態的人數", "OFFICIAL_ADMIN_EXACT"],
        ["官方四分類", "未婚/有偶/離婚或終止結婚/喪偶", "OFFICIAL_CLASSIFICATION"],
        ["目前有配偶", "有偶", "DERIVED_BINARY"],
        ["目前無配偶", "未婚＋離婚或終止結婚＋喪偶", "DERIVED_BINARY"],
    ], [4.2, 10.0, 4.0])
    doc.add_heading("3. 年齡換算方法", level=1)
    base.add_steps(doc, [
        ("精確組", "25–29完整落在官方五歲組，直接加總，屬官方行政精確值。"),
        ("PCLM", "以Poisson composite link model從五歲總量估計單歲非負形狀；平滑參數用內部留一組Poisson偏差選擇。"),
        ("IPF", "同時校準每個五歲組的官方婚姻總量，以及MOI單歲性別人口總量；維持非負。"),
        ("目標組", "18–24、30–35與18–35包含18/19/35邊界，標MODEL_ESTIMATE_FROM_OFFICIAL_MARGINS。"),
        ("敏感度", "以PCLM+IPF與五歲組內按單歲人口比例拆分比較；low/high是方法敏感度包絡，不是信賴區間。"),
    ])
    base.add_formula(doc, "m[a,c]←m[a,c]×R[a]/Σc m[a,c]；再m[a,c]←m[a,c]×C[g,c]/Σa∈g m[a,c]，反覆至收斂", "R[a]為MOI單歲人口；C[g,c]為五歲組g、婚姻類別c官方人數。")
    doc.add_heading("4. 114年結果摘要", level=1)
    base.add_table(doc, ["年齡", "衍生分類", "人數", "占比%", "值來源", "方法"], read_marital_summary(), [2.6, 3.6, 3.2, 2.6, 4.3, 4.0])
    base.add_callout(doc, "總量驗證", "114年18–35歲四分類合計845,938人，精確回到同年度MOI單歲人口總量；所有五歲組婚姻合計與單歲人口邊際差異為0（浮點收斂誤差約10⁻⁸）。", "info")
    doc.add_heading("5. 月度限制與人工查核", level=1)
    base.add_bullets(doc, [
        "年度婚姻狀態為12月31日存量，不可平均分到12個月或線性插值後稱官方月值。",
        "月結婚/離婚登記件數是事件流量，不能直接推回每月婚姻狀態存量；若要月圖需另建事件指標。",
        "人工抽核：25–29各性別/分類精確聚合、IPF列欄邊際、PCLM收斂、敏感度包絡與113→114變化方向。",
    ])
    base.add_sources(doc, [
        ("MOI-MARITAL", "15歲以上現住人口按性別、年齡及婚姻分", "https://data.gov.tw/dataset/117986"),
        ("MOI-POP1Y", "單一年齡戶籍人口校準邊際", "https://data.gov.tw/dataset/77132"),
        ("MOI-REG", "戶口統計資料編製規定", "https://www.ris.gov.tw/info-liferay/app/channel/regulationDetail/22343496?p=2"),
    ])
    return save(doc, f"07_婚姻狀態/07_婚姻狀態處理方法與驗證_{VERSION}.docx")


def doc_integration() -> Path:
    doc = base.new_doc("DOC-08", "整合、AWS/Kiro與儀表板更新流程", "來源探測｜共同事實表｜時間/定義閘門｜Agent可追溯回答", "系統落地SOP")
    base.add_callout(doc, "發布契約", "每個數值必須同時保存資料期、地理角色、母體、官方/模型標籤、方法碼、原始檔SHA-256與發布狀態；缺一項即不得進正式儀表板。", "warn")
    doc.add_heading("1. 更新後資料DAG", level=1)
    base.add_flow(doc, [("官方API/附件", "MOI／DGBAS／NTPC"), ("S3 raw", "不可變＋版本＋雜湊"), ("Glue curated", "人口/勞動/教育/薪資/婚姻"), ("Athena views", "official/model/hold分層"), ("Agent+Dashboard", "答案附來源/期別/方法")])
    doc.add_heading("2. 主題介接與方法", level=1)
    base.add_table(doc, ["主題", "介接", "生成", "發布狀態"], [
        ["人口", "MOI ODRP014月API", "單歲18–35精確加總", "PUBLISH_EXACT"],
        ["失業＋勞動", "DGBAS XLSX/XML共同管線", "P/LF/E/U＋重算率", "25–29可發布；18–35模型待執行"],
        ["教育", "MOI ODRP053/ZIP", "五歲組PCLM＋IPF", "模型需查核"],
        ["薪資", "DGBAS表6附件探測", "只發布來源原生年齡組", "18–35 HOLD；114新北×年齡HOLD"],
        ["婚姻", "MOI ODRP052/ZIP", "四分類＋二分類；PCLM＋IPF", "25–29精確；18–35模型待覆核"],
    ], [3.0, 5.0, 6.0, 4.2])
    doc.add_heading("3. AWS實作", level=1)
    base.add_steps(doc, [
        ("EventBridge", "人口每月排程；DGBAS薪資/勞動與MOI婚姻/教育每月探測是否有新年度。"),
        ("Step Functions", "download→hash→schema→transform→QA→publish；任一步失敗寫quarantine，不覆蓋前版。"),
        ("S3", "raw/curated/quality/quarantine分層，啟用版本、SSE-KMS、Block Public Access與生命週期。"),
        ("Glue", "大型ZIP串流解壓；勞動建fact_labor_age_period，婚姻/教育執行PCLM＋IPF。"),
        ("Athena", "v_official_only、v_model_estimates、v_human_review_pending、v_dashboard_ready。"),
        ("AgentCore", "工具只查白名單Athena view；回覆模板必須帶source_period/geography_role/value_origin/method/URL。"),
        ("Dashboard", "共同年與latest-available分頁；官方/模型/HOLD分色；薪資113顯示資料期警示。"),
    ])
    doc.add_heading("4. Kiro規格指令", level=1)
    base.add_callout(doc, "requirements.md", "建立來源別連接器與統一資料契約。人口=戶籍地存量；勞動P/LF/E/U共用事實表；教育population為交叉格人數；月投保薪資不得進薪資估計；婚姻為年底戶籍存量。所有模型輸出須method_code、sensitivity_low/high與HOLD閘門。", "info")
    base.add_callout(doc, "tasks.md", "1下載與雜湊；2 schema/期別/地理驗證；3標準化；4年齡方法；5分子分母/邊際QA；6寫Athena view；7Agent citation；8儀表板；9人工查核；10發版與回滾。", "info")
    doc.add_heading("5. 儀表板查詢範例", level=1)
    base.add_table(doc, ["問題", "系統回答規則"], [
        ["新北18–35人口？", "114-12戶籍人口845,938人；官方行政精確加總；不稱民間人口"],
        ["25–29失業率？", "114年官方6.4%；U/LF四捨五入回算6.52%只列QA"],
        ["114新北青年薪資？", "回答目前缺新北×年齡114官方表，不以全國或投保薪資補值"],
        ["18–35目前有配偶？", "回模型估計、PCLM+IPF、敏感度範圍、資料期114年底與戶籍地定義"],
    ], [5.1, 13.1])
    base.add_sources(doc, [
        ("AWS-WA", "AWS Well-Architected Framework", "https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html"),
        ("DATA-GOV", "政府資料開放平臺", "https://data.gov.tw/"),
        ("NTPC-API", "新北市政府資料開放平臺OpenAPI", "https://data.ntpc.gov.tw/openapi/"),
    ])
    return save(doc, f"08_整合與查核/08_整合_AWS_Kiro與儀表板流程_{VERSION}.docx")


def integrated_marital_csv() -> None:
    source = PACKAGE / "07_婚姻狀態" / "processed" / "114" / "MOI-MARITAL-NTPC-114-TARGET-AGE.csv"
    target = PACKAGE / "08_整合與查核" / "reference" / "婚姻狀態_18-35_整合表_V2.3.csv"
    target.parent.mkdir(parents=True, exist_ok=True)
    with source.open("r", encoding="utf-8-sig", newline="") as f_in, target.open("w", encoding="utf-8-sig", newline="") as f_out:
        rows = list(csv.DictReader(f_in))
        fields = list(rows[0].keys()) + ["human_review_required", "definition_note"]
        writer = csv.DictWriter(f_out, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            if row["sex"] != "合計" or row["target_age_band"] not in {"25-29", "18-35"}:
                continue
            row["human_review_required"] = "NO" if row["value_origin_class"] == "OFFICIAL_ADMIN_EXACT" else "YES"
            row["definition_note"] = "戶籍登記地年底存量；衍生二分類非官方原生分類" if row["classification_view"] == "DERIVED_BINARY" else "官方四分類"
            writer.writerow(row)


def readme() -> None:
    text = f"""新北市青年18–35歲政府公開資料包 {VERSION}
彙整日：{COLLECTED}

V2.3修訂重點
1. 01人口明確定義為戶籍登記現住人口；不得當作人力資源調查民間人口。
2. 02失業率與03勞動力/就業共用P/LF/E/U事實模型與取得管線，保留不同展示模組。
3. opendata114Y051的population為地理×性別×五歲年齡×婚姻×教育交叉格人數。
4. 薪資表6含新北工作地，但目前最新年齡工作表為113年；114全國值不得替代。
5. 月投保薪資與平均提繳工資已退出薪資估計；只保留投保人數作涵蓋診斷。
6. 新增07婚姻狀態：113/114官方ZIP、處理結果、PCLM+IPF診斷與Word方法文件。
7. 08整合與查核記錄AWS/Kiro、共同期與latest-available雙軌儀表板規則。

人工裁示
- HR-01：政策比較建議採共同年113；最新監測另頁允許不同期，但醒目標示。
- HR-03：婚姻18/19/35歲模型結果發布前覆核PCLM/IPF與敏感度。

資料夾
00 總覽與治理
01 年齡人口結構
02 失業率
03 勞動力與就業
04 教育程度
05 薪資平均數
06 薪資中位數與分布
07 婚姻狀態
08 整合與查核
"""
    path = PACKAGE / "README.txt"
    path.write_text(text, encoding="utf-8-sig")


def hashes() -> None:
    path = PACKAGE / "00_總覽與治理" / "file_hashes_sha256.csv"
    rows = []
    for p in sorted(PACKAGE.rglob("*")):
        if p.is_file() and p != path and not p.name.startswith("qa_report_v2.3") and "_qa_render" not in p.parts:
            rows.append([p.relative_to(PACKAGE).as_posix(), p.stat().st_size, sha256(p)])
    write_csv("00_總覽與治理/file_hashes_sha256.csv", ["relative_path", "bytes", "sha256"], rows)


def main() -> None:
    governance_files()
    integrated_marital_csv()
    readme()
    outputs = [
        doc_overview(),
        doc_population(),
        labor_doc("DOC-02", "02_失業率", "失業率：共用勞動事實模型與18–35重算", "失業率模組"),
        labor_doc("DOC-03", "03_勞動力與就業", "勞動力與就業：共用資料、分母與一致性", "勞動力/就業模組"),
        doc_education(),
        doc_salary_mean(),
        doc_salary_median(),
        doc_marriage(),
        doc_integration(),
    ]
    hashes()
    print(json.dumps({"version": VERSION, "docx": [str(p) for p in outputs]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

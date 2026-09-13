from __future__ import annotations

import json
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

from build_chart_evidence_doc import (
    BLUE,
    DARK_BLUE,
    GRAY,
    LIGHT_BLUE,
    NAVY,
    PALE_AMBER,
    PALE_GREEN,
    PALE_RED,
    add_callout,
    add_list,
    add_page_field,
    add_table as base_add_table,
    create_numbering,
    font_run,
)


PROJECT = Path(__file__).resolve().parents[1]
PACKAGE = PROJECT / "deliverables" / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826"
QA_DIR = PACKAGE / "08_人工查核與異常處理" / "machine_qa"
OUTPUT = PACKAGE / "00_總覽與治理" / "G5_討論決策修正歷程與QA稽核紀錄_V1.0.docx"

FONT = "Calibri"
EAST_ASIA_FONT = "Microsoft JhengHei"


def add_table(doc, headers, rows, widths, font_size=8.7):
    """Create a styled table and keep each audit row intact across page breaks."""
    table = base_add_table(doc, headers, rows, widths, font_size)
    for row in table.rows:
        row_properties = row._tr.get_or_add_trPr()
        if row_properties.find(qn("w:cantSplit")) is None:
            row_properties.append(OxmlElement("w:cantSplit"))
    return table


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def set_styles(doc: Document) -> None:
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.right_margin = Inches(1)
    section.header_distance = Inches(0.492)
    section.footer_distance = Inches(0.492)

    normal = doc.styles["Normal"]
    normal.font.name = FONT
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), EAST_ASIA_FONT)
    normal.font.size = Pt(11)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.1

    for name, size, color, before, after in (
        ("Heading 1", 16, BLUE, 16, 8),
        ("Heading 2", 13, BLUE, 12, 6),
        ("Heading 3", 12, DARK_BLUE, 8, 4),
    ):
        style = doc.styles[name]
        style.font.name = FONT
        style._element.rPr.rFonts.set(qn("w:eastAsia"), EAST_ASIA_FONT)
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(color)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True

    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = header.add_run("新北市青年資料研究｜決策、修正與QA稽核紀錄 V1.0")
    font_run(run, size=8.5, color=GRAY)

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    add_page_field(footer)
    for run in footer.runs:
        font_run(run, size=8.5, color=GRAY)


def add_title_block(doc: Document) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after = Pt(4)
    font_run(p.add_run("專案治理與研究稽核紀錄"), size=11, bold=True, color=BLUE)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    font_run(p.add_run("討論決策、修正歷程與QA證據"), size=23, bold=True, color=NAVY)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(14)
    font_run(p.add_run("新北市青年18–35歲三母體資料、AWS／Kiro與智慧儀表板"), size=13, color=DARK_BLUE)

    add_table(
        doc,
        ["文件代號", "資料基線", "紀錄期間", "狀態"],
        [["DOC-G5-GOV-901", "G5 V3.2", "2026年8月專案階段", "V1.0／本機增補"]],
        [1900, 1700, 2860, 2900],
        8.8,
    )


def add_para(doc: Document, text: str, *, bold_prefix: str | None = None) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.1
    if bold_prefix and text.startswith(bold_prefix):
        font_run(p.add_run(bold_prefix), size=11, bold=True, color=NAVY)
        font_run(p.add_run(text[len(bold_prefix):]), size=11, color=NAVY)
    else:
        font_run(p.add_run(text), size=11, color=NAVY)


def page_break(doc: Document) -> None:
    doc.add_page_break()


def build() -> None:
    metrics_qa = load_json(QA_DIR / "published_metrics_validation_detailed.json")
    csv_qa = load_json(QA_DIR / "published_csv_validation.json")
    diagnostics = load_json(QA_DIR / "data_build_diagnostics.json")
    chart_contract = load_json(PACKAGE / "06_跨母體儀表板規格" / "chart-evidence-contract.json")

    reg_years = diagnostics["registered_population"]["years"]
    edu_row_error = max(v["education_max_ipf_row_error"] for v in reg_years.values())
    edu_col_error = max(v["education_max_ipf_col_error"] for v in reg_years.values())
    mar_row_error = max(v["marital_max_ipf_row_error"] for v in reg_years.values())
    mar_col_error = max(v["marital_max_ipf_col_error"] for v in reg_years.values())
    csv_rows = {Path(item["path"]).name: item["rows"] for item in csv_qa}

    doc = Document()
    set_styles(doc)
    bullet_id = create_numbering(doc, bullet=True)
    number_id = create_numbering(doc, bullet=False)
    add_title_block(doc)

    add_callout(
        doc,
        "結論先行",
        "目前確實有QA證據可確認發布CSV、主要公式、模型收斂、文件結構與封裝完整性；但正式AWS部署、每日排程、ChatBot、線上權限及每張圖七項資訊前端元件仍需部署後證據。本文件因此把『已測試』、『已有文件／產物』、『使用者已裁示』及『尚待實作』分開標記。",
        PALE_GREEN,
    )

    doc.add_heading("1. 文件目的、範圍與證據規則", level=1)
    add_para(doc, "本文件不是逐字聊天紀錄，而是把專案期間真正影響資料定義、公式、來源、發布方式、儀表板與AWS／Kiro實作的討論，整理成可查核的決策與修正清冊。重複提問、暫時路徑、帳號與憑證不納入；若同一議題曾多次修正，以最後確認且能由產物或測試支持的版本為準。")
    add_table(doc, ["證據層級", "定義", "本文件用法"], [
        ["Test-confirmed／測試確認", "有程式化公式、列數、結構、解析、無障礙或封裝測試結果。", "可寫為QA通過；仍不等於production已部署。"],
        ["Artifact-confirmed／產物確認", "Word、CSV、JSON、來源清冊、Kiro規格、IaC或Git版本可回讀。", "可確認已產製或已定義，不自動推論已上線。"],
        ["User-confirmed／使用者裁示", "使用者明確同意母體、年齡、時間、圖表或發布規則。", "視為需求基線；技術結果仍須另做QA。"],
        ["Pending／待完成", "只有規劃或說明，缺正式組態、執行紀錄、監控或驗收證據。", "只能標示DESIGNED或DESCRIBED_NOT_IMPLEMENTED。"],
    ], [2200, 3900, 3260], 8.5)
    add_callout(doc, "隱私邊界", "本紀錄不保存白名單地址、登入憑證、API金鑰、工作階段資訊或.env內容；只記錄『採白名單限制登入』及其驗收狀態。", PALE_AMBER)

    doc.add_heading("2. 已確認的總體決策基線", level=1)
    add_table(doc, ["主題", "最後確認內容", "證據／狀態"], [
        ["命題平台", "data.gov.tw、新北市政府主計處統計資訊網、新北市OpenAPI及主計總處來源均納入；命題指定平台可作核心來源或交叉查核。", "User-confirmed＋source_manifest"],
        ["青年定義", "核心青年為18–35歲；分析組為18–24、25–29、30–35及18–35。15–17為銜接觀察組、36–40為方案擴充組，不計入核心總數。", "User-confirmed＋CSV age_band"],
        ["地理範圍", "行政區地圖只呈現戶籍人口母體的人口年齡、教育、婚姻及男女比例；勞動與薪資維持新北市整體，不推造區級值。", "User-confirmed＋NTPC-DISTRICT-MAP規則"],
        ["三母體", "戶籍人口、民間人口及勞動市場、受僱員工薪資三種分母分開治理；可同頁呈現但不得直接相加或混成同一母體。", "User-confirmed＋三份CSV"],
        ["時間預設", "預設同年度檢視；視窗為更新年度−5至更新年度−1。114年更新時顯示110–114，116年更新時顯示111–115。", "User-confirmed＋data_build_diagnostics"],
        ["更新頻率", "每日審視來源是否更新；只有偵測到新版本並通過驗證後才變更發布層。", "User-confirmed＋AWS／Kiro文件；尚待排程部署"],
        ["發布資料", "發布層不是一份混合CSV，而是按三母體拆成三份長格式CSV，另有來源主檔與資料列來源關聯。", "Test-confirmed"],
        ["公開文字", "儀表板使用中文與阿拉伯數字；內部代碼只保留在資料、API與稽核日誌。", "User-confirmed＋Kiro規格；前端待完整驗收"],
        ["ChatBot", "未來以AWS與Kiro建立可即時問資料的受控ChatBot，只回答發布層可查詢資料並附來源、方法與限制。", "Artifact-confirmed設計；尚未production驗證"],
        ["七項圖表證據", "每張圖固定顯示母體定義、資料年度、數值身分、計算方法、更新日期、資料來源、可用性狀態。", f"契約狀態：{chart_contract['implementation_status']}"],
    ], [1780, 5220, 2360], 8.1)

    page_break(doc)
    doc.add_heading("3. 三母體與分母修正紀錄", level=1)
    add_table(doc, ["母體", "曾出現的疑問／風險", "最後定義與修正", "QA或限制"], [
        ["戶籍人口母體", "曾質疑人口數過少、人口究竟是民間人口或其他定義。", "定義為戶籍登記現住人口；人口年齡結構用單一年齡行政登記資料，行政區合計須回到新北市總量。", "110–114年、30個地理單位、37,200列；資料QA PASS。"],
        ["民間人口及勞動市場母體", "曾把戶籍人口P與人力資源調查P視為可直接相接。", "P改採人力資源調查15歲以上民間人口；LF、E、U、NLF及各率都在同一調查母體內重建。", "LF=E+U、NLF=P−LF、UR+ESLF=100%均有測試。"],
        ["受僱員工薪資母體", "曾嘗試以月投保薪資或全國表直接代表新北薪資。", "平均與中位數限官方薪資統計涵蓋的受僱員工；勞保資料只作年齡輪廓／權數輔助，不冒充官方全年總薪資。", "110–113年32列；114缺資料；性別只保留全體。"],
    ], [1700, 2450, 3220, 1990], 8.1)
    add_callout(doc, "不可跨接的P", "戶籍人口P是行政登記存量；勞動P是人力資源調查民間人口估計。兩者可在儀表板並列說明，但不可拿其中一個直接當另一套比率的分母。", PALE_RED)

    doc.add_heading("4. 年齡統計方法的討論與修正", level=1)
    add_table(doc, ["問題／質疑", "採用方式", "驗證與限制", "狀態"], [
        ["來源年齡帶不一致，如何統一成18–35？", "優先順序為：官方單一年齡直接加總→官方原生目標年齡帶→PCLM／Sprague拆分→IPF校準交叉邊際→無可靠輸入時HOLD。", "每筆保留method_code、model_version、來源與不確定性。", "已寫入方法與CSV"],
        ["為何先驗證25–29？", "25–29通常是官方原生五歲組，可作錨點；比較模型重建值與官方已知值後，才擴張到含18、19及35歲邊界的群組。", "25–29不得因是錨點就被重新標成模型原生值。", "已採用"],
        ["20–34如何變成18–35？", "不能按年數比例拆分率；應先對計數分布做PCLM或Sprague，再加總18–35，最後用相符分子／分母重算比率。", "缺鄰近年齡帶或邊際時不得硬估。", "方法已定義"],
        ["Sprague、PCLM、IPF如何分工？", "Sprague作五歲組拆分與敏感度；PCLM作平滑單一年齡主估計；IPF使年齡×教育／婚姻×行政區結果符合官方邊際。", "PCLM／Sprague差異只作方法包絡，不是信賴區間。", "已實作於對應資料"],
        ["模型最低值、最高值是什麼？", "uncertainty_low／high取經核准方法情境的最小／最大值，例如PCLM與Sprague方法包絡；不得稱95%信賴區間。", "欄位另標uncertainty_type。", "已記錄"],
        ["18、19、35歲邊界", "戶籍人口有單一年齡時直接加總；調查表只有粗年齡組時使用PCLM／Sprague並以已知組別回加驗證。", "官方微資料或客製表仍是最高優先。", "部分模型估計"],
        ["模型結果是否合理？", "檢查非負、回加原組別、已知25–29錨點、方法敏感度、分子分母恆等式及邊際誤差。", "任何超過閾值的項目轉人工查核或HOLD。", "QA Gate已建立"],
    ], [2130, 3520, 2410, 1300], 7.9)

    doc.add_heading("5. 年度與月份規則的修正", level=1)
    add_table(doc, ["討論點", "最後處理規則", "不得採用的作法"], [
        ["所有年度值是否都當12月底？", "依指標原生口徑：戶籍人口年資料可用年末存量；勞動及薪資年度統計依官方全年平均或核定年度定義。", "不可把所有流量、平均值與比率一律改寫成12月底。"],
        ["年度比較", "同一指標、母體、年齡、性別、地理與時間基準一致後，才做年度間比較。", "不可用人口115年對薪資113年卻不顯示缺年。"],
        ["月度比較", "原生月資料可做相鄰月份比較，也可做不同年份同月份YoY；保留觀察月份、季節性與修訂狀態。", "不可把年度總值或年度平均用數學內插偽造成12個月份。"],
        ["共同年度", "同一張跨母體比較圖若要求全部都有值，採三母體共同可用年度；目前薪資缺114，因此共同完整年度到113。", "共同年度不等於各指標最新年度。"],
        ["五年視窗", "視窗固定為更新年份−5到更新年份−1；缺少年度保留空白及原因。", "不可自動縮短視窗掩蓋薪資114缺口。"],
    ], [2100, 4460, 2800], 8.2)

    page_break(doc)
    doc.add_heading("6. 各資料主題的修正紀錄", level=1)
    doc.add_heading("6.1 人口、教育與婚姻", level=2)
    add_table(doc, ["主題", "原問題", "修正後處理", "QA／限制"], [
        ["人口年度", "早期資料包只有109年，且OpenAPI分頁未完整。", "改抓MOI單一年齡110–114年不可變快照，處理完整分頁／批次並保存SHA-256。", "各年7,734–7,752列來源；30地理單位。"],
        ["人口欄位", "opendata114Y051的population欄位被懷疑不合理。", "教育檔的population是教育×年齡×地區統計單元人口，不等於整體新北人口；不得直接當總人口。", "以MOI-POP1Y作人口總量錨點。"],
        ["教育交叉", "只看新北總人口的教育及年齡分布，無法直接知道目標年齡層教育。", "使用官方年齡／教育邊際建立PCLM種子，再以IPF校準到行政區與人口邊際。", f"110–114全收斂；最大row error={edu_row_error:.3g}。"],
        ["婚姻資料", "需新增婚姻來源、定義及人工抽查方式。", "採官方婚姻狀態五歲組，分未婚、有偶、離婚／終止結婚、喪偶；PCLM＋IPF後回加官方邊際。", f"110–114全收斂；最大row error={mar_row_error:.3g}。"],
        ["行政區地圖", "是否把勞動與薪資也拆到29區。", "只把戶籍人口、教育、婚姻、男女比例放入29區互動地圖；勞動／薪資另設新北市整體section。", "地圖來源NTPC-DISTRICT-MAP；不推造區級勞動值。"],
    ], [1450, 2380, 3490, 2040], 7.9)

    doc.add_heading("6.2 勞動力、就業與失業", level=2)
    add_table(doc, ["問題／修正", "最後採用方式", "公式／來源", "QA或例外"], [
        ["就業與失業是否同一份資料即可", "使用同年度人力資源調查表組：表27民間人口、表32就業者、表36失業者；表28只作LF四捨五入核對。", "P:T27；E:T32；U:T36；LF=E+U。", "來源別名已拆分，不再假裝單一表含全部指標。"],
        ["失業率只有比例沒有實際人數", "先取得／拆分E與U計數，再重算LF、NLF與各率；不從男女失業率比例反推人數。", "UR=U÷LF×100%。", "180列、860項檢查PASS。"],
        ["25–29模型值是否偏離官方值", "以官方原生25–29作錨定與回測；模型拆分主要用於18–24、30–35與18–35。", "PCLM主模型＋Sprague敏感度。", "來源與方法逐列保留。"],
        ["114年H2是否真的有15–19、20–24", "確認表41／42具同年下半年細組；只用其E、U、NLF比例拆分全年15–24，全年總量仍由年度表控制。", "AUX:DGBAS-NTPC-H2-T41+T42。", "只改善114邊界，不把H2當全年值。"],
        ["NLF超界4.21百分點", "解讀為方法敏感度包絡外的診斷警示，不是抽樣信賴區間；須查來源四捨五入、邊界分配與模型。", "NLF=P−LF。", "警示需人工覆核，不能用作誤差保證。"],
        ["缺就業人口比率及勞動力中就業占比", "補上E÷P及E÷LF；ESLF與UR在相同LF分母下合計100%。", "EPR=E÷P；ESLF=E÷LF。", "恆等式測試PASS。"],
        ["男女分組", "目前發布勞動CSV為全體；只有取得相同地區×年齡×性別的P、E、U及權數後才能發布男女率。", "不得把總體率套到男女。", "目前ALL_ONLY。"],
    ], [1900, 3480, 2100, 1880], 7.7)

    doc.add_heading("6.3 薪資平均與中位數", level=2)
    add_table(doc, ["問題／修正", "最後採用方式", "QA／限制"], [
        ["表50是全國，不是新北", "不再將全國表當新北值；核心錨點改為DGBAS-WAGE-LOC表6，新北市×年齡官方表。", "source_manifest已指向官方縣市薪資表。"],
        ["月投保薪資能否推估薪水", "不能直接代表官方全年總薪資；BLI投保資料只作年齡輪廓、相對權數或敏感度輔助。", "CSV逐列標示來源角色。"],
        ["為何只有25–29", "平均數已補18–24、25–29、30–35及18–35；25–29為官方原生，其他組以官方薪資錨定模型估計。", "平均數16列：4年×4年齡。"],
        ["中位數能否補四組", "25–29保留官方原生值；其他三組以官方寬帶形狀轉移與PCLM權重的對數常態分布模型估計，不線性加權分組中位數。", "中位數16列均有值；非25–29共12列標示模型估計與敏感度範圍。"],
        ["應有32列", "採4年（110–113）×4年齡×2統計量＝32列矩形格。", "32列均有數值；官方與模型身分逐列保留。"],
        ["男女薪資", "官方表有性別或地區×年齡，但沒有新北市×年齡×性別三維交叉；發布維持全體。", "不得以獨立邊際IPF推造薪資分布。"],
        ["114年", "沒有符合相同口徑的官方114年薪資時，保留缺年；其他母體仍可顯示114。", "跨母體共同完整年度目前到113。"],
    ], [2100, 4500, 2760], 8.0)

    page_break(doc)
    doc.add_heading("7. 資料來源、介接與血緣修正", level=1)
    add_table(doc, ["來源代號", "官方用途", "介接／查核定位"], [
        ["MOI-POP1Y", "戶籍人口單一年齡；https://data.gov.tw/dataset/77132", "人口總量、年齡、性別及行政區核心來源。"],
        ["MOI-EDU5Y", "教育程度；https://data.gov.tw/dataset/117988", "教育邊際與PCLM／IPF輸入，不直接當人口總量。"],
        ["MOI-MARITAL5Y", "婚姻狀態；https://data.gov.tw/dataset/117986", "婚姻邊際與PCLM／IPF輸入。"],
        ["DGBAS-HR-T27／28／32／36", "主計總處人力資源調查110–114年報", "P、LF QA、E、U各有不同表次；依年度URL保存。"],
        ["AUX:DGBAS-NTPC-H2-T41+T42", "114年下半年新北細年齡勞動表", "只作15–24邊界輔助，保持全年年度總量。"],
        ["DGBAS-WAGE-LOC", "縣市別、年齡別全年總薪資；https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642", "新北薪資官方錨點。"],
        ["BLI-AGE-REGION-SEX／PENSION-AGE-WAGE", "勞保年齡、地區、性別及投保級距資料", "只作模型輔助，不冒充官方薪資值。"],
        ["NTPC-OPENAPI／NTPC-OAS", "https://data.ntpc.gov.tw/openapi/；https://oas.bas.ntpc.gov.tw/DgbasWeb/Page/Default.aspx", "命題指定平台；交叉查核或地圖來源，不重複加權。"],
    ], [2350, 4260, 2750], 7.9)
    add_callout(doc, "OpenAPI規則", "API通常比人工下載更適合每日檢查，但必須處理分頁、欄位版本、空值、重複列、更新時間、總筆數與重試；成功回應不等於資料完整。原始回應與SHA-256必須先落raw層。", LIGHT_BLUE)

    doc.add_heading("8. 儀表板、登入與資料問答修正", level=1)
    add_table(doc, ["議題", "最後規格／修正", "目前可確認程度"], [
        ["行政區互動", "游標顯示區名；點選後顯示人口年齡、教育、婚姻與男女比例。", "規格與地圖資料存在；完整互動需線上驗收。"],
        ["勞動圖", "UR與ESLF成對呈現；LFPR、EPR跨年長條／趨勢；保留P、LF、E、U、NLF與公式。", "CSV與圖表契約可確認；視覺元件待完整驗收。"],
        ["薪資圖", "平均與中位數分開並可並列；114年維持缺口，不以113年代填。", "110–113四組年齡可呈現；非原生中位數須顯示模型身分。"],
        ["七項證據", "每張圖固定顯示七項資訊，不能只放tooltip、頁尾或收合區。", f"{chart_contract['implementation_status']}；T-107／T-108未完成。"],
        ["登入", "接到The Weekly Blend單一入口並採限制名單；AUTH_REQUEST_INVALID曾修正。", "TOC保留入口與commit；本文件未重跑線上登入。"],
        ["ChatBot", "回答時必須回傳母體、年度、身分、方法、來源、更新日與可用性；HOLD不可回答成0。", "治理文件與工具規格存在；端到端尚未部署驗證。"],
    ], [1700, 4800, 2860], 8.1)

    doc.add_heading("9. AWS、Kiro與六大支柱修正", level=1)
    add_para(doc, "AWS Well-Architected六大支柱已納入G5C27結案學習。每一支柱至少要同時有設計文件、部署組態、監控／測試證據、已知風險及改善責任與期限；只有Word說明時，狀態只能是DESIGNED。")
    add_table(doc, ["支柱", "本案查核重點", "目前證據", "下一個Gate"], [
        ["作業卓越", "run_id、每日更新、QA、告警、變更與人工覆核。", "SOP、QA JSON、Kiro tasks。", "正式排程、CloudWatch與演練。"],
        ["安全性", "IAM最小權限、KMS、Secrets、CloudTrail、發布限制。", "IaC／JWT／白名單設計與本地測試。", "實際policy、金鑰與存取稽核。"],
        ["可靠性", "raw不可變、版本、冪等、retry／catch、DLQ、RTO／RPO。", "來源快照、SHA-256、manifest、Step Functions藍圖。", "備份復原與失敗重跑演練。"],
        ["效能效率", "依資料量選Lambda、Glue Spark或Fargate；Parquet、partition、Athena。", "資源分流文件與IaC。", "實際duration、DPU、CPU與掃描量基準。"],
        ["成本最佳化", "serverless、標籤、Budgets、Cost Explorer、Lifecycle。", "成本設計與服務選型說明。", "實際預算、標籤與月度成本報告。"],
        ["永續性", "增量處理、減少重算與掃描、保存週期。", "每日審視與增量方向。", "掃描量、運算時間與生命週期改善指標。"],
    ], [1500, 3180, 2420, 2260], 7.9)
    add_callout(doc, "運算分流", "Lambda適合短時間、事件驅動與輕量驗證；Glue Spark適合大型批次、分散式轉換與資料目錄；ECS Fargate適合長時間、自訂依賴或資源需求較固定的容器工作。Kiro負責依規格產生／修改程式，不是Glue Catalog或Athena本身。", PALE_AMBER)

    page_break(doc)
    doc.add_heading("10. QA結果總表", level=1)
    add_table(doc, ["QA項目", "結果", "可確認的內容", "不能推論的內容"], [
        ["戶籍人口發布資料", f"PASS；{metrics_qa['registered_population']['check_count']:,}項，0失敗", f"{csv_rows['01_戶籍人口母體_長格式.csv']:,}列；110–114；公式、邊際與結構。", "不能代表所有來源日後永不修訂。"],
        ["勞動市場發布資料", f"PASS；{metrics_qa['civilian_labor_market']['check_count']:,}項，0失敗", f"{csv_rows['02_民間人口與勞動市場母體_長格式.csv']:,}列；110–114；九指標與恆等式。", "模型包絡不是抽樣信賴區間。"],
        ["薪資發布資料", f"PASS；{metrics_qa['employee_wage']['check_count']:,}項，0失敗", f"{csv_rows['03_受僱員工薪資母體_長格式.csv']:,}列；110–113；32列矩形格均有值。", "非25–29中位數仍是模型估計，不代表官方原生值；114尚未發布。"],
        ["教育PCLM＋IPF", f"110–114皆收斂；row≤{edu_row_error:.3g}、col≤{edu_col_error:.3g}", "結果符合指定官方邊際至數值容許差。", "不等於個體層真實交叉表。"],
        ["婚姻PCLM＋IPF", f"110–114皆收斂；row≤{mar_row_error:.3g}、col≤{mar_col_error:.3g}", "結果符合指定官方邊際至數值容許差。", "仍是行政邊際約束下的模型估計。"],
        ["JSON結構", "66份JSON解析失敗0", "封裝內機器可讀檔可解析。", "不代表每個外部URL即時可用。"],
        ["既有Word無障礙", "主要文件與七項證據文件high／medium／low均0", "標題層級、表頭等機械檢查通過。", "不是完整WCAG人工驗證。"],
        ["ZIP與雲端", "2026-08-27發布ZIP testzip通過；292檔；188,445,359 bytes；Drive回讀一致", "當次發布包未損壞且上傳大小一致。", "本V1.0增補尚未重新打包上傳。"],
    ], [2050, 2440, 2910, 1960], 7.7)
    add_callout(doc, "QA解讀", "PASS表示『對已定義規則與目前輸入通過檢查』，不是對統計真值、未取得資料或未部署系統的無條件保證。模型結果仍須保留來源、方法、不確定性與人工覆核狀態。", LIGHT_BLUE)

    doc.add_heading("11. 三份CSV為何有這些列數", level=1)
    add_table(doc, ["CSV", "類別變項組合", "列數驗算"], [
        ["戶籍人口母體", "人口數／占比：5年×30地理×4年齡×3性別×2指標；教育：同前述×5類×2指標；婚姻：同前述×4類×2指標；性別占比：5年×30×4×2性別。", "3,600＋18,000＋14,400＋1,200＝37,200"],
        ["民間人口與勞動市場母體", "5年×1地理（新北市）×4年齡×1性別（全體）×9指標。", "5×1×4×1×9＝180"],
        ["受僱員工薪資母體", "4年×1地理×4年齡×1性別（全體）×2統計量。", "4×1×4×1×2＝32"],
    ], [2500, 4750, 2110], 8.2)
    add_para(doc, "三份發布CSV合計37,412列。列數完整只表示矩形資料契約完整；薪資32列均有值，但非25–29歲的平均數與中位數必須保留模型估計身分。")

    doc.add_heading("12. 主要公式與查核方式", level=1)
    add_table(doc, ["指標／處理", "公式或方法", "QA重點"], [
        ["戶籍18–35人口", "Σ age=18…35 的官方單一年齡人口。", "各年齡組加總、男女合計與行政區回加。"],
        ["勞動力", "LF=E+U；NLF=P−LF。", "非負、同母體、表28四捨五入一致性。"],
        ["失業率／就業占比", "UR=U÷LF×100%；ESLF=E÷LF×100%。", "UR＋ESLF=100%。"],
        ["勞參率／就業人口比率", "LFPR=LF÷P×100%；EPR=E÷P×100%。", "分子分母均由同年度、同年齡、同模型計數重算。"],
        ["教育／婚姻", "PCLM建立單一年齡種子；IPF反覆校準列、欄邊際。", "收斂、row／col error、非負與官方邊際回加。"],
        ["薪資平均", "目標組平均=Σ(年齡薪資×受僱權數)÷Σ受僱權數；官方組別作錨定。", "回加官方年齡帶、權數合理性、PCLM／均勻敏感度。"],
        ["薪資中位數", "25–29採官方值；其他子群以目標平均×官方寬帶中位／平均比校準，18–35求PCLM權重之對數常態混合CDF第50百分位。", "不得線性加權分組中位數；檢查平均≥中位、敏感度包絡及25–29留出誤差。"],
        ["模型範圍", "low=min(核准情境)；high=max(核准情境)。", "標示METHOD_ENVELOPE_NOT_CI，不寫成95%CI。"],
    ], [2050, 4730, 2580], 8.0)

    page_break(doc)
    doc.add_heading("13. 尚未完成、不得過度宣稱的項目", level=1)
    add_table(doc, ["項目", "目前狀態", "要變成已完成仍需"], [
        ["每張圖七項證據", "Word、JSON、Kiro需求已完成；前端狀態DESCRIBED_NOT_IMPLEMENTED。", "ChartEvidenceStrip、八圖×七項56項驗收、HOLD與混合身分視覺回歸。"],
        ["AWS正式資料平台", "IaC、Step Functions、Glue、Athena、AgentCore與監控藍圖存在。", "真實帳號部署、IAM／KMS／CloudTrail、排程、告警、成本及復原證據。"],
        ["Kiro執行", "requirements、design、tasks與steering可讀。", "實際產碼、測試、PR／commit及dev／staging驗收。"],
        ["ChatBot", "治理、唯讀工具與回答契約已定義。", "正式模型、資料索引、權限、引用、拒答、攻擊測試與監控。"],
        ["登入", "入口與版本紀錄存在；曾修正AUTH_REQUEST_INVALID。", "重新執行白名單內／外、過期狀態、登出與端到端回歸測試。"],
        ["薪資114與完整中位數／性別", "資料缺口；保留空白或缺年。", "同口徑官方114資料，或具代表性的個體薪資分布與樣本權數。"],
        ["勞動男女", "發布資料目前為全體。", "相同地區×年齡×性別的P、E、U與抽樣權數。"],
    ], [2150, 3510, 3700], 8.0)

    doc.add_heading("14. 人工複核清單", level=1)
    add_list(doc, [
        "確認每一張圖的母體與分母，禁止跨母體相加或混用P。",
        "確認資料年度、統計期間及更新日期分列，缺年不縮短視窗掩蓋。",
        "確認官方行政精確、官方調查估計、模型估計及HOLD標示正確。",
        "抽查record_id是否能連到來源主檔、資料列來源關聯、官方URL及SHA-256。",
        "抽查18–24、25–29、30–35、18–35的公式、邊界年齡及模型版本。",
        "確認率由相符分子／分母重算，沒有用年數比例拆率。",
        "確認HOLD、null與缺年未被轉成0或連線補點。",
        "確認AWS六大支柱每項都有設計、組態、監控／測試、風險及改善待辦。",
        "正式上線前重跑登入、ChatBot、八類圖表、排程、告警、復原與rollback。",
    ], number_id)

    doc.add_heading("15. 本紀錄的來源與版本關係", level=1)
    add_table(doc, ["來源類型", "主要檔案／紀錄", "用途"], [
        ["使用者裁示", "G3決策、G5 V2、G5C27及本次要求", "確定需求基線與應保存的修正。"],
        ["發布資料", "09_發布資料包三份長格式CSV、04來源主檔、05資料列來源關聯", "數值、母體、方法、狀態與血緣。"],
        ["機器QA", "published_metrics_validation_detailed.json、published_csv_validation.json、data_build_diagnostics.json", "公式、列數、年度、收斂與缺口。"],
        ["文件QA", "08_人工查核與異常處理/machine_qa/*.json", "Word無障礙與結構查核。"],
        ["儀表板契約", "chart-evidence-contract.json、chart-evidence-requirements.md", "七項證據、可用性與Fail-closed。"],
        ["AWS／Kiro", "07_AWS與Kiro、12_AWS_Kiro_實作檔案", "架構、資源分工、AgentCore、Kiro與部署Gate。"],
        ["Guard結案", "G5C27正式紀錄", "保存可復用流程、六大支柱與未授權事項。"],
    ], [1900, 4760, 2700], 8.1)
    add_callout(doc, "版本關係", "2026-08-27已上傳的單一ZIP是當時封裝版本；本V1.0為2026-08-28新增的本機治理文件。除非重新產生清冊、ZIP並上傳，不能宣稱舊ZIP已包含本文件。", PALE_AMBER)

    doc.core_properties.title = "G5討論決策修正歷程與QA稽核紀錄"
    doc.core_properties.subject = "新北市青年18–35歲政府資料研究專案治理與修正追溯"
    doc.core_properties.keywords = "新北市青年,三母體,QA,AWS,Kiro,決策紀錄,修正歷程,資料治理"
    doc.core_properties.comments = "以使用者裁示、可回讀產物及機器QA為基礎；不包含憑證或白名單個資。"
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    build()

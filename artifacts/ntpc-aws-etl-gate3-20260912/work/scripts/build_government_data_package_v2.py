from __future__ import annotations

import csv
import hashlib
import os
from datetime import date
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor


PROJECT = Path(r"D:\github\work\019fe05e-e1a3-71f2-840e-c026180d9474\NtpcYouthAI")
PACKAGE = PROJECT / "deliverables" / "NTPC_Youth_18-35_Government_Open_Data_Package_V2.1_20260824"
VERSION = "V2.1"
COLLECTED = "2026-08-24"

NAVY = "17324D"
TEAL = "1C7C7D"
BLUE = "2D6A8A"
LIGHT_BLUE = "EAF3F6"
LIGHT_TEAL = "E7F4F2"
LIGHT_GREY = "F1F3F5"
MID_GREY = "6B7280"
DARK = "17212B"
AMBER = "FFF3CD"
RED = "FDECEC"
GREEN = "E9F7EF"
WHITE = "FFFFFF"


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=90, start=90, bottom=90, end=90) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for m, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def prevent_row_split(row) -> None:
    """Keep a table row on one page so a single trailing character cannot spill."""
    tr_pr = row._tr.get_or_add_trPr()
    if tr_pr.find(qn("w:cantSplit")) is None:
        tr_pr.append(OxmlElement("w:cantSplit"))


def set_repeatable_table_borders(table, color="D5DADF", size="4") -> None:
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = "start" if edge == "left" else "end" if edge == "right" else edge
        element = borders.find(qn(f"w:{tag}"))
        if element is None:
            element = OxmlElement(f"w:{tag}")
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:color"), color)


def add_page_number(paragraph) -> None:
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run("第 ")
    run.font.size = Pt(8)
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    paragraph._p.append(fld)
    run = paragraph.add_run(" 頁")
    run.font.size = Pt(8)


def set_run_font(run, size=None, bold=None, color=None, name="Microsoft JhengHei") -> None:
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = RGBColor.from_string(color)


def add_hyperlink(paragraph, text: str, url: str, color=BLUE) -> None:
    part = paragraph.part
    r_id = part.relate_to(url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True)
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), r_id)
    new_run = OxmlElement("w:r")
    r_pr = OxmlElement("w:rPr")
    c = OxmlElement("w:color")
    c.set(qn("w:val"), color)
    u = OxmlElement("w:u")
    u.set(qn("w:val"), "single")
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), "15")
    sz_cs = OxmlElement("w:szCs")
    sz_cs.set(qn("w:val"), "15")
    r_pr.append(c)
    r_pr.append(u)
    r_pr.append(sz)
    r_pr.append(sz_cs)
    new_run.append(r_pr)
    t = OxmlElement("w:t")
    t.text = text
    new_run.append(t)
    hyperlink.append(new_run)
    paragraph._p.append(hyperlink)


def style_document(doc: Document, doc_code: str) -> None:
    sec = doc.sections[0]
    sec.top_margin = Cm(1.55)
    sec.bottom_margin = Cm(1.45)
    sec.left_margin = Cm(1.65)
    sec.right_margin = Cm(1.65)
    sec.header_distance = Cm(0.65)
    sec.footer_distance = Cm(0.65)

    normal = doc.styles["Normal"]
    normal.font.name = "Microsoft JhengHei"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft JhengHei")
    normal.font.size = Pt(9.5)
    normal.font.color.rgb = RGBColor.from_string(DARK)
    normal.paragraph_format.space_after = Pt(4)
    normal.paragraph_format.line_spacing = 1.15

    for style_name, size, color, before, after in (
        ("Title", 23, NAVY, 0, 8),
        ("Subtitle", 11, MID_GREY, 0, 8),
        ("Heading 1", 15, NAVY, 12, 5),
        ("Heading 2", 11.5, TEAL, 8, 4),
        ("Heading 3", 10, BLUE, 6, 3),
    ):
        style = doc.styles[style_name]
        style.font.name = "Microsoft JhengHei"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft JhengHei")
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor.from_string(color)
        style.font.bold = True
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True

    header = sec.header
    p = header.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = p.add_run(f"新北市青年 18–35 歲政府公開資料包｜{doc_code}")
    set_run_font(r, 7.5, False, MID_GREY)
    pPr = p._p.get_or_add_pPr()
    border = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "5")
    bottom.set(qn("w:space"), "2")
    bottom.set(qn("w:color"), TEAL)
    border.append(bottom)
    pPr.append(border)

    footer = sec.footer
    fp = footer.paragraphs[0]
    r = fp.add_run(f"{VERSION}｜彙整日 {COLLECTED}｜政府資料開放授權條款第 1 版來源")
    set_run_font(r, 7.5, False, MID_GREY)
    add_page_number(fp)


def add_title_block(doc: Document, code: str, title: str, subtitle: str, status: str) -> None:
    table = doc.add_table(rows=1, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table.columns[0].width = Cm(14.7)
    table.columns[1].width = Cm(3.0)
    set_repeatable_table_borders(table, color=WHITE, size="0")
    left, right = table.rows[0].cells
    set_cell_shading(left, NAVY)
    set_cell_shading(right, TEAL)
    for c in (left, right):
        set_cell_margins(c, 220, 220, 220, 220)
        c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    p = left.paragraphs[0]
    r = p.add_run(code)
    set_run_font(r, 9, True, "9AD7D6")
    p = left.add_paragraph()
    r = p.add_run(title)
    set_run_font(r, 20 if len(title) > 18 else 22, True, WHITE)
    p = left.add_paragraph()
    r = p.add_run(subtitle)
    set_run_font(r, 9.5, False, "E7EEF4")
    p = right.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(status)
    set_run_font(r, 9, True, WHITE)
    p = right.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(VERSION)
    set_run_font(r, 16, True, WHITE)
    doc.add_paragraph()


def add_callout(doc: Document, title: str, body: str, kind="info") -> None:
    color = {"info": LIGHT_BLUE, "ok": GREEN, "warn": AMBER, "stop": RED}.get(kind, LIGHT_BLUE)
    accent = {"info": BLUE, "ok": TEAL, "warn": "B58105", "stop": "B42318"}.get(kind, BLUE)
    t = doc.add_table(rows=1, cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    t.columns[0].width = Cm(0.25)
    t.columns[1].width = Cm(17.45)
    set_repeatable_table_borders(t, color=color, size="0")
    c0, c1 = t.rows[0].cells
    set_cell_shading(c0, accent)
    set_cell_shading(c1, color)
    set_cell_margins(c1, 120, 160, 120, 160)
    p = c1.paragraphs[0]
    r = p.add_run(title + "｜")
    set_run_font(r, 9.5, True, accent)
    r = p.add_run(body)
    set_run_font(r, 9.5, False, DARK)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_flow(doc: Document, nodes: list[tuple[str, str]]) -> None:
    cols = len(nodes) * 2 - 1
    t = doc.add_table(rows=1, cols=cols)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = True
    set_repeatable_table_borders(t, color=WHITE, size="0")
    for i, (head, body) in enumerate(nodes):
        cell = t.cell(0, i * 2)
        set_cell_shading(cell, LIGHT_TEAL if i % 2 == 0 else LIGHT_BLUE)
        set_cell_margins(cell, 120, 95, 120, 95)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(head + "\n")
        set_run_font(r, 8.5, True, TEAL if i % 2 == 0 else BLUE)
        r = p.add_run(body)
        set_run_font(r, 7.5, False, DARK)
        if i < len(nodes) - 1:
            ac = t.cell(0, i * 2 + 1)
            p = ac.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run("→")
            set_run_font(r, 13, True, MID_GREY)
    doc.add_paragraph()


def add_table(doc: Document, headers: list[str], rows: list[list[str]], widths=None) -> None:
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = widths is None
    set_repeatable_table_borders(table)
    hdr = table.rows[0]
    set_repeat_table_header(hdr)
    prevent_row_split(hdr)
    for idx, h in enumerate(headers):
        cell = hdr.cells[idx]
        set_cell_shading(cell, NAVY)
        set_cell_margins(cell)
        p = cell.paragraphs[0]
        r = p.add_run(h)
        set_run_font(r, 8.2, True, WHITE)
        if widths:
            cell.width = Cm(widths[idx])
    for ri, row in enumerate(rows):
        added_row = table.add_row()
        prevent_row_split(added_row)
        cells = added_row.cells
        for ci, value in enumerate(row):
            cell = cells[ci]
            if ri % 2:
                set_cell_shading(cell, "F8FAFB")
            set_cell_margins(cell)
            p = cell.paragraphs[0]
            r = p.add_run(str(value))
            set_run_font(r, 8.0, False, DARK)
            if widths:
                cell.width = Cm(widths[ci])
    doc.add_paragraph()


def add_formula(doc: Document, formula: str, explanation: str) -> None:
    t = doc.add_table(rows=1, cols=1)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_repeatable_table_borders(t, color="B9D8DD", size="6")
    c = t.cell(0, 0)
    set_cell_shading(c, "F4FAFB")
    set_cell_margins(c, 150, 180, 150, 180)
    p = c.paragraphs[0]
    r = p.add_run(formula)
    set_run_font(r, 10, True, NAVY, "Consolas")
    p = c.add_paragraph()
    r = p.add_run(explanation)
    set_run_font(r, 8.5, False, MID_GREY)
    doc.add_paragraph()


def add_steps(doc: Document, steps: list[tuple[str, str]]) -> None:
    for idx, (name, detail) in enumerate(steps, 1):
        p = doc.add_paragraph(style="List Number")
        r = p.add_run(f"{name}｜")
        set_run_font(r, 9.5, True, TEAL)
        r = p.add_run(detail)
        set_run_font(r, 9.5, False, DARK)


def add_bullets(doc: Document, items: list[str]) -> None:
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        r = p.add_run(item)
        set_run_font(r, 9.3, False, DARK)


def add_sources(doc: Document, sources: list[tuple[str, str, str]]) -> None:
    doc.add_heading("官方來源與本地檔案", level=1)
    for alias, label, url in sources:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.line_spacing = 1.0
        r = p.add_run(f"{alias}｜{label}：")
        set_run_font(r, 7.7, True, NAVY)
        add_hyperlink(p, url, url)


def new_doc(code: str, title: str, subtitle: str, status="研究處理 SOP") -> Document:
    doc = Document()
    style_document(doc, code)
    add_title_block(doc, code, title, subtitle, status)
    return doc


SOURCES = [
    {
        "alias": "MOI-POP1Y-ALIGNED",
        "title": "村里戶數、單一年齡人口（114年12月同年度對齊快照）",
        "authority": "內政部戶政司",
        "dataset_url": "https://data.gov.tw/dataset/77132",
        "resource_url": "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/11412?page={page}",
        "local_path": "01_年齡人口結構/raw/MOI-POP1Y-11412.json",
        "period": "114年12月（2025-12）",
        "geography": "村里／行政區／縣市",
        "age": "單一年齡 0–100+，按性別",
        "evidence": "OFFICIAL_ADMIN_EXACT",
        "use": "與114年勞動、教育資料對齊；18–35歲直接加總",
        "limit": "戶籍人口，不等於人力資源調查民間人口；月資料不是即時串流",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "MOI-POP1Y-LATEST",
        "title": "村里戶數、單一年齡人口（115年7月最新月快照）",
        "authority": "內政部戶政司",
        "dataset_url": "https://data.gov.tw/dataset/77132",
        "resource_url": "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/11507?page={page}",
        "local_path": "01_年齡人口結構/raw/MOI-POP1Y-11507.json",
        "period": "115年7月（2026-07）",
        "geography": "村里／行政區／縣市",
        "age": "單一年齡 0–100+，按性別",
        "evidence": "OFFICIAL_ADMIN_EXACT",
        "use": "最新人口監測；18–35歲直接加總",
        "limit": "跨主題比較須切回共同期；發布新鮮度由機關月資料更新決定",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "NTPC-POP",
        "title": "新北市現住人口之年齡分配 API 快照",
        "authority": "新北市政府",
        "dataset_url": "https://data.ntpc.gov.tw/openapi/",
        "resource_url": "命題既有 API 快照",
        "local_path": "01_年齡人口結構/raw/NTPC-POP.json",
        "period": "本地擷取 2026-08-16",
        "geography": "新北市",
        "age": "來源原生年齡組",
        "evidence": "OFFICIAL_PUBLISHED_VALUE",
        "use": "命題平台交叉檢核",
        "limit": "需核對年齡範圍與統計期",
        "download_status": "LOCAL_OFFICIAL_SNAPSHOT",
    },
    {
        "alias": "DGBAS-HR-POPAGE",
        "title": "15歲以上民間人口之教育程度與年齡",
        "authority": "行政院主計總處",
        "dataset_url": "https://data.gov.tw/dataset/33443",
        "resource_url": "https://ws.dgbas.gov.tw/001/Upload/461/relfile/11525/236096/mp04038a114.xml",
        "local_path": "03_勞動力與就業/raw/DGBAS-15P-CIVILIAN-AGE-EDU-114.xml",
        "period": "114年",
        "geography": "地區別",
        "age": "15–24、25–29、30–34、35–39、40–44…",
        "evidence": "OFFICIAL_SURVEY_ESTIMATE",
        "use": "勞參率民間人口分母",
        "limit": "抽樣估計，單位千人",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "DGBAS-HR-EMPAGE",
        "title": "就業者之教育程度與年齡",
        "authority": "行政院主計總處",
        "dataset_url": "https://data.gov.tw/dataset/34112",
        "resource_url": "https://ws.dgbas.gov.tw/001/Upload/461/relfile/11525/236096/mp04043a114.xml",
        "local_path": "03_勞動力與就業/raw/DGBAS-EMPLOYED-AGE-EDU-114.xml",
        "period": "114年",
        "geography": "地區別",
        "age": "15–24、25–29、30–34、35–39、40–44…",
        "evidence": "OFFICIAL_SURVEY_ESTIMATE",
        "use": "就業人數與失業率分母",
        "limit": "抽樣估計，單位千人",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "DGBAS-HR-UNEMPAGE",
        "title": "失業者之教育程度與年齡",
        "authority": "行政院主計總處",
        "dataset_url": "https://data.gov.tw/dataset/34116",
        "resource_url": "https://ws.dgbas.gov.tw/001/Upload/461/relfile/11525/236096/mp04047a114.xml",
        "local_path": "02_失業率/raw/DGBAS-UNEMPLOYED-AGE-EDU-114.xml",
        "period": "114年",
        "geography": "地區別",
        "age": "15–24、25–29、30–34、35–39、40–44…",
        "evidence": "OFFICIAL_SURVEY_ESTIMATE",
        "use": "失業人數分子",
        "limit": "小樣本年齡切分不確定性較高",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "DGBAS-HR-URAGE",
        "title": "年齡組別失業率",
        "authority": "行政院主計總處",
        "dataset_url": "https://data.gov.tw/dataset/34117",
        "resource_url": "https://ws.dgbas.gov.tw/001/Upload/461/relfile/11525/236096/mp04048a114.xml",
        "local_path": "02_失業率/raw/DGBAS-UNEMPLOYMENT-RATE-AGE-114.xml",
        "period": "114年",
        "geography": "地區別",
        "age": "15–24、25–29、30–34、35–39、40–44…",
        "evidence": "OFFICIAL_SURVEY_ESTIMATE",
        "use": "官方發布值回算驗證",
        "limit": "不可直接平均各年齡組百分比",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "DGBAS-HR-T27",
        "title": "表27：15歲以上民間人口之教育程度與年齡（地區別邊際）",
        "authority": "行政院主計總處",
        "dataset_url": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
        "resource_url": "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/236078/table27.xlsx",
        "local_path": "03_勞動力與就業/raw/DGBAS-HR-T27-2025.xlsx",
        "period": "114年",
        "geography": "地區別（含新北市）",
        "age": "15–24、25–29、30–34、35–39…",
        "evidence": "OFFICIAL_SURVEY_ESTIMATE",
        "use": "民間人口P之年齡邊際、教育總體邊際與IPF約束",
        "limit": "教育與年齡為同列兩組邊際，不是年齡×教育交叉表；千人四捨五入",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "DGBAS-HR-T28",
        "title": "表28：勞動力之教育程度與年齡（地區別邊際）",
        "authority": "行政院主計總處",
        "dataset_url": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
        "resource_url": "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/236078/table28.xlsx",
        "local_path": "03_勞動力與就業/raw/DGBAS-HR-T28-2025.xlsx",
        "period": "114年",
        "geography": "地區別（含新北市）",
        "age": "15–24、25–29、30–34、35–39…",
        "evidence": "OFFICIAL_SURVEY_ESTIMATE",
        "use": "勞動力LF分母與失業率／勞參率回算",
        "limit": "教育與年齡為邊際分布；千人四捨五入，回算只作QA",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "DGBAS-HR-T32",
        "title": "表32：就業者之教育程度與年齡（地區別邊際）",
        "authority": "行政院主計總處",
        "dataset_url": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
        "resource_url": "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/236078/table32.xlsx",
        "local_path": "03_勞動力與就業/raw/DGBAS-HR-T32-2025.xlsx",
        "period": "114年",
        "geography": "地區別（含新北市）",
        "age": "15–24、25–29、30–34、35–39…",
        "evidence": "OFFICIAL_SURVEY_ESTIMATE",
        "use": "就業人數E之年齡邊際與就業人口比率",
        "limit": "不能直接回答『25–29歲各教育程度人數』；千人四捨五入",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "DGBAS-HR-T37",
        "title": "表37：年齡組別失業率",
        "authority": "行政院主計總處",
        "dataset_url": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
        "resource_url": "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/236078/table37.xlsx",
        "local_path": "02_失業率/raw/DGBAS-HR-T37-2025.xlsx",
        "period": "114年",
        "geography": "地區別（含新北市）",
        "age": "15–24、25–29、30–34、35–39…",
        "evidence": "OFFICIAL_SURVEY_ESTIMATE",
        "use": "官方失業率發布值；與T28、T36四捨五入計數回算驗證",
        "limit": "只有比率；18–35不得直接平均各組比率",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "DGBAS-HR-T50-NATIONAL",
        "title": "表50：就業者之教育程度－按年齡分（臺灣地區）",
        "authority": "行政院主計總處",
        "dataset_url": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
        "resource_url": "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/236078/table50.xlsx",
        "local_path": "04_教育程度/reference/national_seed/DGBAS-HR-T50-2025.xlsx",
        "period": "114年",
        "geography": "臺灣地區（無縣市維度）",
        "age": "年齡×教育交叉",
        "evidence": "OFFICIAL_SURVEY_ESTIMATE",
        "use": "全國描述或新北IPF初始種子之敏感度參考",
        "limit": "不可當作新北市官方值；以全國種子推估新北時須標MODEL_ESTIMATE",
        "download_status": "DOWNLOADED_REFERENCE_ONLY",
    },
    {
        "alias": "MOI-EDU5Y",
        "title": "15歲以上現住人口按性別、年齡、婚姻及教育程度分",
        "authority": "內政部戶政司",
        "dataset_url": "https://data.gov.tw/dataset/117988",
        "resource_url": "官方年度 ZIP 快照",
        "local_path": "04_教育程度/raw/MOI-EDU5Y-114.zip",
        "period": "114年",
        "geography": "區／里",
        "age": "五歲年齡組",
        "evidence": "OFFICIAL_ADMIN_EXACT",
        "use": "教育程度行政人數與 IPF 欄邊際",
        "limit": "完整 CSV 解壓約 1.2GB，應串流處理",
        "download_status": "DOWNLOADED_ZIP",
    },
    {
        "alias": "NTPC-EDU15P",
        "title": "新北市十五歲以上人口教育程度結構 API 快照",
        "authority": "新北市政府",
        "dataset_url": "https://data.ntpc.gov.tw/openapi/",
        "resource_url": "命題既有 API 快照",
        "local_path": "04_教育程度/raw/NTPC-EDU15P.json",
        "period": "本地擷取 2026-08-16",
        "geography": "新北市",
        "age": "15歲以上",
        "evidence": "OFFICIAL_PUBLISHED_VALUE",
        "use": "環境趨勢與總量檢核",
        "limit": "無法直接代表18–35歲",
        "download_status": "LOCAL_OFFICIAL_SNAPSHOT",
    },
    {
        "alias": "STAT-WAGE-LOC",
        "title": "表6：本國籍全時受僱員工按工作場所縣市及年齡全年總薪資",
        "authority": "行政院主計總處",
        "dataset_url": "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642",
        "resource_url": "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11753/232642/表6　工業及服務業全年總薪資統計－本國籍全時受僱員工按工作場所所在縣市別及年齡別分.xlsx",
        "local_path": "05_薪資平均數/raw/DGBAS-STAT-WAGE-LOC-current.xlsx",
        "period": "網頁更新 115-08-21",
        "geography": "工作場所所在縣市",
        "age": "未滿25、25–29、30–39…",
        "evidence": "OFFICIAL_ADMIN_LINKED_STATISTIC",
        "use": "新北市工作地薪資平均數／中位數母表",
        "limit": "工作地不等於居住地；寬年齡組需模型化",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "STAT-WAGE-EDU",
        "title": "表5：年齡及教育程度全年總薪資",
        "authority": "行政院主計總處",
        "dataset_url": "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642",
        "resource_url": "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11753/232642/表5　工業及服務業受僱員工全年總薪資統計－按年齡及教育程度分.xlsx",
        "local_path": "05_薪資平均數/raw/DGBAS-STAT-WAGE-EDU-current.xlsx",
        "period": "網頁更新 115-08-21",
        "geography": "全國",
        "age": "未滿25、25–29、30–39…",
        "evidence": "OFFICIAL_ADMIN_LINKED_STATISTIC",
        "use": "薪資年齡／教育形狀與敏感度分析",
        "limit": "不是新北市年齡×教育交叉值",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "BLI-INS-AGE-LOC",
        "title": "勞工保險人數（年齡、地區、性別）",
        "authority": "勞動部勞工保險局",
        "dataset_url": "https://data.gov.tw/dataset/162821",
        "resource_url": "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030517-I7S",
        "local_path": "05_薪資平均數/raw/BLI-INSURED-AGE-REGION-SEX-114.csv",
        "period": "114年",
        "geography": "地區別",
        "age": "15–19、20–24、25–29、30–34、35–39…",
        "evidence": "OFFICIAL_ADMIN_AGGREGATE",
        "use": "薪資年齡模型權數／覆蓋率參考",
        "limit": "投保人數不是薪資母體受僱人數的完全等價權數",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "BLI-PENSION-WAGE-AGE",
        "title": "勞工退休金平均提繳工資－按年齡組別",
        "authority": "勞動部勞工保險局",
        "dataset_url": "https://data.gov.tw/dataset/46103",
        "resource_url": "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030157-6hh",
        "local_path": "05_薪資平均數/raw/BLI-PENSION-AVG-CONTRIBUTION-WAGE-AGE-114.csv",
        "period": "114年",
        "geography": "全國",
        "age": "官方年齡級距",
        "evidence": "OFFICIAL_ADMIN_AGGREGATE",
        "use": "寬年齡組內薪資曲線輔助",
        "limit": "提繳工資不等於全年總薪資",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "BLI-WAGEGRADE-LOC",
        "title": "勞工保險投保人數－按地區、投保薪資及性別",
        "authority": "勞動部勞工保險局",
        "dataset_url": "https://data.gov.tw/dataset/119861",
        "resource_url": "https://apiservice.mol.gov.tw/OdService/download/A17000000J-030232-9dv",
        "local_path": "06_薪資中位數與分布/raw/BLI-INSURED-REGION-WAGEGRADE-SEX-114.csv",
        "period": "114年",
        "geography": "地區別",
        "age": "無年齡交叉",
        "evidence": "OFFICIAL_ADMIN_AGGREGATE",
        "use": "縣市投保薪資分布代理與中位數方法示範",
        "limit": "缺年齡×薪資級距，不能發布18–35歲薪資中位數",
        "download_status": "DOWNLOADED",
    },
    {
        "alias": "MOF-SALARY-AGE",
        "title": "薪資所得者按年齡級距統計表",
        "authority": "財政部",
        "dataset_url": "https://service.mof.gov.tw/public/Data/statistic/gender/yearbook/113/a2060.pdf",
        "resource_url": "https://service.mof.gov.tw/public/Data/statistic/gender/yearbook/113/a2060.pdf",
        "local_path": "05_薪資平均數/raw/MOF-SALARY-INCOME-AGE-113.pdf",
        "period": "113年",
        "geography": "全國",
        "age": "18–24、25–29、30–34、35–39…",
        "evidence": "OFFICIAL_ADMIN_AGGREGATE",
        "use": "全國年齡薪資曲線校準參考",
        "limit": "薪資所得稅定義／全國範圍，不能直接替代新北薪資",
        "download_status": "DOWNLOADED",
    },
]


def write_source_manifest() -> None:
    out = PACKAGE / "00_總覽與治理" / "source_manifest.csv"
    fields = list(SOURCES[0].keys())
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(SOURCES)


def write_openapi_registry() -> None:
    rows = [
        ["MOI-POP1Y", "可自動抓取", "https://data.gov.tw/dataset/77132", "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/{YYYMM}?page={page}", "YYYMM為民國年月；page由1至totalPage", "每月", "合併頁數、totalDataSize、主鍵、18–35加總、SHA-256", "EventBridge每月；先抓最近已發布月份，失敗時向前回溯1個月"],
        ["NTPC-POP", "可自動抓取", "https://data.ntpc.gov.tw/datasets/8308ab58-62d1-424e-8314-24b65b7ab492", "https://data.ntpc.gov.tw/api/datasets/8308ab58-62d1-424e-8314-24b65b7ab492/json?page={page}&size=1000", "page自0起；讀到不足1000列；最低預期2250列", "每年", "重複頁指紋、列數、最大年度、五歲組欄位", "EventBridge每月檢查但僅在source max year變動時發布"],
        ["NTPC-UNEMP", "可自動抓取", "https://data.ntpc.gov.tw/datasets/c29c80d4-bef1-452c-8d9a-659e72f07831", "https://data.ntpc.gov.tw/api/datasets/c29c80d4-bef1-452c-8d9a-659e72f07831/json?page=0&size=100", "單頁小表；仍檢查最新年度與schema", "每年", "欄位漂移、百分比範圍、年度不倒退", "每月探測；來源年度變更才觸發curated層"],
        ["NTPC-EMPSTR", "可自動抓取", "https://data.ntpc.gov.tw/datasets/c285509a-7fb2-434f-8542-0b4986c337a8", "https://data.ntpc.gov.tw/api/datasets/c285509a-7fb2-434f-8542-0b4986c337a8/json?page=0&size=100", "單頁小表", "每年", "年齡比率合計、最新年度、schema", "每月探測；變更才發布"],
        ["NTPC-EDU15P", "可自動抓取", "https://data.ntpc.gov.tw/datasets/ffef3ed1-867e-4013-ade0-47cfdba44b2d", "https://data.ntpc.gov.tw/api/datasets/ffef3ed1-867e-4013-ade0-47cfdba44b2d/json?page=0&size=100", "單頁小表", "每年", "教育占比範圍、最新年度、schema", "每月探測；來源年度變更才發布"],
        ["MOI-EDU5Y", "API可用但大檔優先ZIP", "https://data.gov.tw/dataset/117988", "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP053/{YYY}", "民國年；資料量大，AWS採分頁或官方ZIP", "每年", "檔案大小、列數、年齡×教育加總、SHA-256", "年度資料發布後由Step Functions啟動Glue大型作業"],
        ["DGBAS-HR/WAGE", "下載檔案，非穩定查詢API", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078", "官方頁面之XLSX/XML資源URL", "先解析官方頁面資源清單，不硬猜附件版本", "每月／每年依表別", "PK簽章、工作表名稱、統計年、地理層級、SHA-256", "EventBridge探測官方頁；附件URL或雜湊變動才重跑"],
        ["OAS-POP", "人工匯出", "https://oas.bas.ntpc.gov.tw/DgbasWeb/Page/Default.aspx", "尚未確認穩定公開API", "保留查詢條件、截圖、原檔名、時間與雜湊", "依需求", "人工證據鏈完整", "不得宣稱自動或即時介接"],
    ]
    out = PACKAGE / "00_總覽與治理" / "openapi_registry.csv"
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["source_alias", "access_class", "official_page", "endpoint_template", "parameters_pagination", "source_refresh_cadence", "quality_gate", "recommended_schedule"])
        w.writerows(rows)


def write_corrected_integration_v15() -> None:
    path = PACKAGE / "07_整合與查核" / "reference" / "青年18-35歲資料整合表_V1.5.csv"
    if not path.exists():
        return
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fields = list(reader.fieldnames or [])
        rows = list(reader)

    for row in rows:
        alias = row.get("source_alias", "")
        if alias in {"DGBAS-HR-T27", "DGBAS-HR-T32", "DGBAS-HR-T27+T32"}:
            marginal_suffix = "（年齡與教育為同列邊際，非交叉表）"
            if marginal_suffix not in row.get("source_name", ""):
                row["source_name"] = row.get("source_name", "") + marginal_suffix
            row["definition_conflict"] = "教育總體邊際與年齡總體邊際可各自使用，但不能直接回答特定年齡層的教育程度；千人四捨五入。"
            row["notes"] = "可作P／E年齡分母、總體教育結構、資料一致性檢查及IPF列欄邊際；若要年齡×教育聯合分布，須另有交叉表或種子矩陣。"
        if alias == "DGBAS-HR-T37":
            row["current_data_sufficient_to_execute"] = "YES_SOURCE_NATIVE_AND_QA_READY"
            row["current_data_gap_reason"] = "25–29官方率可直接發布；T28勞動力230千人與失業者XML 15千人已補入，可作四捨五入回算QA。18–35仍需分別拆分15–24及35–39之U與LF。"
        if alias == "DGBAS-HR-T50":
            row["source_geography"] = "臺灣地區（無縣市維度）"
            row["source_name"] = "表50：就業者教育程度－按年齡分（臺灣地區）"
            row["can_answer_18_35"] = "NATIONAL_ONLY"
            row["publish_status"] = "REFERENCE_NATIONAL_ONLY"
            row["local_snapshot"] = "04_教育程度/reference/national_seed/DGBAS-HR-T50-2025.xlsx"
            row["definition_conflict"] = "本表沒有縣市維度；不可標成新北市官方值。"
            row["notes"] = "可發布臺灣地區來源原生值；若用作新北市IPF初始種子，輸出必須標MODEL_ESTIMATE並做不同種子敏感度。"

    existing = {row.get("record_id") for row in rows}
    def digest(relative: str) -> str:
        h = hashlib.sha256()
        with (PACKAGE / relative).open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()

    def blank_row(record_id: str) -> dict[str, str]:
        row = {field: "" for field in fields}
        row["record_id"] = record_id
        return row

    pop_sha = digest("01_年齡人口結構/raw/MOI-POP1Y-11412.json")
    population = [
        ("AGEINT-066", "18–24", "261472"),
        ("AGEINT-067", "25–29", "250128"),
        ("AGEINT-068", "30–35", "334338"),
        ("AGEINT-069", "18–35", "845938"),
    ]
    for record_id, age, value in population:
        if record_id in existing:
            continue
        row = blank_row(record_id)
        row.update({
            "phase": "PHASE_2_ALIGNED_PERIOD", "topic": "人口", "source_alias": "MOI-POP1Y-ALIGNED",
            "source_name": "村里戶數、單一年齡人口（114年12月同年度對齊快照）", "source_period": "2025-12",
            "source_geography": "新北市", "geography_role": "residence", "population_scope": "戶籍人口",
            "measure_code": "resident_population_count", "measure_name": f"{age}歲戶籍人口數（114年12月）",
            "source_age_band": f"single_age_{age}", "target_age_band": age, "sex": "all", "education_level": "all",
            "source_value": value, "source_unit": "人", "adjustment_method_code": "M1_EXACT_REAGGREGATION",
            "adjusted_value": value, "adjusted_unit": "人", "value_status": "OFFICIAL_DERIVED_EXACT",
            "evidence_class": "E1_EXACT_REAGGREGATION", "value_origin_class": "OFFICIAL_ADMIN_EXACT",
            "value_origin_label_zh": "官方行政資料精確加總", "official_published_value": "NO",
            "is_statistical_estimate": "NO", "calculation_or_estimation_method": f"逐歲加總{age}歲男女欄位",
            "uncertainty_precision_note": "行政計數無抽樣誤差；仍受戶籍定義與資料修訂影響。",
            "method_verification_status": "VERIFIED_COMPONENT_SUM", "can_answer_18_35": "YES" if age == "18–35" else "PARTIAL",
            "publish_status": "PUBLISH_EXACT", "source_url": "https://data.gov.tw/dataset/77132",
            "local_snapshot": "01_年齡人口結構/raw/MOI-POP1Y-11412.json", "sha256": pop_sha,
            "definition_conflict": "戶籍人口，不等於人力資源調查民間人口。", "human_review_required": "NO",
            "notes": "此列用於與114年勞動、教育資料共同期比較；最新趨勢另看11507快照。",
            "current_data_sufficient_to_execute": "YES_EXACT_ALREADY_EXECUTED", "current_data_gap_reason": "無；114年12月官方單一年齡API已完整取得並通過分頁加總。",
        })
        rows.append(row)

    t28_sha = digest("03_勞動力與就業/raw/DGBAS-HR-T28-2025.xlsx")
    u_sha = digest("02_失業率/raw/DGBAS-UNEMPLOYED-AGE-EDU-114.xml")
    extra = []
    r = blank_row("AGEINT-070")
    r.update({"phase":"PHASE_1_VALIDATION","topic":"就業","source_alias":"DGBAS-HR-T28","source_name":"表28：勞動力之教育程度與年齡（地區別邊際）","source_period":"2025","source_geography":"新北市","geography_role":"survey_region","population_scope":"勞動力","measure_code":"labor_force_count","measure_name":"25–29歲勞動力人數","source_age_band":"25–29","target_age_band":"25–29","sex":"all","education_level":"all","source_value":"230","source_unit":"千人","adjustment_method_code":"M0_DIRECT_EXACT","adjusted_value":"230","adjusted_unit":"千人","value_status":"OFFICIAL_DIRECT_ROUNDED","evidence_class":"E0_OFFICIAL_DIRECT","value_origin_class":"OFFICIAL_SURVEY_ESTIMATE","value_origin_label_zh":"官方抽樣調查估計值","official_published_value":"YES","is_statistical_estimate":"YES","calculation_or_estimation_method":"來源原生25–29歲勞動力人數","uncertainty_precision_note":"官方抽樣估計且以千人四捨五入。","method_verification_status":"VERIFIED_SOURCE_CELL","can_answer_18_35":"PARTIAL","publish_status":"PUBLISH_SOURCE_NATIVE_ONLY","source_url":"https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078","local_snapshot":"03_勞動力與就業/raw/DGBAS-HR-T28-2025.xlsx","sha256":t28_sha,"definition_conflict":"年齡與教育是兩組邊際，不是交叉表。","human_review_required":"NO","notes":"作失業率分母與勞參率分子；25–29可直接使用。","current_data_sufficient_to_execute":"YES_MODEL_READY_NOT_EXECUTED","current_data_gap_reason":"25–29可直接使用；18–35仍須拆分15–24及35–39邊界。"})
    extra.append(r)
    r = blank_row("AGEINT-071")
    r.update({"phase":"PHASE_1_VALIDATION","topic":"就業","source_alias":"DGBAS-HR-UNEMPAGE","source_name":"失業者之教育程度與年齡（表36機器可讀XML）","source_period":"2025","source_geography":"新北市","geography_role":"survey_region","population_scope":"失業者","measure_code":"unemployed_person_count","measure_name":"25–29歲失業人數","source_age_band":"25–29","target_age_band":"25–29","sex":"all","education_level":"all","source_value":"15","source_unit":"千人","adjustment_method_code":"M0_DIRECT_EXACT","adjusted_value":"15","adjusted_unit":"千人","value_status":"OFFICIAL_DIRECT_ROUNDED","evidence_class":"E0_OFFICIAL_DIRECT","value_origin_class":"OFFICIAL_SURVEY_ESTIMATE","value_origin_label_zh":"官方抽樣調查估計值","official_published_value":"YES","is_statistical_estimate":"YES","calculation_or_estimation_method":"來源原生25–29歲失業人數","uncertainty_precision_note":"官方抽樣估計且以千人四捨五入；小樣本不確定性較高。","method_verification_status":"VERIFIED_SOURCE_CELL","can_answer_18_35":"PARTIAL","publish_status":"PUBLISH_SOURCE_NATIVE_ONLY","source_url":"https://data.gov.tw/dataset/34116","local_snapshot":"02_失業率/raw/DGBAS-UNEMPLOYED-AGE-EDU-114.xml","sha256":u_sha,"definition_conflict":"不得以失業人數除戶籍人口；分母須為勞動力。","human_review_required":"NO","notes":"與T28勞動力230千人配對作回算QA。","current_data_sufficient_to_execute":"YES_MODEL_READY_NOT_EXECUTED","current_data_gap_reason":"25–29可直接使用；18–35仍須拆分15–24及35–39邊界。"})
    extra.append(r)
    r = blank_row("AGEINT-072")
    r.update({"phase":"PHASE_1_VALIDATION","topic":"就業","source_alias":"DGBAS-HR-T28+UNEMPAGE","source_name":"表28勞動力＋表36失業人數回算","source_period":"2025","source_geography":"新北市","geography_role":"survey_region","population_scope":"勞動力","measure_code":"unemployment_rate_recomputed_qa_pct","measure_name":"25–29歲失業率四捨五入計數回算QA","source_age_band":"25–29","target_age_band":"25–29","sex":"all","education_level":"all","source_value":"","source_unit":"%","adjustment_method_code":"COUNT_RECOMPUTE_ROUNDED_QA","adjusted_value":"6.521739","adjusted_unit":"%","value_status":"QA_RECOMPUTED_FROM_ROUNDED_COUNTS","evidence_class":"E2_EXACT_FROM_COMPONENTS","value_origin_class":"DERIVED_FROM_OFFICIAL_SURVEY_ROUNDED_COUNTS","value_origin_label_zh":"由官方調查四捨五入計數回算之QA值","official_published_value":"NO","is_statistical_estimate":"YES","calculation_or_estimation_method":"15÷230×100=6.521739%","uncertainty_precision_note":"U與LF均以千人四捨五入；與官方未四捨五入底稿計算之6.4%不同屬預期。","method_verification_status":"PASSED_ROUNDING_DIFFERENCE_0.12PP","can_answer_18_35":"PARTIAL","publish_status":"QA_ONLY_DO_NOT_REPLACE_OFFICIAL_RATE","source_url":"https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078","local_snapshot":"03_勞動力與就業/raw/DGBAS-HR-T28-2025.xlsx + 02_失業率/raw/DGBAS-UNEMPLOYED-AGE-EDU-114.xml","sha256":f"{t28_sha};{u_sha}","definition_conflict":"官方發布率6.4%應為正式值；6.52%只用來驗證分子分母方向與量級。","human_review_required":"NO","notes":"不得以6.52%覆蓋表37之6.4%。","current_data_sufficient_to_execute":"YES_QA_EXECUTED","current_data_gap_reason":"25–29回算QA已完成；18–35仍須先估計各邊界組U與LF再重算。"})
    extra.append(r)
    for row in extra:
        if row["record_id"] not in existing:
            rows.append(row)

    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_method_codebook() -> None:
    rows = [
        ["DIRECT_SUM", "單一年齡直接加總", "行政資料已有18–35各歲", "官方行政精確值", "不估計"],
        ["PCLM", "複合連結模型／Poisson 分割", "五歲組計數且需單一年齡", "模型估計值", "以Sprague差異與bootstrap報告"],
        ["SPRAGUE", "Sprague 乘數分齡", "五歲組計數的敏感度檢查", "模型估計值", "負值／邊界效應檢查"],
        ["IPF", "迭代比例擬合", "已有年齡與教育邊際總數", "模型估計值", "列欄邊際需完全重現"],
        ["COUNT_RECOMPUTE", "由分子分母重算比率", "失業率、勞參率、占比", "依輸入資料類別", "不可平均百分比"],
        ["COUNT_RECOMPUTE_ROUNDED_QA", "四捨五入計數回算QA", "只有千人四捨五入U/LF時", "QA值，不取代官方率", "報差異百分點並以官方率為正式值"],
        ["MARGINAL_ONLY", "邊際分布使用", "表27/28/32同列教育與年齡邊際", "來源原生邊際", "不得宣稱年齡×教育交叉"],
        ["IPF_NATIONAL_SEED", "全國種子之IPF新北模型", "只有新北列欄邊際與全國交叉種子", "模型估計值", "多種種子敏感度與邊際完全重現"],
        ["CALIBRATED_WEIGHTED_MEAN", "校準後加權平均", "薪資平均數寬年齡組", "模型估計值", "權數與校準基準需揭露"],
        ["CDF_MEDIAN", "累積分布定位中位數", "有年齡×薪資級距×權數", "模型／代理估計", "無完整交叉時禁止發布"],
        ["NO_ESTIMATE", "不估計", "缺必要分布、權數或定義衝突", "待查核", "列入人工裁示"],
    ]
    out = PACKAGE / "00_總覽與治理" / "method_codebook.csv"
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["method_code", "method_name_zh", "when_to_use", "output_class", "required_validation"])
        w.writerows(rows)


def write_review_checklist() -> None:
    rows = [
        ["POP-01", "人口統計期", "11412適合跨主題同年度比較；11507適合最新趨勢", "儀表板預設顯示最新月，但跨主題比較鎖定114年共同期並明示統計期", "政策主管", "PENDING"],
        ["HR-01", "勞動市場人口概念", "民間人口與戶籍人口不可互換", "採主計總處民間人口作勞參率分母；MOI只作形狀／查核", "統計承辦", "PENDING"],
        ["AGE-01", "PCLM主模型", "五歲組拆分18、19、35歲", "同意PCLM為主、Sprague為敏感度；差異>5%轉人工", "統計承辦", "PENDING"],
        ["SAL-01", "薪資地理定義", "工作場所所在新北 vs 居住新北", "儀表板主標題明示工作地；若需居住地另申請客製表", "政策主管", "PENDING"],
        ["SAL-02", "薪資模型發布", "18–35需寬年齡組拆分與代理權數", "25–29先發布；18–35標MODEL_ESTIMATE且附區間", "政策主管", "PENDING"],
        ["MED-01", "薪資中位數", "缺新北年齡×薪資分布與權數", "現階段不發布18–35正式中位數，只示範代理方法", "統計承辦", "PENDING"],
        ["EDU-01", "教育小細胞", "里／年齡／教育交叉可能稀疏", "設定最小發布門檻並合併類別", "資料治理", "PENDING"],
        ["EDU-02", "教育產品定義", "戶籍人口教育、民間人口教育、就業者教育不是同一母體", "先裁示儀表板主產品；三者不得在同一序列混接", "政策主管", "PENDING"],
        ["EDU-03", "表50地理層級", "表50只有臺灣地區、無新北市維度", "只作全國參考或IPF種子；新北推估必標MODEL_ESTIMATE", "統計承辦", "RESOLVED_IN_V2.1"],
        ["API-01", "自動更新發布延遲", "API可自動抓取不等於資料即時發布", "採source_period而非retrieved_at判斷新鮮度；來源期未變不重發", "資料治理", "PENDING"],
        ["TIME-01", "統計期對齊", "114年與113年資料混用", "不得合併成同一官方值；使用最近共同期或明示時點差", "資料治理", "PENDING"],
    ]
    out = PACKAGE / "00_總覽與治理" / "human_review_checklist.csv"
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["review_id", "decision", "risk", "recommended_ruling", "owner", "status"])
        w.writerows(rows)


def write_readme() -> None:
    text = f"""新北市青年18–35歲政府公開資料包 {VERSION}
彙整日期：{COLLECTED}

用途：支援新北市青年18–35歲人口、就業、失業、教育與薪資指標之可追溯研究、儀表板與AWS處理流程。

資料夾：
00_總覽與治理：總說明、來源清冊、OpenAPI介接表、方法代碼、人工查核表、SHA-256。
01_年齡人口結構：內政部11412共同期與11507最新月單一年齡API快照、新北五歲組API快照。
02_失業率：主計總處失業人數、官方失業率與新北API快照。
03_勞動力與就業：表27民間人口、表28勞動力、表32就業、表36失業與方法檔。
04_教育程度：內政部年齡×教育年度ZIP、主計總處地區別邊際表、新北API快照；表50另置reference/national_seed。
05_薪資平均數：主計總處薪資表、勞保年齡權數、勞退提繳工資、財政部年齡薪資。
06_薪資中位數與分布：主計總處薪資表與勞保薪資級距分布。
07_整合與查核：修正版整合表V1.5、OpenAPI可執行程式、跨資料定義與AWS/Kiro落地流程。

重要：
1. raw檔保持原始下載內容，衍生結果不得覆寫raw。
2. MOI-EDU5Y-114.zip解壓後CSV約1.2GB，建議AWS Glue/Spark或分塊串流讀取。
3. 官方行政精確值、官方調查估計值、模型估計值、代理值不可混稱。
4. 薪資中位數缺年齡×薪資分布時不得以平均數或各組中位數加權替代。
5. 表27／28／32的教育與年齡是同列邊際，不是交叉表；表50是臺灣地區，不是新北市。
6. 25–29歲失業率正式值採表37的6.4%；15/230=6.52%僅為四捨五入計數QA。
7. API的retrieved_at只代表抓取時間；儀表板資料新鮮度一律看source_period。
8. 先閱讀各資料夾Word，再依human_review_checklist.csv完成裁示。
"""
    (PACKAGE / "README.txt").write_text(text, encoding="utf-8-sig")


def build_overview() -> Path:
    doc = new_doc("DOC-00", "資料包總覽、治理與使用說明", "中央政府與新北市公開資料｜18–35歲核心青年｜可追溯、可重算、可查核", "總控文件")
    add_callout(doc, "V2.1修正結論", "114年12月與115年7月單一年齡API快照已鎖版；失業率已補表28勞動力分母；表27/28/32改標邊際表；表50改列臺灣地區參考。每個數值仍須帶統計期、地理、證據與發布狀態。", "ok")
    doc.add_heading("1. 研究目標與邊界", level=1)
    add_bullets(doc, [
        "核心青年：18–35歲；政策分析分組為18–24、25–29、30–35；15–17及36–40僅作觀察／擴充組。",
        "第一階段以25–29歲官方原生區間驗證資料介接、公式與圖表；第二階段才擴充18–35歲邊界估計。",
        "地理角色分為戶籍地、居住地、工作地、調查地區；不得只以『新北市』名稱視為同義。",
    ])
    doc.add_heading("2. 本版四項修正", level=1)
    add_table(doc, ["問題", "查核結果", "V2.1處理", "目前狀態"], [
        ["人口只有109年", "舊CSV確為109年；另有11507 API快照", "新增11412共同期＋保留11507最新月；排除109年CSV", "已修正"],
        ["失業率只有百分比", "表37為官方率；表28 LF、表36 U、表32 E可補分子分母", "25–29：LF=230、U=15、E=215千人；6.52%僅QA，官方率6.4%", "已補齊"],
        ["表27/32能否看年齡×教育", "兩表是教育邊際與年齡邊際，不是交叉表", "用於P/E年齡分母、總體教育、IPF邊際；不得直接回答特定年齡教育", "已改標"],
        ["表50是否新北", "只有臺灣地區，無縣市欄", "移至reference/national_seed；不得作新北官方值", "已修正"],
    ], [3.5, 5.5, 7.0, 2.0])
    doc.add_heading("3. 全資料血緣圖", level=1)
    add_flow(doc, [
        ("官方原始層", "MOI／DGBAS／MOL-BLI／MOF／NTPC"),
        ("契約層", "欄位、期別、地理、年齡、單位"),
        ("方法層", "DIRECT／PCLM／Sprague／IPF／CDF"),
        ("指標層", "人口／失業／勞參／教育／薪資"),
        ("治理層", "證據標籤、QA、人工裁示、發布"),
    ])
    doc.add_heading("4. 數值證據分類", level=1)
    add_table(doc, ["代碼", "定義", "可否直接發布", "例"], [
        ["OFFICIAL_ADMIN_EXACT", "行政登記完整計數", "可；須保留統計期／範圍", "MOI戶籍單一年齡人口"],
        ["OFFICIAL_SURVEY_ESTIMATE", "官方抽樣調查加權估計", "可；不得稱行政精確值", "DGBAS人力資源調查"],
        ["OFFICIAL_ADMIN_LINKED_STATISTIC", "行政檔連結編製官方統計", "可；依官方定義", "全年總薪資表"],
        ["MODEL_ESTIMATE", "PCLM／IPF／校準加權所得", "條件式；須附方法與不確定性", "18、19、35歲拆分"],
        ["PROXY_ONLY", "母體／概念不完全相同", "不可冒充正式指標", "投保薪資分布替代全年薪資"],
    ], [3.8, 5.7, 4.5, 4.0])
    doc.add_heading("5. 年齡轉換決策樹", level=1)
    add_steps(doc, [
        ("單一年齡已存在", "18至35歲直接加總；保留性別與行政區維度。"),
        ("五歲組計數", "以PCLM拆分單一年齡，Sprague作敏感度；利用單一年齡人口作形狀校準，仍保留來源五歲組總量。"),
        ("年齡×類別矩陣", "PCLM產生初始矩陣，IPF使單一年齡列邊際與教育／性別欄邊際同時吻合。"),
        ("比率", "先處理分子與分母，再重算；不得平均失業率或勞參率。"),
        ("薪資平均數", "需受僱人數權數與寬組內薪資曲線；結果標MODEL_ESTIMATE。"),
        ("中位數", "必須有個體或年齡×薪資級距分布；缺資料即NO_ESTIMATE。"),
    ])
    doc.add_heading("6. OpenAPI、AWS與Kiro共通流程", level=1)
    add_flow(doc, [
        ("排程／協調", "EventBridge＋Step Functions；分頁、重試與來源期閘門"),
        ("S3 raw", "原檔唯讀＋版本；抓取日與來源期分開"),
        ("Glue", "解壓、欄位映射、型別、分區"),
        ("Athena", "SQL重算與查核視圖"),
        ("Agent／Dashboard", "Bedrock AgentCore問答＋可追溯圖表"),
    ])
    add_callout(doc, "更新原則", "每月可自動呼叫API，但只有source_period或SHA-256改變才重建curated層。MOI人口為月資料；NTPC人口、失業與教育多為年資料，不得以抓取日冒充統計日。", "info")
    add_callout(doc, "Kiro規則", "在spec中固定輸入契約、輸出schema、方法代碼與驗收測試；Kiro可產生IaC與ETL程式，但不得自行改寫統計定義或把代理值升格為官方值。", "info")
    doc.add_heading("7. 最小輸出欄位", level=1)
    add_table(doc, ["欄位", "用途", "範例"], [
        ["metric_id / value", "指標與數值", "unemployment_rate_pct / 6.4"],
        ["age_band / geography_role", "年齡與地理角色", "18-35 / survey_region"],
        ["source_alias / source_period", "來源追溯", "DGBAS-HR-T37 / 2025"],
        ["evidence_class / method_code", "證據與算法", "OFFICIAL_SURVEY_ESTIMATE / DIRECT"],
        ["source_period / retrieved_at", "資料期與抓取時點", "2025 / 2026-08-24"],
        ["publish_status / human_review_id", "發布閘門", "PUBLISH_SOURCE_NATIVE_ONLY / —"],
        ["local_snapshot / sha256", "檔案查核", "raw/file.xml / …"],
    ], [4.6, 6.1, 7.1])
    doc.add_heading("8. 人工查核", level=1)
    add_callout(doc, "必做", "先完成00_總覽與治理/human_review_checklist.csv。未裁示的工作地／居住地衝突、薪資模型發布與中位數缺口，一律保持HOLD。", "warn")
    add_sources(doc, [(s["alias"], s["title"], s["dataset_url"]) for s in SOURCES])
    out = PACKAGE / "00_總覽與治理" / f"00_資料包總覽_治理與使用說明_{VERSION}.docx"
    doc.save(out)
    return out


def build_population() -> Path:
    doc = new_doc("DOC-01", "年齡人口結構：處理方法與驗證範例", "18–35歲戶籍人口｜單一年齡直接加總｜不需統計估計", "可直接執行")
    add_callout(doc, "已修正", "109年舊CSV已排除。主來源改為戶政司ODRP014 OpenAPI：11412作跨主題共同期，11507作最新人口監測；兩者都有18至35各單一年齡，採DIRECT_SUM。", "ok")
    doc.add_heading("1. 資料支持圖", level=1)
    add_flow(doc, [
        ("ODRP014 API", "period＋page；村里×性別×0–100+各歲"),
        ("篩選", "新北市＋統計期＋性別"),
        ("加總", "Σ age=18…35"),
        ("分組", "18–24／25–29／30–35"),
        ("查核", "分組和＝18–35；與NTPC總量比對"),
    ])
    doc.add_heading("2. 輸入與欄位", level=1)
    add_table(doc, ["來源", "欄位／維度", "證據類別", "角色"], [
        ["MOI-POP1Y-11412.json", "統計期11412、7,752村里列、單一年齡×性別", "行政精確值", "共同期主來源"],
        ["MOI-POP1Y-11507.json", "統計期11507、7,781村里列、單一年齡×性別", "行政精確值", "最新月主來源"],
        ["NTPC-POP.json", "2000–2024、2,250列、五歲組", "官方發布值", "趨勢／交叉檢核"],
    ], [5.4, 6.3, 3.2, 2.9])
    doc.add_heading("3. OpenAPI介接方法", level=1)
    add_steps(doc, [
        ("請求", "GET https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/{民國年月}?page={page}。"),
        ("分頁", "先讀第1頁totalPage，再取得1…totalPage；合併responseData，驗證len＝totalDataSize。"),
        ("重試", "逾時30秒；最多3次，退避1/3/9秒；HTML、空檔或非JSON即失敗。"),
        ("鎖版", "寫入run_id、URL、source_period、retrieved_at、row_count、bytes、SHA-256；raw不覆寫。"),
        ("識別統計期", "民國年轉西元僅新增欄位，不覆寫原始統計期。"),
        ("地理標準化", "保留area_code，名稱只作展示；新北市代碼需與官方碼表一致。"),
        ("欄位轉長表", "將people_age_018_m/f…people_age_035_m/f轉成age/sex/value列。"),
        ("直接加總", "依行政區、性別、統計期計算三政策組與核心18–35。"),
        ("排程", "EventBridge每月探測；source_period未更新就不重發。最新趨勢與共同期資料分成兩個view。"),
    ])
    add_formula(doc, "P(18–35) = Σ P(age), age ∈ {18,…,35}", "行政單一年齡資料直接加總；結果仍為OFFICIAL_ADMIN_EXACT。")
    doc.add_heading("4. 已執行官方加總", level=1)
    add_table(doc, ["政策組", "114年12月", "115年7月", "證據／用途"], [
        ["18–24", "261,472人", "256,105人", "行政精確；分組"],
        ["25–29", "250,128人", "244,695人", "行政精確；第一階段"],
        ["30–35", "334,338人", "331,414人", "行政精確；含35歲"],
        ["18–35", "845,938人", "832,214人", "行政精確；共同期／最新月"],
    ], [3.0, 4.5, 4.5, 6.0])
    add_callout(doc, "如何選期間", "人口儀表板最新卡片可用11507；與114年人力資源調查、教育資料做橫向比較時用11412。兩者不得在同一橫截面表中混成同一期。", "warn")
    doc.add_heading("5. AWS實作與產出", level=1)
    add_bullets(doc, [
        "S3 raw：原始JSON唯讀；Glue轉成partitioned Parquet（source_period/county/district/sex）。",
        "Athena：以UNNEST或長表聚合；輸出resident_population_count與resident_population_share_pct。",
        "每列附source_alias、evidence_class、method_code=DIRECT_SUM、sha256、run_id。",
    ])
    doc.add_heading("6. 品質與人工查核", level=1)
    add_table(doc, ["檢查", "規則", "失敗處理"], [
        ["分頁完整性", "API總筆數＝已取得筆數；page key不重複", "重抓並隔離不完整批次"],
        ["加總一致", "18–24+25–29+30–35＝18–35", "阻擋發布"],
        ["期別新鮮度", "以source_period判斷，不以retrieved_at判斷", "期未變則保留前版"],
        ["定義", "戶籍人口不得作正式勞參率分母", "送HR-01裁示"],
    ], [4.0, 8.1, 5.9])
    doc.add_heading("7. 已測試OpenAPI介接紀錄", level=1)
    add_table(doc, ["來源期", "總頁數／總列數", "新北市村里列", "SHA-256（前16碼）"], [
        ["11412", "4頁／7,752列", "1,032列", "14699dae33d769f"],
        ["11507", "4頁／7,781列", "1,039列", "15e7a478385809e9"],
    ], [3.0, 5.0, 4.0, 6.0])
    add_callout(doc, "測試判定", "兩期均完成全部4頁合併，取得列數等於API totalDataSize；raw檔雜湊已寫入file_hashes_sha256.csv。", "ok")
    add_sources(doc, [
        ("MOI-POP1Y", "村里戶數、單一年齡人口與API說明", "https://data.gov.tw/dataset/77132"),
        ("NTPC-POP", "新北市政府OpenAPI", "https://data.ntpc.gov.tw/openapi/"),
    ])
    out = PACKAGE / "01_年齡人口結構" / f"01_年齡人口結構_處理方法與驗證範例_{VERSION}.docx"
    doc.save(out)
    return out


def build_unemployment() -> Path:
    doc = new_doc("DOC-02", "失業率：處理方法與驗證範例", "官方失業人數＋就業人數｜先處理計數再重算比率｜PCLM邊界拆分", "條件式估計")
    add_callout(doc, "本版已補分母", "表37只有官方失業率；V2.1已補表28勞動力LF與表36失業人數U。25–29可完整驗證；18–35仍須把15–24拆出18–24、把35–39拆出35歲後再重算，不能平均百分比。", "ok")
    doc.add_heading("1. 資料支持圖", level=1)
    add_flow(doc, [
        ("失業人數U", "UNEMPAGE"),
        ("LF／E", "表28勞動力＋表32就業"),
        ("年齡拆分", "PCLM主模型＋Sprague敏感度"),
        ("重算", "UR=ΣU/ΣLF；LF≈E+U"),
        ("驗證", "表37官方率＋方法差異"),
    ])
    doc.add_heading("2. 輸入資料與欄位", level=1)
    add_table(doc, ["來源", "使用欄位", "功能", "類別"], [
        ["DGBAS-UNEMPLOYED-AGE-EDU-114.xml", "地區、15–24、25–29、30–34、35–39失業人數", "分子U", "官方調查估計"],
        ["DGBAS-HR-T28-2025.xlsx", "同年齡組勞動力人數", "分母LF", "官方調查估計"],
        ["DGBAS-EMPLOYED-AGE-EDU-114.xml／T32", "同年齡組就業人數", "驗證LF≈E+U", "官方調查估計"],
        ["DGBAS-HR-T37-2025.xlsx", "官方年齡組失業率", "正式發布值", "官方調查估計"],
    ], [5.3, 7.1, 3.1, 2.5])
    doc.add_heading("3. 年齡轉換方法", level=1)
    add_steps(doc, [
        ("25–29先驗證", "來源原生區間不拆分；確認U、E與官方UR滿足四捨五入容許差。"),
        ("15–24拆18–24", "對U與LF分別用PCLM估計單一年齡後加總18–24；不可把7/10當固定比例。"),
        ("35–39取35", "同樣分別拆U與LF；保留35–39官方組總量。"),
        ("敏感度", "用Sprague再算一組；PCLM與Sprague對18–35率差>0.2個百分點或相對差>5%時轉人工。"),
        ("不確定性", "有重複權數／微資料時bootstrap；否則以方法差異＋官方抽樣誤差可得資訊形成區間。"),
    ])
    add_formula(doc, "UR(18–35)=ΣU(a)/ΣLF(a)×100；同時檢查 ΣLF(a)≈ΣE(a)+ΣU(a)", "U、LF、E須同年、同地區、同年齡；MOI戶籍人口不是LF分母。")
    doc.add_heading("4. 已執行25–29驗證（114年新北市，千人）", level=1)
    add_table(doc, ["資料", "數值", "角色", "結果／判讀"], [
        ["表28勞動力LF", "230", "失業率分母", "官方調查估計、千人四捨五入"],
        ["表36失業人數U", "15", "失業率分子", "官方調查估計、千人四捨五入"],
        ["表32就業人數E", "215", "一致性QA", "E+U=230，與LF一致"],
        ["計數回算", "15÷230=6.52%", "QA值", "只驗證方向與量級"],
        ["表37官方失業率", "6.4%", "正式發布值", "採未四捨五入底稿；應優先發布"],
    ], [5.0, 3.5, 4.0, 5.5])
    add_callout(doc, "為何6.52%不等於6.4%", "U與LF公開表以千人四捨五入，先四捨五入再相除會有差；官方6.4%以較精細底稿計算。故6.52%標QA_ONLY，不可覆蓋官方率。", "warn")
    doc.add_heading("5. QA與發布閘門", level=1)
    add_table(doc, ["檢查", "公式／門檻", "處置"], [
        ["官方回算", "比較U/LF與UR_official並說明千人四捨五入", "官方率為正式值；回算只作QA"],
        ["組總量保持", "Σ單一年齡估計＝來源五歲組", "失敗阻擋"],
        ["方法差異", "PCLM vs Sprague相對差≤5%", "超標人工查核"],
        ["小樣本", "U過小／不穩定", "合併期別或只發布區間"],
    ], [4.2, 8.2, 5.6])
    add_sources(doc, [
        ("DGBAS-HR-UNEMPAGE", "失業者之教育程度與年齡", "https://data.gov.tw/dataset/34116"),
        ("DGBAS-HR-EMPAGE", "就業者之教育程度與年齡", "https://data.gov.tw/dataset/34112"),
        ("DGBAS-HR-T28/T32/T37", "114年人力資源調查統計年報（勞動力、就業、失業率）", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078"),
    ])
    out = PACKAGE / "02_失業率" / f"02_失業率_處理方法與驗證範例_{VERSION}.docx"
    doc.save(out)
    return out


def build_labor() -> Path:
    doc = new_doc("DOC-03", "勞動力與就業：處理方法與驗證範例", "民間人口P、就業E、失業U｜勞參率與就業人口比率同源重算", "條件式估計")
    add_callout(doc, "定義衝突", "勞參率分母必須使用人力資源調查15歲以上民間人口P，不可改用內政部戶籍人口。MOI單一年齡只能輔助拆分形狀與外部查核。", "stop")
    doc.add_heading("1. 資料支持圖", level=1)
    add_flow(doc, [
        ("民間人口P", "T27／POPAGE年齡邊際"),
        ("勞動力LF", "T28年齡邊際"),
        ("就業E／失業U", "T32＋T36機器可讀檔"),
        ("邊界拆分", "PCLM／Sprague；同組保持"),
        ("指標", "LFPR=(E+U)/P；EPR=E/P"),
        ("查核", "25–29原生；P≥LF≥E"),
    ])
    doc.add_heading("2. 生成邏輯", level=1)
    add_steps(doc, [
        ("統一期別與地區", "P、E、U必須來自同一調查年與相同地區定義。"),
        ("欄位標準化", "千人維持小數；缺值、符號與四捨五入標誌另存，不自動補零。"),
        ("邊界處理", "分別拆P、LF、E、U之15–24及35–39；25–29、30–34直接使用。"),
        ("一致性約束", "每歲P≥E+U≥E≥0；PCLM初值若違反，使用受約束校準並記錄調整量。"),
        ("計算", "LF=E+U；LFPR=LF/P×100；EPR=E/P×100。"),
        ("輸出", "每項帶evidence_class、method_code、interval與human_review_id。"),
    ])
    add_formula(doc, "LFPR(18–35)=Σ(E+U)/ΣP×100； EPR(18–35)=ΣE/ΣP×100", "分子分母必須同源、同期、同地區；戶籍人口占比另列，不合併。")
    doc.add_heading("3. 已執行25–29驗證（114年新北市，千人）", level=1)
    add_table(doc, ["輸入／指標", "數值", "計算", "結果"], [
        ["民間人口P（表27）", "246", "—", "246"],
        ["勞動力LF（表28）", "230", "—", "230"],
        ["就業E（表32）", "215", "—", "215"],
        ["失業U（表36）", "15", "215+15", "LF=230"],
        ["勞參率LFPR（QA）", "—", "230/246×100", "93.50%"],
        ["就業人口比率EPR（QA）", "—", "215/246×100", "87.40%"],
    ], [5.3, 3.2, 5.8, 3.7])
    add_callout(doc, "表27／28／32到底可做什麼", "可直接取得新北市各年齡組的P、LF、E及全體教育邊際，因此可算年齡別勞參率、就業人口比率及作IPF邊際；但不能直接得出『25–29歲大專以上人數』，因為年齡與教育沒有交叉。", "info")
    doc.add_heading("4. AWS生成流程", level=1)
    add_bullets(doc, [
        "Glue Job A：XLSX/XML→長表，欄位含survey_year/region/age_band/measure/value_thousand。",
        "Glue Job B：PCLM拆分＋Sprague敏感度，輸出single_age_estimates與method_comparison。",
        "Athena View：同源聚合後計算LF、LFPR、EPR；dbt/SQL測試P≥LF≥E與分母非零。",
        "Agent回答時同時回傳公式、來源檔、統計期、估計標籤與裁示狀態。",
    ])
    doc.add_heading("5. 人工查核", level=1)
    add_table(doc, ["ID", "問題", "建議"], [
        ["HR-01", "戶籍人口與民間人口定義衝突", "正式LFPR固定使用DGBAS P"],
        ["AGE-01", "PCLM/Sprague差異", "超過門檻即不發布點估計"],
        ["TIME-01", "年度不一致", "使用共同期或明示時間差"],
    ], [3.0, 7.5, 7.5])
    add_sources(doc, [
        ("DGBAS-HR-POPAGE", "15歲以上民間人口之教育程度與年齡", "https://data.gov.tw/dataset/33443"),
        ("DGBAS-HR-T28", "勞動力之教育程度與年齡", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078"),
        ("DGBAS-HR-EMPAGE", "就業者之教育程度與年齡", "https://data.gov.tw/dataset/34112"),
        ("DGBAS-HR-UNEMPAGE", "失業者之教育程度與年齡", "https://data.gov.tw/dataset/34116"),
    ])
    out = PACKAGE / "03_勞動力與就業" / f"03_勞動力與就業_處理方法與驗證範例_{VERSION}.docx"
    doc.save(out)
    return out


def build_education() -> Path:
    doc = new_doc("DOC-04", "教育程度：處理方法與驗證範例", "年齡×教育矩陣｜PCLM初值＋IPF邊際校準｜行政與調查兩條產品線", "條件式估計")
    add_callout(doc, "查核結論", "MOI-EDU5Y有新北市年齡×教育行政交叉，可支援戶籍／現住教育產品；表27與表32只有兩組邊際；表50只有臺灣地區。三種資料的母體、結構與地理不可混稱。", "warn")
    doc.add_heading("1. 資料支持圖", level=1)
    add_flow(doc, [
        ("戶籍交叉真值", "MOI-EDU5Y：五歲年齡×教育×性別×村里"),
        ("單一年齡邊際", "MOI-POP1Y：各歲×性別"),
        ("邊界估計", "PCLM拆18、19、35；Sprague敏感度"),
        ("IPF校準", "保持五歲組教育總量與單歲人口邊際"),
        ("輸出", "新北18–35戶籍教育MODEL_ESTIMATE"),
    ])
    doc.add_heading("2. 各資料能回答什麼", level=1)
    add_table(doc, ["產品", "來源", "輸出類別", "用途", "限制"], [
        ["戶籍／現住教育結構", "MOI-EDU5Y＋MOI-POP1Y", "行政精確五歲組＋模型邊界", "新北人口教育政策", "18、19、35需估計"],
        ["民間人口／就業者邊際", "DGBAS T27／T32", "官方調查年齡邊際、教育邊際", "P/E分母、總體教育、IPF約束", "不能回答年齡×教育"],
        ["臺灣就業者交叉", "DGBAS T50", "臺灣地區官方調查交叉", "全國描述／新北模型種子", "不是新北市官方值"],
        ["環境趨勢", "NTPC-EDU15P", "官方發布值", "新北總體背景", "15歲以上非18–35"],
    ], [4.1, 4.6, 4.5, 3.0, 2.8])
    add_callout(doc, "表27與表32的實際用途", "每一地區列同時列出『全體按教育分』與『全體按年齡分』。可得新北市25–29歲P=246千人、E=215千人及新北全體教育結構；沒有『25–29歲×大專以上』儲存格，不能直接交叉解讀。", "info")
    doc.add_heading("3. 戶籍教育的PCLM＋IPF計算", level=1)
    add_steps(doc, [
        ("類別標準化", "教育分為國中及以下、高中職、大專及以上；細項另留，不強行合併不同分類版本。"),
        ("PCLM初值", "對每一教育類別的五歲組計數做Poisson平滑，得到單一年齡初始x⁰[a,e]。"),
        ("列邊際", "以MOI-POP1Y之單一年齡總人口P[a]校準每一列。"),
        ("欄邊際", "在每個官方五歲組g內，使Σa∈g x[a,e]等於MOI-EDU5Y官方教育人數E[g,e]。"),
        ("迭代", "交替列縮放與欄縮放，直到最大相對邊際誤差<1e-8或達上限。"),
        ("敏感度", "以Sprague初值再跑IPF；比較18–35教育占比。"),
    ])
    add_formula(doc, "Row: x′[a,e]=x[a,e]×P[a]/Σe x[a,e]； Column: x″[a,e]=x′[a,e]×E[g,e]/Σa∈g x′[a,e]", "在每個五歲組內交替縮放；IPF保留非負值並精確重現給定邊際。")
    doc.add_heading("4. 勞動市場教育若要推估新北年齡×教育", level=1)
    add_steps(doc, [
        ("先選產品", "明確指定民間人口或就業者，不與戶籍教育混合。"),
        ("列欄邊際", "新北T27或T32提供年齡邊際與教育邊際。"),
        ("種子矩陣", "T50只能提供臺灣地區年齡×教育關聯形狀，或改用可取得之新北微資料／交叉表。"),
        ("IPF", "用新北邊際校準種子；輸出為MODEL_ESTIMATE，不是官方新北交叉值。"),
        ("敏感度", "至少比較全國種子、北部種子、獨立種子；差異超門檻即不發布細分。"),
    ])
    doc.add_heading("5. 可重算範例（單次迭代示意，教學值）", level=1)
    add_table(doc, ["步驟", "輸入", "倍率", "30歲×大專以上"], [
        ["PCLM初值", "x⁰=120；30歲列總和=200", "—", "120.0"],
        ["列校準", "30歲官方人口P=210", "210/200=1.05", "126.0"],
        ["欄校準", "30–34大專欄目標570；目前588", "570/588=0.9694", "122.1"],
        ["繼續迭代", "再做所有列與欄", "至誤差<1e-8", "收斂值"],
    ], [4.0, 6.0, 4.0, 4.0])
    doc.add_heading("6. 驗證與發布", level=1)
    add_table(doc, ["檢查", "通過條件", "失敗處理"], [
        ["列邊際", "每歲教育合計＝MOI單歲人口", "阻擋"],
        ["欄邊際", "每五歲組各教育合計＝官方值", "阻擋"],
        ["非負與小細胞", "x≥0；低於門檻不細分發布", "合併類別／區域"],
        ["方法敏感度", "PCLM與Sprague占比差≤5%", "超標人工查核"],
        ["產品線", "行政教育與就業者教育不混稱", "修正指標名稱"],
        ["地理層級", "T50只標臺灣地區；新北IPF標MODEL_ESTIMATE", "違反即阻擋"],
    ], [4.3, 8.0, 5.7])
    add_sources(doc, [
        ("MOI-EDU5Y", "15歲以上現住人口按教育與年齡", "https://data.gov.tw/dataset/117988"),
        ("MOI-POP1Y", "村里戶數、單一年齡人口", "https://data.gov.tw/dataset/77132"),
        ("DGBAS-HR-POPAGE", "15歲以上民間人口之教育程度與年齡", "https://data.gov.tw/dataset/33443"),
        ("DGBAS-HR-EMPAGE", "就業者之教育程度與年齡", "https://data.gov.tw/dataset/34112"),
        ("DGBAS-HR-T50-NATIONAL", "表50：臺灣地區就業者年齡×教育", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078"),
    ])
    out = PACKAGE / "04_教育程度" / f"04_教育程度_處理方法與驗證範例_{VERSION}.docx"
    doc.save(out)
    return out


def build_salary_mean() -> Path:
    doc = new_doc("DOC-05", "薪資平均數：處理方法與驗證範例", "25–29官方原生先驗證｜18–35校準加權模型｜工作地與居住地分離", "模型估計／需裁示")
    add_callout(doc, "可發布範圍", "新北市工作場所25–29歲平均薪資可直接引用官方表；18–35需拆分未滿25與30–39並取得權數，只能標MODEL_ESTIMATE。", "warn")
    doc.add_heading("1. 資料支持圖", level=1)
    add_flow(doc, [
        ("官方母表", "STAT-WAGE-LOC：工作地×寬年齡組平均"),
        ("年齡權數", "BLI-INS-AGE-LOC"),
        ("薪資形狀", "BLI提繳工資＋MOF年齡薪資"),
        ("校準", "寬組加權平均回到官方母表"),
        ("18–35", "權數加權＋區間＋MODEL_ESTIMATE"),
    ])
    doc.add_heading("2. 資料角色與限制", level=1)
    add_table(doc, ["來源", "角色", "可直接當什麼", "不可當什麼"], [
        ["STAT-WAGE-LOC", "官方目標與25–29值", "新北工作地全年總薪資平均", "居住新北青年薪資"],
        ["BLI-INS-AGE-LOC", "年齡×地區人數形狀", "模型權數候選", "正式受僱人數權數的等價替代"],
        ["BLI-PENSION-WAGE-AGE", "年齡薪資曲線", "寬組內相對形狀", "全年總薪資"],
        ["MOF-SALARY-AGE", "全國18–24/30–34/35–39曲線", "敏感度／校準輔助", "新北官方薪資"],
    ], [4.7, 4.4, 4.5, 4.4])
    doc.add_heading("3. 生成邏輯", level=1)
    add_steps(doc, [
        ("25–29驗證", "直接讀新北市列與25–29欄，核對平均／中位欄位及年度。"),
        ("母體對齊", "明示本國籍全時受僱員工與工作場所地理；BLI權數先做覆蓋率與結構差異檢查。"),
        ("寬組形狀", "用BLI／MOF取得18–24、30–34、35歲相對薪資曲線；不得把代理絕對值直接搬入。"),
        ("組內校準", "對未滿25與30–39各自乘校準係數，使完整寬組的權數平均精確回到STAT-WAGE-LOC官方平均。"),
        ("目標聚合", "以18–24、25–29、30–34、35歲受僱權數計算18–35加權平均。"),
        ("不確定性", "替換權數來源、PCLM/Sprague邊界及薪資曲線，形成情境區間；不報假精確小數。"),
    ])
    add_formula(doc, "Mean(18–35)=Σg w[g]·μ*[g] / Σg w[g]；且 Σk∈G w[k]·μ*[k]/Σk∈G w[k]=μ_official[G]", "g為18–24、25–29、30–34、35；μ*為經寬組校準後薪資。")
    doc.add_heading("4. 可重算範例（教學值）", level=1)
    add_table(doc, ["目標段", "權數w（千人）", "校準後年薪μ*（千元）", "w×μ*"], [
        ["18–24", "120", "425", "51,000"],
        ["25–29（官方原生）", "200", "560", "112,000"],
        ["30–34", "210", "672", "141,120"],
        ["35歲", "40", "684", "27,360"],
        ["合計", "570", "—", "331,480"],
    ], [4.7, 4.3, 5.2, 3.8])
    add_formula(doc, "331,480 / 570 = 581.54（千元／年）", "此為MODEL_ESTIMATE教學值；正式結果需附校準明細、權數適配檢查與區間。")
    doc.add_heading("5. QA與人工裁示", level=1)
    add_table(doc, ["ID／檢查", "通過條件", "處置"], [
        ["SAL-01 地理", "標題明示『工作場所位於新北』", "如需居住地，另申請官方客製表"],
        ["SAL-02 權數", "BLI與薪資母體結構差異可接受", "否則25–29以外不發布"],
        ["組內校準", "完整寬組可重現官方平均", "不通過即阻擋"],
        ["穩健性", "替代情境差異在預設門檻內", "超標只報區間或場景"],
    ], [4.3, 8.1, 5.6])
    add_sources(doc, [
        ("STAT-WAGE-LOC", "縣市×年齡全年總薪資表", "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642"),
        ("BLI-INS-AGE-LOC", "勞工保險人數（年齡、地區、性別）", "https://data.gov.tw/dataset/162821"),
        ("BLI-PENSION-WAGE-AGE", "勞退平均提繳工資－年齡", "https://data.gov.tw/dataset/46103"),
        ("MOF-SALARY-AGE", "薪資所得者按年齡級距", "https://service.mof.gov.tw/public/Data/statistic/gender/yearbook/113/a2060.pdf"),
    ])
    out = PACKAGE / "05_薪資平均數" / f"05_薪資平均數_處理方法與驗證範例_{VERSION}.docx"
    doc.save(out)
    return out


def build_salary_median() -> Path:
    doc = new_doc("DOC-06", "薪資中位數與分布：處理方法與驗證範例", "中位數必須由分布定位｜缺年齡×薪資級距則NO_ESTIMATE｜禁止加權中位數", "目前不可正式發布18–35")
    add_callout(doc, "停止條件", "目前BLI地區×薪資級距缺年齡交叉；STAT-WAGE-LOC的寬組中位數也不能加權成18–35中位數。因此18–35新北薪資中位數維持HOLD。", "stop")
    doc.add_heading("1. 資料支持圖與缺口", level=1)
    add_flow(doc, [
        ("官方寬組中位數", "STAT-WAGE-LOC"),
        ("地區薪資分布", "BLI-WAGEGRADE-LOC（無年齡）"),
        ("必要交叉", "年齡×地區×薪資級距×權數"),
        ("CDF定位", "累積權數跨50%＋組內插值"),
        ("發布閘門", "目前缺必要交叉 → NO_ESTIMATE"),
    ])
    doc.add_heading("2. 為何不能加權各組中位數", level=1)
    add_bullets(doc, [
        "中位數是累積分布的50百分位，不是線性統計量；兩組中位數與人數不足以決定合併中位數。",
        "即使25–29與30–39各有中位數，也不知道薪資排序交疊及18、19、35歲所在位置。",
        "可加權的是總額／平均數；中位數必須使用個體資料或足夠細的薪資級距分布與權數。",
    ])
    doc.add_heading("3. 有足夠資料時的正式流程", level=1)
    add_steps(doc, [
        ("取得分布", "最低需求為新北×單歲／可拆五歲組×薪資級距×人數；最好是去識別微資料與樣本權數。"),
        ("年齡轉換", "若年齡為五歲組，在每一薪資級距內用PCLM拆18、19、35並保持級距總量；或以IPF同時校準年齡與薪資邊際。"),
        ("建立CDF", "按薪資級距由低到高累加18–35權數。"),
        ("定位50%", "找到第一個累積權數≥N/2的級距。"),
        ("組內插值", "若只有區間資料，假設組內均勻或以Pareto／lognormal敏感度；輸出區間而非假精確值。"),
        ("驗證", "25–29聚合結果回到官方中位數容許範圍，並檢查不同組內假設。"),
    ])
    add_formula(doc, "Median ≈ L + [(0.5N − C_prev)/f_class] × h", "L為中位數級距下界；C_prev為前一級距累積權數；f_class為中位級距權數；h為級距寬。")
    doc.add_heading("4. CDF可重算範例（投保薪資代理，非全年總薪資）", level=1)
    add_table(doc, ["月薪級距（千元）", "18–35權數", "累積", "是否跨N/2=285"], [
        ["0–30", "80", "80", "否"],
        ["30–40", "140", "220", "否"],
        ["40–50", "180", "400", "是"],
        ["50–70", "120", "520", "—"],
        ["70以上", "50", "570", "—"],
    ], [5.0, 4.0, 4.0, 5.0])
    add_formula(doc, "40 + [(285−220)/180]×10 = 43.61（千元／月）", "此例僅示範級距中位數算法，因輸入是投保薪資代理且實際資料缺年齡交叉，不得當作18–35全年總薪資中位數。")
    doc.add_heading("5. 目前資料充足度", level=1)
    add_table(doc, ["輸出", "目前可做", "證據標籤", "缺口"], [
        ["新北25–29官方中位數", "是", "OFFICIAL_ADMIN_LINKED_STATISTIC", "需確認工作地定義"],
        ["新北18–35全年薪資中位數", "否", "NO_ESTIMATE / HOLD", "缺年齡×全年薪資分布與權數"],
        ["新北整體投保薪資級距中位數", "可作代理", "PROXY_ONLY", "無年齡，且投保薪資≠全年薪資"],
    ], [5.0, 3.3, 5.6, 4.1])
    add_sources(doc, [
        ("STAT-WAGE-LOC", "縣市×年齡全年總薪資表", "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642"),
        ("BLI-WAGEGRADE-LOC", "勞保地區×投保薪資級距", "https://data.gov.tw/dataset/119861"),
        ("DGBAS-MEDIAN-METHOD", "薪資中位數編製方法", "https://www.stat.gov.tw/public/Data/61111105359N4GQ42NS.pdf"),
    ])
    out = PACKAGE / "06_薪資中位數與分布" / f"06_薪資中位數與分布_處理方法與驗證範例_{VERSION}.docx"
    doc.save(out)
    return out


def build_integration() -> Path:
    doc = new_doc("DOC-07", "整合、查核與 AWS／Kiro 生成流程", "資料契約｜欄位映射｜衝突規則｜S3–Glue–Athena–AgentCore–Dashboard", "系統落地 SOP")
    add_callout(doc, "治理原則", "任何衍生列若缺source_alias、source_period、geography_role、evidence_class、method_code、sha256或publish_status之一，不得進入儀表板正式層。", "warn")
    doc.add_heading("1. 端到端資料血緣圖", level=1)
    add_flow(doc, [
        ("探測／下載", "EventBridge＋官方URL／API＋source_period"),
        ("S3 raw", "不可變原始檔／隔離失敗批次"),
        ("Glue標準化", "解壓、長表、欄位／定義契約"),
        ("統計層", "DIRECT／PCLM／IPF／比率／CDF"),
        ("Athena＋Agent", "查核視圖、問答、儀表板、證據回傳"),
    ])
    doc.add_heading("2. 統一資料契約", level=1)
    add_table(doc, ["欄位群", "必要欄位", "規則"], [
        ["識別", "record_id, metric_id, run_id", "穩定、不可重複"],
        ["維度", "source_period, retrieved_at, geography_role, age_band, sex, education", "資料期與抓取日分開；未知值明示UNKNOWN"],
        ["數值", "value, unit, numerator, denominator", "比率保留分子分母"],
        ["證據", "source_alias, source_url, local_snapshot, sha256", "可回到原始檔"],
        ["方法", "method_code, formula, parameters, software_version", "可重算"],
        ["不確定性", "low, high, method_sensitivity", "模型估計必填"],
        ["治理", "definition_conflict, human_review_id, publish_status", "未裁示為HOLD"],
    ], [3.0, 7.4, 7.6])
    doc.add_heading("3. 衝突處理順序", level=1)
    add_steps(doc, [
        ("先辨識", "區分概念衝突（戶籍/民間）、地理衝突（工作/居住）、期別衝突、單位衝突、分類衝突。"),
        ("不覆蓋", "保留各來源原值與原定義；禁止以『較新』為由直接覆蓋不同概念。"),
        ("可轉換才轉", "單位、年齡區間可依規則轉換；母體或地理角色不同則平行呈現。"),
        ("分配證據類別", "官方行政、官方調查、模型、代理分層。"),
        ("人工裁示", "影響政策解讀或發布者送human_review_checklist。"),
    ])
    doc.add_heading("4. 指標生成DAG與算例", level=1)
    add_table(doc, ["輸入節點", "方法節點", "輸出", "驗收"], [
        ["MOI單歲人口", "DIRECT_SUM", "18–35戶籍人口", "分組和一致"],
        ["DGBAS P/LF/E/U年齡組", "PCLM＋COUNT_RECOMPUTE", "LFPR/EPR/UR", "P≥LF≥E；25–29官方率6.4%"],
        ["MOI教育五歲組＋單歲人口", "PCLM＋IPF", "18–35教育結構", "列欄邊際重現"],
        ["STAT薪資＋BLI/MOF輔助", "CALIBRATED_WEIGHTED_MEAN", "18–35平均薪資模型", "寬組回到官方值"],
        ["年齡×薪資分布", "CDF_MEDIAN", "18–35中位數", "目前資料缺口→HOLD"],
    ], [5.0, 5.0, 4.3, 3.7])
    doc.add_heading("5. OpenAPI本地執行與定期更新", level=1)
    add_steps(doc, [
        ("選擇期別", "人口API參數為民國年月YYYMM；共同期用11412，最新月須先確認機關已發布。"),
        ("執行程式", "在07_整合與查核/automation執行run_openapi_refresh.py --period 11507 --sources MOI-POP1Y,NTPC-POP。"),
        ("分頁規則", "MOI依totalPage讀1…N；NTPC依page/size讀到短頁，並防重複頁。"),
        ("失敗關閉", "逾時、非JSON、列數不足、schema drift或來源期倒退，均寫FAILED manifest且不覆蓋前版。"),
        ("變更判斷", "比較source_period與SHA-256；只有來源期或內容改變才更新curated與儀表板。"),
        ("留存", "raw/run_id、manifest、雜湊、程式版、參數與QA結果一併保留。"),
    ])
    add_callout(doc, "即時的正確定義", "系統可以定期自動抓取，但資料是否變新由提供機關的發布頻率決定。介面顯示『資料期』與『最後檢查時間』兩欄，不把擷取時間當統計時間。", "warn")
    doc.add_heading("6. AWS實作步驟", level=1)
    add_steps(doc, [
        ("S3", "建立raw/curated/quality/quarantine四前綴；啟用版本、SSE-KMS、Block Public Access與生命週期。"),
        ("Step Functions／EventBridge", "人口月排程、NTPC與DGBAS每月探測年度更新；下載、雜湊、schema、QA與發布每步寫run_id。"),
        ("Glue Data Catalog", "raw表維持來源欄位；curated表使用統一契約，按year/metric/geography分區。"),
        ("Glue／Lambda", "小檔用Lambda；1.2GB教育資料與PCLM/IPF用Glue Spark；失敗批次移quarantine。"),
        ("Athena", "建立official_only、model_estimates、human_review_pending、dashboard_ready視圖。"),
        ("Bedrock AgentCore", "知識庫放Word與清冊；工具只查Athena白名單視圖；回覆強制帶來源、方法、統計期與證據標籤。"),
        ("儀表板", "圖表篩選年齡組、期別、地理角色、證據類別；模型值以不同線型／色彩與區間呈現。"),
    ])
    doc.add_heading("7. Kiro規格與提示範例", level=1)
    add_callout(doc, "Kiro spec範例", "『讀取source_manifest.csv、openapi_registry.csv與method_codebook.csv；以EventBridge＋Step Functions建立來源別排程。不得修改raw；source_period與retrieved_at分開；分頁需fail closed；比率由分子分母重算；MODEL_ESTIMATE須輸出low/high；缺裁示時HOLD。』", "info")
    add_table(doc, ["Kiro產物", "檔案建議", "驗收"], [
        ["需求", ".kiro/specs/youth-data/requirements.md", "逐項對應命題與人工作業"],
        ["設計", "design.md", "包含資料DAG、IAM、錯誤與成本"],
        ["任務", "tasks.md", "下載→清理→估計→QA→部署可分批回復"],
        ["IaC", "aws/cdk或CloudFormation", "cdk synth／變更集無公開權限"],
        ["測試", "tests/data_contract與golden_cases", "25–29、IPF邊際、失業率回算通過"],
    ], [3.0, 7.5, 7.5])
    doc.add_heading("8. 查詢輸出範例", level=1)
    add_formula(doc, "問：新北25–29歲失業率？ → 114年官方值6.4%（表37）；QA：U=15、LF=230千人，四捨五入回算6.52%。問18–35？ → 尚未執行邊界模型，回MODEL_READY_NOT_EXECUTED。", "Agent不得回傳舊教學值；正式率、QA值與尚未執行的模型狀態必須分開。")
    doc.add_heading("9. 監控與稽核", level=1)
    add_bullets(doc, [
        "CloudWatch：下載成功率、schema drift、IPF收斂、方法差異、HOLD筆數、Athena掃描量與成本。",
        "CloudTrail：下載角色、KMS、S3與Athena查詢稽核；Least privilege，Agent無raw寫入權。",
        "每次發布保存run_manifest、原始檔SHA-256、程式版本、參數、查核結果與裁示人／日期。",
        "CloudWatch另外監控source_period age、retrieved_at age、重複頁、短頁、來源期倒退與附件URL變更。",
    ])
    add_sources(doc, [
        ("AWS Well-Architected", "安全、可靠性、效能、成本原則已轉成上述控制", "https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html"),
        ("data.gov.tw", "政府資料開放平臺", "https://data.gov.tw/"),
        ("NTPC OpenAPI", "新北市政府資料開放平臺", "https://data.ntpc.gov.tw/openapi/"),
    ])
    out = PACKAGE / "07_整合與查核" / f"07_整合查核與AWS_Kiro流程_{VERSION}.docx"
    doc.save(out)
    return out


def write_hashes() -> None:
    out = PACKAGE / "00_總覽與治理" / "file_hashes_sha256.csv"
    rows = []
    for path in sorted(PACKAGE.rglob("*")):
        if not path.is_file() or path == out or any(part.startswith("_qa") for part in path.parts):
            continue
        digest = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)
        rows.append([path.relative_to(PACKAGE).as_posix(), path.stat().st_size, digest.hexdigest()])
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["relative_path", "bytes", "sha256"])
        w.writerows(rows)


def main() -> None:
    PACKAGE.mkdir(parents=True, exist_ok=True)
    write_source_manifest()
    write_openapi_registry()
    write_method_codebook()
    write_review_checklist()
    write_corrected_integration_v15()
    write_readme()
    outputs = [
        build_overview(),
        build_population(),
        build_unemployment(),
        build_labor(),
        build_education(),
        build_salary_mean(),
        build_salary_median(),
        build_integration(),
    ]
    write_hashes()
    print("\n".join(str(p) for p in outputs))


if __name__ == "__main__":
    main()

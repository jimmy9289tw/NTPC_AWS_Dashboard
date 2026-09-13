from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


def resolve_project_root() -> Path:
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "config" / "g5-refresh-policy.json").is_file() and (candidate / "scripts").is_dir():
            return candidate
    raise RuntimeError("Cannot locate NtpcYouthAI project root")


PROJECT = resolve_project_root()
DEFAULT_PACKAGE = (
    PROJECT
    / "deliverables"
    / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826"
)
PUBLISH_DIR = DEFAULT_PACKAGE / "09_發布資料包"
REGISTERED_CSV = PUBLISH_DIR / "01_戶籍人口母體_長格式.csv"
LABOR_CSV = PUBLISH_DIR / "02_民間人口與勞動市場母體_長格式.csv"
WAGE_CSV = PUBLISH_DIR / "03_受僱員工薪資母體_長格式.csv"
QA_JSON = DEFAULT_PACKAGE / "08_人工查核與異常處理" / "machine_qa" / "published_metrics_validation_detailed.json"
CATALOG_JSON = PUBLISH_DIR / "data_catalog.json"
REFRESH_POLICY = PROJECT / "config" / "g5-refresh-policy.json"

TODAY_ROC = 115
VERSION = "G5 V3.2"
DISPLAY_YEARS = "110–114年"

NAVY = RGBColor(15, 23, 42)
BLUE = RGBColor(3, 105, 161)
HEADING_BLUE = RGBColor(46, 116, 181)
DARK_BLUE = RGBColor(31, 77, 120)
MUTED = RGBColor(82, 95, 112)
WHITE = RGBColor(255, 255, 255)
RISK = RGBColor(155, 28, 28)
GOLD = RGBColor(122, 90, 0)
LIGHT_GRAY = "F2F4F7"
LIGHT_BLUE = "E8EEF5"
LIGHT_GOLD = "FFF8E1"
LIGHT_RED = "FDECEC"
LIGHT_GREEN = "EAF7EF"


def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def load_inputs(package: Path) -> dict:
    publish = package / "09_發布資料包"
    return {
        "registered": read_csv(publish / "01_戶籍人口母體_長格式.csv"),
        "labor": read_csv(publish / "02_民間人口與勞動市場母體_長格式.csv"),
        "wage": read_csv(publish / "03_受僱員工薪資母體_長格式.csv"),
        "qa": json.loads(
            (package / "08_人工查核與異常處理" / "machine_qa" / "published_metrics_validation_detailed.json").read_text(encoding="utf-8")
        ),
        "catalog": json.loads((publish / "data_catalog.json").read_text(encoding="utf-8")),
        "refresh": json.loads(REFRESH_POLICY.read_text(encoding="utf-8")),
    }


def set_run_font(run, *, size: float | None = None, bold: bool | None = None, color: RGBColor | None = None, italic: bool | None = None):
    run.font.name = "Calibri"
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), "Calibri")
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), "Calibri")
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "Microsoft JhengHei")
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color
    if italic is not None:
        run.italic = italic


def set_cell_fill(cell, fill: str):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_width(cell, width_dxa: int):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(width_dxa))
    tc_w.set(qn("w:type"), "dxa")


def set_table_geometry(table, widths_dxa: list[int]):
    total = sum(widths_dxa)
    if total != 9360:
        raise ValueError(f"Table widths must sum to 9360 DXA, got {total}")
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), "9360")
    tbl_w.set(qn("w:type"), "dxa")
    tbl_ind = tbl_pr.find(qn("w:tblInd"))
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), "120")
    tbl_ind.set(qn("w:type"), "dxa")
    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths_dxa:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(width))
        grid.append(col)
    for row in table.rows:
        for index, cell in enumerate(row.cells):
            set_cell_width(cell, widths_dxa[index])


def mark_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    repeat = OxmlElement("w:tblHeader")
    repeat.set(qn("w:val"), "true")
    tr_pr.append(repeat)


def prevent_row_split(row):
    """Keep a table row intact so a short table never leaves a fragment on another page."""
    tr_pr = row._tr.get_or_add_trPr()
    if tr_pr.find(qn("w:cantSplit")) is None:
        tr_pr.append(OxmlElement("w:cantSplit"))


def set_cell_margins(cell, top=80, start=120, bottom=80, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def add_table(doc: Document, headers: list[str], rows: list[list[str]], widths_dxa: list[int], *, font_size=9.2):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    set_table_geometry(table, widths_dxa)
    mark_table_header(table.rows[0])
    for index, header in enumerate(headers):
        cell = table.rows[0].cells[index]
        set_cell_fill(cell, LIGHT_GRAY)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_margins(cell)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(str(header))
        set_run_font(run, size=font_size, bold=True, color=NAVY)
    for row_values in rows:
        cells = table.add_row().cells
        for index, value in enumerate(row_values):
            cell = cells[index]
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP
            set_cell_margins(cell)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.05
            run = p.add_run(str(value))
            set_run_font(run, size=font_size, color=NAVY)
    # Every table in this package is shorter than one page.  Chaining its rows
    # avoids a header or final row becoming an isolated page fragment.
    for row_index, row in enumerate(table.rows):
        prevent_row_split(row)
        if row_index < len(table.rows) - 1:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    paragraph.paragraph_format.keep_with_next = True
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return table


def add_callout(doc: Document, label: str, text: str, kind: str = "info"):
    fills = {"info": LIGHT_BLUE, "ok": LIGHT_GREEN, "warn": LIGHT_GOLD, "risk": LIGHT_RED}
    colors = {"info": DARK_BLUE, "ok": RGBColor(22, 101, 52), "warn": GOLD, "risk": RISK}
    table = doc.add_table(rows=1, cols=1)
    table.style = "Table Grid"
    set_table_geometry(table, [9360])
    cell = table.cell(0, 0)
    set_cell_fill(cell, fills[kind])
    set_cell_margins(cell, top=120, bottom=120)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    lead = p.add_run(f"{label}｜")
    set_run_font(lead, size=10.5, bold=True, color=colors[kind])
    body = p.add_run(text)
    set_run_font(body, size=10.5, color=NAVY)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_para(doc: Document, text: str = "", *, bold=False, italic=False, color=NAVY, align=None, after=6, size=11):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.line_spacing = 1.1
    run = p.add_run(text)
    set_run_font(run, size=size, bold=bold, italic=italic, color=color)
    return p


def add_steps(doc: Document, steps: list[str]):
    for step in steps:
        p = doc.add_paragraph(style="List Number")
        p.paragraph_format.left_indent = Inches(0.5)
        p.paragraph_format.first_line_indent = Inches(-0.25)
        p.paragraph_format.space_after = Pt(8)
        p.paragraph_format.line_spacing = 1.167
        run = p.add_run(step)
        set_run_font(run, size=11, color=NAVY)


def add_bullets(doc: Document, items: list[str]):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.left_indent = Inches(0.5)
        p.paragraph_format.first_line_indent = Inches(-0.25)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.line_spacing = 1.1
        run = p.add_run(item)
        set_run_font(run, size=11, color=NAVY)


def add_hyperlink(paragraph, text: str, url: str):
    part = paragraph.part
    relationship_id = part.relate_to(url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True)
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), relationship_id)
    run = OxmlElement("w:r")
    properties = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "0369A1")
    properties.append(color)
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    properties.append(underline)
    run.append(properties)
    text_node = OxmlElement("w:t")
    text_node.text = text
    run.append(text_node)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)
    return hyperlink


def add_source_link(doc: Document, label: str, url: str, note: str):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    add_hyperlink(p, label, url)
    run = p.add_run(f"：{note}")
    set_run_font(run, size=10.5, color=NAVY)
    return p


def add_page_number(paragraph):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instr, separate, end])
    set_run_font(run, size=9, color=MUTED)


def configure_styles(doc: Document):
    section = doc.sections[0]
    section.orientation = WD_ORIENT.PORTRAIT
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.right_margin = Inches(1)
    section.header_distance = Inches(0.492)
    section.footer_distance = Inches(0.492)
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft JhengHei")
    normal.font.size = Pt(11)
    normal.font.color.rgb = NAVY
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.1
    style_tokens = {
        "Heading 1": (16, HEADING_BLUE, 16, 8),
        "Heading 2": (13, HEADING_BLUE, 12, 6),
        "Heading 3": (12, DARK_BLUE, 8, 4),
    }
    for style_name, (size, color, before, after) in style_tokens.items():
        style = doc.styles[style_name]
        style.font.name = "Calibri"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft JhengHei")
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = color
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True
    for style_name in ("List Bullet", "List Number"):
        style = doc.styles[style_name]
        style.font.name = "Calibri"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft JhengHei")
        style.font.size = Pt(11)
        style.font.color.rgb = NAVY
    header = section.header
    hp = header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    hp.paragraph_format.space_after = Pt(0)
    run = hp.add_run(f"新北市青年資料研究｜{VERSION}")
    set_run_font(run, size=9, bold=True, color=MUTED)
    footer = section.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    label = fp.add_run("研究與查核用｜第 ")
    set_run_font(label, size=9, color=MUTED)
    add_page_number(fp)
    tail = fp.add_run(" 頁")
    set_run_font(tail, size=9, color=MUTED)


def new_doc(doc_id: str, title: str, subtitle: str, status: str = "已產製；待人工發布核准") -> Document:
    doc = Document()
    configure_styles(doc)
    add_para(doc, "研究方法與系統規格", bold=True, color=BLUE, after=2, size=10)
    add_para(doc, title, bold=True, color=NAVY, after=4, size=23)
    add_para(doc, subtitle, color=MUTED, after=14, size=13)
    add_table(
        doc,
        ["文件代號", "版本", "資料年度", "狀態"],
        [[doc_id, VERSION, DISPLAY_YEARS, status]],
        [1500, 1500, 1900, 4460],
        font_size=9.5,
    )
    return doc


def add_picture_with_alt(doc: Document, path: Path, alt_text: str, width=Inches(6.25)):
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run()
    run.add_picture(str(path), width=width)
    doc_pr = run._r.xpath(".//wp:docPr")
    if doc_pr:
        doc_pr[0].set("descr", alt_text)
        doc_pr[0].set("title", alt_text[:80])
    paragraph.paragraph_format.space_after = Pt(6)


def draw_flow(path: Path, title: str, nodes: list[tuple[str, str]], *, width=12, height=3.6):
    path.parent.mkdir(parents=True, exist_ok=True)
    image_width = int(width * 160)
    image_height = int(height * 160)
    image = Image.new("RGB", (image_width, image_height), "white")
    draw = ImageDraw.Draw(image)
    regular_font_path = Path(r"C:\Windows\Fonts\msjh.ttc")
    bold_font_path = Path(r"C:\Windows\Fonts\msjhbd.ttc")
    regular = ImageFont.truetype(str(regular_font_path), 24)
    bold = ImageFont.truetype(str(bold_font_path if bold_font_path.exists() else regular_font_path), 31)
    title_box = draw.textbbox((0, 0), title, font=bold)
    draw.text(((image_width - (title_box[2] - title_box[0])) / 2, 28), title, font=bold, fill="#0F172A")
    margin = 28
    arrow_space = 54
    usable = image_width - margin * 2 - arrow_space * (len(nodes) - 1)
    box_width = usable / len(nodes)
    box_height = 132
    top = 130
    for index, (label, color) in enumerate(nodes):
        left = margin + index * (box_width + arrow_space)
        right = left + box_width
        bottom = top + box_height
        draw.rounded_rectangle((left, top, right, bottom), radius=15, fill=color, outline="#334155", width=3)
        text_box = draw.multiline_textbbox((0, 0), label, font=regular, spacing=6, align="center")
        text_width = text_box[2] - text_box[0]
        text_height = text_box[3] - text_box[1]
        draw.multiline_text(((left + right - text_width) / 2, (top + bottom - text_height) / 2 - 3), label, font=regular, fill="#0F172A", spacing=6, align="center")
        if index < len(nodes) - 1:
            arrow_start = right + 8
            arrow_end = right + arrow_space - 8
            mid = (top + bottom) / 2
            draw.line((arrow_start, mid, arrow_end, mid), fill="#334155", width=4)
            draw.polygon([(arrow_end, mid), (arrow_end - 16, mid - 10), (arrow_end - 16, mid + 10)], fill="#334155")
    image.save(path, format="PNG", optimize=True)


def make_diagrams(package: Path) -> dict[str, Path]:
    assets = package / "00_總覽與治理" / "assets"
    diagrams = {
        "universes": assets / "three_universes.png",
        "registered": assets / "registered_pipeline.png",
        "daily": assets / "daily_refresh.png",
        "aws": assets / "aws_kiro_architecture.png",
        "chatbot": assets / "chatbot_guardrail.png",
    }
    draw_flow(
        diagrams["universes"],
        "三個母體各自計算、同頁並列、不互當分母",
        [("戶籍人口\n人口・教育・婚姻・性別", "#DBEAFE"), ("民間人口與勞動市場\nP・LF・E・U・各項率", "#DCFCE7"), ("受僱員工薪資\n平均數・中位數", "#FEF3C7")],
        width=10,
    )
    draw_flow(
        diagrams["registered"],
        "戶籍人口母體：18–35歲年齡轉換與階層校準",
        [("官方ZIP／人口API", "#DBEAFE"), ("類別標準化", "#E0E7FF"), ("全市PCLM\n產生單歲種子", "#EDE9FE"), ("各區IPF\n重現列欄邊際", "#DCFCE7"), ("29區加總\n形成全市", "#FEF3C7"), ("CSV＋QA＋人工Gate", "#FCE7F3")],
        width=14,
    )
    draw_flow(
        diagrams["daily"],
        "每日審視不是每日改值：來源變更才重算",
        [("09:15每日檢查", "#DBEAFE"), ("ETag／日期／大小／SHA-256", "#E0E7FF"), ("未變更\nNO_CHANGE", "#DCFCE7"), ("已變更\n保存不可變快照", "#FEF3C7"), ("驗證＋人工核准", "#FCE7F3"), ("原子切換資料目錄", "#DCFCE7")],
        width=14,
    )
    draw_flow(
        diagrams["aws"],
        "AWS＋Kiro：資料、儀表板與問答服務",
        [("官方來源", "#DBEAFE"), ("S3 raw\n不可變快照", "#E0E7FF"), ("Step Functions\nLambda／Glue", "#EDE9FE"), ("S3 curated\n三份CSV", "#DCFCE7"), ("Glue Catalog＋Athena", "#FEF3C7"), ("Dashboard API", "#DBEAFE"), ("Bedrock AgentCore\nChatBot", "#FCE7F3")],
        width=16,
    )
    draw_flow(
        diagrams["chatbot"],
        "ChatBot回覆前的治理鏈",
        [("使用者問題", "#DBEAFE"), ("辨識母體／年度／年齡／地理", "#E0E7FF"), ("允許清單查詢", "#EDE9FE"), ("查三份CSV／Athena", "#DCFCE7"), ("公式與來源查核", "#FEF3C7"), ("中文回答＋引用＋限制", "#FCE7F3")],
        width=14,
    )
    return diagrams


def value_rows(data: list[dict], *, year="114", geo="新北市", metric: str, age_bands=("18-24", "25-29", "30-35", "18-35"), category_dimension="NONE", sex="ALL"):
    selected = []
    for row in data:
        if row["roc_year"] != year or row["geography_name_zh"] != geo or row["metric_code"] != metric:
            continue
        if row["age_band"] not in age_bands or row["category_dimension_code"] != category_dimension or row["sex_code"] != sex:
            continue
        selected.append(row)
    return sorted(selected, key=lambda item: age_bands.index(item["age_band"]))


def format_value(value: str, unit: str) -> str:
    number = float(value)
    if unit == "人":
        return f"{number:,.0f}"
    if unit == "千人":
        return f"{number:,.2f}"
    if unit == "%":
        return f"{number:.2f}%"
    if unit == "萬元/年":
        return f"{number:.1f}萬元"
    return value


def add_standard_sources(doc: Document, aliases: list[str]):
    sources = {
        "POP": ("政府資料開放平臺｜村里戶數、單一年齡人口", "https://data.gov.tw/dataset/77132", "ODRP014分頁OpenAPI；每月更新。"),
        "EDU": ("政府資料開放平臺｜15歲以上現住人口按教育程度分", "https://data.gov.tw/dataset/117988", "ODRP053／年度ZIP；年齡×教育×性別×村里。"),
        "MAR": ("政府資料開放平臺｜15歲以上現住人口按婚姻狀況分", "https://data.gov.tw/dataset/117986", "ODRP052／年度ZIP；年齡×婚姻×性別×村里。"),
        "LAB": ("中華民國統計資訊網｜人力資源調查統計年報列表", "https://www.stat.gov.tw/News.aspx?n=4001", "各資料年須連到同年年報頁；表27／32／36為主要計算來源，表28作LF一致性QA。"),
        "WAGE": ("中華民國統計資訊網｜受僱員工全年總薪資統計", "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642", "表6工作場所縣市×年齡；平均數與中位數。"),
        "BLIAGE": ("政府資料開放平臺｜勞保投保單位、人數按地區、年齡組及性別統計", "https://data.gov.tw/dataset/162821", "110–114年；本案取新北市全體年齡人數作模型權數。"),
        "BLIPENSION": ("政府資料開放平臺｜勞工退休金提繳人數及平均提繳工資按年齡組統計", "https://data.gov.tw/dataset/46103", "110–114年；只作年齡薪資輪廓輔助，不等同全年總薪資。"),
        "NTPC": ("新北市政府資料開放平臺 OpenAPI", "https://data.ntpc.gov.tw/openapi/", "命題指定平臺；作來源介接與交叉查核。"),
        "OAS": ("新北市統計資料庫", "https://oas.bas.ntpc.gov.tw/DgbasWeb/Page/Default.aspx", "命題指定平臺；作官方統計表鏡像與人工查核。"),
        "MAP": ("新北市資料開放平臺｜新北市行政區域圖", "https://data.ntpc.gov.tw/datasets/214634ca-3c71-4fc8-8f46-faffe97f23ff", "29區地圖來源；只連結戶籍人口母體指標。"),
    }
    for index, alias in enumerate(aliases):
        label, url, note = sources[alias]
        paragraph = add_source_link(doc, label, url, note)
        paragraph.paragraph_format.keep_with_next = index < len(aliases) - 1


def add_v13_frame(
    doc: Document,
    *,
    conclusion: str,
    scope_rows: list[list[str]],
    source_rows: list[list[str]],
    formulas: list[list[str]],
    steps: list[str],
    validation_rows: list[list[str]],
    result_headers: list[str],
    result_rows: list[list[str]],
    visual_rows: list[list[str]],
    limitations: list[str],
    reproducible_files: list[str],
):
    doc.add_heading("1. 結論先行", level=1)
    add_callout(doc, "可用結論", conclusion, "ok")
    doc.add_heading("2. 研究問題、範圍與定義", level=1)
    add_table(doc, ["項目", "正式定義", "不可混用事項"], scope_rows, [1900, 3900, 3560])
    doc.add_heading("3. 資料來源、期間與更新頻率", level=1)
    add_table(doc, ["來源", "原生頻率", "本案使用期間", "每日審視規則"], source_rows, [2600, 1400, 1800, 3560])
    add_callout(doc, "滾動五年", "儀表板年份固定為『執行民國年−5』至『執行民國年−1』。民國115年顯示110–114；民國116年自動改為111–115。", "info")
    doc.add_heading("4. 欄位、公式與分母", level=1)
    add_table(doc, ["指標／符號", "公式", "分母或母體", "發布標示"], formulas, [1800, 2800, 2400, 2360])
    doc.add_heading("5. 年齡轉換與計算步驟", level=1)
    add_steps(doc, steps)
    doc.add_heading("6. 驗證與合理性", level=1)
    add_table(doc, ["驗證", "門檻", "本次結果", "處置"], validation_rows, [2300, 2100, 2200, 2760])
    doc.add_heading("7. 110–114年結果摘要", level=1)
    add_table(doc, result_headers, result_rows, [1800] + [int((9360 - 1800) / (len(result_headers) - 1))] * (len(result_headers) - 2) + [9360 - 1800 - int((9360 - 1800) / (len(result_headers) - 1)) * (len(result_headers) - 2)])
    doc.add_heading("8. 儀表板呈現與互動", level=1)
    add_table(doc, ["問題", "圖表／元件", "篩選與互動", "讀圖限制"], visual_rows, [2300, 2000, 2500, 2560])
    doc.add_heading("9. 發布限制與人工查核", level=1)
    add_bullets(doc, limitations)
    doc.add_heading("10. 可重跑檔案與稽核軌跡", level=1)
    for file_name in reproducible_files:
        add_para(doc, file_name, color=MUTED, size=10.5, after=4)


def build_overview(package: Path, data: dict, diagrams: dict) -> Path:
    path = package / "00_總覽與治理" / "G5_V3.2_完整研究方法與執行流程.docx"
    doc = new_doc("DOC-G5-000", "新北市青年18–35歲三母體資料研究與系統流程", "從官方來源、年齡轉換、三份CSV、每日更新到AWS／Kiro／ChatBot的完整可追溯流程")
    doc.add_heading("1. 執行摘要", level=1)
    add_callout(doc, "本版裁示", "同年度檢視為預設；每日09:15審視來源；發布層改為三個母體各一份長格式CSV；前端一律使用中文或阿拉伯數字。", "ok")
    add_picture_with_alt(doc, diagrams["universes"], "三個母體各自計算、同頁並列但不互當分母的流程圖")
    doc.add_heading("2. 背景與政策問題", level=1)
    add_para(doc, "命題要求聚焦18–35歲青年，但官方資料常以15–19、20–24、25–29、30–34及35–39歲發布；不同資料又分屬戶籍行政紀錄、人力資源抽樣調查及受僱員工薪資調查。若只把數字放在同一頁、未交代母體與分母，容易造成看似可比較、實際不可比較的行政風險。")
    add_para(doc, f"{VERSION}以『母體先分流、方法再換算、發布需標示、答案可追溯』為治理原則。25–29歲優先作來源原生驗證；18–24、30–35與18–35只有在可重現邊際、模型收斂及查核通過後才發布模型估計。")
    doc.add_heading("3. 三母體與三份CSV", level=1)
    add_table(doc, ["母體", "主要指標", "地理層級", "發布檔", "目前年度"], [
        ["戶籍人口母體", "人口、教育、婚姻、性別", "新北市＋29區", "01_戶籍人口母體_長格式.csv", "110–114"],
        ["民間人口與勞動市場母體", "P、LF、E、U、NLF、UR、LFPR、EPR、ESLF", "新北市", "02_民間人口與勞動市場母體_長格式.csv", "110–114"],
        ["受僱員工薪資母體", "全年總薪資平均數、中位數", "新北市工作場所", "03_受僱員工薪資母體_長格式.csv", "110–113；平均數與中位數皆四組"],
    ], [1800, 2900, 1500, 2100, 1060])
    doc.add_heading("4. 最新可用年度與共同年度", level=1)
    add_callout(doc, "定義", "『最新可用年度』是每一來源本身最後可用的資料年；『完整三母體共同年度』是三個母體都能提供可比值的最後一年。目前前者為戶籍與勞動114、薪資113；後者為113。", "info")
    add_para(doc, "同年度檢視預設選擇114年時，薪資區塊應顯示『114年尚無可比官方資料』，不得悄悄帶入113年，也不得把網頁更新日期當成資料年度。使用者可切換至113年檢視三母體完整橫截面。")
    doc.add_heading("5. 統計方法與證據層級", level=1)
    add_table(doc, ["方法", "適用", "本案用途", "證據標示"], [
        ["直接加總", "已有單一年齡或原生25–29帶", "人口18–35；各主題25–29", "官方行政精確值／官方調查原生估計值"],
        ["PCLM", "聚合年齡計數需拆成單歲", "教育、婚姻及勞動邊界年齡", "模型估計；需揭露lambda與收斂"],
        ["IPF", "已有單歲人口列邊際與類別欄邊際", "教育／婚姻各區校準", "模型估計；邊際必須重現"],
        ["Sprague", "五歲組拆單歲的敏感度方法", "勞動PCLM替代模型", "方法敏感度包絡；不是信賴區間"],
    ], [1700, 2500, 2600, 2560])
    doc.add_heading("6. 每日更新與滾動五年", level=1)
    add_picture_with_alt(doc, diagrams["daily"], "每日來源審視、變更偵測、驗證與發布流程圖")
    add_steps(doc, [
        "每天09:15（Asia/Taipei）由EventBridge或本地排程啟動來源審視。",
        "優先比對ETag、Last-Modified與Content-Length；仍不足時下載候選檔並計算SHA-256。",
        "來源未變更只記錄NO_CHANGE；來源已變更才保存不可變raw快照並重算。",
        "重算後執行schema、分頁、期間、範圍、公式、階層與方法敏感度驗證。",
        "人工查核通過後，原子式更新data_catalog.json；失敗批次移入quarantine，舊版持續服務。",
        "執行年變更時，自動計算顯示窗：currentRocYear−5至currentRocYear−1。",
    ])
    doc.add_heading("7. 資料品質結果", level=1)
    qa = data["qa"]
    add_table(doc, ["母體", "檢查數", "失敗數", "結果"], [
        ["戶籍人口", f"{qa['registered_population']['check_count']:,}", str(qa['registered_population']['failure_count']), qa['registered_population']['status']],
        ["民間人口與勞動市場", f"{qa['civilian_labor_market']['check_count']:,}", str(qa['civilian_labor_market']['failure_count']), qa['civilian_labor_market']['status']],
        ["受僱員工薪資", f"{qa['employee_wage']['check_count']:,}", str(qa['employee_wage']['failure_count']), qa['employee_wage']['status']],
    ], [3000, 1800, 1800, 2760])
    add_callout(doc, "模型治理修正", "初次驗證發現全市模型與29區模型各自擬合會產生非加總差異；正式版改採各區先校準、全市由29區加總，確保地圖鑽取可核對。", "warn")
    doc.add_heading("8. AWS、Kiro與ChatBot", level=1)
    add_picture_with_alt(doc, diagrams["aws"], "AWS資料處理、Kiro開發與Bedrock AgentCore問答架構圖")
    add_para(doc, "Kiro負責把需求、設計、任務與測試固化為規格；AWS負責排程、原始快照、轉換、查詢與問答服務。ChatBot只讀已發布三份CSV或其Athena表，不直接讀未查核raw資料。")
    doc.add_heading("9. 儀表板閱讀規則", level=1)
    add_bullets(doc, [
        "行政區地圖只控制戶籍人口區塊；勞動與薪資保持新北市整體，不受行政區選取影響。",
        "前端不得顯示資料代號；所有標題、圖例、坐標軸與提示皆使用繁體中文或阿拉伯數字。",
        "同一圖內不得混合不同母體作比例分母；跨母體只能並列敘述並清楚標示範圍。",
        "所有模型值顯示『估計』與方法；官方行政精確值、官方調查原生值及模型估計值採文字與圖形雙重標示。",
    ])
    doc.add_heading("10. 官方來源", level=1)
    add_standard_sources(doc, ["POP", "EDU", "MAR", "LAB", "WAGE", "NTPC", "OAS", "MAP"])
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    return path


def build_universe_dictionary(package: Path, data: dict, diagrams: dict) -> Path:
    path = package / "01_三母體定義與資料字典" / "三母體定義與指標資料字典.docx"
    doc = new_doc("DOC-G5-101", "三母體定義、分母與資料字典", "同一儀表板內的三條統計產品線及禁止混用規則")
    doc.add_heading("1. 結論先行", level=1)
    add_callout(doc, "治理結論", "三個母體可以在同一儀表板分區呈現，但任何比率、平均數、母數或推論都必須留在自己的母體內。跨母體只能並列，不得相除、加總或補接。", "ok")
    add_picture_with_alt(doc, diagrams["universes"], "三個統計母體的分流與並列關係")
    doc.add_heading("2. 正式母體定義", level=1)
    add_table(doc, ["母體", "觀察單位", "地理角色", "時間基準", "主要限制"], [
        ["戶籍人口母體", "在戶籍登記資料中的人", "戶籍登記地", "年度取12月31日存量；人口另有月資料", "不等同實際居住、民間人口或工作地"],
        ["民間人口與勞動市場母體", "人力資源調查之民間人口、勞動力、就業者、失業者", "調查地區別", "全年12個月平均", "抽樣估計；P與戶籍人口不可互換"],
        ["受僱員工薪資母體", "工作場所位於新北市之本國籍全時受僱員工", "工作場所所在地", "全年薪資統計", "不含全部青年；不是戶籍地；中位數不可加權合成"],
    ], [1700, 2900, 1500, 1600, 1660])
    doc.add_heading("3. 分母與公式字典", level=1)
    add_table(doc, ["中文指標", "內部代號", "分子", "分母", "公式／解讀"], [
        ["戶籍人口占比", "REGISTERED_POPULATION_SHARE_PCT", "目標年齡戶籍人口", "該地區同性別全年齡戶籍人口", "分子÷分母×100%"],
        ["教育程度占比", "EDUCATION_SHARE_PCT", "該教育類別目標年齡人口", "同地區、同性別、同年齡全部教育類別人口", "分子÷分母×100%"],
        ["婚姻狀態占比", "MARITAL_STATUS_SHARE_PCT", "該婚姻類別目標年齡人口", "同地區、同性別、同年齡全部婚姻類別人口", "分子÷分母×100%"],
        ["失業率", "UNEMPLOYMENT_RATE", "U失業人口", "LF勞動力人口", "U÷LF×100%"],
        ["勞動力參與率", "LABOR_FORCE_PARTICIPATION_RATE", "LF勞動力人口", "P民間人口", "LF÷P×100%"],
        ["就業人口比率", "EMPLOYMENT_TO_POPULATION_RATE", "E就業人口", "P民間人口", "E÷P×100%"],
        ["勞動力中就業占比", "EMPLOYMENT_SHARE_OF_LABOR_FORCE", "E就業人口", "LF勞動力人口", "E÷LF×100%；與失業率合計100%"],
        ["薪資平均數", "ANNUAL_TOTAL_SALARY_MEAN", "全體薪資總額", "相符受僱員工人數", "官方表6直接值；跨組合成需人數權數"],
        ["薪資中位數", "ANNUAL_TOTAL_SALARY_MEDIAN", "第50百分位", "個體薪資分布", "不可用各組中位數加權平均"],
    ], [1700, 2100, 1800, 1900, 1860], font_size=8.6)
    doc.add_heading("4. 值的證據標示", level=1)
    add_table(doc, ["標示", "定義", "前端文字", "允許事項"], [
        ["官方行政精確值", "行政紀錄依既定欄位直接加總", "官方行政值", "可呈現人數；仍需揭露戶籍定義"],
        ["官方抽樣調查原生值", "官方調查估計且來源已有目標年齡帶", "官方調查估計", "可直接使用；不稱行政精確值"],
        ["模型估計值", "由官方邊際透過PCLM／IPF／Sprague換算", "估計值", "必須顯示方法、敏感度與查核狀態"],
        ["暫不可發布", "缺必要分子、分母、權數或交叉表", "尚無可比資料", "不得以別年、別地理或代理值靜默替代"],
    ], [2000, 3100, 1900, 2360])
    doc.add_heading("5. CSV共同欄位", level=1)
    fields = [
        ["期間", "roc_year、gregorian_year、source_period、period_basis", "區分資料年與抓取日"],
        ["母體", "universe_code、universe_name_zh", "前端只顯示中文名稱"],
        ["地理", "geography_code、geography_name_zh、geography_level、geography_role_zh", "地圖只讀戶籍CSV"],
        ["分群", "age_band、sex_code、sex_name_zh、category_*", "代號留在後端；中文供前端"],
        ["數值", "metric_code、metric_name_zh、value、unit、numerator、denominator、formula_zh", "ChatBot回答需帶公式與分母"],
        ["證據", "value_origin_*、method_*、uncertainty_*", "區分官方與估計"],
        ["追溯", "source_alias、source_url、source_snapshot、source_sha256、retrieved_at", "查核來源與版本"],
        ["發布", "publish_status、qa_status、note_zh", "不通過不得進data_catalog"],
    ]
    add_table(doc, ["欄位群", "欄位", "用途"], fields, [1300, 4400, 3660])
    doc.add_heading("6. 定義衝突處理規則", level=1)
    add_steps(doc, [
        "先比對觀察單位、納入排除、地理角色、時間基準、年齡邊界、單位與分母。",
        "同名但母體不同時建立不同metric_code與中文完整名稱，不覆寫原定義。",
        "可轉換者記錄公式、方法版本、來源邊際與不確定性；不可轉換者標為HOLD。",
        "官方來源相互衝突時，以原發布機關與資料產製機關說明優先，並保留衝突紀錄及人工裁示。",
        "任何跨母體的推論先停在敘述性並列，不計算混合分母指標。",
    ])
    doc.add_heading("7. 前端與ChatBot命名", level=1)
    add_callout(doc, "呈現規則", "圖標、圖例、坐標軸、篩選器與ChatBot答案均使用繁體中文或阿拉伯數字；內部代號只存在CSV、API、SQL與方法文件。", "info")
    doc.add_heading("8. 來源", level=1)
    add_standard_sources(doc, ["POP", "EDU", "MAR", "LAB", "WAGE", "NTPC", "OAS"])
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    return path


def build_population_doc(package: Path, data: dict, diagrams: dict) -> Path:
    path = package / "02_戶籍人口母體" / "01_人口" / "人口年齡結構處理與驗證.docx"
    rows = value_rows(data["registered"], metric="REGISTERED_POPULATION_COUNT")
    result_rows = [[row["age_band"], format_value(row["value"], row["unit"]), row["value_origin_label_zh"], row["method_name_zh"]] for row in rows]
    doc = new_doc("DOC-G5-201", "戶籍人口年齡結構：計算、介接與驗證", "ODRP014分頁OpenAPI｜12月31日年末存量｜18–35歲單一年齡精確加總")
    add_v13_frame(
        doc,
        conclusion="人口資料已有單一年齡×性別×村里，18–24、25–29、30–35及18–35均可直接加總，不需要Sprague、PCLM或IPF；屬官方行政精確值。",
        scope_rows=[
            ["母體", "戶籍登記現住人口；以戶籍登記地歸屬", "不得稱民間人口、實際居住人口或勞動市場人口"],
            ["年度", "各民國年12月31日快照；11012至11412", "不可把API抓取日當統計日"],
            ["地理", "新北市及29行政區；村里列加總", "行政區選取只影響戶籍人口區塊"],
        ],
        source_rows=[
            ["MOI ODRP014", "每月", "11012–11412", "每日檢查最新期與SHA-256；年度圖固定取12月"],
            ["NTPC人口API／OAS", "每年／依表", "交叉查核", "每日檢查schema、期間與分頁；不覆蓋主來源"],
        ],
        formulas=[
            ["戶籍人口數", "N[g,y,s,A]=Σa∈A N[g,y,s,a]", "戶籍人口", "官方行政精確值"],
            ["占地區人口比率", "N[g,y,s,A]÷N[g,y,s,全年齡]×100%", "同地區、同性別全年齡戶籍人口", "精確比率"],
            ["性別占比", "N[g,y,s,A]÷Σs N[g,y,s,A]×100%", "同地區、同年齡男女合計", "精確比率"],
        ],
        steps=[
            "GET ODRP014/{YYYMM}?page=p，從第1頁讀取totalPage並合併所有responseData。",
            "驗證len(responseData)=totalDataSize、頁面不重複、period等於指定民國年月。",
            "只保留district_code以65開頭且site_id以新北市開頭的資料。",
            "依村里列加總people_age_018_m／f至people_age_035_m／f，形成行政區與全市單歲表。",
            "依18–24、25–29、30–35及18–35集合直接加總；全市以29區加總交叉驗證。",
            "寫入戶籍人口CSV，保存來源快照路徑、SHA-256與抓取時間。",
        ],
        validation_rows=[
            ["API分頁", "取得列數=totalDataSize", "110–114各年7,734至7,752列", "不符即阻擋"],
            ["性別恆等", "男＋女=合計", "通過", "不符即隔離"],
            ["地理階層", "29區加總=新北市", "通過", "不符即隔離"],
            ["年齡範圍", "18、19、35歲欄位皆存在", "通過", "缺欄不得以比例補"],
        ],
        result_headers=["114年年齡", "戶籍人口數", "數值身分", "方法"],
        result_rows=result_rows,
        visual_rows=[
            ["各區青年人口", "新北市29區分級著色地圖＋排序表", "年度、年齡、性別；滑鼠移入顯示區名，點擊更新戶籍區塊", "面積大小會影響視覺；另提供數值表"],
            ["五年趨勢", "折線圖", "110–114、年齡、性別", "年度值為12月31日存量"],
            ["年齡結構", "分組長條圖", "行政區、年度、性別", "18–35與三子群不可同時堆疊以免重複"],
            ["男女比例", "100%堆疊長條圖", "行政區、年度、年齡", "直接標示百分比，不能只靠顏色"],
        ],
        limitations=[
            "戶籍人口可精確計算，但不代表實際居住、就學、工作或勞動力狀態。",
            "年度比較採12月31日存量；月度人口可另做月比或同比，但不得與年度勞動平均視為同一時間基準。",
            "行政區碼、里別異動及名稱變更須列入每日schema與地理主鍵檢查。",
        ],
        reproducible_files=["scripts/build_g5_v3_data.py", "scripts/validate_g5_v3_data.py", "09_發布資料包/01_戶籍人口母體_長格式.csv", "08_人工查核與異常處理/machine_qa/data_build_diagnostics.json"],
    )
    doc.add_heading("11. 官方來源", level=1)
    add_standard_sources(doc, ["POP", "NTPC", "OAS", "MAP"])
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    return path


def category_result_rows(data: list[dict], metric: str, dimension: str):
    rows = [row for row in data if row["roc_year"] == "114" and row["geography_name_zh"] == "新北市" and row["metric_code"] == metric and row["category_dimension_code"] == dimension and row["age_band"] == "18-35" and row["sex_code"] == "ALL"]
    return [[row["category_name_zh"], format_value(row["value"], row["unit"]), row["value_origin_label_zh"], row["method_name_zh"]] for row in sorted(rows, key=lambda item: float(item["value"]), reverse=True)]


def build_education_doc(package: Path, data: dict, diagrams: dict) -> Path:
    path = package / "02_戶籍人口母體" / "02_教育" / "教育程度年齡轉換與驗證.docx"
    result_rows = category_result_rows(data["registered"], "EDUCATION_SHARE_PCT", "EDUCATION")
    doc = new_doc("DOC-G5-202", "戶籍教育程度：年齡轉換與驗證", "五歲年齡×教育行政交叉｜PCLM單歲種子＋IPF邊際校準｜各區可鑽取")
    add_picture_with_alt(doc, diagrams["registered"], "教育與婚姻由官方五歲組轉換為18至35歲並完成行政區階層校準的流程")
    add_v13_frame(
        doc,
        conclusion="MOI教育資料提供新北市年齡×教育×性別×村里交叉。25–29歲可直接加總；18–24、30–35及18–35須拆分18、19、35歲，正式採全市PCLM種子＋各區IPF校準，並以比例初值作敏感度比較。",
        scope_rows=[
            ["母體", "戶籍登記之15歲以上人口教育程度行政交叉", "不得稱民間人口教育或就業者教育"],
            ["分類", "研究所、大學、專科、高中職、國中及以下", "分類標準化須保留原始edu欄位對照"],
            ["目標年齡", "18–24、25–29、30–35、18–35", "18、19、35歲為模型邊界；25–29為官方原生帶"],
        ],
        source_rows=[
            ["MOI-EDU5Y年度ZIP", "每年", "110–114", "每日查檔案日期、大小與SHA-256；有變更才重算"],
            ["MOI-POP1Y", "每月", "各年12月", "提供單一年齡×性別列邊際"],
            ["NTPC教育API／OAS", "每年／依表", "交叉查核", "只作總體趨勢與schema查核；不得假裝年齡×教育交叉"],
        ],
        formulas=[
            ["PCLM", "y_g~Poisson(Σa∈g exp(B_aθ))＋λ||D²θ||²", "官方五歲組教育人數", "模型估計"],
            ["IPF列邊際", "Σe x[a,e]=單歲戶籍人口[a]", "同區同性別單一年齡人口", "必須重現"],
            ["IPF欄邊際", "Σa∈g x[a,e]=官方教育[g,e]", "同區同性別五歲組教育人數", "必須重現"],
            ["教育占比", "x[A,e]÷Σe x[A,e]×100%", "同區同性別同年齡全部教育類別", "25–29精確；其餘估計"],
        ],
        steps=[
            "串流讀取年度ZIP，不解壓1.2GB大型CSV；保留新北市、15–39歲及合法性別。",
            "將博畢／碩畢合併研究所；大畢、專畢、高中畢、國中畢與國小畢以下依字典標準化。",
            "先按全市、性別與教育類別對15–19至35–39五歲組擬合PCLM，GCV選擇平滑參數。",
            "將全市單歲曲線作各行政區IPF種子；每個五歲組同時校準單歲人口列邊際與教育欄邊際。",
            "25–29直接使用官方五歲組；18–24、30–35與18–35加總模型單歲值。",
            "以只按人口比例分配的IPF結果作替代初值，PCLM與替代值形成方法敏感度包絡。",
            "各區先完成校準，全市由29區加總，避免非線性模型造成階層不一致。",
        ],
        validation_rows=[
            ["PCLM收斂", "各年各性別各類別均收斂", "110–114全部通過", "不收斂即HOLD"],
            ["IPF列欄邊際", "最大誤差<1×10⁻⁶人", "最大<1×10⁻⁷人", "超界即阻擋"],
            ["類別總和", "各教育占比合計100%", "通過", "不符即隔離"],
            ["地理階層", "29區加總=全市", "通過；已修正初次非加總問題", "保留異常紀錄"],
        ],
        result_headers=["114年18–35教育程度", "占比", "數值身分", "方法"],
        result_rows=result_rows,
        visual_rows=[
            ["教育結構", "100%堆疊長條圖", "行政區、年度、年齡、性別", "五類可同圖；直接標示百分比"],
            ["行政區比較", "水平排序長條圖", "選一教育類別與年齡", "地圖只作選取；精確比較看排序表"],
            ["五年變化", "多線趨勢或小倍圖", "110–114、教育類別", "最多5條；模型值顯示估計標籤"],
            ["方法敏感度", "點估計＋區間線", "PCLM與比例初值差異", "區間是方法包絡，不是信賴區間"],
        ],
        limitations=[
            "25–29歲是官方原生年齡帶；其他三組是模型估計，前端與文件不可標成官方直接發布值。",
            "PCLM與IPF重現邊際，但無法創造官方未發布的單一年齡教育真值；方法敏感度不是抽樣信賴區間。",
            "行政區小細胞可能有稀疏性；公開前應設定最小發布門檻並評估類別合併。",
            "人力資源調查表27／32的年齡與教育只是兩組邊際，不得用來取代戶籍年齡×教育交叉。",
        ],
        reproducible_files=["scripts/build_g5_v3_data.py::read_categorical_zip/graduate_categories", "09_發布資料包/01_戶籍人口母體_長格式.csv", "08_人工查核與異常處理/machine_qa/data_build_diagnostics.json"],
    )
    doc.add_heading("11. 官方來源", level=1)
    add_standard_sources(doc, ["EDU", "POP", "NTPC", "OAS"])
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    return path


def build_marriage_doc(package: Path, data: dict, diagrams: dict) -> Path:
    path = package / "02_戶籍人口母體" / "03_婚姻" / "婚姻狀態年齡轉換與驗證.docx"
    result_rows = category_result_rows(data["registered"], "MARITAL_STATUS_SHARE_PCT", "MARITAL_STATUS")
    doc = new_doc("DOC-G5-203", "婚姻狀態：年齡轉換與驗證", "四類法定婚姻狀態｜PCLM單歲種子＋IPF邊際校準｜各區可鑽取")
    add_picture_with_alt(doc, diagrams["registered"], "婚姻狀態由官方五歲年齡組轉為政策年齡並按行政區階層校準的流程")
    add_v13_frame(
        doc,
        conclusion="婚姻資料可分未婚、有偶、離婚或終止結婚、喪偶四類。25–29為官方原生五歲組；含18、19、35歲的目標群採PCLM＋IPF估計，並維持各區人口與官方婚姻邊際。",
        scope_rows=[
            ["母體", "戶籍登記之15歲以上人口婚姻狀態", "不得把目前有配偶等同家庭形成或同住狀態"],
            ["分類", "未婚、有偶、離婚或終止結婚、喪偶", "同性／異性法律類型合併時須保留原始映射"],
            ["目標年齡", "18–24、25–29、30–35、18–35", "18、19、35歲為模型邊界"],
        ],
        source_rows=[
            ["MOI-MARITAL5Y年度ZIP", "每年", "110–114", "每日檢查年度檔案雜湊；來源變更才重算"],
            ["MOI-POP1Y", "每月", "各年12月", "提供單一年齡×性別校準邊際"],
            ["戶政司API人工抽查", "年度／依需求", "至少抽查2區×2年", "對照ODRP052、年度ZIP及區公所／戶政公開表"],
        ],
        formulas=[
            ["四類人數", "x[A,m]=Σa∈A x[a,m]", "同區同性別婚姻狀態行政人口", "25–29精確；其餘估計"],
            ["婚姻占比", "x[A,m]÷Σm x[A,m]×100%", "同區同性別同年齡四類合計", "合計100%"],
            ["PCLM", "以五歲組婚姻人數擬合單歲平滑曲線", "官方五歲組邊際", "模型初值"],
            ["IPF", "同時重現單歲人口與五歲組婚姻類別總數", "人口列邊際＋婚姻欄邊際", "模型校準"],
        ],
        steps=[
            "串流讀取年度ZIP，保留新北市與15–39歲；同性與異性有偶／離婚／喪偶依法律狀態合併。",
            "按全市、性別、婚姻類別擬合PCLM單歲曲線，以GCV及內部留一組偏差選擇平滑參數。",
            "各行政區在每個官方五歲組內以IPF校準單歲人口列邊際與婚姻類別欄邊際。",
            "25–29直接使用官方五歲組；其餘群組加總單歲估計。",
            "以人口比例IPF作敏感度替代；結果低高值只表示方法差異，不是95%信賴區間。",
            "全市模型值由29區加總，確保地圖選取與全市卡片一致。",
        ],
        validation_rows=[
            ["PCLM收斂", "全部類別與性別收斂", "110–114全部通過", "不收斂即HOLD"],
            ["IPF邊際", "最大誤差<1×10⁻⁶人", "最大<1×10⁻⁷人", "超界即阻擋"],
            ["四類占比", "合計100%", "通過", "不符即隔離"],
            ["地理階層", "29區加總=全市", "通過", "不符即隔離"],
        ],
        result_headers=["114年18–35婚姻狀態", "占比", "數值身分", "方法"],
        result_rows=result_rows,
        visual_rows=[
            ["婚姻結構", "100%堆疊長條圖", "行政區、年度、年齡、性別", "四類合計100%；比圓餅圖更適合跨年"],
            ["各區未婚／有偶", "水平排序長條圖", "選一狀態與年齡", "顯示數值標籤及資料身分"],
            ["五年變化", "小倍折線圖", "110–114、婚姻類別", "低占比類別分面，避免尺度被未婚壓縮"],
            ["方法敏感度", "點區間圖", "區域、年齡、類別", "包絡不是抽樣信賴區間"],
        ],
        limitations=[
            "婚姻狀態是戶籍法律狀態，不直接代表同住、育兒、經濟扶養或家庭形成。",
            "含18、19、35歲群組為模型估計；不可把PCLM/IPF結果寫成官方逐歲真值。",
            "小行政區的小類別需人工抽查及最小發布門檻；稀疏格不宜過度解讀年比。",
            "人工抽查優先使用戶政司ODRP052年度API／ZIP，並選板橋等大區與平溪等小區比較。",
        ],
        reproducible_files=["scripts/build_g5_v3_data.py::read_categorical_zip/graduate_categories", "09_發布資料包/01_戶籍人口母體_長格式.csv", "08_人工查核與異常處理/人工查核SOP與查核表.docx"],
    )
    doc.add_heading("11. 官方來源", level=1)
    add_standard_sources(doc, ["MAR", "POP"])
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    return path


def labor_result_rows(data: list[dict]):
    metrics = [
        ("UNEMPLOYMENT_RATE", "失業率"),
        ("LABOR_FORCE_PARTICIPATION_RATE", "勞動力參與率"),
        ("EMPLOYMENT_TO_POPULATION_RATE", "就業人口比率"),
        ("EMPLOYMENT_SHARE_OF_LABOR_FORCE", "勞動力中就業占比"),
    ]
    result = []
    for age in ("18-24", "25-29", "30-35", "18-35"):
        line = [age]
        for metric, _ in metrics:
            row = next(item for item in data if item["roc_year"] == "114" and item["age_band"] == age and item["metric_code"] == metric)
            line.append(format_value(row["value"], row["unit"]))
        result.append(line)
    return result


def build_labor_doc(package: Path, data: dict, diagrams: dict) -> Path:
    path = package / "03_民間人口與勞動市場母體" / "就業失業勞參率處理與驗證.docx"
    doc = new_doc("DOC-G5-301", "民間人口、就業、失業與勞參率：年齡轉換與驗證", "人力資源調查全年平均｜PCLM主模型＋Sprague敏感度｜P、LF、E、U一致計算")
    add_v13_frame(
        doc,
        conclusion="110–114年均已有新北市官方年表。25–29歲為官方原生五歲年齡帶；18–24、30–35與18–35採PCLM拆分，Sprague作方法敏感度。所有率由同一組P、LF、E、U分子分母重算，公式恆等式已通過。",
        scope_rows=[
            ["P民間人口", "人力資源調查之15歲以上民間人口控制／估計", "不等同戶籍人口"],
            ["LF勞動力", "E就業人口＋U失業人口", "失業率的分母只能是LF"],
            ["時間", "110–114年各為12個月平均", "不是12月31日，也不是單月相加"],
        ],
        source_rows=[
            ["DGBAS年報表27／32／36；表28作QA", "每年", "110–114", "P取表27、E取表32、U取表36；LF=E+U，表28只核對四捨五入差"],
            ["DGBAS 114年下半年表41／42", "半年度", "僅114年輔助", "以同年15–19與20–24之E、U、NLF占比拆分全年15–24；不取代全年總量"],
            ["NTPC失業率／就業結構API", "每年", "交叉查核", "檢查schema與25–29原生值；不替代人數分母"],
            ["OAS", "依表", "交叉查核", "保留匯出日期、表名及儲存格證據"],
        ],
        formulas=[
            ["LF", "LF=E+U", "勞動力", "恆等式"],
            ["NLF", "NLF=P−LF", "民間人口", "恆等式"],
            ["UR失業率", "U÷LF×100%", "勞動力", "與ESLF合計100%"],
            ["LFPR勞參率", "LF÷P×100%", "民間人口", "不可除戶籍人口"],
            ["EPR就業人口比率", "E÷P×100%", "民間人口", "不可與ESLF混稱"],
            ["ESLF勞動力中就業占比", "E÷LF×100%", "勞動力", "ESLF＋UR=100%"],
        ],
        steps=[
            "逐年讀取表27之P、表32之E、表36之U；以E+U重建LF，以P−LF得到NLF；表28只作來源四捨五入一致性查核。",
            "114年原始全年表以15–24為一組，先用同年下半年表41／42之E、U、NLF年齡占比拆成15–19與20–24，同時保持全年15–24總量不變。",
            "25–29來源原生值直接使用，作為模型與來源儲存格交叉驗證。",
            "對互斥成分E、U、NLF各自以PCLM拆分單歲，再依LF=E+U、P=LF+NLF重建P與LF。",
            "以非負校準Sprague拆分同一組來源年齡帶，形成替代模型。",
            "按18–24、25–29、30–35、18–35加總單歲計數，再由計數計算UR、LFPR、EPR與ESLF；率不直接拆分。",
            "驗證官方25–29、P/LF/E/U恆等式、率回算與PCLM–Sprague敏感度；超界項目進人工Gate。",
        ],
        validation_rows=[
            ["公式恆等", "LF=E+U、NLF=P−LF", "110–114全部通過", "失敗即阻擋"],
            ["率回算", "UR、LFPR、EPR、ESLF與計數差<0.0001百分點", "全部通過", "失敗即阻擋"],
            ["互補", "UR＋ESLF=100%", "全部通過", "失敗即阻擋"],
            ["方法敏感度", "報告PCLM與Sprague包絡", "已寫入low/high", "不是信賴區間"],
        ],
        result_headers=["114年年齡", "失業率", "勞動力參與率", "就業人口比率", "勞動力中就業占比"],
        result_rows=labor_result_rows(data["labor"]),
        visual_rows=[
            ["UR與ESLF", "100%堆疊長條圖或雙部分圓環", "年度、年齡", "每年合計100%；跨年比較優先長條"],
            ["勞參率", "年度分組長條圖／折線圖", "110–114、年齡", "坐標軸明示百分比"],
            ["就業人口比率", "年度分組長條圖／折線圖", "110–114、年齡", "與ESLF分開呈現"],
            ["P、LF、E、U", "流程卡＋小倍趨勢", "年度、年齡", "單位千人；不與戶籍人口接成一條序列"],
            ["方法差異", "PCLM點估計＋Sprague包絡", "年度、年齡、指標", "包絡不是抽樣誤差"],
        ],
        limitations=[
            "P、LF、E、U均為官方抽樣調查估計，並非行政登記人數；小年齡組的抽樣變異可能較大。",
            "年度值是12個月平均；無法由年度值合理製造官方月值。若需月度失業率，必須取得官方月資料或微資料。",
            "目前發布合計性別；若正式新增男女分組，須取得相符地區×性別×年齡計數或微資料權數，不可只拆率。",
            "行政區地圖不呈現勞動指標，因來源只有新北市整體。",
        ],
        reproducible_files=["scripts/analyze_annual_labor_age_graduation_v24.py", "deliverables/NTPC_Labor_18-35_Sprague_PCLM_Pilot_V1.1_20260825/annual_110_114/", "09_發布資料包/02_民間人口與勞動市場母體_長格式.csv"],
    )
    doc.add_heading("11. 官方來源", level=1)
    add_standard_sources(doc, ["LAB", "NTPC", "OAS"])
    for label, url, note in (
        ("110年人力資源調查統計", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=207903", "02 CSV民國110年列的官方年報頁。"),
        ("111年人力資源調查統計", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=231112", "02 CSV民國111年列的官方年報頁。"),
        ("112年人力資源調查統計", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=234726", "02 CSV民國112年列的官方年報頁。"),
        ("113年人力資源調查統計", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=234885", "02 CSV民國113年列的官方年報頁。"),
        ("114年人力資源調查統計", "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078", "02 CSV民國114年列的官方年報頁。"),
        ("114年下半年表41／42輔助來源", "https://www.stat.gov.tw/News_Content.aspx?n=4003&s=235759", "只用於114年15–24歲拆分的同年輔助占比。"),
    ):
        add_source_link(doc, label, url, note)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    return path


def wage_result_rows(data: list[dict]):
    grouped = {}
    for row in data:
        grouped[(row["roc_year"], row["age_band"], row["metric_code"])] = row
    result = []
    for year in ("110", "111", "112", "113"):
        means = [
            grouped[(year, age, "ANNUAL_TOTAL_SALARY_MEAN")]
            for age in ("18-24", "25-29", "30-35", "18-35")
        ]
        medians = [
            grouped[(year, age, "ANNUAL_TOTAL_SALARY_MEDIAN")]
            for age in ("18-24", "25-29", "30-35", "18-35")
        ]
        result.append([
            year,
            *[format_value(row["value"], row["unit"]) for row in means],
            *[format_value(row["value"], row["unit"]) for row in medians],
        ])
    result.append(["114", "尚無", "尚無", "尚無", "尚無", "尚無", "尚無", "尚無", "尚無"])
    return result


def build_wage_doc(package: Path, data: dict, diagrams: dict) -> Path:
    path = package / "04_受僱員工薪資母體" / "平均與中位數處理與可用性.docx"
    doc = new_doc("DOC-G5-401", "受僱員工薪資平均數與中位數：處理方法與可用性", "新北市工作場所×年齡｜四組平均數與中位數｜官方錨定與分布模型")
    add_v13_frame(
        doc,
        conclusion="薪資CSV採4年度×4年齡×2統計量的完整32列結構。110–113年四組平均數與中位數均有值；25–29歲為官方表6原生調查統計，其他三組平均數為官方薪資錨定與PCLM輔助年齡輪廓估計，中位數為官方寬帶形狀轉移與對數常態混合分布估計。114年仍保持缺值。",
        scope_rows=[
            ["母體", "工作場所位於新北市之本國籍全時受僱員工", "不代表所有戶籍青年、勞動力或就業者"],
            ["統計量", "全年總薪資平均數與中位數；單位萬元／年", "平均數與中位數計算邏輯不同"],
            ["CSV列數與可發布年齡", "32列＝4年度×4年齡×2統計量；平均數與中位數四組均可發布", "非25–29歲中位數必須標示模型估計；114年不代填"],
            ["性別", "全體", "表6沒有新北市×年齡×性別交叉，不產製男女薪資"],
        ],
        source_rows=[
            ["DGBAS表6工作簿", "每年", "110–113", "每日檢查工作簿資料年與SHA-256；頁面更新日不算資料年"],
            ["BLI地區×年齡投保人數", "每年", "110–113新北市", "作年齡權數；母體不完全相同，因此估計值不可標為官方原生"],
            ["BLI年齡×勞退平均提繳工資", "每年", "110–113全國", "只形成相對年齡薪資輪廓，不把提繳工資當全年總薪資"],
        ],
        formulas=[
            ["平均薪資", "μ=Σi w_i x_i÷Σi w_i", "相符受僱員工人數權數", "有權數才可跨組合成"],
            ["25–29平均數", "官方表6新北市×25–29直接值", "本國籍全時受僱員工", "官方調查統計值"],
            ["輔助組平均", "m̃_A=Σ(a∈A)N_a C_a÷Σ(a∈A)N_a", "PCLM單歲人數N_a、單歲輔助工資C_a", "先回校準至官方五歲組邊際"],
            ["錨定換算", "μ̂_A=μ_G×(m̃_A÷m̃_G)", "官方表6錨定組G與輔助輪廓比率", "18–24錨定未滿25；30–35錨定30–39"],
            ["18–35平均", "μ̂_18–35=Σ_A N_A μ̂_A÷Σ_A N_A", "A為18–24、25–29、30–35", "按新北市勞保年齡人數加權"],
            ["敏感度範圍", "low=min(μ̂_PCLM,μ̂_uniform)；high=max(…)", "PCLM與五歲組內均勻假設", "方法敏感度，不是95%信賴區間"],
            ["子群中位數", "m̂_A=μ̂_A×(m_G÷μ_G)", "目標平均數與官方相鄰寬帶平均／中位數", "保留寬帶分布形狀比率；非官方原生值"],
            ["18–35中位數", "Σ_A w_A F_A(x)=0.5之數值解", "三子群對數常態CDF與PCLM人數權重", "不是分組中位數線性加權"],
            ["年比", "本年值÷前一年值−1", "同一母體、年齡、統計量", "不得跨母體或跨年齡"],
        ],
        steps=[
            "讀取官方表6各年度工作表，固定選取新北市列之未滿25、25–29、30–39平均數與中位數。",
            "讀取新北市勞保年齡人數與勞退年齡平均提繳工資，產生五歲組人數與薪資量邊際。",
            "以PCLM拆成單一年齡輪廓，並在每一五歲組內回校準，使人數與薪資量邊際重現原始表。",
            "用相對輪廓比率校準官方薪資錨，計算18–24及30–35；25–29保持官方原生值。",
            "以新北市年齡人數權數合成18–35平均數；另以組內均勻法形成方法敏感度範圍。",
            "依官方相鄰寬帶中位數／平均數比率估計18–24及30–35中位數；18–35則以PCLM權重求三子群對數常態混合分布第50百分位。",
            "驗證官方原生值未改動、年齡邊際回算、平均數≥中位數、結果位於敏感度範圍，並以25–29歲官方中位數作留出合理性檢查。",
            "四個年齡組都建立平均數與中位數；114顯示缺口，不沿用113。",
        ],
        validation_rows=[
            ["工作表年度", "資料年110–113", "通過", "頁面更新日不取代資料年"],
            ["地理列", "新北市工作場所列", "通過；固定表6列位置並需人工核對標籤", "年度格式漂移即阻擋"],
            ["統計量合理性", "平均數≥中位數>0", "110–113全部通過", "失敗即阻擋"],
            ["輔助邊際回算", "PCLM回校準後各五歲組一致", "人數最大誤差<1×10⁻¹⁰；薪資量<1×10⁻⁵", "超界即阻擋模型估計"],
            ["年齡覆蓋", "每年四組年齡×平均／中位兩統計量", "110–113共32列且全部有值；通過", "缺組、缺值或模型未標身分即阻擋"],
            ["資料身分", "25–29平均與中位為原生；其餘兩統計量為模型估計", "通過", "前端不得混稱官方精確值"],
            ["中位數留出檢查", "以相鄰寬帶形狀比率預測未參與校準的25–29官方中位數", "110–113 APE為0.28%、0.10%、0.49%、0.66%；MAPE約0.38%", "僅4個檢查點，屬合理性檢查，不是完整外部驗證"],
            ["114缺口", "不補造、不沿用", "已排除發布", "儀表板顯示空狀態"],
        ],
        result_headers=["年度", "18–24平均", "25–29平均", "30–35平均", "18–35平均", "18–24中位", "25–29中位", "30–35中位", "18–35中位"],
        result_rows=wage_result_rows(data["wage"]),
        visual_rows=[
            ["平均薪資年齡比較", "分組折線／長條圖", "110–113、四組年齡", "模型估計以虛線或明確標籤區隔官方原生值"],
            ["平均與中位數差距", "雙線趨勢圖", "110–113、四組年齡", "同年齡同年度比較；各值保留官方或模型身分"],
            ["可用性", "資料覆蓋矩陣", "年度×年齡×統計量", "綠色外加文字『可用』，不得只靠顏色"],
            ["估計可追溯", "方法狀態卡", "平均數／中位數", "顯示來源身分、錨定組、估計法與low/high"],
        ],
        limitations=[
            "18–24、30–35及18–35平均數是模型估計，不是主計總處直接發布值；跨母體輔助資料造成的模型風險必須揭露。",
            "表6按工作場所所在地，不是戶籍地；不得將其解讀為新北戶籍青年薪資。",
            "未滿25歲不能直接改標18–24；30–39也不能按年數比例拆成30–35。本版只用輔助輪廓的相對比率校準官方薪資錨。",
            "勞退平均提繳工資不等於實際全年總薪資；本版只用其年齡相對輪廓，不直接作發布值。",
            "非25–29歲中位數依對數常態分布與形狀轉移假設估計；取得個體分布與權數後，應改用加權經驗分布第50百分位重新驗證。",
            "表6沒有新北市×年齡×性別交叉；全體值不得拆成男、女後冒充官方統計。",
        ],
        reproducible_files=["scripts/build_g5_v3_data.py::build_wage_csv", "09_發布資料包/03_受僱員工薪資母體_長格式.csv", "08_人工查核與異常處理/machine_qa/data_build_diagnostics.json"],
    )
    doc.add_heading("11. 官方來源", level=1)
    add_standard_sources(doc, ["WAGE", "BLIAGE", "BLIPENSION"])
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    return path


def build_dashboard_doc(package: Path, data: dict, diagrams: dict) -> Path:
    path = package / "06_跨母體儀表板規格" / "中文互動式儀表板與圖表契約.docx"
    doc = new_doc("DOC-G5-501", "中文互動式儀表板與圖表契約", "新北市29區地圖｜三母體分區｜同年度預設｜繁體中文與無障礙規格")
    doc.add_heading("1. 設計結論", level=1)
    add_callout(doc, "資訊架構", "單頁分成戶籍人口、勞動市場、薪資、方法與ChatBot五區；上方年度與年齡篩選器控制全頁，行政區選取只控制戶籍人口區。", "ok")
    add_callout(doc, "UI／UX Pro Max影響", "採Accessible & Ethical政府資料介面：高對比海軍藍＋藍色重點、16px以上內文、明確焦點環、44px互動區、減少動態效果，避免AI紫色漸層與裝飾性動畫。", "info")
    doc.add_heading("2. 頁面層級", level=1)
    add_table(doc, ["區段", "內容", "篩選器", "資料母體"], [
        ["全域標頭", "年度、年齡、性別、資料狀態、下載", "年度預設114；年齡預設18–35", "只改相符欄位，不混分母"],
        ["行政區地圖", "29區名稱、人口、教育、婚姻、男女比例", "年度、年齡、性別、行政區", "戶籍人口"],
        ["全市戶籍", "五年人口與教育／婚姻結構", "年度、年齡、性別", "戶籍人口"],
        ["勞動市場", "P、LF、E、U、UR、LFPR、EPR、ESLF", "年度、年齡", "民間人口與勞動市場"],
        ["薪資", "32列完整結構；110–113四組平均數與中位數均有值", "年度、年齡、統計量", "受僱員工薪資"],
        ["ChatBot", "自然語言查詢、來源、公式與限制", "沿用目前篩選條件或由問題指定", "一次只查一母體；可並列但不可混算"],
    ], [1700, 3500, 2200, 1960])
    doc.add_heading("3. 圖表契約", level=1)
    add_table(doc, ["圖表", "讀者問題", "主圖形", "必要標示", "無障礙替代"], [
        ["29區青年人口地圖", "哪一區人數較多？", "單色分級SVG地圖", "年度、年齡、單位、圖例、區名提示", "鍵盤可巡覽區域＋排序資料表"],
        ["人口五年趨勢", "青年人口如何變化？", "折線圖", "110–114、12月31日存量", "表格與文字摘要"],
        ["教育結構", "18–35教育組成？", "100%堆疊長條", "五類、百分比、估計標籤", "數值表"],
        ["婚姻結構", "各狀態占比？", "100%堆疊長條", "四類、百分比、估計標籤", "數值表"],
        ["UR／ESLF", "勞動力中就業與失業如何分配？", "100%堆疊長條", "兩者合計100%", "年度×兩指標表"],
        ["勞參率／就業人口比率", "勞動市場參與與就業覆蓋？", "分開的年度長條／折線", "百分比、年齡、模型標籤", "數值表"],
        ["薪資平均", "不同青年年齡組如何變化？", "分組折線／長條", "110–113、萬元／年、四組年齡", "模型估計需明示"],
        ["薪資平均／中位", "典型薪資與平均差距？", "雙線趨勢", "110–113、萬元／年、25–29", "只比較官方原生年齡帶"],
    ], [1600, 2300, 1800, 2300, 1360], font_size=8.7)
    doc.add_heading("4. 地圖互動契約", level=1)
    add_steps(doc, [
        "滑鼠移入、鍵盤焦點或觸控點按行政區時，顯示區名與目前指標精確值；不能只依賴hover。",
        "點擊行政區後，戶籍人口卡片、人口年齡、教育、婚姻及男女比例更新；頁面顯示返回『新北市』路徑。",
        "勞動與薪資區塊不受行政區選取影響，亦不顯示行政區無資料的警告橫幅；標題固定寫『新北市整體』。",
        "地圖以官方行政區域圖或官方ArcGIS GeoJSON轉換，保存來源URL、取得日與SHA-256。",
        "分級著色不可取代精確比較；同時提供可排序行政區資料表與CSV下載。",
    ])
    doc.add_heading("5. 年度與資料缺口", level=1)
    add_para(doc, "同年度檢視預設選擇目前顯示窗最後一年114。戶籍與勞動呈現114；薪資呈現具體空狀態『114年尚無新北市地區×年齡可比官方薪資資料，最近可用為113年』，不得自動降級到113而不告知。")
    add_table(doc, ["情境", "介面行為", "禁止行為"], [
        ["來源未發布當年值", "空狀態＋最近可用年度＋來源連結", "延用前一年並畫連續線"],
        ["模型值", "顯示『估計』徽章、方法與敏感度", "標成官方精確值"],
        ["不同時間基準", "分區呈現並標示年末存量／全年平均", "在同一序列混接"],
        ["無行政區資料", "保留新北市整體區塊", "依戶籍人口比例拆勞動或薪資"],
    ], [2200, 3900, 3260])
    doc.add_heading("6. 中文與格式規則", level=1)
    add_bullets(doc, [
        "圖表標題、圖例、坐標軸、提示、篩選器與下載檔名使用繁體中文或阿拉伯數字。",
        "前端不顯示P、LF、UR等代號；可在方法抽屜用中文全名加括號代號，主要畫面只顯示中文。",
        "人數使用千分位；千人保留至多2位；百分比預設2位；薪資1位，並標示萬元／年。",
        "色彩不是唯一編碼：模型值另加虛線／斜紋或『估計』文字；錯誤與警告都有圖示及文字。",
        "圖表必須有可展開資料表、鍵盤焦點、aria-label及可下載CSV。",
    ])
    doc.add_heading("7. RWD與互動狀態", level=1)
    add_table(doc, ["尺寸", "佈局", "地圖／圖表", "ChatBot"], [
        ["375px", "單欄；篩選器分段折疊", "地圖先顯示搜尋／排序表，圖表減少刻度", "底部抽屜，全高不超過80dvh"],
        ["768px", "兩欄卡片", "地圖與摘要並列", "右側浮動按鈕＋抽屜"],
        ["1024px以上", "12欄網格；黏性篩選列", "地圖占7欄、摘要5欄", "固定右側面板或可收合"],
    ], [1500, 3000, 3000, 1860])
    doc.add_heading("8. 驗收條件", level=1)
    add_bullets(doc, [
        "鍵盤可操作所有篩選、行政區與圖例；焦點環2–4px且對比足夠。",
        "正常文字對比至少4.5:1，圖形對比至少3:1；支援prefers-reduced-motion。",
        "375、768、1024、1440px無水平捲動或內容遮蔽；表格可水平捲動或轉卡片。",
        "114年薪資空狀態、載入骨架、錯誤重試、ChatBot逾時皆有明確文字。",
        "所有視圖URL保存年度、年齡、性別與行政區參數，方便分享與查核。",
    ])
    doc.add_heading("9. 官方地圖來源", level=1)
    add_standard_sources(doc, ["MAP", "POP"])
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    return path


def build_aws_kiro_doc(package: Path, data: dict, diagrams: dict) -> Path:
    path = package / "07_AWS與Kiro" / "AWS_Kiro_介接計算操作與每日更新.docx"
    doc = new_doc("DOC-G5-601", "AWS與Kiro：介接、計算、操作與每日更新", "EventBridge每日審視｜S3不可變快照｜Step Functions／Glue／Athena｜schema-first AgentCore")
    doc.add_heading("1. 架構結論", level=1)
    add_callout(doc, "部署邊界", "本文件完成可部署設計與Kiro任務規格，但不代表本輪已修改或部署AWS正式環境。正式部署須另行執行IAM、S3、EventBridge、Glue、Athena與AgentCore變更核准。", "warn")
    add_picture_with_alt(doc, diagrams["aws"], "官方來源進入AWS不可變原始層、轉換為三份CSV並供儀表板與ChatBot使用的架構")
    doc.add_heading("2. AWS服務分工", level=1)
    add_table(doc, ["服務", "用途", "最小權限／治理", "輸出"], [
        ["EventBridge Scheduler", "每日09:15來源審視", "只啟動指定Step Functions", "run_id與來源檢查事件"],
        ["Step Functions", "來源檢查、分流、轉換、QA、人工Gate", "fail-closed；每步寫執行狀態", "run manifest"],
        ["Lambda", "小型API、HEAD／雜湊、人口分頁、目錄更新", "限定官方網域與S3前綴", "raw／manifest／catalog"],
        ["Glue Python Shell／Spark", "教育與婚姻大型ZIP串流、PCLM／IPF", "寫curated候選區；不得直接覆寫production", "三母體候選CSV"],
        ["S3", "raw、curated、published、quarantine", "版本化、SSE-KMS、Object Lock視需求", "不可變快照與正式CSV"],
        ["Glue Data Catalog＋Athena", "三份CSV建立外部表與受控查詢", "三資料庫或三表；禁止跨母體混合分母View", "儀表板／ChatBot查詢"],
        ["CloudFront／API Gateway", "儀表板靜態檔與受控API", "WAF、CORS、節流、伺服器端秘密", "中文互動頁面"],
        ["Bedrock AgentCore", "自然語言問答與工具調用", "只調用allowlist工具；不直接瀏覽raw S3", "帶來源與限制的中文答案"],
    ], [1700, 2400, 3000, 2260], font_size=8.8)
    doc.add_heading("3. S3物件結構", level=1)
    add_para(doc, "建議bucket前綴：raw/{source_alias}/{source_period}/{run_id}/、curated/{universe}/{run_id}/、published/{catalog_version}/、quarantine/{run_id}/、manifests/{run_id}.json。raw與published啟用版本化；data_catalog.json以條件式Put或原子替換切換。")
    add_table(doc, ["發布物件", "Athena表", "分區鍵", "前端用途"], [
        ["01_戶籍人口母體_長格式.csv", "registered_population_metrics", "roc_year、geography_level", "地圖與戶籍區塊"],
        ["02_民間人口與勞動市場母體_長格式.csv", "labor_market_metrics", "roc_year", "勞動區塊"],
        ["03_受僱員工薪資母體_長格式.csv", "employee_wage_metrics", "roc_year", "薪資區塊"],
    ], [3000, 2600, 1800, 1960])
    doc.add_heading("4. 每日更新狀態機", level=1)
    add_picture_with_alt(doc, diagrams["daily"], "每日檢查來源變更、資料驗證與發布切換流程")
    add_steps(doc, [
        "ComputeWindow：以Asia/Taipei執行日計算民國年；start=currentRoc−5，end=currentRoc−1。",
        "ProbeSources：檢查各官方來源的ETag、Last-Modified、Content-Length、資料期與現有SHA-256。",
        "Choice：全部未變更則寫NO_CHANGE並結束；任一變更則進Acquire。",
        "Acquire：保存每個分頁請求URL、HTTP狀態、列數與原始檔SHA-256；不覆蓋舊快照。",
        "Transform：人口Lambda；教育／婚姻Glue；勞動與薪資依年度表解析；產出三CSV候選。",
        "MachineQA：schema、主鍵、百分比、公式、男女、29區、PCLM收斂、IPF邊際與年份窗。",
        "HumanApproval：SNS／人工核准；重大schema或官方修訂必須人工查核。",
        "Promote：寫入versioned published路徑並原子更新data_catalog.json；失敗移quarantine。",
    ])
    doc.add_heading("5. Kiro規格驅動操作", level=1)
    add_table(doc, ["Kiro檔案", "內容", "完成定義"], [
        [".kiro/steering/g5-data-governance.md", "三母體、年度窗、中文前端、不得混分母", "所有生成程式與測試必須遵守"],
        [".kiro/specs/ntpc-youth-g5/requirements.md", "資料、介接、QA、地圖、ChatBot的需求與驗收", "需求有可測ID"],
        ["design.md", "S3、Step Functions、Glue、Athena、AgentCore與前端架構", "含失敗路徑與權限"],
        ["tasks.md", "分階段實作、測試、部署與回復", "每項可單獨驗證"],
    ], [2600, 4100, 2660])
    add_callout(doc, "給Kiro的指令", "先讀steering與requirements，再根據design拆tasks；只修改agentcore JSON與自有IaC，禁止手改agentcore/cdk生成目錄。每次變更先跑schema validation、pytest、前端lint／build及CDK synth。", "info")
    doc.add_heading("6. 介接契約", level=1)
    add_table(doc, ["來源", "端點／方式", "分頁或參數", "失敗規則"], [
        ["人口", "ODRP014/{YYYMM}?page={page}", "page=1…totalPage；len=totalDataSize", "缺頁／重複／期間不符即失敗"],
        ["教育", "ODRP053/{YYY}或年度ZIP", "大檔優先ZIP；串流讀取", "檔案大小、schema或SHA異常即隔離"],
        ["婚姻", "ODRP052/{YYY}或年度ZIP", "年度、村里×性別×五歲×婚姻", "未知婚姻類別需人工判定"],
        ["NTPC OpenAPI", "dataset UUID JSON page/size", "讀到短頁；防重複頁", "低於最低預期列數即失敗"],
        ["OAS／DGBAS表", "官方下載或人工匯出", "保存表名、工作表、儲存格與雜湊", "禁止把網頁日期當資料期"],
    ], [1800, 3000, 2400, 2160], font_size=8.9)
    doc.add_heading("7. 安全、可靠性、效能與成本", level=1)
    add_table(doc, ["面向", "設計", "驗證"], [
        ["安全", "SSE-KMS、最小IAM、Secrets Manager、allowlist網域、CloudTrail", "Access Analyzer、金鑰輪替、秘密不進前端"],
        ["可靠性", "S3版本化、舊版持續服務、quarantine、Step Functions重試／DLQ", "演練來源逾時、schema漂移與部分失敗"],
        ["效能", "大型ZIP用Glue；三CSV按母體分表；Athena投影必要欄位", "記錄處理時間、掃描量與查詢P95"],
        ["成本", "每日先HEAD／雜湊再決定是否重算；年度來源未變不啟Glue", "Cost Explorer標籤、Budget與異常告警"],
    ], [1800, 4400, 3160])
    doc.add_heading("8. 部署與回復Gate", level=1)
    add_bullets(doc, [
        "部署前：AWS帳號、us-west-2區域、IAM角色、KMS、bucket名稱、網路出口與預算警報人工確認。",
        "測試：config schema、單元測試、整合測試、CDK synth、Athena樣本查詢、ChatBot評估、儀表板無障礙。",
        "發布：先dev，再staging，最後production；data_catalog以版本號切換。",
        "回復：將catalog指回前一通過版本；不得刪除失敗raw，保留事件與雜湊。",
        "本輪未取得額外部署裁示前，不執行agentcore deploy、cdk deploy或正式S3寫入。",
    ])
    doc.add_heading("9. 參考來源", level=1)
    add_standard_sources(doc, ["POP", "EDU", "MAR", "LAB", "WAGE", "NTPC", "OAS"])
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    return path


def build_chatbot_doc(package: Path, data: dict, diagrams: dict) -> Path:
    path = package / "07_AWS與Kiro" / "ChatBot_資料問答治理與操作.docx"
    doc = new_doc("DOC-G5-602", "ChatBot資料問答治理、工具與操作", "Bedrock AgentCore｜三母體查詢路由｜公式、來源與限制自動附帶")
    doc.add_heading("1. 問答設計結論", level=1)
    add_callout(doc, "核心規則", "ChatBot可以即時回答已發布資料，但答案必須先辨識母體、年度、年齡、地理與指標；無法辨識或資料不存在時詢問澄清或明確回報缺口，禁止猜測。", "ok")
    add_picture_with_alt(doc, diagrams["chatbot"], "ChatBot從使用者問題到受控查詢、公式查核與帶來源中文回答的流程")
    doc.add_heading("2. 允許的問答範圍", level=1)
    add_table(doc, ["問題類型", "資料來源", "可回答範例", "限制"], [
        ["行政區人口／教育／婚姻／性別", "戶籍人口CSV", "114年板橋區18–35歲人口與教育結構", "只限戶籍母體"],
        ["就業／失業／勞參率", "勞動市場CSV", "110–114年25–29歲失業率趨勢", "只限新北市整體"],
        ["平均薪資／中位數", "薪資CSV", "110–113年32列完整網格且均有值", "114年回報未發布；非25–29歲須回報模型身分"],
        ["跨母體並列", "三CSV分開查", "113年人口、失業率與薪資並列", "可並列，不做混合分母或因果推論"],
        ["方法與來源", "catalog＋方法文件", "18–35教育如何換算？", "說明PCLM／IPF、值身分與敏感度"],
    ], [2100, 1700, 3300, 2260])
    doc.add_heading("3. 工具設計", level=1)
    add_table(doc, ["工具", "輸入", "輸出", "安全限制"], [
        ["list_available_dimensions", "母體或指標", "可用年度、年齡、地理、性別、類別", "只讀data_catalog與distinct清單"],
        ["query_registered_metrics", "年度、行政區、年齡、性別、指標、類別", "值、單位、來源、方法、QA", "只能查戶籍表"],
        ["query_labor_metrics", "年度、年齡、指標", "P／LF／E／U或比率", "強制新北市整體"],
        ["query_wage_metrics", "年度、年齡、平均／中位", "薪資值或缺口原因", "只允許目前可發布組合"],
        ["explain_method", "method_code或中文指標", "公式、步驟、敏感度、限制", "不回傳內部秘密或raw個資"],
        ["get_source_evidence", "record_id", "來源URL、快照雜湊、抓取日、發布狀態", "不提供S3簽章raw網址給一般使用者"],
    ], [2300, 2300, 2200, 2560], font_size=8.8)
    doc.add_heading("4. 查詢與回覆契約", level=1)
    add_steps(doc, [
        "解析問題中的年度、年齡、地理、性別、類別與指標；缺一項但可由目前儀表板篩選補足時，明示使用該條件。",
        "根據中文指標路由到單一母體工具；若使用者同時問多母體，分別查詢後再並列。",
        "只使用參數化Athena SQL或固定API查詢；欄名、表名與metric_code採allowlist。",
        "取得value、unit、value_origin_label_zh、method_name_zh、period_basis、source_url、qa_status。",
        "用公式重新驗證可推導比率；不得讓模型自行心算大量值或變更分母。",
        "生成繁體中文答案，先答數值，再說母體／時間、值身分、方法、來源與限制。",
        "查無資料時回報可用組合與原因；例如114年薪資回報最近可用113年，但不自動替換。",
    ])
    doc.add_heading("5. 系統提示核心規則", level=1)
    add_callout(doc, "必要內容", "每個數值答案至少包含：中文指標、年度／時間基準、年齡、地理、數值與單位、母體、官方或估計身分、方法、來源連結及限制。", "info")
    add_bullets(doc, [
        "不得把戶籍人口當P民間人口，也不得用戶籍人口計算失業率、勞參率或就業人口比率。",
        "不得把工作場所薪資當新北戶籍青年的個人薪資。",
        "不得把年度值拆成月值；人口月資料與勞動年度平均分開說明。",
        "不得將方法敏感度包絡稱為95%信賴區間。",
        "不得回答尚未發布或QA失敗的候選資料；回報資料正在查核。",
        "不得把內部代號直接當使用者主要答案；代號只在方法附註出現。",
    ])
    doc.add_heading("6. 回答範例", level=1)
    add_table(doc, ["使用者問題", "合格回答骨架"], [
        ["114年18–35歲失業率多少？", "先答114年新北市18–35歲失業率；再說這是人力資源調查全年平均、PCLM換算估計，分母為勞動力，並附官方來源與敏感度。"],
        ["板橋區的勞參率？", "說明官方來源只發布新北市整體，無板橋區可發布勞參率；不得按戶籍人口比例拆分。可改查板橋區戶籍人口、教育、婚姻或性別。"],
        ["114年18–35平均薪資？", "回報114年尚無可比的新北市表6資料；最近可用113年，詢問是否改查113，不自動帶值。"],
        ["教育高會不會薪資高？", "可並列教育與薪資描述，但母體與地理不同，不能由本資料判定因果；建議取得受僱員工個體教育×薪資微資料。"],
    ], [3000, 6360])
    doc.add_heading("7. 評估與監控", level=1)
    add_table(doc, ["評估", "門檻", "失敗處理"], [
        ["母體路由正確率", "100%治理測試題", "阻擋發布"],
        ["數值一致率", "與CSV完全一致；允許格式化誤差", "阻擋發布"],
        ["來源與時間附帶率", "100%數值答案", "重新生成或降級"],
        ["不可用資料拒答率", "100%", "阻擋發布"],
        ["SQL安全", "只通過allowlist與參數化查詢", "拒絕請求並記錄"],
        ["延遲", "P95目標<5秒；逾時提供重試", "顯示可恢復錯誤"],
    ], [2800, 3000, 3560])
    doc.add_heading("8. 隱私與資安", level=1)
    add_para(doc, "三份CSV均為公開彙總資料，不含個人識別資訊；仍應限制ChatBot工具只讀published前綴、遮蔽AWS秘密、啟用CloudTrail與應用日誌，並避免把完整使用者問題無期限保存。")
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    return path


def build_review_doc(package: Path, data: dict, diagrams: dict) -> Path:
    path = package / "08_人工查核與異常處理" / "人工查核SOP與查核表.docx"
    doc = new_doc("DOC-G5-701", "人工查核SOP與查核表", "Notion長文式逐Gate查核｜來源、方法、數值、儀表板、AWS與ChatBot")
    doc.add_heading("1. 使用方式", level=1)
    add_callout(doc, "查核原則", "機器PASS只代表規則通過，不等於可以發布。來源版本、定義變更、模型合理性、圖表敘述與AWS權限仍需指定人員簽核。", "warn")
    add_steps(doc, [
        "每次來源變更建立run_id與candidate版本；將本表複製一份，填入查核人、日期與證據路徑。",
        "Gate依序執行；任何『阻擋』項目不通過即停止，不可跳到發布。",
        "若需裁示，記錄決策ID、選項、理由、影響範圍與生效版本。",
        "全部通過後更新data_catalog.json；若發布後發現錯誤，立即回復前版並啟動事件紀錄。",
    ])
    doc.add_heading("2. Gate A｜來源與介接", level=1)
    add_table(doc, ["☐", "查核ID", "查核事項", "合格門檻", "證據／結果", "簽核"], [
        ["☐", "SRC-01", "來源網域與資料集", "官方data.gov.tw、data.ntpc.gov.tw、OAS、stat.gov.tw或ris.gov.tw", "", ""],
        ["☐", "SRC-02", "人口API分頁", "page 1…totalPage完整且len=totalDataSize", "", ""],
        ["☐", "SRC-03", "資料期", "統計期與預期年度一致；抓取日未冒充資料期", "", ""],
        ["☐", "SRC-04", "ZIP／工作簿完整性", "大小合理、可開啟、SHA-256已記錄", "", ""],
        ["☐", "SRC-05", "命題三平台", "data.ntpc、OAS、stat均有來源或交叉查核紀錄", "", ""],
    ], [500, 1000, 2700, 3000, 1400, 760], font_size=8.6)
    doc.add_heading("3. Gate B｜定義與母體", level=1)
    add_table(doc, ["☐", "查核ID", "查核事項", "合格門檻", "需人工裁示情境", "簽核"], [
        ["☐", "DEF-01", "戶籍人口", "標示戶籍登記地與年末存量", "來源改稱常住人口或實際居住人口", ""],
        ["☐", "DEF-02", "勞動市場", "P、LF、E、U同一調查母體與期間", "表版或納入排除變更", ""],
        ["☐", "DEF-03", "薪資", "工作場所、本國籍、全時受僱員工與統計量明確", "母體註解或表6欄位變更", ""],
        ["☐", "DEF-04", "時間", "人口12月31日、勞動全年平均、薪資全年統計分開", "欲跨時間基準作一個綜合分數", ""],
        ["☐", "DEF-05", "年齡", "18–24、25–29、30–35、18–35；36–40與15–17不計核心", "政策年齡重新定義", ""],
    ], [500, 1000, 2500, 2700, 1900, 760], font_size=8.6)
    doc.add_heading("4. Gate C｜方法與數值", level=1)
    add_table(doc, ["☐", "查核ID", "查核事項", "門檻", "本版結果", "簽核"], [
        ["☐", "MTH-01", "25–29原生值", "與官方儲存格／五歲組完全一致", "通過", ""],
        ["☐", "MTH-02", "PCLM收斂", "所有必要類別收斂且診斷已保存", "通過", ""],
        ["☐", "MTH-03", "IPF邊際", "列欄最大誤差<1×10⁻⁶", "最大<1×10⁻⁷", ""],
        ["☐", "MTH-04", "階層", "29區加總=新北市", "通過；全市採區加總", ""],
        ["☐", "MTH-05", "男女", "男＋女=合計", "通過", ""],
        ["☐", "MTH-06", "勞動公式", "LF=E+U、NLF=P−LF、UR+ESLF=100%", "140項通過", ""],
        ["☐", "MTH-07", "方法敏感度", "PCLM與替代法已記錄low/high並註明非CI", "通過", ""],
        ["☐", "MTH-08", "薪資年齡換算", "25–29原生值不變；其餘平均數有錨定、輔助輪廓、low/high與模型標示", "通過", ""],
        ["☐", "MTH-09", "薪資中位數／性別缺口", "非25–29中位數須保留分布模型與敏感度標籤；男女薪資仍不補造", "通過", ""],
    ], [500, 1000, 2700, 2100, 2300, 760], font_size=8.6)
    doc.add_heading("5. Gate D｜行政區抽查", level=1)
    add_callout(doc, "婚姻人工抽查來源", "優先從戶政司ODRP052年度API或同年度ZIP抽查；選一個大區（板橋／新莊等）與一個小區（平溪／坪林等），再選25–29官方原生組與一個模型邊界組。", "info")
    add_table(doc, ["☐", "抽查", "建議樣本", "對照欄位", "合格判定", "結果"], [
        ["☐", "人口", "2區×2年×男女", "單歲18、19、25–29、35", "CSV直接加總一致", ""],
        ["☐", "教育", "2區×2年×25–29", "五類人數", "CSV官方原生值一致", ""],
        ["☐", "婚姻", "2區×2年×25–29", "未婚／有偶／離婚／喪偶", "CSV官方原生值一致", ""],
        ["☐", "邊界模型", "同樣樣本的18–24或30–35", "low≤value≤high、類別合計=人口", "通過且估計標示正確", ""],
    ], [500, 1300, 2000, 2700, 2200, 660])
    doc.add_heading("6. Gate E｜儀表板與ChatBot", level=1)
    add_table(doc, ["☐", "查核ID", "查核事項", "合格門檻", "結果", "簽核"], [
        ["☐", "UI-01", "中文呈現", "標題、圖例、坐標軸、篩選器無內部代號", "", ""],
        ["☐", "UI-02", "行政區作用域", "只更新戶籍區塊；勞動薪資仍標新北市整體", "", ""],
        ["☐", "UI-03", "114薪資空狀態", "不補113；顯示最近可用與原因", "", ""],
        ["☐", "UI-04", "無障礙", "鍵盤、焦點、對比、表格替代、減少動態", "", ""],
        ["☐", "BOT-01", "母體路由", "治理題100%正確", "", ""],
        ["☐", "BOT-02", "答案證據", "數值、母體、期間、方法、來源與限制齊全", "", ""],
        ["☐", "BOT-03", "缺資料拒答", "不猜測、不跨年靜默替代", "", ""],
    ], [500, 1000, 2800, 3000, 1300, 760], font_size=8.6)
    doc.add_heading("7. Gate F｜AWS發布", level=1)
    add_table(doc, ["☐", "查核ID", "查核事項", "合格門檻", "結果", "簽核"], [
        ["☐", "AWS-01", "IAM／KMS／S3", "最小權限、版本化、加密、正式前綴禁止直接覆寫", "", ""],
        ["☐", "AWS-02", "排程", "09:15 Asia/Taipei；來源未變不啟Glue", "", ""],
        ["☐", "AWS-03", "候選與正式", "QA＋人工Gate通過才更新catalog", "", ""],
        ["☐", "AWS-04", "回復", "可將catalog指回前一PASS版本", "", ""],
        ["☐", "AWS-05", "成本", "Budget、標籤與異常告警設定", "", ""],
    ], [500, 1000, 3000, 3100, 1000, 760])
    doc.add_heading("8. 決策與異常紀錄模板", level=1)
    add_table(doc, ["欄位", "填寫內容"], [
        ["事件／決策ID", ""],
        ["發現時間與run_id", ""],
        ["影響母體／年度／指標／行政區", ""],
        ["來源與證據路徑", ""],
        ["原定義與新定義", ""],
        ["可選處置", "阻擋、重抓、重算、降級、回復、發布附註"],
        ["裁示與理由", ""],
        ["負責人、覆核人與完成時間", ""],
    ], [2600, 6760])
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    return path


def copy_reproducible_assets(package: Path):
    target = package / "05_年齡轉換與統計方法" / "reproducible_scripts"
    target.mkdir(parents=True, exist_ok=True)
    for source in (
        PROJECT / "scripts" / "build_g5_v3_data.py",
        PROJECT / "scripts" / "build_g5_source_manifest.py",
        PROJECT / "scripts" / "validate_g5_v3_data.py",
        PROJECT / "scripts" / "export_g5_dashboard_json.py",
        PROJECT / "scripts" / "analyze_annual_labor_age_graduation_v24.py",
        PROJECT / "scripts" / "process_marital_status_v23.py",
        REFRESH_POLICY,
    ):
        shutil.copy2(source, target / source.name)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, default=DEFAULT_PACKAGE)
    args = parser.parse_args()
    package = args.package.resolve()
    data = load_inputs(package)
    diagrams = make_diagrams(package)
    builders: list[Callable[[Path, dict, dict], Path]] = [
        build_overview,
        build_universe_dictionary,
        build_population_doc,
        build_education_doc,
        build_marriage_doc,
        build_labor_doc,
        build_wage_doc,
        build_dashboard_doc,
        build_aws_kiro_doc,
        build_chatbot_doc,
        build_review_doc,
    ]
    outputs = [builder(package, data, diagrams) for builder in builders]
    copy_reproducible_assets(package)
    manifest = {
        "version": VERSION,
        "generated_date": date.today().isoformat(),
        "documents": [str(path.relative_to(package)).replace("\\", "/") for path in outputs],
        "diagrams": [str(path.relative_to(package)).replace("\\", "/") for path in diagrams.values()],
        "preset": "standard_business_brief",
        "first_page_pattern": "memo_masthead",
    }
    manifest_path = package / "00_總覽與治理" / "document_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

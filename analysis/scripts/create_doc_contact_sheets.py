from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

PROJECT = Path(__file__).resolve().parents[1]
PACKAGE = PROJECT / "deliverables" / "NTPC_Youth_Three_Universe_Data_Package_G5_V3.0_20260826"
SOURCE = PACKAGE / "08_人工查核與異常處理" / "docx_render_final"
OUTPUT = PACKAGE / "08_人工查核與異常處理" / "machine_qa" / "docx_contact_sheets_final"


def font(size: int):
    for path in [Path("C:/Windows/Fonts/msjh.ttc"), Path("C:/Windows/Fonts/msjh.ttf")]:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


OUTPUT.mkdir(parents=True, exist_ok=True)
for document_dir in sorted(item for item in SOURCE.iterdir() if item.is_dir()):
    pages = sorted(document_dir.glob("page-*.png"))
    if not pages:
        continue
    thumb_width, thumb_height = 780, 1050
    header_height, gutter = 70, 26
    rows = (len(pages) + 1) // 2
    sheet = Image.new("RGB", (thumb_width * 2 + gutter * 3, header_height + rows * (thumb_height + gutter) + gutter), "#dbe4ea")
    draw = ImageDraw.Draw(sheet)
    draw.text((gutter, 18), f"{document_dir.name}｜{len(pages)}頁", fill="#0b2f4a", font=font(26))
    for index, page_path in enumerate(pages):
        image = Image.open(page_path).convert("RGB")
        image.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        x = gutter + (index % 2) * (thumb_width + gutter)
        y = header_height + gutter + (index // 2) * (thumb_height + gutter)
        sheet.paste(image, (x, y))
        draw.rectangle((x, y, x + image.width - 1, y + image.height - 1), outline="#7b8e9a", width=2)
        draw.rectangle((x + 8, y + 8, x + 78, y + 42), fill="#0b2f4a")
        draw.text((x + 17, y + 11), f"P{index + 1}", fill="white", font=font(18))
    sheet.save(OUTPUT / f"{document_dir.name}.png", quality=92)

print(f"Created {len(list(OUTPUT.glob('*.png')))} contact sheets in {OUTPUT}")

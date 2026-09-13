from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


DEFAULT_RENDER_DIR = Path(r"D:\github\work\019fe05e-e1a3-71f2-840e-c026180d9474\NtpcYouthAI\deliverables\NTPC_Youth_Demographic_Education_Wage_Method_Draft_V0.1_20260825\rendered")
FONT = ImageFont.truetype(r"C:\Windows\Fonts\msjhbd.ttc", 28)


def page_number(path: Path) -> int:
    return int(path.stem.split("-")[-1])


def main() -> None:
    render_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_RENDER_DIR
    out_dir = render_dir / "contact_sheets"
    out_dir.mkdir(parents=True, exist_ok=True)
    pages = sorted(render_dir.glob("page-*.png"), key=page_number)
    for sheet_idx in range(0, len(pages), 4):
        batch = pages[sheet_idx:sheet_idx + 4]
        thumbs = []
        for path in batch:
            image = Image.open(path).convert("RGB")
            image.thumbnail((760, 1000))
            thumbs.append((path, image.copy()))
        canvas = Image.new("RGB", (1660, 2180), "#D9E1E6")
        draw = ImageDraw.Draw(canvas)
        for idx, (path, image) in enumerate(thumbs):
            col, row = idx % 2, idx // 2
            x = 40 + col * 810
            y = 80 + row * 1040
            canvas.paste(image, (x, y))
            draw.text((x, y - 42), f"Page {page_number(path)}", font=FONT, fill="#173A5E")
        out = out_dir / f"contact-{sheet_idx // 4 + 1}.png"
        canvas.save(out)
        print(out)


if __name__ == "__main__":
    main()

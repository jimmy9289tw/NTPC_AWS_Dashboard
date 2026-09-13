from __future__ import annotations

import argparse
from pathlib import Path

import pypdfium2 as pdfium


def main() -> None:
    parser = argparse.ArgumentParser(description="Render one PDF page in an isolated process.")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("page", type=int, help="One-based page number")
    parser.add_argument("--scale", type=float, default=2.0)
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(str(args.pdf))
    page_index = args.page - 1
    if page_index < 0 or page_index >= len(document):
        raise SystemExit(f"Page {args.page} is outside 1..{len(document)}")
    document[page_index].render(scale=args.scale).to_pil().save(str(args.output))
    # Keep the document alive until process exit. Some embedded CJK fonts are
    # backed by PDFium buffers and may render incompletely if closed early.


if __name__ == "__main__":
    main()

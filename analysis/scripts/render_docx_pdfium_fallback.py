from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pypdfium2 as pdfium


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("docx")
    parser.add_argument("output_dir")
    args = parser.parse_args()

    docx = Path(args.docx).resolve()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    soffice = Path(r"C:\Program Files\LibreOffice\program\soffice.exe")
    if not soffice.exists():
        raise FileNotFoundError(soffice)

    with tempfile.TemporaryDirectory(prefix="docx_pdfium_") as temp_dir:
        env = dict(os.environ)
        env["PATH"] = str(soffice.parent) + os.pathsep + env.get("PATH", "")
        profile = Path(temp_dir) / "profile"
        convert_dir = Path(temp_dir) / "convert"
        profile.mkdir()
        convert_dir.mkdir()
        cmd = [
            str(soffice),
            f"-env:UserInstallation={profile.as_uri()}",
            "--invisible",
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
            str(convert_dir),
            str(docx),
        ]
        run = subprocess.run(cmd, env=env, capture_output=True, text=True, check=False)
        pdfs = list(convert_dir.glob("*.pdf"))
        if run.returncode != 0 or not pdfs:
            raise RuntimeError(f"LibreOffice failed: {run.returncode}\n{run.stdout}\n{run.stderr}")
        pdf_path = pdfs[0]
        shutil.copy2(pdf_path, output / f"{docx.stem}.pdf")
        pdf = pdfium.PdfDocument(pdf_path)
        for index in range(len(pdf)):
            page = pdf[index]
            bitmap = page.render(scale=2.1)
            bitmap.to_pil().save(output / f"page-{index + 1}.png")
            bitmap.close()
            page.close()
        pdf.close()


if __name__ == "__main__":
    main()

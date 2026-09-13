from __future__ import annotations

import csv
import hashlib
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
PACKAGE = PROJECT / "deliverables" / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826"
OUTPUT = PACKAGE / "FILE_MANIFEST_SHA256.csv"


def is_release_file(path: Path) -> bool:
    """Return True for files that belong in the user-facing release archive.

    Rendered page images and renderer-generated PDFs are internal visual-QA
    intermediates.  The durable QA JSON reports remain included.
    """
    relative = path.relative_to(PACKAGE)
    if any("_render" in part.lower() for part in relative.parts):
        return False
    if any(part.lower() == "__pycache__" for part in relative.parts):
        return False
    return path.suffix.lower() not in {".pyc"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    files = sorted(
        path for path in PACKAGE.rglob("*")
        if (
            path.is_file()
            and path.resolve() != OUTPUT.resolve()
            and is_release_file(path)
        )
    )
    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=["relative_path", "size_bytes", "sha256"])
        writer.writeheader()
        for path in files:
            writer.writerow({
                "relative_path": path.relative_to(PACKAGE).as_posix(),
                "size_bytes": path.stat().st_size,
                "sha256": sha256(path),
            })
    print(f"manifest_rows={len(files)} output={OUTPUT}")


if __name__ == "__main__":
    main()

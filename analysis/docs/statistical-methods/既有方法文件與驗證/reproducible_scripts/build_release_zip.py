from __future__ import annotations

import argparse
import hashlib
import zipfile
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
PACKAGE = PROJECT / "deliverables" / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826"
DEFAULT_OUTPUT = PROJECT / "deliverables" / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826_R2.zip"


def is_release_file(path: Path) -> bool:
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    output = args.output.resolve()
    files = sorted(
        path for path in PACKAGE.rglob("*")
        if path.is_file() and is_release_file(path)
    )
    if not (PACKAGE / "FILE_MANIFEST_SHA256.csv").is_file():
        raise FileNotFoundError("FILE_MANIFEST_SHA256.csv must be rebuilt before packaging")

    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()

    with zipfile.ZipFile(
        output,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=6,
        allowZip64=True,
    ) as archive:
        for path in files:
            archive.write(path, arcname=(Path(PACKAGE.name) / path.relative_to(PACKAGE)).as_posix())

    with zipfile.ZipFile(output, mode="r") as archive:
        bad_member = archive.testzip()
        member_count = len(archive.infolist())
    if bad_member is not None:
        raise RuntimeError(f"ZIP integrity test failed at {bad_member}")
    if member_count != len(files):
        raise RuntimeError(f"ZIP member mismatch: expected {len(files)}, got {member_count}")

    print(f"output={output}")
    print(f"files={member_count}")
    print(f"size_bytes={output.stat().st_size}")
    print(f"sha256={sha256(output)}")


if __name__ == "__main__":
    main()

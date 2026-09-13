from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


def resolve_project_root() -> Path:
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "config" / "g5-refresh-policy.json").is_file() and (candidate / "scripts").is_dir():
            return candidate
    raise RuntimeError("Cannot locate NtpcYouthAI project root")


PROJECT = resolve_project_root()
DEFAULT_PACKAGE = PROJECT / "deliverables" / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826"
PUBLICATION_FILES = (
    "01_戶籍人口母體_長格式.csv",
    "02_民間人口與勞動市場母體_長格式.csv",
    "03_受僱員工薪資母體_長格式.csv",
    "06_政策服務與曝光_長格式.csv",
)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def source_role(source_id: str, composite_alias: str) -> str:
    if f"QA:{source_id}" in composite_alias:
        return "QA_RECONCILIATION"
    if f"AUX:{source_id}" in composite_alias:
        return "AUXILIARY_AGE_SPLIT"
    if source_id == "MOI-POP1Y" and composite_alias != source_id:
        return "CALIBRATION_MARGIN"
    if source_id == "BLI-AGE-REGION-SEX":
        return "AUXILIARY_WEIGHT"
    if source_id == "BLI-PENSION-AGE-WAGE":
        return "AUXILIARY_AGE_PROFILE"
    if source_id == "STAT-WAGE-LOC":
        return "PRIMARY_WAGE_ANCHOR"
    if source_id == "NTPC-LAND-AREA" and composite_alias != source_id:
        return "GEOGRAPHY_DENOMINATOR"
    if source_id == "NTPC-LAND-AREA":
        return "PRIMARY_GEOGRAPHY_REFERENCE"
    if source_id == "NTPC-YOUTH-ANNUAL":
        return "PRIMARY_SERVICE_ADMIN"
    if source_id == "NTPC-YOUTH-CAREER-BASE-113":
        return "PRIMARY_SERVICE_CASE_ANALYSIS"
    if source_id == "NTPC-YOUTH-BASE-PAGES":
        return "PRIMARY_SERVICE_FACILITY_INVENTORY"
    return "PRIMARY"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, default=DEFAULT_PACKAGE)
    args = parser.parse_args()
    package = args.package.resolve()
    publish = package / "09_發布資料包"

    registry = json.loads((PROJECT / "config" / "source-registry-normalized.json").read_text(encoding="utf-8"))
    sources = registry["sources"]
    source_by_id = {item["sourceId"]: item for item in sources}
    source_ids = sorted(source_by_id, key=len, reverse=True)

    source_rows = [
        {
            "source_id": item["sourceId"],
            "source_name_zh": item["nameZh"],
            "owner_zh": item["ownerZh"],
            "official_url": item["officialUrl"],
            "refresh_cadence": item["refreshCadence"],
            "default_role": item["defaultRole"],
            "data_class": registry["dataClass"],
            "registry_version": registry["registryVersion"],
        }
        for item in sources
    ]
    write_csv(
        publish / "04_來源主檔.csv",
        ["source_id", "source_name_zh", "owner_zh", "official_url", "refresh_cadence", "default_role", "data_class", "registry_version"],
        source_rows,
    )

    lineage_rows: list[dict[str, str]] = []
    record_count = 0
    unresolved: set[str] = set()
    for filename in PUBLICATION_FILES:
        for row in read_csv(publish / filename):
            record_count += 1
            composite = row["source_alias"]
            matched = [source_id for source_id in source_ids if source_id in composite]
            if not matched:
                unresolved.add(composite)
                continue
            for source_id in matched:
                item = source_by_id[source_id]
                official_url = (
                    row["source_url"]
                    if source_id.startswith("DGBAS-HR-") or source_id.startswith("NTPC-YOUTH-")
                    else item["officialUrl"]
                )
                lineage_rows.append(
                    {
                        "record_id": row["record_id"],
                        "universe_code": row["universe_code"],
                        "roc_year": row["roc_year"],
                        "metric_code": row["metric_code"],
                        "source_id": source_id,
                        "source_role": source_role(source_id, composite),
                        "official_url": official_url,
                        "source_snapshot": row["source_snapshot"],
                        "record_source_bundle_sha256": row["source_sha256"],
                    }
                )

    if unresolved:
        raise RuntimeError(f"Unresolved source aliases: {sorted(unresolved)}")
    linked_records = {row["record_id"] for row in lineage_rows}
    if len(linked_records) != record_count:
        raise RuntimeError(f"Lineage coverage mismatch: {len(linked_records)} of {record_count} records")

    write_csv(
        publish / "05_資料列來源關聯.csv",
        [
            "record_id",
            "universe_code",
            "roc_year",
            "metric_code",
            "source_id",
            "source_role",
            "official_url",
            "source_snapshot",
            "record_source_bundle_sha256",
        ],
        lineage_rows,
    )

    catalog_path = publish / "data_catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["normalizedLineage"] = {
        "registryVersion": registry["registryVersion"],
        "sourceDimension": "04_來源主檔.csv",
        "recordSourceBridge": "05_資料列來源關聯.csv",
        "recordCoverage": record_count,
        "bridgeRows": len(lineage_rows),
    }
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"records": record_count, "sources": len(source_rows), "lineageRows": len(lineage_rows), "status": "PASS"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

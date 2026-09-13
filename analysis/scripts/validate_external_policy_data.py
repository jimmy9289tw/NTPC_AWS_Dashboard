from __future__ import annotations

import csv
import json
import math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
PACKAGE = PROJECT / "deliverables" / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826"
PUBLISH = PACKAGE / "09_發布資料包"
QA_OUTPUT = PACKAGE / "08_人工查核與異常處理" / "machine_qa" / "external_policy_data_validation_detailed.json"


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


checks: list[dict[str, object]] = []


def check(check_id: str, condition: bool, observed: object, expected: object) -> None:
    checks.append({
        "check_id": check_id,
        "status": "PASS" if condition else "FAIL",
        "observed": observed,
        "expected": expected,
    })


def main() -> int:
    registered = read_rows(PUBLISH / "01_戶籍人口母體_長格式.csv")
    labor = read_rows(PUBLISH / "02_民間人口與勞動市場母體_長格式.csv")
    wage = read_rows(PUBLISH / "03_受僱員工薪資母體_長格式.csv")
    service = read_rows(PUBLISH / "06_政策服務與曝光_長格式.csv")
    integration_rules = read_rows(PUBLISH / "08_外部政策資料與三母體介接規則.csv")
    area_processed = read_rows(
        PACKAGE / "10_官方原始資料與處理結果" / "07_行政區面積與政策服務" /
        "processed" / "NTPC_District_Land_Area_Official.csv"
    )
    inventory = read_rows(
        PACKAGE / "10_官方原始資料與處理結果" / "07_行政區面積與政策服務" /
        "processed" / "NTPC_Youth_Service_Facility_Inventory.csv"
    )
    capacities = read_rows(
        PACKAGE / "10_官方原始資料與處理結果" / "07_行政區面積與政策服務" /
        "processed" / "NTPC_Youth_Service_Capacity_Components.csv"
    )

    check("ROW-REGISTERED", len(registered) == 39150, len(registered), 39150)
    check("ROW-LABOR-UNCHANGED", len(labor) == 180, len(labor), 180)
    check("ROW-WAGE-UNCHANGED", len(wage) == 32, len(wage), 32)
    check("ROW-SERVICE-AUX", len(service) == 204, len(service), 204)
    check("INTEGRATION-RULES", len(integration_rules) == 10, len(integration_rules), 10)

    all_records = registered + labor + wage + service
    record_counts = Counter(row["record_id"] for row in all_records)
    duplicate_ids = [record_id for record_id, count in record_counts.items() if count > 1]
    check("RECORD-ID-UNIQUE", not duplicate_ids, duplicate_ids[:10], [])

    area_rows = [row for row in registered if row["metric_code"] == "LAND_AREA_KM2"]
    density_rows = [
        row for row in registered
        if row["metric_code"] == "REGISTERED_YOUTH_POPULATION_DENSITY_PER_KM2"
    ]
    population_rows = [row for row in registered if row["metric_code"] == "REGISTERED_POPULATION_COUNT"]
    check("AREA-ROWS", len(area_rows) == 150, len(area_rows), 150)
    check("DENSITY-ROWS", len(density_rows) == 1800, len(density_rows), 1800)
    check("AREA-PROCESSED-GEOS", len(area_processed) == 30, len(area_processed), 30)

    district_areas = [row for row in area_processed if row["geography_code"] != "65000000"]
    district_names = {row["geography_name_zh"] for row in district_areas}
    area_sum = sum(float(row["area_km2"]) for row in district_areas)
    check("AREA-29-DISTRICTS", len(district_areas) == 29 and len(district_names) == 29,
          {"rows": len(district_areas), "unique_names": len(district_names)}, 29)
    check("AREA-CITY-SUM", math.isclose(area_sum, 2052.57, abs_tol=0.005), round(area_sum, 6), 2052.57)

    pop_index = {
        (row["roc_year"], row["geography_code"], row["age_band"], row["sex_code"]): float(row["value"])
        for row in population_rows
    }
    density_failures = []
    for row in density_rows:
        key = (row["roc_year"], row["geography_code"], row["age_band"], row["sex_code"])
        population = pop_index.get(key)
        area = float(row["denominator"])
        expected = population / area if population is not None else None
        if population is None or not math.isclose(float(row["numerator"]), population, abs_tol=1e-9) or not math.isclose(float(row["value"]), expected, abs_tol=1e-6):
            density_failures.append(row["record_id"])
    check("DENSITY-FORMULA-ALL", not density_failures, density_failures[:10], [])

    for year in (111, 112, 113, 114):
        year_rows = [
            row for row in service
            if row["roc_year"] == str(year)
            and row["metric_code"] == "SERVICE_PARTICIPATION_PERSON_TIMES"
            and row["category_dimension_code"] == "SERVICE_DOMAIN"
        ]
        for domain in ("CAREER_DEVELOPMENT", "ENTREPRENEURSHIP"):
            values = {row["sex_code"]: float(row["value"]) for row in year_rows if row["category_code"] == domain}
            ok = {"ALL", "M", "F"}.issubset(values) and math.isclose(values["ALL"], values["M"] + values["F"], abs_tol=1e-9)
            check(f"SERVICE-SEX-SUM-{year}-{domain}", ok, values, "ALL=M+F")

    published_empty = [
        row["record_id"] for row in service
        if row["publish_status"].startswith("PUBLISH") and row["value"] == ""
    ]
    exposure_rows = [
        row for row in service
        if row["metric_code"] == "SERVICE_PERSON_TIMES_PER_ACTIVITY"
        and row["category_dimension_code"] == "SERVICE_DOMAIN"
        and row["sex_code"] == "ALL"
    ]
    check("SERVICE-PUBLISHED-NOT-EMPTY", not published_empty, published_empty, [])
    check(
        "EXPOSURE-INTENSITY-PUBLISH",
        len(exposure_rows) == 8 and all(row["value"] != "" and row["unit"] == "人次／場" and row["publish_status"].startswith("PUBLISH") for row in exposure_rows),
        [{"year": row["roc_year"], "domain": row["category_code"], "value": row["value"], "status": row["publish_status"]} for row in exposure_rows],
        "eight published domain-year exposure-intensity rows",
    )
    check("FACILITY-INVENTORY", len(inventory) == 11, len(inventory), 11)
    active_count = sum(row["operating_status"] == "ACTIVE" for row in inventory)
    check("FACILITY-ACTIVE", active_count == 10, active_count, 10)
    check("CAPACITY-COMPONENTS", len(capacities) == 16, len(capacities), 16)

    cross_contamination = [
        row["record_id"] for row in labor + wage
        if row["universe_code"] == "YOUTH_POLICY_SERVICE_ADMIN" or "NTPC-YOUTH" in row["source_alias"]
    ]
    check("THREE-UNIVERSE-BOUNDARY", not cross_contamination, cross_contamination[:10], [])

    source_rows = read_rows(PUBLISH / "04_來源主檔.csv")
    source_aliases = {row["source_id"] for row in source_rows}
    required_aliases = {
        "NTPC-LAND-AREA", "NTPC-YOUTH-ANNUAL",
        "NTPC-YOUTH-CAREER-BASE-113", "NTPC-YOUTH-BASE-PAGES",
    }
    check("SOURCE-REGISTRY-EXTERNAL", required_aliases.issubset(source_aliases),
          sorted(required_aliases & source_aliases), sorted(required_aliases))

    bridge_rows = read_rows(PUBLISH / "05_資料列來源關聯.csv")
    covered_records = {row["record_id"] for row in bridge_rows}
    missing_lineage = set(record_counts) - covered_records
    check("LINEAGE-COVERAGE", not missing_lineage,
          {"covered": len(covered_records), "missing": len(missing_lineage)},
          {"covered": len(record_counts), "missing": 0})

    failures = [item for item in checks if item["status"] == "FAIL"]
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "status": "PASS" if not failures else "FAIL",
        "check_count": len(checks),
        "failure_count": len(failures),
        "checks": checks,
    }
    QA_OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(QA_OUTPUT),
        "status": report["status"],
        "check_count": report["check_count"],
        "failure_count": report["failure_count"],
    }, ensure_ascii=False, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())

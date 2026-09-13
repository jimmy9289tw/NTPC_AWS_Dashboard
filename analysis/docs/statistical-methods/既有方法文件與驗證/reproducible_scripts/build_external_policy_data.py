from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import shutil
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_PACKAGE = PROJECT / "deliverables" / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826"
CONFIG = PROJECT / "config" / "external-policy-service-data.json"
AREA_RAW = PROJECT / "data" / "raw" / "NTPC-LAND-AREA" / "20260831" / "NTPC-DISTRICT-LAND-AREA.csv"
AREA_PAGE = PROJECT / "data" / "raw" / "NTPC-LAND-AREA" / "20260831" / "dataset-page.html"
SERVICE_RAW = PROJECT / "data" / "raw" / "NTPC-YOUTH-SERVICE" / "20260831"
PROCESSED = PROJECT / "data" / "processed" / "NTPC-EXTERNAL-POLICY" / "20260831"

AREA_URL = "https://data.ntpc.gov.tw/datasets/13f881c7-53c4-4f8c-b693-816584562666"
AREA_API = "https://data.ntpc.gov.tw/api/datasets/13f881c7-53c4-4f8c-b693-816584562666/csv"
EXTERNAL_METRICS = {"LAND_AREA_KM2", "REGISTERED_YOUTH_POPULATION_DENSITY_PER_KM2"}

SCHEMA_FIELDS = [
    "record_id", "roc_year", "gregorian_year", "source_period", "period_basis",
    "universe_code", "universe_name_zh", "geography_code", "geography_name_zh",
    "geography_level", "geography_role_zh", "age_band", "sex_code", "sex_name_zh",
    "category_dimension_code", "category_dimension_name_zh", "category_code",
    "category_name_zh", "metric_code", "metric_name_zh", "value", "unit", "numerator",
    "denominator", "formula_zh", "value_origin_class", "value_origin_label_zh",
    "method_code", "method_name_zh", "model_version", "uncertainty_low",
    "uncertainty_high", "uncertainty_type", "source_alias", "source_name", "source_url",
    "source_snapshot", "source_sha256", "retrieved_at", "publish_status", "qa_status", "note_zh",
]


@lru_cache(maxsize=None)
def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def combined_sha256(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.as_posix().encode("utf-8"))
        digest.update(bytes.fromhex(sha256(path)))
    return digest.hexdigest()


def observed_at(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


def rel(path: Path) -> str:
    return path.relative_to(PROJECT).as_posix()


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fieldnames})


def fmt(value: float | int | None, digits: int = 6) -> str:
    if value is None:
        return ""
    number = float(value)
    if not math.isfinite(number):
        return ""
    return f"{number:.{digits}f}"


def normalize_geography_code(value: str) -> str:
    """Map the 7-digit NTPC area ptid to the package's 8-digit district code."""
    text = str(value).strip()
    return f"{text}0" if len(text) == 7 and text.startswith("65") else text


def finalize(row: dict) -> dict:
    stable = "|".join(
        str(row.get(field, ""))
        for field in (
            "roc_year", "universe_code", "geography_code", "age_band", "sex_code",
            "category_dimension_code", "category_code", "metric_code",
        )
    )
    row["record_id"] = hashlib.sha256(stable.encode("utf-8")).hexdigest()[:24]
    return row


def base_service_row(*, year: int, age_band: str, sex_code: str = "ALL", sex_name: str = "合計") -> dict:
    return {
        "roc_year": year,
        "gregorian_year": year + 1911,
        "source_period": str(year),
        "period_basis": "1月1日至12月31日全年動態累計",
        "universe_code": "YOUTH_POLICY_SERVICE_ADMIN",
        "universe_name_zh": "青年政策服務行政資料（輔助層，非三母體）",
        "geography_code": "65000000",
        "geography_name_zh": "新北市",
        "geography_level": "CITY",
        "geography_role_zh": "服務提供範圍／官方彙整範圍",
        "age_band": age_band,
        "sex_code": sex_code,
        "sex_name_zh": sex_name,
    }


def load_official_area() -> tuple[dict[str, dict], list[dict]]:
    _, raw_rows = read_csv(AREA_RAW)
    rows = [row for row in raw_rows if row.get("ptid") and row.get("ptname")]
    if len(rows) != 29:
        raise ValueError(f"行政區面積應為29區，實得{len(rows)}區")
    if len({row["ptid"] for row in rows}) != 29 or len({row["ptname"] for row in rows}) != 29:
        raise ValueError("行政區面積代碼或名稱重複")
    area_by_code: dict[str, dict] = {}
    for row in rows:
        announced = float(row["announcement_area"].strip())
        if announced <= 0:
            raise ValueError(f"公告面積非正值：{row}")
        geography_code = normalize_geography_code(row["ptid"])
        area_by_code[geography_code] = {
            "geography_code": geography_code,
            "geography_name_zh": row["ptname"],
            "area_km2": announced,
            "measured_area_m2": float(row["area"]),
            "estimated_value_km2": float(row["estimated_value"]),
            "area_basis": "announcement_area",
        }
    city_area = sum(item["area_km2"] for item in area_by_code.values())
    area_by_code["65000000"] = {
        "geography_code": "65000000",
        "geography_name_zh": "新北市",
        "area_km2": city_area,
        "measured_area_m2": sum(item["measured_area_m2"] for item in area_by_code.values()),
        "estimated_value_km2": sum(item["estimated_value_km2"] for item in area_by_code.values()),
        "area_basis": "sum_of_29_district_announcement_area",
    }
    return area_by_code, rows


def update_registered_population(package: Path) -> dict:
    path = package / "09_發布資料包" / "01_戶籍人口母體_長格式.csv"
    fieldnames, rows = read_csv(path)
    if fieldnames != SCHEMA_FIELDS:
        raise ValueError("戶籍人口CSV schema與42欄標準不一致")
    original_count = len(rows)
    rows = [row for row in rows if row["metric_code"] not in EXTERNAL_METRICS]
    base_count = len(rows)
    area_by_code, raw_area_rows = load_official_area()
    population_rows = [row for row in rows if row["metric_code"] == "REGISTERED_POPULATION_COUNT"]
    registered_codes = {row["geography_code"] for row in population_rows if row["geography_level"] == "DISTRICT"}
    if registered_codes != set(area_by_code) - {"65000000"}:
        raise ValueError(
            f"戶籍人口與面積行政區不一致：缺面積={sorted(registered_codes - set(area_by_code))}，"
            f"多面積={sorted((set(area_by_code) - {'65000000'}) - registered_codes)}"
        )

    area_hash = sha256(AREA_RAW)
    area_seen: set[tuple[str, str]] = set()
    area_rows: list[dict] = []
    density_rows: list[dict] = []
    for pop in population_rows:
        code = pop["geography_code"]
        area = area_by_code[code]["area_km2"]
        population = float(pop["value"])
        density = population / area
        pop_snapshot = PROJECT / pop["source_snapshot"].split("|")[0]
        source_paths = [pop_snapshot, AREA_RAW]
        density_rows.append(
            finalize(
                {
                    **pop,
                    "category_dimension_code": "NONE",
                    "category_dimension_name_zh": "無",
                    "category_code": "ALL",
                    "category_name_zh": "合計",
                    "metric_code": "REGISTERED_YOUTH_POPULATION_DENSITY_PER_KM2",
                    "metric_name_zh": "青年戶籍人口密度",
                    "value": fmt(density),
                    "unit": "人／平方公里",
                    "numerator": pop["value"],
                    "denominator": fmt(area, 2),
                    "formula_zh": "同年度、同地區、同年齡、同性別戶籍人口數÷該行政區公告面積（平方公里）",
                    "value_origin_class": "DERIVED_FROM_OFFICIAL_ADMIN_EXACT",
                    "value_origin_label_zh": "由官方行政精確值直接計算",
                    "method_code": "M0_DIRECT_RATIO_OFFICIAL_ADMIN",
                    "method_name_zh": "官方行政值直接比率",
                    "model_version": "G6-EXTERNAL-1.0",
                    "uncertainty_low": fmt(density),
                    "uncertainty_high": fmt(density),
                    "uncertainty_type": "NONE_DIRECT_OFFICIAL_RATIO",
                    "source_alias": "MOI-POP1Y+NTPC-LAND-AREA",
                    "source_name": "村里戶數、單一年齡人口＋新北市行政區面積",
                    "source_url": f"https://data.gov.tw/dataset/77132|{AREA_URL}",
                    "source_snapshot": f"{pop['source_snapshot']}|{rel(AREA_RAW)}",
                    "source_sha256": combined_sha256(source_paths),
                    "retrieved_at": max(pop["retrieved_at"], observed_at(AREA_RAW)),
                    "publish_status": "PUBLISH_EXACT_DERIVED",
                    "qa_status": "PASS",
                    "note_zh": "人口為戶籍行政紀錄；面積採民政局announcement_area公告面積。110–114年共用固定面積分母，以維持跨年可比；不是勞動或薪資母體。",
                }
            )
        )
        area_key = (pop["roc_year"], code)
        if area_key in area_seen:
            continue
        area_seen.add(area_key)
        district_exact = code != "65000000"
        area_rows.append(
            finalize(
                {
                    **pop,
                    "source_period": "2026-08-31資料快照",
                    "period_basis": "現行行政區公告面積作固定地理分母（非該年重新量測）",
                    "age_band": "ALL",
                    "sex_code": "ALL",
                    "sex_name_zh": "合計",
                    "category_dimension_code": "GEOGRAPHY_CONTEXT",
                    "category_dimension_name_zh": "地理參照",
                    "category_code": "LAND_AREA",
                    "category_name_zh": "公告面積",
                    "metric_code": "LAND_AREA_KM2",
                    "metric_name_zh": "行政區公告面積",
                    "value": fmt(area, 2),
                    "unit": "平方公里",
                    "numerator": "",
                    "denominator": "",
                    "formula_zh": "官方announcement_area欄位" if district_exact else "29個行政區announcement_area加總",
                    "value_origin_class": "OFFICIAL_ADMIN_EXACT" if district_exact else "DERIVED_FROM_OFFICIAL_ADMIN_EXACT",
                    "value_origin_label_zh": "官方行政精確值" if district_exact else "由官方行政精確值直接加總",
                    "method_code": "M0_OFFICIAL_FIELD" if district_exact else "M0_DIRECT_SUM_OFFICIAL_ADMIN",
                    "method_name_zh": "官方欄位直接取值" if district_exact else "官方行政值直接加總",
                    "model_version": "G6-EXTERNAL-1.0",
                    "uncertainty_low": fmt(area, 2),
                    "uncertainty_high": fmt(area, 2),
                    "uncertainty_type": "NONE_ADMIN_AREA",
                    "source_alias": "NTPC-LAND-AREA",
                    "source_name": "新北市行政區面積",
                    "source_url": AREA_URL,
                    "source_snapshot": rel(AREA_RAW),
                    "source_sha256": area_hash,
                    "retrieved_at": observed_at(AREA_RAW),
                    "publish_status": "PUBLISH_EXACT" if district_exact else "PUBLISH_EXACT_DERIVED",
                    "qa_status": "PASS",
                    "note_zh": "固定地理分母；公告面積合計為2052.57平方公里。紅色地圖只代表數值高，不代表政策風險。",
                }
            )
        )

    combined = rows + area_rows + density_rows
    combined.sort(
        key=lambda row: (
            int(row["roc_year"]), row["geography_code"], row["age_band"], row["sex_code"],
            row["category_dimension_code"], row["category_code"], row["metric_code"],
        )
    )
    if len({row["record_id"] for row in combined}) != len(combined):
        duplicates = [key for key, count in Counter(row["record_id"] for row in combined).items() if count > 1]
        raise ValueError(f"新增面積／密度後record_id重複：{duplicates[:10]}")
    write_csv(path, SCHEMA_FIELDS, combined)

    wide_area = []
    for code, item in sorted(area_by_code.items()):
        wide_area.append(
            {
                **item,
                "source_alias": "NTPC-LAND-AREA",
                "source_url": AREA_URL,
                "api_url": AREA_API,
                "source_snapshot": rel(AREA_RAW),
                "source_sha256": area_hash,
                "retrieved_at": observed_at(AREA_RAW),
                "qa_status": "PASS",
            }
        )
    write_csv(PROCESSED / "NTPC_District_Land_Area_Official.csv", list(wide_area[0]), wide_area)
    return {
        "path": str(path),
        "original_rows": original_count,
        "base_rows_after_idempotent_cleanup": base_count,
        "land_area_rows_added": len(area_rows),
        "density_rows_added": len(density_rows),
        "final_rows": len(combined),
        "districts": len(raw_area_rows),
        "city_announcement_area_km2": area_by_code["65000000"]["area_km2"],
        "sha256": sha256(path),
    }


def annual_service_rows(config: dict) -> tuple[list[dict], list[dict]]:
    rows: list[dict] = []
    wide: list[dict] = []
    sex_specs = (("ALL", "合計", "all"), ("M", "男", "male"), ("F", "女", "female"))
    for year_text, year_data in sorted(config["annualService"].items()):
        year = int(year_text)
        source_path = PROJECT / year_data["sourceSnapshot"]
        if not source_path.exists():
            raise FileNotFoundError(source_path)
        source_hash = sha256(source_path)
        for domain_code, domain_name, node_name in (
            ("CAREER_DEVELOPMENT", "職涯發展活動", "career"),
            ("ENTREPRENEURSHIP", "創新創業活動", "entrepreneurship"),
        ):
            node = year_data[node_name]
            groups = node["groups"]
            totals = {field: sum(int(group[field]) for group in groups) for field in ("all", "male", "female")}
            if totals["all"] != totals["male"] + totals["female"]:
                raise ValueError(f"{year}{domain_name}官方表男女不平衡")
            for group in groups:
                if int(group["all"]) != int(group["male"]) + int(group["female"]):
                    raise ValueError(f"{year}{domain_name}{group['nameZh']}男女不平衡")
                for sex_code, sex_name, field in sex_specs:
                    value = int(group[field])
                    base = base_service_row(year=year, age_band="官方未提供年齡交叉", sex_code=sex_code, sex_name=sex_name)
                    rows.append(
                        finalize(
                            {
                                **base,
                                "category_dimension_code": "SERVICE_TARGET_GROUP",
                                "category_dimension_name_zh": "服務對象身分",
                                "category_code": f"{domain_code}__{group['code']}",
                                "category_name_zh": f"{domain_name}－{group['nameZh']}",
                                "metric_code": "SERVICE_PARTICIPATION_PERSON_TIMES",
                                "metric_name_zh": "服務參與人次",
                                "value": value,
                                "unit": "人次",
                                "numerator": value,
                                "denominator": "",
                                "formula_zh": "官方統計年報表列人次直接取值",
                                "value_origin_class": "OFFICIAL_ADMIN_AGGREGATE",
                                "value_origin_label_zh": "官方行政彙整值",
                                "method_code": "M0_OFFICIAL_TABLE_TRANSCRIPTION",
                                "method_name_zh": "官方統計表直接轉錄",
                                "model_version": "G6-EXTERNAL-1.0",
                                "uncertainty_low": value,
                                "uncertainty_high": value,
                                "uncertainty_type": "NONE_OFFICIAL_AGGREGATE",
                                "source_alias": "NTPC-YOUTH-ANNUAL",
                                "source_name": f"{year}年新北市政府青年局統計年報",
                                "source_url": year_data["sourceUrl"],
                                "source_snapshot": year_data["sourceSnapshot"],
                                "source_sha256": source_hash,
                                "retrieved_at": observed_at(source_path),
                                "publish_status": "PUBLISH_EXACT",
                                "qa_status": "PASS",
                                "note_zh": "人次可能重複計入同一人；重複參與保留並可用於曝光強度，但不等於不同服務人數。" + node.get("comparabilityNote", ""),
                            }
                        )
                    )
                if "activityCount" in group:
                    event_count = int(group["activityCount"])
                    for metric_code, metric_name, value, unit, formula, origin, method in (
                        ("SERVICE_ACTIVITY_COUNT", "服務活動場次", event_count, "場", "官方統計年報表列場次直接取值", "OFFICIAL_ADMIN_AGGREGATE", "M0_OFFICIAL_TABLE_TRANSCRIPTION"),
                        ("SERVICE_PERSON_TIMES_PER_ACTIVITY", "服務參與／曝光強度", int(group["all"]) / event_count, "人次／場", "服務參與人次÷活動場次", "DERIVED_FROM_OFFICIAL_ADMIN_EXACT", "M0_DIRECT_RATIO_OFFICIAL_ADMIN"),
                    ):
                        base = base_service_row(year=year, age_band="官方未提供年齡交叉")
                        rows.append(
                            finalize(
                                {
                                    **base,
                                    "category_dimension_code": "SERVICE_TARGET_GROUP",
                                    "category_dimension_name_zh": "服務對象身分",
                                    "category_code": f"{domain_code}__{group['code']}",
                                    "category_name_zh": f"{domain_name}－{group['nameZh']}",
                                    "metric_code": metric_code,
                                    "metric_name_zh": metric_name,
                                    "value": value if isinstance(value, int) else fmt(value),
                                    "unit": unit,
                                    "numerator": int(group["all"]) if metric_code.endswith("PER_ACTIVITY") else value,
                                    "denominator": event_count if metric_code.endswith("PER_ACTIVITY") else "",
                                    "formula_zh": formula,
                                    "value_origin_class": origin,
                                    "value_origin_label_zh": "官方行政彙整值" if origin.startswith("OFFICIAL") else "由官方行政精確值直接計算",
                                    "method_code": method,
                                    "method_name_zh": "官方統計表直接轉錄" if method.startswith("M0_OFFICIAL") else "官方行政值直接比率",
                                    "model_version": "G6-EXTERNAL-1.0",
                                    "uncertainty_low": value if isinstance(value, int) else fmt(value),
                                    "uncertainty_high": value if isinstance(value, int) else fmt(value),
                                    "uncertainty_type": "NONE_DIRECT_OFFICIAL_RATIO" if metric_code.endswith("PER_ACTIVITY") else "NONE_OFFICIAL_AGGREGATE",
                                    "source_alias": "NTPC-YOUTH-ANNUAL",
                                    "source_name": f"{year}年新北市政府青年局統計年報",
                                    "source_url": year_data["sourceUrl"],
                                    "source_snapshot": year_data["sourceSnapshot"],
                                    "source_sha256": source_hash,
                                    "retrieved_at": observed_at(source_path),
                                    "publish_status": "PUBLISH_EXACT_DERIVED" if metric_code.endswith("PER_ACTIVITY") else "PUBLISH_EXACT",
                                    "qa_status": "PASS",
                                    "note_zh": "量能以活動場次表示；不同類型空間座位不可與活動場次相加。",
                                }
                            )
                        )
                wide.append(
                    {
                        "roc_year": year,
                        "service_domain_code": domain_code,
                        "service_domain_name_zh": domain_name,
                        "target_group_code": group["code"],
                        "target_group_name_zh": group["nameZh"],
                        "activity_count": group.get("activityCount", ""),
                        "participant_person_times_all": group["all"],
                        "participant_person_times_male": group["male"],
                        "participant_person_times_female": group["female"],
                        "source_url": year_data["sourceUrl"],
                        "source_snapshot": year_data["sourceSnapshot"],
                        "source_sha256": source_hash,
                        "note_zh": node.get("comparabilityNote", ""),
                    }
                )

            for sex_code, sex_name, field in sex_specs:
                value = totals[field]
                base = base_service_row(year=year, age_band="官方未提供年齡交叉", sex_code=sex_code, sex_name=sex_name)
                rows.append(
                    finalize(
                        {
                            **base,
                            "category_dimension_code": "SERVICE_DOMAIN",
                            "category_dimension_name_zh": "服務領域",
                            "category_code": domain_code,
                            "category_name_zh": domain_name,
                            "metric_code": "SERVICE_PARTICIPATION_PERSON_TIMES",
                            "metric_name_zh": "服務參與人次",
                            "value": value,
                            "unit": "人次",
                            "numerator": value,
                            "denominator": "",
                            "formula_zh": "各官方身分類別人次加總",
                            "value_origin_class": "DERIVED_FROM_OFFICIAL_ADMIN_EXACT",
                            "value_origin_label_zh": "由官方行政精確值直接加總",
                            "method_code": "M0_DIRECT_SUM_OFFICIAL_ADMIN",
                            "method_name_zh": "官方行政值直接加總",
                            "model_version": "G6-EXTERNAL-1.0",
                            "uncertainty_low": value,
                            "uncertainty_high": value,
                            "uncertainty_type": "NONE_OFFICIAL_AGGREGATE",
                            "source_alias": "NTPC-YOUTH-ANNUAL",
                            "source_name": f"{year}年新北市政府青年局統計年報",
                            "source_url": year_data["sourceUrl"],
                            "source_snapshot": year_data["sourceSnapshot"],
                            "source_sha256": source_hash,
                            "retrieved_at": observed_at(source_path),
                            "publish_status": "PUBLISH_EXACT_DERIVED",
                            "qa_status": "PASS",
                            "note_zh": "人次不是去重人數；總計可做年度比較，身分類別需注意114年創業表分類調整。",
                        }
                    )
                )
            event_count = int(node["activityCount"])
            for metric_code, metric_name, value, unit, numerator, denominator, formula in (
                ("SERVICE_ACTIVITY_COUNT", "服務活動場次", event_count, "場", event_count, "", "官方統計年報總計場次直接取值"),
                ("SERVICE_PERSON_TIMES_PER_ACTIVITY", "服務參與／曝光強度", totals["all"] / event_count, "人次／場", totals["all"], event_count, "服務參與總人次÷活動總場次"),
            ):
                base = base_service_row(year=year, age_band="官方未提供年齡交叉")
                rows.append(
                    finalize(
                        {
                            **base,
                            "category_dimension_code": "SERVICE_DOMAIN",
                            "category_dimension_name_zh": "服務領域",
                            "category_code": domain_code,
                            "category_name_zh": domain_name,
                            "metric_code": metric_code,
                            "metric_name_zh": metric_name,
                            "value": value if isinstance(value, int) else fmt(value),
                            "unit": unit,
                            "numerator": numerator,
                            "denominator": denominator,
                            "formula_zh": formula,
                            "value_origin_class": "OFFICIAL_ADMIN_AGGREGATE" if metric_code == "SERVICE_ACTIVITY_COUNT" else "DERIVED_FROM_OFFICIAL_ADMIN_EXACT",
                            "value_origin_label_zh": "官方行政彙整值" if metric_code == "SERVICE_ACTIVITY_COUNT" else "由官方行政精確值直接計算",
                            "method_code": "M0_OFFICIAL_TABLE_TRANSCRIPTION" if metric_code == "SERVICE_ACTIVITY_COUNT" else "M0_DIRECT_RATIO_OFFICIAL_ADMIN",
                            "method_name_zh": "官方統計表直接轉錄" if metric_code == "SERVICE_ACTIVITY_COUNT" else "官方行政值直接比率",
                            "model_version": "G6-EXTERNAL-1.0",
                            "uncertainty_low": value if isinstance(value, int) else fmt(value),
                            "uncertainty_high": value if isinstance(value, int) else fmt(value),
                            "uncertainty_type": "NONE_OFFICIAL_AGGREGATE" if metric_code == "SERVICE_ACTIVITY_COUNT" else "NONE_DIRECT_OFFICIAL_RATIO",
                            "source_alias": "NTPC-YOUTH-ANNUAL",
                            "source_name": f"{year}年新北市政府青年局統計年報",
                            "source_url": year_data["sourceUrl"],
                            "source_snapshot": year_data["sourceSnapshot"],
                            "source_sha256": source_hash,
                            "retrieved_at": observed_at(source_path),
                            "publish_status": "PUBLISH_EXACT" if metric_code == "SERVICE_ACTIVITY_COUNT" else "PUBLISH_EXACT_DERIVED",
                            "qa_status": "PASS",
                            "note_zh": "曝光強度以每場參與人次表示；同一人重複參與會重複計入。這不是不同人數占比，也不是場地物理容量。",
                        }
                    )
                )
    return rows, wide


def career_base_rows(config: dict) -> list[dict]:
    node = config["careerBase113"]
    source_path = PROJECT / node["sourceSnapshot"]
    source_hash = sha256(source_path)
    rows: list[dict] = []
    service_specs = (
        ("CAREER_CONSULTATION", "職涯諮詢", "careerConsultation"),
        ("RESUME_INTERVIEW", "履歷健檢／模擬面試", "resumeInterview"),
        ("ALL", "全部專業服務", "all"),
    )
    for item in node["ageByService"]:
        for service_code, service_name, field in service_specs:
            value = int(item[field])
            base = base_service_row(year=113, age_band=item["ageBand"])
            rows.append(
                finalize(
                    {
                        **base,
                        "category_dimension_code": "CAREER_SERVICE_TYPE",
                        "category_dimension_name_zh": "青職專業服務類型",
                        "category_code": service_code,
                        "category_name_zh": service_name,
                        "metric_code": "CAREER_BASE_CASE_COUNT",
                        "metric_name_zh": "青職基地專業服務個案數",
                        "value": value,
                        "unit": "人",
                        "numerator": value,
                        "denominator": "",
                        "formula_zh": "官方個案紀錄之原生年齡帶直接取值",
                        "value_origin_class": "OFFICIAL_ADMIN_AGGREGATE",
                        "value_origin_label_zh": "官方行政彙整值",
                        "method_code": "M0_OFFICIAL_AGE_BAND",
                        "method_name_zh": "官方原生年齡帶",
                        "model_version": "G6-EXTERNAL-1.0",
                        "uncertainty_low": value,
                        "uncertainty_high": value,
                        "uncertainty_type": "NONE_OFFICIAL_AGGREGATE",
                        "source_alias": "NTPC-YOUTH-CAREER-BASE-113",
                        "source_name": "113年度新北市青職基地職涯專業服務統計分析",
                        "source_url": node["sourceUrl"],
                        "source_snapshot": node["sourceSnapshot"],
                        "source_sha256": source_hash,
                        "retrieved_at": observed_at(source_path),
                        "publish_status": "PUBLISH_EXACT",
                        "qa_status": "PASS",
                        "note_zh": "僅代表青職基地兩類專業服務個案，不代表青年局全部服務；原生年齡帶含30–34及35–40。",
                    }
                )
            )
    for item in node["sexByService"]:
        for sex_code, sex_name, field in (("ALL", "合計", "all"), ("M", "男", "male"), ("F", "女", "female")):
            value = int(item[field])
            base = base_service_row(year=113, age_band="ALL", sex_code=sex_code, sex_name=sex_name)
            rows.append(
                finalize(
                    {
                        **base,
                        "category_dimension_code": "CAREER_SERVICE_TYPE",
                        "category_dimension_name_zh": "青職專業服務類型",
                        "category_code": item["serviceCode"],
                        "category_name_zh": item["serviceNameZh"],
                        "metric_code": "CAREER_BASE_CASE_COUNT",
                        "metric_name_zh": "青職基地專業服務個案數",
                        "value": value,
                        "unit": "人",
                        "numerator": value,
                        "denominator": "",
                        "formula_zh": "官方個案紀錄之性別統計直接取值",
                        "value_origin_class": "OFFICIAL_ADMIN_AGGREGATE",
                        "value_origin_label_zh": "官方行政彙整值",
                        "method_code": "M0_OFFICIAL_TABLE_TRANSCRIPTION",
                        "method_name_zh": "官方統計表直接轉錄",
                        "model_version": "G6-EXTERNAL-1.0",
                        "uncertainty_low": value,
                        "uncertainty_high": value,
                        "uncertainty_type": "NONE_OFFICIAL_AGGREGATE",
                        "source_alias": "NTPC-YOUTH-CAREER-BASE-113",
                        "source_name": "113年度新北市青職基地職涯專業服務統計分析",
                        "source_url": node["sourceUrl"],
                        "source_snapshot": node["sourceSnapshot"],
                        "source_sha256": source_hash,
                        "retrieved_at": observed_at(source_path),
                        "publish_status": "PUBLISH_EXACT",
                        "qa_status": "PASS",
                        "note_zh": "青職基地個案紀錄；非青年局全部服務參與人次。",
                    }
                )
            )
    for identity in node["identity"]:
        value = int(identity["value"])
        base = base_service_row(year=113, age_band="ALL")
        rows.append(
            finalize(
                {
                    **base,
                    "category_dimension_code": "SERVICE_USER_IDENTITY",
                    "category_dimension_name_zh": "服務個案與新北市關係",
                    "category_code": identity["code"],
                    "category_name_zh": identity["nameZh"],
                    "metric_code": "CAREER_BASE_CASE_COUNT",
                    "metric_name_zh": "青職基地專業服務個案數",
                    "value": value,
                    "unit": "人",
                    "numerator": value,
                    "denominator": "",
                    "formula_zh": "官方個案關係類別直接取值",
                    "value_origin_class": "OFFICIAL_ADMIN_AGGREGATE",
                    "value_origin_label_zh": "官方行政彙整值",
                    "method_code": "M0_OFFICIAL_TABLE_TRANSCRIPTION",
                    "method_name_zh": "官方統計表直接轉錄",
                    "model_version": "G6-EXTERNAL-1.0",
                    "uncertainty_low": value,
                    "uncertainty_high": value,
                    "uncertainty_type": "NONE_OFFICIAL_AGGREGATE",
                    "source_alias": "NTPC-YOUTH-CAREER-BASE-113",
                    "source_name": "113年度新北市青職基地職涯專業服務統計分析",
                    "source_url": node["sourceUrl"],
                    "source_snapshot": node["sourceSnapshot"],
                    "source_sha256": source_hash,
                    "retrieved_at": observed_at(source_path),
                    "publish_status": "PUBLISH_EXACT",
                    "qa_status": "PASS",
                    "note_zh": "各關係類別合計370人；不能把居住、就學、設籍與就業口徑任意替換成戶籍母體。",
                }
            )
        )
    lower = sum(int(item["all"]) for item in node["ageByService"] if item["ageBand"] in {"18-24", "25-29", "30-34"})
    upper = lower + next(int(item["all"]) for item in node["ageByService"] if item["ageBand"] == "35-40")
    base = base_service_row(year=113, age_band="18-35")
    rows.append(
        finalize(
            {
                **base,
                "category_dimension_code": "CAREER_SERVICE_TYPE",
                "category_dimension_name_zh": "青職專業服務類型",
                "category_code": "ALL",
                "category_name_zh": "全部專業服務",
                "metric_code": "CAREER_BASE_CASE_COUNT",
                "metric_name_zh": "青職基地18–35歲專業服務個案數",
                "value": "",
                "unit": "人",
                "numerator": "",
                "denominator": "",
                "formula_zh": "18–34歲確定值318＋35–40歲組中的35歲未知人數；可識別區間為[318,370]",
                "value_origin_class": "DATA_GAP_PARTIAL_IDENTIFICATION",
                "value_origin_label_zh": "官方年齡帶造成的部分識別區間",
                "method_code": "PARTIAL_IDENTIFICATION_BOUND",
                "method_name_zh": "部分識別上下界（不產生點估計）",
                "model_version": "G6-EXTERNAL-1.0",
                "uncertainty_low": lower,
                "uncertainty_high": upper,
                "uncertainty_type": "PARTIAL_IDENTIFICATION_BOUND_NOT_CI",
                "source_alias": "NTPC-YOUTH-CAREER-BASE-113",
                "source_name": "113年度新北市青職基地職涯專業服務統計分析",
                "source_url": node["sourceUrl"],
                "source_snapshot": node["sourceSnapshot"],
                "source_sha256": source_hash,
                "retrieved_at": observed_at(source_path),
                "publish_status": "HOLD_BOUND_ONLY_NO_POINT_ESTIMATE",
                "qa_status": "PASS_WITH_DATA_GAP",
                "note_zh": "35歲與36–40歲無法拆開；未經單一年齡資料不得用Sprague或PCLM假造服務個案分布。",
            }
        )
    )
    return rows


def facility_rows(config: dict) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    rows: list[dict] = []
    inventory: list[dict] = []
    capacities: list[dict] = []
    gaps: list[dict] = []
    facilities = config["facilities"]
    for facility in facilities:
        source_path = PROJECT / facility["sourceSnapshot"]
        if not source_path.exists():
            raise FileNotFoundError(source_path)
        source_hash = sha256(source_path)
        active = facility["operatingStatus"] == "ACTIVE"
        base = base_service_row(year=115, age_band="不適用")
        base.update(
            {
                "source_period": "2026-08-31資料快照",
                "period_basis": "官方據點頁面現況快照",
                "geography_code": normalize_geography_code(facility["districtCode"]),
                "geography_name_zh": facility["districtNameZh"],
                "geography_level": "DISTRICT",
                "geography_role_zh": "服務據點所在地",
            }
        )
        for metric_code, metric_name, value in (
            ("YOUTH_SERVICE_SITE_REGISTERED_COUNT", "官方青年服務據點數", 1),
            ("YOUTH_SERVICE_SITE_ACTIVE_COUNT", "目前營運青年服務據點數", 1 if active else 0),
        ):
            rows.append(
                finalize(
                    {
                        **base,
                        "category_dimension_code": "FACILITY",
                        "category_dimension_name_zh": "青年服務據點",
                        "category_code": facility["facilityCode"],
                        "category_name_zh": facility["nameZh"],
                        "metric_code": metric_code,
                        "metric_name_zh": metric_name,
                        "value": value,
                        "unit": "處",
                        "numerator": value,
                        "denominator": "",
                        "formula_zh": "官方據點清單逐處計數" if metric_code.endswith("REGISTERED_COUNT") else "官方據點清單逐處計數，暫停營運者記為0",
                        "value_origin_class": "OFFICIAL_ADMIN_AGGREGATE",
                        "value_origin_label_zh": "官方行政彙整值",
                        "method_code": "M0_OFFICIAL_SITE_INVENTORY",
                        "method_name_zh": "官方據點清單直接盤點",
                        "model_version": "G6-EXTERNAL-1.0",
                        "uncertainty_low": value,
                        "uncertainty_high": value,
                        "uncertainty_type": "NONE_OFFICIAL_INVENTORY",
                        "source_alias": "NTPC-YOUTH-BASE-PAGES",
                        "source_name": "新北市青年局官方青年服務據點頁面",
                        "source_url": facility["sourceUrl"],
                        "source_snapshot": facility["sourceSnapshot"],
                        "source_sha256": source_hash,
                        "retrieved_at": observed_at(source_path),
                        "publish_status": "PUBLISH_EXACT_WITH_STATUS",
                        "qa_status": "PASS",
                        "note_zh": f"據點地址：{facility['addressZh']}；營運狀態：{facility['operatingStatus']}。據點多不等於服務覆蓋充足。",
                    }
                )
            )
        capacity_summary = []
        for component in facility["capacities"]:
            value = float(component["value"])
            derived = component["method"].startswith("DERIVED")
            component_code = f"{facility['facilityCode']}__{component['componentCode']}"
            formula = component.get("formulaZh", "官方據點頁面容量描述直接取值")
            rows.append(
                finalize(
                    {
                        **base,
                        "category_dimension_code": "FACILITY_CAPACITY_COMPONENT",
                        "category_dimension_name_zh": "據點量能構件",
                        "category_code": component_code,
                        "category_name_zh": f"{facility['nameZh']}－{component['componentNameZh']}",
                        "metric_code": "FACILITY_CAPACITY_VALUE",
                        "metric_name_zh": "據點公開量能",
                        "value": int(value) if value.is_integer() else value,
                        "unit": component["unit"],
                        "numerator": "",
                        "denominator": "",
                        "formula_zh": formula,
                        "value_origin_class": "DERIVED_FROM_OFFICIAL_ADMIN_EXACT" if derived else "OFFICIAL_ADMIN_AGGREGATE",
                        "value_origin_label_zh": "由官方行政精確值直接計算" if derived else "官方行政彙整值",
                        "method_code": component["method"],
                        "method_name_zh": "官方容量構件直接計數" if not derived else "官方容量構件直接換算",
                        "model_version": "G6-EXTERNAL-1.0",
                        "uncertainty_low": int(value) if value.is_integer() else value,
                        "uncertainty_high": int(value) if value.is_integer() else value,
                        "uncertainty_type": "NONE_DIRECT_OFFICIAL_RATIO" if derived else "NONE_OFFICIAL_AGGREGATE",
                        "source_alias": "NTPC-YOUTH-BASE-PAGES",
                        "source_name": "新北市青年局官方青年服務據點頁面",
                        "source_url": facility["sourceUrl"],
                        "source_snapshot": facility["sourceSnapshot"],
                        "source_sha256": source_hash,
                        "retrieved_at": observed_at(source_path),
                        "publish_status": "PUBLISH_EXACT_DERIVED" if derived else "PUBLISH_EXACT",
                        "qa_status": "PASS",
                        "note_zh": "不同單位（人、席、間、座）不得相加；量能構件也不等於年度可服務人數。",
                    }
                )
            )
            capacity_record = {
                "facility_code": facility["facilityCode"],
                "facility_name_zh": facility["nameZh"],
                "district_code": normalize_geography_code(facility["districtCode"]),
                "district_name_zh": facility["districtNameZh"],
                "component_code": component["componentCode"],
                "component_name_zh": component["componentNameZh"],
                "capacity_value": component["value"],
                "capacity_unit": component["unit"],
                "method_code": component["method"],
                "formula_zh": formula,
                "operating_status": facility["operatingStatus"],
                "source_url": facility["sourceUrl"],
                "source_snapshot": facility["sourceSnapshot"],
                "source_sha256": source_hash,
            }
            capacities.append(capacity_record)
            capacity_summary.append(f"{component['componentNameZh']}={component['value']}{component['unit']}")
        if not facility["capacities"]:
            gaps.append(
                {
                    "gap_id": f"CAPACITY-{facility['facilityCode']}",
                    "item_zh": f"{facility['nameZh']}量能",
                    "current_status": "官方據點頁面未提供可加總之數值容量",
                    "required_data": "各空間可同時服務人數／席位、可預約時段及年度開放日數",
                    "publish_decision": "HOLD；只顯示據點位置與名稱，不推造容量",
                    "human_review": "向青年局據點營運單位確認",
                }
            )
        inventory.append(
            {
                "facility_code": facility["facilityCode"],
                "facility_name_zh": facility["nameZh"],
                "facility_type": facility["facilityType"],
                "district_code": normalize_geography_code(facility["districtCode"]),
                "district_name_zh": facility["districtNameZh"],
                "address_zh": facility["addressZh"],
                "operating_status": facility["operatingStatus"],
                "active_flag": 1 if active else 0,
                "capacity_component_count": len(facility["capacities"]),
                "capacity_summary_zh": "；".join(capacity_summary),
                "source_url": facility["sourceUrl"],
                "source_snapshot": facility["sourceSnapshot"],
                "source_sha256": source_hash,
                "retrieved_at": observed_at(source_path),
                "qa_status": "PASS" if facility["capacities"] else "PASS_WITH_CAPACITY_GAP",
            }
        )

    count_specs = (
        ("STARTUP_BASE", "青創基地", [item for item in facilities if item["facilityType"] == "STARTUP_BASE"]),
        ("CAREER_SERVICE_BASE", "青職基地", [item for item in facilities if item["facilityType"] == "CAREER_SERVICE_BASE"]),
        ("ALL", "全部青年服務據點", facilities),
    )
    snapshot_paths = sorted({PROJECT / item["sourceSnapshot"] for item in facilities})
    snapshot_hash = combined_sha256(snapshot_paths)
    snapshot_text = "|".join(rel(path) for path in snapshot_paths)
    for type_code, type_name, items in count_specs:
        for metric_code, metric_name, value in (
            ("YOUTH_SERVICE_SITE_REGISTERED_COUNT", "官方青年服務據點數", len(items)),
            ("YOUTH_SERVICE_SITE_ACTIVE_COUNT", "目前營運青年服務據點數", sum(item["operatingStatus"] == "ACTIVE" for item in items)),
        ):
            base = base_service_row(year=115, age_band="不適用")
            base.update({"source_period": "2026-08-31資料快照", "period_basis": "官方據點頁面現況快照"})
            rows.append(
                finalize(
                    {
                        **base,
                        "category_dimension_code": "FACILITY_TYPE",
                        "category_dimension_name_zh": "青年服務據點類型",
                        "category_code": type_code,
                        "category_name_zh": type_name,
                        "metric_code": metric_code,
                        "metric_name_zh": metric_name,
                        "value": value,
                        "unit": "處",
                        "numerator": value,
                        "denominator": "",
                        "formula_zh": "官方據點清單逐處加總；暫停營運者仍列入設置數，但不列入目前營運數",
                        "value_origin_class": "DERIVED_FROM_OFFICIAL_ADMIN_EXACT",
                        "value_origin_label_zh": "由官方行政精確值直接加總",
                        "method_code": "M0_DIRECT_SUM_OFFICIAL_ADMIN",
                        "method_name_zh": "官方行政值直接加總",
                        "model_version": "G6-EXTERNAL-1.0",
                        "uncertainty_low": value,
                        "uncertainty_high": value,
                        "uncertainty_type": "NONE_OFFICIAL_INVENTORY",
                        "source_alias": "NTPC-YOUTH-BASE-PAGES",
                        "source_name": "新北市青年局官方青年服務據點頁面",
                        "source_url": "https://www.youth.ntpc.gov.tw/youth/ch/app/data/view?id=101&module=youth0009&serno=fff05b70-3f77-4b85-806b-3cb0cf89194c",
                        "source_snapshot": snapshot_text,
                        "source_sha256": snapshot_hash,
                        "retrieved_at": max(observed_at(path) for path in snapshot_paths),
                        "publish_status": "PUBLISH_EXACT_DERIVED",
                        "qa_status": "PASS",
                        "note_zh": "青創基地共10處，其中新莊膠囊工作站自115-04-01暫停營運；另列青職基地1處。",
                    }
                )
            )
    return rows, inventory, capacities, gaps


def build_service_outputs(package: Path, config: dict) -> dict:
    annual_rows, annual_wide = annual_service_rows(config)
    career_rows = career_base_rows(config)
    site_rows, inventory, capacities, gaps = facility_rows(config)
    gaps.extend(
        [
            {
                "gap_id": "DISTRICT-PARTICIPATION",
                "item_zh": "各行政區服務參與人次與曝光強度",
                "current_status": "青年局年報只提供全市彙整，未提供服務對象行政區交叉表",
                "required_data": "服務活動或參與紀錄的服務地區、活動場次與參與人次；重複參與可保留",
                "publish_decision": "HOLD；地圖只顯示據點位置，不把全市人次拆到行政區",
                "human_review": "確認行政區採服務發生地、據點所在地或服務對象居住地",
            },
            {
                "gap_id": "SERVICE-110",
                "item_zh": "110年青年局服務資料",
                "current_status": "青年局官方統計年報清單自111年起；目前未找到同口徑110年年報",
                "required_data": "110年接管前單位或青年局成立初期之同口徑業務統計",
                "publish_decision": "缺值保留，不以111年回填110年",
                "human_review": "向青年局統計承辦確認110年可比來源",
            },
        ]
    )
    rows = annual_rows + career_rows + site_rows
    rows.sort(
        key=lambda row: (
            int(row["roc_year"]), row["geography_code"], row["age_band"], row["sex_code"],
            row["category_dimension_code"], row["category_code"], row["metric_code"],
        )
    )
    if len({row["record_id"] for row in rows}) != len(rows):
        duplicates = [key for key, count in Counter(row["record_id"] for row in rows).items() if count > 1]
        raise ValueError(f"服務行政資料record_id重複：{duplicates[:10]}")
    for row in rows:
        if row["publish_status"].startswith("PUBLISH") and row["value"] == "":
            raise ValueError(f"可發布服務列不得空值：{row['record_id']}")
    output = package / "09_發布資料包" / "06_政策服務與曝光_長格式.csv"
    write_csv(output, SCHEMA_FIELDS, rows)
    write_csv(PROCESSED / "NTPC_Youth_Service_Participation_111_114.csv", list(annual_wide[0]), annual_wide)
    write_csv(PROCESSED / "NTPC_Youth_Service_Facility_Inventory.csv", list(inventory[0]), inventory)
    write_csv(PROCESSED / "NTPC_Youth_Service_Capacity_Components.csv", list(capacities[0]), capacities)
    write_csv(PROCESSED / "NTPC_Youth_Service_Data_Gaps.csv", list(gaps[0]), gaps)
    return {
        "path": str(output),
        "rows": len(rows),
        "annual_participation_rows": len(annual_rows),
        "career_base_rows": len(career_rows),
        "facility_rows": len(site_rows),
        "facility_count": len(inventory),
        "capacity_component_count": len(capacities),
        "data_gap_count": len(gaps),
        "sha256": sha256(output),
    }


def copy_release_inputs(package: Path) -> None:
    destination = package / "10_官方原始資料與處理結果" / "07_行政區面積與政策服務"
    official = destination / "official_original"
    processed = destination / "processed"
    quarantine = destination / "quarantine"
    official.mkdir(parents=True, exist_ok=True)
    processed.mkdir(parents=True, exist_ok=True)
    quarantine.mkdir(parents=True, exist_ok=True)
    for source in (AREA_RAW, AREA_PAGE, *sorted(SERVICE_RAW.glob("*"))):
        if source.is_file():
            shutil.copy2(source, official / source.name)
    rejected = AREA_RAW.parent / "quarantine" / "REJECTED-NTPC-VILLAGE-BOUNDARY.csv"
    if rejected.exists():
        shutil.copy2(rejected, quarantine / rejected.name)
    for source in sorted(PROCESSED.glob("*.csv")):
        shutil.copy2(source, processed / source.name)
    shutil.copy2(CONFIG, destination / CONFIG.name)
    reproducible = package / "05_年齡轉換與統計方法" / "reproducible_scripts"
    reproducible.mkdir(parents=True, exist_ok=True)
    shutil.copy2(Path(__file__), reproducible / Path(__file__).name)


def update_catalog(package: Path, registered: dict, service: dict) -> None:
    catalog_path = package / "09_發布資料包" / "data_catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["catalog_version"] = "G6-EXTERNAL-1.0"
    catalog["generated_at_utc"] = datetime.now(timezone.utc).isoformat()
    for item in catalog.get("files", []):
        if item["path"].endswith("01_戶籍人口母體_長格式.csv"):
            item["sha256"] = registered["sha256"]
            item["rows"] = registered["final_rows"]
    catalog["auxiliaryPolicyServiceFile"] = {
        "universe_name_zh": "青年政策服務行政資料（輔助層，非三母體）",
        "path": "09_發布資料包/06_政策服務與曝光_長格式.csv",
        "sha256": service["sha256"],
        "rows": service["rows"],
        "years": [111, 112, 113, 114, 115],
        "qa_status": "PASS_WITH_DOCUMENTED_GAPS",
        "governance": "不得併入戶籍、勞動或薪資母體分母；只作政策服務證據與地圖據點脈絡。",
    }
    catalog["externalPolicyEvidence"] = {
        "landAreaSource": AREA_URL,
        "landAreaApi": AREA_API,
        "densityFormula": "戶籍青年人口÷行政區公告面積（平方公里）",
        "serviceExposureMetric": {
            "status": "PUBLISH_EXACT_DERIVED",
            "metric_code": "SERVICE_PERSON_TIMES_PER_ACTIVITY",
            "label_zh": "服務參與／曝光強度",
            "formula": "服務參與人次÷活動場次",
            "unit": "人次／場",
            "district_status": "HOLD_UNTIL_DISTRICT_ACTIVITY_AND_PERSON_TIMES_AVAILABLE",
        },
        "threeUniverseIntegration": {
            "01_registered_population": "新增官方面積與戶籍青年人口密度",
            "02_civilian_labor_market": "不適用，維持不變；服務行政資料不是勞動調查母體",
            "03_employee_wage": "不適用，維持不變；服務行政資料不是受僱員工薪資母體",
        },
    }
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_integration_status(package: Path, registered: dict, service: dict) -> None:
    publish = package / "09_發布資料包"
    _, labor = read_csv(publish / "02_民間人口與勞動市場母體_長格式.csv")
    _, wage = read_csv(publish / "03_受僱員工薪資母體_長格式.csv")
    rows = [
        {
            "file": "01_戶籍人口母體_長格式.csv", "external_item": "行政區官方土地面積、青年戶籍人口密度",
            "integration_action": "已新增", "rows_after": registered["final_rows"],
            "governance_reason": "面積是戶籍人口密度的同地理分母，可與戶籍人口安全連結。",
        },
        {
            "file": "02_民間人口與勞動市場母體_長格式.csv", "external_item": "政策服務參與、據點量能、曝光強度",
            "integration_action": "維持原檔，不混入", "rows_after": len(labor),
            "governance_reason": "政策服務行政資料不屬於人力資源調查民間人口／勞動市場母體。",
        },
        {
            "file": "03_受僱員工薪資母體_長格式.csv", "external_item": "政策服務參與、據點量能、曝光強度",
            "integration_action": "維持原檔，不混入", "rows_after": len(wage),
            "governance_reason": "政策服務行政資料不屬於受僱員工薪資調查母體。",
        },
        {
            "file": "06_政策服務與曝光_長格式.csv", "external_item": "官方場次、人次、服務參與／曝光強度、青職個案、據點及量能",
            "integration_action": "新增輔助發布檔", "rows_after": service["rows"],
            "governance_reason": "保留政策服務行政資料身分；不建立第四個人口母體，也不改寫三母體分母。",
        },
    ]
    write_csv(publish / "07_三母體與外部政策資料整合狀態.csv", list(rows[0]), rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, default=DEFAULT_PACKAGE)
    args = parser.parse_args()
    package = args.package.resolve()
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    PROCESSED.mkdir(parents=True, exist_ok=True)
    registered = update_registered_population(package)
    service = build_service_outputs(package, config)
    write_integration_status(package, registered, service)
    update_catalog(package, registered, service)
    copy_release_inputs(package)
    diagnostics = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "config_version": config["configVersion"],
        "registered_population_external_extension": registered,
        "policy_service_auxiliary": service,
        "status": "PASS",
    }
    qa_path = package / "08_人工查核與異常處理" / "machine_qa" / "external_policy_data_validation.json"
    qa_path.parent.mkdir(parents=True, exist_ok=True)
    qa_path.write_text(json.dumps(diagnostics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(diagnostics, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

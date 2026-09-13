from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


def resolve_project_root() -> Path:
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "config" / "g5-refresh-policy.json").is_file() and (candidate / "scripts").is_dir():
            return candidate
    raise RuntimeError("Cannot locate NtpcYouthAI project root")


PROJECT = resolve_project_root()
DEFAULT_PACKAGE = PROJECT / "deliverables" / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826"
OUTPUT = PROJECT / "dashboard" / "app" / "data" / "g5-dashboard-data.json"


def rows(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, default=DEFAULT_PACKAGE)
    args = parser.parse_args()
    publish = args.package.resolve() / "09_發布資料包"
    registered_path = publish / "01_戶籍人口母體_長格式.csv"
    labor_path = publish / "02_民間人口與勞動市場母體_長格式.csv"
    wage_path = publish / "03_受僱員工薪資母體_長格式.csv"
    service_path = publish / "06_政策服務與曝光_長格式.csv"
    external_processed = args.package.resolve() / "10_官方原始資料與處理結果" / "07_行政區面積與政策服務" / "processed"
    facility_path = external_processed / "NTPC_Youth_Service_Facility_Inventory.csv"
    capacity_path = external_processed / "NTPC_Youth_Service_Capacity_Components.csv"

    registered = defaultdict(lambda: {
        "population": None,
        "populationSharePct": None,
        "sexSharePct": None,
        "populationDensityPerKm2": None,
        "education": {},
        "marriage": {},
    })
    land_area = {}
    geography_meta = {}
    for row in rows(registered_path):
        year = int(row["roc_year"])
        geography = row["geography_name_zh"]
        geography_meta[row["geography_name_zh"]] = {
            "code": row["geography_code"],
            "name": row["geography_name_zh"],
            "level": row["geography_level"],
        }
        metric = row["metric_code"]
        raw_value = row["value"].strip()
        value = float(raw_value) if raw_value else None
        if metric == "LAND_AREA_KM2":
            if value is not None:
                land_area[(year, geography)] = value
            continue
        key = (year, geography, row["age_band"], row["sex_name_zh"])
        item = registered[key]
        if metric == "REGISTERED_POPULATION_COUNT":
            item["population"] = value
            item["populationOrigin"] = row["value_origin_label_zh"]
        elif metric == "REGISTERED_POPULATION_SHARE_PCT":
            item["populationSharePct"] = value
        elif metric == "SEX_SHARE_WITHIN_AGE_BAND_PCT":
            item["sexSharePct"] = value
        elif metric == "REGISTERED_YOUTH_POPULATION_DENSITY_PER_KM2":
            item["populationDensityPerKm2"] = value
        elif metric == "EDUCATION_SHARE_PCT":
            item["education"][row["category_name_zh"]] = {
                "value": value,
                "origin": row["value_origin_label_zh"],
                "method": row["method_name_zh"],
                "low": float(row["uncertainty_low"]) if row["uncertainty_low"] else None,
                "high": float(row["uncertainty_high"]) if row["uncertainty_high"] else None,
            }
        elif metric == "MARITAL_STATUS_SHARE_PCT":
            item["marriage"][row["category_name_zh"]] = {
                "value": value,
                "origin": row["value_origin_label_zh"],
                "method": row["method_name_zh"],
                "low": float(row["uncertainty_low"]) if row["uncertainty_low"] else None,
                "high": float(row["uncertainty_high"]) if row["uncertainty_high"] else None,
            }

    registered_list = []
    for (year, geography, age_band, sex), item in sorted(registered.items()):
        if item["population"] is None:
            continue
        registered_list.append({
            "year": year,
            "geography": geography,
            "ageBand": age_band,
            "sex": sex,
            "landAreaKm2": land_area.get((year, geography)),
            **item,
        })

    labor = defaultdict(dict)
    labor_meta = defaultdict(dict)
    for row in rows(labor_path):
        key = (int(row["roc_year"]), row["age_band"])
        labor[key][row["metric_name_zh"]] = float(row["value"])
        labor_meta[key][row["metric_name_zh"]] = {
            "unit": row["unit"],
            "origin": row["value_origin_label_zh"],
            "method": row["method_name_zh"],
            "low": float(row["uncertainty_low"]) if row["uncertainty_low"] else None,
            "high": float(row["uncertainty_high"]) if row["uncertainty_high"] else None,
        }
    labor_list = [
        {"year": year, "ageBand": age_band, "metrics": metrics, "meta": labor_meta[(year, age_band)]}
        for (year, age_band), metrics in sorted(labor.items())
    ]

    wage = defaultdict(dict)
    wage_meta = defaultdict(dict)
    for row in rows(wage_path):
        key = (int(row["roc_year"]), row["age_band"])
        raw_value = row["value"].strip()
        if raw_value:
            wage[key][row["metric_name_zh"]] = float(raw_value)
        wage_meta[key][row["metric_name_zh"]] = {
            "unit": row["unit"],
            "origin": row["value_origin_label_zh"],
            "method": row["method_name_zh"],
            "low": float(row["uncertainty_low"]) if row["uncertainty_low"] else None,
            "high": float(row["uncertainty_high"]) if row["uncertainty_high"] else None,
        }
    wage_list = [
        {"year": year, "ageBand": age_band, "metrics": metrics, "meta": wage_meta[(year, age_band)]}
        for (year, age_band), metrics in sorted(wage.items()) if metrics
    ]

    service_records = defaultdict(dict)
    service_meta = defaultdict(dict)
    metric_field = {
        "SERVICE_ACTIVITY_COUNT": "activityCount",
        "SERVICE_PARTICIPATION_PERSON_TIMES": "participationPersonTimes",
        "SERVICE_PERSON_TIMES_PER_ACTIVITY": "personTimesPerActivity",
    }
    for row in rows(service_path):
        if row["category_dimension_code"] != "SERVICE_DOMAIN" or row["sex_code"] != "ALL":
            continue
        field = metric_field.get(row["metric_code"])
        if not field or not row["value"].strip():
            continue
        key = (int(row["roc_year"]), row["category_code"])
        service_records[key][field] = float(row["value"])
        service_meta[key][field] = {
            "origin": row["value_origin_label_zh"],
            "method": row["method_name_zh"],
            "unit": row["unit"],
            "sourceUrl": row["source_url"],
        }
        service_records[key]["domainLabel"] = row["category_name_zh"]
    service_annual = [
        {
            "year": year,
            "domain": domain,
            **metrics,
            "meta": service_meta[(year, domain)],
        }
        for (year, domain), metrics in sorted(service_records.items())
    ]

    facilities = []
    for row in rows(facility_path):
        facilities.append({
            "facilityCode": row["facility_code"],
            "name": row["facility_name_zh"],
            "facilityType": row["facility_type"],
            "districtCode": row["district_code"],
            "district": row["district_name_zh"],
            "address": row["address_zh"],
            "operatingStatus": row["operating_status"],
            "active": row["active_flag"] == "1",
            "capacityComponentCount": int(row["capacity_component_count"]),
            "capacitySummary": row["capacity_summary_zh"],
            "sourceUrl": row["source_url"],
            "qaStatus": row["qa_status"],
        })
    capacities = []
    for row in rows(capacity_path):
        capacities.append({
            "facilityCode": row["facility_code"],
            "facilityName": row["facility_name_zh"],
            "districtCode": row["district_code"],
            "district": row["district_name_zh"],
            "componentCode": row["component_code"],
            "componentName": row["component_name_zh"],
            "value": float(row["capacity_value"]),
            "unit": row["capacity_unit"],
            "method": row["method_code"],
            "formula": row["formula_zh"],
            "operatingStatus": row["operating_status"],
            "sourceUrl": row["source_url"],
        })

    payload = {
        "meta": {
            "version": "G6 UI V5.3",
            "externalDataVersion": "G6-EXTERNAL-1.0",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "defaultView": "同年度檢視",
            "years": [110, 111, 112, 113, 114],
            "defaultYear": 114,
            "ageBands": ["18-24", "25-29", "30-35", "18-35"],
            "defaultAgeBand": "18-35",
            "sexes": ["合計", "男", "女"],
            "defaultSex": "合計",
            "completeCommonYear": 113,
            "dailyReviewTime": "每天09:15（Asia/Taipei）",
            "yearWindowRule": "執行民國年-5至執行民國年-1",
        },
        "geographies": sorted(geography_meta.values(), key=lambda item: (item["level"] != "CITY", item["name"])),
        "registered": registered_list,
        "labor": labor_list,
        "wage": wage_list,
        "service": {
            "annual": service_annual,
            "facilities": facilities,
            "capacityComponents": capacities,
            "exposure": {
                "status": "PUBLISH_EXACT_DERIVED",
                "label": "服務參與／曝光強度",
                "unit": "人次／場",
                "formula": "同年度服務參與人次÷同年度活動場次",
                "caveat": "同一人重複參與會重複計入；本指標表示活動服務強度，不是不同人數占比。行政區無人次／場次交叉時不得分區計算。",
            },
            "snapshotYear": 115,
        },
        "sources": [
            {"name": "村里戶數、單一年齡人口", "url": "https://data.gov.tw/dataset/77132", "cadence": "每月"},
            {"name": "15歲以上現住人口按教育程度分", "url": "https://data.gov.tw/dataset/117988", "cadence": "每年"},
            {"name": "15歲以上現住人口按婚姻狀況分", "url": "https://data.gov.tw/dataset/117986", "cadence": "每年"},
            {"name": "人力資源調查統計年報", "url": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078", "cadence": "每年"},
            {"name": "受僱員工全年總薪資統計", "url": "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642", "cadence": "每年"},
            {"name": "勞工保險人數（年齡、地區、性別）", "url": "https://data.gov.tw/dataset/162821", "cadence": "每年"},
            {"name": "勞工退休金平均提繳工資－按年齡組別", "url": "https://data.gov.tw/dataset/46103", "cadence": "每年"},
            {"name": "新北市資料開放平臺 OpenAPI", "url": "https://data.ntpc.gov.tw/openapi/", "cadence": "依資料集"},
            {"name": "新北市統計資料庫", "url": "https://oas.bas.ntpc.gov.tw/DgbasWeb/Page/Default.aspx", "cadence": "依統計表"},
            {"name": "新北市行政區面積", "url": "https://data.ntpc.gov.tw/datasets/13f881c7-53c4-4f8c-b693-816584562666", "cadence": "不定期修訂"},
            {"name": "新北市政府青年局統計年報", "url": "https://www.youth.ntpc.gov.tw/youth/ch/app/data/list?id=136&module=youth0008", "cadence": "每年"},
            {"name": "113年度青職基地營運分析", "url": "https://www.youth.ntpc.gov.tw/youth/ch/app/data/doc?detailNo=1404372674104266752&module=youth0008&type=s", "cadence": "依專案報告"},
            {"name": "新北市青年服務據點官方頁面", "url": "https://www.youth.ntpc.gov.tw/youth/ch/app/data/view?id=101&module=youth0009&serno=fff05b70-3f77-4b85-806b-3cb0cf89194c", "cadence": "不定期"},
        ],
        "files": [
            {"name": registered_path.name, "sha256": sha256(registered_path)},
            {"name": labor_path.name, "sha256": sha256(labor_path)},
            {"name": wage_path.name, "sha256": sha256(wage_path)},
            {"name": service_path.name, "sha256": sha256(service_path)},
            {"name": facility_path.name, "sha256": sha256(facility_path)},
            {"name": capacity_path.name, "sha256": sha256(capacity_path)},
        ],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "output": str(OUTPUT),
        "bytes": OUTPUT.stat().st_size,
        "registered": len(registered_list),
        "labor": len(labor_list),
        "wage": len(wage_list),
        "serviceAnnual": len(service_annual),
        "facilities": len(facilities),
        "capacityComponents": len(capacities),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Add the G6 UI V2 dashboard sources to the complete R2 data package.

This script copies immutable official snapshots, dashboard-ready JSON outputs,
and the exact reproducible builders used by the dashboard.  It does not fetch
the network and fails closed when the expected 110–114 source set is incomplete.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
PACKAGE = PROJECT / "deliverables" / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826"
DASHBOARD = PROJECT / "dashboard"
CACHE = DASHBOARD / "work" / "official-source-check"
PUBLISH = PACKAGE / "09_發布資料包"
RAW_ROOT = PACKAGE / "10_官方原始資料與處理結果"
MANIFESTS = PACKAGE / "11_介接設定與追溯紀錄" / "manifests"
QA_ROOT = PACKAGE / "08_人工查核與異常處理" / "machine_qa"

MONTHLY_PERIODS = [f"{year}{month:02d}" for year in range(110, 115) for month in range(1, 13)]
TABLE33_PAGES = {
    110: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=207903",
    111: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=231112",
    112: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=234726",
    113: "https://www.stat.gov.tw/News_Content.aspx?n=4002&s=234885",
    114: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
}
TABLE33_URLS = {
    110: "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/207903/table33.xls",
    111: "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/231112/table33.xls",
    112: "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/234726/table33.xlsx",
    113: "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/234727/table33.xlsx",
    114: "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/236078/table33.xlsx",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package_path(path: Path) -> str:
    return path.relative_to(PACKAGE).as_posix()


def copy_verified(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.is_file() or sha256(destination) != sha256(source):
        shutil.copy2(source, destination)
    if sha256(destination) != sha256(source):
        raise RuntimeError(f"Copy verification failed: {destination}")


def monthly_source(period: str) -> Path:
    candidates = [CACHE / f"MOI_ODRP014_{period}.json", CACHE / f"MOI_ODRP014_{period}_p1.json"]
    source = next((item for item in candidates if item.is_file()), None)
    if source is None:
        raise FileNotFoundError(f"Missing MOI ODRP014 source for {period}")
    return source


def clean_package_noise_and_fill_readmes() -> None:
    """Keep the handoff package free of runtime caches and self-describing."""
    for cache_dir in sorted(PACKAGE.rglob("__pycache__"), reverse=True):
        if cache_dir.is_dir():
            shutil.rmtree(cache_dir)
    for compiled_file in PACKAGE.rglob("*.pyc"):
        compiled_file.unlink()

    for directory in sorted((path for path in PACKAGE.rglob("*") if path.is_dir()), key=lambda path: len(path.parts)):
        readme = directory / "README.txt"
        if readme.exists():
            continue
        relative = directory.relative_to(PACKAGE).as_posix()
        if "_render" in directory.name:
            description = "本層存放文件或圖表的機器轉圖結果，供版面與內容查核使用；不是發布數據來源。"
        elif "AWS資料平台IaC/functions" in relative:
            description = "本層存放 AWS 資料平台基礎設施程式碼；目前僅供 Kiro 後續實作，不代表已部署。"
        else:
            description = "本層為完整資料包的輔助目錄；請依上層 TOC、README 與來源清冊判讀用途。"
        readme.write_text(
            f"資料夾：{relative}\n用途：{description}\n治理要求：不得將查核產物、程式碼或估計值誤認為官方原始值。\n",
            encoding="utf-8",
        )


def main() -> int:
    generated_at = datetime.now(timezone.utc).isoformat()
    MANIFESTS.mkdir(parents=True, exist_ok=True)
    QA_ROOT.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []

    for period in MONTHLY_PERIODS:
        year = int(period[:3])
        source = monthly_source(period)
        destination = RAW_ROOT / "01_人口" / "official_original" / "monthly" / str(year) / f"MOI_ODRP014_{period}.json"
        copy_verified(source, destination)
        records.append({
            "kind": "OFFICIAL_RAW",
            "source_alias": "MOI-POP-MONTHLY",
            "source_period": period,
            "official_page": "https://data.gov.tw/dataset/77132",
            "official_download_url": f"https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/{period}",
            "package_path": package_path(destination),
            "bytes": destination.stat().st_size,
            "sha256": sha256(destination),
            "identity": "官方行政精確值",
            "population_scope": "戶籍登記現住人口",
            "publication_limit": "月底存量；不得與年度平均流量互稱",
        })

    for year in range(110, 115):
        candidates = sorted(CACHE.glob(f"DGBAS_{year}_Annual_Table33_Industry.*"))
        if len(candidates) != 1:
            raise RuntimeError(f"Expected one Table 33 file for {year}, found {len(candidates)}")
        source = candidates[0]
        destination = RAW_ROOT / "04_勞動" / "official_original" / "annual" / str(year) / source.name
        copy_verified(source, destination)
        records.append({
            "kind": "OFFICIAL_RAW",
            "source_alias": "DGBAS-HR-T33",
            "source_period": year,
            "official_page": TABLE33_PAGES[year],
            "official_download_url": TABLE33_URLS[year],
            "package_path": package_path(destination),
            "bytes": destination.stat().st_size,
            "sha256": sha256(destination),
            "identity": "官方人力資源調查估計",
            "population_scope": "平常居住於新北市且屬15歲以上民間人口中的就業者",
            "publication_limit": "全年齡就業者；不得描述為18–35歲青年行業分布",
        })

    output_pairs = [
        (
            DASHBOARD / "app" / "data" / "monthly-population.json",
            PUBLISH / "09_月度青年戶籍人口_110_114.json",
            "MOI-POP-MONTHLY-DERIVED",
        ),
        (
            DASHBOARD / "app" / "data" / "resident-employment-industry.json",
            PUBLISH / "10_新北市居住就業者行業分布_110_114.json",
            "DGBAS-HR-T33-DERIVED",
        ),
    ]
    for source, destination, alias in output_pairs:
        copy_verified(source, destination)
        records.append({
            "kind": "DASHBOARD_DERIVED",
            "source_alias": alias,
            "source_period": [110, 111, 112, 113, 114],
            "official_page": "https://data.gov.tw/dataset/77132" if alias.startswith("MOI") else TABLE33_PAGES[114],
            "official_download_url": None,
            "package_path": package_path(destination),
            "bytes": destination.stat().st_size,
            "sha256": sha256(destination),
            "identity": "官方原始資料之可重現衍生輸出",
            "population_scope": "依輸出meta欄位",
            "publication_limit": "必須連同來源、方法、數值身分與限制呈現",
        })

    reproducible = PACKAGE / "05_年齡轉換與統計方法" / "reproducible_scripts"
    implementation = PACKAGE / "12_AWS_Kiro_實作檔案" / "儀表板G6_UI_V2"
    source_code = [
        (PROJECT / "scripts" / "build_g5_source_manifest.py", reproducible / "build_g5_source_manifest.py"),
        (PROJECT / "scripts" / "build_release_zip.py", reproducible / "build_release_zip.py"),
        (PROJECT / "scripts" / "update_g6_ui_v2_data_package.py", reproducible / "update_g6_ui_v2_data_package.py"),
        (DASHBOARD / "scripts" / "build_monthly_population_data.py", reproducible / "build_monthly_population_data.py"),
        (DASHBOARD / "scripts" / "build_resident_employment_industry_data.py", reproducible / "build_resident_employment_industry_data.py"),
        (DASHBOARD / "scripts" / "build_monthly_population_data.py", implementation / "build_monthly_population_data.py"),
        (DASHBOARD / "scripts" / "build_resident_employment_industry_data.py", implementation / "build_resident_employment_industry_data.py"),
        (DASHBOARD / "app" / "map-metrics.ts", implementation / "map-metrics.ts"),
        (DASHBOARD / "app" / "policy-engine.ts", implementation / "policy-engine.ts"),
        (DASHBOARD / "app" / "resident-employment-industry.ts", implementation / "resident-employment-industry.ts"),
        (DASHBOARD / "app" / "api" / "monthly-population" / "route.ts", implementation / "monthly-population-route.ts"),
    ]
    for source, destination in source_code:
        copy_verified(source, destination)

    monthly_payload = json.loads((DASHBOARD / "app" / "data" / "monthly-population.json").read_text(encoding="utf-8"))
    industry_payload = json.loads((DASHBOARD / "app" / "data" / "resident-employment-industry.json").read_text(encoding="utf-8"))
    monthly_periods = monthly_payload["meta"]["periods"]
    if monthly_periods != MONTHLY_PERIODS:
        raise RuntimeError("Monthly output does not contain the exact 11001–11412 window")
    if len(monthly_payload["records"]) != 21600:
        raise RuntimeError("Monthly output record count must be 21,600")
    if monthly_payload["qa"]["ageBandReconciliation"] != "PASS" or monthly_payload["qa"]["sexReconciliation"] != "PASS" or monthly_payload["qa"]["districtReconciliation"] != "PASS":
        raise RuntimeError("Monthly output reconciliation failed")
    annual_snapshot = monthly_payload["qa"]["annualSnapshot11412"]
    if annual_snapshot["actual"] != 845938 or annual_snapshot["status"] != "PASS":
        raise RuntimeError("Monthly output does not reconcile to the 11412 official snapshot")
    if industry_payload["qa"]["status"] != "PASS" or len(industry_payload["records"]) != 285:
        raise RuntimeError("Industry output QA failed")

    additional_manifest = {
        "manifest_version": "G6-UI-V2-R2.0",
        "generated_at_utc": generated_at,
        "record_count": len(records),
        "records": records,
    }
    (MANIFESTS / "dashboard-additional-sources-manifest.json").write_text(
        json.dumps(additional_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    catalog_path = PUBLISH / "data_catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["catalog_version"] = "G6-UI-V2-R2.0"
    catalog["generated_at_utc"] = generated_at
    catalog["dashboardAdditionalSources"] = [
        {
            "name_zh": "月度青年戶籍人口",
            "path": "09_發布資料包/09_月度青年戶籍人口_110_114.json",
            "source_alias": "MOI-POP-MONTHLY",
            "periods": ["11001", "11412"],
            "records": 21600,
            "qa_status": "PASS",
            "universe": "戶籍人口母體",
            "limitation": "每月月底存量；不由年度值拆月",
        },
        {
            "name_zh": "新北市居住就業者行業分布",
            "path": "09_發布資料包/10_新北市居住就業者行業分布_110_114.json",
            "source_alias": "DGBAS-HR-T33",
            "years": [110, 111, 112, 113, 114],
            "records": 285,
            "qa_status": "PASS",
            "universe": "民間人口及勞動市場母體之就業者輔助分析",
            "limitation": "15歲以上全年齡就業者；不得描述為18–35歲青年行業分布",
        },
    ]
    catalog["dashboardAdditionalSourceManifest"] = "11_介接設定與追溯紀錄/manifests/dashboard-additional-sources-manifest.json"
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    qa = {
        "generated_at_utc": generated_at,
        "status": "PASS_WITH_SCOPE_LIMIT",
        "monthly_registered_population": {
            "official_raw_files": 60,
            "first_period": MONTHLY_PERIODS[0],
            "last_period": MONTHLY_PERIODS[-1],
            "derived_records": len(monthly_payload["records"]),
            "geographies_per_period": 30,
            "age_bands": ["18-24", "25-29", "30-35", "18-35"],
            "sexes": ["合計", "男", "女"],
            "reconciliation": monthly_payload["qa"],
            "status": "PASS",
        },
        "resident_employment_industry": {
            "official_raw_files": 5,
            "years": [110, 111, 112, 113, 114],
            "categories": industry_payload["qa"]["categoryCount"],
            "derived_records": len(industry_payload["records"]),
            "reconciliation": industry_payload["qa"]["years"],
            "status": "PASS_WITH_SCOPE_LIMIT",
            "scope_limit": "全年齡就業者，不是18–35歲青年專屬分布",
        },
        "aws_actions_executed": False,
    }
    (QA_ROOT / "g6-ui-v2-dashboard-source-validation.json").write_text(
        json.dumps(qa, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    clean_package_noise_and_fill_readmes()

    print(json.dumps({
        "monthlyRawFiles": 60,
        "table33RawFiles": 5,
        "monthlyRecords": len(monthly_payload["records"]),
        "industryRecords": len(industry_payload["records"]),
        "manifestRecords": len(records),
        "status": "PASS_WITH_SCOPE_LIMIT",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

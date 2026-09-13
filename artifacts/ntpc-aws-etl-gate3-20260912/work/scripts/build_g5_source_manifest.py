import hashlib
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

def resolve_project_root() -> Path:
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "config" / "g5-refresh-policy.json").is_file() and (candidate / "scripts").is_dir():
            return candidate
    raise RuntimeError("Cannot locate NtpcYouthAI project root")


PROJECT = resolve_project_root()
DEFAULT_PACKAGE = PROJECT / "deliverables" / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826"
WAGE_AUX = PROJECT / "data" / "raw" / "WAGE-AUX" / "20260826"
LABOR_ROOT = PROJECT / "deliverables" / "NTPC_Labor_18-35_Sprague_PCLM_Pilot_V1.1_20260825"
LABOR_ANNUAL_URLS = {
    110: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=207903",
    111: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=231112",
    112: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=234726",
    113: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=234885",
    114: "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
}
DASHBOARD_SOURCE_CACHE = PROJECT / "dashboard" / "work" / "official-source-check"
DASHBOARD_OUTPUTS = {
    "MOI-POP-MONTHLY-DERIVED": PROJECT / "dashboard" / "app" / "data" / "monthly-population.json",
    "DGBAS-HR-T33-DERIVED": PROJECT / "dashboard" / "app" / "data" / "resident-employment-industry.json",
}
DGBAS_TABLE33_URLS = {
    110: "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/207903/table33.xls",
    111: "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/231112/table33.xls",
    112: "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/234726/table33.xlsx",
    113: "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/234727/table33.xlsx",
    114: "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/236078/table33.xlsx",
}
LABOR_TABLE_ROLES = {
    27: ("DGBAS-HR-T27", "主要輸入：15歲以上民間人口之教育程度與年齡"),
    28: ("DGBAS-HR-T28", "品質查核：官方勞動力表，只作E+U四捨五入一致性核對"),
    32: ("DGBAS-HR-T32", "主要輸入：就業者之教育程度與年齡"),
    36: ("DGBAS-HR-T36", "主要輸入：失業者之教育程度與年齡"),
}

URLS = {
    "MOI-POP1Y": "https://data.gov.tw/dataset/77132",
    "MOI-EDU5Y": "https://data.gov.tw/dataset/117988",
    "MOI-MARITAL5Y": "https://data.gov.tw/dataset/117986",
    "DGBAS-WAGE-LOC": "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642",
    "BLI-AGE-REGION-SEX": "https://data.gov.tw/dataset/162821",
    "BLI-PENSION-AGE-WAGE": "https://data.gov.tw/dataset/46103",
    "NTPC-DISTRICT-MAP": "https://data.ntpc.gov.tw/datasets/214634ca-3c71-4fc8-8f46-faffe97f23ff",
    "NTPC-OPENAPI-CROSSCHECK": "https://data.ntpc.gov.tw/openapi/",
    "NTPC-OAS-CROSSCHECK": "https://oas.bas.ntpc.gov.tw/DgbasWeb/Page/Default.aspx",
    "NTPC-LAND-AREA": "https://data.ntpc.gov.tw/datasets/13f881c7-53c4-4f8c-b693-816584562666",
    "NTPC-YOUTH-ANNUAL": "https://www.youth.ntpc.gov.tw/youth/ch/app/data/list?id=136&module=youth0008",
    "NTPC-YOUTH-CAREER-BASE-113": "https://www.youth.ntpc.gov.tw/youth/ch/app/data/doc?detailNo=1404372674104266752&module=youth0008&type=s",
    "NTPC-YOUTH-BASE-PAGES": "https://www.youth.ntpc.gov.tw/youth/ch/app/folder/59",
    "MOI-POP-MONTHLY": "https://data.gov.tw/dataset/77132",
    "DGBAS-HR-T33": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, default=DEFAULT_PACKAGE)
    args = parser.parse_args()
    package = args.package.resolve()
    diagnostics_path = package / "08_人工查核與異常處理" / "machine_qa" / "data_build_diagnostics.json"
    output = package / "00_總覽與治理" / "source_manifest.json"
    diagnostics = json.loads(diagnostics_path.read_text(encoding="utf-8"))
    records = []
    for item in diagnostics["registered_population"]["sources"]:
        records.append({
            "source_alias": item["source_alias"],
            "official_url": URLS[item["source_alias"]],
            "source_period_roc_year": item["year"],
            "local_project_path": item["path"],
            "sha256": item["sha256"],
            "bytes": item["bytes"],
            "storage_rule": "不可變原始快照；發布包以清冊參照，避免複製大型來源檔",
        })

    for year, official_url in LABOR_ANNUAL_URLS.items():
        for table_number, (alias, role) in LABOR_TABLE_ROLES.items():
            path = LABOR_ROOT / "raw" / "annual" / str(year) / f"table{table_number}.xlsx"
            records.append({
                "source_alias": alias,
                "official_url": official_url,
                "source_period_roc_year": year,
                "local_project_path": str(path.relative_to(PROJECT)).replace("\\", "/"),
                "sha256": sha256(path),
                "bytes": path.stat().st_size,
                "storage_rule": role,
            })

    h2_path = LABOR_ROOT / "half_year_114H2" / "source_rounding_reconciliation.csv"
    records.append({
        "source_alias": "AUX:DGBAS-NTPC-H2-T41+T42",
        "official_url": "https://www.stat.gov.tw/News_Content.aspx?n=4003&s=235759",
        "source_period_roc_year": 114,
        "local_project_path": str(h2_path.relative_to(PROJECT)).replace("\\", "/"),
        "sha256": sha256(h2_path),
        "bytes": h2_path.stat().st_size,
        "storage_rule": "輔助輸入：同年下半年15–19／20–24之E、U、NLF占比；只拆分全年15–24，保持全年總量",
    })

    labor_section = diagnostics["civilian_labor_market"]
    labor_derived_path = PROJECT / labor_section["derived_source"]
    records.append({
        "source_alias": "DERIVED:DGBAS-NTPC-LABOR-TARGET-AGE",
        "official_url": None,
        "source_period_roc_year": labor_section["years"],
        "local_project_path": labor_section["derived_source"],
        "sha256": labor_section["derived_source_sha256"],
        "bytes": labor_derived_path.stat().st_size,
        "storage_rule": "衍生模型輸出；必須回溯同年度表27／32／36、表28 QA及114年H2輔助來源",
    })

    for alias, section in [
        ("DGBAS-WAGE-LOC", diagnostics["employee_wage"]),
    ]:
        path = Path(section["source"])
        records.append({
            "source_alias": alias,
            "official_url": URLS[alias],
            "source_period_roc_year": section.get("years", section.get("available_years")),
            "local_project_path": str(path).replace("\\", "/"),
            "sha256": section["source_sha256"],
            "bytes": (PROJECT / path).stat().st_size,
            "storage_rule": "受控官方來源／模型輸出；由詳細診斷與CSV列級來源欄位追溯",
        })

    for year in (110, 111, 112, 113):
        for alias, filename in (
            ("BLI-AGE-REGION-SEX", f"BLI-AGE-REGION-SEX-{year}.csv"),
            ("BLI-PENSION-AGE-WAGE", f"BLI-PENSION-AGE-WAGE-{year}.csv"),
        ):
            path = WAGE_AUX / filename
            records.append({
                "source_alias": alias,
                "official_url": URLS[alias],
                "source_period_roc_year": year,
                "local_project_path": str(path.relative_to(PROJECT)).replace("\\", "/"),
                "sha256": sha256(path),
                "bytes": path.stat().st_size,
                "storage_rule": "薪資年齡轉換輔助資料；只建立相對輪廓或年齡權數，不冒充全年總薪資官方原生值",
            })

    map_path = PROJECT / "dashboard" / "public" / "data" / "ntpc-districts.geojson"
    records.append({
        "source_alias": "NTPC-DISTRICT-MAP",
        "official_url": URLS["NTPC-DISTRICT-MAP"],
        "source_period_roc_year": "現行行政區界",
        "local_project_path": str(map_path.relative_to(PROJECT)).replace("\\", "/"),
        "sha256": sha256(map_path),
        "bytes": map_path.stat().st_size,
        "storage_rule": "只用於戶籍人口母體行政區互動；不為勞動或薪資建立區級值",
    })

    for alias in ("NTPC-OPENAPI-CROSSCHECK", "NTPC-OAS-CROSSCHECK"):
        records.append({
            "source_alias": alias,
            "official_url": URLS[alias],
            "source_period_roc_year": "依資料集／統計表",
            "local_project_path": None,
            "sha256": None,
            "bytes": None,
            "storage_rule": "命題指定平台；交叉查核使用，不與核心來源重複加權",
        })

    area_path = PROJECT / "data" / "raw" / "NTPC-LAND-AREA" / "20260831" / "NTPC-DISTRICT-LAND-AREA.csv"
    records.append({
        "source_alias": "NTPC-LAND-AREA",
        "official_url": URLS["NTPC-LAND-AREA"],
        "source_period_roc_year": "現行行政區參照；擷取日115-08-31",
        "local_project_path": str(area_path.relative_to(PROJECT)).replace("\\", "/"),
        "sha256": sha256(area_path),
        "bytes": area_path.stat().st_size,
        "storage_rule": "行政區公告面積固定參照；以ptid轉8碼行政區碼並驗證29區一一對應。",
    })

    youth_raw = PROJECT / "data" / "raw" / "NTPC-YOUTH-SERVICE" / "20260831"
    annual_urls = {
        111: "https://www.youth.ntpc.gov.tw/youth/ch/app/data/doc?detailNo=1149610994704584704&module=youth0008&type=s",
        112: "https://www.youth.ntpc.gov.tw/youth/ch/app/data/doc?detailNo=1252104139530309632&module=youth0008&type=s",
        113: "https://www.youth.ntpc.gov.tw/youth/ch/app/data/doc?detailNo=1379997079249620992&module=youth0008&type=s",
        114: "https://www.youth.ntpc.gov.tw/youth/ch/app/data/doc?detailNo=1505809476916088832&module=youth0008&type=s",
    }
    for year, official_url in annual_urls.items():
        path = youth_raw / f"YOUTH-ANNUAL-{year}.pdf"
        records.append({
            "source_alias": "NTPC-YOUTH-ANNUAL",
            "official_url": official_url,
            "source_period_roc_year": year,
            "local_project_path": str(path.relative_to(PROJECT)).replace("\\", "/"),
            "sha256": sha256(path),
            "bytes": path.stat().st_size,
            "storage_rule": "官方年報原始快照；場次、人次與性別直接轉錄，人次不得解讀為去重人數。",
        })

    career_path = youth_raw / "YOUTH-CAREER-BASE-113.pdf"
    records.append({
        "source_alias": "NTPC-YOUTH-CAREER-BASE-113",
        "official_url": URLS["NTPC-YOUTH-CAREER-BASE-113"],
        "source_period_roc_year": 113,
        "local_project_path": str(career_path.relative_to(PROJECT)).replace("\\", "/"),
        "sha256": sha256(career_path),
        "bytes": career_path.stat().st_size,
        "storage_rule": "青職基地專業服務個案分析；保留官方原生年齡帶，18–35只發布可識別界線，不產生點估計。",
    })

    for path in sorted(youth_raw.glob("BASE-*.html")):
        records.append({
            "source_alias": "NTPC-YOUTH-BASE-PAGES",
            "official_url": URLS["NTPC-YOUTH-BASE-PAGES"],
            "source_period_roc_year": "擷取日115-08-31",
            "local_project_path": str(path.relative_to(PROJECT)).replace("\\", "/"),
            "sha256": sha256(path),
            "bytes": path.stat().st_size,
            "storage_rule": "官方據點頁面快照；不同容量單位不可相加，暫停營運狀態須保留。",
        })

    for year in range(110, 115):
        for month in range(1, 13):
            period = f"{year}{month:02d}"
            candidates = [
                DASHBOARD_SOURCE_CACHE / f"MOI_ODRP014_{period}.json",
                DASHBOARD_SOURCE_CACHE / f"MOI_ODRP014_{period}_p1.json",
            ]
            source_path = next((item for item in candidates if item.is_file()), None)
            if source_path is None:
                raise FileNotFoundError(f"Missing monthly population source for {period}")
            package_path = package / "10_官方原始資料與處理結果" / "01_人口" / "official_original" / "monthly" / str(year) / f"MOI_ODRP014_{period}.json"
            if not package_path.is_file() or sha256(package_path) != sha256(source_path):
                raise RuntimeError(f"Package monthly source is missing or differs from cache: {period}")
            records.append({
                "source_alias": "MOI-POP-MONTHLY",
                "official_url": f"https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/{period}",
                "source_period_roc_year": period,
                "local_project_path": str(source_path.relative_to(PROJECT)).replace("\\", "/"),
                "package_path": str(package_path.relative_to(package)).replace("\\", "/"),
                "sha256": sha256(source_path),
                "bytes": source_path.stat().st_size,
                "storage_rule": "官方逐月村里單一年齡人口原始快照；18–35歲以單一年齡直接加總，不使用年齡模型。",
            })

    for year, table_url in DGBAS_TABLE33_URLS.items():
        source_path = next(iter(sorted(DASHBOARD_SOURCE_CACHE.glob(f"DGBAS_{year}_Annual_Table33_Industry.*"))), None)
        if source_path is None:
            raise FileNotFoundError(f"Missing DGBAS Table 33 source for {year}")
        package_path = package / "10_官方原始資料與處理結果" / "04_勞動" / "official_original" / "annual" / str(year) / source_path.name
        if not package_path.is_file() or sha256(package_path) != sha256(source_path):
            raise RuntimeError(f"Package Table 33 source is missing or differs from cache: {year}")
        records.append({
            "source_alias": "DGBAS-HR-T33",
            "official_url": table_url,
            "source_period_roc_year": year,
            "local_project_path": str(source_path.relative_to(PROJECT)).replace("\\", "/"),
            "package_path": str(package_path.relative_to(package)).replace("\\", "/"),
            "sha256": sha256(source_path),
            "bytes": source_path.stat().st_size,
            "storage_rule": "官方人力資源調查年報表33；全年12個月平均、15歲以上就業者母體，不得解讀為18–35歲青年行業分布。",
        })

    derived_package_paths = {
        "MOI-POP-MONTHLY-DERIVED": package / "09_發布資料包" / "09_月度青年戶籍人口_110_114.json",
        "DGBAS-HR-T33-DERIVED": package / "09_發布資料包" / "10_新北市居住就業者行業分布_110_114.json",
    }
    for alias, source_path in DASHBOARD_OUTPUTS.items():
        package_path = derived_package_paths[alias]
        if not package_path.is_file() or sha256(package_path) != sha256(source_path):
            raise RuntimeError(f"Package dashboard output is missing or differs from source: {alias}")
        records.append({
            "source_alias": alias,
            "official_url": URLS["MOI-POP-MONTHLY"] if alias.startswith("MOI") else URLS["DGBAS-HR-T33"],
            "source_period_roc_year": [110, 111, 112, 113, 114],
            "local_project_path": str(source_path.relative_to(PROJECT)).replace("\\", "/"),
            "package_path": str(package_path.relative_to(package)).replace("\\", "/"),
            "sha256": sha256(source_path),
            "bytes": source_path.stat().st_size,
            "storage_rule": "儀表板衍生資料；必須回溯同alias原始快照、產製程式與QA紀錄。",
        })

    manifest = {
        "manifest_version": "G6-UI-V2-R2.0",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "raw_storage_root": "data/raw",
        "package_storage_policy": "R2完整封裝實體納入110–114年月人口60份快照及表33五份原始表；其他大型來源依既有清冊、相對路徑與SHA-256參照。",
        "records": records,
    }
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Build governed industry shares for employed residents of New Taipei City.

Official source: DGBAS Manpower Survey annual report, Table 33, 110–114.
The table reports annual-average employed persons by region, industry and sex.
Values are rounded to thousand persons, so reconciliation allows the official
rounding residual but never silently forces category sums to the published total.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import openpyxl


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "work" / "official-source-check"
OUTPUT = ROOT / "app" / "data" / "resident-employment-industry.json"
VENDOR = ROOT / "work" / "python-vendor"
sys.path.insert(0, str(VENDOR))

try:
    import xlrd
except ImportError as error:  # pragma: no cover - local data-build dependency
    raise RuntimeError("Install xlrd==2.0.2 to parse the 110–111 official .xls files") from error


SOURCES = {
    110: {
        "page": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=207903",
        "table": "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/207903/table33.xls",
    },
    111: {
        "page": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=231112",
        "table": "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/231112/table33.xls",
    },
    112: {
        "page": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=234726",
        "table": "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/234726/table33.xlsx",
    },
    113: {
        "page": "https://www.stat.gov.tw/News_Content.aspx?n=4002&s=234885",
        "table": "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/234727/table33.xlsx",
    },
    114: {
        "page": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
        "table": "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/236078/table33.xlsx",
    },
}

# One-based column positions in official Table 33.  The survey publishes
# Information & Communication as one combined reporting category.
CATEGORIES = [
    ("A", "農、林、漁、牧業", 6),
    ("B", "礦業及土石採取業", 13),
    ("C", "製造業", 16),
    ("D", "電力及燃氣供應業", 19),
    ("E", "用水供應及污染整治業", 22),
    ("F", "營建工程業", 28),
    ("G", "批發及零售業", 34),
    ("H", "運輸及倉儲業", 38),
    ("I", "住宿及餐飲業", 41),
    ("J–K", "資訊及通訊傳播業", 44),
    ("L", "金融及保險業", 47),
    ("M", "不動產業", 53),
    ("N", "專業、科學及技術服務業", 56),
    ("O", "支援服務業", 59),
    ("P", "公共行政及國防；強制性社會安全", 63),
    ("Q", "教育服務業", 66),
    ("R", "醫療保健及社會工作服務業", 69),
    ("S", "藝術、娛樂及休閒服務業", 72),
    ("T", "其他服務業", 75),
]
SEX_COLUMN_OFFSET = {"合計": 0, "男": 1, "女": 2}
DENOMINATOR_COLUMN = {"合計": 3, "男": 4, "女": 5}


def download(year: int) -> Path:
    extension = Path(SOURCES[year]["table"]).suffix
    path = CACHE / f"DGBAS_{year}_Annual_Table33_Industry{extension}"
    if not path.exists():
        request = urllib.request.Request(
            SOURCES[year]["table"], headers={"User-Agent": "NTPC-Youth-Evidence/1.0"}
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            path.write_bytes(response.read())
    return path


def rows(path: Path) -> list[list[object]]:
    if path.suffix == ".xlsx":
        sheet = openpyxl.load_workbook(path, data_only=True, read_only=True).active
        return [list(row) for row in sheet.iter_rows(values_only=True)]
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    return [sheet.row_values(row_number) for row_number in range(sheet.nrows)]


def number(row: list[object], one_based_column: int) -> float:
    value = row[one_based_column - 1]
    return 0.0 if value in (None, "", "-") else float(value)


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []
    qa_years: list[dict] = []

    for year in SOURCES:
        table_rows = rows(download(year))
        ntpc_rows = [row for row in table_rows if any("New Taipei City" in str(value) for value in row)]
        if len(ntpc_rows) != 2:
            raise ValueError(f"{year}: expected count and percentage rows for New Taipei City")
        count_row, published_percentage_row = ntpc_rows
        denominators = {sex: number(count_row, column) for sex, column in DENOMINATOR_COLUMN.items()}
        published_denominator_shares = {
            sex: number(published_percentage_row, column)
            for sex, column in DENOMINATOR_COLUMN.items()
        }
        if any(value <= 0 for value in denominators.values()):
            raise ValueError(f"{year}: invalid employed-person denominators {denominators}")

        sums = {sex: 0.0 for sex in SEX_COLUMN_OFFSET}
        maximum_category_sex_gap = 0.0
        maximum_published_share_gap = 0.0
        for code, label, base_column in CATEGORIES:
            category_counts = {
                sex: number(count_row, base_column + offset)
                for sex, offset in SEX_COLUMN_OFFSET.items()
            }
            maximum_category_sex_gap = max(
                maximum_category_sex_gap,
                abs(category_counts["合計"] - category_counts["男"] - category_counts["女"]),
            )
            for sex, employed_thousands in category_counts.items():
                share_of_all_employed = number(
                    published_percentage_row, base_column + SEX_COLUMN_OFFSET[sex]
                )
                share_pct = share_of_all_employed / published_denominator_shares[sex] * 100
                sums[sex] += employed_thousands
                records.append(
                    {
                        "year": year,
                        "industryCode": code,
                        "industry": label,
                        "sex": sex,
                        "employedThousands": employed_thousands,
                        "sharePct": round(share_pct, 2),
                    }
                )
            official_share = number(published_percentage_row, base_column)
            calculated_share = category_counts["合計"] / denominators["合計"] * 100
            maximum_published_share_gap = max(
                maximum_published_share_gap, abs(calculated_share - official_share)
            )

        residuals = {sex: round(sums[sex] - denominators[sex], 2) for sex in sums}
        if any(abs(value) > 5 for value in residuals.values()):
            raise ValueError(f"{year}: category reconciliation outside rounding tolerance {residuals}")
        if maximum_category_sex_gap > 1:
            raise ValueError(f"{year}: category sex reconciliation outside rounding tolerance")
        if maximum_published_share_gap > 0.08:
            raise ValueError(
                f"{year}: calculated share differs from official percentage row "
                f"({maximum_published_share_gap:.4f} percentage points)"
            )

        qa_years.append(
            {
                "year": year,
                "employedThousands": denominators,
                "categorySumResidualThousands": residuals,
                "maximumCategorySexGapThousands": round(maximum_category_sex_gap, 2),
                "maximumOfficialShareGapPercentagePoints": round(maximum_published_share_gap, 4),
                "status": "PASS",
            }
        )

    output = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "years": list(SOURCES),
            "sourceName": "行政院主計總處人力資源調查年報表33：就業者之行業",
            "sourcePages": {str(year): value["page"] for year, value in SOURCES.items()},
            "sourceTables": {str(year): value["table"] for year, value in SOURCES.items()},
            "universe": "平常居住於新北市且屬15歲以上民間人口中的就業者",
            "identity": "官方人力資源調查估計；比例為官方發布分布的衍生計算值",
            "timeBasis": "各年全年12個月平均",
            "classification": "人力資源調查表33發布層級；110–114年採第11次行業統計分類基礎，資訊及通訊傳播業合併呈現",
            "method": "行業比例＝該性別之該行業就業人數÷該性別就業總人數×100",
            "availability": "可發布；全年齡、居住地口徑，不等同18–35歲或工作地在新北市",
        },
        "qa": {
            "years": qa_years,
            "categoryCount": len(CATEGORIES),
            "recordCount": len(records),
            "status": "PASS",
        },
        "records": records,
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT} with {len(records)} records; QA=PASS")


if __name__ == "__main__":
    # Backward-compatible entry point: the governed public artifact is now the
    # youth analysis layer. Keep this filename callable by existing runbooks,
    # but do not allow it to overwrite the youth dataset with the legacy
    # all-age-only payload.
    from build_youth_resident_employment_industry_data import main as build_governed_youth_layer

    build_governed_youth_layer()

"""Build a traceable youth industry analysis layer for New Taipei City.

Annual Table 33 supplies official all-age values. June and December regional
tables supply official first/second-half industry x broad-age x sex estimates.
Youth bands are produced by H1/H2 averaging, PCLM single-age graduation and
IPF reconciliation. A common-profile IPF allocation is retained as a method
sensitivity envelope, not a confidence interval.

The youth row margins are taken from the dashboard's governed youth labor
analysis layer. This prevents the industry detail from publishing a different
youth employment total from the labor page while the official broad-age x sex
x industry cells remain hard IPF constraints.
"""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import openpyxl


ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT.parent
CACHE = ROOT / "work" / "official-source-check"
OUTPUT = ROOT / "app" / "data" / "resident-employment-industry.json"
LABOR_LAYER = ROOT / "app" / "data" / "g5-dashboard-data.json"
sys.path.insert(0, str(ROOT / "work" / "python-vendor"))
sys.path.insert(0, str(PROJECT / "scripts"))

try:
    import xlrd
except ImportError as error:  # pragma: no cover
    raise RuntimeError("xlrd==2.0.2 is required for 110-111 .xls files") from error

from process_marital_status_v23 import ipf, select_pclm  # noqa: E402


ANNUAL_SOURCES = {
    110: ("https://www.stat.gov.tw/News_Content.aspx?n=4001&s=207903", "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/207903/table33.xls"),
    111: ("https://www.stat.gov.tw/News_Content.aspx?n=4001&s=231112", "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/231112/table33.xls"),
    112: ("https://www.stat.gov.tw/News_Content.aspx?n=4001&s=234726", "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/234726/table33.xlsx"),
    113: ("https://www.stat.gov.tw/News_Content.aspx?n=4002&s=234885", "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/234727/table33.xlsx"),
    114: ("https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078", "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11516/236078/table33.xlsx"),
}

HALF_YEAR_SOURCES = {
    110: {
        "H1": ("https://www.stat.gov.tw/News_Content.aspx?n=4000&s=87658", "https://ws.dgbas.gov.tw/public/data/dgbas04/bc4/month/11006/table42.xls"),
        "H2": ("https://www.stat.gov.tw/News_Content.aspx?n=4000&s=207899", "https://ws.dgbas.gov.tw/public/data/dgbas04/bc4/month/11012/table42.xls"),
    },
    111: {
        "H1": ("https://www.stat.gov.tw/News_Content.aspx?n=4000&s=227828", "https://ws.dgbas.gov.tw/public/data/dgbas04/bc4/month/11106/table42.xls"),
        "H2": ("https://www.stat.gov.tw/News_Content.aspx?n=4000&s=230702", "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11040/230702/table42.xls"),
    },
    112: {
        "H1": ("https://www.stat.gov.tw/News_Content.aspx?n=4003&s=231948", "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11040/231948/table42.xlsx"),
        "H2": ("https://www.stat.gov.tw/News_Content.aspx?n=4000&s=232937", "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11040/232937/table42.xlsx"),
    },
    113: {
        "H1": ("https://www.stat.gov.tw/News_Content.aspx?n=4000&s=233571", "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11040/233571/table42.xlsx"),
        "H2": ("https://www.stat.gov.tw/News_Content.aspx?n=4000&s=234489", "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11040/234489/table42.xlsx"),
    },
    114: {
        "H1": ("https://www.stat.gov.tw/News_Content.aspx?n=4003&s=235113", "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11040/235113/table44.xlsx"),
        "H2": ("https://www.stat.gov.tw/News_Content.aspx?n=4003&s=235759", "https://ws.dgbas.gov.tw/001/Upload/463/relfile/11040/235759/table44.xlsx"),
    },
}

# code, Chinese label, annual Table 33 column, half-year row offset from sex total
CATEGORIES = [
    ("A", "農、林、漁、牧業", 6, 1),
    ("B", "礦業及土石採取業", 13, 4),
    ("C", "製造業", 16, 5),
    ("D", "電力及燃氣供應業", 19, 6),
    ("E", "用水供應及污染整治業", 22, 7),
    ("F", "營建工程業", 28, 9),
    ("G", "批發及零售業", 34, 11),
    ("H", "運輸及倉儲業", 38, 12),
    ("I", "住宿及餐飲業", 41, 13),
    ("J–K", "資訊及通訊傳播業", 44, 15),
    ("L", "金融及保險業", 47, 17),
    ("M", "不動產業", 53, 18),
    ("N", "專業、科學及技術服務業", 56, 19),
    ("O", "支援服務業", 59, 21),
    ("P", "公共行政及國防；強制性社會安全", 63, 22),
    ("Q", "教育服務業", 66, 24),
    ("R", "醫療保健及社會工作服務業", 69, 25),
    ("S", "藝術、娛樂及休閒服務業", 72, 27),
    ("T", "其他服務業", 75, 29),
]
SEX_COLUMN_OFFSET = {"合計": 0, "男": 1, "女": 2}
DENOMINATOR_COLUMN = {"合計": 3, "男": 4, "女": 5}
MODEL_SEXES = ("男", "女")
SOURCE_GROUPS = ((15, 24), (25, 44), (45, 64))
GROUP_COLUMNS = {(15, 24): 3, (25, 44): 4, (45, 64): 5}
TARGET_BANDS = {
    "18-24": tuple(range(18, 25)),
    "25-29": tuple(range(25, 30)),
    "30-35": tuple(range(30, 36)),
    "18-35": tuple(range(18, 36)),
}
AGES = np.arange(15, 65)


def labor_layer_targets(year: int) -> dict[str, dict[str, float]]:
    payload = json.loads(LABOR_LAYER.read_text(encoding="utf-8"))
    result: dict[str, dict[str, float]] = {}
    for age_band in TARGET_BANDS:
        row = next(
            item for item in payload["labor"]
            if item["year"] == year and item["ageBand"] == age_band
        )
        result[age_band] = {
            "value": float(row["metrics"]["就業人口"]),
            "low": float(row["meta"]["就業人口"]["low"]),
            "high": float(row["meta"]["就業人口"]["high"]),
        }
    component_total = sum(result[band]["value"] for band in ("18-24", "25-29", "30-35"))
    if abs(component_total - result["18-35"]["value"]) > 1e-5:
        raise ValueError(f"{year}: governed youth employment bands do not add to 18-35")
    return result


def constrained_row_targets(
    overall_seed: np.ndarray,
    group: tuple[int, int],
    group_total: float,
    youth_targets: dict[str, dict[str, float]],
) -> np.ndarray:
    """Return single-age row margins with governed youth totals held fixed."""
    start, end = group
    segments: list[tuple[tuple[int, ...], float]]
    if group == (15, 24):
        youth = youth_targets["18-24"]["value"]
        segments = [(tuple(range(15, 18)), group_total - youth), (TARGET_BANDS["18-24"], youth)]
    elif group == (25, 44):
        age_25_29 = youth_targets["25-29"]["value"]
        age_30_35 = youth_targets["30-35"]["value"]
        segments = [
            (TARGET_BANDS["25-29"], age_25_29),
            (TARGET_BANDS["30-35"], age_30_35),
            (tuple(range(36, 45)), group_total - age_25_29 - age_30_35),
        ]
    else:
        segments = [(tuple(range(start, end + 1)), group_total)]
    if any(target < -1e-6 for _ages, target in segments):
        raise ValueError(f"Invalid constrained age margin for {group}: {segments}")
    output = np.zeros(end - start + 1)
    for ages, target in segments:
        local_indices = np.array([age - start for age in ages])
        seed_indices = np.array([age - int(AGES[0]) for age in ages])
        seed = np.maximum(overall_seed[seed_indices], 0)
        output[local_indices] = target / len(ages) if seed.sum() <= 0 else seed / seed.sum() * target
    if abs(float(output.sum()) - group_total) > 1e-6:
        raise ValueError(f"Constrained row targets do not close for {group}")
    return output


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download(url: str, path: Path) -> Path:
    if not path.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "NTPC-Youth-Evidence/1.0"})
        with urllib.request.urlopen(request, timeout=120) as response:
            path.write_bytes(response.read())
    return path


def annual_path(year: int) -> Path:
    url = ANNUAL_SOURCES[year][1]
    return download(url, CACHE / f"DGBAS_{year}_Annual_Table33_Industry{Path(url).suffix}")


def half_path(year: int, half: str) -> Path:
    url = HALF_YEAR_SOURCES[year][half][1]
    return download(url, CACHE / f"DGBAS_{year}_{half}_NTPC_Industry_Age{Path(url).suffix}")


def read_rows(path: Path) -> list[list[object]]:
    if path.suffix == ".xlsx":
        sheet = openpyxl.load_workbook(path, data_only=True, read_only=True).active
        return [list(row) for row in sheet.iter_rows(values_only=True)]
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    return [sheet.row_values(index) for index in range(sheet.nrows)]


def number(row: list[object], one_based_column: int) -> float:
    value = row[one_based_column - 1]
    return 0.0 if value in (None, "", "-") else float(value)


def numeric_label_row(table: list[list[object]], label: str) -> int:
    for index, row in enumerate(table):
        if row and label in str(row[0]) and len(row) > 1 and isinstance(row[1], (int, float)):
            return index
    raise ValueError(f"Missing numeric row: {label}")


def parse_half_year(path: Path) -> dict:
    table = read_rows(path)
    total_rows = {
        "合計": numeric_label_row(table, "Total"),
        "男": numeric_label_row(table, "Male"),
        "女": numeric_label_row(table, "Female"),
    }
    result = {"counts": {}, "totals": {}, "allAge": {}, "sha256": sha256(path)}
    for sex, total_row in total_rows.items():
        result["counts"][sex] = {}
        result["totals"][sex] = {}
        result["allAge"][sex] = {}
        for code, _label, _annual_column, row_offset in CATEGORIES:
            result["allAge"][sex][code] = number(table[total_row + row_offset], 2)
        for group, column in GROUP_COLUMNS.items():
            result["totals"][sex][group] = number(table[total_row], column)
            result["counts"][sex][group] = {
                code: number(table[total_row + row_offset], column)
                for code, _label, _annual_column, row_offset in CATEGORIES
            }
    return result


def average_halves(first: dict, second: dict) -> dict:
    sexes = ("合計", *MODEL_SEXES)
    return {
        "counts": {
            sex: {
                group: {
                    code: (first["counts"][sex][group][code] + second["counts"][sex][group][code]) / 2
                    for code, *_rest in CATEGORIES
                }
                for group in SOURCE_GROUPS
            }
            for sex in sexes
        },
        "totals": {
            sex: {
                group: (first["totals"][sex][group] + second["totals"][sex][group]) / 2
                for group in SOURCE_GROUPS
            }
            for sex in sexes
        },
        "allAge": {
            sex: {
                code: (first["allAge"][sex][code] + second["allAge"][sex][code]) / 2
                for code, *_rest in CATEGORIES
            }
            for sex in sexes
        },
    }


def build_all_age(year: int) -> tuple[list[dict], dict]:
    table = read_rows(annual_path(year))
    ntpc = [row for row in table if any("New Taipei City" in str(value) for value in row)]
    if len(ntpc) != 2:
        raise ValueError(f"{year}: expected count and percentage rows")
    count_row, percentage_row = ntpc
    denominators = {sex: number(count_row, column) for sex, column in DENOMINATOR_COLUMN.items()}
    denominator_shares = {sex: number(percentage_row, column) for sex, column in DENOMINATOR_COLUMN.items()}
    records = []
    sums = {sex: 0.0 for sex in SEX_COLUMN_OFFSET}
    maximum_sex_gap = 0.0
    maximum_share_gap = 0.0
    for code, label, column, _row_offset in CATEGORIES:
        counts = {sex: number(count_row, column + offset) for sex, offset in SEX_COLUMN_OFFSET.items()}
        maximum_sex_gap = max(maximum_sex_gap, abs(counts["合計"] - counts["男"] - counts["女"]))
        for sex, value in counts.items():
            share = number(percentage_row, column + SEX_COLUMN_OFFSET[sex]) / denominator_shares[sex] * 100
            sums[sex] += value
            records.append({
                "year": year, "ageBand": "ALL", "industryCode": code, "industry": label, "sex": sex,
                "employedThousands": value, "employedThousandsLow": value, "employedThousandsHigh": value,
                "sharePct": round(share, 2), "sharePctLow": round(share, 2), "sharePctHigh": round(share, 2),
                "origin": "官方人力資源調查估計值", "method": "官方年報表33全年12個月平均發布值",
                "methodCode": "M0_DGBAS_ANNUAL_TABLE33",
            })
        maximum_share_gap = max(maximum_share_gap, abs(counts["合計"] / denominators["合計"] * 100 - number(percentage_row, column)))
    residuals = {sex: round(sums[sex] - denominators[sex], 2) for sex in sums}
    if any(abs(value) > 5 for value in residuals.values()) or maximum_sex_gap > 1 or maximum_share_gap > 0.08:
        raise ValueError(f"{year}: annual Table 33 reconciliation failed")
    return records, {
        "year": year, "employedThousands": denominators, "categorySumResidualThousands": residuals,
        "maximumCategorySexGapThousands": round(maximum_sex_gap, 2),
        "maximumOfficialShareGapPercentagePoints": round(maximum_share_gap, 4), "status": "PASS",
    }


def build_youth(year: int, official_all_age: list[dict]) -> tuple[list[dict], dict, list[dict]]:
    first = parse_half_year(half_path(year, "H1"))
    second = parse_half_year(half_path(year, "H2"))
    annual = average_halves(first, second)
    youth_targets = labor_layer_targets(year)
    category_index = {code: index for index, (code, *_rest) in enumerate(CATEGORIES)}
    column_keys = [(sex, code) for sex in MODEL_SEXES for code, *_rest in CATEGORIES]
    combined_group_totals = np.array([
        sum(annual["counts"][sex][group][code] for sex, code in column_keys)
        for group in SOURCE_GROUPS
    ])
    overall_seed, overall_diagnostic = select_pclm(combined_group_totals, AGES, list(SOURCE_GROUPS))
    lambdas: list[float] = [float(overall_diagnostic["lambda"])]
    column_seed = np.zeros((len(AGES), len(column_keys)))
    for column_index, (sex, code) in enumerate(column_keys):
        grouped_values = np.array([annual["counts"][sex][group][code] for group in SOURCE_GROUPS])
        column_seed[:, column_index], diagnostic = select_pclm(grouped_values, AGES, list(SOURCE_GROUPS))
        lambdas.append(float(diagnostic["lambda"]))
    main_matrix = np.zeros_like(column_seed)
    alternative_matrix = np.zeros_like(column_seed)
    source_error = 0.0
    for group_index, (start, end) in enumerate(SOURCE_GROUPS):
        indices = np.where((AGES >= start) & (AGES <= end))[0]
        col_targets = np.array([annual["counts"][sex][(start, end)][code] for sex, code in column_keys])
        row_targets = constrained_row_targets(overall_seed, (start, end), float(col_targets.sum()), youth_targets)
        main_matrix[indices, :], diagnostic = ipf(column_seed[indices, :], row_targets, col_targets)
        alternative_seed = np.outer(np.maximum(row_targets, 1e-12), np.maximum(col_targets, 1e-12))
        alternative_matrix[indices, :], _ = ipf(alternative_seed, row_targets, col_targets)
        source_error = max(
            source_error,
            float(np.max(np.abs(main_matrix[indices, :].sum(axis=0) - col_targets))),
            float(diagnostic["col_error"]),
        )

    sex_columns = {
        sex: np.array([index for index, (column_sex, _code) in enumerate(column_keys) if column_sex == sex])
        for sex in MODEL_SEXES
    }

    records = []
    total_rows = []
    share_error = 0.0
    maximum_sensitivity = 0.0
    for age_band, target_ages in TARGET_BANDS.items():
        indices = np.array([age - int(AGES[0]) for age in target_ages])
        totals: dict[str, float] = {}
        for sex in (*MODEL_SEXES, "合計"):
            if sex == "合計":
                values = np.array([
                    main_matrix[np.ix_(indices, sex_columns["男"][[category_index[code]]])].sum()
                    + main_matrix[np.ix_(indices, sex_columns["女"][[category_index[code]]])].sum()
                    for code, *_rest in CATEGORIES
                ])
                alternatives = np.array([
                    alternative_matrix[np.ix_(indices, sex_columns["男"][[category_index[code]]])].sum()
                    + alternative_matrix[np.ix_(indices, sex_columns["女"][[category_index[code]]])].sum()
                    for code, *_rest in CATEGORIES
                ])
            else:
                values = main_matrix[np.ix_(indices, sex_columns[sex])].sum(axis=0)
                alternatives = alternative_matrix[np.ix_(indices, sex_columns[sex])].sum(axis=0)
            denominator = float(values.sum())
            alternative_denominator = float(alternatives.sum())
            totals[sex] = round(denominator, 6)
            shares = values / denominator * 100
            alternative_shares = alternatives / alternative_denominator * 100
            share_error = max(share_error, abs(float(shares.sum()) - 100))
            for code, label, _annual_column, _row_offset in CATEGORIES:
                index = category_index[code]
                value, alternative_value = float(values[index]), float(alternatives[index])
                share, alternative_share = float(shares[index]), float(alternative_shares[index])
                total_low_scale = youth_targets[age_band]["low"] / youth_targets[age_band]["value"]
                total_high_scale = youth_targets[age_band]["high"] / youth_targets[age_band]["value"]
                count_candidates = (
                    value, alternative_value,
                    value * total_low_scale, value * total_high_scale,
                    alternative_value * total_low_scale, alternative_value * total_high_scale,
                )
                maximum_sensitivity = max(maximum_sensitivity, abs(share - alternative_share))
                records.append({
                    "year": year, "ageBand": age_band, "industryCode": code, "industry": label, "sex": sex,
                    "employedThousands": round(value, 6),
                    "employedThousandsLow": round(min(count_candidates), 6),
                    "employedThousandsHigh": round(max(count_candidates), 6),
                    "sharePct": round(share, 6), "sharePctLow": round(min(share, alternative_share), 6),
                    "sharePctHigh": round(max(share, alternative_share), 6),
                    "origin": "官方調查寬年齡帶與青年就業母數雙重錨定之模型估計值",
                    "method": "上下半年平均＋PCLM初始輪廓＋IPF校準官方性別×行業×寬年齡邊際及青年分析層就業母數",
                    "methodCode": "M2_H1H2_PCLM_IPF_YOUTH_LABOR_ANCHOR",
                })
        total_rows.append({"year": year, "ageBand": age_band, "employedThousands": totals})

    labor_target_error = max(
        abs(next(item for item in total_rows if item["ageBand"] == age_band)["employedThousands"]["合計"] - target["value"])
        for age_band, target in youth_targets.items()
    )

    combined_sex_gap = 0.0
    category_residual = 0.0
    for group in SOURCE_GROUPS:
        for code, *_rest in CATEGORIES:
            combined_sex_gap = max(combined_sex_gap, abs(annual["counts"]["合計"][group][code] - annual["counts"]["男"][group][code] - annual["counts"]["女"][group][code]))
        for sex in ("合計", *MODEL_SEXES):
            category_residual = max(category_residual, abs(sum(annual["counts"][sex][group].values()) - annual["totals"][sex][group]))
    official_lookup = {(row["industryCode"], row["sex"]): row["employedThousands"] for row in official_all_age}
    half_to_annual_gap = max(abs(annual["allAge"][sex][code] - official_lookup[(code, sex)]) for sex in ("合計", *MODEL_SEXES) for code, *_rest in CATEGORIES)

    if source_error > 1e-5 or share_error > 1e-5 or labor_target_error > 1e-5:
        raise ValueError(f"{year}: model reconstruction failed")
    if combined_sex_gap > 2 or category_residual > 6 or half_to_annual_gap > 1.1:
        raise ValueError(f"{year}: official source reconciliation outside rounding tolerance")
    diagnostic = {
        "year": year, "sourceBandReaggregationMaxErrorThousands": round(source_error, 8),
        "shareClosureMaxErrorPercentagePoints": round(share_error, 8),
        "officialCombinedSexResidualMaxThousands": round(combined_sex_gap, 4),
        "officialCategorySumResidualMaxThousands": round(category_residual, 4),
        "halfYearToAnnualTableMaxGapThousands": round(half_to_annual_gap, 4),
        "laborTargetReconciliationMaxErrorThousands": round(labor_target_error, 8),
        "methodSensitivityMaxPercentagePoints": round(maximum_sensitivity, 6),
        "selectedPclmLambdas": sorted(set(lambdas)), "status": "PASS",
    }
    return records, diagnostic, total_rows


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    records, annual_qa, youth_qa, youth_totals = [], [], [], []
    source_files = {}
    for year in ANNUAL_SOURCES:
        official_records, official_diagnostic = build_all_age(year)
        modeled_records, modeled_diagnostic, totals = build_youth(year, official_records)
        records.extend(official_records + modeled_records)
        annual_qa.append(official_diagnostic)
        youth_qa.append(modeled_diagnostic)
        youth_totals.extend(totals)
        source_files[str(year)] = {
            "annualSha256": sha256(annual_path(year)), "h1Sha256": sha256(half_path(year, "H1")),
            "h2Sha256": sha256(half_path(year, "H2")),
        }
    payload = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(), "years": list(ANNUAL_SOURCES),
            "ageBands": ["18-24", "25-29", "30-35", "18-35", "ALL"],
            "sourceName": "行政院主計總處人力資源調查：新北市就業者之行業與年齡分配、年報表33",
            "sourcePages": {str(year): page for year, (page, _table) in ANNUAL_SOURCES.items()},
            "sourceTables": {str(year): table for year, (_page, table) in ANNUAL_SOURCES.items()},
            "halfYearSourcePages": {str(year): {half: item[0] for half, item in halves.items()} for year, halves in HALF_YEAR_SOURCES.items()},
            "halfYearSourceTables": {str(year): {half: item[1] for half, item in halves.items()} for year, halves in HALF_YEAR_SOURCES.items()},
            "sourceFiles": source_files,
            "laborLayerSha256": sha256(LABOR_LAYER),
            "laborTargetSource": "儀表板既有青年就業分析層：人力資源調查官方原生年齡帶與PCLM換算就業人數",
            "universe": "平常居住於新北市且屬15歲以上民間人口中的就業者",
            "identity": "全年齡為官方人力資源調查估計；四組青年年齡為官方行業寬帶與青年就業母數雙重錨定之模型估計",
            "timeBasis": "全年齡採官方全年12個月平均；青年分析層以官方上、下半年平均形成年度寬帶矩陣",
            "classification": "第11次行業統計分類發布層級；資訊及通訊傳播業合併呈現，共19類",
            "method": "青年行業人數＝上、下半年官方行業寬帶平均後，以PCLM形成單一年齡初始輪廓，再用IPF同時校準至官方性別×行業×寬年齡邊際與既有青年分析層就業人數；行業比例＝該年齡性別之該行業估計人數÷19類估計總數×100",
            "sensitivity": "計數上下界同時包絡主模型／共同年齡輪廓替代法及既有青年就業母數上下界；占比上下界為兩種配置法包絡；均不是信賴區間",
            "availability": "可發布110–114年、四組青年年齡、男女與19類行業；須顯示模型估計與居住地口徑",
        },
        "qa": {"years": annual_qa, "youthYears": youth_qa, "youthTotals": youth_totals, "categoryCount": len(CATEGORIES), "recordCount": len(records), "status": "PASS"},
        "records": records,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT} with {len(records)} records; QA=PASS")


if __name__ == "__main__":
    main()

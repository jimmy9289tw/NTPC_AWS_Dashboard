"""Build the compact citywide education x marriage dashboard dataset.

The official source publishes five-year age groups.  For target bands that cut
through those groups (18-24, 30-35 and 18-35), this script uses the same
governed method as the main G5 pipeline:

1. fit a citywide PCLM single-age seed for every education x marriage cell;
2. use IPF within each district, sex and official five-year age group;
3. constrain rows to official single-age population and columns to the
   official joint-table counts;
4. publish one governed payload for every district and the city total as the
   sum of the 29 district estimates.

The 25-29 band is an official native five-year group and is published directly.
The proportional-seed IPF result is retained as a sensitivity envelope only;
it is not a confidence interval.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np


DASHBOARD = Path(__file__).resolve().parents[1]
PROJECT = DASHBOARD.parent
sys.path.insert(0, str(PROJECT / "scripts"))

from build_g5_v3_data import (  # noqa: E402
    SOURCE_GROUPS,
    TARGET_BANDS,
    find_population_snapshots,
    read_population,
)
from process_marital_status_v23 import ipf, select_pclm  # noqa: E402


YEARS = (110, 111, 112, 113, 114)
SEXES = ("男", "女")
EDUCATION = ("國中及以下", "高中職", "專科", "大學", "研究所")
MARRIAGE = ("未婚", "有偶", "離婚或終止結婚", "喪偶")
JOINT_CATEGORIES = tuple((education, marriage) for education in EDUCATION for marriage in MARRIAGE)
SOURCE_URL = "https://data.gov.tw/dataset/117988"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_source(path: Path):
    aggregate: dict[tuple[int, str, str, str, tuple[int, int], str, str], float] = defaultdict(float)
    geography_names: dict[str, str] = {}
    rows_read = 0
    rows_used = 0
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            rows_read += 1
            year = int(row["民國年度"])
            lower = int(row["年齡下限"] or -1)
            upper = int(row["年齡上限"] or -1)
            age_group = (lower, upper)
            sex = row["性別"].strip()
            education = row["教育程度彙整"].strip()
            marriage = row["婚姻狀態彙整"].strip()
            if (
                year not in YEARS
                or age_group not in SOURCE_GROUPS
                or sex not in SEXES
                or education not in EDUCATION
                or marriage not in MARRIAGE
            ):
                continue
            geo_code = row["地區代碼"].strip()
            geo_name = row["地區"].strip()
            geography_names[geo_code] = geo_name
            aggregate[(year, geo_code, geo_name, sex, age_group, education, marriage)] += float(row["人口數"] or 0)
            rows_used += 1
    return aggregate, geography_names, {"rowsRead": rows_read, "rowsUsed": rows_used}


def fit_city_seeds(aggregate: dict, year: int):
    ages = np.arange(15, 40)
    seeds: dict[str, np.ndarray] = {}
    diagnostics: list[dict] = []
    for sex in SEXES:
        matrix = np.zeros((len(ages), len(JOINT_CATEGORIES)), dtype=float)
        for category_index, (education, marriage) in enumerate(JOINT_CATEGORIES):
            grouped = np.array(
                [
                    aggregate.get((year, "65000000", "新北市", sex, group, education, marriage), 0.0)
                    for group in SOURCE_GROUPS
                ],
                dtype=float,
            )
            fitted, diagnostic = select_pclm(grouped, ages, list(SOURCE_GROUPS))
            matrix[:, category_index] = fitted
            diagnostics.append(
                {
                    "year": year,
                    "sex": sex,
                    "education": education,
                    "marriage": marriage,
                    **diagnostic,
                }
            )
        seeds[sex] = matrix
    return seeds, diagnostics


def estimate_year(
    aggregate: dict,
    year: int,
    population: dict,
    district_names: dict[str, str],
):
    ages = np.arange(15, 40)
    seeds, pclm_diagnostics = fit_city_seeds(aggregate, year)
    estimates: dict[tuple[str, str, int, str, str], float] = defaultdict(float)
    baselines: dict[tuple[str, str, int, str, str], float] = defaultdict(float)
    ipf_diagnostics: list[dict] = []

    for geo_code, geo_name in district_names.items():
        if geo_code == "65000000":
            continue
        for sex in SEXES:
            for start, end in SOURCE_GROUPS:
                indices = np.where((ages >= start) & (ages <= end))[0]
                row_targets = np.array(
                    [population.get((geo_code, geo_name, sex, int(ages[index])), 0) for index in indices],
                    dtype=float,
                )
                col_targets = np.array(
                    [
                        aggregate.get((year, geo_code, geo_name, sex, (start, end), education, marriage), 0.0)
                        for education, marriage in JOINT_CATEGORIES
                    ],
                    dtype=float,
                )
                if col_targets.sum() <= 0:
                    continue
                fitted, fitted_diagnostic = ipf(seeds[sex][indices, :], row_targets, col_targets)
                proportional_seed = np.outer(np.maximum(row_targets, 1e-12), np.maximum(col_targets, 1e-12))
                baseline, _ = ipf(proportional_seed, row_targets, col_targets)
                for local_index, global_index in enumerate(indices):
                    age = int(ages[global_index])
                    for category_index, (education, marriage) in enumerate(JOINT_CATEGORIES):
                        estimates[(geo_code, sex, age, education, marriage)] = float(fitted[local_index, category_index])
                        baselines[(geo_code, sex, age, education, marriage)] = float(baseline[local_index, category_index])
                ipf_diagnostics.append(
                    {
                        "year": year,
                        "geographyCode": geo_code,
                        "sex": sex,
                        "sourceAgeBand": f"{start}-{end}",
                        **fitted_diagnostic,
                    }
                )

    district_codes = [code for code in district_names if code != "65000000"]
    rows_by_geography: dict[str, list[dict]] = {"65000000": []}
    rows_by_geography.update({code: [] for code in district_codes})
    exact_25_29_max_difference = 0.0
    share_closure_max_error = 0.0
    target_population_max_difference = 0.0

    for output_code in rows_by_geography:
        output_name = "新北市" if output_code == "65000000" else district_names[output_code]
        component_codes = district_codes if output_code == "65000000" else [output_code]
        for age_band, target_ages in TARGET_BANDS.items():
            band_rows: list[dict] = []
            for sex in (*SEXES, "合計"):
                for education, marriage in JOINT_CATEGORIES:
                    sex_members = SEXES if sex == "合計" else (sex,)
                    value = sum(
                        estimates.get((component_code, member, age, education, marriage), 0.0)
                        for component_code in component_codes
                        for member in sex_members
                        for age in target_ages
                    )
                    baseline = sum(
                        baselines.get((component_code, member, age, education, marriage), 0.0)
                        for component_code in component_codes
                        for member in sex_members
                        for age in target_ages
                    )
                    if age_band == "25-29":
                        official_value = sum(
                            aggregate.get((year, output_code, output_name, member, (25, 29), education, marriage), 0.0)
                            for member in sex_members
                        )
                        exact_25_29_max_difference = max(exact_25_29_max_difference, abs(value - official_value))
                        value = official_value
                        low = official_value
                        high = official_value
                        origin = "官方行政精確值"
                        method = "官方五歲年齡組直接加總"
                        method_code = "M0_DIRECT_5YEAR_SUM"
                    else:
                        low = min(value, baseline)
                        high = max(value, baseline)
                        origin = "模型估計值"
                        method = "PCLM單一年齡種子＋IPF官方邊際校準"
                        method_code = "M1_PCLM_IPF_JOINT"
                    band_rows.append(
                        {
                            "year": year,
                            "ageBand": age_band,
                            "sex": sex,
                            "education": education,
                            "marriage": marriage,
                            "population": round(value, 6),
                            "populationLow": round(low, 6),
                            "populationHigh": round(high, 6),
                            "origin": origin,
                            "method": method,
                            "methodCode": method_code,
                        }
                    )

            denominators: dict[tuple[str, str], float] = defaultdict(float)
            for row in band_rows:
                denominators[(row["sex"], row["education"])] += row["population"]
            for row in band_rows:
                denominator = denominators[(row["sex"], row["education"])]
                row["educationPopulation"] = round(denominator, 6)
                row["marriageSharePct"] = round(row["population"] / denominator * 100, 6) if denominator else 0.0
            for sex in (*SEXES, "合計"):
                for education in EDUCATION:
                    if denominators[(sex, education)] <= 0:
                        continue
                    share_sum = sum(
                        row["marriageSharePct"]
                        for row in band_rows
                        if row["sex"] == sex and row["education"] == education
                    )
                    share_closure_max_error = max(share_closure_max_error, abs(100.0 - share_sum))

                target_population = sum(
                    population.get((output_code, output_name, member, age), 0)
                    for member in (SEXES if sex == "合計" else (sex,))
                    for age in target_ages
                )
                joint_population = sum(row["population"] for row in band_rows if row["sex"] == sex)
                target_population_max_difference = max(
                    target_population_max_difference,
                    abs(joint_population - target_population),
                )
            rows_by_geography[output_code].extend(band_rows)

    return rows_by_geography, {
        "pclmFits": len(pclm_diagnostics),
        "pclmConverged": sum(1 for row in pclm_diagnostics if row["converged"]),
        "maxPclmGroupReaggregationError": max(row["max_group_reaggregation_error"] for row in pclm_diagnostics),
        "ipfFits": len(ipf_diagnostics),
        "maxIpfRowError": max(row["row_error"] for row in ipf_diagnostics),
        "maxIpfColumnError": max(row["col_error"] for row in ipf_diagnostics),
        "scaledMarginFits": sum(1 for row in ipf_diagnostics if row["margin_status"] != "EXACT_COMPATIBLE"),
        "exact2529MaxDifference": exact_25_29_max_difference,
        "shareClosureMaxError": share_closure_max_error,
        "targetPopulationMaxDifference": target_population_max_difference,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=DASHBOARD / "public" / "data" / "joint-education-marriage.json",
    )
    parser.add_argument(
        "--district-output-dir",
        type=Path,
        default=DASHBOARD / "public" / "data" / "joint-education-marriage-districts",
    )
    args = parser.parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    district_output_dir = args.district_output_dir.resolve()

    aggregate, source_geographies, source_diagnostic = parse_source(source)
    snapshots = find_population_snapshots(YEARS)
    all_rows: list[dict] = []
    district_rows: dict[str, list[dict]] = defaultdict(list)
    year_diagnostics: list[dict] = []
    snapshot_sources: list[dict] = []

    for year in YEARS:
        population_path = snapshots[year]
        population, _all_age_totals, district_names, population_rows = read_population(
            population_path,
            f"{year}12",
        )
        source_district_codes = {
            code for code, name in source_geographies.items() if code != "65000000" and name.startswith("新北市")
        }
        population_district_codes = {code for code in district_names if code != "65000000"}
        if source_district_codes != population_district_codes:
            raise ValueError(
                f"{year}: district code mismatch: source={len(source_district_codes)}, population={len(population_district_codes)}"
            )
        rows_by_geography, diagnostic = estimate_year(aggregate, year, population, district_names)
        all_rows.extend(rows_by_geography["65000000"])
        for geography_code, rows in rows_by_geography.items():
            if geography_code != "65000000":
                district_rows[geography_code].extend(rows)
        year_diagnostics.append({"year": year, **diagnostic})
        snapshot_sources.append(
            {
                "year": year,
                "period": f"{year}12",
                "file": population_path.name,
                "sha256": sha256(population_path),
                "rows": population_rows,
            }
        )

    if len(all_rows) != len(YEARS) * len(TARGET_BANDS) * 3 * len(EDUCATION) * len(MARRIAGE):
        raise ValueError(f"Unexpected output row count: {len(all_rows)}")
    if any(row["population"] < -1e-7 for row in all_rows):
        raise ValueError("Negative population estimate detected")
    if max(row["marriageSharePct"] for row in all_rows) > 100.000001:
        raise ValueError("Marriage share exceeds 100%")
    if any(row["populationLow"] - 1e-7 > row["population"] or row["population"] - 1e-7 > row["populationHigh"] for row in all_rows):
        raise ValueError("Sensitivity envelope does not contain the main estimate")

    payload = {
        "meta": {
            "version": "JOINT-EDU-MARRIAGE-V1",
            "years": list(YEARS),
            "ageBands": list(TARGET_BANDS),
            "sexes": ["合計", "男", "女"],
            "educationCategories": list(EDUCATION),
            "marriageCategories": list(MARRIAGE),
            "geography": "新北市",
            "universe": "戶籍登記現住人口",
            "periodBasis": "每年12月31日年末存量",
            "sourceName": "新北市及29區年齡、性別、教育與婚姻交叉人口",
            "sourceUrl": SOURCE_URL,
            "sourceFile": source.name,
            "sourceSha256": sha256(source),
            "method": "PCLM單一年齡種子＋各行政區IPF校準後加總；25–29歲採官方原生五歲組",
            "sensitivity": "PCLM種子與比例種子兩套IPF結果的包絡；不是信賴區間",
            "denominator": "同年度、同年齡、同性別、同教育程度之四種婚姻狀態人口合計",
            "sourceDiagnostic": source_diagnostic,
            "populationSnapshots": snapshot_sources,
            "yearDiagnostics": year_diagnostics,
        },
        "records": all_rows,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    district_output_dir.mkdir(parents=True, exist_ok=True)
    district_index = []
    for geography_code, geography_rows in sorted(district_rows.items()):
        if len(geography_rows) != len(YEARS) * len(TARGET_BANDS) * 3 * len(EDUCATION) * len(MARRIAGE):
            raise ValueError(f"Unexpected district output row count for {geography_code}: {len(geography_rows)}")
        geography_name = source_geographies[geography_code]
        district_payload = {
            "meta": {
                **payload["meta"],
                "version": "JOINT-EDU-MARRIAGE-DISTRICT-V1",
                "geography": geography_name,
                "geographyCode": geography_code,
            },
            "records": geography_rows,
        }
        district_path = district_output_dir / f"{geography_code}.json"
        district_path.write_text(json.dumps(district_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        district_index.append({"geographyCode": geography_code, "geography": geography_name, "file": district_path.name, "rows": len(geography_rows)})
    (district_output_dir / "index.json").write_text(
        json.dumps({"version": "JOINT-EDU-MARRIAGE-DISTRICT-V1", "districts": district_index}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(json.dumps({"output": str(output), "rows": len(all_rows), "districtFiles": len(district_index), "diagnostics": year_diagnostics}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

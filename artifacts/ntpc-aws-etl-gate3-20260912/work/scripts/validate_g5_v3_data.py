from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


def resolve_project_root() -> Path:
    """Find the repository root from either scripts/ or a packaged script copy."""
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "config" / "g5-refresh-policy.json").is_file() and (candidate / "scripts").is_dir():
            return candidate
    raise RuntimeError("Cannot locate NtpcYouthAI project root")


PROJECT = resolve_project_root()
DEFAULT_PACKAGE = (
    PROJECT
    / "deliverables"
    / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826"
)

LABOR_ANNUAL_URLS = {
    "110": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=207903",
    "111": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=231112",
    "112": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=234726",
    "113": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=234885",
    "114": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
}

LABOR_LINEAGE_EXPECTATIONS = {
    "CIVILIAN_POPULATION": ("DGBAS-HR-T27", (27,)),
    "LABOR_FORCE": ("DGBAS-HR-T32+DGBAS-HR-T36|QA:DGBAS-HR-T28", (32, 36, 28)),
    "EMPLOYED": ("DGBAS-HR-T32", (32,)),
    "UNEMPLOYED": ("DGBAS-HR-T36", (36,)),
    "NOT_IN_LABOR_FORCE": ("DGBAS-HR-T27+DGBAS-HR-T32+DGBAS-HR-T36", (27, 32, 36)),
    "UNEMPLOYMENT_RATE": ("DGBAS-HR-T32+DGBAS-HR-T36", (32, 36)),
    "LABOR_FORCE_PARTICIPATION_RATE": ("DGBAS-HR-T27+DGBAS-HR-T32+DGBAS-HR-T36", (27, 32, 36)),
    "EMPLOYMENT_TO_POPULATION_RATE": ("DGBAS-HR-T27+DGBAS-HR-T32", (27, 32)),
    "EMPLOYMENT_SHARE_OF_LABOR_FORCE": ("DGBAS-HR-T32+DGBAS-HR-T36", (32, 36)),
}


def read_rows(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def number(row: dict, field: str = "value") -> float:
    return float(row[field])


def nearly_equal(left: float, right: float, *, absolute: float = 1e-5, relative: float = 1e-9) -> bool:
    return math.isclose(left, right, abs_tol=absolute, rel_tol=relative)


def validate_registered(rows: list[dict]) -> dict:
    checks = []
    failures = []
    population = {}
    category_counts = defaultdict(float)
    category_shares = defaultdict(float)

    for row in rows:
        metric = row["metric_code"]
        base_key = (
            row["roc_year"],
            row["geography_code"],
            row["geography_name_zh"],
            row["age_band"],
            row["sex_code"],
        )
        if metric == "REGISTERED_POPULATION_COUNT":
            population[base_key] = number(row)
        elif metric in {"EDUCATION_POPULATION_COUNT", "MARITAL_STATUS_POPULATION_COUNT"}:
            key = base_key + (row["category_dimension_code"],)
            category_counts[key] += number(row)
        elif metric in {"EDUCATION_SHARE_PCT", "MARITAL_STATUS_SHARE_PCT"}:
            key = base_key + (row["category_dimension_code"],)
            category_shares[key] += number(row)

    for key, value in category_counts.items():
        expected = population.get(key[:5])
        passed = expected is not None and nearly_equal(value, expected, absolute=0.01)
        checks.append({"check": "category_count_sum_matches_population", "key": key, "actual": value, "expected": expected, "pass": passed})
        if not passed:
            failures.append(checks[-1])

    for key, value in category_shares.items():
        passed = nearly_equal(value, 100.0, absolute=0.0001)
        checks.append({"check": "category_share_sum_100", "key": key, "actual": value, "expected": 100.0, "pass": passed})
        if not passed:
            failures.append(checks[-1])

    dimensions = {"NONE", "EDUCATION", "MARITAL_STATUS"}
    count_metrics = {
        "NONE": "REGISTERED_POPULATION_COUNT",
        "EDUCATION": "EDUCATION_POPULATION_COUNT",
        "MARITAL_STATUS": "MARITAL_STATUS_POPULATION_COUNT",
    }
    values = defaultdict(float)
    for row in rows:
        dimension = row["category_dimension_code"]
        if dimension not in dimensions or row["metric_code"] != count_metrics[dimension]:
            continue
        key = (
            row["roc_year"], row["geography_code"], row["age_band"], dimension,
            row["category_code"], row["sex_code"],
        )
        values[key] += number(row)

    group_keys = {
        (year, geography, age_band, dimension, category)
        for year, geography, age_band, dimension, category, _ in values
    }
    for key in group_keys:
        all_value = values.get(key + ("ALL",), 0.0)
        sex_sum = values.get(key + ("M",), 0.0) + values.get(key + ("F",), 0.0)
        passed = nearly_equal(all_value, sex_sum, absolute=0.01)
        checks.append({"check": "male_plus_female_equals_all", "key": key, "actual": sex_sum, "expected": all_value, "pass": passed})
        if not passed:
            failures.append(checks[-1])

    district_values = defaultdict(float)
    city_values = defaultdict(float)
    for row in rows:
        dimension = row["category_dimension_code"]
        if dimension not in dimensions or row["metric_code"] != count_metrics[dimension]:
            continue
        key = (
            row["roc_year"], row["age_band"], row["sex_code"], dimension, row["category_code"]
        )
        if row["geography_level"] == "DISTRICT":
            district_values[key] += number(row)
        elif row["geography_level"] == "CITY":
            city_values[key] += number(row)
    for key, city_value in city_values.items():
        district_sum = district_values.get(key, 0.0)
        passed = nearly_equal(city_value, district_sum, absolute=0.1)
        checks.append({"check": "district_sum_equals_city", "key": key, "actual": district_sum, "expected": city_value, "pass": passed})
        if not passed:
            failures.append(checks[-1])

    exact_boundary_failures = [
        row["record_id"]
        for row in rows
        if row["age_band"] == "25-29"
        and row["category_dimension_code"] in {"EDUCATION", "MARITAL_STATUS"}
        and row["value_origin_class"] != "OFFICIAL_ADMIN_EXACT"
    ]
    passed = not exact_boundary_failures
    checks.append({"check": "age_25_29_is_official_native", "pass": passed, "bad_record_ids": exact_boundary_failures[:20]})
    if not passed:
        failures.append(checks[-1])

    return {
        "status": "PASS" if not failures else "FAIL",
        "check_count": len(checks),
        "failure_count": len(failures),
        "failures": failures[:100],
    }


def validate_labor(rows: list[dict]) -> dict:
    checks = []
    failures = []
    grouped = defaultdict(dict)
    for row in rows:
        grouped[(row["roc_year"], row["age_band"])][row["metric_code"]] = number(row)
        year = row["roc_year"]
        metric = row["metric_code"]
        base_alias, required_tables = LABOR_LINEAGE_EXPECTATIONS[metric]
        expected_alias = base_alias
        if year == "114":
            if "|QA:" in expected_alias:
                primary_alias, qa_alias = expected_alias.split("|QA:", 1)
                expected_alias = f"{primary_alias}+AUX:DGBAS-NTPC-H2-T41+T42|QA:{qa_alias}"
            else:
                expected_alias += "+AUX:DGBAS-NTPC-H2-T41+T42"

        lineage_checks = (
            (
                "labor_source_url_matches_roc_year",
                row["source_url"] == LABOR_ANNUAL_URLS[year],
                row["source_url"],
                LABOR_ANNUAL_URLS[year],
            ),
            (
                "labor_source_alias_matches_metric",
                row["source_alias"] == expected_alias,
                row["source_alias"],
                expected_alias,
            ),
            (
                "labor_source_snapshot_contains_required_tables",
                all(f"/{year}/table{number}.xlsx" in row["source_snapshot"] for number in required_tables)
                and "annual_target_age_results.csv" in row["source_snapshot"],
                row["source_snapshot"],
                [f"table{number}.xlsx" for number in required_tables] + ["annual_target_age_results.csv"],
            ),
            (
                "labor_114_h2_auxiliary_lineage_is_scoped",
                ("source_rounding_reconciliation.csv" in row["source_snapshot"]) == (year == "114")
                and ("AUX:DGBAS-NTPC-H2-T41+T42" in row["source_alias"]) == (year == "114"),
                {"year": year, "source_alias": row["source_alias"], "source_snapshot": row["source_snapshot"]},
                "114年須含H2輔助來源；110–113年不得含H2輔助來源",
            ),
        )
        for check_name, passed, actual, expected in lineage_checks:
            check = {
                "check": check_name,
                "record_id": row["record_id"],
                "actual": actual,
                "expected": expected,
                "pass": passed,
            }
            checks.append(check)
            if not passed:
                failures.append(check)

    for key, metrics in sorted(grouped.items()):
        p = metrics["CIVILIAN_POPULATION"]
        lf = metrics["LABOR_FORCE"]
        e = metrics["EMPLOYED"]
        u = metrics["UNEMPLOYED"]
        nlf = metrics["NOT_IN_LABOR_FORCE"]
        identities = {
            "LF=E+U": (lf, e + u, 0.00001),
            "NLF=P-LF": (nlf, p - lf, 0.00001),
            "UR=U/LF": (metrics["UNEMPLOYMENT_RATE"], u / lf * 100, 0.0001),
            "LFPR=LF/P": (metrics["LABOR_FORCE_PARTICIPATION_RATE"], lf / p * 100, 0.0001),
            "EPR=E/P": (metrics["EMPLOYMENT_TO_POPULATION_RATE"], e / p * 100, 0.0001),
            "ESLF=E/LF": (metrics["EMPLOYMENT_SHARE_OF_LABOR_FORCE"], e / lf * 100, 0.0001),
            "UR+ESLF=100": (metrics["UNEMPLOYMENT_RATE"] + metrics["EMPLOYMENT_SHARE_OF_LABOR_FORCE"], 100.0, 0.0001),
        }
        for identity, (actual, expected, tolerance) in identities.items():
            passed = nearly_equal(actual, expected, absolute=tolerance)
            check = {"check": identity, "key": key, "actual": actual, "expected": expected, "tolerance": tolerance, "pass": passed}
            checks.append(check)
            if not passed:
                failures.append(check)

    return {
        "status": "PASS" if not failures else "FAIL",
        "check_count": len(checks),
        "failure_count": len(failures),
        "failures": failures[:100],
    }


def validate_wage(rows: list[dict]) -> dict:
    checks = []
    failures = []
    grouped = defaultdict(dict)
    for row in rows:
        metric = row["metric_code"]
        is_native = row["age_band"] == "25-29"
        is_mean = metric == "ANNUAL_TOTAL_SALARY_MEAN"
        value = number(row) if row["value"] != "" else None
        if value is not None:
            grouped[(row["roc_year"], row["age_band"])][metric] = value

        expected_origin = (
            "OFFICIAL_SURVEY_STATISTIC"
            if is_native
            else "MODEL_ESTIMATE_CALIBRATED_OFFICIAL_WAGE_AUX"
            if is_mean
            else "MODEL_ESTIMATE_CALIBRATED_OFFICIAL_WAGE_DISTRIBUTION"
        )
        expected_method = (
            "M0_OFFICIAL_AGE_BAND"
            if is_native
            else "WAGE_PCLM_RATIO_CALIBRATION"
            if is_mean
            else "WAGE_LOGNORMAL_SHAPE_TRANSFER_PCLM_MIXTURE"
        )
        expected_source = (
            "STAT-WAGE-LOC"
            if is_native
            else "STAT-WAGE-LOC+BLI-AGE-REGION-SEX+BLI-PENSION-AGE-WAGE"
        )
        passed = (
            value is not None
            and value > 0
            and row["value_origin_class"] == expected_origin
            and row["method_code"] == expected_method
            and row["source_alias"] == expected_source
        )
        check = {
            "check": "wage_identity_method_source_and_value_complete",
            "record_id": row["record_id"],
            "value": value,
            "actual_origin": row["value_origin_class"],
            "expected_origin": expected_origin,
            "actual_method": row["method_code"],
            "expected_method": expected_method,
            "actual_source": row["source_alias"],
            "expected_source": expected_source,
            "pass": passed,
        }
        checks.append(check)
        if not passed:
            failures.append(check)

        if not is_native:
            low = number(row, "uncertainty_low")
            high = number(row, "uncertainty_high")
            passed = value is not None and low <= value <= high
            check = {
                "check": "modeled_wage_within_method_envelope",
                "record_id": row["record_id"],
                "low": low,
                "value": value,
                "high": high,
                "pass": passed,
            }
            checks.append(check)
            if not passed:
                failures.append(check)
        else:
            passed = row["uncertainty_low"] == "" and row["uncertainty_high"] == ""
            check = {
                "check": "native_wage_has_no_model_envelope",
                "record_id": row["record_id"],
                "uncertainty_low": row["uncertainty_low"],
                "uncertainty_high": row["uncertainty_high"],
                "pass": passed,
            }
            checks.append(check)
            if not passed:
                failures.append(check)

    years = sorted({int(year) for year, _ in grouped})
    for year in years:
        year_key = str(year)
        means = {
            age_band: grouped.get((year_key, age_band), {}).get("ANNUAL_TOTAL_SALARY_MEAN")
            for age_band in ("18-24", "25-29", "30-35", "18-35")
        }
        passed = all(value is not None and value > 0 for value in means.values())
        check = {"check": "mean_age_coverage_complete", "year": year, "means": means, "pass": passed}
        checks.append(check)
        if not passed:
            failures.append(check)

        medians = {
            age_band: grouped.get((year_key, age_band), {}).get("ANNUAL_TOTAL_SALARY_MEDIAN")
            for age_band in ("18-24", "25-29", "30-35", "18-35")
        }
        passed = all(
            medians[age_band] is not None
            and means[age_band] is not None
            and means[age_band] >= medians[age_band] > 0
            for age_band in medians
        )
        check = {
            "check": "all_age_bands_mean_ge_median_positive",
            "year": year,
            "means": means,
            "medians": medians,
            "pass": passed,
        }
        checks.append(check)
        if not passed:
            failures.append(check)

        means_pass = (
            means["18-24"] < means["25-29"] < means["30-35"]
            and min(means["18-24"], means["25-29"], means["30-35"])
            <= means["18-35"]
            <= max(means["18-24"], means["25-29"], means["30-35"])
        )
        medians_pass = (
            medians["18-24"] < medians["25-29"] < medians["30-35"]
            and min(medians["18-24"], medians["25-29"], medians["30-35"])
            <= medians["18-35"]
            <= max(medians["18-24"], medians["25-29"], medians["30-35"])
        )
        passed = means_pass and medians_pass
        check = {
            "check": "wage_age_gradient_and_combined_bounds",
            "year": year,
            "means": means,
            "medians": medians,
            "pass": passed,
        }
        checks.append(check)
        if not passed:
            failures.append(check)

    expected_combinations = {
        (str(year), age_band, metric)
        for year in (110, 111, 112, 113)
        for age_band in ("18-24", "25-29", "30-35", "18-35")
        for metric in ("ANNUAL_TOTAL_SALARY_MEAN", "ANNUAL_TOTAL_SALARY_MEDIAN")
    }
    actual_combinations = {
        (row["roc_year"], row["age_band"], row["metric_code"])
        for row in rows
    }
    numeric_rows = sum(row["value"] != "" for row in rows)
    passed = len(rows) == 32 and numeric_rows == 32 and actual_combinations == expected_combinations
    check = {
        "check": "wage_rectangular_grid_is_4x4x2",
        "actual_rows": len(rows),
        "expected_rows": 32,
        "numeric_rows": numeric_rows,
        "expected_numeric_rows": 32,
        "missing": sorted(expected_combinations - actual_combinations),
        "extra": sorted(actual_combinations - expected_combinations),
        "pass": passed,
    }
    checks.append(check)
    if not passed:
        failures.append(check)

    passed = years == [110, 111, 112, 113]
    check = {"check": "wage_year_coverage_is_110_113", "actual": years, "expected": [110, 111, 112, 113], "pass": passed}
    checks.append(check)
    if not passed:
        failures.append(check)
    return {
        "status": "PASS" if not failures else "FAIL",
        "check_count": len(checks),
        "failure_count": len(failures),
        "failures": failures[:100],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, default=DEFAULT_PACKAGE)
    args = parser.parse_args()
    package = args.package.resolve()
    publish = package / "09_發布資料包"
    registered = read_rows(publish / "01_戶籍人口母體_長格式.csv")
    labor = read_rows(publish / "02_民間人口與勞動市場母體_長格式.csv")
    wage = read_rows(publish / "03_受僱員工薪資母體_長格式.csv")
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "registered_population": validate_registered(registered),
        "civilian_labor_market": validate_labor(labor),
        "employee_wage": validate_wage(wage),
    }
    report["overall_status"] = (
        "PASS" if all(value["status"] == "PASS" for key, value in report.items() if key != "generated_at_utc") else "FAIL"
    )
    output = package / "08_人工查核與異常處理" / "machine_qa" / "published_metrics_validation_detailed.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["overall_status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())

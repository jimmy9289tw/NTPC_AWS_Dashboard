from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


PROJECT = Path(r"D:\github\work\019fe05e-e1a3-71f2-840e-c026180d9474\NtpcYouthAI")
RAW_ROOT = PROJECT / "data" / "raw" / "MOI-MARITAL5Y"
DEFAULT_OUT = PROJECT / "data" / "processed" / "MOI-MARITAL5Y"
POP114 = (
    PROJECT
    / "deliverables"
    / "NTPC_Youth_18-35_Government_Open_Data_Package_V2.2_20260825"
    / "01_年齡人口結構"
    / "raw"
    / "MOI-POP1Y-11412.json"
)

YEARS = {
    "113": {
        "marital_csv": RAW_ROOT / "expanded" / "opendata113Y031.csv",
        "marital_zip": RAW_ROOT / "opendata113Y031.zip",
        "population_json": RAW_ROOT / "MOI-POP1Y-11312.json",
        "population_period": "11312",
    },
    "114": {
        "marital_csv": RAW_ROOT / "expanded" / "opendata114Y031.csv",
        "marital_zip": RAW_ROOT / "opendata114Y031.zip",
        "population_json": POP114,
        "population_period": "11412",
    },
}

STATUS_ORDER = ["NEVER_MARRIED", "MARRIED_WITH_SPOUSE", "DIVORCED", "WIDOWED"]
STATUS_ZH = {
    "NEVER_MARRIED": "未婚",
    "MARRIED_WITH_SPOUSE": "有偶",
    "DIVORCED": "離婚或終止結婚",
    "WIDOWED": "喪偶",
    "CURRENTLY_WITH_SPOUSE": "目前有配偶",
    "CURRENTLY_WITHOUT_SPOUSE": "目前無配偶",
}
SEX_ORDER = ["男", "女"]
TARGET_BANDS = {
    "18-24": list(range(18, 25)),
    "25-29": list(range(25, 30)),
    "30-35": list(range(30, 36)),
    "18-35": list(range(18, 36)),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collapse_status(value: str) -> str:
    value = value.strip()
    if value.startswith("未婚"):
        return "NEVER_MARRIED"
    if value.startswith("有偶"):
        return "MARRIED_WITH_SPOUSE"
    if value.startswith("離婚") or value.startswith("終止結婚"):
        return "DIVORCED"
    if value.startswith("喪偶"):
        return "WIDOWED"
    return "OTHER_UNKNOWN"


def parse_age_band(label: str) -> tuple[int, int] | None:
    match = re.fullmatch(r"(\d+)~(\d+)歲", label.strip())
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def read_marital_aggregate(path: Path, expected_year: str):
    aggregate: dict[tuple[str, str, str], int] = defaultdict(int)
    raw_statuses: set[str] = set()
    age_labels: set[str] = set()
    rows_read = 0
    rows_ntpc = 0
    invalid_rows = 0
    unknown_status_rows = 0

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            rows_read += 1
            year = (row.get("statistic_yyy") or "").lstrip("\ufeff").strip()
            if year == "統計年":
                continue
            if year != expected_year:
                invalid_rows += 1
                continue
            district_code = (row.get("district_code") or "").strip()
            site_id = (row.get("site_id") or "").strip()
            if not district_code.startswith("65") or not site_id.startswith("新北市"):
                continue
            rows_ntpc += 1
            sex = (row.get("sex") or "").strip()
            age = (row.get("age") or "").strip()
            raw_status = (row.get("marital_status") or "").strip()
            raw_statuses.add(raw_status)
            age_labels.add(age)
            status = collapse_status(raw_status)
            if status == "OTHER_UNKNOWN":
                unknown_status_rows += 1
            try:
                population = int((row.get("population") or "0").strip())
            except ValueError:
                invalid_rows += 1
                continue
            if population < 0 or sex not in SEX_ORDER:
                invalid_rows += 1
                continue
            aggregate[(sex, age, status)] += population

    return aggregate, {
        "rows_read": rows_read,
        "rows_ntpc": rows_ntpc,
        "invalid_rows": invalid_rows,
        "unknown_status_rows": unknown_status_rows,
        "raw_statuses": sorted(raw_statuses),
        "age_labels": sorted(age_labels),
    }


def read_single_age_population(path: Path) -> dict[tuple[str, int], int]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    rows = payload.get("responseData", payload)
    totals: dict[tuple[str, int], int] = defaultdict(int)
    for row in rows:
        site_id = str(row.get("site_id", ""))
        district_code = str(row.get("district_code", ""))
        if not site_id.startswith("新北市") or not district_code.startswith("65"):
            continue
        for age in range(0, 100):
            totals[("男", age)] += int(row.get(f"people_age_{age:03d}_m", 0) or 0)
            totals[("女", age)] += int(row.get(f"people_age_{age:03d}_f", 0) or 0)
    return totals


def bspline_basis(ages: np.ndarray, left: float, right: float, step: int = 5, degree: int = 3) -> np.ndarray:
    internal = list(np.arange(left + step, right, step, dtype=float))
    knots = np.array([left] * (degree + 1) + internal + [right] * (degree + 1), dtype=float)
    n_basis = len(knots) - degree - 1
    x = ages.astype(float) + 0.5
    basis = np.zeros((len(x), n_basis), dtype=float)
    for i in range(n_basis):
        basis[:, i] = ((x >= knots[i]) & (x < knots[i + 1])).astype(float)
    for k in range(1, degree + 1):
        next_basis = np.zeros_like(basis)
        for i in range(n_basis):
            left_denom = knots[i + k] - knots[i]
            right_denom = knots[i + k + 1] - knots[i + 1] if i + 1 < n_basis else 0.0
            if left_denom > 0:
                next_basis[:, i] += (x - knots[i]) / left_denom * basis[:, i]
            if right_denom > 0 and i + 1 < n_basis:
                next_basis[:, i] += (knots[i + k + 1] - x) / right_denom * basis[:, i + 1]
        basis = next_basis
    return basis


def poisson_deviance(y: np.ndarray, mu: np.ndarray) -> float:
    mu = np.maximum(mu, 1e-12)
    terms = mu.copy()
    positive = y > 0
    terms[positive] = y[positive] * np.log(y[positive] / mu[positive]) - (y[positive] - mu[positive])
    return float(2.0 * np.sum(terms))


def fit_pclm(y: np.ndarray, ages: np.ndarray, groups: list[tuple[int, int]], lam: float):
    b = bspline_basis(ages, float(ages.min()), float(ages.max() + 1))
    c = np.zeros((len(groups), len(ages)), dtype=float)
    for gi, (start, end) in enumerate(groups):
        c[gi, (ages >= start) & (ages <= end)] = 1.0
    d2 = np.diff(np.eye(b.shape[1]), n=2, axis=0)
    penalty = d2.T @ d2
    group_b = (c @ b) / np.maximum(c.sum(axis=1, keepdims=True), 1.0)
    target = np.log((y + 0.5) / np.maximum(c.sum(axis=1), 1.0))
    theta = np.linalg.solve(group_b.T @ group_b + 1e-4 * np.eye(b.shape[1]), group_b.T @ target)

    def objective(candidate: np.ndarray) -> float:
        gamma = np.exp(np.clip(b @ candidate, -30, 30))
        mu = np.maximum(c @ gamma, 1e-12)
        loglik = float(np.sum(y * np.log(mu) - mu))
        return loglik - 0.5 * lam * float(candidate @ penalty @ candidate)

    converged = False
    for iteration in range(1, 151):
        gamma = np.exp(np.clip(b @ theta, -30, 30))
        mu = np.maximum(c @ gamma, 1e-12)
        jacobian = c @ (gamma[:, None] * b)
        information = jacobian.T @ (jacobian / mu[:, None])
        score = jacobian.T @ ((y - mu) / mu) - lam * penalty @ theta
        system = information + lam * penalty + 1e-8 * np.eye(b.shape[1])
        delta = np.linalg.solve(system, score)
        old_obj = objective(theta)
        step = 1.0
        while step >= 1e-5 and objective(theta + step * delta) < old_obj:
            step *= 0.5
        theta = theta + step * delta
        if float(np.max(np.abs(step * delta))) < 1e-8:
            converged = True
            break

    gamma = np.exp(np.clip(b @ theta, -30, 30))
    mu = np.maximum(c @ gamma, 1e-12)
    jacobian = c @ (gamma[:, None] * b)
    information = jacobian.T @ (jacobian / mu[:, None])
    system = information + lam * penalty + 1e-8 * np.eye(b.shape[1])
    edf = float(np.trace(np.linalg.solve(system, information)))
    deviance = poisson_deviance(y, mu)
    gcv = deviance / max(len(groups) - edf, 0.25) ** 2
    return gamma, {
        "lambda": lam,
        "deviance": deviance,
        "edf": edf,
        "gcv": gcv,
        "iterations": iteration,
        "converged": converged,
        "max_group_reaggregation_error": float(np.max(np.abs(mu - y))),
    }


def select_pclm(y: np.ndarray, ages: np.ndarray, groups: list[tuple[int, int]]):
    candidates = []
    for lam in (0.1, 1.0, 10.0, 100.0, 1000.0, 10000.0):
        gamma, diagnostic = fit_pclm(y, ages, groups, lam)
        cv_deviance = 0.0
        for holdout in range(1, len(groups) - 1):
            train_groups = [group for index, group in enumerate(groups) if index != holdout]
            train_y = np.array([value for index, value in enumerate(y) if index != holdout], dtype=float)
            cv_gamma, _ = fit_pclm(train_y, ages, train_groups, lam)
            start, end = groups[holdout]
            prediction = float(cv_gamma[(ages >= start) & (ages <= end)].sum())
            cv_deviance += poisson_deviance(
                np.array([y[holdout]], dtype=float),
                np.array([prediction], dtype=float),
            )
        diagnostic["interior_leave_one_group_out_deviance"] = cv_deviance
        candidates.append((cv_deviance, gamma, diagnostic))
    _, gamma, diagnostic = min(candidates, key=lambda item: item[0])
    return gamma, diagnostic


def ipf(seed: np.ndarray, row_targets: np.ndarray, col_targets: np.ndarray):
    matrix = np.maximum(seed.astype(float), 1e-12)
    row_targets = row_targets.astype(float).copy()
    col_targets = col_targets.astype(float).copy()
    row_sum = float(row_targets.sum())
    col_sum = float(col_targets.sum())
    margin_status = "EXACT_COMPATIBLE"
    if not math.isclose(row_sum, col_sum, abs_tol=0.5):
        if row_sum <= 0:
            raise ValueError("Single-age row margin has non-positive total")
        row_targets *= col_sum / row_sum
        margin_status = "ROW_MARGIN_SCALED_TO_OFFICIAL_MARITAL_TOTAL"
    for iteration in range(1, 2001):
        matrix *= np.divide(row_targets, matrix.sum(axis=1), out=np.ones_like(row_targets), where=matrix.sum(axis=1) > 0)[:, None]
        matrix *= np.divide(col_targets, matrix.sum(axis=0), out=np.ones_like(col_targets), where=matrix.sum(axis=0) > 0)[None, :]
        row_error = float(np.max(np.abs(matrix.sum(axis=1) - row_targets)))
        col_error = float(np.max(np.abs(matrix.sum(axis=0) - col_targets)))
        if max(row_error, col_error) < 1e-7:
            break
    return matrix, {
        "iterations": iteration,
        "row_error": row_error,
        "col_error": col_error,
        "margin_status": margin_status,
        "source_row_total": row_sum,
        "source_col_total": col_sum,
    }


def write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def process_year(year: str, config: dict, output_root: Path):
    aggregate, ingest_diag = read_marital_aggregate(config["marital_csv"], year)
    population = read_single_age_population(config["population_json"])
    year_out = output_root / year
    year_out.mkdir(parents=True, exist_ok=True)

    exact_rows = []
    for (sex, age_band, status), value in sorted(aggregate.items()):
        if status == "OTHER_UNKNOWN":
            continue
        exact_rows.append({
            "source_period": year,
            "period_basis": "END_OF_YEAR_12_31",
            "geography": "新北市",
            "geography_role": "REGISTERED_RESIDENCE",
            "sex": sex,
            "source_age_band": age_band,
            "classification_view": "OFFICIAL_4_CATEGORY",
            "marital_status_code": status,
            "marital_status_zh": STATUS_ZH[status],
            "population_count": value,
            "unit": "人",
            "value_origin_class": "OFFICIAL_ADMIN_EXACT",
            "method_code": "M0_DIRECT_AGGREGATION",
            "source_alias": "MOI-MARITAL5Y",
        })
    write_csv(
        year_out / f"MOI-MARITAL-NTPC-{year}-5Y-OFFICIAL.csv",
        list(exact_rows[0].keys()),
        exact_rows,
    )

    model_ages = np.arange(15, 60)
    model_groups = [(age, age + 4) for age in range(15, 60, 5)]
    estimated: dict[tuple[str, int, str], float] = {}
    proportional: dict[tuple[str, int, str], float] = {}
    reconciliation_rows = []
    diagnostic_rows = []

    for sex in SEX_ORDER:
        seeds = np.zeros((len(model_ages), len(STATUS_ORDER)), dtype=float)
        for ci, status in enumerate(STATUS_ORDER):
            y = np.array([
                aggregate.get((sex, f"{start}~{end}歲", status), 0)
                for start, end in model_groups
            ], dtype=float)
            gamma, diagnostic = select_pclm(y, model_ages, model_groups)
            seeds[:, ci] = gamma
            diagnostic_rows.append({
                "source_period": year,
                "sex": sex,
                "marital_status_code": status,
                "selected_lambda": diagnostic["lambda"],
                "gcv": f"{diagnostic['gcv']:.10f}",
                "interior_leave_one_group_out_deviance": f"{diagnostic['interior_leave_one_group_out_deviance']:.10f}",
                "deviance": f"{diagnostic['deviance']:.10f}",
                "effective_degrees_of_freedom": f"{diagnostic['edf']:.6f}",
                "iterations": diagnostic["iterations"],
                "converged": diagnostic["converged"],
                "max_group_reaggregation_error_before_ipf": f"{diagnostic['max_group_reaggregation_error']:.6f}",
            })

        for start, end in model_groups:
            idx = np.where((model_ages >= start) & (model_ages <= end))[0]
            row_targets = np.array([population[(sex, int(age))] for age in model_ages[idx]], dtype=float)
            col_targets = np.array([
                aggregate.get((sex, f"{start}~{end}歲", status), 0)
                for status in STATUS_ORDER
            ], dtype=float)
            fitted, ipf_diag = ipf(seeds[idx, :], row_targets, col_targets)
            baseline_seed = np.outer(np.maximum(row_targets, 1e-12), np.maximum(col_targets, 1e-12))
            baseline, _ = ipf(baseline_seed, row_targets, col_targets)
            for local_ai, global_ai in enumerate(idx):
                age = int(model_ages[global_ai])
                for ci, status in enumerate(STATUS_ORDER):
                    estimated[(sex, age, status)] = float(fitted[local_ai, ci])
                    proportional[(sex, age, status)] = float(baseline[local_ai, ci])
            reconciliation_rows.append({
                "source_period": year,
                "sex": sex,
                "age_band": f"{start}-{end}",
                "marital_official_total": int(col_targets.sum()),
                "single_age_population_total": int(row_targets.sum()),
                "difference": int(col_targets.sum() - row_targets.sum()),
                "margin_status": ipf_diag["margin_status"],
                "ipf_iterations": ipf_diag["iterations"],
                "max_row_error": f"{ipf_diag['row_error']:.10f}",
                "max_col_error": f"{ipf_diag['col_error']:.10f}",
            })

    model_rows = []
    for sex in SEX_ORDER + ["合計"]:
        for target_band, ages in TARGET_BANDS.items():
            for classification_view, status_codes in (
                ("OFFICIAL_4_CATEGORY", STATUS_ORDER),
                ("DERIVED_BINARY", ["CURRENTLY_WITH_SPOUSE", "CURRENTLY_WITHOUT_SPOUSE"]),
            ):
                category_values = {}
                category_baselines = {}
                for status in status_codes:
                    underlying = [status]
                    if status == "CURRENTLY_WITH_SPOUSE":
                        underlying = ["MARRIED_WITH_SPOUSE"]
                    elif status == "CURRENTLY_WITHOUT_SPOUSE":
                        underlying = ["NEVER_MARRIED", "DIVORCED", "WIDOWED"]
                    sexes = SEX_ORDER if sex == "合計" else [sex]
                    value = sum(estimated[(sx, age, raw)] for sx in sexes for age in ages for raw in underlying)
                    baseline = sum(proportional[(sx, age, raw)] for sx in sexes for age in ages for raw in underlying)
                    category_values[status] = value
                    category_baselines[status] = baseline
                denominator = sum(category_values.values())
                for status in status_codes:
                    value = category_values[status]
                    baseline = category_baselines[status]
                    method = "M0_DIRECT_AGGREGATION" if target_band == "25-29" else "PCLM_IPF_BOUNDARY_ESTIMATE"
                    origin = "OFFICIAL_ADMIN_EXACT" if target_band == "25-29" else "MODEL_ESTIMATE_FROM_OFFICIAL_MARGINS"
                    model_rows.append({
                        "source_period": year,
                        "period_basis": "END_OF_YEAR_12_31",
                        "geography": "新北市",
                        "geography_role": "REGISTERED_RESIDENCE",
                        "target_age_band": target_band,
                        "sex": sex,
                        "classification_view": classification_view,
                        "marital_status_code": status,
                        "marital_status_zh": STATUS_ZH[status],
                        "population_count": f"{value:.3f}",
                        "share_pct": f"{value / denominator * 100:.6f}" if denominator else "",
                        "sensitivity_low": f"{min(value, baseline):.3f}",
                        "sensitivity_high": f"{max(value, baseline):.3f}",
                        "uncertainty_type": "METHOD_SENSITIVITY_ENVELOPE_NOT_CI",
                        "unit": "人",
                        "value_origin_class": origin,
                        "method_code": method,
                        "source_alias": "MOI-MARITAL5Y+MOI-POP1Y",
                        "publish_status": "PUBLISH_EXACT" if target_band == "25-29" else "PUBLISH_MODEL_WITH_METHOD_LABEL_AFTER_REVIEW",
                    })
    write_csv(year_out / f"MOI-MARITAL-NTPC-{year}-TARGET-AGE.csv", list(model_rows[0].keys()), model_rows)
    write_csv(year_out / f"MOI-MARITAL-NTPC-{year}-RECONCILIATION.csv", list(reconciliation_rows[0].keys()), reconciliation_rows)
    write_csv(year_out / f"MOI-MARITAL-NTPC-{year}-MODEL-DIAGNOSTICS.csv", list(diagnostic_rows[0].keys()), diagnostic_rows)

    manifest = {
        "source_period": year,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "geography": "新北市",
        "geography_role": "registered residence at year-end; not actual residence and not workplace",
        "source_files": {
            "marital_zip": {"path": str(config["marital_zip"]), "sha256": sha256(config["marital_zip"])},
            "marital_csv": {"path": str(config["marital_csv"]), "sha256": sha256(config["marital_csv"])},
            "single_age_population_json": {"path": str(config["population_json"]), "sha256": sha256(config["population_json"])},
        },
        "population_field_definition": "count of persons in the row's year x registered-residence geography x sex x five-year age x marital-status cell",
        "ingestion": ingest_diag,
        "method": {
            "exact": "Aggregate population over villages; collapse same-/different-sex marriage type into four legal marital statuses.",
            "boundary": "Fit PCLM by sex and marital status, then IPF-calibrate each five-year block to MOI single-age population and official marital totals.",
            "binary": "CURRENTLY_WITH_SPOUSE=有偶; CURRENTLY_WITHOUT_SPOUSE=未婚+離婚+喪偶.",
            "monthly": "NO_TEMPORAL_ESTIMATE: annual year-end stock only.",
        },
    }
    with (year_out / f"MOI-MARITAL-NTPC-{year}-PROCESSING-MANIFEST.json").open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
    return model_rows, manifest


def build_yoy(results: dict[str, list[dict]], output_root: Path) -> None:
    indexes = {}
    for year, rows in results.items():
        indexes[year] = {
            (row["target_age_band"], row["sex"], row["classification_view"], row["marital_status_code"]): row
            for row in rows
        }
    yoy_rows = []
    for key, current in indexes["114"].items():
        prior = indexes["113"].get(key)
        if not prior:
            continue
        current_value = float(current["population_count"])
        prior_value = float(prior["population_count"])
        current_share = float(current["share_pct"] or 0)
        prior_share = float(prior["share_pct"] or 0)
        yoy_rows.append({
            "base_period": "113",
            "comparison_period": "114",
            "period_basis": "END_OF_YEAR_12_31",
            "target_age_band": key[0],
            "sex": key[1],
            "classification_view": key[2],
            "marital_status_code": key[3],
            "marital_status_zh": current["marital_status_zh"],
            "base_population_count": f"{prior_value:.3f}",
            "comparison_population_count": f"{current_value:.3f}",
            "change_count": f"{current_value - prior_value:.3f}",
            "yoy_pct": f"{(current_value / prior_value - 1) * 100:.6f}" if prior_value else "",
            "base_share_pct": f"{prior_share:.6f}",
            "comparison_share_pct": f"{current_share:.6f}",
            "share_change_pp": f"{current_share - prior_share:.6f}",
            "value_origin_class": current["value_origin_class"],
            "method_code": current["method_code"],
        })
    write_csv(output_root / "MOI-MARITAL-NTPC-113-114-YOY.csv", list(yoy_rows[0].keys()), yoy_rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    results = {}
    manifests = {}
    for year, config in YEARS.items():
        rows, manifest = process_year(year, config, args.output_dir)
        results[year] = rows
        manifests[year] = manifest
    build_yoy(results, args.output_dir)
    summary = {
        "output_dir": str(args.output_dir),
        "years": sorted(results),
        "rows": {year: len(rows) for year, rows in results.items()},
        "invalid_rows": {year: manifests[year]["ingestion"]["invalid_rows"] for year in manifests},
        "unknown_status_rows": {year: manifests[year]["ingestion"]["unknown_status_rows"] for year in manifests},
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

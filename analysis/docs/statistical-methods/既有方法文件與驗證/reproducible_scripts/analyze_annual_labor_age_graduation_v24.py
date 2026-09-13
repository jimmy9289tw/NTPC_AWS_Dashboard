from __future__ import annotations

import argparse
import csv
import io
import json
import os
from contextlib import redirect_stdout
from pathlib import Path

import numpy as np
import openpyxl
import pandas as pd

from analyze_labor_age_graduation_v24 import component_frame, graduate_sprague
from process_marital_status_v23 import select_pclm


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = (
    PROJECT_ROOT
    / "deliverables"
    / "NTPC_Labor_18-35_Sprague_PCLM_Pilot_V1.1_20260825"
)
DEFAULT_RAW = DEFAULT_OUTPUT / "raw" / "annual"
DEFAULT_H2_RECONCILIATION = DEFAULT_OUTPUT / "half_year_114H2" / "source_rounding_reconciliation.csv"

GEOGRAPHY = "新北市"
UNIT = "千人"
YEARS = (110, 111, 112, 113, 114)
TARGET_GROUPS = {
    "18-24": (18, 24),
    "25-29": (25, 29),
    "30-35": (30, 35),
    "18-35": (18, 35),
}

# In 110-113, annual Tables 27/28/32/36 publish 15-19 and 20-24.
AGE_COLUMNS_5Y = {
    (15, 19): 14,
    (20, 24): 15,
    (25, 29): 17,
    (30, 34): 18,
    (35, 39): 19,
    (40, 44): 20,
    (45, 49): 22,
    (50, 54): 23,
    (55, 59): 24,
    (60, 64): 25,
    (65, 99): 26,
}

# In 114, the same annual tables publish 15-24 as one ten-year band.
AGE_COLUMNS_114 = {
    (15, 24): 13,
    (25, 29): 15,
    (30, 34): 16,
    (35, 39): 17,
    (40, 44): 18,
    (45, 49): 20,
    (50, 54): 21,
    (55, 59): 22,
    (60, 64): 23,
    (65, 99): 24,
}


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        raise ValueError(f"No rows to write: {path}")
    fields: list[str] = []
    for row in rows:
        for field in row:
            if field not in fields:
                fields.append(field)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def read_row(path: Path, columns: dict[tuple[int, int], int]) -> dict[tuple[int, int], float]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    district = str(sheet.cell(15, 2).value)
    if "New Taipei City" not in district:
        raise ValueError(f"Expected New Taipei City at row 15 in {path}; got {district!r}")
    return {group: float(sheet.cell(15, column).value) for group, column in columns.items()}


def extract_year(raw_root: Path, year: int):
    columns = AGE_COLUMNS_114 if year == 114 else AGE_COLUMNS_5Y
    year_dir = raw_root / str(year)
    published = {
        "P": read_row(year_dir / "table27.xlsx", columns),
        "LF": read_row(year_dir / "table28.xlsx", columns),
        "E": read_row(year_dir / "table32.xlsx", columns),
        "U": read_row(year_dir / "table36.xlsx", columns),
    }
    derived: dict[tuple[int, int], dict[str, float]] = {}
    source_rows = []
    for group in columns:
        p = published["P"][group]
        e = published["E"][group]
        u = published["U"][group]
        lf = e + u
        nlf = p - lf
        if nlf < -1e-9:
            raise ValueError(f"Negative NLF in ROC {year}, group {group}")
        derived[group] = {"P": p, "LF": lf, "E": e, "U": u, "NLF": nlf}
        source_rows.append(
            {
                "roc_year": year,
                "gregorian_year": year + 1911,
                "geography": GEOGRAPHY,
                "age_group": "65+" if group[0] == 65 else f"{group[0]}-{group[1]}",
                "P_table27_reported_thousand": p,
                "LF_table28_reported_thousand": published["LF"][group],
                "E_table32_reported_thousand": e,
                "U_table36_reported_thousand": u,
                "LF_derived_E_plus_U_thousand": lf,
                "NLF_derived_P_minus_E_minus_U_thousand": nlf,
                "LF_rounding_gap_thousand": lf - published["LF"][group],
                "source_class": "OFFICIAL_SURVEY_ESTIMATE_ROUNDED_TO_THOUSAND",
                "reconciliation_rule": "LF=E+U; NLF=P-LF; keep published E/U/P margins",
            }
        )
    return derived, source_rows


def apply_114_h2_auxiliary_split(
    groups_data: dict[tuple[int, int], dict[str, float]],
    h2_reconciliation: Path,
):
    """Split the 114 annual 15-24 band using same-year H2 component shares.

    E, U and NLF are mutually exclusive components. Each is allocated with its
    own H2 15-19 share, after which LF and P are derived. This preserves the
    official annual 15-24 totals and all accounting identities.
    """
    with h2_reconciliation.open(encoding="utf-8-sig", newline="") as handle:
        rows = {row["age_group"]: row for row in csv.DictReader(handle)}
    if not {"15-19", "20-24"}.issubset(rows):
        raise ValueError(f"Missing 15-19/20-24 H2 rows in {h2_reconciliation}")

    annual = groups_data[(15, 24)]
    component_columns = {
        "E": "reconciled_E_thousand",
        "U": "reconciled_U_thousand",
        "NLF": "reconciled_NLF_thousand",
    }
    allocated = {(15, 19): {}, (20, 24): {}}
    diagnostics = []
    for component, column in component_columns.items():
        h2_first = float(rows["15-19"][column])
        h2_second = float(rows["20-24"][column])
        share = h2_first / (h2_first + h2_second)
        first = annual[component] * share
        second = annual[component] - first
        allocated[(15, 19)][component] = first
        allocated[(20, 24)][component] = second
        diagnostics.append(
            {
                "roc_year": 114,
                "component": component,
                "auxiliary_period": "114年下半年平均",
                "auxiliary_15_19_share": share,
                "annual_15_24_total_thousand": annual[component],
                "allocated_15_19_thousand": first,
                "allocated_20_24_thousand": second,
                "annual_total_preservation_error_thousand": first + second - annual[component],
                "method": "SAME_YEAR_H2_COMPONENT_SHARE_ALLOCATION",
                "caveat": "Assumes the H2 within-band age share is representative of the full-year average.",
            }
        )
    for group in ((15, 19), (20, 24)):
        allocated[group]["LF"] = allocated[group]["E"] + allocated[group]["U"]
        allocated[group]["P"] = allocated[group]["LF"] + allocated[group]["NLF"]

    result = {group: values.copy() for group, values in groups_data.items() if group != (15, 24)}
    result.update(allocated)
    return dict(sorted(result.items())), diagnostics


def calibrate_groups(
    ages: np.ndarray,
    seed: np.ndarray,
    targets: dict[tuple[int, int], float],
) -> tuple[np.ndarray, dict]:
    values = np.maximum(seed.astype(float), 0.0)
    negative_before = int(np.sum(seed < 0))
    minimum_before = float(np.min(seed))
    max_error = 0.0
    for (start, end), target in targets.items():
        if start >= 65:
            continue
        mask = (ages >= start) & (ages <= end)
        current = float(values[mask].sum())
        if current <= 0:
            values[mask] = float(target) / int(mask.sum())
        else:
            values[mask] *= float(target) / current
        max_error = max(max_error, abs(float(values[mask].sum()) - float(target)))
    return values, {
        "negative_single_ages_before_calibration": negative_before,
        "minimum_before_calibration": minimum_before,
        "maximum_post_calibration_reaggregation_error_thousand": max_error,
    }


def graduate_pclm(groups_data: dict[tuple[int, int], dict[str, float]]):
    ages = np.arange(15, 65)
    groups = [group for group in groups_data if group[0] < 65]
    components = {}
    diagnostics = {}
    for component in ("E", "U", "NLF"):
        grouped = np.array([groups_data[group][component] for group in groups], dtype=float)
        seed, diagnostic = select_pclm(grouped, ages, groups)
        calibrated, calibration = calibrate_groups(
            ages,
            seed,
            {group: groups_data[group][component] for group in groups},
        )
        components[component] = calibrated
        diagnostics[component] = {**diagnostic, **calibration}
    return ages, components, diagnostics


def to_sprague_dict(groups_data: dict[tuple[int, int], dict[str, float]]):
    expected = {(start, start + 4) for start in range(15, 65, 5)} | {(65, 99)}
    if set(groups_data) != expected:
        raise ValueError("Sprague requires source data in five-year groups plus 65+")
    return {group[0]: values for group, values in groups_data.items()}


def summarize(year: int, frame: pd.DataFrame) -> list[dict]:
    method = str(frame["method"].iloc[0])
    rows = []
    for label, (start, end) in TARGET_GROUPS.items():
        subset = frame[(frame["age"] >= start) & (frame["age"] <= end)]
        e = float(subset["employed_thousand"].sum())
        u = float(subset["unemployed_thousand"].sum())
        nlf = float(subset["not_in_labor_force_thousand"].sum())
        lf = e + u
        p = lf + nlf
        exact = label == "25-29"
        rows.append(
            {
                "roc_year": year,
                "gregorian_year": year + 1911,
                "period": f"{year}年全年平均（{year + 1911}年12個月平均）",
                "geography": GEOGRAPHY,
                "age_group": label,
                "method": method,
                "value_origin_class": (
                    "OFFICIAL_SURVEY_ESTIMATE_AGE_BAND_EXACT"
                    if exact
                    else "MODEL_ESTIMATE_FROM_OFFICIAL_SURVEY_ESTIMATES"
                ),
                "age_boundary_status": (
                    "OFFICIAL_5Y_BAND_NO_BOUNDARY_ESTIMATION"
                    if exact
                    else "ESTIMATED_BOUNDARY_AGES"
                ),
                "civilian_population_thousand": p,
                "labor_force_thousand": lf,
                "employed_thousand": e,
                "unemployed_thousand": u,
                "not_in_labor_force_thousand": nlf,
                "unemployment_rate_pct": 100.0 * u / lf,
                "labor_force_participation_rate_pct": 100.0 * lf / p,
                "employment_to_population_rate_pct": 100.0 * e / p,
                "employment_share_of_labor_force_pct": 100.0 * e / lf,
                "unit_for_counts": UNIT,
                "source_time_grain": "ANNUAL_12_MONTH_AVERAGE",
                "source_preprocessing": (
                    "114 annual 15-24 split to 15-19/20-24 using same-year H2 E/U/NLF shares"
                    if year == 114
                    else "Official annual five-year age bands"
                ),
                "official_or_model_note": (
                    "25-29為官方原生五歲年齡帶；E/U/P為官方調查估計，LF與NLF依恆等式調和。"
                    if exact
                    else "含單一年齡邊界拆分；不得標為官方直接發布值。"
                ),
            }
        )
    return rows


def validation_rows(
    year: int,
    method: str,
    frame: pd.DataFrame,
    groups_data: dict[tuple[int, int], dict[str, float]],
    diagnostics: dict[str, dict],
    targets: list[dict],
    source_rows: list[dict],
) -> list[dict]:
    rows = []

    def add(check_id: str, check: str, observed, threshold: str, status: str):
        rows.append(
            {
                "roc_year": year,
                "method": method,
                "check_id": check_id,
                "check": check,
                "observed": observed,
                "threshold": threshold,
                "status": status,
            }
        )

    min_component = float(
        frame[["employed_thousand", "unemployed_thousand", "not_in_labor_force_thousand"]]
        .min()
        .min()
    )
    lf_identity = float(
        np.max(
            np.abs(
                frame["labor_force_thousand"]
                - frame["employed_thousand"]
                - frame["unemployed_thousand"]
            )
        )
    )
    p_identity = float(
        np.max(
            np.abs(
                frame["civilian_population_thousand"]
                - frame["labor_force_thousand"]
                - frame["not_in_labor_force_thousand"]
            )
        )
    )
    reaggregation_error = 0.0
    for group, values in groups_data.items():
        if group[0] >= 65:
            continue
        subset = frame[(frame["age"] >= group[0]) & (frame["age"] <= group[1])]
        for component, column in (
            ("E", "employed_thousand"),
            ("U", "unemployed_thousand"),
            ("NLF", "not_in_labor_force_thousand"),
        ):
            reaggregation_error = max(
                reaggregation_error,
                abs(float(subset[column].sum()) - values[component]),
            )
    row_25 = next(row for row in targets if row["age_group"] == "25-29")
    official_25 = groups_data[(25, 29)]
    exact_25_error = max(
        abs(float(row_25["employed_thousand"]) - official_25["E"]),
        abs(float(row_25["unemployed_thousand"]) - official_25["U"]),
        abs(float(row_25["not_in_labor_force_thousand"]) - official_25["NLF"]),
    )
    max_lf_gap = max(abs(float(row["LF_rounding_gap_thousand"])) for row in source_rows)

    for check_id, check, observed, limit, passed in (
        ("VAL-NONNEG", "All E/U/NLF single-age values are non-negative", min_component, ">= 0", min_component >= -1e-12),
        ("VAL-LF-ID", "LF = E + U at every single age", lf_identity, "<= 1e-9 thousand", lf_identity <= 1e-9),
        ("VAL-P-ID", "P = LF + NLF at every single age", p_identity, "<= 1e-9 thousand", p_identity <= 1e-9),
        ("VAL-REAGG", "Single ages reaggregate to official grouped E/U and derived NLF margins", reaggregation_error, "<= 1e-8 thousand", reaggregation_error <= 1e-8),
        ("VAL-25-29", "Official 25-29 band is exactly recovered", exact_25_error, "<= 1e-8 thousand", exact_25_error <= 1e-8),
        ("VAL-LF-ROUND", "Published LF differs from rounded E+U by no more than one thousand", max_lf_gap, "<= 1 thousand", max_lf_gap <= 1.0),
    ):
        add(check_id, check, observed, limit, "PASS" if passed else "FAIL")

    for component, diagnostic in diagnostics.items():
        if method == "PCLM":
            converged = bool(diagnostic.get("converged"))
            add(
                f"VAL-PCLM-CONV-{component}",
                f"PCLM converged for {component}",
                converged,
                "True",
                "PASS" if converged else "FAIL",
            )
        negative = int(diagnostic["negative_single_ages_before_calibration"])
        add(
            f"VAL-RAW-NEG-{component}",
            f"Raw {method} negative single-age count for {component}",
            negative,
            "diagnostic; zero preferred",
            "PASS" if negative == 0 else "WARN",
        )
    return rows


def sensitivity_rows(year: int, pclm: list[dict], sprague: list[dict]) -> list[dict]:
    pclm_map = {row["age_group"]: row for row in pclm}
    sprague_map = {row["age_group"]: row for row in sprague}
    rows = []
    for group in TARGET_GROUPS:
        for metric in (
            "employed_thousand",
            "unemployed_thousand",
            "unemployment_rate_pct",
            "labor_force_participation_rate_pct",
            "employment_to_population_rate_pct",
        ):
            p_value = float(pclm_map[group][metric])
            s_value = float(sprague_map[group][metric])
            rows.append(
                {
                    "roc_year": year,
                    "age_group": group,
                    "metric": metric,
                    "PCLM_value": p_value,
                    "Sprague_value": s_value,
                    "Sprague_minus_PCLM": s_value - p_value,
                    "absolute_difference": abs(s_value - p_value),
                    "relative_difference_pct_of_PCLM": abs(s_value - p_value) / abs(p_value) * 100 if p_value else "",
                    "difference_unit": "percentage_point" if metric.endswith("_pct") else UNIT,
                }
            )
    return rows


def coarsening_backtest(year: int, groups_data: dict[tuple[int, int], dict[str, float]]) -> list[dict]:
    if year >= 114 or (15, 19) not in groups_data:
        return []
    coarse = {}
    for component in ("P", "LF", "E", "U", "NLF"):
        coarse.setdefault((15, 24), {})[component] = (
            groups_data[(15, 19)][component] + groups_data[(20, 24)][component]
        )
    for group, values in groups_data.items():
        if group not in ((15, 19), (20, 24)):
            coarse[group] = values.copy()
    ages, components, _ = graduate_pclm(coarse)
    frame = component_frame("PCLM_COARSENED_BACKTEST", ages, components)
    rows = []
    for component, column in (
        ("E", "employed_thousand"),
        ("U", "unemployed_thousand"),
        ("NLF", "not_in_labor_force_thousand"),
    ):
        for group in ((15, 19), (20, 24)):
            predicted = float(
                frame[(frame["age"] >= group[0]) & (frame["age"] <= group[1])][column].sum()
            )
            observed = float(groups_data[group][component])
            rows.append(
                {
                    "roc_year": year,
                    "component": component,
                    "held_detail_group": f"{group[0]}-{group[1]}",
                    "official_observed_thousand": observed,
                    "predicted_after_coarsening_to_15_24_thousand": predicted,
                    "signed_error_thousand": predicted - observed,
                    "absolute_error_thousand": abs(predicted - observed),
                    "absolute_percentage_error_pct": abs(predicted - observed) / observed * 100 if observed else "",
                    "purpose": "Backtest 114 annual 15-24 coarsening using earlier years with published 15-19/20-24",
                }
            )
    return rows


def auxiliary_share_validation(
    source_rows: list[dict],
    auxiliary_rows: list[dict],
) -> list[dict]:
    by_year_group = {
        (int(row["roc_year"]), row["age_group"]): row
        for row in source_rows
        if int(row["roc_year"]) <= 113 and row["age_group"] in ("15-19", "20-24")
    }
    field_map = {
        "E": "E_table32_reported_thousand",
        "U": "U_table36_reported_thousand",
        "NLF": "NLF_derived_P_minus_E_minus_U_thousand",
    }
    results = []
    aux_map = {row["component"]: row for row in auxiliary_rows}
    for component, field in field_map.items():
        historical = []
        for year in range(110, 114):
            first = float(by_year_group[(year, "15-19")][field])
            second = float(by_year_group[(year, "20-24")][field])
            historical.append(first / (first + second))
        aux_share = float(aux_map[component]["auxiliary_15_19_share"])
        low, high = min(historical), max(historical)
        distance = 0.0 if low <= aux_share <= high else min(abs(aux_share - low), abs(aux_share - high))
        results.append(
            {
                "component": component,
                "historical_years": "110-113 annual",
                "historical_15_19_share_min": low,
                "historical_15_19_share_mean": float(np.mean(historical)),
                "historical_15_19_share_max": high,
                "auxiliary_114H2_15_19_share": aux_share,
                "distance_outside_historical_range_percentage_point": distance * 100.0,
                "status": "PASS" if distance <= 1e-12 else "WARN",
                "interpretation": (
                    "Same-year H2 share falls within the 110-113 annual range."
                    if distance <= 1e-12
                    else "Same-year H2 share is outside the 110-113 annual range; metrics using this component remain provisional."
                ),
            }
        )
    return results


def build_notebook(output_dir: Path) -> Path:
    path = output_dir / "annual_labor_age_graduation_audit.ipynb"
    cells = [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "# 新北市 110–114 年就業／失業 18–35 歲年度試算\n",
                "\n",
                "年度值為人力資源調查 12 個月平均；不是 12 月期末值。人數單位為千人。\n",
            ],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "from pathlib import Path\n",
                "import pandas as pd\n",
                "BASE = Path.cwd()\n",
                "results = pd.read_csv(BASE / 'annual_target_age_results.csv', encoding='utf-8-sig')\n",
                "validation = pd.read_csv(BASE / 'annual_validation_checks.csv', encoding='utf-8-sig')\n",
                "sensitivity = pd.read_csv(BASE / 'annual_method_sensitivity.csv', encoding='utf-8-sig')\n",
                "backtest = pd.read_csv(BASE / 'annual_coarsening_backtest.csv', encoding='utf-8-sig')\n",
                "print('rows', len(results), len(validation), len(sensitivity), len(backtest))\n",
            ],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "focus = results[(results['method']=='PCLM') & (results['age_group'].isin(['18-24','25-29','30-35','18-35']))]\n",
                "cols = ['roc_year','age_group','employed_thousand','unemployed_thousand','unemployment_rate_pct','labor_force_participation_rate_pct']\n",
                "print(focus[cols].round(4).to_string(index=False))\n",
            ],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "print(validation.groupby(['method','status']).size().to_string())\n",
                "assert not (validation['status'] == 'FAIL').any()\n",
            ],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "summary = backtest.groupby(['component','held_detail_group'])['absolute_error_thousand'].agg(['mean','max'])\n",
                "print(summary.round(4).to_string())\n",
            ],
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## Interpretation\n",
                "\n",
                "- PCLM is the primary annual method because it accepts the 114 annual table's unequal 15–24 band.\n",
                "- Sprague is also computed for 110–113, where all youth source bands are five years wide.\n",
                "- Method differences and coarsening backtests measure model sensitivity; they are not survey sampling confidence intervals.\n",
            ],
        },
    ]
    namespace = {"__name__": "__notebook__"}
    previous = Path.cwd()
    count = 0
    try:
        os.chdir(output_dir)
        for cell in cells:
            if cell["cell_type"] != "code":
                continue
            count += 1
            stream = io.StringIO()
            with redirect_stdout(stream):
                exec("".join(cell["source"]), namespace)
            cell["execution_count"] = count
            cell["outputs"] = [
                {"name": "stdout", "output_type": "stream", "text": stream.getvalue().splitlines(keepends=True)}
            ]
    finally:
        os.chdir(previous)
    notebook = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.12"},
            "execution": {"status": "executed", "engine": "top-to-bottom Python exec"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    path.write_text(json.dumps(notebook, ensure_ascii=False, indent=2), encoding="utf-8")
    reloaded = json.loads(path.read_text(encoding="utf-8"))
    assert all(cell["execution_count"] is not None for cell in reloaded["cells"] if cell["cell_type"] == "code")
    return path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-root", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--h2-reconciliation", type=Path, default=DEFAULT_H2_RECONCILIATION)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT / "annual_110_114")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    source_all = []
    target_all = []
    validation_all = []
    sensitivity_all = []
    backtest_all = []
    diagnostics_all = []
    single_age_all = []
    auxiliary_split_all = []

    for year in YEARS:
        groups_data, source_rows = extract_year(args.raw_root, year)
        source_all.extend(source_rows)
        if year == 114:
            groups_data, auxiliary_rows = apply_114_h2_auxiliary_split(
                groups_data, args.h2_reconciliation
            )
            auxiliary_split_all.extend(auxiliary_rows)

        pclm_ages, pclm_components, pclm_diagnostics = graduate_pclm(groups_data)
        frames = {"PCLM": component_frame("PCLM", pclm_ages, pclm_components)}
        diagnostics = {"PCLM": pclm_diagnostics}
        if all((start, start + 4) in groups_data for start in range(15, 65, 5)):
            sprague_ages, sprague_components, sprague_diagnostics = graduate_sprague(
                to_sprague_dict(groups_data)
            )
            frames["SPRAGUE_NN_CALIBRATED"] = component_frame(
                "SPRAGUE_NN_CALIBRATED", sprague_ages, sprague_components
            )
            diagnostics["SPRAGUE_NN_CALIBRATED"] = sprague_diagnostics

        year_targets = {}
        for method, frame in frames.items():
            frame.insert(0, "roc_year", year)
            frame.insert(1, "gregorian_year", year + 1911)
            frame.insert(2, "period", f"{year}年全年平均（{year + 1911}年12個月平均）")
            frame.insert(3, "geography", GEOGRAPHY)
            single_age_all.append(frame)
            year_targets[method] = summarize(year, frame)
            target_all.extend(year_targets[method])
            validation_all.extend(
                validation_rows(
                    year,
                    method,
                    frame,
                    groups_data,
                    diagnostics[method],
                    year_targets[method],
                    source_rows,
                )
            )
            for component, values in diagnostics[method].items():
                diagnostics_all.append(
                    {"roc_year": year, "method": method, "component": component, **values}
                )
        if "SPRAGUE_NN_CALIBRATED" in year_targets:
            sensitivity_all.extend(
                sensitivity_rows(
                    year,
                    year_targets["PCLM"],
                    year_targets["SPRAGUE_NN_CALIBRATED"],
                )
            )
        backtest_all.extend(coarsening_backtest(year, groups_data))

    pd.concat(single_age_all, ignore_index=True).to_csv(
        args.output_dir / "annual_single_age_estimates.csv", index=False, encoding="utf-8-sig"
    )
    write_csv(args.output_dir / "annual_target_age_results.csv", target_all)
    write_csv(args.output_dir / "annual_source_reconciliation.csv", source_all)
    write_csv(args.output_dir / "annual_validation_checks.csv", validation_all)
    write_csv(args.output_dir / "annual_method_sensitivity.csv", sensitivity_all)
    write_csv(args.output_dir / "annual_coarsening_backtest.csv", backtest_all)
    write_csv(args.output_dir / "annual_model_diagnostics.csv", diagnostics_all)
    write_csv(args.output_dir / "annual_114_h2_auxiliary_split.csv", auxiliary_split_all)
    share_validation_rows = auxiliary_share_validation(source_all, auxiliary_split_all)
    write_csv(
        args.output_dir / "annual_114_h2_auxiliary_share_validation.csv",
        share_validation_rows,
    )

    metadata = {
        "scope": "New Taipei City annual labor survey 18-35 age graduation",
        "roc_years": list(YEARS),
        "time_definition": "Each annual value is the 12-month annual average, not the December endpoint.",
        "primary_method": "PCLM",
        "sensitivity_method": "Sprague fifth-difference with nonnegative clipping and exact group recalibration",
        "sprague_years": list(YEARS),
        "pclm_years": list(YEARS),
        "114_preprocessing": "The annual 15-24 E/U/NLF totals are split to 15-19 and 20-24 using the same-year H2 component shares; LF and P are derived so annual totals and identities remain exact.",
        "source_pages": {
            "110": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=207903",
            "111": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=231112",
            "112": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=234726",
            "113": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=234885",
            "114": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
        },
        "source_tables": {
            "27": "civilian population age 15 and above by education and age",
            "28": "labor force by education and age",
            "32": "employed persons by education and age",
            "36": "unemployed persons by education and age",
            "37": "official unemployment rates by age (reference validation table)",
        },
        "method_references": {
            "DemoTools": "https://timriffe.github.io/DemoTools/articles/graduation_with_demotools.html",
            "PCLM": "Rizzi, Gampe and Eilers (2015), Efficient estimation of smooth distributions from coarsely grouped data",
        },
    }
    (args.output_dir / "annual_source_and_run_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    notebook = build_notebook(args.output_dir)
    failures = sum(row["status"] == "FAIL" for row in validation_all)
    warnings = sum(row["status"] == "WARN" for row in validation_all)
    print(
        json.dumps(
            {
                "output_dir": str(args.output_dir),
                "target_rows": len(target_all),
                "validation_failures": failures,
                "validation_warnings": warnings,
                "notebook": str(notebook),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

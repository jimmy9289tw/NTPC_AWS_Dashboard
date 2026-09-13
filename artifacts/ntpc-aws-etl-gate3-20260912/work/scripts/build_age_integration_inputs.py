"""Build auditable age-integration inputs from the current official snapshots.

The script does not impute unavailable 18--35 values. It preserves source-native
age bands and emits explicit BLOCKED/PENDING records when a statistic cannot be
re-aggregated without numerators, denominators, or single-age microdata.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


SOURCE_URLS = {
    "MOI-POP1Y": "https://data.gov.tw/dataset/77132",
    "NTPC-POP": "https://data.ntpc.gov.tw/datasets/8308ab58-62d1-424e-8314-24b65b7ab492",
    "NTPC-UNEMP": "https://data.ntpc.gov.tw/datasets/c29c80d4-bef1-452c-8d9a-659e72f07831",
    "NTPC-EMPSTR": "https://data.ntpc.gov.tw/datasets/c285509a-7fb2-434f-8542-0b4986c337a8",
    "NTPC-EDU15P": "https://data.ntpc.gov.tw/datasets/ffef3ed1-867e-4013-ade0-47cfdba44b2d",
    "STAT-WAGE-EDU": "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642",
    "STAT-WAGE-LOC": "https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642",
    "DGBAS-HR-T27": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
    "DGBAS-HR-T32": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
    "DGBAS-HR-T37": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
    "DGBAS-HR-T50": "https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078",
    "MOI-EDU5Y": "https://data.gov.tw/dataset/117988",
    "MOI-EDU-REG-AGE": "https://data.gov.tw/dataset/14221",
    "DGBAS-EMP-EDU-AGE": "https://data.gov.tw/dataset/34112",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def find_new_taipei_row(path: Path) -> tuple[Any, ...]:
    workbook = load_workbook(path, data_only=True, read_only=True)
    sheet = workbook.active
    for row in sheet.iter_rows(values_only=True):
        if any("New Taipei City" in str(value) for value in row if value is not None):
            return row
    raise ValueError(f"New Taipei City row not found in {path}")


def value(row: tuple[Any, ...], excel_column: int) -> float:
    raw = row[excel_column - 1]
    if raw in (None, "", "-", "－"):
        raise ValueError(f"missing value at Excel column {excel_column}")
    return float(raw)


def row_template(**overrides: Any) -> dict[str, Any]:
    row = {
        "record_id": "",
        "phase": "",
        "topic": "",
        "source_alias": "",
        "source_name": "",
        "source_period": "",
        "source_geography": "",
        "geography_role": "",
        "population_scope": "",
        "measure_code": "",
        "measure_name": "",
        "source_age_band": "",
        "target_age_band": "",
        "sex": "all",
        "education_level": "all",
        "source_value": None,
        "source_unit": "",
        "adjustment_method_code": "",
        "adjusted_value": None,
        "adjusted_unit": "",
        "value_status": "",
        "evidence_class": "",
        "value_origin_class": "",
        "value_origin_label_zh": "",
        "official_published_value": "",
        "is_statistical_estimate": "",
        "calculation_or_estimation_method": "",
        "uncertainty_precision_note": "",
        "method_verification_status": "",
        "interval_overlap_percent": None,
        "can_answer_18_35": "NO",
        "publish_status": "",
        "source_url": "",
        "local_snapshot": "",
        "sha256": "",
        "definition_conflict": "",
        "human_review_id": "",
        "human_review_required": "NO",
        "notes": "",
    }
    row.update(overrides)
    return row


SURVEY_SOURCES = {
    "NTPC-UNEMP",
    "NTPC-EMPSTR",
    "DGBAS-HR-T27",
    "DGBAS-HR-T32",
    "DGBAS-HR-T37",
    "DGBAS-HR-T50",
}


def annotate_value_origin(row: dict[str, Any]) -> None:
    """Classify publisher authority separately from statistical generation.

    An official publisher does not make a survey estimate an exact enumeration.
    Likewise, an exact deterministic sum performed by this project is not an
    official-published number even though all of its inputs are official.
    """
    alias = str(row.get("source_alias") or "")
    method = str(row.get("adjustment_method_code") or "")
    value_status = str(row.get("value_status") or "")
    source_value = row.get("source_value")
    notes = str(row.get("notes") or "")

    if source_value is None:
        row.update({
            "value_origin_class": "NO_NUMERIC_VALUE",
            "value_origin_label_zh": "尚無數值／尚未估計",
            "official_published_value": "NO",
            "is_statistical_estimate": "NOT_APPLICABLE",
            "calculation_or_estimation_method": (
                f"目前未產生數值；預定方法={method}。{notes}".strip()
            ),
            "uncertainty_precision_note": "取得必要資料與人工核准前，adjusted_value維持空白。",
            "method_verification_status": "PENDING_DATA",
        })
        return

    if alias == "MOI-POP1Y":
        if method == "M1_EXACT_SUM_SINGLE_AGE":
            calculation = "本案逐一加總官方單一年齡行政紀錄；N=ΣN(a)，a依target_age_band決定。"
        else:
            calculation = "本案以同一期官方行政紀錄重算；比率=目標年齡人口數÷新北市總人口數×100。"
        row.update({
            "value_origin_class": "PROJECT_DERIVED_ADMIN_EXACT",
            "value_origin_label_zh": "本案由官方行政紀錄確定性計算",
            "official_published_value": "NO",
            "is_statistical_estimate": "NO",
            "calculation_or_estimation_method": calculation,
            "uncertainty_precision_note": "無抽樣誤差；仍受戶籍定義、統計截止時點、登記延遲及來源修訂影響。",
            "method_verification_status": "VERIFIED_OFFICIAL_INPUT_AND_FORMULA",
        })
        return

    if alias in {"STAT-WAGE-EDU", "STAT-WAGE-LOC"}:
        row.update({
            "value_origin_class": "OFFICIAL_ADMIN_DERIVED_STATISTIC",
            "value_origin_label_zh": "官方行政大數據統計值",
            "official_published_value": "YES",
            "is_statistical_estimate": "NO",
            "calculation_or_estimation_method": (
                "行政院主計總處運用綜合所得稅檔連結保險檔等行政大數據編製；"
                "本案直接引用來源年齡帶的官方平均數或中位數，未另作年齡拆分。"
            ),
            "uncertainty_precision_note": "非抽樣調查估計；仍受納入母體、資料連結、排除規則及官方發布位數影響。",
            "method_verification_status": "VERIFIED_OFFICIAL_METHOD",
        })
        return

    if alias == "DGBAS-HR-T27+T32" or (
        alias == "DGBAS-HR-T50" and value_status == "DERIVED_FROM_OFFICIAL_ROUNDED_COUNTS"
    ):
        row.update({
            "value_origin_class": "PROJECT_DERIVED_SURVEY_ESTIMATE",
            "value_origin_label_zh": "本案由官方調查估計值再計算",
            "official_published_value": "NO",
            "is_statistical_estimate": "INHERITED_YES",
            "calculation_or_estimation_method": f"由同一官方調查表的分子與分母重算；{notes}",
            "uncertainty_precision_note": "承接抽樣與非抽樣誤差，並受官方千人單位或小數位四捨五入影響；結果為近似比率。",
            "method_verification_status": "VERIFIED_FORMULA_INHERITS_SURVEY_ERROR",
        })
        return

    if alias in SURVEY_SOURCES:
        verification = "VERIFIED_OFFICIAL_METHOD" if alias.startswith("DGBAS-HR-") else "LINKED_METHOD_NEEDS_SOURCE_CONFIRMATION"
        row.update({
            "value_origin_class": "OFFICIAL_SURVEY_ESTIMATE",
            "value_origin_label_zh": "官方抽樣調查估計值",
            "official_published_value": "YES",
            "is_statistical_estimate": "YES",
            "calculation_or_estimation_method": (
                "官方人力資源／勞動力統計採分層二階段隨機抽樣；以比率估計法推計，"
                "並按縣市、性別及年齡組戶籍人口校正。本案保留官方發布值，不再視為完整計數。"
            ),
            "uncertainty_precision_note": "具有抽樣及非抽樣誤差；目前來源檔未附本列標準誤或95%信賴區間，且部分人數以千人四捨五入。",
            "method_verification_status": verification,
        })
        return

    if alias == "NTPC-POP" and row.get("measure_code") == "snapshot_row_coverage":
        row.update({
            "value_origin_class": "SYSTEM_QC_OBSERVATION",
            "value_origin_label_zh": "本案介接品質檢查值",
            "official_published_value": "NO",
            "is_statistical_estimate": "NO",
            "calculation_or_estimation_method": "本案計算實際下載資料列數，並與官方資料目錄列數及最大年度交叉檢查。",
            "uncertainty_precision_note": "此列為介接完整性證據，不是青年人口統計指標。",
            "method_verification_status": "VERIFIED_SYSTEM_CHECK",
        })
        return

    row.update({
        "value_origin_class": "OFFICIAL_PUBLISHED_METHOD_UNCONFIRMED",
        "value_origin_label_zh": "官方發布值；生成基礎待確認",
        "official_published_value": "YES",
        "is_statistical_estimate": "UNKNOWN",
        "calculation_or_estimation_method": "本案直接引用官方發布值，但尚未取得足以判定行政紀錄或抽樣調查的完整編製方法。",
        "uncertainty_precision_note": "正式發布前須由來源機關編製說明確認統計生成方式與誤差性質。",
        "method_verification_status": "NEEDS_SOURCE_METHOD_CONFIRMATION",
    })


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()

    curated_path = root / "data" / "curated" / "policy-indicators-latest.json"
    manifest_path = root / "data" / "manifests" / "latest.json"
    curated = load_json(curated_path)
    manifest = load_json(manifest_path)
    manifest_by_source = {item["sourceId"]: item for item in manifest["artifacts"]}

    def manifest_meta(alias: str) -> tuple[str, str, str]:
        item = manifest_by_source.get(alias, {})
        return (
            str(item.get("path") or ""),
            str(item.get("sha256") or ""),
            str(item.get("retrievedAt") or ""),
        )

    rows: list[dict[str, Any]] = []
    counter = 1

    def add(**kwargs: Any) -> None:
        nonlocal counter
        kwargs.setdefault("record_id", f"AGEINT-{counter:03d}")
        alias = kwargs.get("source_alias", "")
        kwargs.setdefault("source_url", SOURCE_URLS.get(alias, ""))
        row = row_template(**kwargs)
        annotate_value_origin(row)
        rows.append(row)
        counter += 1

    # ------------------------------------------------------------------
    # Exact population aggregation from single ages (current local proof).
    # ------------------------------------------------------------------
    pop = curated["population"]
    pop_snapshot, pop_hash, _ = manifest_meta("MOI-POP1Y")
    group_by_code = {item["code"]: item for item in pop["groups"]}
    population_groups = [
        ("AGE-CORE-18-24", "18-24", "18–24"),
        ("AGE-CORE-25-29", "25-29", "25–29"),
        ("AGE-CORE-30-35", "30-35", "30–35"),
    ]
    for code, ascii_band, label_band in population_groups:
        group = group_by_code[code]
        for sex, key in (("male", "male"), ("female", "female"), ("all", "total")):
            phase = "P1_25_29_VALIDATION" if ascii_band == "25-29" else "P2_18_35_EXPANSION"
            add(
                phase=phase,
                topic="人口",
                source_alias="MOI-POP1Y",
                source_name="村里戶數、單一年齡人口",
                source_period=pop["period"],
                source_geography="新北市",
                geography_role="residence",
                population_scope="戶籍人口",
                measure_code="resident_population_count",
                measure_name=f"{label_band}歲戶籍人口數",
                source_age_band=f"single_age_{ascii_band}",
                target_age_band=label_band,
                sex=sex,
                source_value=group[key],
                source_unit="人",
                adjustment_method_code="M1_EXACT_SUM_SINGLE_AGE",
                adjusted_value=group[key],
                adjusted_unit="人",
                value_status="OFFICIAL_DERIVED_EXACT",
                evidence_class="E1_EXACT_REAGGREGATION",
                interval_overlap_percent=100,
                can_answer_18_35="YES" if ascii_band in {"18-24", "30-35"} else "PARTIAL",
                publish_status="PUBLISH_EXACT",
                local_snapshot=pop_snapshot,
                sha256=pop_hash,
                notes="逐一加總來源單一年齡欄位；未使用比例拆分。",
            )

    male_18_35 = sum(group_by_code[code]["male"] for code, _, _ in population_groups)
    female_18_35 = sum(group_by_code[code]["female"] for code, _, _ in population_groups)
    for sex, amount in (("male", male_18_35), ("female", female_18_35), ("all", pop["coreYouth18To35"])):
        add(
            phase="P2_18_35_EXPANSION",
            topic="人口",
            source_alias="MOI-POP1Y",
            source_name="村里戶數、單一年齡人口",
            source_period=pop["period"],
            source_geography="新北市",
            geography_role="residence",
            population_scope="戶籍人口",
            measure_code="resident_population_count",
            measure_name="18–35歲核心青年戶籍人口數",
            source_age_band="single_age_18-35",
            target_age_band="18–35",
            sex=sex,
            source_value=amount,
            source_unit="人",
            adjustment_method_code="M1_EXACT_SUM_SINGLE_AGE",
            adjusted_value=amount,
            adjusted_unit="人",
            value_status="OFFICIAL_DERIVED_EXACT",
            evidence_class="E1_EXACT_REAGGREGATION",
            interval_overlap_percent=100,
            can_answer_18_35="YES",
            publish_status="PUBLISH_EXACT",
            local_snapshot=pop_snapshot,
            sha256=pop_hash,
            notes="18至35歲共18個單一年齡完整加總。",
        )
    add(
        phase="P2_18_35_EXPANSION",
        topic="人口",
        source_alias="MOI-POP1Y",
        source_name="村里戶數、單一年齡人口",
        source_period=pop["period"],
        source_geography="新北市",
        geography_role="residence",
        population_scope="戶籍人口",
        measure_code="resident_population_share_pct",
        measure_name="18–35歲人口占新北市總人口比率",
        source_age_band="single_age_18-35",
        target_age_band="18–35",
        source_value=pop["coreSharePercent"],
        source_unit="%",
        adjustment_method_code="M2_EXACT_NUMERATOR_DENOMINATOR",
        adjusted_value=pop["coreSharePercent"],
        adjusted_unit="%",
        value_status="OFFICIAL_DERIVED_EXACT",
        evidence_class="E2_EXACT_FROM_COMPONENTS",
        interval_overlap_percent=100,
        can_answer_18_35="YES",
        publish_status="PUBLISH_EXACT",
        local_snapshot=pop_snapshot,
        sha256=pop_hash,
        notes=f"分子={pop['coreYouth18To35']}；分母={pop['totalPopulation']}。",
    )

    # ----------------------------------------------------------
    # New Taipei annual unemployment and employment-share series.
    # ----------------------------------------------------------
    unemp_path = root / manifest_by_source["NTPC-UNEMP"]["path"]
    emp_path = root / manifest_by_source["NTPC-EMPSTR"]["path"]
    unemp_latest = max(load_json(unemp_path), key=lambda row: int(row["field1"]))
    emp_latest = max(load_json(emp_path), key=lambda row: int(row["field1"]))
    unemp_snapshot, unemp_hash, _ = manifest_meta("NTPC-UNEMP")
    emp_snapshot, emp_hash, _ = manifest_meta("NTPC-EMPSTR")

    ntpc_band_fields = {
        "15–24": ("2", "3", "18–24", 70.0),
        "25–29": ("4", "5", "25–29", 100.0),
        "30–34": ("6", "7", "30–35", 83.3333),
        "35–39": ("8", "9", "30–35", 16.6667),
    }
    for band, (male_suffix, female_suffix, target_band, overlap) in ntpc_band_fields.items():
        for sex, suffix in (("male", male_suffix), ("female", female_suffix)):
            exact = band == "25–29"
            add(
                phase="P1_25_29_VALIDATION" if exact else "P2_18_35_EXPANSION",
                topic="就業",
                source_alias="NTPC-UNEMP",
                source_name="失業率－年齡別",
                source_period=unemp_latest["field1"],
                source_geography="新北市",
                geography_role="residence",
                population_scope="勞動力統計母體",
                measure_code="unemployment_rate_pct",
                measure_name=f"{band}歲失業率",
                source_age_band=band,
                target_age_band=target_band,
                sex=sex,
                source_value=float(unemp_latest[f"item value{suffix}"]),
                source_unit="%",
                adjustment_method_code="M0_DIRECT_EXACT" if exact else "M4_BLOCK_RATE_WITHOUT_COMPONENTS",
                adjusted_value=float(unemp_latest[f"item value{suffix}"]) if exact else None,
                adjusted_unit="%",
                value_status="OFFICIAL_DIRECT" if exact else "BLOCKED_MISSING_NUMERATOR_DENOMINATOR",
                evidence_class="E0_OFFICIAL_DIRECT" if exact else "E5_BLOCKED",
                interval_overlap_percent=overlap,
                can_answer_18_35="PARTIAL" if exact else "NO",
                publish_status="PUBLISH_SOURCE_NATIVE_ONLY" if exact else "BLOCKED_PENDING",
                source_url=SOURCE_URLS["NTPC-UNEMP"],
                local_snapshot=unemp_snapshot,
                sha256=unemp_hash,
                definition_conflict="18–24跨入15–17；30–35需切出35歲；率不可按年數比例拆分。" if not exact else "",
                human_review_id="HR-AGE-04" if not exact else "",
                human_review_required="YES" if not exact else "NO",
                notes="合併率需失業人數與勞動力分母；不可直接平均男女或年齡組失業率。",
            )
            add(
                phase="P1_25_29_VALIDATION" if exact else "P2_18_35_EXPANSION",
                topic="就業",
                source_alias="NTPC-EMPSTR",
                source_name="就業者年齡結構",
                source_period=emp_latest["field1"],
                source_geography="新北市",
                geography_role="residence",
                population_scope="就業者（各性別內年齡結構）",
                measure_code="employment_share_pct",
                measure_name=f"{band}歲就業者年齡結構占比",
                source_age_band=band,
                target_age_band=target_band,
                sex=sex,
                source_value=float(emp_latest[f"percent{suffix}"]),
                source_unit="%",
                adjustment_method_code="M0_DIRECT_EXACT" if exact else "M4_BLOCK_SHARE_WITHOUT_COUNTS",
                adjusted_value=float(emp_latest[f"percent{suffix}"]) if exact else None,
                adjusted_unit="%",
                value_status="OFFICIAL_DIRECT" if exact else "BLOCKED_MISSING_EMPLOYED_COUNTS_BY_SINGLE_AGE",
                evidence_class="E0_OFFICIAL_DIRECT" if exact else "E5_BLOCKED",
                interval_overlap_percent=overlap,
                can_answer_18_35="PARTIAL" if exact else "NO",
                publish_status="PUBLISH_SOURCE_NATIVE_ONLY" if exact else "BLOCKED_PENDING",
                source_url=SOURCE_URLS["NTPC-EMPSTR"],
                local_snapshot=emp_snapshot,
                sha256=emp_hash,
                definition_conflict="18–24跨入15–17；30–35需切出35歲；占比需就業者人數權重。" if not exact else "",
                human_review_id="HR-AGE-04" if not exact else "",
                human_review_required="YES" if not exact else "NO",
                notes="男性與女性百分比分母不同，不得相互平均。",
            )

    # ----------------------------------------------------------
    # Salary: exact 25--29 values from the current curated tables.
    # ----------------------------------------------------------
    wage_edu = curated["salaryByEducation"]
    wage_edu_snapshot, wage_edu_hash, _ = manifest_meta("STAT-WAGE-EDU")
    for stat_key, stat_name in (("mean", "平均數"), ("median", "中位數")):
        for level, amount in wage_edu["latest"][stat_key].items():
            add(
                phase="P1_25_29_VALIDATION",
                topic="薪資",
                source_alias="STAT-WAGE-EDU",
                source_name="表5：年齡×教育程度全年總薪資",
                source_period=wage_edu["latest"]["year"],
                source_geography="全國",
                geography_role="national",
                population_scope="工業及服務業受僱員工",
                measure_code=f"annual_salary_{stat_key}_10k_twd",
                measure_name=f"25–29歲全年總薪資{stat_name}",
                source_age_band="25–29",
                target_age_band="25–29",
                education_level=level,
                source_value=amount,
                source_unit="萬元/年",
                adjustment_method_code="M0_DIRECT_EXACT",
                adjusted_value=amount,
                adjusted_unit="萬元/年",
                value_status="OFFICIAL_DIRECT",
                evidence_class="E0_OFFICIAL_DIRECT",
                interval_overlap_percent=100,
                can_answer_18_35="PARTIAL",
                publish_status="PUBLISH_SOURCE_NATIVE_ONLY",
                source_url=SOURCE_URLS["STAT-WAGE-EDU"],
                local_snapshot=wage_edu_snapshot,
                sha256=wage_edu_hash,
                definition_conflict="全國、受僱員工口徑，不代表新北市居住青年。",
                notes="教育層級差異為描述性關聯，不作因果推論。",
            )

    wage_loc = curated["salaryByWorkplace"]
    wage_loc_snapshot, wage_loc_hash, _ = manifest_meta("STAT-WAGE-LOC")
    for stat_key, stat_name in (("mean", "平均數"), ("median", "中位數")):
        amount = wage_loc["latest"][stat_key]
        add(
            phase="P1_25_29_VALIDATION",
            topic="薪資",
            source_alias="STAT-WAGE-LOC",
            source_name="表6：工作場所縣市×年齡全年總薪資",
            source_period=wage_loc["latest"]["year"],
            source_geography="新北市",
            geography_role="workplace",
            population_scope="本國籍全時受僱員工",
            measure_code=f"annual_salary_{stat_key}_10k_twd",
            measure_name=f"新北市工作場所25–29歲全年總薪資{stat_name}",
            source_age_band="25–29",
            target_age_band="25–29",
            source_value=amount,
            source_unit="萬元/年",
            adjustment_method_code="M0_DIRECT_EXACT",
            adjusted_value=amount,
            adjusted_unit="萬元/年",
            value_status="OFFICIAL_DIRECT",
            evidence_class="E0_OFFICIAL_DIRECT",
            interval_overlap_percent=100,
            can_answer_18_35="PARTIAL",
            publish_status="PUBLISH_SOURCE_NATIVE_ONLY",
            source_url=SOURCE_URLS["STAT-WAGE-LOC"],
            local_snapshot=wage_loc_snapshot,
            sha256=wage_loc_hash,
            definition_conflict="工作場所不等於居住地。",
            human_review_id="HR-AGE-05",
            human_review_required="YES",
            notes="僅能描述工作場所位於新北市的受僱員工。",
        )

    # Source-native 30--39 salary values show why 30--35 cannot be exact.
    latest_wage_sheet = load_workbook(root / wage_edu_snapshot, data_only=True, read_only=True).worksheets[0]
    wage_30_39 = None
    for raw in latest_wage_sheet.iter_rows(min_row=1, max_col=11, values_only=True):
        label = str(raw[0]).replace(" ", "") if raw[0] is not None else ""
        if label.startswith("30-39"):
            wage_30_39 = raw
            break
    if wage_30_39 is None:
        raise ValueError("30-39 salary row not found")
    for stat_key, index, stat_name in (("mean", 1, "平均數"), ("median", 6, "中位數")):
        add(
            phase="P2_18_35_EXPANSION",
            topic="薪資",
            source_alias="STAT-WAGE-EDU",
            source_name="表5：年齡×教育程度全年總薪資",
            source_period=2024,
            source_geography="全國",
            geography_role="national",
            population_scope="工業及服務業受僱員工",
            measure_code=f"annual_salary_{stat_key}_10k_twd",
            measure_name=f"30–39歲全年總薪資{stat_name}（來源原生）",
            source_age_band="30–39",
            target_age_band="30–35",
            source_value=float(wage_30_39[index]),
            source_unit="萬元/年",
            adjustment_method_code="M4_BLOCK_SALARY_BOUNDARY",
            adjusted_value=None,
            adjusted_unit="萬元/年",
            value_status="BLOCKED_REQUIRES_MICRODATA_OR_CALIBRATION",
            evidence_class="E5_BLOCKED",
            interval_overlap_percent=60,
            can_answer_18_35="NO",
            publish_status="BLOCKED_PENDING",
            source_url=SOURCE_URLS["STAT-WAGE-EDU"],
            local_snapshot=wage_edu_snapshot,
            sha256=wage_edu_hash,
            definition_conflict="30–39跨越35歲上界；中位數不可加權拆分。",
            human_review_id="HR-AGE-04",
            human_review_required="YES",
            notes="平均數可在取得受僱人數與輔助收入比後做校準估計；中位數必須由微資料重算。",
        )

    # ----------------------------------------------------------
    # 2025 DGBAS HR tables: auxiliary validation and denominators.
    # ----------------------------------------------------------
    t27_path = root / "data" / "raw" / "DGBAS-HR-T27-2025.xlsx"
    t32_path = root / "data" / "raw" / "DGBAS-HR-T32-2025.xlsx"
    t37_path = root / "data" / "raw" / "DGBAS-HR-T37-2025.xlsx"
    t50_path = root / "data" / "raw" / "DGBAS-HR-T50-2025.xlsx"
    t27 = find_new_taipei_row(t27_path)
    t32 = find_new_taipei_row(t32_path)
    t37 = find_new_taipei_row(t37_path)

    aux_paths = {
        "DGBAS-HR-T27": t27_path,
        "DGBAS-HR-T32": t32_path,
        "DGBAS-HR-T37": t37_path,
        "DGBAS-HR-T50": t50_path,
    }

    age_cells = {"25–29": 15, "30–34": 16, "35–39": 17}
    for band, col in age_cells.items():
        target = "25–29" if band == "25–29" else "30–35"
        overlap = 100 if band == "25–29" else (83.3333 if band == "30–34" else 16.6667)
        for alias, name, row, measure, unit, scope in (
            ("DGBAS-HR-T27", "表27：15歲以上民間人口教育程度與年齡", t27, "civilian_population_count", "千人", "15歲以上民間人口"),
            ("DGBAS-HR-T32", "表32：就業者教育程度與年齡", t32, "employed_person_count", "千人", "就業者"),
        ):
            amount = value(row, col)
            add(
                phase="P1_25_29_VALIDATION" if band == "25–29" else "P2_18_35_EXPANSION",
                topic="就業",
                source_alias=alias,
                source_name=name,
                source_period=2025,
                source_geography="新北市",
                geography_role="residence",
                population_scope=scope,
                measure_code=measure,
                measure_name=f"{band}歲{name.split('：', 1)[1]}",
                source_age_band=band,
                target_age_band=target,
                source_value=amount,
                source_unit=unit,
                adjustment_method_code="M0_DIRECT_EXACT" if band == "25–29" else "M4_BLOCK_SINGLE_AGE_35",
                adjusted_value=amount if band == "25–29" else None,
                adjusted_unit=unit,
                value_status="OFFICIAL_DIRECT_ROUNDED" if band == "25–29" else "BLOCKED_MISSING_AGE_35",
                evidence_class="E0_OFFICIAL_DIRECT" if band == "25–29" else "E5_BLOCKED",
                interval_overlap_percent=overlap,
                can_answer_18_35="PARTIAL" if band == "25–29" else "NO",
                publish_status="PUBLISH_SOURCE_NATIVE_ONLY" if band == "25–29" else "BLOCKED_PENDING",
                source_url=SOURCE_URLS[alias],
                local_snapshot=str(aux_paths[alias].relative_to(root)).replace("\\", "/"),
                sha256=sha256_file(aux_paths[alias]),
                definition_conflict="千人單位四捨五入；30–35需取得35歲單一年齡。" if band != "25–29" else "千人單位四捨五入。",
                human_review_id="HR-AGE-04" if band != "25–29" else "",
                human_review_required="YES" if band != "25–29" else "NO",
                notes="人力資源調查樣本估計；與戶籍人口不是相同母體。",
            )

    employment_population_ratio = value(t32, 15) / value(t27, 15) * 100
    add(
        phase="P1_25_29_VALIDATION",
        topic="就業",
        source_alias="DGBAS-HR-T27+T32",
        source_name="表27與表32組合",
        source_period=2025,
        source_geography="新北市",
        geography_role="residence",
        population_scope="15歲以上民間人口中的就業者",
        measure_code="employment_population_ratio_pct",
        measure_name="25–29歲就業人口比率",
        source_age_band="25–29",
        target_age_band="25–29",
        source_value=employment_population_ratio,
        source_unit="%",
        adjustment_method_code="M2_EXACT_NUMERATOR_DENOMINATOR",
        adjusted_value=employment_population_ratio,
        adjusted_unit="%",
        value_status="DERIVED_FROM_OFFICIAL_ROUNDED_COUNTS",
        evidence_class="E2_EXACT_FROM_COMPONENTS",
        interval_overlap_percent=100,
        can_answer_18_35="PARTIAL",
        publish_status="PUBLISH_WITH_ROUNDING_NOTE",
        source_url=SOURCE_URLS["DGBAS-HR-T27"],
        local_snapshot="data/raw/DGBAS-HR-T27-2025.xlsx + data/raw/DGBAS-HR-T32-2025.xlsx",
        sha256=f"{sha256_file(t27_path)}+{sha256_file(t32_path)}",
        definition_conflict="分子與分母均以千人四捨五入。",
        notes="215千人÷246千人；不是失業率，也不是勞參率。",
    )

    # Table 37 schema: columns 13--15 are 25--29 total/male/female.
    for sex, col in (("all", 13), ("male", 14), ("female", 15)):
        amount = value(t37, col)
        add(
            phase="P1_25_29_VALIDATION",
            topic="就業",
            source_alias="DGBAS-HR-T37",
            source_name="表37：年齡組別失業率",
            source_period=2025,
            source_geography="新北市",
            geography_role="residence",
            population_scope="勞動力統計母體",
            measure_code="unemployment_rate_pct",
            measure_name="25–29歲失業率",
            source_age_band="25–29",
            target_age_band="25–29",
            sex=sex,
            source_value=amount,
            source_unit="%",
            adjustment_method_code="M0_DIRECT_EXACT",
            adjusted_value=amount,
            adjusted_unit="%",
            value_status="OFFICIAL_DIRECT_SAMPLE_ESTIMATE",
            evidence_class="E0_OFFICIAL_DIRECT",
            interval_overlap_percent=100,
            can_answer_18_35="PARTIAL",
            publish_status="PUBLISH_SOURCE_NATIVE_ONLY",
            source_url=SOURCE_URLS["DGBAS-HR-T37"],
            local_snapshot=str(t37_path.relative_to(root)).replace("\\", "/"),
            sha256=sha256_file(t37_path),
            definition_conflict="年度不同於新北市開放資料目前最新值；屬抽樣調查。",
            human_review_id="HR-AGE-06",
            human_review_required="YES",
            notes="用於驗證欄位與年齡帶，不與2024數值作同年差異判定。",
        )

    # National 25--29 employed persons by education from table 50, row 16.
    t50 = load_workbook(t50_path, data_only=True, read_only=True).active
    t50_25_29 = tuple(cell.value for cell in t50[16])
    t50_levels = {
        "全體": 3,
        "國中及以下": 4,
        "高中（職）": 7,
        "大專及以上": 8,
    }
    for level, col in t50_levels.items():
        amount = value(t50_25_29, col)
        add(
            phase="P1_25_29_VALIDATION",
            topic="教育",
            source_alias="DGBAS-HR-T50",
            source_name="表50：就業者教育程度－按年齡分",
            source_period=2025,
            source_geography="全國",
            geography_role="national",
            population_scope="就業者",
            measure_code="employed_by_education_count",
            measure_name="25–29歲就業者教育程度人數",
            source_age_band="25–29",
            target_age_band="25–29",
            education_level=level,
            source_value=amount,
            source_unit="千人",
            adjustment_method_code="M0_DIRECT_EXACT",
            adjusted_value=amount,
            adjusted_unit="千人",
            value_status="OFFICIAL_DIRECT_ROUNDED",
            evidence_class="E0_OFFICIAL_DIRECT",
            interval_overlap_percent=100,
            can_answer_18_35="PARTIAL",
            publish_status="PUBLISH_SOURCE_NATIVE_ONLY",
            source_url=SOURCE_URLS["DGBAS-HR-T50"],
            local_snapshot=str(t50_path.relative_to(root)).replace("\\", "/"),
            sha256=sha256_file(t50_path),
            definition_conflict="全國就業者口徑，不代表新北市戶籍青年。",
            notes="官方表以千人四捨五入。",
        )
    college_share = value(t50_25_29, 8) / value(t50_25_29, 3) * 100
    add(
        phase="P1_25_29_VALIDATION",
        topic="教育",
        source_alias="DGBAS-HR-T50",
        source_name="表50：就業者教育程度－按年齡分",
        source_period=2025,
        source_geography="全國",
        geography_role="national",
        population_scope="就業者",
        measure_code="college_plus_share_pct",
        measure_name="25–29歲就業者大專及以上占比",
        source_age_band="25–29",
        target_age_band="25–29",
        education_level="大專及以上",
        source_value=college_share,
        source_unit="%",
        adjustment_method_code="M2_EXACT_NUMERATOR_DENOMINATOR",
        adjusted_value=college_share,
        adjusted_unit="%",
        value_status="DERIVED_FROM_OFFICIAL_ROUNDED_COUNTS",
        evidence_class="E2_EXACT_FROM_COMPONENTS",
        interval_overlap_percent=100,
        can_answer_18_35="PARTIAL",
        publish_status="PUBLISH_WITH_ROUNDING_NOTE",
        source_url=SOURCE_URLS["DGBAS-HR-T50"],
        local_snapshot=str(t50_path.relative_to(root)).replace("\\", "/"),
        sha256=sha256_file(t50_path),
        definition_conflict="全國就業者口徑；千人單位四捨五入。",
        notes="994千人÷1,253千人。",
    )

    # Current education source is retained only as context, not harmonized youth data.
    education = curated["education"]
    edu_snapshot, edu_hash, _ = manifest_meta("NTPC-EDU15P")
    for sex in ("male", "female"):
        add(
            phase="P2_18_35_EXPANSION",
            topic="教育",
            source_alias="NTPC-EDU15P",
            source_name="十五歲以上人口教育程度結構",
            source_period=education["latest"]["year"],
            source_geography="新北市",
            geography_role="residence",
            population_scope="15歲以上人口",
            measure_code="college_plus_share_pct",
            measure_name="15歲以上人口大專及以上占比（環境趨勢）",
            source_age_band="15歲以上",
            target_age_band="18–35",
            sex=sex,
            source_value=education["latest"][sex],
            source_unit="%",
            adjustment_method_code="M4_CONTEXT_ONLY_OPEN_ENDED_BAND",
            adjusted_value=None,
            adjusted_unit="%",
            value_status="CONTEXT_ONLY_NOT_AGE_COMPATIBLE",
            evidence_class="E4_PROXY_CONTEXT",
            interval_overlap_percent=None,
            can_answer_18_35="NO",
            publish_status="PUBLISH_AS_CONTEXT_ONLY",
            source_url=SOURCE_URLS["NTPC-EDU15P"],
            local_snapshot=edu_snapshot,
            sha256=edu_hash,
            definition_conflict="15歲以上開放上界，不能拆出18–35。",
            human_review_id="HR-AGE-03",
            human_review_required="YES",
            notes="不得標示為18–35歲教育程度。",
        )

    # ----------------------------------------------------------
    # Quality and pending-integration records.
    # ----------------------------------------------------------
    ntpc_pop_snapshot, ntpc_pop_hash, _ = manifest_meta("NTPC-POP")
    ntpc_pop_path = root / ntpc_pop_snapshot
    ntpc_pop_payload = load_json(ntpc_pop_path)
    ntpc_pop_rows = ntpc_pop_payload.get("responseData", []) if isinstance(ntpc_pop_payload, dict) else ntpc_pop_payload
    years = [int(match.group(1)) for row in ntpc_pop_rows if (match := re.match(r"(\d{4})", str(row.get("field1", ""))))]
    ntpc_pop_expected_minimum = 2250
    ntpc_pop_complete = len(ntpc_pop_rows) >= ntpc_pop_expected_minimum
    ntpc_pop_year_span = f"{min(years)}-{max(years)}" if years else "unknown"
    add(
        phase="QUALITY_GATE",
        topic="資料品質",
        source_alias="NTPC-POP",
        source_name="現住人口之年齡分配",
        source_period=ntpc_pop_year_span,
        source_geography="新北市及行政區",
        geography_role="residence",
        population_scope="戶籍人口",
        measure_code="snapshot_row_coverage",
        measure_name="本地快照資料列完整性",
        source_age_band="5歲年齡組",
        target_age_band="18–35",
        source_value=len(ntpc_pop_rows),
        source_unit="列",
        adjustment_method_code="DQ_COMPLETENESS_CHECK",
        adjusted_value=len(ntpc_pop_rows) if ntpc_pop_complete else None,
        adjusted_unit="列" if ntpc_pop_complete else "",
        value_status="PASSED_COMPLETE_PAGINATION" if ntpc_pop_complete else "FAILED_INCOMPLETE_SNAPSHOT",
        evidence_class="E0_QUALITY_VERIFIED" if ntpc_pop_complete else "E5_BLOCKED",
        interval_overlap_percent=None,
        can_answer_18_35="PARTIAL" if ntpc_pop_complete else "NO",
        publish_status="QUALITY_GATE_PASSED_SOURCE_NATIVE_ONLY" if ntpc_pop_complete else "BLOCKED_PENDING",
        source_url=SOURCE_URLS["NTPC-POP"],
        local_snapshot=ntpc_pop_snapshot,
        sha256=ntpc_pop_hash,
        definition_conflict=(
            f"分頁完整性已通過：取得{len(ntpc_pop_rows):,}列，年度{ntpc_pop_year_span}；但五歲組仍無法精確切出18、19、35歲。"
            if ntpc_pop_complete
            else f"官方目錄至少{ntpc_pop_expected_minimum:,}列；目前僅取得{len(ntpc_pop_rows):,}列，年度{ntpc_pop_year_span}。"
        ),
        human_review_id="HR-AGE-01",
        human_review_required="NO" if ntpc_pop_complete else "YES",
        notes=(
            "完整分頁介接已可作來源原生五歲組趨勢查核；18–35正式人口仍以MOI-POP1Y為主。"
            if ntpc_pop_complete
            else "修正分頁介接後才能作跨來源人口驗證；目前人口以MOI-POP1Y為正式來源。"
        ),
    )

    pending_sources = [
        (
            "MOI-EDU5Y",
            "15歲以上現住人口按性別、年齡、婚姻狀況及教育程度分",
            "教育",
            "戶籍人口",
            "15–19,20–24,25–29,30–34,35–39...",
            "18–35",
            "education_by_level_count",
            "18–35歲教育程度人數及占比",
            "M3_IPF_OR_OFFICIAL_CUSTOM_TABLE_FOR_BOUNDARIES",
            "PARTIAL_ACQUIRED_BOUNDARY_BLOCKED",
            "HR-AGE-08",
            "實檔驗證為五歲組；25–29可直接統計，18–24、30–35與18–35須官方客製表或經核准的M3估計。",
        ),
        (
            "DGBAS-EMP-EDU-AGE",
            "就業者之教育程度與年齡",
            "教育",
            "就業者",
            "15–24,25–29,30–34,35–39...",
            "18–35",
            "employed_by_education_count",
            "18–35歲就業者教育程度",
            "M4_NEEDS_SINGLE_AGE_18_19_35_OR_MICRODATA",
            "PENDING_MICRODATA",
            "HR-AGE-04",
            "可完整呈現25–29；18–35仍需18、19、35歲微資料或官方客製表。",
        ),
        (
            "DGBAS-HR-MICRODATA",
            "人力資源調查微資料或官方客製表",
            "就業",
            "民間人口／勞動力／就業者",
            "single age requested",
            "18–35",
            "labor_force_metrics",
            "18–35歲勞參率、就業人口比率、失業率",
            "M2_RECOMPUTE_NUMERATOR_DENOMINATOR",
            "PENDING_DATA_APPLICATION",
            "HR-AGE-04",
            "率必須由分子分母重新計算；不得平均既有年齡組率。",
        ),
        (
            "DGBAS-HUF-WAGE-MICRODATA",
            "人力運用調查微資料或官方客製表",
            "薪資",
            "受僱者",
            "single age requested",
            "18–35",
            "salary_metrics",
            "18–35歲薪資平均數及中位數",
            "M2_WEIGHTED_MEAN_AND_WEIGHTED_QUANTILE",
            "PENDING_DATA_APPLICATION",
            "HR-AGE-04",
            "平均數以受僱人數加權；中位數須由加權個體分布重算。",
        ),
    ]
    for alias, name, topic, scope, source_band, target_band, code, measure, method, status, review_id, note in pending_sources:
        add(
            phase="P2_18_35_EXPANSION",
            topic=topic,
            source_alias=alias,
            source_name=name,
            source_period="待取得",
            source_geography="新北市優先；不足時全國",
            geography_role="to_be_defined",
            population_scope=scope,
            measure_code=code,
            measure_name=measure,
            source_age_band=source_band,
            target_age_band=target_band,
            source_value=None,
            source_unit="依指標",
            adjustment_method_code=method,
            adjusted_value=None,
            adjusted_unit="依指標",
            value_status=status,
            evidence_class="E5_PENDING",
            interval_overlap_percent=None,
            can_answer_18_35="PENDING",
            publish_status="BLOCKED_PENDING",
            source_url=SOURCE_URLS.get(alias, ""),
            definition_conflict="尚未取得足以處理18、19、35歲邊界的資料。",
            human_review_id=review_id,
            human_review_required="YES",
            notes=note,
        )

    checklist = [
        {
            "id": "HR-AGE-01",
            "severity": "HIGH",
            "item": "確認NTPC-POP完整分頁",
            "decision": (
                f"已取得{len(ntpc_pop_rows):,}列、年度{ntpc_pop_year_span}；確認保留完整性自動測試。"
                if ntpc_pop_complete
                else "將API改為完整分頁，確認列數、最大年度及中文編碼後才解除封鎖。"
            ),
            "recommended": (
                "通過資料完整性Gate；MOI-POP1Y仍維持18–35正式人口主來源。"
                if ntpc_pop_complete
                else "同意；目前MOI-POP1Y維持人口正式來源。"
            ),
        },
        {
            "id": "HR-AGE-02",
            "severity": "HIGH",
            "item": "核定雙層數據政策",
            "decision": "官方精確層與研究估計層分開；估計值不得覆寫官方值。",
            "recommended": "同意；第一階段只發布E0-E2。",
        },
        {
            "id": "HR-AGE-03",
            "severity": "HIGH",
            "item": "教育程度母體",
            "decision": "選擇戶籍人口、15歲以上民間人口或就業者作為主要教育指標母體。",
            "recommended": "政策母體採戶籍人口；就業者教育另列就業視角。",
        },
        {
            "id": "HR-AGE-04",
            "severity": "HIGH",
            "item": "18、19、35歲邊界資料",
            "decision": "申請微資料／官方客製表，或接受研究估計層但不對外發布。",
            "recommended": "優先申請官方客製表；未取得前不發布整體率、平均數及中位數。",
        },
        {
            "id": "HR-AGE-05",
            "severity": "HIGH",
            "item": "薪資地理口徑",
            "decision": "工作場所位於新北市與居住於新北市兩種薪資視角是否同頁呈現。",
            "recommended": "可同頁但分卡顯示，禁止合併。",
        },
        {
            "id": "HR-AGE-06",
            "severity": "MEDIUM",
            "item": "統計年度對齊",
            "decision": "2024薪資／失業與2025人力資源、2026人口是否採最近可得期並列。",
            "recommended": "採最近可得期並列，圖表與問答強制顯示period。",
        },
        {
            "id": "HR-AGE-07",
            "severity": "HIGH",
            "item": "抽樣誤差及發布門檻",
            "decision": "人力資源調查的樣本估計是否設相對標準誤或樣本數門檻。",
            "recommended": "取得抽樣誤差後再核定；未取得前標示樣本估計。",
        },
        {
            "id": "HR-AGE-08",
            "severity": "MEDIUM",
            "item": "戶政教育單一年齡資料介接",
            "decision": "是否將ODRP053列為教育主來源並只保留行政區彙整結果。",
            "recommended": "同意；原始村里資料進S3 raw，Agent僅讀行政區彙整。",
        },
    ]

    method_catalog = [
        {"code": "M0_DIRECT_EXACT", "definition": "來源年齡帶與目標完全一致，數值不轉換。", "publication": "可依來源定義發布。"},
        {"code": "M1_EXACT_SUM_SINGLE_AGE", "definition": "單一年齡計數完整加總；適用可加總計數。", "publication": "可發布為官方資料衍生精確值。"},
        {"code": "M2_EXACT_NUMERATOR_DENOMINATOR", "definition": "由相同母體的官方分子與分母重算率或加權平均。", "publication": "可發布，須保存公式與組件。"},
        {"code": "M3_CALIBRATED_MODEL", "definition": "以調查比率、校準權重或小區域模型拆分；必須附不確定區間。", "publication": "研究估計層，未核准不得對外。"},
        {"code": "M4_BLOCKED", "definition": "缺少單一年齡、分子分母或分布，無法可靠轉換。", "publication": "阻擋；只呈現來源原生值或留空。"},
    ]

    value_origin_catalog = [
        {
            "code": "PROJECT_DERIVED_ADMIN_EXACT",
            "label": "本案由官方行政紀錄確定性計算",
            "meaning": "輸入為完整行政紀錄；本案只做可重現的加總或同母體比率計算，沒有抽樣推估。",
        },
        {
            "code": "OFFICIAL_ADMIN_DERIVED_STATISTIC",
            "label": "官方行政大數據統計值",
            "meaning": "政府以所得稅、保險等行政資料編製平均數或中位數；是官方發布值，但仍有母體與處理規則限制。",
        },
        {
            "code": "OFFICIAL_SURVEY_ESTIMATE",
            "label": "官方抽樣調查估計值",
            "meaning": "政府抽取樣本並加權推估母體；具有抽樣與非抽樣誤差，不能解讀為逐人完整計數。",
        },
        {
            "code": "PROJECT_DERIVED_SURVEY_ESTIMATE",
            "label": "本案由官方調查估計值再計算",
            "meaning": "本案以官方調查的分子分母重算；計算可重現，但承接原調查誤差及四捨五入誤差。",
        },
        {
            "code": "PROJECT_MODEL_ESTIMATE",
            "label": "本案研究模型估計值（目前0筆）",
            "meaning": "若未來以校準、年齡拆分或小區域模型估計，必須另存估計值、標準誤／區間、模型版本與核准紀錄。",
        },
        {
            "code": "OFFICIAL_PUBLISHED_METHOD_UNCONFIRMED",
            "label": "官方發布值；生成基礎待確認",
            "meaning": "數值是官方發布，但現有證據不足以確認屬行政紀錄或抽樣估計，正式使用前需查編製說明。",
        },
        {
            "code": "SYSTEM_QC_OBSERVATION",
            "label": "本案介接品質檢查值",
            "meaning": "列數、頁數或更新年度等系統稽核值，不是政策統計指標。",
        },
        {
            "code": "NO_NUMERIC_VALUE",
            "label": "尚無數值／尚未估計",
            "meaning": "必要資料不足或方法尚未核准；調整值刻意留空。",
        },
    ]

    result = {
        "schemaVersion": "1.0.0",
        "generatedFromRunId": curated["runId"],
        "policyTarget": "18–35",
        "validationBaseline": "25–29",
        "rows": rows,
        "humanReviewChecklist": checklist,
        "methodCatalog": method_catalog,
        "valueOriginCatalog": value_origin_catalog,
        "summary": {
            "recordCount": len(rows),
            "exact18To35Population": pop["coreYouth18To35"],
            "exact18To35PopulationSharePct": pop["coreSharePercent"],
            "baseline25To29Population": group_by_code["AGE-CORE-25-29"]["total"],
            "baselineUsableSourceAliases": sorted({row["source_alias"] for row in rows if row["phase"] == "P1_25_29_VALIDATION"}),
            "highSeverityReviewCount": sum(1 for item in checklist if item["severity"] == "HIGH"),
            "ntpcPopRowCount": len(ntpc_pop_rows),
            "ntpcPopYearSpan": ntpc_pop_year_span,
            "ntpcPopPaginationPassed": ntpc_pop_complete,
            "valueOriginCounts": {
                code: sum(1 for row in rows if row["value_origin_class"] == code)
                for code in sorted({row["value_origin_class"] for row in rows})
            },
        },
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

from __future__ import annotations

import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "deliverables" / "青年18-35歲資料整合表_V1.2.csv"
REGISTRY = (
    ROOT
    / "deliverables"
    / "NTPC_YouthAI_Reusable_Data_Package_V1.0"
    / "06_METHOD"
    / "age-range-conversion-registry-v1.0.csv"
)
OUTPUT = ROOT / "deliverables" / "青年18-35歲資料整合表_V1.3.csv"

NEW_COLUMNS = [
    "age_conversion_registry_id",
    "age_conversion_preferred_method",
    "age_conversion_required_auxiliary_data",
    "age_conversion_formula_or_rule",
    "age_conversion_estimate_class",
    "age_conversion_publish_decision",
    "age_conversion_blocked_reason",
    "age_conversion_validation_required",
    "age_conversion_uncertainty_method",
    "age_conversion_uncertainty_output",
]


UNCERTAINTY_RULES = [
    ("AR-M3A-SPRAGUE", "歷史單齡真值遮蔽回測；以log誤差經驗分位數建立預測區間", "bias、MAE、RMSE、95%經驗預測區間、負值率"),
    ("AR-M3B-PCLM", "遮蔽回測加parametric bootstrap；行政總數的bootstrap只解讀為模型敏感度", "λ、deviance、bias、MAE、RMSE、95%經驗／bootstrap區間"),
    ("AR-M3C-IPF", "替代種子表、邊際版本與平滑參數的敏感度分析；調查邊際可做設計式bootstrap", "迭代次數、最大邊際誤差、設定範圍、95%敏感度／bootstrap區間"),
    ("AR-M2-SURVEY-REESTIMATE", "依官方複雜抽樣設計採Taylor linearization、replicate weights或保留PSU的bootstrap", "SE、95% CI、RSE、未加權n、加權N"),
    ("AR-M7-WEIGHTED-QUANTILE", "replicate weights或保留分層與PSU的設計式bootstrap", "分位數95% CI、未加權n、加權N"),
    ("AR-M6-WEIGHTED-MEAN", "調查設計式標準誤；彙整表須傳播人數與平均數不確定性", "SE、95% CI、RSE、有效n與加權N"),
    ("AR-M5-RATE-RECOMPUTE", "行政分子分母只做品質查核；調查率採設計式標準誤", "分子、分母、SE、95% CI、RSE或資料品質旗標"),
    ("AR-M1-EXACT-SUM", "非抽樣估計；不建立模型CI，只報資料品質與版本差", "完整性、重複列、加總差、來源日期、SHA-256"),
    ("AR-M4-BLOCK-CONTEXT", "不估計；只記錄阻擋原因與補件狀態", "blocked_reason、required_auxiliary_data、human_review_id"),
]


def uncertainty_for(method_code: str) -> tuple[str, str]:
    matched = [(method, output) for code, method, output in UNCERTAINTY_RULES if code in method_code]
    if not matched:
        return ("待人工指定", "不得發布18–35")
    methods = "；".join(dict.fromkeys(item[0] for item in matched))
    outputs = "；".join(dict.fromkeys(item[1] for item in matched))
    return methods, outputs


def merge_registry(candidates: list[dict[str, str]]) -> dict[str, str]:
    merged = dict(candidates[0])
    fields = [
        "registry_id",
        "required_auxiliary_data",
        "preferred_method_code",
        "formal_formula_or_rule",
        "estimate_class",
        "blocked_reason",
        "validation_required",
    ]
    for field in fields:
        merged[field] = "；".join(dict.fromkeys(candidate[field] for candidate in candidates))
    decisions = {candidate["can_publish_18_35"] for candidate in candidates}
    merged["can_publish_18_35"] = decisions.pop() if len(decisions) == 1 else "條件式"
    return merged


def select_registry(row: dict[str, str], registry: dict[str, list[dict[str, str]]]) -> dict[str, str]:
    candidates = registry[row["source_alias"]]
    if len(candidates) == 1:
        return candidates[0]

    measure = row.get("measure_name", "")
    indicator = ""
    if "平均數" in measure and "中位數" in measure:
        return merge_registry(candidates)
    if "中位數" in measure:
        indicator = "薪資中位數"
    elif "平均數" in measure:
        indicator = "薪資平均數"
    if indicator:
        for candidate in candidates:
            if candidate["indicator_type"] == indicator:
                return candidate
    raise ValueError(f"無法唯一對應登錄表：{row['record_id']} / {row['source_alias']} / {measure}")


def main() -> None:
    with REGISTRY.open("r", encoding="utf-8-sig", newline="") as handle:
        registry_rows = list(csv.DictReader(handle))
    by_alias: dict[str, list[dict[str, str]]] = {}
    for item in registry_rows:
        by_alias.setdefault(item["source_alias"], []).append(item)

    with SOURCE.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        source_rows = list(reader)
        fieldnames = list(reader.fieldnames or [])

    unknown = sorted({row["source_alias"] for row in source_rows} - set(by_alias))
    if unknown:
        raise ValueError(f"下列來源沒有轉換登錄：{unknown}")

    enriched: list[dict[str, str]] = []
    for row in source_rows:
        method = select_registry(row, by_alias)
        uncertainty_method, uncertainty_output = uncertainty_for(method["preferred_method_code"])
        row.update(
            {
                "age_conversion_registry_id": method["registry_id"],
                "age_conversion_preferred_method": method["preferred_method_code"],
                "age_conversion_required_auxiliary_data": method["required_auxiliary_data"],
                "age_conversion_formula_or_rule": method["formal_formula_or_rule"],
                "age_conversion_estimate_class": method["estimate_class"],
                "age_conversion_publish_decision": method["can_publish_18_35"],
                "age_conversion_blocked_reason": method["blocked_reason"],
                "age_conversion_validation_required": method["validation_required"],
                "age_conversion_uncertainty_method": uncertainty_method,
                "age_conversion_uncertainty_output": uncertainty_output,
            }
        )
        enriched.append(row)

    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames + NEW_COLUMNS)
        writer.writeheader()
        writer.writerows(enriched)

    print(f"wrote {len(enriched)} rows -> {OUTPUT}")
    print(f"covered {len(by_alias)} source aliases and {len(registry_rows)} method registrations")


if __name__ == "__main__":
    main()

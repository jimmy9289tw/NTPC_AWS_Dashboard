from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "deliverables" / "青年18-35歲資料整合表_V1.3.csv"
OUTPUT = ROOT / "deliverables" / "青年18-35歲資料整合表_V1.4.csv"

STATUS_FIELD = "current_data_sufficient_to_execute"
REASON_FIELD = "current_data_gap_reason"


def required_files_present(paths: list[Path]) -> bool:
    return all(path.exists() for path in paths)


def classify(row: dict[str, str]) -> tuple[str, str]:
    alias = row["source_alias"]
    measure = row["measure_code"]

    if alias == "MOI-POP1Y":
        return (
            "YES_EXACT_ALREADY_EXECUTED",
            "無；官方單一年齡行政資料已取得，18–35歲人口數已精確加總，占比亦已用同期間總人口分母重算。",
        )

    if alias == "NTPC-POP":
        ready = required_files_present(
            [ROOT / "data" / "raw" / "NTPC-POP" / "20260816T155219+0800" / "NTPC-POP.json"]
        )
        if ready:
            return (
                "YES_MODEL_READY_NOT_EXECUTED",
                "完整分頁2,250列及五歲年齡組已取得，可用Sprague或PCLM估計18–35歲；結果僅能標示模型估計，並應以MOI單一年齡精確值做遮蔽回測。",
            )
        return (
            "NO_MISSING_REQUIRED_INPUTS",
            "缺完整分頁的五歲年齡組原始資料，無法執行Sprague或PCLM。",
        )

    if alias == "MOI-EDU5Y":
        ready = required_files_present(
            [
                ROOT / "data" / "processed" / "ODRP053_114_NTPC_profile.json",
                ROOT / "data" / "manifests" / "ODRP053_114_NTPC_validation.json",
            ]
        )
        if ready:
            return (
                "YES_MODEL_READY_NOT_EXECUTED",
                "新北市五歲年齡組×教育程度人數已取得，可先用PCLM估計18、19、35歲並重組18–35；若要再用IPF校準，仍須補同一統計期間的單一年齡人口邊際。不得標為官方精確值。",
            )
        return (
            "NO_MISSING_REQUIRED_INPUTS",
            "缺完整的新北市年齡組×教育程度交叉表，無法執行PCLM或IPF。",
        )

    if alias == "DGBAS-HR-T27":
        ready = (ROOT / "data" / "raw" / "DGBAS-HR-T27-2025.xlsx").exists()
        if ready:
            return (
                "YES_MODEL_READY_NOT_EXECUTED",
                "新北市15–24、25–29、30–34、35–39歲民間人口數已取得，可用PCLM拆分18、19、35歲後加總；來源為抽樣調查且以千人四捨五入，須報模型與抽樣不確定性。",
            )

    if alias == "DGBAS-HR-T32":
        ready = (ROOT / "data" / "raw" / "DGBAS-HR-T32-2025.xlsx").exists()
        if ready:
            return (
                "YES_MODEL_READY_NOT_EXECUTED",
                "新北市15–24、25–29、30–34、35–39歲就業人數已取得，可用PCLM拆分18、19、35歲後加總；來源為抽樣調查且以千人四捨五入，須報模型與抽樣不確定性。",
            )

    if alias == "DGBAS-HR-T27+T32":
        ready = required_files_present(
            [
                ROOT / "data" / "raw" / "DGBAS-HR-T27-2025.xlsx",
                ROOT / "data" / "raw" / "DGBAS-HR-T32-2025.xlsx",
            ]
        )
        if ready:
            return (
                "YES_MODEL_READY_NOT_EXECUTED",
                "T27民間人口與T32就業人數的完整相鄰年齡組已取得；兩者各自以PCLM估計18–35分子與分母後，可重算就業人口比率。不得直接平均原年齡組比率。",
            )

    if alias == "DGBAS-HR-T50":
        ready = (ROOT / "data" / "raw" / "DGBAS-HR-T50-2025.xlsx").exists()
        if ready:
            return (
                "YES_MODEL_READY_NATIONAL_ONLY",
                "表50已有全國15–19、20–24、25–29、30–34、35–39歲×教育程度人數，可用PCLM並以IPF校準估計18–35；但地理範圍是全國，不能作為新北市18–35歲結果。",
            )

    if alias == "NTPC-EMPSTR":
        return (
            "CONDITIONAL_MODEL_LIMITED_OUTPUT",
            "現有男女別年齡結構占比可分別用PCLM估計18–35歲占比；但缺男女就業人數分母，不能合併全體、不能產製就業人數，且只能作探索性模型估計。",
        )

    if alias == "NTPC-UNEMP":
        return (
            "NO_MISSING_REQUIRED_INPUTS",
            "只有分組失業率，缺各年齡組失業人數U與勞動力LF；18、19、35歲又位於跨界組，率不可直接平均或用人口比例切分。",
        )

    if alias == "DGBAS-HR-T37":
        return (
            "NO_MISSING_REQUIRED_INPUTS",
            "只有四捨五入後的分組失業率，缺未四捨五入的失業人數U與勞動力LF。即使搭配T32就業人數反推，也會混合抽樣與四捨五入誤差，暫不列為可正式執行。",
        )

    if alias == "NTPC-EDU15P":
        return (
            "NO_MISSING_REQUIRED_INPUTS",
            "只有15歲以上整體教育占比，缺年齡×教育程度交叉人數；無法唯一識別18–35歲。",
        )

    if alias == "DGBAS-EMP-EDU-AGE":
        return (
            "NO_MISSING_REQUIRED_INPUTS",
            "尚未取得可切出18、19、35歲的微資料或官方客製表；目前只能使用25–29等來源原生年齡組。",
        )

    if alias == "DGBAS-HR-MICRODATA":
        return (
            "NO_MISSING_REQUIRED_INPUTS",
            "尚未取得人力資源調查微資料、樣本權數與設計變數，不能重估18–35歲勞參率、就業人口比率及失業率。",
        )

    if alias == "DGBAS-HUF-WAGE-MICRODATA":
        return (
            "NO_MISSING_REQUIRED_INPUTS",
            "尚未取得薪資微資料與權數；平均數缺受僱人數權重，中位數缺完整個體薪資分布。",
        )

    if alias == "STAT-WAGE-EDU":
        if measure == "annual_salary_mean_10k_twd":
            reason = "缺18–24歲專屬平均、30–35歲切分及各年齡×教育組受僱人數／權數；平均數不能由25–29與30–39簡單平均。"
        else:
            reason = "缺18–35歲個體薪資分布與權數；分組中位數不能平均，也不能由25–29與30–39兩個中位數推回整體中位數。"
        return ("NO_MISSING_REQUIRED_INPUTS", reason)

    if alias == "STAT-WAGE-LOC":
        if measure == "annual_salary_mean_10k_twd":
            reason = "新北工作場所僅有未滿25、25–29與30–39等寬組平均，缺18–24邊界切分、30–35切分及受僱人數權數。"
        else:
            reason = "新北工作場所只有分組中位數，缺18–35歲個體薪資分布與權數；中位數不可用分組中位數合併。"
        return ("NO_MISSING_REQUIRED_INPUTS", reason)

    return (
        "NO_MISSING_REQUIRED_INPUTS",
        "尚未建立此來源的充分性規則，須人工確認必要輸入、年齡邊界、地理與母體口徑。",
    )


def main() -> None:
    with INPUT.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        source_fields = list(reader.fieldnames or [])

    if not rows:
        raise ValueError("V1.3整合表沒有資料列")
    if STATUS_FIELD in source_fields or REASON_FIELD in source_fields:
        raise ValueError("V1.3已存在V1.4充分性欄位，拒絕重複新增")

    for row in rows:
        status, reason = classify(row)
        row[STATUS_FIELD] = status
        row[REASON_FIELD] = reason

    output_fields = source_fields + [STATUS_FIELD, REASON_FIELD]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=output_fields, extrasaction="raise")
        writer.writeheader()
        writer.writerows(rows)

    counts = Counter(row[STATUS_FIELD] for row in rows)
    if len(rows) != 65:
        raise ValueError(f"列數異常：預期65，實際{len(rows)}")
    if any(not row[STATUS_FIELD] or not row[REASON_FIELD] for row in rows):
        raise ValueError("充分性或原因欄位存在空值")
    print(OUTPUT)
    print(dict(sorted(counts.items())))


if __name__ == "__main__":
    main()

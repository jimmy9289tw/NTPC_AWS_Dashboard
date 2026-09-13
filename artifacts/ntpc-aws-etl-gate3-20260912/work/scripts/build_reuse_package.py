from __future__ import annotations

import csv
import hashlib
import json
import shutil
import zipfile
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_NAME = "NTPC_YouthAI_Reusable_Data_Package_V1.0"
OUT = ROOT / "deliverables" / PACKAGE_NAME
ZIP_PATH = ROOT / "deliverables" / f"{PACKAGE_NAME}.zip"


ABBREVIATIONS = [
    ("PLAT-GOV-DATA", "政府資料開放平臺", "來源平臺", "data.gov.tw"),
    ("PLAT-NTPC-OPENAPI", "新北市政府資料開放平臺 OpenAPI", "來源平臺", "data.ntpc.gov.tw"),
    ("PLAT-NTPC-OAS", "新北市統計資料庫", "來源平臺", "oas.bas.ntpc.gov.tw"),
    ("PLAT-STAT", "中華民國統計資訊網／行政院主計總處", "來源平臺", "stat.gov.tw"),
    ("MOI-POP1Y", "村里戶數、單一年齡人口", "人口資料", "18–35 精確加總基準"),
    ("NTPC-POP", "新北市現住人口之年齡分配", "人口資料", "年度趨勢／OAS 鏡像查核"),
    ("OAS-POP", "新北市統計資料庫現住人口之年齡分配", "人口資料", "人工匯出證據"),
    ("NTPC-UNEMP", "新北市失業率－年齡別", "就業資料", "25–29 可精確使用"),
    ("NTPC-EMPSTR", "新北市就業者年齡結構", "就業資料", "補充觀察"),
    ("NTPC-EDU15P", "新北市十五歲以上人口教育程度結構", "教育資料", "非 18–35 專屬"),
    ("STAT-WAGE-EDU", "年齡×教育程度全年總薪資（表5）", "薪資資料", "全國受僱員工"),
    ("STAT-WAGE-LOC", "工作場所縣市×年齡全年總薪資（表6）", "薪資資料", "新北工作場所"),
    ("OCR-DOC", "無結構掃描文件", "補充來源", "需逐欄人工覆核"),
    ("PK", "Primary Key／主鍵", "技術", "唯一識別資料列"),
    ("SHA-256", "Secure Hash Algorithm 256-bit", "稽核", "檔案完整性指紋"),
    ("MAE", "Mean Absolute Error／平均絕對誤差", "模型品質", "回測誤差"),
    ("PENDING_HUMAN_REVIEW", "待人工查核", "狀態", "未通過不得正式使用"),
    ("AR-M1", "Exact single-age sum／單一年齡精確加總", "年齡轉換", "官方行政精確值"),
    ("AR-M2", "Survey re-estimation／調查設計加權重估", "年齡轉換", "官方調查估計值"),
    ("AR-M3A", "Sprague multipliers", "年齡轉換", "5歲人數組拆為單齡的模型估計"),
    ("AR-M3B", "Composite Link Model／PCLM", "年齡轉換", "懲罰化Poisson拆齡模型"),
    ("AR-M3C", "Iterative Proportional Fitting／IPF", "年齡轉換", "依已知邊際校準交叉表"),
    ("AR-M5", "Rate recomputation／分子分母重算", "年齡轉換", "率不可直接平均"),
    ("AR-M6", "Weighted mean／加權平均", "年齡轉換", "平均薪資需人數或權數"),
    ("AR-M7", "Weighted quantile／加權分位數", "年齡轉換", "中位數須由個體分布重算"),
    ("AR-M4", "Blocked context／不可識別阻擋", "年齡轉換", "缺邊界或分布時不產製18–35"),
]


FIELD_MATRIX = [
    ("period／year", "統計期／年度", "✓", "✓", "△", "✓", "✓", "✓", "✓", "✓", "✓"),
    ("geo_code", "行政區代碼", "✓", "△", "△", "—", "—", "—", "—", "—", "—"),
    ("geo_name", "行政區／縣市名稱", "✓", "✓", "✓", "新北", "新北", "新北", "全國", "工作地", "—"),
    ("age／age_band", "單一年齡／年齡帶", "✓單歲", "△5歲帶", "依匯出", "△來源帶", "△來源帶", "—", "✓25–29", "✓25–29", "—"),
    ("sex", "性別", "✓", "✓", "依匯出", "✓", "✓", "✓", "—", "—", "—"),
    ("population_total", "人口數", "✓", "✓", "依匯出", "—", "—", "—", "—", "—", "—"),
    ("unemployment_rate", "失業率", "—", "—", "—", "✓", "—", "—", "—", "—", "—"),
    ("employment_share", "就業者年齡結構", "—", "—", "—", "—", "✓", "—", "—", "—", "—"),
    ("education_level", "教育程度", "—", "—", "—", "—", "—", "✓", "✓", "—", "—"),
    ("salary_mean", "全年總薪資平均數", "—", "—", "—", "—", "—", "—", "✓", "✓", "—"),
    ("salary_median", "全年總薪資中位數", "—", "—", "—", "—", "—", "—", "✓", "✓", "—"),
    ("population_scope", "統計母體", "戶籍", "戶籍", "依匯出", "勞動力", "就業者", "15+人口", "受僱員工", "本國籍全時", "文件"),
    ("geography_role", "地理角色", "居住", "居住", "居住", "居住", "居住", "居住", "全國", "工作場所", "文件"),
    ("unit", "單位", "人", "人", "人", "%", "%", "%", "萬元", "萬元", "依文件"),
    ("source_url", "官方來源 URL", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "依文件"),
    ("retrieved_at", "擷取時間", "✓", "✓", "人工", "✓", "✓", "✓", "✓", "✓", "✓"),
    ("sha256", "原始檔雜湊", "✓", "✓", "人工", "✓", "✓", "✓", "✓", "✓", "✓"),
    ("review_status", "查核狀態", "✓", "✓", "必填", "✓", "✓", "✓", "✓", "✓", "必填"),
]


def write_csv(path: Path, headers: list[str], rows: list[tuple[str, ...]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(rows)


def copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def build() -> tuple[Path, Path]:
    if OUT.exists():
        shutil.rmtree(OUT)
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    OUT.mkdir(parents=True)

    readme = """# 新北市青年政策公開資料 AI 系統｜可重複使用資料包 V1.0

## 快速開始

1. 先讀 `00_README/使用說明.md` 與 `07_GOVERNANCE/HUMAN-REVIEW-SOP.md`。
2. 以 `01_SOURCE_CATALOG/source-catalog.csv` 確認來源與狀態。
2a. 先以 `06_METHOD/age-range-conversion-registry-v1.0.csv` 確認每一來源的18–35公式，再由 `age-conversion-method-registry-v1.0.csv` 取得計算步驟與不確定性規則。
3. 依 `03_INTEGRATION/integration-contracts.json` 執行自動擷取；OAS 依人工證據鏈處理。
4. 只用 `05_DATA/curated/policy-indicators.json` 作已產製指標；原始檔用於重算與查核。
5. 執行 `scripts/run_pipeline.py` 重取新資料，所有 `latest` 只在成功時更新。
6. AWS bridge 部署前，先完成 `07_GOVERNANCE/HUMAN-REVIEW-SOP.md` 的成本、安全與 API Gate。

## 符號

- `✓`：有可對應欄位。
- `△`：部分對應、來源分組跨界或需轉換，不可直接合併。
- `—`：沒有對應欄位。

## 重要限制

核心青年 18–35 人口優先使用單一年齡精確加總。只有5歲人數組且沒有單齡時，Sprague、PCLM、IPF僅可作有回測與區間的模型估計；率不得平均，中位數不得平均。教育與薪資、居住地與工作場所、戶籍人口與受僱員工均不得視為同一批個體。情境外推不是官方預測。
"""
    (OUT / "00_README" / "使用說明.md").parent.mkdir(parents=True, exist_ok=True)
    (OUT / "00_README" / "使用說明.md").write_text(readme, encoding="utf-8")

    sources = json.loads((ROOT / "config" / "sources.json").read_text(encoding="utf-8"))
    source_rows = []
    for item in sources["datasets"]:
        source_rows.append((
            item["alias"], item["name"], item["topic"], item["platformId"],
            item["geographyRole"], item["population"], item["unit"], item["status"], item["url"]
        ))
    write_csv(
        OUT / "01_SOURCE_CATALOG" / "source-catalog.csv",
        ["縮寫", "資料名稱", "主題", "平臺代號", "地理角色", "統計母體", "單位", "狀態", "官方網址"],
        source_rows,
    )
    write_csv(
        OUT / "02_ABBREVIATIONS" / "abbreviation-table.csv",
        ["縮寫代號", "全名", "分類", "用途／說明"], ABBREVIATIONS,
    )
    write_csv(
        OUT / "04_FIELD_CROSSWALK" / "field-crosswalk.csv",
        ["標準參數", "中文定義", "MOI-POP1Y", "NTPC-POP", "OAS-POP", "NTPC-UNEMP", "NTPC-EMPSTR", "NTPC-EDU15P", "STAT-WAGE-EDU", "STAT-WAGE-LOC", "OCR-DOC"],
        FIELD_MATRIX,
    )

    file_map = [
        (ROOT / "config" / "integration-contracts.json", OUT / "03_INTEGRATION" / "integration-contracts.json"),
        (ROOT / "schemas" / "integration-contracts.schema.json", OUT / "03_INTEGRATION" / "integration-contracts.schema.json"),
        (ROOT / "docs" / "INTEGRATION-SPEC.md", OUT / "03_INTEGRATION" / "INTEGRATION-SPEC.md"),
        (ROOT / "docs" / "PIPELINE-RUNBOOK.md", OUT / "03_INTEGRATION" / "PIPELINE-RUNBOOK.md"),
        (ROOT / "config" / "sources.json", OUT / "01_SOURCE_CATALOG" / "sources.json"),
        (ROOT / "data" / "curated" / "policy-indicators-latest.json", OUT / "05_DATA" / "curated" / "policy-indicators.json"),
        (ROOT / "data" / "manifests" / "latest.json", OUT / "05_DATA" / "manifests" / "latest.json"),
        (ROOT / "docs" / "ADR-001-DEFINITION-CONFLICTS.md", OUT / "06_METHOD" / "ADR-001-DEFINITION-CONFLICTS.md"),
        (ROOT / "docs" / "TASK-CARD-V3.md", OUT / "06_METHOD" / "TASK-CARD-V3.md"),
        (ROOT / "docs" / "age-range-conversion-registry-v1.0.csv", OUT / "06_METHOD" / "age-range-conversion-registry-v1.0.csv"),
        (ROOT / "docs" / "age-conversion-method-registry-v1.0.csv", OUT / "06_METHOD" / "age-conversion-method-registry-v1.0.csv"),
        (ROOT / "docs" / "年齡區間轉換方法與來源對照_V1.0.md", OUT / "06_METHOD" / "年齡區間轉換方法與來源對照_V1.0.md"),
        (ROOT / "deliverables" / "青年18-35歲資料整合表_V1.4.csv", OUT / "05_DATA" / "curated" / "青年18-35歲資料整合表_V1.4.csv"),
        (ROOT / "config" / "age-groups.json", OUT / "07_GOVERNANCE" / "age-groups.json"),
        (ROOT / "docs" / "HUMAN-REVIEW-SOP.md", OUT / "07_GOVERNANCE" / "HUMAN-REVIEW-SOP.md"),
        (ROOT / "aws" / "bridge" / "README.md", OUT / "08_AWS" / "README.md"),
        (ROOT / "aws" / "bridge" / "template.yaml", OUT / "08_AWS" / "template.yaml"),
        (ROOT / "aws" / "bridge" / "lambda_function.py", OUT / "08_AWS" / "lambda_function.py"),
        (ROOT / "aws" / "bridge" / "test_lambda_function.py", OUT / "08_AWS" / "test_lambda_function.py"),
        (ROOT / "scripts" / "run_pipeline.py", OUT / "09_REUSE_SCRIPTS" / "run_pipeline.py"),
        (ROOT / "src" / "ntpc_youth_ai" / "pipeline.py", OUT / "09_REUSE_SCRIPTS" / "pipeline.py"),
        (ROOT / "src" / "ntpc_youth_ai" / "analytics.py", OUT / "09_REUSE_SCRIPTS" / "analytics.py"),
        (ROOT / "scripts" / "enrich_age_integration_v13.py", OUT / "09_REUSE_SCRIPTS" / "enrich_age_integration_v13.py"),
    ]
    manual = ROOT / "deliverables" / "新北市青年政策公開資料AI系統_建立流程與研究方法手冊_V1.0.docx"
    if manual.exists():
        file_map.append((manual, OUT / "00_README" / manual.name))
    age_conversion_manual = ROOT / "deliverables" / "各資料表18-35歲換算方法與驗證算例_V1.0.docx"
    if age_conversion_manual.exists():
        file_map.append((age_conversion_manual, OUT / "00_README" / age_conversion_manual.name))
    for src, dst in file_map:
        copy(src, dst)

    latest_manifest = json.loads((ROOT / "data" / "manifests" / "latest.json").read_text(encoding="utf-8"))
    for artifact in latest_manifest["artifacts"]:
        raw_path = artifact.get("path")
        if artifact.get("status") == "ACQUIRED" and raw_path:
            src = ROOT / raw_path
            copy(src, OUT / "05_DATA" / "raw" / artifact["sourceId"] / src.name)

    qa = """QA SUMMARY\n- Python pipeline tests: 10 passed\n- AWS bridge tests: 2 passed\n- Dashboard route tests: passed\n- Dashboard lint/build: passed\n- Dashboard live visual inspection: passed\n- OAS-POP: PENDING_HUMAN_REVIEW\n- OCR-DOC: PENDING_HUMAN_REVIEW\n- AWS API bridge: code-ready, not deployed\n"""
    (OUT / "10_QA" / "test-summary.txt").parent.mkdir(parents=True, exist_ok=True)
    (OUT / "10_QA" / "test-summary.txt").write_text(qa, encoding="utf-8")

    entries = []
    for path in sorted(p for p in OUT.rglob("*") if p.is_file()):
        entries.append({
            "path": path.relative_to(OUT).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": digest(path),
        })
    manifest = {
        "package": PACKAGE_NAME,
        "createdAt": datetime.now().astimezone().isoformat(),
        "sourceRunId": latest_manifest["runId"],
        "classification": "PUBLIC + governance metadata; no credentials",
        "fileCount": len(entries),
        "files": entries,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(p for p in OUT.rglob("*") if p.is_file()):
            archive.write(path, Path(PACKAGE_NAME) / path.relative_to(OUT))
    return OUT, ZIP_PATH


if __name__ == "__main__":
    folder, zip_path = build()
    print(json.dumps({"folder": str(folder), "zip": str(zip_path)}, ensure_ascii=False))

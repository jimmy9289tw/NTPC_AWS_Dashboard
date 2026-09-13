from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

from docx import Document


PACKAGE = Path(r"D:\github\work\019fe05e-e1a3-71f2-840e-c026180d9474\NtpcYouthAI\deliverables\NTPC_Youth_18-35_Government_Open_Data_Package_V2.3_20260825")


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def check(condition: bool, label: str, details: str = "") -> dict[str, str]:
    return {"check": label, "status": "PASS" if condition else "FAIL", "details": details}


def main() -> None:
    results: list[dict[str, str]] = []
    results.append(check(PACKAGE.exists(), "package_exists", str(PACKAGE)))

    docs = sorted(PACKAGE.rglob("*V2.3.docx"))
    results.append(check(len(docs) == 9, "docx_count_9", str(len(docs))))
    results.append(check(not list(PACKAGE.rglob("*V2.2.docx")), "no_legacy_v22_docx"))
    for doc in docs:
        parsed = Document(doc)
        text = "\n".join(p.text for p in parsed.paragraphs)
        results.append(check(len(text) > 250, f"docx_parse_{doc.stem}", f"chars={len(text)}"))

    manifest_path = PACKAGE / "00_總覽與治理" / "source_manifest.csv"
    with manifest_path.open("r", encoding="utf-8-sig", newline="") as f:
        manifest = list(csv.DictReader(f))
    aliases = {r["alias"] for r in manifest}
    results.append(check("MOI-MARITAL5Y-114" in aliases and "MOI-MARITAL5Y-113" in aliases, "marital_sources_registered"))
    results.append(check("BLI-PENSION-WAGE-AGE" not in aliases and "BLI-WAGEGRADE-LOC" not in aliases, "salary_proxies_removed_from_manifest"))
    results.append(check(not (PACKAGE / "05_薪資平均數" / "raw" / "BLI-PENSION-AVG-CONTRIBUTION-WAGE-AGE-114.csv").exists(), "pension_wage_proxy_file_removed"))
    results.append(check(not (PACKAGE / "06_薪資中位數與分布" / "raw" / "BLI-INSURED-REGION-WAGEGRADE-SEX-114.csv").exists(), "wagegrade_proxy_file_removed"))

    target_path = PACKAGE / "07_婚姻狀態" / "processed" / "114" / "MOI-MARITAL-NTPC-114-TARGET-AGE.csv"
    with target_path.open("r", encoding="utf-8-sig", newline="") as f:
        marital = list(csv.DictReader(f))
    target = [r for r in marital if r["sex"] == "合計" and r["target_age_band"] == "18-35" and r["classification_view"] == "OFFICIAL_4_CATEGORY"]
    total = sum(float(r["population_count"]) for r in target)
    results.append(check(abs(total - 845_938.0) < 0.001, "marital_18_35_total_reconciles", f"total={total:.3f}"))
    binary = [r for r in marital if r["sex"] == "合計" and r["target_age_band"] == "18-35" and r["classification_view"] == "DERIVED_BINARY"]
    binary_total = sum(float(r["population_count"]) for r in binary)
    results.append(check(abs(binary_total - 845_938.0) < 0.001, "marital_binary_total_reconciles", f"total={binary_total:.3f}"))
    exact_2529 = [r for r in marital if r["sex"] == "合計" and r["target_age_band"] == "25-29"]
    results.append(check(exact_2529 and all(r["value_origin_class"] == "OFFICIAL_ADMIN_EXACT" for r in exact_2529), "marital_25_29_exact"))
    model_1835 = [r for r in marital if r["sex"] == "合計" and r["target_age_band"] == "18-35"]
    results.append(check(model_1835 and all(r["value_origin_class"] == "MODEL_ESTIMATE_FROM_OFFICIAL_MARGINS" for r in model_1835), "marital_18_35_model_labeled"))

    for year in ("113", "114"):
        rec = PACKAGE / "07_婚姻狀態" / "processed" / year / f"MOI-MARITAL-NTPC-{year}-RECONCILIATION.csv"
        with rec.open("r", encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
        numeric_fields = [name for name in rows[0] if "difference" in name.lower() or "error" in name.lower()]
        max_abs = 0.0
        for row in rows:
            for field in numeric_fields:
                if row.get(field) not in (None, ""):
                    max_abs = max(max_abs, abs(float(row[field])))
        results.append(check(max_abs < 1e-4, f"marital_{year}_reconciliation", f"max_abs={max_abs:.3e}"))

    integrated = PACKAGE / "08_整合與查核" / "reference" / "婚姻狀態_18-35_整合表_V2.3.csv"
    with integrated.open("r", encoding="utf-8-sig", newline="") as f:
        integrated_rows = list(csv.DictReader(f))
    results.append(check(len(integrated_rows) == 12, "marital_integrated_rows", str(len(integrated_rows))))
    results.append(check(any(r["human_review_required"] == "YES" for r in integrated_rows), "model_rows_require_human_review"))

    hash_path = PACKAGE / "00_總覽與治理" / "file_hashes_sha256.csv"
    with hash_path.open("r", encoding="utf-8-sig", newline="") as f:
        hashes = list(csv.DictReader(f))
    mismatches = []
    for row in hashes:
        path = PACKAGE / row["relative_path"]
        if not path.exists() or digest(path) != row["sha256"]:
            mismatches.append(row["relative_path"])
    results.append(check(not mismatches, "file_hashes_verify", ";".join(mismatches[:5])))

    fail_count = sum(r["status"] == "FAIL" for r in results)
    report_json = PACKAGE / "00_總覽與治理" / "qa_report_v2.3.json"
    report_csv = PACKAGE / "00_總覽與治理" / "qa_report_v2.3.csv"
    report_json.write_text(json.dumps({"status": "PASS" if fail_count == 0 else "FAIL", "checks": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    with report_csv.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["check", "status", "details"])
        writer.writeheader()
        writer.writerows(results)
    print(json.dumps({"status": "PASS" if fail_count == 0 else "FAIL", "fail_count": fail_count, "check_count": len(results)}, ensure_ascii=False))
    if fail_count:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

"""Validate G7 AWS/Kiro contracts without creating or changing AWS resources."""

from __future__ import annotations

import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "deliverables" / "NTPC_Youth_Complete_Data_Package_G5_V3.2_20260826"
PUBLISHED = PACKAGE / "09_發布資料包"
REPORT = ROOT / "qa" / "g7-aws-kiro-readiness.json"

EXPECTED_TOOLS = {
    "list_available_dimensions",
    "query_registered_metrics",
    "query_labor_metrics",
    "query_wage_metrics",
    "query_policy_service_evidence",
    "list_service_facilities",
    "explain_method",
    "get_source_evidence",
}

EXPECTED_TABLES = {
    "registered_population_metrics",
    "labor_market_metrics",
    "employee_wage_metrics",
    "policy_service_evidence",
    "service_facility_inventory",
    "service_facility_capacity_components",
}


def load_json(relative: str) -> dict:
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


def main() -> int:
    checks: list[dict[str, object]] = []

    def check(check_id: str, passed: bool, detail: str) -> None:
        checks.append({"id": check_id, "status": "PASS" if passed else "FAIL", "detail": detail})

    contracts = load_json("config/agent-tool-contracts.json")
    policy = contracts.get("defaultQueryPolicy", {})
    tools = contracts.get("tools", [])
    tool_names = [tool.get("name") for tool in tools]
    data_planes = {item.get("code"): item for item in contracts.get("dataPlanes", [])}

    check("G7-CONTRACT-001", set(tool_names) == EXPECTED_TOOLS, "八個受控工具名稱必須完整且不可多出任意查詢工具")
    check("G7-CONTRACT-002", len(tool_names) == len(set(tool_names)), "工具名稱不可重複")
    check("G7-CONTRACT-003", all(tool.get("access") == "READ_ONLY" for tool in tools), "所有資料工具維持唯讀")
    check("G7-CONTRACT-004", bool(policy.get("parameterizedSqlOnly")) and bool(policy.get("failClosed")), "只允許參數化查詢並採fail-closed")
    check("G7-CONTRACT-005", bool(policy.get("denyCrossUniverseDenominator")) and bool(policy.get("denyRawS3Listing")), "禁止跨母體分母與raw S3列舉")
    check("G7-CONTRACT-006", data_planes.get("POLICY_SERVICE", {}).get("kind") == "AUXILIARY_EVIDENCE", "政策服務必須是輔助證據而非人口母體")
    check("G7-CONTRACT-007", data_planes.get("LABOR_MARKET", {}).get("geographyScope") == "CITY_ONLY" and data_planes.get("EMPLOYEE_WAGE", {}).get("geographyScope") == "CITY_ONLY", "勞動與薪資只允許全市")

    policy_tool = next((tool for tool in tools if tool.get("name") == "query_policy_service_evidence"), {})
    output_contract = policy_tool.get("outputContract", {})
    check("G7-CONTRACT-008", output_contract.get("exposureUnit") == "人次／場" and output_contract.get("retainRepeatedPersonTimes") is True, "曝光強度固定人次／場且保留重複參與")

    metric_files = {
        "registered_population_metrics": "01_戶籍人口母體_長格式.csv",
        "labor_market_metrics": "02_民間人口與勞動市場母體_長格式.csv",
        "employee_wage_metrics": "03_受僱員工薪資母體_長格式.csv",
        "policy_service_evidence": "06_政策服務與曝光_長格式.csv",
    }
    required_fields = set(contracts.get("requiredEvidenceFields", []))
    for table, filename in metric_files.items():
        path = PUBLISHED / filename
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            fieldnames = set(reader.fieldnames or [])
            first = next(reader, None)
        check(f"G7-DATA-{table}-EXISTS", path.is_file() and first is not None, f"{filename}存在且非空")
        check(f"G7-DATA-{table}-EVIDENCE", required_fields.issubset(fieldnames), f"{filename}包含Agent回答必要證據欄")

    exposure_path = PUBLISHED / metric_files["policy_service_evidence"]
    exposure_rows: list[dict[str, str]] = []
    with exposure_path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if row.get("metric_code") == "SERVICE_PERSON_TIMES_PER_ACTIVITY" and row.get("publish_status", "").startswith("PUBLISH"):
                exposure_rows.append(row)
    exposure_math_ok = bool(exposure_rows)
    for row in exposure_rows:
        try:
            value = float(row["value"])
            numerator = float(row["numerator"])
            denominator = float(row["denominator"])
        except (TypeError, ValueError, ZeroDivisionError):
            exposure_math_ok = False
            break
        if row.get("unit") != "人次／場" or denominator <= 0 or abs(value - numerator / denominator) > 1e-6:
            exposure_math_ok = False
            break
    check("G7-DATA-EXPOSURE-MATH", exposure_math_ok, f"{len(exposure_rows)}列發布曝光強度通過分子÷分母重算")
    check("G7-DATA-EXPOSURE-NOT-RATE", all("%" not in (row.get("unit") or "") and "率" not in (row.get("metric_name_zh") or "") for row in exposure_rows), "曝光強度未標為百分比或率")

    sql = (ROOT / "aws" / "athena" / "ntpc_youth_catalog.sql.tmpl").read_text(encoding="utf-8")
    check("G7-AWS-001", all(f"{table}" in sql for table in EXPECTED_TABLES), "Athena樣板包含六張隔離資料表")
    check("G7-AWS-002", "${PUBLISHED_BUCKET}" in sql and "${CATALOG_VERSION}" in sql, "部署樣板強制使用已核准bucket與不可變Catalog版本")
    check("G7-AWS-003", "Do not create a materialized view" in sql and "data_plane'='auxiliary_evidence" in sql, "SQL明示禁止跨母體物化View並隔離輔助證據")

    handoff = PACKAGE / "12_AWS_Kiro_實作檔案"
    openapi = (handoff / "AgentCore" / "governed-tools" / "openapi.yaml").read_text(encoding="utf-8")
    cedar = (handoff / "AgentCore" / "governed-tools" / "policy.cedar").read_text(encoding="utf-8")
    handoff_sql = (handoff / "AWS資料平台IaC" / "athena-catalog.sql.tmpl").read_text(encoding="utf-8")
    kiro_design = (handoff / "KIRO規格" / "specs" / "ntpc-youth-g5" / "design.md").read_text(encoding="utf-8")
    check("G7-HANDOFF-001", all(f"operationId: {name}" in openapi for name in EXPECTED_TOOLS), "資料包OpenAPI包含八個operationId")
    check("G7-HANDOFF-002", all(f"___{name}\"" in cedar for name in EXPECTED_TOOLS), "Cedar default-deny政策只明確列出八個工具動作")
    check("G7-HANDOFF-003", all(table in handoff_sql for table in EXPECTED_TABLES), "資料包含可交接Athena六表樣板")
    check("G7-HANDOFF-004", "只明確允許八個唯讀工具" in kiro_design and "六個唯讀工具" not in kiro_design, "Kiro設計文件已同步八工具邊界")

    deployment = load_json("config/deployment-settings.json")
    blockers = {
        "costCenter": deployment.get("costCenter"),
        "monthlyBudgetUsd": deployment.get("monthlyBudgetUsd"),
        "expiryDate": deployment.get("expiryDate"),
        "releaseGate": deployment.get("releaseGate"),
    }
    production_blocked = any("PENDING" in str(value) or "BLOCKED" in str(value) for value in blockers.values())
    check("G7-GATE-001", production_blocked, "未裁示成本、到期日或發布Gate時必須阻擋production")

    failed = [item for item in checks if item["status"] == "FAIL"]
    report = {
        "gate": "G7 AWS/Kiro local pre-deployment readiness",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "localReadiness": "PASS" if not failed else "FAIL",
        "productionDeployment": "BLOCKED_PENDING_HUMAN_APPROVAL" if production_blocked else "NOT_EVALUATED",
        "checks": checks,
        "summary": {"total": len(checks), "passed": len(checks) - len(failed), "failed": len(failed)},
        "deploymentBlockers": blockers,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False))
    print(f"report={REPORT}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

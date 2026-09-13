"""Local deployment preflight; exits non-zero when a hard gate fails."""

from __future__ import annotations

import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_JSON = (
    "agentcore/agentcore.json",
    "app/NtpcYouthAI/harness.json",
    "config/age-groups.json",
    "config/sources.json",
    "config/deployment-settings.json",
    "config/browser-enterprise-policy.json",
    "config/integration-contracts.json",
    "config/agent-tool-contracts.json",
)


def main() -> int:
    errors: list[str] = []
    loaded = {}
    for relative in REQUIRED_JSON:
        path = ROOT / relative
        try:
            loaded[relative] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{relative}: {exc}")

    harness = loaded.get("app/NtpcYouthAI/harness.json", {})
    allowed = set(harness.get("allowedTools", []))
    declared = {tool.get("name") for tool in harness.get("tools", [])}
    if allowed != declared:
        errors.append("allowedTools must equal the declared, least-privilege tool names")
    if harness.get("memory", {}).get("mode") != "disabled":
        errors.append("prototype memory must remain disabled")
    if harness.get("maxIterations", 999) > 12:
        errors.append("maxIterations exceeds the approved prototype ceiling of 12")

    ages = loaded.get("config/age-groups.json", {}).get("groups", [])
    core_ranges = [(g.get("minAge"), g.get("maxAge")) for g in ages if g.get("core")]
    if core_ranges != [(18, 24), (25, 29), (30, 35)]:
        errors.append("core youth ranges must be exactly 18-24, 25-29, and 30-35")

    sources = loaded.get("config/sources.json", {})
    required_platforms = {
        p["id"] for p in sources.get("platforms", []) if p.get("requiredByProposition")
    }
    expected = {"PLAT-GOV-DATA", "PLAT-NTPC-OPENAPI", "PLAT-NTPC-OAS", "PLAT-STAT"}
    if required_platforms != expected:
        errors.append("required proposition platforms are incomplete")

    contracts = loaded.get("config/integration-contracts.json", {})
    contract_ids = {item.get("id") for item in contracts.get("sources", [])}
    required_contracts = {"MOI-POP1Y", "NTPC-UNEMP", "NTPC-EDU15P", "STAT-WAGE-EDU", "STAT-WAGE-LOC", "OAS-POP"}
    if not required_contracts.issubset(contract_ids):
        errors.append("integration contracts are incomplete")
    if not contracts.get("defaultPolicy", {}).get("failClosed"):
        errors.append("integration pipeline must fail closed")

    tool_contracts = loaded.get("config/agent-tool-contracts.json", {})
    tools = tool_contracts.get("tools", [])
    expected_tools = {
        "list_available_dimensions",
        "query_registered_metrics",
        "query_labor_metrics",
        "query_wage_metrics",
        "query_policy_service_evidence",
        "list_service_facilities",
        "explain_method",
        "get_source_evidence",
    }
    if {tool.get("name") for tool in tools} != expected_tools:
        errors.append("controlled data query tool contracts are incomplete")
    if any(tool.get("access") != "READ_ONLY" for tool in tools):
        errors.append("all controlled data query tools must remain read-only")
    planes = {item.get("code"): item for item in tool_contracts.get("dataPlanes", [])}
    if planes.get("POLICY_SERVICE", {}).get("kind") != "AUXILIARY_EVIDENCE":
        errors.append("policy service data must remain an auxiliary evidence plane")

    for message in errors:
        print(f"FAIL: {message}")
    if errors:
        return 1
    print("PASS: local governance preflight")
    return 0


if __name__ == "__main__":
    sys.exit(main())

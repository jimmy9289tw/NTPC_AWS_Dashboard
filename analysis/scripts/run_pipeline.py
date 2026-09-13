"""Retrieve official sources, curate indicators, and fail closed on hard errors."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ntpc_youth_ai.analytics import build_policy_indicators  # noqa: E402
from ntpc_youth_ai.pipeline import run_retrieval  # noqa: E402


AUTOMATIC_SOURCES = {
    "MOI-POP1Y",
    "NTPC-POP",
    "NTPC-UNEMP",
    "NTPC-EMPSTR",
    "NTPC-EDU15P",
    "STAT-WAGE-EDU",
    "STAT-WAGE-LOC",
    "OAS-POP",
    "OCR-DOC",
}
HARD_REQUIRED = {"MOI-POP1Y", "NTPC-UNEMP", "NTPC-EDU15P", "STAT-WAGE-EDU", "STAT-WAGE-LOC"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--period", default="11507", help="戶政司民國年月，例如 11507")
    parser.add_argument("--manifest-only", action="store_true")
    args = parser.parse_args()

    manifest = run_retrieval(ROOT, period=args.period, source_ids=AUTOMATIC_SOURCES)
    failures = {
        item["sourceId"]: item["note"]
        for item in manifest["artifacts"]
        if item["sourceId"] in HARD_REQUIRED and item["status"] != "ACQUIRED"
    }
    print(json.dumps({"runId": manifest["runId"], "failures": failures}, ensure_ascii=False, indent=2))
    if failures:
        return 2
    if not args.manifest_only:
        indicators = build_policy_indicators(ROOT, manifest)
        dashboard_data = ROOT / "dashboard" / "public" / "data"
        dashboard_data.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "data" / "curated" / "policy-indicators-latest.json", dashboard_data / "policy-indicators.json")
        shutil.copy2(ROOT / "data" / "manifests" / "latest.json", dashboard_data / "pipeline-manifest.json")
        print(json.dumps({
            "coreYouth18To35": indicators["population"]["coreYouth18To35"],
            "educationLatest": indicators["education"]["latest"],
            "unemploymentLatest": indicators["unemployment"]["latest"],
            "salaryWorkplaceLatest": indicators["salaryByWorkplace"]["latest"],
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

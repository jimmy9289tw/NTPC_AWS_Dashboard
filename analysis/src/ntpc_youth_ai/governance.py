"""Deterministic governance rules for the NTPC youth research agent.

The functions in this module deliberately avoid model judgement.  They are the
reproducible layer used before any value is merged, published, or described as
the official 18--35 youth population.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from enum import Enum
import hashlib
import json
from typing import Any, Mapping, Sequence


class AlignmentStatus(str, Enum):
    EXACT = "EXACT"
    CROSSWALK_REQUIRED = "CROSSWALK_REQUIRED"
    PARTIAL_OR_CONFLICT = "PARTIAL_OR_CONFLICT"
    PENDING_HUMAN_DECISION = "PENDING_HUMAN_DECISION"


@dataclass(frozen=True)
class DefinitionProfile:
    source_id: str
    population: str | None
    geography_role: str | None
    age_min: int | None
    age_max: int | None
    time_semantics: str | None
    unit: str | None
    measure_type: str | None
    method_version: str | None = None


AGE_GROUPS = (
    (15, 17, "AGE-OBS-15-17", False),
    (18, 24, "AGE-CORE-18-24", True),
    (25, 29, "AGE-CORE-25-29", True),
    (30, 35, "AGE-CORE-30-35", True),
    (36, 40, "AGE-EXT-36-40", False),
)

CRITICAL_FIELDS = ("population", "geography_role", "unit", "measure_type")


def classify_age(age: int) -> dict[str, Any] | None:
    """Return the governed age-group metadata, or None when out of scope."""
    if isinstance(age, bool) or not isinstance(age, int):
        raise TypeError("age must be an integer")
    for minimum, maximum, code, counts_as_core in AGE_GROUPS:
        if minimum <= age <= maximum:
            return {"code": code, "counts_as_core": counts_as_core}
    return None


def core_youth_total(single_age_counts: Mapping[int, int | float]) -> int | float:
    """Sum ages 18--35 only; require a complete, single-year, nonnegative series."""
    required = set(range(18, 36))
    present = set(single_age_counts)
    missing = sorted(required - present)
    if missing:
        raise ValueError(f"AGE_BOUNDARY_CONFLICT: missing single ages {missing}")
    total: int | float = 0
    for age in sorted(required):
        value = single_age_counts[age]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TypeError(f"count for age {age} must be numeric")
        if value < 0:
            raise ValueError(f"count for age {age} cannot be negative")
        total += value
    return total


def compare_definitions(
    left: DefinitionProfile,
    right: DefinitionProfile,
    *,
    crosswalk_fields: Sequence[str] = (),
) -> dict[str, Any]:
    """Compare two source definitions using an auditable precedence rule."""
    differences: list[dict[str, Any]] = []
    missing: list[str] = []
    for field in DefinitionProfile.__dataclass_fields__:
        if field == "source_id":
            continue
        left_value = getattr(left, field)
        right_value = getattr(right, field)
        if left_value is None or right_value is None:
            missing.append(field)
        elif left_value != right_value:
            differences.append(
                {"field": field, "left": left_value, "right": right_value}
            )

    difference_fields = {item["field"] for item in differences}
    age_fields = {"age_min", "age_max"}
    critical_conflicts = difference_fields.intersection(CRITICAL_FIELDS)
    age_conflict = bool(difference_fields.intersection(age_fields))

    if missing and (set(missing).intersection(CRITICAL_FIELDS) or set(missing).intersection(age_fields)):
        status = AlignmentStatus.PENDING_HUMAN_DECISION
        publish_blocked = True
    elif critical_conflicts:
        status = AlignmentStatus.PENDING_HUMAN_DECISION
        publish_blocked = True
    elif age_conflict:
        status = AlignmentStatus.PARTIAL_OR_CONFLICT
        publish_blocked = True
    elif difference_fields and difference_fields.issubset(set(crosswalk_fields)):
        status = AlignmentStatus.CROSSWALK_REQUIRED
        publish_blocked = False
    elif differences or missing:
        status = AlignmentStatus.PARTIAL_OR_CONFLICT
        publish_blocked = True
    else:
        status = AlignmentStatus.EXACT
        publish_blocked = False

    return {
        "leftSourceId": left.source_id,
        "rightSourceId": right.source_id,
        "status": status.value,
        "publishBlocked": publish_blocked,
        "differences": differences,
        "missingFields": sorted(missing),
        "ruleVersion": "DEF-COMPARE-1.0",
    }


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def make_audit_record(
    *,
    event_type: str,
    actor: str,
    input_payload: Mapping[str, Any],
    output_payload: Mapping[str, Any],
    source_ids: Sequence[str],
    observed_at: str | None = None,
) -> dict[str, Any]:
    """Create a tamper-evident audit record without storing secrets."""
    timestamp = observed_at or datetime.now(timezone.utc).isoformat()
    record = {
        "schemaVersion": "1.0",
        "eventType": event_type,
        "actor": actor,
        "observedAt": timestamp,
        "sourceIds": sorted(set(source_ids)),
        "input": dict(input_payload),
        "output": dict(output_payload),
    }
    record["sha256"] = hashlib.sha256(_canonical_json(record).encode("utf-8")).hexdigest()
    return record


def profile_as_dict(profile: DefinitionProfile) -> dict[str, Any]:
    return asdict(profile)

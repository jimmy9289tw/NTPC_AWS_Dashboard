from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_ROOT = PACKAGE_ROOT / "11_介接設定與追溯紀錄" / "schemas"


def load(name: str) -> dict:
    return json.loads((SCHEMA_ROOT / name).read_text(encoding="utf-8"))


def validate(instance, schema: dict, location: str = "$") -> None:
    if "const" in schema and instance != schema["const"]:
        raise ValueError(f"{location}: expected const {schema['const']!r}")
    if "enum" in schema and instance not in schema["enum"]:
        raise ValueError(f"{location}: value not in enum")
    expected = schema.get("type")
    type_map = {"object": dict, "array": list, "string": str, "integer": int}
    if expected in type_map and (not isinstance(instance, type_map[expected]) or expected == "integer" and isinstance(instance, bool)):
        raise ValueError(f"{location}: expected {expected}")
    if isinstance(instance, dict):
        required = schema.get("required", [])
        missing = [key for key in required if key not in instance]
        if missing:
            raise ValueError(f"{location}: missing {missing}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            extra = sorted(set(instance) - set(properties))
            if extra:
                raise ValueError(f"{location}: unexpected {extra}")
        for key, value in instance.items():
            if key in properties:
                validate(value, properties[key], f"{location}.{key}")
    if isinstance(instance, list):
        if len(instance) < schema.get("minItems", 0):
            raise ValueError(f"{location}: too few items")
        if schema.get("uniqueItems") and len({json.dumps(item, sort_keys=True, ensure_ascii=False) for item in instance}) != len(instance):
            raise ValueError(f"{location}: duplicate items")
        item_schema = schema.get("items")
        if item_schema:
            for index, item in enumerate(instance):
                validate(item, item_schema, f"{location}[{index}]")
    if isinstance(instance, str):
        if len(instance) < schema.get("minLength", 0) or len(instance) > schema.get("maxLength", float("inf")):
            raise ValueError(f"{location}: invalid length")
        if "pattern" in schema and not re.search(schema["pattern"], instance):
            raise ValueError(f"{location}: pattern mismatch")
        if schema.get("format") == "uuid":
            uuid.UUID(instance)
        if schema.get("format") == "date-time":
            datetime.fromisoformat(instance.replace("Z", "+00:00"))
    if isinstance(instance, int) and not isinstance(instance, bool):
        if instance < schema.get("minimum", instance) or instance > schema.get("maximum", instance):
            raise ValueError(f"{location}: out of range")
    for rule in schema.get("allOf", []):
        if "contains" in rule and isinstance(instance, list):
            if not any(("const" not in rule["contains"] or item == rule["contains"]["const"]) for item in instance):
                raise ValueError(f"{location}: missing required contained value")


def main() -> None:
    for name in ("export-request.schema.json", "export-manifest.schema.json"):
        schema = load(name)
        if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            raise ValueError(f"{name}: must declare JSON Schema Draft 2020-12")
        if schema.get("type") != "object" or not schema.get("properties"):
            raise ValueError(f"{name}: invalid root contract")
        print(f"SCHEMA_STRUCTURE_PASS {name}")

    required_fields = [
        "universe_name_zh", "roc_year", "period_basis", "geography_name_zh",
        "age_band", "sex_name_zh", "metric_name_zh", "value", "unit",
        "value_origin_label_zh", "source_name", "data_updated_at",
        "availability_status_zh",
    ]
    sample_request = {
        "schemaVersion": "1.0.0",
        "catalogVersion": "G5-V3.2",
        "requestId": "123e4567-e89b-12d3-a456-426614174000",
        "filters": {"rocYear": 114, "ageBand": "18-35", "sex": "ALL", "district": "新北市"},
        "universes": ["REGISTERED_POPULATION"],
        "fields": required_fields,
        "format": "CSV_UTF8_BOM_RFC4180",
        "delivery": "SEPARATE_FILES",
    }
    validate(sample_request, load("export-request.schema.json"))
    print(f"SAMPLE_REQUEST_PASS fields={len(required_fields)}")

    sample_manifest = {
        "schemaVersion": "1.0.0",
        "requestId": "123e4567-e89b-12d3-a456-426614174000",
        "catalogVersion": "G5-V3.2",
        "createdAt": "2026-08-29T12:00:00+08:00",
        "expiresAt": "2026-08-30T12:00:00+08:00",
        "status": "READY",
        "filters": sample_request["filters"],
        "files": [{
            "role": "REGISTERED_POPULATION", "filename": "registered.csv", "rows": 11,
            "bytes": 2048, "sha256": "a" * 64,
        }],
    }
    validate(sample_manifest, load("export-manifest.schema.json"))
    print("SAMPLE_MANIFEST_PASS files=1")


if __name__ == "__main__":
    main()

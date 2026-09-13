"""Official-data retrieval with immutable raw files and audit manifests.

The module intentionally keeps retrieval deterministic and model-free.  A
successful HTTP status is not enough: content signatures, hashes, row counts,
and source contracts are recorded before a payload can be curated.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import time
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


TAIPEI = timezone(timedelta(hours=8))


@dataclass(frozen=True)
class RetrievedArtifact:
    source_id: str
    status: str
    path: str | None
    url: str | None
    retrieved_at: str
    sha256: str | None = None
    byte_count: int | None = None
    row_count: int | None = None
    attempts: int = 0
    note: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "sourceId": self.source_id,
            "status": self.status,
            "path": self.path,
            "url": self.url,
            "retrievedAt": self.retrieved_at,
            "sha256": self.sha256,
            "byteCount": self.byte_count,
            "rowCount": self.row_count,
            "attempts": self.attempts,
            "note": self.note,
        }


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def load_contracts(root: Path) -> dict[str, Any]:
    path = root / "config" / "integration-contracts.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _request_bytes(
    url: str,
    *,
    timeout: int,
    attempts: int,
    backoffs: Iterable[int],
    user_agent: str,
) -> tuple[bytes, str, int]:
    delays = list(backoffs)
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            request = Request(
                url,
                headers={"User-Agent": user_agent, "Accept": "application/json, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*"},
            )
            with urlopen(request, timeout=timeout) as response:
                payload = response.read()
                content_type = response.headers.get("Content-Type", "")
                return payload, content_type, attempt
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt < attempts:
                time.sleep(delays[min(attempt - 1, len(delays) - 1)] if delays else 1)
    raise RuntimeError(f"retrieval failed after {attempts} attempts: {last_error}")


def _validate_payload(payload: bytes, connector_type: str, content_type: str) -> int:
    if not payload:
        raise ValueError("empty response")
    if connector_type in {"http_json", "http_json_paginated", "http_json_page_size"}:
        stripped = payload.lstrip()
        if stripped.startswith(b"<") or not stripped.startswith((b"{", b"[")):
            raise ValueError(f"expected JSON but received {content_type or 'unknown content type'}")
        decoded = json.loads(payload.decode("utf-8-sig"))
        if isinstance(decoded, list):
            return len(decoded)
        if isinstance(decoded, dict):
            records = decoded.get("responseData")
            return len(records) if isinstance(records, list) else 1
        raise ValueError("JSON root must be an object or array")
    if connector_type == "http_xlsx":
        if not payload.startswith(b"PK"):
            raise ValueError(f"expected XLSX ZIP signature but received {content_type or 'unknown content type'}")
        return 0
    raise ValueError(f"unsupported automatic connector: {connector_type}")


def _retrieve_paginated(
    contract: dict[str, Any],
    *,
    period: str,
    policy: dict[str, Any],
) -> tuple[bytes, str, int, int]:
    connector = contract["connector"]
    first_page = int(connector.get("firstPage", 1))
    page = first_page
    all_rows: list[dict[str, Any]] = []
    total_pages = 1
    attempts_used = 0
    while page <= total_pages:
        url = connector["endpointTemplate"].format(period=period, page=page)
        payload, content_type, attempts = _request_bytes(
            url,
            timeout=int(policy["timeoutSeconds"]),
            attempts=int(policy["maxAttempts"]),
            backoffs=policy.get("backoffSeconds", [1, 3, 9]),
            user_agent=policy["userAgent"],
        )
        _validate_payload(payload, "http_json_paginated", content_type)
        decoded = json.loads(payload.decode("utf-8-sig"))
        total_pages = int(decoded[connector["pageCountField"]])
        records = decoded.get(connector["recordsField"], [])
        if not isinstance(records, list):
            raise ValueError("paginated records field is not a list")
        all_rows.extend(records)
        attempts_used += attempts
        page += 1
    canonical = {
        "sourceId": contract["id"],
        "period": period,
        "totalPage": total_pages,
        "totalDataSize": len(all_rows),
        "responseData": all_rows,
    }
    return (
        json.dumps(canonical, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        connector["endpointTemplate"].format(period=period, page="{page}"),
        len(all_rows),
        attempts_used,
    )


def _retrieve_page_size(
    contract: dict[str, Any],
    *,
    policy: dict[str, Any],
) -> tuple[bytes, str, int, int]:
    """Retrieve a zero-based page/size API until the first short page.

    The NTPC basic endpoint is a preview.  This connector uses the documented
    ``page`` and ``size`` parameters, detects a repeated page, and fails closed
    when an official minimum row count is not met.
    """
    connector = contract["connector"]
    page = int(connector.get("firstPage", 0))
    page_size = int(connector.get("pageSize", 1000))
    max_pages = int(connector.get("maxPages", 1000))
    all_rows: list[dict[str, Any]] = []
    page_fingerprints: set[str] = set()
    attempts_used = 0
    pages_read = 0

    while pages_read < max_pages:
        url = connector["endpointTemplate"].format(page=page, size=page_size)
        payload, content_type, attempts = _request_bytes(
            url,
            timeout=int(policy["timeoutSeconds"]),
            attempts=int(policy["maxAttempts"]),
            backoffs=policy.get("backoffSeconds", [1, 3, 9]),
            user_agent=policy["userAgent"],
        )
        _validate_payload(payload, "http_json_page_size", content_type)
        decoded = json.loads(payload.decode("utf-8-sig"))
        if isinstance(decoded, list):
            records = decoded
        elif isinstance(decoded, dict):
            records = decoded.get(connector.get("recordsField", "responseData"), [])
        else:
            raise ValueError("page/size JSON root must be an object or array")
        if not isinstance(records, list):
            raise ValueError("page/size records field is not a list")

        fingerprint = sha256_bytes(
            json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        )
        if records and fingerprint in page_fingerprints:
            raise ValueError(f"page {page} repeats a previously retrieved page")
        page_fingerprints.add(fingerprint)
        all_rows.extend(records)
        attempts_used += attempts
        pages_read += 1

        if len(records) < page_size:
            break
        page += 1
    else:
        raise ValueError(f"page/size retrieval exceeded maxPages={max_pages}")

    minimum_rows = int(connector.get("expectedMinimumRows", 0))
    if len(all_rows) < minimum_rows:
        raise ValueError(
            f"retrieved {len(all_rows)} rows, below expectedMinimumRows={minimum_rows}"
        )

    canonical = {
        "sourceId": contract["id"],
        "pagination": {
            "firstPage": int(connector.get("firstPage", 0)),
            "pageSize": page_size,
            "pagesRead": pages_read,
            "stopRule": "first_page_with_row_count_less_than_page_size",
        },
        "totalDataSize": len(all_rows),
        "responseData": all_rows,
    }
    return (
        json.dumps(canonical, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        connector["endpointTemplate"].format(page="{page}", size=page_size),
        len(all_rows),
        attempts_used,
    )


def run_retrieval(
    root: Path,
    *,
    period: str,
    source_ids: set[str] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Retrieve all automatic sources and write a versioned manifest.

    Manual/OCR contracts are recorded as explicit human-review gates.  A
    failure is retained in the manifest and never silently replaced by stale
    data.
    """
    config = load_contracts(root)
    policy = config["defaultPolicy"]
    observed = (now or datetime.now(TAIPEI)).astimezone(TAIPEI)
    run_id = observed.strftime("%Y%m%dT%H%M%S%z")
    results: list[RetrievedArtifact] = []

    for contract in config["sources"]:
        source_id = contract["id"]
        if source_ids is not None and source_id not in source_ids:
            continue
        connector = contract["connector"]
        connector_type = connector["type"]
        retrieved_at = observed.isoformat()
        if connector_type == "manual_export":
            results.append(RetrievedArtifact(
                source_id, "PENDING_HUMAN_REVIEW", None, contract.get("officialPage"), retrieved_at,
                note="無穩定公開 API；須依介接契約完成人工匯出證據鏈。",
            ))
            continue
        if connector_type == "ocr_optional":
            results.append(RetrievedArtifact(
                source_id, connector.get("statusWhenUnavailable", "PENDING_HUMAN_REVIEW"), None, None, retrieved_at,
                note="OCR 僅在遇到無結構掃描檔時啟用；數值欄位需人工覆核。",
            ))
            continue

        try:
            if connector_type == "http_json_paginated":
                payload, url, row_count, attempts = _retrieve_paginated(
                    contract, period=period, policy=policy
                )
                extension = "json"
            elif connector_type == "http_json_page_size":
                payload, url, row_count, attempts = _retrieve_page_size(
                    contract, policy=policy
                )
                extension = "json"
            else:
                url = connector["endpoint"]
                payload, content_type, attempts = _request_bytes(
                    url,
                    timeout=int(policy["timeoutSeconds"]),
                    attempts=int(policy["maxAttempts"]),
                    backoffs=policy.get("backoffSeconds", [1, 3, 9]),
                    user_agent=policy["userAgent"],
                )
                row_count = _validate_payload(payload, connector_type, content_type)
                extension = "json" if connector_type == "http_json" else "xlsx"
            relative = Path("data") / "raw" / source_id / run_id / f"{source_id}.{extension}"
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            results.append(RetrievedArtifact(
                source_id, "ACQUIRED", relative.as_posix(), url, retrieved_at,
                sha256=sha256_bytes(payload), byte_count=len(payload), row_count=row_count,
                attempts=attempts,
            ))
        except Exception as exc:  # manifest the failure; caller decides whether to fail the gate
            results.append(RetrievedArtifact(
                source_id, "FAILED", None,
                connector.get("endpoint") or connector.get("endpointTemplate") or contract.get("officialPage"),
                retrieved_at,
                note=f"{type(exc).__name__}: {exc}",
            ))

    manifest = {
        "schemaVersion": "1.0.0",
        "runId": run_id,
        "retrievedAt": observed.isoformat(),
        "periodParameter": period,
        "contractVersion": config["contractVersion"],
        "failClosed": bool(policy["failClosed"]),
        "artifacts": [item.as_dict() for item in results],
    }
    manifest_dir = root / "data" / "manifests"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    versioned = manifest_dir / f"{run_id}.json"
    latest = manifest_dir / "latest.json"
    serialized = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    versioned.write_text(serialized, encoding="utf-8")
    latest.write_text(serialized, encoding="utf-8")
    return manifest


def acquired_path(root: Path, manifest: dict[str, Any], source_id: str) -> Path:
    for artifact in manifest["artifacts"]:
        if artifact["sourceId"] == source_id:
            if artifact["status"] != "ACQUIRED" or not artifact["path"]:
                raise ValueError(f"{source_id} is not ACQUIRED: {artifact['status']}")
            return root / artifact["path"]
    raise KeyError(source_id)

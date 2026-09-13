"""Build the 10912 district population baseline used by the 110 change rate.

The compact output is not added to the five-year display window.  It exists
only so that the first displayed year (110) can use the same year-over-year
formula as 111-114.
"""

from __future__ import annotations

import hashlib
import json
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "work" / "official-source-check" / "MOI_ODRP014_10912.json"
OUTPUT = ROOT / "app" / "data" / "district-population-baseline-109.json"
URL = "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/10912"
AGE_BANDS = {
    "18-24": range(18, 25),
    "25-29": range(25, 30),
    "30-35": range(30, 36),
    "18-35": range(18, 36),
}


def site_id(row: dict) -> str:
    return str(row.get("site_id") or row.get("區域別") or "")


def value(row: dict, age: int, sex: str) -> int:
    suffix = "m" if sex == "男" else "f"
    chinese_suffix = "男" if sex == "男" else "女"
    raw = row.get(f"people_age_{age:03d}_{suffix}")
    if raw is None:
        raw = row.get(f"{age}歲-{chinese_suffix}", 0)
    return int(raw or 0)


def main() -> None:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    if CACHE.exists():
        payload = json.loads(CACHE.read_text(encoding="utf-8-sig"))
    else:
        request = urllib.request.Request(URL, headers={"User-Agent": "NTPC-Youth-Evidence/1.0"})
        with urllib.request.urlopen(request, timeout=90) as response:
            payload = json.load(response)
        CACHE.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    page_rows = payload.get("responseData", [])
    ntpc_rows = [row for row in page_rows if site_id(row).startswith("新北市")]
    districts = sorted({site_id(row) for row in ntpc_rows})
    if len(page_rows) != 2000 or len(ntpc_rows) < 1000 or len(districts) != 29:
        raise ValueError(
            f"Unexpected API page composition: {len(page_rows)=}, {len(ntpc_rows)=}, {len(districts)=}"
        )

    aggregate: dict[tuple[str, str, str], int] = defaultdict(int)
    for row in ntpc_rows:
        district = site_id(row).replace("新北市", "", 1)
        for age_band, ages in AGE_BANDS.items():
            male = sum(value(row, age, "男") for age in ages)
            female = sum(value(row, age, "女") for age in ages)
            aggregate[(district, age_band, "男")] += male
            aggregate[(district, age_band, "女")] += female
            aggregate[(district, age_band, "合計")] += male + female

    records = [
        {"year": 109, "geography": district, "ageBand": age_band, "sex": sex, "population": population}
        for (district, age_band, sex), population in sorted(aggregate.items())
    ]
    if len(records) != 29 * 4 * 3:
        raise ValueError(f"Unexpected compact row count: {len(records)}")
    lookup = {(row["geography"], row["ageBand"], row["sex"]): row["population"] for row in records}
    for district in districts:
        district = district.replace("新北市", "", 1)
        for sex in ("男", "女", "合計"):
            if lookup[(district, "18-35", sex)] != sum(lookup[(district, band, sex)] for band in ("18-24", "25-29", "30-35")):
                raise ValueError(f"Age-band reconciliation failed: {district} {sex}")
        for age_band in AGE_BANDS:
            if lookup[(district, age_band, "合計")] != lookup[(district, age_band, "男")] + lookup[(district, age_band, "女")]:
                raise ValueError(f"Sex reconciliation failed: {district} {age_band}")

    output = {
        "meta": {
            "version": "DISTRICT-POPULATION-BASELINE-109-V1",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "period": "10912",
            "role": "僅供110年人口年度變化率基期，不屬於110至114年展示窗",
            "sourceName": "內政部戶政司村里戶數、單一年齡人口（新增區域代碼）",
            "sourceUrl": "https://data.gov.tw/dataset/77132",
            "apiUrl": URL,
            "sourceSha256": hashlib.sha256(CACHE.read_bytes()).hexdigest(),
            "identity": "官方行政精確值",
            "method": "109年12月底村里單一年齡人口直接加總至29行政區",
            "qa": {"districts": 29, "ageBandReconciliation": "PASS", "sexReconciliation": "PASS"},
        },
        "records": records,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "records": len(records), "districts": 29}, ensure_ascii=False))


if __name__ == "__main__":
    main()

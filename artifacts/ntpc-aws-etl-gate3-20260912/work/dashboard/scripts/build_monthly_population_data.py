"""Build the compact New Taipei monthly youth population dataset.

Official source: Ministry of the Interior household-registration open API,
ODRP014 (village households and single-age population).  The API is ordered
by county and all 1,032 New Taipei village rows are contained on page 1.  The
script still validates that fact before publishing the compact output.
"""

from __future__ import annotations

import json
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "work" / "official-source-check"
OUTPUT = ROOT / "app" / "data" / "monthly-population.json"
API_TEMPLATE = "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/{period}"
PERIODS = [f"{year}{month:02d}" for year in range(110, 115) for month in range(1, 13)]
AGE_BANDS = {
    "18-24": range(18, 25),
    "25-29": range(25, 30),
    "30-35": range(30, 36),
    "18-35": range(18, 36),
}


def cache_path(period: str) -> Path:
    existing = CACHE / f"MOI_ODRP014_{period}.json"
    return existing if existing.exists() else CACHE / f"MOI_ODRP014_{period}_p1.json"


def download(period: str) -> dict:
    path = cache_path(period)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8-sig"))
    url = API_TEMPLATE.format(period=period)
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "NTPC-Youth-Evidence/1.0"})
            with urllib.request.urlopen(request, timeout=90) as response:
                payload = json.load(response)
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            return payload
        except Exception as error:  # pragma: no cover - network retry path
            last_error = error
            time.sleep(2**attempt)
    raise RuntimeError(f"Unable to download {period}: {last_error}")


def value(row: dict, age: int, sex: str) -> int:
    suffix = "m" if sex == "男" else "f"
    chinese_suffix = "男" if sex == "男" else "女"
    raw = row.get(f"people_age_{age:03d}_{suffix}")
    if raw is None:
        raw = row.get(f"{age}歲-{chinese_suffix}", 0)
    return int(raw or 0)


def site_id(row: dict) -> str:
    """Normalize the API's English and Traditional-Chinese field-name variants."""
    return str(row.get("site_id") or row.get("區域別") or "")


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []
    qa_periods: list[dict] = []

    for period in PERIODS:
        payload = download(period)
        page_rows = payload.get("responseData", [])
        ntpc_rows = [row for row in page_rows if site_id(row).startswith("新北市")]
        districts = sorted({site_id(row) for row in ntpc_rows})
        if len(page_rows) != 2000 or len(ntpc_rows) < 1000 or len(districts) != 29:
            raise ValueError(
                f"{period}: unexpected API page composition "
                f"({len(page_rows)=}, {len(ntpc_rows)=}, {len(districts)=})"
            )

        aggregate: dict[tuple[str, str, str], int] = defaultdict(int)
        for row in ntpc_rows:
            district = site_id(row)
            for age_band, ages in AGE_BANDS.items():
                male = sum(value(row, age, "男") for age in ages)
                female = sum(value(row, age, "女") for age in ages)
                for geography in (district, "新北市"):
                    aggregate[(geography, age_band, "男")] += male
                    aggregate[(geography, age_band, "女")] += female
                    aggregate[(geography, age_band, "合計")] += male + female

        for (geography, age_band, sex), population in sorted(aggregate.items()):
            records.append(
                {
                    "period": period,
                    "year": int(period[:3]),
                    "month": int(period[3:]),
                    "geography": geography,
                    "ageBand": age_band,
                    "sex": sex,
                    "population": population,
                }
            )
        qa_periods.append(
            {
                "period": period,
                "page": 1,
                "apiRows": len(page_rows),
                "ntpcVillageRows": len(ntpc_rows),
                "districts": len(districts),
            }
        )

    lookup = {
        (row["period"], row["geography"], row["ageBand"], row["sex"]): row["population"]
        for row in records
    }
    for period in PERIODS:
        period_geographies = {row["geography"] for row in records if row["period"] == period}
        district_geographies = period_geographies - {"新北市"}
        for geography in period_geographies:
            for sex in ("合計", "男", "女"):
                total = lookup[(period, geography, "18-35", sex)]
                parts = sum(lookup[(period, geography, band, sex)] for band in ("18-24", "25-29", "30-35"))
                if total != parts:
                    raise ValueError(f"{period} {geography} {sex}: age-band reconciliation failed")
            for age_band in AGE_BANDS:
                combined = lookup[(period, geography, age_band, "合計")]
                sexes = lookup[(period, geography, age_band, "男")] + lookup[(period, geography, age_band, "女")]
                if combined != sexes:
                    raise ValueError(f"{period} {geography} {age_band}: sex reconciliation failed")
        for age_band in AGE_BANDS:
            for sex in ("合計", "男", "女"):
                city = lookup[(period, "新北市", age_band, sex)]
                districts_total = sum(lookup[(period, geography, age_band, sex)] for geography in district_geographies)
                if city != districts_total:
                    raise ValueError(f"{period} {age_band} {sex}: district reconciliation failed")

    expected_11412 = 845_938
    actual_11412 = lookup[("11412", "新北市", "18-35", "合計")]
    if actual_11412 != expected_11412:
        raise ValueError(f"11412 annual snapshot mismatch: {actual_11412} != {expected_11412}")

    output = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "sourceName": "內政部戶政司村里戶數、單一年齡人口（新增區域代碼）",
            "sourceUrl": "https://data.gov.tw/dataset/77132",
            "apiTemplate": API_TEMPLATE,
            "periods": PERIODS,
            "identity": "官方行政精確值",
            "timeBasis": "每月月底戶籍登記現住人口存量",
            "method": "逐月擷取新北市1,032個村里；單一年齡18至35歲直接加總，再彙總至29區與全市",
            "availability": "可發布",
        },
        "qa": {
            "periodChecks": qa_periods,
            "ageBandReconciliation": "PASS",
            "sexReconciliation": "PASS",
            "districtReconciliation": "PASS",
            "annualSnapshot11412": {"expected": expected_11412, "actual": actual_11412, "status": "PASS"},
        },
        "records": records,
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT} with {len(records):,} records; 11412={actual_11412:,}")


if __name__ == "__main__":
    main()

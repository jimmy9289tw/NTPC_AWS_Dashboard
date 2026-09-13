import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ntpc_youth_ai.analytics import curate_population, linear_forecast
from ntpc_youth_ai.pipeline import _retrieve_page_size, sha256_bytes


class PipelineTests(unittest.TestCase):
    def test_hash_is_stable(self):
        self.assertEqual(
            sha256_bytes(b"ntpc"),
            "240c505d68e093ac9d1d693ab1548e038fc6fddfce78b3fc431c6a7e73e60740",
        )

    def test_population_uses_single_ages_and_new_taipei_only(self):
        row = {"site_id": "新北市測試區", "people_total": "1000"}
        other = {"site_id": "臺北市測試區", "people_total": "999"}
        for age in range(0, 101):
            row[f"people_age_{age:03d}_m"] = "1"
            row[f"people_age_{age:03d}_f"] = "2"
            other[f"people_age_{age:03d}_m"] = "9"
            other[f"people_age_{age:03d}_f"] = "9"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "population.json"
            path.write_text(json.dumps({"period": "11507", "responseData": [row, other]}), encoding="utf-8")
            result = curate_population(path)
        self.assertEqual(result["coreYouth18To35"], 18 * 3)
        self.assertEqual(result["totalPopulation"], 1000)

    def test_forecast_reports_backtest(self):
        result = linear_forecast([(2020, 1.0), (2021, 2.0), (2022, 3.0), (2023, 4.0)])
        self.assertEqual(result["targetYear"], 2024)
        self.assertEqual(result["forecast"], 5.0)
        self.assertEqual(result["status"], "SCENARIO_NOT_OFFICIAL_FORECAST")

    def test_ntpc_page_size_connector_reads_every_page(self):
        contract = {
            "id": "NTPC-POP",
            "connector": {
                "endpointTemplate": "https://example.test/data?page={page}&size={size}",
                "firstPage": 0,
                "pageSize": 2,
                "maxPages": 5,
                "expectedMinimumRows": 5,
            },
        }
        policy = {
            "timeoutSeconds": 1,
            "maxAttempts": 1,
            "backoffSeconds": [],
            "userAgent": "test",
        }
        pages = [
            json.dumps([{"id": 1}, {"id": 2}]).encode(),
            json.dumps([{"id": 3}, {"id": 4}]).encode(),
            json.dumps([{"id": 5}]).encode(),
        ]
        with patch("ntpc_youth_ai.pipeline._request_bytes") as request:
            request.side_effect = [(page, "application/json", 1) for page in pages]
            payload, url, row_count, attempts = _retrieve_page_size(contract, policy=policy)
        result = json.loads(payload)
        self.assertEqual(row_count, 5)
        self.assertEqual(attempts, 3)
        self.assertEqual(result["pagination"]["pagesRead"], 3)
        self.assertEqual([row["id"] for row in result["responseData"]], [1, 2, 3, 4, 5])
        self.assertIn("page={page}", url)


if __name__ == "__main__":
    unittest.main()

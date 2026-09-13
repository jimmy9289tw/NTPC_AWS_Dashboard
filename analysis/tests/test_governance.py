import unittest

from ntpc_youth_ai.governance import (
    DefinitionProfile,
    classify_age,
    compare_definitions,
    core_youth_total,
    make_audit_record,
)


def profile(source_id: str, **overrides):
    values = {
        "source_id": source_id,
        "population": "戶籍人口",
        "geography_role": "residence",
        "age_min": 18,
        "age_max": 35,
        "time_semantics": "year-end",
        "unit": "人",
        "measure_type": "count",
        "method_version": "2026-01",
    }
    values.update(overrides)
    return DefinitionProfile(**values)


class GovernanceTests(unittest.TestCase):
    def test_age_boundaries(self):
        self.assertEqual(classify_age(18)["code"], "AGE-CORE-18-24")
        self.assertTrue(classify_age(35)["counts_as_core"])
        self.assertFalse(classify_age(36)["counts_as_core"])
        self.assertIsNone(classify_age(41))

    def test_core_total_requires_all_single_ages(self):
        values = {age: age for age in range(18, 36)}
        self.assertEqual(core_youth_total(values), sum(values.values()))
        values.pop(35)
        with self.assertRaisesRegex(ValueError, "AGE_BOUNDARY_CONFLICT"):
            core_youth_total(values)

    def test_exact_definition(self):
        result = compare_definitions(profile("A"), profile("B"))
        self.assertEqual(result["status"], "EXACT")
        self.assertFalse(result["publishBlocked"])

    def test_age_conflict_is_not_prorated(self):
        result = compare_definitions(profile("A"), profile("B", age_min=15, age_max=39))
        self.assertEqual(result["status"], "PARTIAL_OR_CONFLICT")
        self.assertTrue(result["publishBlocked"])

    def test_population_conflict_needs_human_decision(self):
        result = compare_definitions(profile("A"), profile("B", population="常住人口"))
        self.assertEqual(result["status"], "PENDING_HUMAN_DECISION")
        self.assertTrue(result["publishBlocked"])

    def test_noncritical_version_crosswalk(self):
        result = compare_definitions(
            profile("A"),
            profile("B", method_version="2025-12"),
            crosswalk_fields=("method_version",),
        )
        self.assertEqual(result["status"], "CROSSWALK_REQUIRED")

    def test_audit_hash_is_stable_for_fixed_timestamp(self):
        kwargs = {
            "event_type": "DATASET_VALIDATED",
            "actor": "test",
            "input_payload": {"b": 2, "a": 1},
            "output_payload": {"ok": True},
            "source_ids": ["B", "A", "A"],
            "observed_at": "2026-08-15T00:00:00+00:00",
        }
        first = make_audit_record(**kwargs)
        second = make_audit_record(**kwargs)
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertEqual(first["sourceIds"], ["A", "B"])


if __name__ == "__main__":
    unittest.main()

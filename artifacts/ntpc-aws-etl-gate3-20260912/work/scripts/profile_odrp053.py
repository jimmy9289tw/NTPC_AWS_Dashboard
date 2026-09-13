import csv
import json
import sys
from collections import Counter
from pathlib import Path


def main() -> int:
    source = Path(sys.argv[1])
    age_counts: Counter[str] = Counter()
    education_counts: Counter[str] = Counter()
    population_by_age: Counter[str] = Counter()
    population_25_29_by_education: Counter[str] = Counter()
    rows_total = 0
    rows_ntpc = 0

    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            # The second line repeats the headers in Chinese and is not a data row.
            if row.get("statistic_yyy") == "統計年":
                continue
            rows_total += 1
            if not row.get("site_id", "").startswith("新北市"):
                continue
            rows_ntpc += 1
            age = row["age"].strip()
            education = row["edu"].strip()
            population = int(row["population"] or 0)
            age_counts[age] += 1
            education_counts[education] += 1
            population_by_age[age] += population
            if age == "25~29歲":
                population_25_29_by_education[education] += population

    result = {
        "source": str(source),
        "rows_total": rows_total,
        "rows_ntpc": rows_ntpc,
        "age_values": sorted(age_counts),
        "education_values": sorted(education_counts),
        "population_by_age": dict(sorted(population_by_age.items())),
        "population_25_29_by_education": dict(
            sorted(population_25_29_by_education.items())
        ),
    }
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if len(sys.argv) >= 3:
        output = Path(sys.argv[2])
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

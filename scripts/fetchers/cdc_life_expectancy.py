"""CDC NCHS life expectancy at birth by state (no API key required).

CDC publishes state life expectancy as Socrata datasets, one per year.
Dataset it4f-frdc covers 2021 (most recent state-level release).

Columns: area, sex, leb (life expectancy at birth), se, quartile.
"""

from __future__ import annotations

import json

from .base import cached_get

DATASET_ID = "it4f-frdc"
YEAR = 2021


def fetch_modules(state_fips_to_name: dict[str, str]) -> list[dict]:
    wanted = set(state_fips_to_name.values())
    url = (
        f"https://data.cdc.gov/resource/{DATASET_ID}.json"
        "?sex=Total&$limit=5000"
    )
    try:
        body = cached_get(url, f"cdc_life_expectancy_{YEAR}.json")
    except Exception as e:
        print(f"  [CDC] life expectancy: {e}")
        return []
    rows = json.loads(body)

    data: dict[str, float] = {}
    for row in rows:
        state = row.get("area")
        if state not in wanted:
            continue
        try:
            data[state] = float(row["leb"])
        except (TypeError, ValueError, KeyError):
            continue

    if not data:
        return []

    return [{
        "id": "life_expectancy",
        "category": "Health",
        "label": "Life Expectancy at Birth",
        "description": (
            f"Life expectancy at birth, both sexes ({YEAR}, CDC NCHS). "
            "Higher = longer healthy lives. Encapsulates health, healthcare access, "
            "lifestyle, and environment in a single number."
        ),
        "unit": "years",
        "source": f"CDC NCHS, US State Life Expectancy by Sex {YEAR}",
        "lower_is_better": False,
        "methodology": None,
        "data": data,
    }]

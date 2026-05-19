"""Census ACS 5-year fetchers (no API key required).

Three modules: median household income, median home value, median gross rent.
"""

from __future__ import annotations

import json
import os

from .base import cached_get

# 2023 ACS 5-year (released Dec 2024) is the latest stable vintage.
YEAR = 2023

VARIABLES = {
    "median_income": {
        "var": "B19013_001E",
        "category": "Economy",
        "label": "Median Household Income",
        "description": f"Median household income, USD (ACS 5-year {YEAR}). Higher = wealthier.",
        "unit": "USD/year",
        "lower_is_better": False,
    },
    "home_value": {
        "var": "B25077_001E",
        "category": "Housing",
        "label": "Median Home Value",
        "description": f"Median value of owner-occupied homes, USD (ACS 5-year {YEAR}). Lower = cheaper to buy in.",
        "unit": "USD",
        "lower_is_better": True,
    },
    "median_rent": {
        "var": "B25064_001E",
        "category": "Housing",
        "label": "Median Gross Rent",
        "description": f"Median gross monthly rent, USD (ACS 5-year {YEAR}). Lower = cheaper.",
        "unit": "USD/month",
        "lower_is_better": True,
    },
}


def fetch_modules(state_fips_to_name: dict[str, str]) -> list[dict]:
    api_key = os.environ.get("CENSUS_API_KEY")
    if not api_key:
        print(
            "  [Census ACS] CENSUS_API_KEY not set — skipping. "
            "Free key: https://api.census.gov/data/key_signup.html"
        )
        return []

    modules = []
    for mod_id, meta in VARIABLES.items():
        url = (
            f"https://api.census.gov/data/{YEAR}/acs/acs5"
            f"?get=NAME,{meta['var']}&for=state:*&key={api_key}"
        )
        body = cached_get(url, f"census_acs_{YEAR}_{mod_id}.json")
        rows = json.loads(body)
        header = rows[0]
        val_idx = header.index(meta["var"])
        fips_idx = header.index("state")

        data: dict[str, float] = {}
        for row in rows[1:]:
            name = state_fips_to_name.get(row[fips_idx])
            if not name:
                continue
            try:
                val = float(row[val_idx])
            except (TypeError, ValueError):
                continue
            # ACS uses -666666666 et al. for "estimate not available"
            if val < 0:
                continue
            data[name] = val

        modules.append({
            "id": mod_id,
            "category": meta["category"],
            "label": meta["label"],
            "description": meta["description"],
            "unit": meta["unit"],
            "source": f"US Census Bureau — ACS 5-year {YEAR} ({meta['var']})",
            "lower_is_better": meta["lower_is_better"],
            "methodology": None,
            "data": data,
        })
    return modules

"""Census ACS 5-year fetchers (no API key required).

Three modules: median household income, median home value, median gross rent.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from .base import cached_get

ROOT = Path(__file__).resolve().parents[2]

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
    "population": {
        "var": "B01003_001E",
        "category": "Demographics",
        "label": "Population",
        "description": f"Total state population (ACS 5-year {YEAR}). Higher = bigger market, more amenities.",
        "unit": "people",
        "lower_is_better": False,
    },
    "median_age": {
        "var": "B01002_001E",
        "category": "Demographics",
        "label": "Median Age",
        "description": f"Median age in years (ACS 5-year {YEAR}). Higher = older population.",
        "unit": "years",
        "lower_is_better": False,  # neutral; users can disable
    },
}

# Land area in square miles (Census 2020 official). Used to derive density.
STATE_LAND_AREA_SQMI: dict[str, float] = {
    "Alabama": 50645, "Alaska": 570641, "Arizona": 113594, "Arkansas": 52035,
    "California": 155779, "Colorado": 103642, "Connecticut": 4842,
    "Delaware": 1949, "District of Columbia": 61, "Florida": 53625,
    "Georgia": 57513, "Hawaii": 6423, "Idaho": 82643, "Illinois": 55519,
    "Indiana": 35826, "Iowa": 55857, "Kansas": 81759, "Kentucky": 39486,
    "Louisiana": 43204, "Maine": 30843, "Maryland": 9707, "Massachusetts": 7800,
    "Michigan": 56539, "Minnesota": 79627, "Mississippi": 46923,
    "Missouri": 68742, "Montana": 145546, "Nebraska": 76824, "Nevada": 109781,
    "New Hampshire": 8953, "New Jersey": 7354, "New Mexico": 121298,
    "New York": 47126, "North Carolina": 48618, "North Dakota": 69001,
    "Ohio": 40861, "Oklahoma": 68595, "Oregon": 95988, "Pennsylvania": 44743,
    "Rhode Island": 1034, "South Carolina": 30061, "South Dakota": 75811,
    "Tennessee": 41235, "Texas": 261232, "Utah": 82170, "Vermont": 9217,
    "Virginia": 39490, "Washington": 66456, "West Virginia": 24038,
    "Wisconsin": 54158, "Wyoming": 97093,
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

    # Derived: population density (people / sq mi) from the population module.
    pop_mod = next((m for m in modules if m["id"] == "population"), None)
    if pop_mod:
        density: dict[str, float] = {}
        for state, pop in pop_mod["data"].items():
            area = STATE_LAND_AREA_SQMI.get(state)
            if area:
                density[state] = round(pop / area, 1)
        modules.append({
            "id": "population_density",
            "category": "Demographics",
            "label": "Population Density",
            "description": (
                f"People per square mile (ACS {YEAR} pop / Census 2020 land area). "
                "Lower = more rural / less crowded."
            ),
            "unit": "people/sq mi",
            "source": "US Census Bureau — ACS B01003 ÷ Census 2020 land area",
            "lower_is_better": True,
            "methodology": None,
            "data": density,
        })

    # Derived: bachelor's-degree-or-higher % among adults 25+.
    # B15003 universe = population 25 years and over (variable _001E).
    # _022E bachelor's, _023E master's, _024E professional, _025E doctorate.
    bachelors = _fetch_education_pct(api_key, state_fips_to_name)
    if bachelors:
        modules.append({
            "id": "bachelors_pct",
            "category": "Education",
            "label": "Bachelor's Degree or Higher",
            "description": (
                f"% of adults 25+ with a bachelor's degree or higher "
                f"(ACS 5-year {YEAR}). Higher = more educated populace."
            ),
            "unit": "%",
            "source": f"US Census Bureau — ACS 5-year {YEAR} (B15003)",
            "lower_is_better": False,
            "methodology": None,
            "data": bachelors,
        })

    return modules


def _fetch_education_pct(
    api_key: str,
    state_fips_to_name: dict[str, str],
) -> dict[str, float]:
    """% of adults 25+ with bachelor's degree or higher per state."""
    variables = ["B15003_001E", "B15003_022E", "B15003_023E",
                 "B15003_024E", "B15003_025E"]
    url = (
        f"https://api.census.gov/data/{YEAR}/acs/acs5"
        f"?get=NAME,{','.join(variables)}&for=state:*&key={api_key}"
    )
    try:
        body = cached_get(url, f"census_acs_{YEAR}_education.json")
    except Exception as e:
        print(f"  [Census ACS] education: {e}")
        return {}
    rows = json.loads(body)
    header = rows[0]
    state_idx = header.index("state")
    idxs = {v: header.index(v) for v in variables}

    out: dict[str, float] = {}
    for row in rows[1:]:
        name = state_fips_to_name.get(row[state_idx])
        if not name:
            continue  # Filters out Puerto Rico etc.
        try:
            denom = float(row[idxs["B15003_001E"]])
            numer = sum(float(row[idxs[v]]) for v in variables[1:])
        except (TypeError, ValueError):
            continue
        if denom <= 0:
            continue
        out[name] = round(numer / denom * 100, 1)
    return out

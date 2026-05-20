"""Census ACS at place level — per-city income, housing, rent, education.

ACS 5-year reports estimates for all places (incorporated cities + CDPs)
regardless of size; smaller places carry higher margins of error but
still represent the real point estimate.

One API call per state per variable — 51 states × small handful of
variable groups = quick.
"""

from __future__ import annotations

import json
import os

from .base import cached_get

YEAR = 2023

# State name → 2-digit FIPS (mirrors STATE_FIPS in build_modules.py).
STATE_FIPS_BY_NAME: dict[str, str] = {
    "Alabama": "01", "Alaska": "02", "Arizona": "04", "Arkansas": "05",
    "California": "06", "Colorado": "08", "Connecticut": "09",
    "Delaware": "10", "District of Columbia": "11", "Florida": "12",
    "Georgia": "13", "Hawaii": "15", "Idaho": "16", "Illinois": "17",
    "Indiana": "18", "Iowa": "19", "Kansas": "20", "Kentucky": "21",
    "Louisiana": "22", "Maine": "23", "Maryland": "24", "Massachusetts": "25",
    "Michigan": "26", "Minnesota": "27", "Mississippi": "28", "Missouri": "29",
    "Montana": "30", "Nebraska": "31", "Nevada": "32", "New Hampshire": "33",
    "New Jersey": "34", "New Mexico": "35", "New York": "36",
    "North Carolina": "37", "North Dakota": "38", "Ohio": "39",
    "Oklahoma": "40", "Oregon": "41", "Pennsylvania": "42",
    "Rhode Island": "44", "South Carolina": "45", "South Dakota": "46",
    "Tennessee": "47", "Texas": "48", "Utah": "49", "Vermont": "50",
    "Virginia": "51", "Washington": "53", "West Virginia": "54",
    "Wisconsin": "55", "Wyoming": "56",
}

# Module definition → ACS variables.
MODULES = [
    {
        "id": "median_income",
        "label": "Median Household Income",
        "description": f"Median household income (ACS 5-year {YEAR}).",
        "unit": "USD/year",
        "lower_is_better": False,
        "category": "Economy",
        "vars": ["B19013_001E"],
        "compute": lambda row, idxs: _f(row[idxs["B19013_001E"]]),
    },
    {
        "id": "home_value",
        "label": "Median Home Value",
        "description": f"Median value of owner-occupied homes (ACS 5-year {YEAR}).",
        "unit": "USD",
        "lower_is_better": True,
        "category": "Housing",
        "vars": ["B25077_001E"],
        "compute": lambda row, idxs: _f(row[idxs["B25077_001E"]]),
    },
    {
        "id": "median_rent",
        "label": "Median Gross Rent",
        "description": f"Median gross monthly rent (ACS 5-year {YEAR}).",
        "unit": "USD/month",
        "lower_is_better": True,
        "category": "Housing",
        "vars": ["B25064_001E"],
        "compute": lambda row, idxs: _f(row[idxs["B25064_001E"]]),
    },
    {
        "id": "population",
        "label": "Population",
        "description": f"Total population (ACS 5-year {YEAR}).",
        "unit": "people",
        "lower_is_better": False,
        "category": "Demographics",
        "vars": ["B01003_001E"],
        "compute": lambda row, idxs: _f(row[idxs["B01003_001E"]]),
    },
    {
        "id": "bachelors_pct",
        "label": "Bachelor's Degree or Higher",
        "description": f"% adults 25+ with bachelor's or higher (ACS 5-year {YEAR}).",
        "unit": "%",
        "lower_is_better": False,
        "category": "Education",
        "vars": ["B15003_001E", "B15003_022E", "B15003_023E", "B15003_024E", "B15003_025E"],
        "compute": lambda row, idxs: _pct(
            sum(_f_safe(row[idxs[v]]) for v in
                ("B15003_022E", "B15003_023E", "B15003_024E", "B15003_025E")),
            _f(row[idxs["B15003_001E"]]),
        ),
    },
]


def _f(s):
    try:
        v = float(s)
        return v if v >= 0 else None
    except (TypeError, ValueError):
        return None


def _f_safe(s):
    v = _f(s)
    return v if v is not None else 0


def _pct(numer, denom):
    if not denom or denom <= 0 or numer is None:
        return None
    return round(numer / denom * 100, 1)


def _parse_place_name(census_name: str) -> str:
    """'Houston city, Texas' → 'Houston'. Drops the LSAD suffix + state."""
    # Strip ", State" then strip the LSAD suffix word.
    if "," in census_name:
        place = census_name.rsplit(",", 1)[0]
    else:
        place = census_name
    # Common LSAD endings: city, town, village, borough, CDP, municipality,
    # consolidated government, urban county.
    suffixes = (
        " city", " town", " village", " borough", " CDP", " municipality",
        " consolidated government", " metropolitan government",
        " urban county", " corporation", " plantation", " comunidad",
        " zona urbana",
    )
    for suf in suffixes:
        if place.endswith(suf):
            return place[:-len(suf)].strip()
    return place.strip()


def fetch_city_modules() -> list[dict]:
    """Return list of module dicts with `data: {(state, name): value}`.

    The keyed tuple lets the build step look up city_id by (state, name).
    Cities not found in our place table are silently dropped.
    """
    api_key = os.environ.get("CENSUS_API_KEY")
    if not api_key:
        print("  [Census places] CENSUS_API_KEY not set — skipping")
        return []

    # Pre-fetch one big response per state with the union of all variables.
    all_vars = sorted({v for m in MODULES for v in m["vars"]})

    # Per (state_name, place_name) → row dict
    rows_by_place: dict[tuple[str, str], dict[str, str]] = {}
    for state_name, state_fips in STATE_FIPS_BY_NAME.items():
        url = (
            f"https://api.census.gov/data/{YEAR}/acs/acs5"
            f"?get=NAME,{','.join(all_vars)}&for=place:*&in=state:{state_fips}"
            f"&key={api_key}"
        )
        try:
            body = cached_get(url, f"census_acs_places_{state_fips}.json")
        except Exception as e:
            print(f"  [Census places] {state_name}: {e}")
            continue
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            print(f"  [Census places] {state_name}: bad JSON")
            continue
        if not data or len(data) < 2:
            continue
        header = data[0]
        idxs = {v: header.index(v) for v in all_vars}
        name_idx = header.index("NAME")
        for row in data[1:]:
            place_name = _parse_place_name(row[name_idx])
            if not place_name:
                continue
            rows_by_place[(state_name, place_name)] = {v: row[idxs[v]] for v in all_vars}

    print(f"  [Census places] {len(rows_by_place):,} city-rows pulled")

    # Now project to one module dict per logical module.
    modules = []
    for m in MODULES:
        idxs = {v: i for i, v in enumerate(m["vars"])}
        data: dict[tuple[str, str], float] = {}
        for (state, name), values in rows_by_place.items():
            row_arr = [values[v] for v in m["vars"]]
            val = m["compute"](row_arr, idxs)
            if val is None:
                continue
            data[(state, name)] = val
        modules.append({
            "id": m["id"],
            "label": m["label"],
            "description": m["description"],
            "unit": m["unit"],
            "lower_is_better": m["lower_is_better"],
            "category": m.get("category", "Other"),
            "data": data,
        })
    return modules

"""FBI Crime Data Explorer (CDE) API — state-level violent + property crime rates.

NOTE: The FBI CDE API endpoint shape has been unstable. Both
  /estimate/state/{abbr}/{from}/{to}    (singular)
  /estimate/states/{abbr}/{from}/{to}   (plural)
return 404 as of testing in 2026-05. Keeping the fetcher in place so we
can swap in a working URL when one is confirmed. Until then this module
gracefully contributes zero modules to the build.

TODO: replace with bulk download from https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/downloads
"""

from __future__ import annotations

import json
import os

from .base import cached_get

# State abbreviations (CDE uses them, not FIPS codes)
STATE_ABBR: dict[str, str] = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
    "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
    "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI",
    "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
    "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
    "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}

# FBI CDE supports historical data up to ~2 years prior.
YEAR = 2023

VIOLENT_KEYS = {"violent_crime", "homicide", "rape_legacy", "rape_revised",
                "robbery", "aggravated_assault"}
PROPERTY_KEYS = {"property_crime", "burglary", "larceny", "motor_vehicle_theft", "arson"}


def _fetch_state(abbr: str) -> dict | None:
    # api.data.gov is the gateway; DEMO_KEY works for low-volume access.
    # Note: path is /estimate/states/{abbr}/{from}/{to} (plural "states") —
    # the singular form was the older endpoint and now 404s.
    api_key = os.environ.get("USA_GOV_API_KEY", "DEMO_KEY")
    url = (
        f"https://api.usa.gov/crime/fbi/cde/estimate/states/{abbr}/{YEAR}/{YEAR}"
        f"?API_KEY={api_key}"
    )
    try:
        body = cached_get(url, f"fbi_cde_estimate_{abbr}_{YEAR}.json")
    except Exception as e:
        print(f"  FBI CDE {abbr}: {e}")
        return None
    return json.loads(body)


def fetch_modules(state_fips_to_name: dict[str, str]) -> list[dict]:
    violent: dict[str, float] = {}
    property_: dict[str, float] = {}

    for name, abbr in STATE_ABBR.items():
        if name not in state_fips_to_name.values():
            continue
        payload = _fetch_state(abbr)
        if not payload:
            continue

        # CDE returns { "results": [ {year, population, violent_crime, ...} ] }
        results = payload.get("results") or []
        if not results:
            continue
        latest = max(results, key=lambda r: r.get("year", 0))
        pop = latest.get("population")
        if not pop:
            continue

        v_total = sum(latest.get(k, 0) or 0 for k in ("violent_crime",))
        p_total = sum(latest.get(k, 0) or 0 for k in ("property_crime",))
        if v_total:
            violent[name] = round(v_total / pop * 100_000, 2)
        if p_total:
            property_[name] = round(p_total / pop * 100_000, 2)

    modules = []
    if violent:
        modules.append({
            "id": "violent_crime",
            "label": "Violent Crime",
            "description": f"Violent crime rate per 100,000 residents ({YEAR}, FBI CDE estimate).",
            "unit": "per 100k",
            "category": "Safety & Risk",
            "source": "FBI Crime Data Explorer — estimate endpoint",
            "lower_is_better": True,
            "methodology": None,
            "data": violent,
        })
    if property_:
        modules.append({
            "id": "property_crime",
            "label": "Property Crime",
            "description": f"Property crime rate per 100,000 residents ({YEAR}, FBI CDE estimate).",
            "unit": "per 100k",
            "category": "Safety & Risk",
            "source": "FBI Crime Data Explorer — estimate endpoint",
            "lower_is_better": True,
            "methodology": None,
            "data": property_,
        })
    return modules

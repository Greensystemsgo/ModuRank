"""Curated static state-level data tables.

Numbers here come from authoritative annual publications that don't
expose a clean API. To refresh, manually update from the cited source
and re-run scripts/build_modules.py.
"""

from __future__ import annotations

# FBI UCR Violent Crime Rate per 100k, 2022
# Source: FBI Crime in the United States 2022, Table 5 (state estimates).
# Florida, Maryland, and Pennsylvania did not submit complete data under
# the NIBRS transition in 2022 — we omit them rather than guess.
VIOLENT_CRIME: dict[str, float] = {
    "Alabama": 409.1,
    "Alaska": 758.9,
    "Arizona": 431.5,
    "Arkansas": 645.3,
    "California": 499.5,
    "Colorado": 423.1,
    "Connecticut": 183.8,
    "Delaware": 499.7,
    "District of Columbia": 812.3,
    # Florida: non-reporting 2022
    "Georgia": 406.7,
    "Hawaii": 254.9,
    "Idaho": 242.6,
    "Illinois": 506.2,
    "Indiana": 377.0,
    "Iowa": 285.1,
    "Kansas": 434.1,
    "Kentucky": 259.2,
    "Louisiana": 628.6,
    "Maine": 102.1,
    # Maryland: non-reporting 2022
    "Massachusetts": 308.8,
    "Michigan": 478.0,
    "Minnesota": 290.1,
    "Mississippi": 245.0,
    "Missouri": 542.7,
    "Montana": 469.8,
    "Nebraska": 300.6,
    "Nevada": 460.3,
    "New Hampshire": 146.4,
    "New Jersey": 195.4,
    "New Mexico": 780.5,
    "New York": 363.8,
    "North Carolina": 432.7,
    "North Dakota": 241.2,
    "Ohio": 308.8,
    "Oklahoma": 434.8,
    "Oregon": 358.2,
    # Pennsylvania: non-reporting 2022
    "Rhode Island": 230.8,
    "South Carolina": 491.0,
    "South Dakota": 326.9,
    "Tennessee": 621.6,
    "Texas": 432.7,
    "Utah": 239.5,
    "Vermont": 173.1,
    "Virginia": 208.0,
    "Washington": 343.8,
    "West Virginia": 270.1,
    "Wisconsin": 315.2,
    "Wyoming": 235.2,
}

# Effective Property Tax Rate (% of home value), 2023
# Source: Tax Foundation / Census ACS (median property tax paid /
# median home value, owner-occupied housing).
PROPERTY_TAX_RATE: dict[str, float] = {
    "Alabama": 0.38, "Alaska": 1.04, "Arizona": 0.45, "Arkansas": 0.53,
    "California": 0.68, "Colorado": 0.48, "Connecticut": 1.92,
    "Delaware": 0.43, "District of Columbia": 0.46, "Florida": 0.71,
    "Georgia": 0.81, "Hawaii": 0.26, "Idaho": 0.47, "Illinois": 1.83,
    "Indiana": 0.76, "Iowa": 1.33, "Kansas": 1.29, "Kentucky": 0.74,
    "Louisiana": 0.51, "Maine": 0.96, "Maryland": 0.98,
    "Massachusetts": 1.04, "Michigan": 1.24, "Minnesota": 0.98,
    "Mississippi": 0.46, "Missouri": 0.80, "Montana": 0.69,
    "Nebraska": 1.44, "Nevada": 0.44, "New Hampshire": 1.61,
    "New Jersey": 2.08, "New Mexico": 0.67, "New York": 1.60,
    "North Carolina": 0.63, "North Dakota": 0.98, "Ohio": 1.30,
    "Oklahoma": 0.77, "Oregon": 0.77, "Pennsylvania": 1.26,
    "Rhode Island": 1.23, "South Carolina": 0.46, "South Dakota": 1.01,
    "Tennessee": 0.58, "Texas": 1.47, "Utah": 0.47, "Vermont": 1.56,
    "Virginia": 0.72, "Washington": 0.76, "West Virginia": 0.55,
    "Wisconsin": 1.42, "Wyoming": 0.51,
}


def fetch_modules(state_fips_to_name: dict[str, str]) -> list[dict]:
    wanted = set(state_fips_to_name.values())
    modules = []

    vc = {k: v for k, v in VIOLENT_CRIME.items() if k in wanted}
    if vc:
        modules.append({
            "id": "violent_crime",
            "category": "Safety & Risk",
            "label": "Violent Crime Rate",
            "description": (
                "Violent crime per 100,000 residents (FBI UCR 2022). "
                "Includes homicide, rape, robbery, aggravated assault. "
                "Lower = safer. Florida, Maryland, and Pennsylvania omitted "
                "due to incomplete NIBRS reporting in 2022."
            ),
            "unit": "per 100k",
            "source": "FBI Uniform Crime Reporting Program — Crime in the United States 2022, Table 5",
            "lower_is_better": True,
            "methodology": None,
            "data": vc,
        })

    pt = {k: v for k, v in PROPERTY_TAX_RATE.items() if k in wanted}
    if pt:
        modules.append({
            "id": "property_tax",
            "category": "Cost & Taxes",
            "label": "Property Tax Rate",
            "description": (
                "Effective property tax rate as % of median home value "
                "(2023 — median property tax paid / median home value). "
                "Lower = cheaper to own."
            ),
            "unit": "%",
            "source": "Tax Foundation / US Census ACS",
            "lower_is_better": True,
            "methodology": None,
            "data": pt,
        })

    return modules

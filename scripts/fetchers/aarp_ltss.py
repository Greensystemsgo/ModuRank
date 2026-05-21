"""AARP Long-Term Services and Supports (LTSS) State Scorecard.

AARP's Public Policy Institute ranks each state 1..51 on access and
quality of long-term services and supports for older adults and adults
with physical disabilities. The composite covers affordability, access,
choice of setting/provider, quality of life/quality of care, support
for family caregivers, and effective transitions across care settings.

Source: https://ltsschoices.aarp.org/scorecard-report/2023/states
Edition: 2023 (released on ~3-year cadence; 2026 edition not yet out).
"""

from __future__ import annotations

# Overall rank from the 2023 LTSS Scorecard. 1 = best, 51 = worst.
RANK_2023: dict[str, int] = {
    "Alabama": 50, "Alaska": 26, "Arizona": 22, "Arkansas": 37,
    "California": 11, "Colorado": 5, "Connecticut": 13, "Delaware": 17,
    "District of Columbia": 3, "Florida": 43, "Georgia": 39, "Hawaii": 8,
    "Idaho": 35, "Illinois": 25, "Indiana": 27, "Iowa": 23, "Kansas": 30,
    "Kentucky": 42, "Louisiana": 45, "Maine": 16, "Maryland": 14,
    "Massachusetts": 4, "Michigan": 31, "Minnesota": 1, "Mississippi": 48,
    "Missouri": 38, "Montana": 33, "Nebraska": 18, "Nevada": 44,
    "New Hampshire": 24, "New Jersey": 10, "New Mexico": 20, "New York": 6,
    "North Carolina": 41, "North Dakota": 19, "Ohio": 32, "Oklahoma": 46,
    "Oregon": 7, "Pennsylvania": 21, "Rhode Island": 12, "South Carolina": 49,
    "South Dakota": 36, "Tennessee": 47, "Texas": 34, "Utah": 29, "Vermont": 9,
    "Virginia": 28, "Washington": 2, "West Virginia": 51, "Wisconsin": 15,
    "Wyoming": 40,
}


def fetch_modules(state_fips_to_name: dict[str, str]) -> list[dict]:
    wanted = set(state_fips_to_name.values())
    data = {st: float(v) for st, v in RANK_2023.items() if st in wanted}
    if not data:
        return []
    return [{
        "id": "disability_ltss",
        "category": "Health",
        "label": "Disability & Elder Care (AARP LTSS)",
        "description": (
            "AARP Long-Term Services and Supports State Scorecard overall "
            "rank (1 = best, 51 = worst). Composite of affordability, "
            "access, choice of setting/provider, quality of life/care, "
            "support for family caregivers, and care transitions. Covers "
            "older adults and adults with physical disabilities."
        ),
        "unit": "rank",
        "source": "AARP Public Policy Institute — LTSS State Scorecard 2023",
        "lower_is_better": True,
        "methodology": "AARP composite rank across six LTSS dimensions.",
        "data": data,
    }]

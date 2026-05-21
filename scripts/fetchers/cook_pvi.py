"""Cook Political Report Partisan Voting Index (PVI), 2025 edition.

PVI measures how each state voted in the last two presidential elections
relative to the national average. R+15 means the state voted 15 points
more Republican than the country; D+12 means 12 points more Democratic.

Source: cookpolitical.com publishes the PVI annually; we mirror the
2025 release via the canonical Wikipedia table. To refresh: re-pull from
https://en.wikipedia.org/wiki/Cook_Partisan_Voting_Index and update
PVI_2025 below.

Stored as a signed integer: D positive, R negative, EVEN = 0. There's no
intrinsic "better" direction here, so the slider has lower_is_better=False
(higher = more D by default) and the per-slider flip lets users pick.
"""

from __future__ import annotations

# Cook PVI as of the 2025 release (post-2024 cycle). Values are strings
# like "R+15"/"D+12"/"EVEN"; parser below converts to signed integers.
PVI_2025: dict[str, str] = {
    "Alabama": "R+15", "Alaska": "R+6", "Arizona": "R+2", "Arkansas": "R+15",
    "California": "D+12", "Colorado": "D+6", "Connecticut": "D+8",
    "Delaware": "D+8", "District of Columbia": "D+44", "Florida": "R+5",
    "Georgia": "R+1", "Hawaii": "D+13", "Idaho": "R+18", "Illinois": "D+6",
    "Indiana": "R+9", "Iowa": "R+6", "Kansas": "R+8", "Kentucky": "R+15",
    "Louisiana": "R+11", "Maine": "D+4", "Maryland": "D+15",
    "Massachusetts": "D+14", "Michigan": "EVEN", "Minnesota": "D+3",
    "Mississippi": "R+11", "Missouri": "R+9", "Montana": "R+10",
    "Nebraska": "R+10", "Nevada": "R+1", "New Hampshire": "D+2",
    "New Jersey": "D+4", "New Mexico": "D+4", "New York": "D+8",
    "North Carolina": "R+1", "North Dakota": "R+18", "Ohio": "R+5",
    "Oklahoma": "R+17", "Oregon": "D+8", "Pennsylvania": "R+1",
    "Rhode Island": "D+8", "South Carolina": "R+8", "South Dakota": "R+15",
    "Tennessee": "R+14", "Texas": "R+6", "Utah": "R+11", "Vermont": "D+17",
    "Virginia": "D+3", "Washington": "D+10", "West Virginia": "R+21",
    "Wisconsin": "EVEN", "Wyoming": "R+23",
}


def _parse_pvi(s: str) -> int:
    s = s.strip().upper()
    if s == "EVEN":
        return 0
    sign, _, mag = s.partition("+")
    return int(mag) if sign == "D" else -int(mag)


def fetch_modules(state_fips_to_name: dict[str, str]) -> list[dict]:
    wanted = set(state_fips_to_name.values())
    data = {st: float(_parse_pvi(v)) for st, v in PVI_2025.items() if st in wanted}
    if not data:
        return []
    return [{
        "id": "political_lean",
        "category": "Politics & Culture",
        "label": "Political Lean (Cook PVI)",
        "description": (
            "Cook Partisan Voting Index, 2025 release. Positive = state "
            "votes more Democratic than the national average; negative = "
            "more Republican; 0 = matches the country. There's no "
            "intrinsic 'better' here — flip the slider to invert the "
            "direction if you prefer redder states."
        ),
        "unit": "PVI",
        "source": "Cook Political Report PVI 2025 (via Wikipedia mirror)",
        "lower_is_better": False,
        "methodology": (
            "Signed-integer encoding of Cook PVI: 'D+N' -> +N, 'R+N' -> -N, "
            "'EVEN' -> 0. Higher normalized = bluer; user can flip per-slider."
        ),
        "data": data,
    }]

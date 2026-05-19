"""BLS Local Area Unemployment Statistics — state unemployment rate (latest month).

Uses the BLS Public Data API v2. Without a registration key the limits are
25 series per request and 25 requests per day; 50 states fit in 2 requests.
"""

from __future__ import annotations

import json

from .base import cached_post_json

# Series format: LASST{FIPS:02d}0000000000003 (state unemployment rate, SA)
SERIES_PREFIX = "LASST"
SERIES_SUFFIX = "0000000000003"


def fetch_modules(state_fips_to_name: dict[str, str]) -> list[dict]:
    series_to_state: dict[str, str] = {}
    for fips, name in state_fips_to_name.items():
        series_to_state[f"{SERIES_PREFIX}{fips}{SERIES_SUFFIX}"] = name

    ids = list(series_to_state.keys())
    chunks = [ids[i:i + 25] for i in range(0, len(ids), 25)]

    data: dict[str, float] = {}
    period_label: str | None = None
    for i, chunk in enumerate(chunks):
        body = cached_post_json(
            "https://api.bls.gov/publicAPI/v2/timeseries/data/",
            {"seriesid": chunk},
            f"bls_laus_chunk_{i}.json",
        )
        resp = json.loads(body)
        if resp.get("status") != "REQUEST_SUCCEEDED":
            raise RuntimeError(f"BLS API error: {resp.get('message') or resp}")
        for series in resp["Results"]["series"]:
            state = series_to_state.get(series["seriesID"])
            if not state or not series["data"]:
                continue
            latest = series["data"][0]
            try:
                data[state] = float(latest["value"])
            except (TypeError, ValueError):
                continue
            if period_label is None:
                period_label = f"{latest.get('periodName', '')} {latest.get('year', '')}".strip()

    return [{
        "id": "unemployment",
        "category": "Economy",
        "label": "Unemployment Rate",
        "description": (
            f"State unemployment rate, {period_label or 'latest available'} "
            "(BLS LAUS, seasonally adjusted). Lower = stronger labor market."
        ),
        "unit": "%",
        "source": "Bureau of Labor Statistics — Local Area Unemployment Statistics",
        "lower_is_better": True,
        "methodology": None,
        "data": data,
    }]

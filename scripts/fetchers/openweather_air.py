"""OpenWeatherMap Air Pollution API — PM2.5 concentration at state capitals.

Uses the historical endpoint averaged over the past 30 days for a stable
reading rather than a noisy current snapshot.

Free tier: 60 calls/min, 1M calls/month. 50 calls (one per state) is trivial.
"""

from __future__ import annotations

import json
import os
import time

from .base import cached_get
from .open_meteo import CAPITAL_COORDS

# WHO 2021 air quality guideline: annual PM2.5 < 5 µg/m³.
# US EPA standard: 9 µg/m³ (2024).


def _fetch_state(name: str, lat: float, lon: float, api_key: str) -> dict | None:
    end = int(time.time())
    start = end - 30 * 24 * 3600  # past 30 days
    url = (
        "http://api.openweathermap.org/data/2.5/air_pollution/history"
        f"?lat={lat}&lon={lon}&start={start}&end={end}&appid={api_key}"
    )
    safe = name.lower().replace(" ", "_")
    try:
        body = cached_get(url, f"openweather_air_{safe}.json")
    except Exception as e:
        print(f"  OpenWeather air {name}: {e}")
        return None
    return json.loads(body)


def fetch_modules(state_fips_to_name: dict[str, str]) -> list[dict]:
    api_key = os.environ.get("OPENWEATHER_API_KEY")
    if not api_key:
        print(
            "  [OpenWeather] OPENWEATHER_API_KEY not set — skipping. "
            "Free key: https://openweathermap.org/api"
        )
        return []

    wanted = set(state_fips_to_name.values())
    pm25: dict[str, float] = {}

    for name, (lat, lon) in CAPITAL_COORDS.items():
        if name not in wanted:
            continue
        payload = _fetch_state(name, lat, lon, api_key)
        if not payload or "list" not in payload:
            continue
        samples = [
            entry["components"]["pm2_5"]
            for entry in payload["list"]
            if entry.get("components", {}).get("pm2_5") is not None
        ]
        if samples:
            pm25[name] = round(sum(samples) / len(samples), 2)

    return [{
        "id": "air_quality_pm25",
        "label": "Air Quality (PM2.5)",
        "description": (
            "30-day average PM2.5 concentration at state capital (µg/m³). "
            "Lower = cleaner air. WHO guideline ≤ 5, US EPA standard ≤ 9."
        ),
        "unit": "µg/m³",
        "source": "OpenWeatherMap Air Pollution API (historical, capital-city proxy)",
        "lower_is_better": True,
        "methodology": None,
        "data": pm25,
    }]

"""OpenWeather Air Quality at city granularity — grid-cached.

Like open_meteo_grid: rounds cities to 0.5° cells, one API call per cell,
gives every city in that cell its air quality value. Uses the 30-day
historical-average PM2.5 already implemented in openweather_air.
"""

from __future__ import annotations

import json
import os
import time

from .base import cached_get

GRID_SIZE = 0.5


def _round_to_grid(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat / GRID_SIZE) * GRID_SIZE,
            round(lon / GRID_SIZE) * GRID_SIZE)


def _fetch_cell_pm25(lat: float, lon: float, api_key: str, cache_only: bool = False) -> float | None:
    end = int(time.time())
    start = end - 30 * 24 * 3600
    url = (
        "http://api.openweathermap.org/data/2.5/air_pollution/history"
        f"?lat={lat}&lon={lon}&start={start}&end={end}&appid={api_key}"
    )
    key = f"openweather_grid_{lat}_{lon}.json"
    try:
        body = cached_get(url, key, cache_only=cache_only)
    except Exception:
        return None
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None
    samples = [
        e["components"]["pm2_5"]
        for e in payload.get("list", [])
        if e.get("components", {}).get("pm2_5") is not None
    ]
    if not samples:
        return None
    return round(sum(samples) / len(samples), 2)


def fetch_city_air(cities: list[dict], cache_only: bool = False) -> list[dict]:
    api_key = os.environ.get("OPENWEATHER_API_KEY")
    if not api_key:
        print("  [OpenWeather grid] OPENWEATHER_API_KEY not set — skipping")
        return []

    cells: dict[tuple[float, float], list[dict]] = {}
    for c in cities:
        if c.get("latitude") is None or c.get("longitude") is None:
            continue
        cells.setdefault(_round_to_grid(c["latitude"], c["longitude"]), []).append(c)

    print(f"  [OpenWeather grid] {len(cells):,} cells for {sum(len(v) for v in cells.values()):,} cities")

    pm25: dict[tuple[str, str], float] = {}
    for i, ((lat, lon), city_list) in enumerate(cells.items()):
        if i % 200 == 0:
            print(f"    cell {i}/{len(cells)}  ({lat:+.1f}, {lon:+.1f})  -> {len(city_list)} cities")
        v = _fetch_cell_pm25(lat, lon, api_key, cache_only=cache_only)
        if v is None:
            continue
        for c in city_list:
            pm25[(c["state"], c["name"])] = v

    if not pm25:
        return []
    return [{
        "id": "air_quality_pm25",
        "label": "Air Quality (PM2.5)",
        "description": "30-day mean PM2.5 concentration. Lower = cleaner. WHO ≤5, EPA ≤9.",
        "unit": "µg/m³",
        "lower_is_better": True,
        "data": pm25,
    }]

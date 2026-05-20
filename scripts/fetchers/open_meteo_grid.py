"""Open-Meteo climate at city granularity — grid-cached.

Weather doesn't vary much within ~35 miles, so we round each city's
lat/lon to a 0.5° grid cell and fetch Open-Meteo once per unique cell.
Every city in that cell shares the cell's weather values.

~31k cities -> ~1500-2000 unique cells -> ~30 minutes for sequential
fetch the first time. Cached responses make subsequent builds instant.
"""

from __future__ import annotations

import json

from .base import cached_get

YEAR = 2024
GRID_SIZE = 0.5  # degrees


def _round_to_grid(lat: float, lon: float) -> tuple[float, float]:
    """Round lat/lon to the nearest 0.5° cell center."""
    return (round(lat / GRID_SIZE) * GRID_SIZE,
            round(lon / GRID_SIZE) * GRID_SIZE)


def _fetch_cell(lat: float, lon: float, cache_only: bool = False) -> dict | None:
    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={lat}&longitude={lon}"
        f"&start_date={YEAR}-01-01&end_date={YEAR}-12-31"
        "&daily=temperature_2m_mean,apparent_temperature_mean,"
        "sunshine_duration,precipitation_sum"
        "&hourly=relative_humidity_2m"
        "&temperature_unit=fahrenheit"
        "&precipitation_unit=inch"
        "&timezone=auto"
    )
    key = f"open_meteo_grid_{YEAR}_{lat}_{lon}.json"
    try:
        body = cached_get(url, key, cache_only=cache_only)
    except Exception:
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None


def fetch_city_climate(cities: list[dict], cache_only: bool = False) -> list[dict]:
    """Return per-city climate values for the 5 weather modules.

    Cities → grouped by grid cell → one API call per unique cell.
    """
    # Map (lat_round, lon_round) → list of cities
    cells: dict[tuple[float, float], list[dict]] = {}
    for c in cities:
        if c.get("latitude") is None or c.get("longitude") is None:
            continue
        cell = _round_to_grid(c["latitude"], c["longitude"])
        cells.setdefault(cell, []).append(c)

    print(f"  [Open-Meteo grid] {len(cells):,} unique cells for {sum(len(v) for v in cells.values()):,} cities")

    avg_temp: dict[tuple[str, str], float] = {}
    feels:    dict[tuple[str, str], float] = {}
    humid:    dict[tuple[str, str], float] = {}
    sun:      dict[tuple[str, str], float] = {}
    rain:     dict[tuple[str, str], float] = {}

    for i, ((lat, lon), city_list) in enumerate(cells.items()):
        if i % 200 == 0:
            print(f"    cell {i}/{len(cells)}  ({lat:+.1f}, {lon:+.1f})  -> {len(city_list)} cities", flush=True)
        payload = _fetch_cell(lat, lon, cache_only=cache_only)
        if not payload:
            continue
        daily = payload.get("daily") or {}
        temps = [t for t in daily.get("temperature_2m_mean", []) if t is not None]
        fls   = [t for t in daily.get("apparent_temperature_mean", []) if t is not None]
        suns  = [s for s in daily.get("sunshine_duration", []) if s is not None]
        rains = [r for r in daily.get("precipitation_sum", []) if r is not None]
        hourly = payload.get("hourly") or {}
        rhs   = [h for h in hourly.get("relative_humidity_2m", []) if h is not None]

        avg_t  = round(sum(temps) / len(temps), 1) if temps else None
        feel_t = round(sum(fls) / len(fls), 1)     if fls   else None
        rh     = round(sum(rhs)  / len(rhs), 1)    if rhs   else None
        sn     = round(sum(suns) / 3600, 0)        if suns  else None
        rn     = round(sum(rains), 1)              if rains else None

        for c in city_list:
            key = (c["state"], c["name"])
            if avg_t  is not None: avg_temp[key]  = avg_t
            if feel_t is not None: feels[key]    = feel_t
            if rh     is not None: humid[key]    = rh
            if sn     is not None: sun[key]      = sn
            if rn     is not None: rain[key]     = rn

    modules = [
        ("avg_temperature",        "Average Temperature",        "°F",         False,
         "Mean daily temperature (Open-Meteo 2024). Higher = warmer.",
         avg_temp),
        ("feels_like_temperature", "Feels-Like Temperature",     "°F",         False,
         "Mean apparent temperature combining heat + humidity + wind.",
         feels),
        ("relative_humidity",      "Relative Humidity",          "%",          True,
         "Annual mean relative humidity. Lower = drier.",
         humid),
        ("sunshine_hours",         "Sunshine Hours",             "hours/year", False,
         "Total annual sunshine hours.",
         sun),
        ("precipitation",          "Annual Precipitation",       "inches/year",True,
         "Total annual precipitation. Lower = drier.",
         rain),
    ]
    return [
        {
            "id": mid, "label": label, "description": desc,
            "unit": unit, "lower_is_better": lib, "category": "Climate", "data": data,
        }
        for (mid, label, unit, lib, desc, data) in modules if data
    ]

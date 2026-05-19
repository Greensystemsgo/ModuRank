"""Open-Meteo climate fetchers (no API key required).

We use each state's capital lat/lon as the representative point and pull
2024 daily normals from the historical archive. From that we compute:
  - average daily mean temperature (°F)
  - annual sunshine hours
  - annual precipitation (inches)

This is a rough proxy — a single point per state misses intra-state variation —
but for a "is this state warm? sunny? wet?" first cut it's fine.
"""

from __future__ import annotations

import json

from .base import cached_get

YEAR = 2024  # most recent complete year

# State capital coordinates (rounded to 2 decimals — good to ~1km).
CAPITAL_COORDS: dict[str, tuple[float, float]] = {
    "Alabama":              (32.38, -86.30),  # Montgomery
    "Alaska":               (58.30, -134.42), # Juneau
    "Arizona":              (33.45, -112.07), # Phoenix
    "Arkansas":             (34.75, -92.29),  # Little Rock
    "California":           (38.58, -121.49), # Sacramento
    "Colorado":             (39.74, -104.99), # Denver
    "Connecticut":          (41.76, -72.67),  # Hartford
    "Delaware":             (39.16, -75.52),  # Dover
    "District of Columbia": (38.91, -77.04),  # Washington
    "Florida":              (30.44, -84.28),  # Tallahassee
    "Georgia":              (33.75, -84.39),  # Atlanta
    "Hawaii":               (21.31, -157.86), # Honolulu
    "Idaho":                (43.62, -116.20), # Boise
    "Illinois":             (39.80, -89.65),  # Springfield
    "Indiana":              (39.77, -86.16),  # Indianapolis
    "Iowa":                 (41.59, -93.62),  # Des Moines
    "Kansas":               (39.05, -95.68),  # Topeka
    "Kentucky":             (38.20, -84.87),  # Frankfort
    "Louisiana":            (30.45, -91.19),  # Baton Rouge
    "Maine":                (44.31, -69.78),  # Augusta
    "Maryland":             (38.98, -76.49),  # Annapolis
    "Massachusetts":        (42.36, -71.06),  # Boston
    "Michigan":             (42.73, -84.55),  # Lansing
    "Minnesota":            (44.95, -93.10),  # Saint Paul
    "Mississippi":          (32.30, -90.18),  # Jackson
    "Missouri":             (38.58, -92.17),  # Jefferson City
    "Montana":              (46.59, -112.04), # Helena
    "Nebraska":             (40.81, -96.68),  # Lincoln
    "Nevada":               (39.16, -119.77), # Carson City
    "New Hampshire":        (43.21, -71.54),  # Concord
    "New Jersey":           (40.22, -74.77),  # Trenton
    "New Mexico":           (35.69, -105.94), # Santa Fe
    "New York":             (42.65, -73.76),  # Albany
    "North Carolina":       (35.78, -78.64),  # Raleigh
    "North Dakota":         (46.82, -100.78), # Bismarck
    "Ohio":                 (39.96, -83.00),  # Columbus
    "Oklahoma":             (35.47, -97.52),  # Oklahoma City
    "Oregon":               (44.94, -123.04), # Salem
    "Pennsylvania":         (40.27, -76.88),  # Harrisburg
    "Rhode Island":         (41.83, -71.41),  # Providence
    "South Carolina":       (34.00, -81.03),  # Columbia
    "South Dakota":         (44.37, -100.35), # Pierre
    "Tennessee":            (36.16, -86.78),  # Nashville
    "Texas":                (30.27, -97.74),  # Austin
    "Utah":                 (40.76, -111.89), # Salt Lake City
    "Vermont":              (44.26, -72.58),  # Montpelier
    "Virginia":             (37.54, -77.43),  # Richmond
    "Washington":           (47.04, -122.90), # Olympia
    "West Virginia":        (38.34, -81.63),  # Charleston
    "Wisconsin":            (43.07, -89.38),  # Madison
    "Wyoming":              (41.14, -104.82), # Cheyenne
}


def _fetch_year(name: str, lat: float, lon: float) -> dict | None:
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
    safe = name.lower().replace(" ", "_")
    try:
        body = cached_get(url, f"open_meteo_{YEAR}_{safe}.json")
    except Exception as e:
        print(f"  Open-Meteo {name}: {e}")
        return None
    return json.loads(body)


def fetch_modules(state_fips_to_name: dict[str, str]) -> list[dict]:
    wanted = set(state_fips_to_name.values())

    avg_temp:    dict[str, float] = {}
    feels_like:  dict[str, float] = {}
    rel_humid:   dict[str, float] = {}
    sunshine:    dict[str, float] = {}
    precip:      dict[str, float] = {}

    for name, (lat, lon) in CAPITAL_COORDS.items():
        if name not in wanted:
            continue
        payload = _fetch_year(name, lat, lon)
        if not payload:
            continue
        daily = payload.get("daily") or {}
        temps   = [t for t in daily.get("temperature_2m_mean", []) if t is not None]
        feels   = [t for t in daily.get("apparent_temperature_mean", []) if t is not None]
        suns    = [s for s in daily.get("sunshine_duration", []) if s is not None]
        rains   = [r for r in daily.get("precipitation_sum", []) if r is not None]
        hourly  = payload.get("hourly") or {}
        humid   = [h for h in hourly.get("relative_humidity_2m", []) if h is not None]

        if temps:  avg_temp[name]   = round(sum(temps) / len(temps), 1)
        if feels:  feels_like[name] = round(sum(feels) / len(feels), 1)
        if humid:  rel_humid[name]  = round(sum(humid) / len(humid), 1)
        if suns:   sunshine[name]   = round(sum(suns) / 3600, 0)
        if rains:  precip[name]     = round(sum(rains), 1)

    return [
        {
            "id": "avg_temperature",
            "label": "Average Temperature",
            "description": (
                f"Mean daily temperature in {YEAR} at each state capital "
                "(Open-Meteo historical archive). Higher = warmer."
            ),
            "unit": "°F",
            "source": "Open-Meteo Archive API (ERA5 reanalysis, capital city proxy)",
            "lower_is_better": False,
            "methodology": None,
            "data": avg_temp,
        },
        {
            "id": "feels_like_temperature",
            "label": "Feels-Like Temperature",
            "description": (
                f"Mean apparent (\"feels-like\") temperature in {YEAR} — "
                "combines temperature, humidity, wind, and radiation. Better "
                "comfort proxy than raw temp."
            ),
            "unit": "°F",
            "source": "Open-Meteo Archive API",
            "lower_is_better": False,
            "methodology": None,
            "data": feels_like,
        },
        {
            "id": "relative_humidity",
            "label": "Relative Humidity",
            "description": (
                f"Average relative humidity in {YEAR} (hourly mean). "
                "Lower = drier (more comfortable in hot climates)."
            ),
            "unit": "%",
            "source": "Open-Meteo Archive API",
            "lower_is_better": True,
            "methodology": None,
            "data": rel_humid,
        },
        {
            "id": "sunshine_hours",
            "label": "Sunshine Hours",
            "description": f"Total annual sunshine hours in {YEAR} at each state capital.",
            "unit": "hours/year",
            "source": "Open-Meteo Archive API",
            "lower_is_better": False,
            "methodology": None,
            "data": sunshine,
        },
        {
            "id": "precipitation",
            "label": "Annual Precipitation",
            "description": f"Total precipitation in {YEAR}. Lower = drier.",
            "unit": "inches/year",
            "source": "Open-Meteo Archive API",
            "lower_is_better": True,
            "methodology": None,
            "data": precip,
        },
    ]

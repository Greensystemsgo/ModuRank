"""Bake source data (rating.xlsx + gun_laws_by_state.csv) into a static SQLite DB.

Outputs:
  data/moduRank.sqlite   <- runtime DB, loaded by browser via sql.js
  data/modules/*.json    <- same data per-module, for human-readable git diffs
  data/manifest.json     <- list of module ids (debugging aid)

Re-run whenever source data changes:
    .venv\\Scripts\\python.exe scripts\\build_modules.py
"""

from __future__ import annotations

import csv
import json
import os
import sqlite3
import sys
import traceback
from pathlib import Path

import openpyxl


def _load_dotenv() -> None:
    """Tiny .env loader (no extra dep). Loads only if env var not already set."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


_load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
SRC = Path("C:/Users/NCorriveau/dev/scrapewiki")
DATA_DIR = ROOT / "data"
MODULES_DIR = DATA_DIR / "modules"
DB_PATH = DATA_DIR / "moduRank.sqlite"
CITIES_DB_PATH = DATA_DIR / "moduRank_cities.sqlite"

MODULES_DIR.mkdir(parents=True, exist_ok=True)

# Make scripts/fetchers/ importable.
sys.path.insert(0, str(Path(__file__).parent))
from fetchers import (  # noqa: E402
    bls_laus,
    cdc_life_expectancy,
    census_acs,
    census_acs_places,
    fbi_crime,
    geonames_cities,
    open_meteo,
    open_meteo_grid,
    openweather_air,
    openweather_grid,
    redfin,
    static_tables,
)

# State name -> 2-digit FIPS code (matches us-atlas state IDs).
STATE_FIPS: dict[str, str] = {
    "Alabama": "01", "Alaska": "02", "Arizona": "04", "Arkansas": "05",
    "California": "06", "Colorado": "08", "Connecticut": "09", "Delaware": "10",
    "District of Columbia": "11", "Florida": "12", "Georgia": "13", "Hawaii": "15",
    "Idaho": "16", "Illinois": "17", "Indiana": "18", "Iowa": "19", "Kansas": "20",
    "Kentucky": "21", "Louisiana": "22", "Maine": "23", "Maryland": "24",
    "Massachusetts": "25", "Michigan": "26", "Minnesota": "27", "Mississippi": "28",
    "Missouri": "29", "Montana": "30", "Nebraska": "31", "Nevada": "32",
    "New Hampshire": "33", "New Jersey": "34", "New Mexico": "35", "New York": "36",
    "North Carolina": "37", "North Dakota": "38", "Ohio": "39", "Oklahoma": "40",
    "Oregon": "41", "Pennsylvania": "42", "Rhode Island": "44",
    "South Carolina": "45", "South Dakota": "46", "Tennessee": "47", "Texas": "48",
    "Utah": "49", "Vermont": "50", "Virginia": "51", "Washington": "53",
    "West Virginia": "54", "Wisconsin": "55", "Wyoming": "56",
}
STATES = set(STATE_FIPS)


# ---- helpers -------------------------------------------------------------

def sheet_to_dict(ws, state_col: int, value_col: int) -> dict[str, float]:
    out: dict[str, float] = {}
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue
        if not row or row[state_col] is None:
            continue
        state = str(row[state_col]).strip()
        if state not in STATES:
            continue
        val = row[value_col]
        if val is None or val == "":
            continue
        try:
            out[state] = float(val)
        except (TypeError, ValueError):
            continue
    return out


def normalize(values: dict[str, float], lower_is_better: bool) -> dict[str, float]:
    """Min-max normalize so higher = better, always in [0, 1]."""
    if not values:
        return {}
    lo, hi = min(values.values()), max(values.values())
    spread = hi - lo or 1.0
    if lower_is_better:
        return {k: (hi - v) / spread for k, v in values.items()}
    return {k: (v - lo) / spread for k, v in values.items()}


# ---- gun module ---------------------------------------------------------

PERMISSIVE_KEYWORDS = (
    "castle doctrine", "stand your ground", "constitutional right to bear arms",
    "open carry allowed", "concealed carry on college campuses",
    "vehicle carry", "outofstate permits recognized", "state preemption",
    "minors allowed", "peaceable journey", "shall certify",
)
RESTRICTIVE_KEYWORDS = (
    "assault weapon", "assaultstyle weapon", "ghost guns banned",
    "background check required for ammunition",
    "background checks required for private",
    "duty to inform", "duty to retreat", "firearm registration",
    "high capacity magazine", "magazine capacity restriction",
    "magazine restriction", "homebuilt firearms restriction",
    "license required for concealed", "license required for open",
    "nfa weapons restricted", "title ii national firearms",
    "owner license required", "owner permit required",
    "permit required for concealed", "permit required for open",
    "purchase age restriction", "minimum age to purchase",
    "purchase quantity and frequency", "transfer quantity and frequency",
    "red flag", "semiautomatic", "state permit required to purchase",
    "storage requirement", "waiting period",
)


def build_gun_friendliness() -> dict:
    raw: dict[str, float] = {}
    with open(SRC / "gun_laws_by_state.csv", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            state = row[0]
            if state not in STATES:
                continue
            score = 0.0
            for col_name, val in zip(header[1:], row[1:]):
                if not val:
                    continue
                first = val.split("|", 1)[0].strip().lower()
                if first == "yes":
                    hit = 1.0
                elif first == "partial":
                    hit = 0.5
                else:
                    continue
                lname = col_name.lower()
                if any(k in lname for k in PERMISSIVE_KEYWORDS):
                    score += hit
                if any(k in lname for k in RESTRICTIVE_KEYWORDS):
                    score -= hit
            raw[state] = score

    lo, hi = min(raw.values()), max(raw.values())
    spread = hi - lo or 1.0
    data = {s: round((v - lo) / spread * 100, 2) for s, v in raw.items()}
    return {
        "id": "gun_friendliness",
        "label": "Gun-Owner Friendliness",
        "description": (
            "Composite of permissive vs restrictive gun laws. "
            "100 = most permissive, 0 = most restrictive."
        ),
        "unit": "score 0-100",
        "source": "Wikipedia - Gun laws in the United States by state",
        "lower_is_better": False,
        "methodology": (
            "+1 per 'Yes' in permissive law categories, -1 per 'Yes' in restrictive "
            "categories ('Partial' = 0.5). Raw scores min-max normalized to 0-100."
        ),
        "data": data,
    }


# ---- module assembly ----------------------------------------------------

def build_modules() -> list[dict]:
    wb = openpyxl.load_workbook(SRC / "rating.xlsx", data_only=True)
    return [
        {
            "id": "cost_of_living",
            "category": "Cost & Taxes",
            "label": "Cost of Living",
            "description": "Cost of living index (US average ~100). Lower = cheaper.",
            "unit": "index",
            "source": "World Population Review - Cost of Living Index by State 2025",
            "lower_is_better": True,
            "methodology": None,
            "data": sheet_to_dict(wb["CostOfLiving"], 0, 1),
        },
        {
            "id": "uv_index",
            "category": "Climate",
            "label": "UV Exposure",
            "description": "Annual UV exposure. Higher = more UV.",
            "unit": "J/m^2",
            "source": "World Population Review - UV Index by State 2025",
            "lower_is_better": False,
            "methodology": None,
            "data": sheet_to_dict(wb["UVIndex"], 0, 1),
        },
        {
            "id": "disasters",
            "category": "Safety & Risk",
            "label": "Natural Disasters",
            "description": "Average FEMA-declared disasters per year (1980-2025).",
            "unit": "disasters/year",
            "source": "FEMA disaster declarations 1980-2025",
            "lower_is_better": True,
            "methodology": None,
            "data": sheet_to_dict(wb["disasters"], 0, 3),
        },
        {
            "id": "home_insurance",
            "category": "Cost & Taxes",
            "label": "Homeowners Insurance",
            "description": "Average annual homeowners insurance premium (USD).",
            "unit": "USD/year",
            "source": "Homeowners insurance rates by state 2025",
            "lower_is_better": True,
            "methodology": None,
            "data": sheet_to_dict(wb["Homeownersinsurance"], 0, 1),
        },
        {
            "id": "public_lands",
            "category": "Outdoors",
            "label": "Public Lands",
            "description": "Percent of state area owned by federal + state government.",
            "unit": "%",
            "source": "World Population Review - Public Land by State 2025",
            "lower_is_better": False,
            "methodology": None,
            "data": sheet_to_dict(wb["PublicLands"], 0, 3),
        },
        {
            "id": "humidity",
            "category": "Climate",
            "label": "Humidity (annual avg)",
            "description": "Average relative humidity (fraction 0-1). Lower = drier.",
            "unit": "fraction",
            "source": "World Population Review - Most Humid States 2025",
            "lower_is_better": True,
            "methodology": None,
            "data": sheet_to_dict(wb["AverageHumidityDewPoint"], 0, 1),
        },
        {
            "id": "sales_tax",
            "category": "Cost & Taxes",
            "label": "Sales Tax",
            "description": "Combined state + average local sales tax rate.",
            "unit": "rate",
            "source": "Tax Foundation - State + Local Sales Tax Rates",
            "lower_is_better": True,
            "methodology": None,
            "data": sheet_to_dict(wb["salestax"], 0, 5),
        },
        {
            "id": "income_tax",
            "category": "Cost & Taxes",
            "label": "Income Tax",
            "description": "Average state income tax rate.",
            "unit": "rate",
            "source": "Tax Foundation - State income tax",
            "lower_is_better": True,
            "methodology": None,
            "data": sheet_to_dict(wb["incometax"], 0, 3),
        },
        {**build_gun_friendliness(), "category": "Politics & Culture"},
    ]


def build_api_modules() -> list[dict]:
    """Pull modules from live APIs (cached after first run)."""
    fips_to_name = {fips: name for name, fips in STATE_FIPS.items()}
    api_modules: list[dict] = []
    for label, fn in [
        ("Census ACS",    lambda: census_acs.fetch_modules(fips_to_name)),
        ("BLS LAUS",      lambda: bls_laus.fetch_modules(fips_to_name)),
        ("Open-Meteo",    lambda: open_meteo.fetch_modules(fips_to_name)),
        ("OpenWeather",   lambda: openweather_air.fetch_modules(fips_to_name)),
        ("Redfin",        lambda: redfin.fetch_modules(fips_to_name)),
        ("CDC NCHS",      lambda: cdc_life_expectancy.fetch_modules(fips_to_name)),
        ("Static tables", lambda: static_tables.fetch_modules(fips_to_name)),
        ("FBI CDE",       lambda: fbi_crime.fetch_modules(fips_to_name)),
    ]:
        try:
            mods = fn()
            for m in mods:
                print(f"  [{label}] {m['id']} ({len(m['data'])} states)")
            api_modules.extend(mods)
        except Exception:
            print(f"  [{label}] FAILED — skipping")
            traceback.print_exc()
    return api_modules


# ---- writers ------------------------------------------------------------

def write_json(modules: list[dict]) -> None:
    written: list[str] = []
    for m in modules:
        if not m.get("data"):
            # Drop any stale per-module file for an empty module so the
            # modules/ directory stays in sync with the live module set.
            path = MODULES_DIR / f"{m['id']}.json"
            if path.exists():
                path.unlink()
            continue
        path = MODULES_DIR / f"{m['id']}.json"
        path.write_text(json.dumps(m, indent=2), encoding="utf-8")
        written.append(m["id"])
    (DATA_DIR / "manifest.json").write_text(
        json.dumps({"modules": written}, indent=2),
        encoding="utf-8",
    )


def write_sqlite(modules: list[dict]) -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        cur.executescript("""
            CREATE TABLE module (
                id              TEXT PRIMARY KEY,
                category        TEXT NOT NULL DEFAULT 'Other',
                label           TEXT NOT NULL,
                description     TEXT,
                unit            TEXT,
                source          TEXT,
                methodology     TEXT,
                lower_is_better INTEGER NOT NULL
            );
            CREATE TABLE place (
                id          INTEGER PRIMARY KEY,
                kind        TEXT NOT NULL,
                state       TEXT NOT NULL,
                name        TEXT NOT NULL,
                fips        TEXT,
                latitude    REAL,
                longitude   REAL,
                population  INTEGER
            );
            CREATE UNIQUE INDEX place_unique ON place(kind, state, name);
            CREATE INDEX place_by_kind ON place(kind);
            CREATE INDEX place_by_state ON place(state);

            CREATE TABLE rating (
                module_id  TEXT NOT NULL REFERENCES module(id),
                place_id   INTEGER NOT NULL REFERENCES place(id),
                value      REAL NOT NULL,
                normalized REAL NOT NULL,
                PRIMARY KEY (module_id, place_id)
            );
            CREATE INDEX rating_by_module ON rating(module_id);
            CREATE INDEX rating_by_place  ON rating(place_id);
        """)

        # State rows (50 + DC).
        for name, fips in sorted(STATE_FIPS.items()):
            cur.execute(
                """INSERT INTO place (kind, state, name, fips, population)
                   VALUES ('state', ?, ?, ?, NULL)""",
                (name, name, fips),
            )

        # Cities are written to a separate moduRank_cities.sqlite so the
        # primary states DB stays small (instant page load); the frontend
        # lazy-loads cities only when a state is focused.

        # State-level place_id lookup for the module data insert below.
        # (City ratings come in later phases.)
        place_id = {
            row[0]: row[1]
            for row in cur.execute(
                "SELECT name, id FROM place WHERE kind = 'state'"
            )
        }

        for m in modules:
            if not m.get("data"):
                # Skip modules with zero ratings (e.g. an API failed entirely);
                # adding them would clutter the UI with a useless slider.
                continue
            cur.execute(
                """INSERT INTO module
                   (id, category, label, description, unit, source, methodology, lower_is_better)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    m["id"], m.get("category", "Other"), m["label"],
                    m["description"], m.get("unit"), m.get("source"),
                    m.get("methodology"),
                    1 if m["lower_is_better"] else 0,
                ),
            )
            norm = normalize(m["data"], m["lower_is_better"])
            for state, raw_val in m["data"].items():
                cur.execute(
                    """INSERT INTO rating (module_id, place_id, value, normalized)
                       VALUES (?, ?, ?, ?)""",
                    (m["id"], place_id[state], raw_val, norm[state]),
                )

        conn.commit()
    finally:
        conn.close()


def _normalize_city(values: dict[tuple[str, str], float], lower_is_better: bool) -> dict[tuple[str, str], float]:
    if not values:
        return {}
    arr = list(values.values())
    lo, hi = min(arr), max(arr)
    spread = hi - lo or 1.0
    if lower_is_better:
        return {k: (hi - v) / spread for k, v in values.items()}
    return {k: (v - lo) / spread for k, v in values.items()}


def write_cities_sqlite(state_modules: list[dict] | None = None) -> None:
    """Separate SQLite file containing city geometry + per-city ratings.

    Lazy-loaded by the frontend the first time the user focuses a state.
    `state_modules` is the list of state-level module dicts so we can copy
    their per-state ratings into the cities DB as the inheritance fallback.
    """
    if not os.environ.get("MODURANK_LOAD_CITIES") == "1":
        print("\nSkipping cities DB (set MODURANK_LOAD_CITIES=1 to enable)")
        return
    try:
        print("\nLoading cities from GeoNames...")
        cities = geonames_cities.fetch_cities()
        print(f"  {len(cities):,} cities from GeoNames")
    except Exception:
        print("  [WARN] geonames fetch failed")
        traceback.print_exc()
        return

    # Pull per-city ACS modules (income, rent, home value, pop, education).
    print("\nFetching per-city Census ACS modules...")
    city_modules = []
    try:
        city_modules = census_acs_places.fetch_city_modules()
        for m in city_modules:
            print(f"  [Census places] {m['id']} ({len(m['data']):,} cities)")
    except Exception:
        print("  [WARN] Census places fetch failed")
        traceback.print_exc()

    # Pull per-city climate (grid-cached Open-Meteo).
    if os.environ.get("MODURANK_LOAD_CITY_WEATHER") == "1":
        print("\nFetching per-city climate (Open-Meteo grid)...")
        try:
            climate_modules = open_meteo_grid.fetch_city_climate(cities)
            for m in climate_modules:
                print(f"  [Open-Meteo grid] {m['id']} ({len(m['data']):,} cities)")
            city_modules.extend(climate_modules)
        except Exception:
            print("  [WARN] Open-Meteo grid fetch failed")
            traceback.print_exc()
    else:
        print("\nSkipping city climate (set MODURANK_LOAD_CITY_WEATHER=1)")

    # Pull per-city air quality (grid-cached OpenWeather).
    if os.environ.get("MODURANK_LOAD_CITY_AIR") == "1":
        # cache_only=true: only use cells already on disk. Skips the slow
        # retry of cells that previously returned errors / 401s.
        cache_only = os.environ.get("MODURANK_LOAD_CITY_AIR_CACHE_ONLY") == "1"
        print(f"\nFetching per-city air quality (OpenWeather grid, cache_only={cache_only})...")
        try:
            air_modules = openweather_grid.fetch_city_air(cities, cache_only=cache_only)
            for m in air_modules:
                print(f"  [OpenWeather grid] {m['id']} ({len(m['data']):,} cities)")
            city_modules.extend(air_modules)
        except Exception:
            print("  [WARN] OpenWeather grid fetch failed")
            traceback.print_exc()
    else:
        print("\nSkipping city air quality (set MODURANK_LOAD_CITY_AIR=1)")

    if CITIES_DB_PATH.exists():
        CITIES_DB_PATH.unlink()
    conn = sqlite3.connect(CITIES_DB_PATH)
    try:
        cur = conn.cursor()
        cur.executescript("""
            CREATE TABLE city (
                id          INTEGER PRIMARY KEY,
                state       TEXT NOT NULL,
                name        TEXT NOT NULL,
                latitude    REAL NOT NULL,
                longitude   REAL NOT NULL,
                population  INTEGER
            );
            CREATE INDEX city_by_state ON city(state);
            CREATE INDEX city_by_name  ON city(name);
            CREATE UNIQUE INDEX city_unique ON city(state, name);

            CREATE TABLE module (
                id              TEXT PRIMARY KEY,
                label           TEXT NOT NULL,
                description     TEXT,
                unit            TEXT,
                lower_is_better INTEGER NOT NULL
            );
            CREATE TABLE city_rating (
                module_id  TEXT NOT NULL REFERENCES module(id),
                city_id    INTEGER NOT NULL REFERENCES city(id),
                value      REAL NOT NULL,
                normalized REAL NOT NULL,
                PRIMARY KEY (module_id, city_id)
            );
            CREATE INDEX city_rating_by_module ON city_rating(module_id);
            CREATE INDEX city_rating_by_city   ON city_rating(city_id);

            -- State-level normalized values mirrored from the states DB so
            -- city scoring can fall back when no city-level data exists.
            CREATE TABLE state_rating (
                module_id  TEXT NOT NULL,
                state      TEXT NOT NULL,
                value      REAL NOT NULL,
                normalized REAL NOT NULL,
                PRIMARY KEY (module_id, state)
            );
            CREATE INDEX state_rating_by_module ON state_rating(module_id);
        """)
        cur.executemany(
            "INSERT INTO city (state, name, latitude, longitude, population) VALUES (?, ?, ?, ?, ?)",
            [(c["state"], c["name"], c["latitude"], c["longitude"], c["population"]) for c in cities],
        )

        # Build (state, name) → city_id lookup. Census place names usually
        # match geonames exactly; mismatches are skipped silently.
        city_id_lookup = {
            (row[0], row[1]): row[2]
            for row in cur.execute("SELECT state, name, id FROM city")
        }

        for m in city_modules:
            cur.execute(
                """INSERT INTO module (id, label, description, unit, lower_is_better)
                   VALUES (?, ?, ?, ?, ?)""",
                (m["id"], m["label"], m["description"], m["unit"], 1 if m["lower_is_better"] else 0),
            )
            norm = _normalize_city(m["data"], m["lower_is_better"])
            inserted = 0
            for (state, name), raw_val in m["data"].items():
                city_id = city_id_lookup.get((state, name))
                if city_id is None:
                    continue
                cur.execute(
                    "INSERT INTO city_rating (module_id, city_id, value, normalized) VALUES (?, ?, ?, ?)",
                    (m["id"], city_id, raw_val, norm[(state, name)]),
                )
                inserted += 1
            print(f"  [city_rating] {m['id']}: {inserted:,} city rows inserted")

        # Mirror state-level modules into the cities DB so cities can inherit
        # those values when they have no city-level data of their own (taxes,
        # life expectancy, disasters, gun friendliness, climate, etc.).
        city_module_ids = {m["id"] for m in city_modules}
        for m in (state_modules or []):
            if not m.get("data"):
                continue
            # If a module also has city-level data, we still write state
            # ratings to enable fallback for cities in that state that
            # didn't have an ACS estimate.
            norm = normalize(m["data"], m["lower_is_better"])
            for state, raw_val in m["data"].items():
                cur.execute(
                    "INSERT OR REPLACE INTO state_rating (module_id, state, value, normalized) VALUES (?, ?, ?, ?)",
                    (m["id"], state, raw_val, norm[state]),
                )
            # If module wasn't already declared in cities DB module table,
            # add it now so the frontend can name it in tooltips.
            if m["id"] not in city_module_ids:
                cur.execute(
                    """INSERT OR IGNORE INTO module (id, label, description, unit, lower_is_better)
                       VALUES (?, ?, ?, ?, ?)""",
                    (m["id"], m["label"], m.get("description"), m.get("unit"),
                     1 if m["lower_is_better"] else 0),
                )
        n_state_ratings = cur.execute("SELECT COUNT(*) FROM state_rating").fetchone()[0]
        print(f"  [state_rating] {n_state_ratings:,} state rows mirrored")

        conn.commit()
        cur.execute("VACUUM")
        conn.commit()
    finally:
        conn.close()
    print(f"  {CITIES_DB_PATH.relative_to(ROOT)}  ({CITIES_DB_PATH.stat().st_size // 1024} KB)")


def main() -> None:
    print("Static-source modules:")
    modules = build_modules()
    for m in modules:
        print(f"  [static]   {m['id']} ({len(m['data'])} states)")
    print("\nAPI-sourced modules:")
    modules.extend(build_api_modules())
    # De-dup by id, last-write-wins.
    by_id: dict[str, dict] = {}
    for m in modules:
        by_id[m["id"]] = m
    modules = list(by_id.values())

    write_json(modules)
    write_sqlite(modules)
    write_cities_sqlite(state_modules=modules)
    total_ratings = sum(len(m["data"]) for m in modules)
    print(f"\nBuilt {len(modules)} modules, {total_ratings} ratings")
    print(f"  {DB_PATH.relative_to(ROOT)}  ({DB_PATH.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

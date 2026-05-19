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
import sqlite3
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
SRC = Path("C:/Users/NCorriveau/dev/scrapewiki")
DATA_DIR = ROOT / "data"
MODULES_DIR = DATA_DIR / "modules"
DB_PATH = DATA_DIR / "moduRank.sqlite"

MODULES_DIR.mkdir(parents=True, exist_ok=True)

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
            "label": "Humidity",
            "description": "Average relative humidity (fraction 0-1). Lower = drier.",
            "unit": "fraction",
            "source": "World Population Review - Most Humid States 2025",
            "lower_is_better": True,
            "methodology": None,
            "data": sheet_to_dict(wb["AverageHumidityDewPoint"], 0, 1),
        },
        {
            "id": "sales_tax",
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
            "label": "Income Tax",
            "description": "Average state income tax rate.",
            "unit": "rate",
            "source": "Tax Foundation - State income tax",
            "lower_is_better": True,
            "methodology": None,
            "data": sheet_to_dict(wb["incometax"], 0, 3),
        },
        build_gun_friendliness(),
    ]


# ---- writers ------------------------------------------------------------

def write_json(modules: list[dict]) -> None:
    for m in modules:
        path = MODULES_DIR / f"{m['id']}.json"
        path.write_text(json.dumps(m, indent=2), encoding="utf-8")
    (DATA_DIR / "manifest.json").write_text(
        json.dumps({"modules": [m["id"] for m in modules]}, indent=2),
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
                label           TEXT NOT NULL,
                description     TEXT,
                unit            TEXT,
                source          TEXT,
                methodology     TEXT,
                lower_is_better INTEGER NOT NULL
            );
            CREATE TABLE place (
                id    INTEGER PRIMARY KEY,
                kind  TEXT NOT NULL,
                state TEXT NOT NULL,
                name  TEXT NOT NULL,
                fips  TEXT
            );
            CREATE UNIQUE INDEX place_unique ON place(kind, state, name);

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

        # places: every US state + DC
        for name, fips in sorted(STATE_FIPS.items()):
            cur.execute(
                "INSERT INTO place (kind, state, name, fips) VALUES ('state', ?, ?, ?)",
                (name, name, fips),
            )

        place_id = {
            row[0]: row[1]
            for row in cur.execute(
                "SELECT name, id FROM place WHERE kind = 'state'"
            )
        }

        for m in modules:
            cur.execute(
                """INSERT INTO module
                   (id, label, description, unit, source, methodology, lower_is_better)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    m["id"], m["label"], m["description"], m.get("unit"),
                    m.get("source"), m.get("methodology"),
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


def main() -> None:
    modules = build_modules()
    write_json(modules)
    write_sqlite(modules)
    total_ratings = sum(len(m["data"]) for m in modules)
    print(f"Built {len(modules)} modules, {total_ratings} ratings")
    print(f"  {DB_PATH.relative_to(ROOT)}  ({DB_PATH.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

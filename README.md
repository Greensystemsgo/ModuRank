# ModuRank

A modular "best US state to live in" tool. Each data set is a self-contained
**module** with a weight slider — turn the dials, watch the map recolor and
the ranking reshuffle.

Static site. Zero APIs hit at runtime. Data lives in a single SQLite file
served as a static asset; the browser queries it locally with
[sql.js](https://github.com/sql-js/sql.js).

## Running locally

A local web server is required (the browser can't `fetch()` the .sqlite or
the JSON over `file://`).

```powershell
# one-time: build the venv and install Python deps
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r scripts\requirements.txt

# rebuild the data file (re-run anytime source data changes)
.venv\Scripts\python.exe scripts\build_modules.py

# serve the site
python -m http.server 8000
# open http://localhost:8000
```

## Deploying

The repo ships a GitHub Pages workflow (`.github/workflows/pages.yml`). Push
to `main`, enable Pages in repo settings → *Source: GitHub Actions*, and the
site deploys automatically.

## Adding a module

Each module is a row in the `module` table plus one `rating` row per place.
The Python build script (`scripts/build_modules.py`) is the source of truth.

To add a new state-level module:

1. Drop your source data anywhere reachable from Python.
2. In `build_modules.py`, append a new entry to `build_modules()`:
   ```python
   {
       "id": "crime_rate",
       "label": "Crime Rate",
       "description": "Violent crime per 100k residents. Lower = safer.",
       "unit": "per 100k",
       "source": "FBI UCR",
       "lower_is_better": True,
       "methodology": None,
       "data": { "Alabama": 524.3, "Alaska": 837.8, ... },
   },
   ```
3. Re-run the build:
   ```powershell
   .venv\Scripts\python.exe scripts\build_modules.py
   ```
4. Commit the regenerated `data/moduRank.sqlite` (and `data/modules/*.json`).

The UI auto-discovers modules from the DB — no frontend changes needed.

## Architecture

```
source data (xlsx/csv/API)
        │
        ▼
scripts/build_modules.py        ← run on data change
        │
        ▼
data/moduRank.sqlite            ← committed, served as a static file
data/modules/*.json             ← same data, human-readable diffs
        │
        ▼
index.html ─► js/main.js ─► sql.js ─► SQL queries in browser
        │
        ▼
US map + sliders + ranking
```

### Why SQLite, not JSON?

States data is tiny (~75 KB). But the project will grow to city-level data
(~30k US places × N metrics), at which point a single JSON blob per module
loaded on boot stops scaling. SQLite — read in-browser via sql.js — handles
millions of rows, supports range queries (`WHERE state = ? AND population >
?`), and runs the weighted-score join in SQL. Setting the data layer now
avoids a migration later.

## Project layout

```
ModuRank/
├── index.html
├── assets/style.css
├── js/
│   ├── main.js          # entry point + wiring
│   ├── data.js          # sql.js + score query
│   ├── sliders.js       # one slider per module
│   ├── map.js           # d3 + topojson choropleth
│   ├── ranking.js       # ordered list
│   └── theme.js         # dark/light toggle
├── data/
│   ├── moduRank.sqlite  # runtime data (built artifact)
│   ├── modules/*.json   # per-module mirror for diffs
│   └── manifest.json
├── scripts/
│   ├── build_modules.py
│   └── requirements.txt
└── .github/workflows/pages.yml
```

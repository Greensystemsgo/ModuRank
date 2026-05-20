"""GeoNames US bulk dump — incorporated populated places with lat/lon + population.

Single ~70MB zip download (cached). No population floor — if a place
exists in the gazetteer and is incorporated, it's in. We filter only on
feature_code to exclude farms / historic / abandoned / locality entries.

License: CC-BY 4.0. Citation: "GeoNames (geonames.org)".
"""

from __future__ import annotations

import io
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

URL = "https://download.geonames.org/export/dump/US.zip"
CACHE_ZIP = RAW_DIR / "geonames_us.zip"

# Feature codes to keep — incorporated populated places only.
# PPL=populated, PPLA*=admin seats, PPLC=capital, PPLS=settlements.
# Skipped: PPLF [farm village], PPLH [historical], PPLW [destroyed],
# PPLX [section of], PPLQ [abandoned], PPLL [locality/hamlet], STLMT.
KEEP_CODES = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5", "PPLC", "PPLS", "PPLG"}

USPS_TO_STATE = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut",
    "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida",
    "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
    "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
}

USER_AGENT = "ModuRank/0.1 (+https://github.com/Greensystemsgo/ModuRank)"


def _download_zip() -> bytes:
    if CACHE_ZIP.exists():
        return CACHE_ZIP.read_bytes()
    req = urllib.request.Request(URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read()
    CACHE_ZIP.write_bytes(body)
    return body


def fetch_cities(min_pop: int = 0) -> list[dict]:
    """Return list of {state, name, latitude, longitude, population, feature_code}.

    Default min_pop=0 means no population floor — if geonames has the place,
    we include it. Pass a higher threshold if you want to trim small entries.
    """
    zip_bytes = _download_zip()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        # Archive contains US.txt (the data) and readme.txt — we want US.txt.
        data_files = [n for n in zf.namelist() if n.upper().endswith("US.TXT")]
        if not data_files:
            data_files = [n for n in zf.namelist() if n.endswith(".txt") and "readme" not in n.lower()]
        if not data_files:
            return []
        with zf.open(data_files[0]) as fp:
            data = fp.read().decode("utf-8", errors="replace")

    # GeoNames TSV columns (no header):
    # 0 geonameid, 1 name, 2 asciiname, 3 alternatenames, 4 latitude,
    # 5 longitude, 6 feature_class, 7 feature_code, 8 country_code,
    # 9 cc2, 10 admin1_code, 11 admin2_code, 12 admin3_code, 13 admin4_code,
    # 14 population, 15 elevation, 16 dem, 17 timezone, 18 modification_date
    out: list[dict] = []
    for line in data.splitlines():
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < 17:
            continue
        if parts[6] != "P":
            continue
        if parts[7] not in KEEP_CODES:
            continue
        try:
            pop = int(parts[14] or 0)
        except ValueError:
            continue
        if pop < min_pop:
            continue
        try:
            lat = float(parts[4])
            lon = float(parts[5])
        except ValueError:
            continue
        state = USPS_TO_STATE.get(parts[10])
        if not state:
            continue
        # Elevation: prefer column 15 (explicit), else column 16 (DEM).
        elevation = None
        for col in (15, 16):
            try:
                v = int(parts[col])
                # GeoNames uses -9999 for "no data". Filter that out.
                if v > -1000:
                    elevation = v
                    break
            except (ValueError, IndexError):
                continue
        out.append({
            "name": parts[1],
            "state": state,
            "latitude": lat,
            "longitude": lon,
            "population": pop,
            "elevation_m": elevation,
            "feature_code": parts[7],
        })

    # GeoNames sometimes has duplicate entries for the same place under
    # different feature_codes. Deduplicate by (state, name) keeping the
    # one with the highest population.
    dedup: dict[tuple, dict] = {}
    for c in out:
        key = (c["state"], c["name"])
        prior = dedup.get(key)
        if prior is None or c["population"] > prior["population"]:
            dedup[key] = c
    return sorted(dedup.values(), key=lambda c: (-c["population"], c["state"], c["name"]))

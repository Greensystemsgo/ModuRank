"""Redfin Data Center — state-level housing market tracker.

Public gzipped TSV at a fixed S3 URL. No auth, no rate limit.

We pull median sale price and median days on market for the most recent
monthly period available.
"""

from __future__ import annotations

import csv
import gzip
import io
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

URL = (
    "https://redfin-public-data.s3.us-west-2.amazonaws.com/"
    "redfin_market_tracker/state_market_tracker.tsv000.gz"
)
CACHE_NAME = "redfin_state_market_tracker.tsv"

USER_AGENT = "ModuRank/0.1 (+https://github.com/Greensystemsgo/ModuRank)"


def _download(refresh: bool = False) -> str:
    cache_path = RAW_DIR / CACHE_NAME
    if cache_path.exists() and not refresh:
        return cache_path.read_text(encoding="utf-8")
    req = urllib.request.Request(URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        gz_bytes = resp.read()
    tsv_bytes = gzip.decompress(gz_bytes)
    text = tsv_bytes.decode("utf-8", errors="replace")
    cache_path.write_text(text, encoding="utf-8")
    return text


def fetch_modules(state_fips_to_name: dict[str, str]) -> list[dict]:
    wanted = set(state_fips_to_name.values())
    text = _download()

    reader = csv.DictReader(io.StringIO(text), delimiter="\t")

    # Column names in the Redfin file are UPPERCASE + double-quoted.
    # csv.DictReader keeps the quotes, so we re-key once below.
    def _clean(row: dict) -> dict:
        return {k.strip('"').lower(): (v.strip('"') if isinstance(v, str) else v)
                for k, v in row.items() if k}

    by_period: dict[str, dict[str, dict]] = {}
    for raw_row in reader:
        row = _clean(raw_row)
        if row.get("region_type") != "state":
            continue
        if row.get("property_type") and row["property_type"] != "All Residential":
            continue
        period = row.get("period_end") or row.get("period_begin")
        state = row.get("state") or row.get("region")
        if not period or state not in wanted:
            continue
        by_period.setdefault(period, {})[state] = row

    if not by_period:
        return []

    latest = max(by_period.keys(), key=lambda p: (len(by_period[p]), p))
    snapshot = by_period[latest]

    median_price:  dict[str, float] = {}
    days_on_market: dict[str, float] = {}
    price_per_sqft: dict[str, float] = {}
    inventory:     dict[str, float] = {}

    for state, row in snapshot.items():
        try:
            price = float(row.get("median_sale_price") or "")
            if price > 0:
                median_price[state] = price
        except ValueError:
            pass
        for k in ("median_days_on_market", "median_dom"):
            try:
                dom = float(row.get(k) or "")
                if dom > 0:
                    days_on_market[state] = dom
                    break
            except ValueError:
                continue
        try:
            ppsf = float(row.get("median_ppsf") or "")
            if ppsf > 0:
                price_per_sqft[state] = ppsf
        except ValueError:
            pass
        try:
            inv = float(row.get("inventory") or "")
            if inv > 0:
                inventory[state] = inv
        except ValueError:
            pass

    period_label = latest

    modules = []
    if median_price:
        modules.append({
            "id": "median_sale_price",
            "label": "Median Home Sale Price",
            "description": (
                f"Median home sale price (Redfin, period ending {period_label}). "
                "Lower = cheaper market."
            ),
            "unit": "USD",
            "category": "Housing",
            "source": "Redfin Data Center — State Market Tracker",
            "lower_is_better": True,
            "methodology": None,
            "data": median_price,
        })
    if days_on_market:
        modules.append({
            "id": "days_on_market",
            "label": "Days on Market",
            "description": (
                f"Median days a home spends on market before sale "
                f"(Redfin, period ending {period_label}). "
                "Higher = slower market (more buyer leverage)."
            ),
            "unit": "days",
            "category": "Housing",
            "source": "Redfin Data Center — State Market Tracker",
            "lower_is_better": False,
            "methodology": None,
            "data": days_on_market,
        })
    if price_per_sqft:
        modules.append({
            "id": "price_per_sqft",
            "label": "Price per Square Foot",
            "description": (
                f"Median price per square foot of homes sold "
                f"(Redfin, period ending {period_label}). "
                "Lower = more house for the money."
            ),
            "unit": "USD/sqft",
            "category": "Housing",
            "source": "Redfin Data Center — State Market Tracker",
            "lower_is_better": True,
            "methodology": None,
            "data": price_per_sqft,
        })
    if inventory:
        modules.append({
            "id": "housing_inventory",
            "label": "Housing Inventory",
            "description": (
                f"Number of homes for sale "
                f"(Redfin, period ending {period_label}). "
                "Higher = more selection for buyers."
            ),
            "unit": "homes",
            "category": "Housing",
            "source": "Redfin Data Center — State Market Tracker",
            "lower_is_better": False,
            "methodology": None,
            "data": inventory,
        })
    return modules

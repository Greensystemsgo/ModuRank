"""Shared HTTP helpers for fetchers.

Every fetcher caches its raw response under data/raw/ so subsequent builds
don't re-hit the API. Raw responses are committed to the repo for full
reproducibility offline.
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

USER_AGENT = "ModuRank/0.1 (+https://github.com/Greensystemsgo/ModuRank)"


def cached_get(url: str, cache_name: str, *, refresh: bool = False) -> str:
    cache_path = RAW_DIR / cache_name
    if cache_path.exists() and not refresh:
        return cache_path.read_text(encoding="utf-8")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
    cache_path.write_text(body, encoding="utf-8")
    return body


def cached_post_json(
    url: str,
    payload: dict,
    cache_name: str,
    *,
    refresh: bool = False,
) -> str:
    cache_path = RAW_DIR / cache_name
    if cache_path.exists() and not refresh:
        return cache_path.read_text(encoding="utf-8")
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
    cache_path.write_text(body, encoding="utf-8")
    return body

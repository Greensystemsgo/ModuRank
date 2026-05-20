# ModuRank — common dev/build/diagnostics targets.
#
# Defaults assume a project-local venv at .venv (see README). Override on the
# CLI if your layout differs: `make build PY=python` etc.

PY      ?= .venv/Scripts/python.exe
PORT    ?= 8000
STATE   ?= Arizona

.PHONY: help setup venv install build build-states up serve wins ranking \
        ranking-capped profile city-ranking correlation smoke clean

help:
	@echo "Routine:"
	@echo "make setup            - one-time: create venv + install deps"
	@echo "make build            - rebuild ALL data (states + cities + climate + air, from cache)"
	@echo "make up               - serve the static site on http://localhost:$(PORT)"
	@echo "make smoke            - run every read-only diagnostic against the production DB"
	@echo ""
	@echo "Less-common:"
	@echo "make build-states     - rebuild only data/moduRank.sqlite (skip cities)"
	@echo "make serve            - alias for 'make up'"
	@echo ""
	@echo "Diagnostics:"
	@echo "make wins             - per-module #1 finishes by state"
	@echo "make ranking          - flat equal-weight ranking (no capping)"
	@echo "make ranking-capped   - category-capped ranking (production scoring path)"
	@echo "make profile STATE=Arizona      - per-module rank/value profile for one state"
	@echo "make city-ranking STATE=Pennsylvania - city ranking smoke test for one state"
	@echo "make correlation      - multicollinear module pairs (|r|>=0.7)"

setup: venv install

venv:
	python -m venv .venv

install:
	$(PY) -m pip install -r scripts/requirements.txt

# Default build: states + cities + per-city climate + per-city air, all from
# the local fetcher cache. No network calls required as long as
# scripts/fetchers/.cache is present. This is the build the deployed site
# expects.
build:
	MODURANK_LOAD_CITIES=1 \
	MODURANK_LOAD_CITY_WEATHER=1 \
	MODURANK_LOAD_CITY_WEATHER_CACHE_ONLY=1 \
	MODURANK_LOAD_CITY_AIR=1 \
	MODURANK_LOAD_CITY_AIR_CACHE_ONLY=1 \
	$(PY) scripts/build_modules.py

build-states:
	$(PY) scripts/build_modules.py

# `make up` is the routine dev server; `serve` is the older name kept for
# compatibility with anything that might already reference it.
up: serve

serve:
	$(PY) -m http.server $(PORT)

wins:
	@$(PY) scripts/diagnostics.py wins

ranking:
	@$(PY) scripts/diagnostics.py ranking

ranking-capped:
	@$(PY) scripts/diagnostics.py ranking-capped

profile:
	@$(PY) scripts/diagnostics.py profile "$(STATE)"

city-ranking:
	@$(PY) scripts/diagnostics.py city-ranking "$(STATE)"

correlation:
	@$(PY) scripts/diagnostics.py correlation

# Read-only end-to-end check: runs every diagnostic against the production
# DB. If this is green the SQL the frontend executes is also green.
smoke:
	@echo "== ranking-capped =="
	@$(PY) scripts/diagnostics.py ranking-capped | head -10
	@echo ""
	@echo "== profile Arizona =="
	@$(PY) scripts/diagnostics.py profile "Arizona" | head -20
	@echo ""
	@echo "== city-ranking Pennsylvania =="
	@$(PY) scripts/diagnostics.py city-ranking "Pennsylvania"

clean:
	rm -f data/moduRank.sqlite data/moduRank_cities.sqlite data/cities_index.sqlite
	rm -rf data/cities

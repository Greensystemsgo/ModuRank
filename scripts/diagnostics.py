"""Diagnostics for the ModuRank state/cities databases.

Each subcommand exercises the same SQL that the JS frontend runs, so failures
here also catch frontend regressions before they ship. Invoke via the
Makefile — `make wins`, `make ranking`, `make ranking-capped`,
`make profile STATE=Arizona`, `make city-ranking STATE=Pennsylvania`,
`make correlation`.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "moduRank.sqlite"
CITIES_DIR = ROOT / "data" / "cities"


def _connect() -> sqlite3.Connection:
    if not DB.exists():
        sys.exit(f"missing {DB} — run `make build` first")
    return sqlite3.connect(DB)


def _state_slug(state: str) -> str:
    return state.lower().replace(" ", "_")


def cmd_wins(_args: argparse.Namespace) -> None:
    """Tally per-module #1 finishes by state (highest normalized = winner)."""
    con = _connect()
    cur = con.cursor()
    cur.execute("SELECT id, label, lower_is_better FROM module ORDER BY id")
    mods = cur.fetchall()

    wins: dict[str, list[tuple[str, float, float]]] = {}
    for mid, label, _lib in mods:
        cur.execute(
            """
            SELECT p.state, r.value, r.normalized
            FROM rating r JOIN place p ON p.id = r.place_id
            WHERE r.module_id = ? AND p.kind = 'state' AND r.normalized IS NOT NULL
            ORDER BY r.normalized DESC LIMIT 1
            """,
            (mid,),
        )
        row = cur.fetchone()
        if row:
            wins.setdefault(row[0], []).append((label, row[1], row[2]))

    print(f"{len(mods)} modules. Per-module #1 finishes by state:\n")
    for state in sorted(wins, key=lambda s: -len(wins[s])):
        print(f"  {state}: {len(wins[state])} wins")
        for lbl, v, n in wins[state]:
            print(f"     - {lbl}: value={v}, norm={n:.3f}")


def cmd_ranking(_args: argparse.Namespace) -> None:
    """Plain equal-weight ranking (each module averaged directly — pre-capping)."""
    con = _connect()
    cur = con.cursor()
    cur.execute(
        """
        SELECT p.state, AVG(r.normalized) AS score, COUNT(*) AS n
        FROM rating r JOIN place p ON p.id = r.place_id
        WHERE p.kind = 'state' AND r.normalized IS NOT NULL
        GROUP BY p.state
        ORDER BY score DESC
        """
    )
    print("Flat equal-weight ranking (no category capping):\n")
    for state, score, n in cur.fetchall():
        print(f"  {state:25s}  score={score:.4f}  n_factors={n}")


def cmd_ranking_capped(_args: argparse.Namespace) -> None:
    """Category-capped ranking — mirrors computeRanking() in js/data.js exactly.

    Two-level aggregation: weighted average inside each category, then plain
    average across active categories. This is the production scoring path.
    """
    con = _connect()
    cur = con.cursor()
    weights = json.dumps({mid: 50 for (mid,) in cur.execute("SELECT id FROM module")})
    sql = """
        WITH w AS (
          SELECT key AS module_id, ABS(CAST(value AS REAL)) AS weight,
                 CASE WHEN CAST(value AS REAL) < 0 THEN 1 ELSE 0 END AS flipped
          FROM json_each(?)
        ),
        mw AS (
          SELECT r.place_id, m.category, w.weight,
                 CASE WHEN w.flipped = 1 THEN 1.0 - r.normalized ELSE r.normalized END AS norm
          FROM rating r JOIN w ON w.module_id = r.module_id
          JOIN module m ON m.id = r.module_id
          WHERE r.normalized IS NOT NULL
        ),
        per_cat AS (
          SELECT place_id, category,
                 SUM(norm * weight) / SUM(weight) AS cat_score,
                 COUNT(*) AS n_in_cat
          FROM mw GROUP BY place_id, category
        ),
        agg AS (
          SELECT place_id, AVG(cat_score) AS score, SUM(n_in_cat) AS factors
          FROM per_cat GROUP BY place_id
        )
        SELECT p.name, COALESCE(a.score, 0) AS score, COALESCE(a.factors, 0) AS factors
        FROM place p LEFT JOIN agg a ON a.place_id = p.id
        WHERE p.kind = 'state'
        ORDER BY score DESC, p.name ASC
    """
    print("Category-capped ranking (equal weights — production scoring path):\n")
    for name, score, factors in cur.execute(sql, (weights,)):
        print(f"  {name:25s}  score={score:.4f}  n_factors={factors}")


def cmd_profile(args: argparse.Namespace) -> None:
    """State profile — every module with rank+value+category. Mirrors
    getStateProfile() in js/data.js (same SQL, same bucketing)."""
    con = _connect()
    cur = con.cursor()
    state = args.state
    sql = """
        WITH ranked AS (
          SELECT r.module_id, p.id AS place_id, p.name AS state, r.value, r.normalized,
                 DENSE_RANK() OVER (PARTITION BY r.module_id ORDER BY r.normalized DESC) AS rnk,
                 COUNT(*) OVER (PARTITION BY r.module_id) AS total
          FROM rating r JOIN place p ON p.id = r.place_id
          WHERE p.kind = 'state' AND r.normalized IS NOT NULL
        )
        SELECT m.id, m.category, m.label, m.unit, r.value, r.normalized, r.rnk, r.total
        FROM module m JOIN ranked r ON r.module_id = m.id
        WHERE r.state = ? ORDER BY m.category, m.label
    """
    rows = list(cur.execute(sql, (state,)))
    if not rows:
        sys.exit(f"no data for state {state!r}")
    print(f"{state} — every module by category (rank/total, value):\n")
    last_cat = None
    for _, cat, label, unit, val, _norm, rnk, total in rows:
        if cat != last_cat:
            print(f"\n  [{cat}]")
            last_cat = cat
        flag = "  TOP" if rnk <= 5 else (" BOT" if (total - rnk + 1) <= 5 else "")
        unit_s = f" {unit}" if unit else ""
        print(f"    {label:32s} #{rnk:>3}/{total:<3}  v={val!s:>10s}{unit_s}{flag}")


def cmd_city_ranking(args: argparse.Namespace) -> None:
    """City ranking smoke test — mirrors computeCityRanking() in js/data.js.

    Loads the per-state shard for STATE and ranks its cities with a small
    sample weight set so we can verify the new category-capped SQL runs
    cleanly against the per-state DB schema.
    """
    state = args.state
    shard = CITIES_DIR / f"{_state_slug(state)}.sqlite"
    if not shard.exists():
        sys.exit(f"missing {shard} — run `make build` first")
    con = sqlite3.connect(shard)
    cur = con.cursor()
    # Pick three modules that should always exist: cost_of_living (state),
    # median_income (city), avg_temperature (city). All weight 50.
    weights = json.dumps({"cost_of_living": 50, "median_income": 50, "avg_temperature": 50})
    sql = """
        WITH w AS (
          SELECT key AS module_id, ABS(CAST(value AS REAL)) AS weight,
                 CASE WHEN CAST(value AS REAL) < 0 THEN 1 ELSE 0 END AS flipped
          FROM json_each(?)
        ),
        city_x_w AS (
          SELECT c.id AS city_id, w.module_id, w.weight, w.flipped, m.category,
                 COALESCE(cr.normalized, sr.normalized) AS normalized,
                 CASE WHEN cr.normalized IS NOT NULL THEN 1 ELSE 0 END AS is_city_level
          FROM city c CROSS JOIN w
          JOIN module m ON m.id = w.module_id
          LEFT JOIN city_rating cr ON cr.city_id = c.id AND cr.module_id = w.module_id
          LEFT JOIN state_rating sr ON sr.state = c.state AND sr.module_id = w.module_id
          WHERE c.state = ?
        ),
        per_cat AS (
          SELECT city_id, category,
                 SUM((CASE WHEN flipped = 1 THEN 1.0 - normalized ELSE normalized END) * weight)
                   / SUM(weight) AS cat_score,
                 COUNT(*) AS n, SUM(is_city_level) AS city_in_cat
          FROM city_x_w WHERE normalized IS NOT NULL GROUP BY city_id, category
        ),
        agg AS (
          SELECT city_id, AVG(cat_score) AS score, SUM(n) AS factors, SUM(city_in_cat) AS city_factors
          FROM per_cat GROUP BY city_id
        )
        SELECT c.name, a.score, a.factors, a.city_factors
        FROM city c LEFT JOIN agg a ON a.city_id = c.id
        WHERE c.state = ? AND a.score IS NOT NULL
        ORDER BY a.score DESC LIMIT 10
    """
    rows = list(cur.execute(sql, (weights, state, state)))
    if not rows:
        sys.exit(f"no scored cities in {state}")
    print(f"{state} — top 10 cities (3-module sample: cost_of_living + median_income + avg_temperature):\n")
    for name, score, factors, city_factors in rows:
        print(f"  {name:32s}  score={score:.4f}  n={factors}  city_lvl={city_factors}")


def cmd_correlation(_args: argparse.Namespace) -> None:
    """Pearson correlation between every pair of modules' normalized scores.

    Useful for hunting multicollinearity — flags pairs |r|>=0.7."""
    try:
        import numpy as np
    except ImportError:  # pragma: no cover
        sys.exit("numpy required for `correlation` — install via the project venv")

    con = _connect()
    cur = con.cursor()
    cur.execute("SELECT id, label FROM module ORDER BY id")
    mods = cur.fetchall()
    cur.execute("SELECT DISTINCT name FROM place WHERE kind='state' ORDER BY name")
    states = [r[0] for r in cur.fetchall()]
    idx = {s: i for i, s in enumerate(states)}

    M = np.full((len(mods), len(states)), np.nan)
    labels: list[str] = []
    for mi, (mid, label) in enumerate(mods):
        labels.append(label)
        cur.execute(
            """
            SELECT p.state, r.normalized FROM rating r
            JOIN place p ON p.id = r.place_id
            WHERE p.kind='state' AND r.module_id=?
            """,
            (mid,),
        )
        for state, norm in cur.fetchall():
            if norm is not None and state in idx:
                M[mi, idx[state]] = norm

    pairs: list[tuple[float, str, str]] = []
    for i in range(len(mods)):
        for j in range(i + 1, len(mods)):
            mask = ~(np.isnan(M[i]) | np.isnan(M[j]))
            if mask.sum() < 5:
                continue
            r = float(np.corrcoef(M[i, mask], M[j, mask])[0, 1])
            pairs.append((r, labels[i], labels[j]))

    pairs.sort(key=lambda x: -abs(x[0]))
    print("Highly correlated module pairs (|r| >= 0.7):\n")
    shown = 0
    for r, a, b in pairs:
        if abs(r) < 0.7:
            break
        sign = "+" if r > 0 else "-"
        print(f"  {sign} r={abs(r):.3f}   {a:30s}  <->  {b}")
        shown += 1
    if shown == 0:
        print("  (none above the threshold)")
    print(f"\n({len(pairs)} pairs evaluated total)")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("wins", help="per-module #1 finishes by state").set_defaults(func=cmd_wins)
    sub.add_parser("ranking", help="flat equal-weight ranking (no capping)").set_defaults(func=cmd_ranking)
    sub.add_parser("ranking-capped", help="category-capped ranking (production path)").set_defaults(func=cmd_ranking_capped)
    pp = sub.add_parser("profile", help="every-module breakdown for one state")
    pp.add_argument("state", help='e.g. "Arizona", "New York"')
    pp.set_defaults(func=cmd_profile)
    cr = sub.add_parser("city-ranking", help="city ranking smoke test for a state")
    cr.add_argument("state", help='e.g. "Pennsylvania"')
    cr.set_defaults(func=cmd_city_ranking)
    sub.add_parser("correlation", help="find multicollinear module pairs").set_defaults(func=cmd_correlation)
    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

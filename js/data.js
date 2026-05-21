// SQLite data layer. One DB load on boot; everything queries against it.

let _SQL = null;

export async function loadDatabase({ sqlJsLocate, dbUrl }) {
  _SQL = await window.initSqlJs({ locateFile: sqlJsLocate });
  const buf = await fetch(dbUrl).then((r) => {
    if (!r.ok) throw new Error(`fetch ${dbUrl}: HTTP ${r.status}`);
    return r.arrayBuffer();
  });
  return new _SQL.Database(new Uint8Array(buf));
}

// Cities are now sharded: one lightweight master index for search, plus
// one self-contained per-state DB for ranking when a state is focused.

let _indexDbPromise = null;
export function loadCitiesIndex(url) {
  if (_indexDbPromise) return _indexDbPromise;
  _indexDbPromise = (async () => {
    if (!_SQL) throw new Error("sql.js not initialized yet");
    const buf = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`fetch ${url}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    return new _SQL.Database(new Uint8Array(buf));
  })();
  return _indexDbPromise;
}

const _stateDbPromises = new Map();
export function loadStateCitiesDb(stateSlug, baseUrl) {
  if (_stateDbPromises.has(stateSlug)) return _stateDbPromises.get(stateSlug);
  const url = `${baseUrl}/${stateSlug}.sqlite`;
  const p = (async () => {
    if (!_SQL) throw new Error("sql.js not initialized yet");
    const buf = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`fetch ${url}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    return new _SQL.Database(new Uint8Array(buf));
  })();
  _stateDbPromises.set(stateSlug, p);
  return p;
}

// Backwards-compat alias for the old single-DB API.
export const loadCitiesDatabase = loadCitiesIndex;

export function getCitiesInState(citiesDb, stateName) {
  // Works against either the index DB (filters by state) or a per-state
  // DB (state filter is a no-op since all rows match).
  const stmt = citiesDb.prepare(
    "SELECT id, name, latitude, longitude, population, elevation_m FROM city WHERE state = :state ORDER BY population DESC"
  );
  stmt.bind({ ":state": stateName });
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

// Compute per-city weighted score for all cities in a given state.
// For each (city, module) where we have city-level data, use that.
// Otherwise fall back to the city's STATE-level normalized value (which
// every city in that state shares). This way every city has a score for
// every active module — taxes, gun friendliness, disasters, etc. all
// contribute even when only state-level data exists.
export function computeCityRanking(citiesDb, weights, stateName, mode = "capped") {
  const active = weights.filter((w) => w.weight > 0);
  if (active.length === 0) {
    return getCitiesInState(citiesDb, stateName).map((c) => ({
      id: c.id, name: c.name, latitude: c.latitude, longitude: c.longitude,
      population: c.population, score: null, factors: 0,
    }));
  }

  const weightJson = JSON.stringify(
    Object.fromEntries(active.map((w) => [w.id, (w.flipped ? -1 : 1) * w.weight])),
  );

  // See computeRanking() for `mode` semantics. City scoring uses the same
  // two paths so a state-similarity preset propagates into city ranking.
  const sql = mode === "flat" ? `
    WITH w AS (
      SELECT key AS module_id,
             ABS(CAST(value AS REAL)) AS weight,
             CASE WHEN CAST(value AS REAL) < 0 THEN 1 ELSE 0 END AS flipped
      FROM json_each(:weights)
    ),
    city_x_w AS (
      SELECT c.id AS city_id, w.module_id, w.weight, w.flipped,
             COALESCE(cr.normalized, sr.normalized) AS normalized,
             CASE WHEN cr.normalized IS NOT NULL THEN 1 ELSE 0 END AS is_city_level
      FROM city c
      CROSS JOIN w
      LEFT JOIN city_rating cr ON cr.city_id = c.id AND cr.module_id = w.module_id
      LEFT JOIN state_rating sr ON sr.state = c.state AND sr.module_id = w.module_id
      WHERE c.state = :state
    ),
    contrib AS (
      SELECT city_id,
             SUM(CASE WHEN normalized IS NOT NULL
                      THEN (CASE WHEN flipped = 1 THEN 1.0 - normalized ELSE normalized END) * weight
                      ELSE 0 END) AS num,
             SUM(CASE WHEN normalized IS NOT NULL THEN weight ELSE 0 END) AS den,
             SUM(CASE WHEN normalized IS NOT NULL THEN 1 ELSE 0 END) AS factors,
             SUM(CASE WHEN normalized IS NOT NULL THEN is_city_level ELSE 0 END) AS city_factors
      FROM city_x_w
      GROUP BY city_id
    )
    SELECT c.id, c.name, c.latitude, c.longitude, c.population,
           CASE WHEN co.den > 0 THEN co.num / co.den ELSE NULL END AS score,
           COALESCE(co.factors, 0) AS factors,
           COALESCE(co.city_factors, 0) AS city_factors
    FROM city c
    LEFT JOIN contrib co ON co.city_id = c.id
    WHERE c.state = :state
    ORDER BY c.population DESC
  ` : `
    WITH w AS (
      SELECT key AS module_id,
             ABS(CAST(value AS REAL)) AS weight,
             CASE WHEN CAST(value AS REAL) < 0 THEN 1 ELSE 0 END AS flipped
      FROM json_each(:weights)
    ),
    city_x_w AS (
      SELECT c.id AS city_id, w.module_id, w.weight, w.flipped, m.category,
             COALESCE(cr.normalized, sr.normalized) AS normalized,
             CASE WHEN cr.normalized IS NOT NULL THEN 1 ELSE 0 END AS is_city_level
      FROM city c
      CROSS JOIN w
      JOIN module m ON m.id = w.module_id
      LEFT JOIN city_rating cr ON cr.city_id = c.id AND cr.module_id = w.module_id
      LEFT JOIN state_rating sr ON sr.state = c.state AND sr.module_id = w.module_id
      WHERE c.state = :state
    ),
    per_cat AS (
      SELECT city_id, category,
             SUM((CASE WHEN flipped = 1 THEN 1.0 - normalized ELSE normalized END) * weight) /
               SUM(weight) AS cat_score,
             COUNT(*)                AS n_in_cat,
             SUM(is_city_level)      AS city_in_cat
      FROM city_x_w
      WHERE normalized IS NOT NULL
      GROUP BY city_id, category
    ),
    agg AS (
      SELECT city_id,
             AVG(cat_score)       AS score,
             SUM(n_in_cat)        AS factors,
             SUM(city_in_cat)     AS city_factors
      FROM per_cat
      GROUP BY city_id
    )
    SELECT c.id, c.name, c.latitude, c.longitude, c.population,
           a.score,
           COALESCE(a.factors, 0)       AS factors,
           COALESCE(a.city_factors, 0)  AS city_factors
    FROM city c
    LEFT JOIN agg a ON a.city_id = c.id
    WHERE c.state = :state
    ORDER BY c.population DESC
  `;
  const stmt = citiesDb.prepare(sql);
  stmt.bind({ ":weights": weightJson, ":state": stateName });
  const out = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    out.push(row);
  }
  stmt.free();
  return out;
}

export function getCityBreakdown(citiesDb, cityId) {
  // Return every module, preferring city-level value where present, else
  // the state-level fallback. Includes an `inherited` flag so the tooltip
  // can mark state-inherited rows ('TX-wide').
  const stmt = citiesDb.prepare(`
    WITH city_info AS (SELECT id, state FROM city WHERE id = :id)
    SELECT m.id AS module_id, m.label, m.unit, m.lower_is_better,
           COALESCE(cr.value, sr.value)       AS value,
           COALESCE(cr.normalized, sr.normalized) AS normalized,
           CASE WHEN cr.value IS NOT NULL THEN 0 ELSE 1 END AS inherited
    FROM module m
    LEFT JOIN city_rating cr ON cr.module_id = m.id AND cr.city_id = :id
    LEFT JOIN state_rating sr ON sr.module_id = m.id AND sr.state = (SELECT state FROM city_info)
    WHERE COALESCE(cr.value, sr.value) IS NOT NULL
    ORDER BY m.label
  `);
  stmt.bind({ ":id": cityId });
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

export function listModules(db) {
  const rows = db.exec(`
    SELECT m.id, m.category, m.label, m.description, m.unit, m.source,
           m.methodology, m.lower_is_better,
           COUNT(r.place_id) AS coverage
    FROM module m
    LEFT JOIN rating r ON r.module_id = m.id
    GROUP BY m.id
    ORDER BY m.category, m.label
  `);
  if (!rows.length) return [];
  const cols = rows[0].columns;
  return rows[0].values.map((v) => {
    const o = {};
    cols.forEach((c, i) => { o[c] = v[i]; });
    o.lower_is_better = !!o.lower_is_better;
    return o;
  });
}

// Compute a weighted score per state. Pure SQL — sql.js executes it locally.
// `weights` is [{ id, weight, flipped? }, ...]. Weight 0 = ignored.
// flipped=true reverses the module's "better direction" — equivalent to
// using (1 - normalized) instead of normalized for that module.
//
// `mode` controls how weights aggregate:
//  - 'capped' (default) — weighted avg WITHIN each category, then plain avg
//    ACROSS categories. Prevents the climate cluster (9 correlated modules)
//    from dominating against single-module categories.
//  - 'flat' — straight weighted average across all modules. Used by the
//    "Match a state" preset because the cap suppresses a state's own
//    profile (its strengths cluster in one category that then gets capped).
export function computeRanking(db, weights, mode = "capped") {
  const active = weights.filter((w) => w.weight > 0);
  if (active.length === 0) {
    return db.exec(`
      SELECT p.name AS state, p.fips, 0 AS score, 0 AS factors
      FROM place p
      WHERE p.kind = 'state'
      ORDER BY p.name
    `)[0]?.values.map(([state, fips, score, factors]) => ({
      state, fips, score, factors,
    })) ?? [];
  }

  // Encode weight + flip flag together. Positive weight = use normalized
  // as-is; negative weight = use (1 - normalized). |value| is the magnitude.
  const weightJson = JSON.stringify(
    Object.fromEntries(active.map((w) => [w.id, (w.flipped ? -1 : 1) * w.weight])),
  );

  const sql = mode === "flat" ? `
    WITH w AS (
      SELECT key AS module_id,
             ABS(CAST(value AS REAL)) AS weight,
             CASE WHEN CAST(value AS REAL) < 0 THEN 1 ELSE 0 END AS flipped
      FROM json_each(:weights)
    ),
    contrib AS (
      SELECT
        r.place_id,
        SUM((CASE WHEN w.flipped = 1 THEN 1.0 - r.normalized ELSE r.normalized END) * w.weight) AS num,
        SUM(w.weight)                AS den,
        COUNT(*)                     AS factors
      FROM rating r
      JOIN w ON w.module_id = r.module_id
      WHERE r.normalized IS NOT NULL
      GROUP BY r.place_id
    )
    SELECT
      p.name  AS state,
      p.fips  AS fips,
      CASE WHEN c.den > 0 THEN c.num / c.den ELSE 0 END AS score,
      COALESCE(c.factors, 0) AS factors
    FROM place p
    LEFT JOIN contrib c ON c.place_id = p.id
    WHERE p.kind = 'state'
    ORDER BY score DESC, p.name ASC
  ` : `
    WITH w AS (
      SELECT key AS module_id,
             ABS(CAST(value AS REAL)) AS weight,
             CASE WHEN CAST(value AS REAL) < 0 THEN 1 ELSE 0 END AS flipped
      FROM json_each(:weights)
    ),
    mw AS (
      SELECT r.place_id, m.category, w.weight,
             CASE WHEN w.flipped = 1 THEN 1.0 - r.normalized ELSE r.normalized END AS norm
      FROM rating r
      JOIN w ON w.module_id = r.module_id
      JOIN module m ON m.id = r.module_id
      WHERE r.normalized IS NOT NULL
    ),
    per_cat AS (
      SELECT place_id, category,
             SUM(norm * weight) / SUM(weight) AS cat_score,
             COUNT(*) AS n_in_cat
      FROM mw
      GROUP BY place_id, category
    ),
    agg AS (
      SELECT place_id,
             AVG(cat_score)  AS score,
             SUM(n_in_cat)   AS factors
      FROM per_cat
      GROUP BY place_id
    )
    SELECT
      p.name  AS state,
      p.fips  AS fips,
      COALESCE(a.score, 0)   AS score,
      COALESCE(a.factors, 0) AS factors
    FROM place p
    LEFT JOIN agg a ON a.place_id = p.id
    WHERE p.kind = 'state'
    ORDER BY score DESC, p.name ASC
  `;

  const stmt = db.prepare(sql);
  stmt.bind({ ":weights": weightJson });
  const out = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    out.push({
      state: row.state,
      fips: row.fips,
      score: row.score ?? 0,
      factors: row.factors ?? 0,
    });
  }
  stmt.free();
  return out;
}

// Single-factor browse — sort states by one module's raw value.
// Returns the same shape as computeRanking + each state's raw value/unit.
export function computeSingleFactor(db, moduleId) {
  const stmt = db.prepare(`
    SELECT p.name AS state, p.fips,
           r.value, r.normalized, m.unit, m.lower_is_better
    FROM rating r
    JOIN module m ON m.id = r.module_id
    JOIN place p  ON p.id = r.place_id
    WHERE m.id = :id AND p.kind = 'state'
    ORDER BY r.normalized DESC
  `);
  stmt.bind({ ":id": moduleId });
  const out = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    out.push({
      state: row.state,
      fips: row.fips,
      value: row.value,
      unit: row.unit,
      score: row.normalized,  // reuse normalized as the color scale
      factors: 1,
      lowerIsBetter: !!row.lower_is_better,
    });
  }
  stmt.free();
  return out;
}

// Per-module rank and value for ONE state, across every module.
// Used by the State Profile panel: "you are #34 of 51 for Cost of Living."
// Categories are pulled from the module table so the panel can bucket rows.
export function getStateProfile(db, stateName) {
  const stmt = db.prepare(`
    WITH ranked AS (
      SELECT r.module_id,
             p.id AS place_id,
             p.name AS state,
             r.value,
             r.normalized,
             DENSE_RANK() OVER (PARTITION BY r.module_id ORDER BY r.normalized DESC) AS rnk,
             COUNT(*) OVER (PARTITION BY r.module_id) AS total
      FROM rating r
      JOIN place p ON p.id = r.place_id
      WHERE p.kind = 'state' AND r.normalized IS NOT NULL
    )
    SELECT m.id AS module_id, m.category, m.label, m.unit, m.lower_is_better,
           r.value, r.normalized, r.rnk, r.total
    FROM module m
    JOIN ranked r ON r.module_id = m.id
    WHERE r.state = :name
    ORDER BY m.category, m.label
  `);
  stmt.bind({ ":name": stateName });
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

// Raw values for tooltip ("California — Cost of Living: 142.3 index").
export function getStateBreakdown(db, stateName) {
  const stmt = db.prepare(`
    SELECT m.id AS module_id, m.label, m.unit, m.category,
           r.value, r.normalized
    FROM rating r
    JOIN module m ON m.id = r.module_id
    JOIN place p  ON p.id = r.place_id
    WHERE p.name = :name AND p.kind = 'state'
    ORDER BY m.category, m.label
  `);
  stmt.bind({ ":name": stateName });
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

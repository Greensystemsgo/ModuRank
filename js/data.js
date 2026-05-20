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

// Lazy-load the cities DB (13 MB) — called the first time a state is focused.
let _citiesDbPromise = null;
export function loadCitiesDatabase(dbUrl) {
  if (_citiesDbPromise) return _citiesDbPromise;
  _citiesDbPromise = (async () => {
    if (!_SQL) throw new Error("sql.js not initialized yet");
    const buf = await fetch(dbUrl).then((r) => {
      if (!r.ok) throw new Error(`fetch ${dbUrl}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    return new _SQL.Database(new Uint8Array(buf));
  })();
  return _citiesDbPromise;
}

export function getCitiesInState(citiesDb, stateName) {
  const stmt = citiesDb.prepare(
    "SELECT id, name, latitude, longitude, population FROM city WHERE state = :state ORDER BY population DESC"
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
export function computeCityRanking(citiesDb, weights, stateName) {
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

  const stmt = citiesDb.prepare(`
    WITH w AS (
      SELECT key AS module_id,
             ABS(CAST(value AS REAL)) AS weight,
             CASE WHEN CAST(value AS REAL) < 0 THEN 1 ELSE 0 END AS flipped
      FROM json_each(:weights)
    ),
    /* per-city per-module COALESCEd normalized value: city-level wins, else state-level */
    city_x_w AS (
      SELECT c.id AS city_id, w.module_id, w.weight, w.flipped,
             COALESCE(cr.normalized, sr.normalized) AS normalized
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
             /* How many *city-level* modules actually contributed —
                excluding state-inherited values. Honest precision. */
             SUM(CASE
                   WHEN normalized IS NOT NULL
                    AND city_id IN (SELECT city_id FROM city_rating WHERE module_id = city_x_w.module_id)
                   THEN 1 ELSE 0 END) AS city_factors
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
  `);
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
export function computeRanking(db, weights) {
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

  const sql = `
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

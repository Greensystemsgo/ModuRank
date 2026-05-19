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

// Compute per-city weighted score for all cities in a given state, using
// whichever modules in `weights` actually have city-level data.
export function computeCityRanking(citiesDb, weights, stateName) {
  const active = weights.filter((w) => w.weight > 0);
  if (active.length === 0) {
    // No active factors — return all cities with score 0.
    return getCitiesInState(citiesDb, stateName).map((c) => ({
      id: c.id, name: c.name, latitude: c.latitude, longitude: c.longitude,
      population: c.population, score: null, factors: 0,
    }));
  }

  const weightJson = JSON.stringify(
    Object.fromEntries(active.map((w) => [w.id, w.weight])),
  );

  const stmt = citiesDb.prepare(`
    WITH w AS (
      SELECT key AS module_id, CAST(value AS REAL) AS weight
      FROM json_each(:weights)
    ),
    contrib AS (
      SELECT cr.city_id,
             SUM(cr.normalized * w.weight) AS num,
             SUM(w.weight)                 AS den,
             COUNT(*)                      AS factors
      FROM city_rating cr
      JOIN w ON w.module_id = cr.module_id
      GROUP BY cr.city_id
    )
    SELECT c.id, c.name, c.latitude, c.longitude, c.population,
           CASE WHEN co.den > 0 THEN co.num / co.den ELSE NULL END AS score,
           COALESCE(co.factors, 0) AS factors
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
  const stmt = citiesDb.prepare(`
    SELECT m.id AS module_id, m.label, m.unit, m.lower_is_better,
           cr.value, cr.normalized
    FROM city_rating cr
    JOIN module m ON m.id = cr.module_id
    WHERE cr.city_id = :id
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
// `weights` is [{ id, weight }, ...]. Modules with weight 0 are ignored.
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

  const weightJson = JSON.stringify(
    Object.fromEntries(active.map((w) => [w.id, w.weight])),
  );

  const sql = `
    WITH w AS (
      SELECT key AS module_id, CAST(value AS REAL) AS weight
      FROM json_each(:weights)
    ),
    contrib AS (
      SELECT
        r.place_id,
        SUM(r.normalized * w.weight) AS num,
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

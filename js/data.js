// SQLite data layer. One DB load on boot; everything queries against it.

export async function loadDatabase({ sqlJsLocate, dbUrl }) {
  const SQL = await window.initSqlJs({ locateFile: sqlJsLocate });
  const buf = await fetch(dbUrl).then((r) => {
    if (!r.ok) throw new Error(`fetch ${dbUrl}: HTTP ${r.status}`);
    return r.arrayBuffer();
  });
  return new SQL.Database(new Uint8Array(buf));
}

export function listModules(db) {
  const rows = db.exec(`
    SELECT m.id, m.label, m.description, m.unit, m.source,
           m.methodology, m.lower_is_better,
           COUNT(r.place_id) AS coverage
    FROM module m
    LEFT JOIN rating r ON r.module_id = m.id
    GROUP BY m.id
    ORDER BY m.label
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

// Raw values for tooltip ("California — Cost of Living: 142.3 index").
export function getStateBreakdown(db, stateName) {
  const stmt = db.prepare(`
    SELECT m.label, m.unit, r.value, r.normalized
    FROM rating r
    JOIN module m ON m.id = r.module_id
    JOIN place p  ON p.id = r.place_id
    WHERE p.name = :name AND p.kind = 'state'
    ORDER BY m.label
  `);
  stmt.bind({ ":name": stateName });
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

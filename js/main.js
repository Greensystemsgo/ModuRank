// ModuRank — main entry point.
// Loads SQLite (via sql.js) once, wires sliders/map/ranking to score queries.

import { initTheme } from "./theme.js";
import { loadDatabase, loadCitiesDatabase, listModules, computeRanking, computeSingleFactor, getStateBreakdown, computeCityRanking } from "./data.js";
import {
  renderSliders, getWeights, onWeightsChange,
  resetWeights, randomizeWeights, applyWeights,
} from "./sliders.js";
import { readHash, writeHash, copyShareLink } from "./url_state.js";
import { PRESETS } from "./presets.js";
import { renderCompare, onChange as onPinChange } from "./compare.js";
import { renderMap, updateMap, setBreakdownContext, onFocusChange, getFocusedState, setCitiesDbUrl, focusStateByName, flyToCity } from "./map.js";
import { initSearch, setSearchCitiesDb } from "./search.js";
import { renderRanking } from "./ranking.js";

initTheme();

const SQL_WASM_CDN = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";
const DB_URL = "data/moduRank.sqlite";
const CITIES_DB_URL = "data/moduRank_cities.sqlite";
const US_TOPO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

const errBox = (msg) => {
  document.querySelector(".app-main").innerHTML =
    `<div class="card"><h2>Could not load app</h2><p>${msg}</p>
     <p class="muted">If you opened this file directly (file://), run a local server:
     <code>python -m http.server 8000</code> and visit
     <code>http://localhost:8000</code>.</p></div>`;
};

(async function bootstrap() {
  try {
    const [db, topology] = await Promise.all([
      loadDatabase({ sqlJsLocate: (f) => SQL_WASM_CDN + f, dbUrl: DB_URL }),
      fetch(US_TOPO_URL).then((r) => r.json()),
    ]);

    const modules = listModules(db);
    const modulesById = new Map(modules.map((m) => [m.id, m]));
    renderSliders(modules);
    renderMap(topology);
    setCitiesDbUrl(CITIES_DB_URL);
    _populatePresets();
    _populateSortBy(modules);

    // Apply weights from URL hash if present.
    const initial = readHash();
    if (initial) applyWeights(initial);

    let _citiesDb = null;

    initSearch({
      onSelectState: (name) => focusStateByName(name),
      onSelectCity: (city) => flyToCity(city),
    });

    const refresh = async () => {
      const weights = getWeights();
      const enabled = weights.filter((w) => w.weight > 0);
      const sortBy = document.getElementById("sort-by-select").value;
      const focused = getFocusedState();

      // State always drives the choropleth map coloring.
      const stateRanking = (sortBy && sortBy !== "weighted")
        ? computeSingleFactor(db, sortBy)
        : computeRanking(db, weights);
      updateMap(stateRanking);

      // Ranking sidebar switches to cities-in-focused-state when a state
      // is focused (and we already have the cities DB loaded).
      let displayRanking = stateRanking;
      let displayMode = "weighted";
      if (focused) {
        if (!_citiesDb) {
          try {
            _citiesDb = await loadCitiesDatabase(CITIES_DB_URL);
            setSearchCitiesDb(_citiesDb);
          }
          catch (e) { /* leave _citiesDb null, fall back to states */ }
        }
        if (_citiesDb) {
          const cityRanking = computeCityRanking(_citiesDb, weights, focused)
            .filter((c) => c.score != null)
            .map((c) => ({ state: c.name, score: c.score, factors: c.factors }));
          if (cityRanking.length) {
            displayRanking = cityRanking;
            displayMode = "cities";
          }
        }
      }

      if (sortBy && sortBy !== "weighted" && displayMode !== "cities") {
        renderRanking(displayRanking, 1, {
          mode: "single",
          moduleLabel: modulesById.get(sortBy)?.label || sortBy,
        });
      } else if (displayMode === "cities") {
        renderRanking(displayRanking, enabled.length, {
          mode: "cities",
          focusedState: focused,
        });
      } else {
        renderRanking(displayRanking, enabled.length);
      }

      writeHash(weights);
      setBreakdownContext(db, weights);
      _updateWinnerChip(displayRanking, enabled.length, sortBy);

      // Compare card supports both state and city pins.
      const cityBreakdown = (state, name) => {
        if (!_citiesDb) return [];
        // Quick lookup: pull city id then breakdown.
        const stmt = _citiesDb.prepare("SELECT id FROM city WHERE state = :s AND name = :n");
        stmt.bind({ ":s": state, ":n": name });
        let id = null;
        if (stmt.step()) id = stmt.getAsObject().id;
        stmt.free();
        if (id == null) return [];
        // Inline import not great here — use the data.js function.
        return import("./data.js").then((m) => m.getCityBreakdown(_citiesDb, id));
      };
      renderCompare(
        (name) => getStateBreakdown(db, name),
        // We need a sync function; do the breakdown sync via a helper.
        (state, name) => _cityBreakdownSync(_citiesDb, state, name),
      );
    };

    onPinChange(() => refresh());

    _initOnboarding();

    onWeightsChange(refresh);
    onFocusChange((stateName) => {
      // Future: when stateName !== null, swap ranking to cities-in-state.
      // For now, refresh just re-renders state ranking with focus chip on.
      refresh();
    });
    document.getElementById("reset-weights").addEventListener("click", () => {
      resetWeights();
      refresh();
    });
    document.getElementById("randomize-weights").addEventListener("click", () => {
      randomizeWeights();
      refresh();
    });
    document.getElementById("share-link").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const orig = btn.textContent;
      const ok = await copyShareLink();
      btn.textContent = ok ? "✓ Copied" : "✗ Couldn't copy";
      setTimeout(() => { btn.textContent = orig; }, 1400);
    });

    document.getElementById("sort-by-select").addEventListener("change", () => refresh());

    document.getElementById("compare-clear").addEventListener("click", () => {
      import("./compare.js").then((m) => m.clearPins());
    });

    document.getElementById("preset-select").addEventListener("change", (e) => {
      const name = e.target.value;
      if (!name) return;
      const preset = PRESETS[name];
      if (!preset) return;
      // Start from a default-50 baseline so picking a new preset doesn't leak
      // weights from the previous one.
      resetWeights();
      applyWeights(preset.weights);
      refresh();
      e.target.value = "";  // reset dropdown to placeholder
    });

    // Sync map/ranking if user manually edits the hash (e.g. paste a shared
    // link in the same tab).
    window.addEventListener("hashchange", () => {
      const next = readHash();
      if (next) {
        applyWeights(next);
        refresh();
      }
    });

    refresh();
  } catch (err) {
    console.error(err);
    errBox(err.message || String(err));
  }
})();

function _populatePresets() {
  const sel = document.getElementById("preset-select");
  for (const [name, p] of Object.entries(PRESETS)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    opt.title = p.description;
    sel.append(opt);
  }
}

function _cityBreakdownSync(citiesDb, state, name) {
  if (!citiesDb) return [];
  const stmt = citiesDb.prepare("SELECT id FROM city WHERE state = :s AND name = :n");
  stmt.bind({ ":s": state, ":n": name });
  let id = null;
  if (stmt.step()) id = stmt.getAsObject().id;
  stmt.free();
  if (id == null) return [];

  // Mirror getCityBreakdown inline (avoids async import).
  const bstmt = citiesDb.prepare(`
    SELECT m.id AS module_id, m.label, m.unit, m.lower_is_better,
           COALESCE(cr.value, sr.value)       AS value,
           COALESCE(cr.normalized, sr.normalized) AS normalized,
           CASE WHEN cr.value IS NOT NULL THEN 0 ELSE 1 END AS inherited
    FROM module m
    LEFT JOIN city_rating cr ON cr.module_id = m.id AND cr.city_id = :id
    LEFT JOIN state_rating sr ON sr.module_id = m.id AND sr.state = :state
    WHERE COALESCE(cr.value, sr.value) IS NOT NULL
    ORDER BY m.label
  `);
  bstmt.bind({ ":id": id, ":state": state });
  const out = [];
  while (bstmt.step()) {
    const row = bstmt.getAsObject();
    // category is missing in this DB's module table — add a synthetic one
    // so the compare table groups correctly. Best-effort by module name.
    row.category = _categoryFor(row.module_id);
    out.push(row);
  }
  bstmt.free();
  return out;
}

const CATEGORY_FALLBACK = {
  cost_of_living: "Cost & Taxes", sales_tax: "Cost & Taxes",
  income_tax: "Cost & Taxes", home_insurance: "Cost & Taxes",
  property_tax: "Cost & Taxes",
  median_sale_price: "Housing", days_on_market: "Housing",
  price_per_sqft: "Housing", housing_inventory: "Housing",
  home_value: "Housing", median_rent: "Housing",
  median_income: "Economy", unemployment: "Economy",
  population: "Demographics", population_density: "Demographics",
  median_age: "Demographics", broadband_pct: "Demographics",
  commute_time: "Demographics",
  bachelors_pct: "Education",
  life_expectancy: "Health", uninsured_pct: "Health",
  avg_temperature: "Climate", feels_like_temperature: "Climate",
  relative_humidity: "Climate", humidity: "Climate",
  sunshine_hours: "Climate", precipitation: "Climate", uv_index: "Climate",
  disasters: "Safety & Risk", air_quality_pm25: "Safety & Risk",
  violent_crime: "Safety & Risk",
  public_lands: "Outdoors",
  gun_friendliness: "Politics & Culture",
};
function _categoryFor(id) { return CATEGORY_FALLBACK[id] || "Other"; }

function _updateWinnerChip(ranking, activeFactors, sortBy) {
  const chip = document.getElementById("winner-chip");
  const name = document.getElementById("winner-name");
  const score = document.getElementById("winner-score");
  if (!ranking || ranking.length === 0 || (sortBy === "weighted" && activeFactors === 0)) {
    chip.classList.add("hidden");
    return;
  }
  const top = ranking[0];
  name.textContent = top.state;
  if (sortBy && sortBy !== "weighted") {
    score.textContent = _fmtCompact(top.value) + (top.unit ? " " + top.unit : "");
  } else {
    score.textContent = (top.score * 100).toFixed(1);
  }
  chip.classList.remove("hidden");
}

function _fmtCompact(v) {
  if (v == null) return "—";
  if (Math.abs(v) >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 100)   return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(v) >= 1)     return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function _initOnboarding() {
  const ob = document.getElementById("onboarding");
  if (!ob) return;
  if (localStorage.getItem("moduRank.onboardingDismissed") === "1") {
    ob.classList.add("hidden");
    return;
  }
  document.getElementById("onboarding-close").addEventListener("click", () => {
    ob.classList.add("hidden");
    localStorage.setItem("moduRank.onboardingDismissed", "1");
  });
}

function _populateSortBy(modules) {
  const sel = document.getElementById("sort-by-select");
  // Group options by category for readability.
  const byCategory = new Map();
  for (const m of modules) {
    const cat = m.category || "Other";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(m);
  }
  for (const [cat, list] of byCategory) {
    const group = document.createElement("optgroup");
    group.label = cat;
    for (const m of list) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label + (m.lower_is_better ? "  (lower = better)" : "");
      group.append(opt);
    }
    sel.append(group);
  }
}

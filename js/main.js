// ModuRank — main entry point.
// Loads SQLite (via sql.js) once, wires sliders/map/ranking to score queries.

import { initTheme } from "./theme.js";
import { loadDatabase, listModules, computeRanking, computeSingleFactor } from "./data.js";
import {
  renderSliders, getWeights, onWeightsChange,
  resetWeights, randomizeWeights, applyWeights,
} from "./sliders.js";
import { readHash, writeHash, copyShareLink } from "./url_state.js";
import { PRESETS } from "./presets.js";
import { renderMap, updateMap, setBreakdownContext } from "./map.js";
import { renderRanking } from "./ranking.js";

initTheme();

const SQL_WASM_CDN = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";
const DB_URL = "data/moduRank.sqlite";
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
    _populatePresets();
    _populateSortBy(modules);

    // Apply weights from URL hash if present.
    const initial = readHash();
    if (initial) applyWeights(initial);

    const refresh = () => {
      const weights = getWeights();
      const enabled = weights.filter((w) => w.weight > 0);
      const sortBy = document.getElementById("sort-by-select").value;

      if (sortBy && sortBy !== "weighted") {
        const ranking = computeSingleFactor(db, sortBy);
        updateMap(ranking);
        renderRanking(ranking, 1, {
          mode: "single",
          moduleLabel: modulesById.get(sortBy)?.label || sortBy,
        });
      } else {
        const ranking = computeRanking(db, weights);
        updateMap(ranking);
        renderRanking(ranking, enabled.length);
      }
      writeHash(weights);
      setBreakdownContext(db, weights);
    };

    onWeightsChange(refresh);
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

// ModuRank — main entry point.
// Loads SQLite (via sql.js) once, wires sliders/map/ranking to score queries.

import { initTheme } from "./theme.js";
import { loadDatabase, listModules, computeRanking } from "./data.js";
import { renderSliders, getWeights, onWeightsChange, resetWeights, randomizeWeights } from "./sliders.js";
import { renderMap, updateMap } from "./map.js";
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
    renderSliders(modules);
    renderMap(topology);

    const refresh = () => {
      const weights = getWeights();
      const enabled = weights.filter((w) => w.weight > 0);
      const ranking = computeRanking(db, weights);
      updateMap(ranking);
      renderRanking(ranking, enabled.length);
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

    refresh();
  } catch (err) {
    console.error(err);
    errBox(err.message || String(err));
  }
})();

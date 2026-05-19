// US states choropleth via d3 + topojson + us-atlas.

import { getStateBreakdown } from "./data.js";

let _svg = null;
let _paths = null;
let _projection = null;
let _path = null;
let _db = null;
let _weightsByModule = new Map();

export function setBreakdownContext(db, weights) {
  _db = db;
  _weightsByModule = new Map(weights.map((w) => [w.id, w.weight]));
}

// 4-stop diverging-warm gradient matching style.css legend.
const scale = (t) => {
  if (t == null || isNaN(t)) return "var(--map-fill-empty)";
  // t in [0,1] (already normalized weighted score)
  const stops = [
    [0.0, [247, 218, 218]], // --scale-lo
    [0.4, [255, 241, 196]], // --scale-mid
    [0.7, [200, 236, 196]], // --scale-hi
    [1.0, [95, 191, 90]],   // --scale-top
  ];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i];
    if (t <= t1) {
      const [t0, c0] = stops[i - 1];
      const u = (t - t0) / (t1 - t0 || 1);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * u);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * u);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * u);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return "rgb(95,191,90)";
};

export function renderMap(topology) {
  const container = document.getElementById("map");
  container.innerHTML = "";

  const states = topojson.feature(topology, topology.objects.states);

  const width = container.clientWidth || 900;
  const height = Math.round(width * 9 / 16);

  _svg = d3.select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  _projection = d3.geoAlbersUsa().fitSize([width, height], states);
  _path = d3.geoPath(_projection);

  _paths = _svg.selectAll("path.state-path")
    .data(states.features)
    .join("path")
    .attr("class", "state-path")
    .attr("d", _path)
    .attr("fill", "var(--map-fill-empty)")
    .attr("data-fips", (d) => String(d.id).padStart(2, "0"))
    .attr("data-name", (d) => d.properties.name)
    .on("mousemove", (event, d) => showTip(event, d))
    .on("mouseleave", hideTip);

  // Render a legend strip
  const legend = document.getElementById("map-legend");
  legend.innerHTML = `<span>worse</span><span class="legend-bar"></span><span>better</span>`;
}

let _scoresByFips = new Map();
let _ranksByFips = new Map();

export function updateMap(ranking) {
  if (!_paths) return;
  _scoresByFips = new Map();
  _ranksByFips = new Map();
  ranking.forEach((r, idx) => {
    _scoresByFips.set(r.fips, r);
    _ranksByFips.set(r.fips, idx + 1);
  });

  _paths.transition()
    .duration(180)
    .attr("fill", function () {
      const fips = this.getAttribute("data-fips");
      const r = _scoresByFips.get(fips);
      if (!r || r.factors === 0) return "var(--map-fill-empty)";
      return scale(r.score);
    });
}

function showTip(event, d) {
  const tip = document.getElementById("map-tooltip");
  const fips = String(d.id).padStart(2, "0");
  const r = _scoresByFips.get(fips);
  const rank = _ranksByFips.get(fips);
  const name = d.properties.name;

  // Header
  let html = `<div class="tip-state"><span>${name}</span>`;
  if (r && r.factors > 0) {
    html += `<span class="tip-rank">#${rank} · ${(r.score * 100).toFixed(1)}</span>`;
  }
  html += `</div>`;

  // Full per-module breakdown (if DB context is set).
  if (_db) {
    const rows = getStateBreakdown(_db, name);
    const enabled = rows.filter((r) => (_weightsByModule.get(r.module_id) ?? 50) > 0);
    const disabled = rows.filter((r) => (_weightsByModule.get(r.module_id) ?? 50) === 0);

    if (enabled.length) {
      html += `<div class="tip-section">Active factors (${enabled.length})</div>`;
      // Sort by normalized score desc — show strengths first.
      enabled.sort((a, b) => b.normalized - a.normalized);
      for (const row of enabled) {
        html += `<div class="tip-row"><span class="k">${row.label}</span><span class="v">${_formatValue(row)}</span></div>`;
      }
    }
    if (disabled.length) {
      html += `<div class="tip-section">Disabled (${disabled.length})</div>`;
      for (const row of disabled) {
        html += `<div class="tip-row"><span class="k">${row.label}</span><span class="v" style="opacity:0.55">${_formatValue(row)}</span></div>`;
      }
    }
  } else if (!(r && r.factors > 0)) {
    html += `<div class="tip-row"><span class="k">No active factors</span></div>`;
  }

  tip.innerHTML = html;
  tip.classList.add("visible");
  _placeTip(tip, event);
}

function _formatValue(row) {
  const v = row.value;
  const u = row.unit || "";
  let formatted;
  if (Math.abs(v) >= 10000) {
    formatted = v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  } else if (Math.abs(v) >= 100) {
    formatted = v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  } else if (Math.abs(v) >= 1) {
    formatted = v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  } else {
    formatted = v.toLocaleString(undefined, { maximumFractionDigits: 3 });
  }
  return u ? `${formatted} ${u}` : formatted;
}

function _placeTip(tip, event) {
  // position: fixed → coords are viewport-relative.
  const PAD = 14;
  const w = tip.offsetWidth || 280;
  const h = tip.offsetHeight || 200;
  let x = event.clientX + PAD;
  let y = event.clientY + PAD;
  if (x + w > window.innerWidth - 8)  x = event.clientX - w - PAD;
  if (y + h > window.innerHeight - 8) y = event.clientY - h - PAD;
  if (y < 8) y = 8;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function hideTip() {
  document.getElementById("map-tooltip").classList.remove("visible");
}

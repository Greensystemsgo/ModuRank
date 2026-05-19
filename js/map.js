// Leaflet-based US map with switchable basemap (outline / street / satellite).
// State choropleth via GeoJSON layer; click a state to focus on it (zoom in,
// fire onFocus callback). Hover for full per-state breakdown tooltip.

import { getStateBreakdown, loadCitiesDatabase, getCitiesInState } from "./data.js";

let _map = null;
let _tileLayer = null;
let _stateLayer = null;
let _cityLayer = null;
let _currentStyle = "outline";
let _topology = null;
let _scoresByName = new Map();
let _ranksByName = new Map();
let _db = null;
let _weightsByModule = new Map();
let _onFocus = null;
let _focusedState = null;
let _citiesDbUrl = null;
let _citiesDb = null;

// Wide enough to fit continental US + Hawaii in the default view.
// Alaska remains reachable by panning north. (Real-geography Leaflet
// can't easily show all 50 states + DC without making CONUS tiny.)
const CONTINENTAL_BOUNDS = [[18.0, -161.0], [50.0, -66.5]];

const TILE_PROVIDERS = {
  street_light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  },
  street_dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
  },
};

const scale = (t) => {
  if (t == null || isNaN(t)) return null;  // null = use default fill
  const stops = [
    [0.0, [247, 218, 218]],
    [0.4, [255, 241, 196]],
    [0.7, [200, 236, 196]],
    [1.0, [95, 191, 90]],
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

export function setBreakdownContext(db, weights) {
  _db = db;
  _weightsByModule = new Map(weights.map((w) => [w.id, w.weight]));
}

export function onFocusChange(fn) {
  _onFocus = fn;
}

export function setCitiesDbUrl(url) {
  _citiesDbUrl = url;
}

export function renderMap(topology) {
  _topology = topology;
  const container = document.getElementById("map");
  container.innerHTML = "";

  _map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
    minZoom: 3,
    maxZoom: 12,
    worldCopyJump: false,
    preferCanvas: true,
  });
  _map.fitBounds(CONTINENTAL_BOUNDS);

  _applyMapStyle(_currentStyle);

  // Re-style states whenever theme changes — outline mode reads the
  // CSS-derived fill colors, and the dark/light Carto tile flips with theme.
  const themeObserver = new MutationObserver(() => {
    _applyMapStyle(_currentStyle);
    if (_stateLayer) _stateLayer.setStyle(_styleState);
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // State GeoJSON layer
  const states = topojson.feature(topology, topology.objects.states);
  _stateLayer = L.geoJSON(states, {
    style: _styleState,
    onEachFeature: (feature, layer) => {
      layer.on({
        mouseover: (e) => _hoverState(e, feature),
        mousemove: (e) => _placeTip(document.getElementById("map-tooltip"), e.originalEvent),
        mouseout:  (e) => { _stateLayer.resetStyle(e.target); _hideTip(); },
        click:     (e) => _focusState(feature, e.target),
      });
    },
  }).addTo(_map);

  // Belt-and-suspenders: hide the tip when the cursor leaves the map area
  // entirely (sometimes the per-state mouseout doesn't fire if you exit
  // fast or onto a control like the zoom buttons).
  _map.getContainer().addEventListener("mouseleave", _hideTip);

  _initStyleToggle();
  _initFocusChip();
  _renderLegend();
}

function _applyMapStyle(style) {
  _currentStyle = style;
  if (_tileLayer) {
    _map.removeLayer(_tileLayer);
    _tileLayer = null;
  }
  if (style === "outline") return;  // no tile layer

  let provider;
  if (style === "satellite") {
    provider = TILE_PROVIDERS.satellite;
  } else {
    // street — flip with theme
    const dark = document.documentElement.dataset.theme === "dark";
    provider = dark ? TILE_PROVIDERS.street_dark : TILE_PROVIDERS.street_light;
  }
  _tileLayer = L.tileLayer(provider.url, {
    attribution: provider.attribution,
    subdomains: provider.subdomains || "abc",
    maxZoom: provider.maxZoom || 19,
    r: window.devicePixelRatio > 1 ? "@2x" : "",
  });
  _tileLayer.addTo(_map);
  _tileLayer.bringToBack();
}

function _styleState(feature) {
  const fips = String(feature.id).padStart(2, "0");
  const stateName = feature.properties.name;
  const r = _scoresByName.get(stateName);
  const tile = _currentStyle !== "outline";

  let fill = "#dddddd";
  if (r && r.factors > 0) {
    fill = scale(r.score) || fill;
  } else {
    fill = tile ? "rgba(150,150,150,0.15)" : "#e7e7ec";
  }

  const isFocused = _focusedState === stateName;
  return {
    fillColor: fill,
    color: isFocused ? (tile ? "#ffffff" : "#1a1a1f") : (tile ? "#ffffff" : "#ffffff"),
    weight: isFocused ? 3 : 1,
    opacity: 1,
    fillOpacity: tile ? 0.55 : 0.85,
  };
}

function _hoverState(e, feature) {
  const layer = e.target;
  layer.setStyle({ weight: 2.4, color: "#1a1a1f" });
  layer.bringToFront();
  _showTip(e.originalEvent, feature);
}

function _showTip(event, feature) {
  const tip = document.getElementById("map-tooltip");
  const name = feature.properties.name;
  const r = _scoresByName.get(name);
  const rank = _ranksByName.get(name);

  let html = `<div class="tip-state"><span>${name}</span>`;
  if (r && r.factors > 0) {
    html += `<span class="tip-rank">#${rank} &middot; ${(r.score * 100).toFixed(1)}</span>`;
  }
  html += `</div>`;

  if (_db) {
    const rows = getStateBreakdown(_db, name);
    const enabled = rows.filter((r) => (_weightsByModule.get(r.module_id) ?? 50) > 0);

    if (enabled.length) {
      // Top 3 strengths + bottom 3 weaknesses among active factors.
      const sorted = [...enabled].sort((a, b) => b.normalized - a.normalized);
      const strengths = sorted.slice(0, 3);
      const weaknesses = sorted.slice(-3).reverse();

      html += `<div class="tip-section">Strengths</div>`;
      for (const row of strengths) {
        html += `<div class="tip-row"><span class="k">${row.label}</span><span class="v">${_fmtValue(row)}</span></div>`;
      }
      if (enabled.length > 3) {
        html += `<div class="tip-section">Weaknesses</div>`;
        for (const row of weaknesses) {
          html += `<div class="tip-row"><span class="k">${row.label}</span><span class="v">${_fmtValue(row)}</span></div>`;
        }
      }
      if (enabled.length > 6) {
        html += `<div class="tip-row" style="margin-top:6px;font-size:10px;opacity:0.6">+ ${enabled.length - 6} more factors active</div>`;
      }
    } else {
      html += `<div class="tip-row"><span class="k">No active factors — turn up some sliders</span></div>`;
    }
  }

  tip.innerHTML = html;
  tip.classList.add("visible");
  _placeTip(tip, event);
}

function _fmtValue(row) {
  const v = row.value;
  const u = row.unit || "";
  let s;
  if (Math.abs(v) >= 10000) s = v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  else if (Math.abs(v) >= 100) s = v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  else if (Math.abs(v) >= 1) s = v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  else s = v.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return u ? `${s} ${u}` : s;
}

function _placeTip(tip, event) {
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

function _hideTip() {
  document.getElementById("map-tooltip").classList.remove("visible");
}

// Set new scores for the choropleth.
export function updateMap(ranking) {
  _scoresByName = new Map();
  _ranksByName = new Map();
  ranking.forEach((r, idx) => {
    _scoresByName.set(r.state, r);
    _ranksByName.set(r.state, idx + 1);
  });
  if (_stateLayer) _stateLayer.setStyle(_styleState);
}

async function _focusState(feature, layer) {
  const name = feature.properties.name;
  if (_focusedState === name) {
    _clearFocus();
    return;
  }
  _focusedState = name;
  _map.fitBounds(layer.getBounds(), { padding: [40, 40] });
  _stateLayer.setStyle(_styleState);
  _hideTip();
  _updateFocusChip();
  if (_onFocus) _onFocus(name);
  await _renderCitiesForFocus(name);
}

function _clearFocus() {
  _focusedState = null;
  _map.fitBounds(CONTINENTAL_BOUNDS);
  if (_stateLayer) _stateLayer.setStyle(_styleState);
  if (_cityLayer) {
    _map.removeLayer(_cityLayer);
    _cityLayer = null;
  }
  _updateFocusChip();
  if (_onFocus) _onFocus(null);
}

async function _renderCitiesForFocus(stateName) {
  if (_cityLayer) {
    _map.removeLayer(_cityLayer);
    _cityLayer = null;
  }
  if (!_citiesDbUrl) return;

  // First focus triggers the lazy 13 MB cities-DB fetch.
  if (!_citiesDb) {
    _showLoading();
    try {
      _citiesDb = await loadCitiesDatabase(_citiesDbUrl);
    } catch (err) {
      console.error(err);
      _hideLoading();
      return;
    }
    _hideLoading();
  }

  const cities = getCitiesInState(_citiesDb, stateName);
  if (!cities.length) return;

  // Sort by population so the smallest cities draw first (largest on top).
  const maxPop = Math.max(...cities.map((c) => c.population || 1));
  const minRadius = 2.5;
  const maxRadius = 9;

  const markers = cities.map((c) => {
    const t = c.population > 0 ? Math.sqrt(c.population / maxPop) : 0;
    const radius = minRadius + (maxRadius - minRadius) * t;
    const marker = L.circleMarker([c.latitude, c.longitude], {
      radius,
      color: "#1a1a1f",
      weight: 1,
      fillColor: "var(--accent)",
      fillOpacity: 0.85,
      pane: "markerPane",
    });
    marker.bindTooltip(
      `<strong>${c.name}, ${c.state}</strong><br/>` +
      (c.population ? `pop ${c.population.toLocaleString()}` : "<em>population unknown</em>"),
      { direction: "top", offset: [0, -4], sticky: true, className: "city-tooltip" }
    );
    // Override fill via direct DOM tweak since L doesn't read CSS vars
    return marker;
  });

  _cityLayer = L.layerGroup(markers, { pane: "markerPane" }).addTo(_map);

  // Compute the actual accent color from CSS to apply to markers.
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2f6df6";
  markers.forEach((m) => m.setStyle({ fillColor: accent, color: accent }));
}

function _showLoading() {
  const tip = document.getElementById("map-tooltip");
  tip.innerHTML = `<div class="tip-state">Loading cities…</div><div class="tip-row"><span class="k">~13 MB, one-time</span></div>`;
  tip.style.left = "50%";
  tip.style.top = "30%";
  tip.style.transform = "translate(-50%, 0)";
  tip.classList.add("visible");
}
function _hideLoading() {
  const tip = document.getElementById("map-tooltip");
  tip.style.transform = "";
  tip.classList.remove("visible");
}

function _updateFocusChip() {
  const chip = document.getElementById("focus-chip");
  const name = document.getElementById("focus-state-name");
  if (_focusedState) {
    name.textContent = _focusedState;
    chip.classList.remove("hidden");
  } else {
    chip.classList.add("hidden");
  }
}

function _initFocusChip() {
  document.getElementById("focus-clear").addEventListener("click", () => _clearFocus());
}

function _initStyleToggle() {
  const buttons = document.querySelectorAll(".map-style-toggle .style-btn");
  buttons.forEach((b) => {
    b.addEventListener("click", () => {
      buttons.forEach((bb) => bb.classList.remove("active"));
      b.classList.add("active");
      _applyMapStyle(b.dataset.style);
      if (_stateLayer) _stateLayer.setStyle(_styleState);
    });
  });
}

function _renderLegend() {
  const legend = document.getElementById("map-legend");
  legend.innerHTML = `<span>worse</span><span class="legend-bar"></span><span>better</span>`;
}

export function getFocusedState() { return _focusedState; }

// US states choropleth via d3 + topojson + us-atlas.

let _svg = null;
let _paths = null;
let _projection = null;
let _path = null;

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

  let html = `<div class="tip-state">${name}</div>`;
  if (r && r.factors > 0) {
    html += `<div class="tip-row"><span class="k">Rank</span><span>#${rank}</span></div>`;
    html += `<div class="tip-row"><span class="k">Score</span><span>${(r.score * 100).toFixed(1)}</span></div>`;
  } else {
    html += `<div class="tip-row"><span class="k">No active factors</span></div>`;
  }
  tip.innerHTML = html;
  tip.classList.add("visible");

  const container = document.getElementById("map").getBoundingClientRect();
  const x = event.clientX - container.left + 12;
  const y = event.clientY - container.top + 12;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function hideTip() {
  document.getElementById("map-tooltip").classList.remove("visible");
}

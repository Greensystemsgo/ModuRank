// Search box — find a state or city, focus the map on it.

const STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
  "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
  "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

let _citiesDb = null;
let _onSelectState = null;
let _onSelectCity = null;
let _debounceTimer = null;

export function initSearch(opts) {
  _onSelectState = opts.onSelectState;
  _onSelectCity = opts.onSelectCity;

  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");

  input.addEventListener("input", () => {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => _renderResults(input.value, results), 120);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      results.classList.add("hidden");
      input.blur();
    } else if (e.key === "Enter") {
      const first = results.querySelector(".search-result");
      if (first) first.click();
    } else if (e.key === "ArrowDown") {
      const first = results.querySelector(".search-result");
      if (first) first.focus();
      e.preventDefault();
    }
  });

  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.classList.add("hidden");
    }
  });

  input.addEventListener("focus", () => {
    if (input.value.trim()) _renderResults(input.value, results);
  });
}

export function setSearchCitiesDb(db) { _citiesDb = db; }

function _renderResults(query, container) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  const stateMatches = STATES
    .filter((s) => s.toLowerCase().includes(q))
    .slice(0, 8);

  const cityMatches = _citiesDb ? _searchCities(q, 12) : [];

  if (stateMatches.length === 0 && cityMatches.length === 0) {
    container.innerHTML = `<div class="search-empty">No matches.${_citiesDb ? "" : " (Focus a state once to enable city search.)"}</div>`;
    container.classList.remove("hidden");
    return;
  }

  let html = "";
  if (stateMatches.length) {
    html += `<div class="search-section">States</div>`;
    for (const s of stateMatches) {
      html += `<button class="search-result" data-kind="state" data-name="${_esc(s)}">
        <span class="search-name">${_hl(s, q)}</span>
        <span class="search-sub">State</span>
      </button>`;
    }
  }
  if (cityMatches.length) {
    html += `<div class="search-section">Cities</div>`;
    for (const c of cityMatches) {
      html += `<button class="search-result" data-kind="city" data-state="${_esc(c.state)}" data-name="${_esc(c.name)}" data-lat="${c.latitude}" data-lon="${c.longitude}">
        <span class="search-name">${_hl(c.name, q)}, ${_esc(c.state)}</span>
        <span class="search-sub">${c.population ? c.population.toLocaleString() : "—"}</span>
      </button>`;
    }
  }

  container.innerHTML = html;
  container.classList.remove("hidden");

  container.querySelectorAll(".search-result").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.kind;
      if (kind === "state" && _onSelectState) {
        _onSelectState(btn.dataset.name);
      } else if (kind === "city" && _onSelectCity) {
        _onSelectCity({
          state: btn.dataset.state,
          name: btn.dataset.name,
          latitude: parseFloat(btn.dataset.lat),
          longitude: parseFloat(btn.dataset.lon),
        });
      }
      document.getElementById("search-input").value = "";
      container.classList.add("hidden");
    });
  });
}

function _searchCities(q, limit) {
  const stmt = _citiesDb.prepare(`
    SELECT state, name, latitude, longitude, population
    FROM city
    WHERE LOWER(name) LIKE :pre
       OR LOWER(name) LIKE :any
    ORDER BY
      CASE WHEN LOWER(name) = :exact THEN 0
           WHEN LOWER(name) LIKE :pre THEN 1
           ELSE 2 END,
      population DESC
    LIMIT :limit
  `);
  stmt.bind({
    ":pre": q + "%",
    ":any": "%" + q + "%",
    ":exact": q,
    ":limit": limit,
  });
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

function _esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}

function _hl(s, q) {
  const safe = _esc(s);
  const i = safe.toLowerCase().indexOf(q);
  if (i < 0) return safe;
  return safe.slice(0, i) + "<mark>" + safe.slice(i, i + q.length) + "</mark>" + safe.slice(i + q.length);
}

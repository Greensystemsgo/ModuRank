// Compare up to 4 pinned places (states or cities) side-by-side.
//
// Pin entries: { kind: 'state'|'city', state, name }.
//   state pin → { kind: 'state', state: 'Texas',  name: 'Texas' }
//   city  pin → { kind: 'city',  state: 'Texas',  name: 'Austin' }

const MAX_PINS = 4;
const STORAGE_KEY = "moduRank.pins.v2";

let _pinned = _loadPinned();
let _onChange = null;

function _loadPinned() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Backwards-compat: migrate v1 (array of state-name strings).
      const old = localStorage.getItem("moduRank.pins");
      if (old) {
        const arr = JSON.parse(old);
        if (Array.isArray(arr)) {
          return arr.map((s) => ({ kind: "state", state: s, name: s })).slice(0, MAX_PINS);
        }
      }
      return [];
    }
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, MAX_PINS) : [];
  } catch {
    return [];
  }
}

function _savePinned() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_pinned));
  } catch {}
}

function _eq(a, b) {
  return a.kind === b.kind && a.state === b.state && a.name === b.name;
}

export function getPinned() {
  return _pinned.map((p) => ({ ...p }));
}

export function isPinned(arg, state, kind = "state") {
  // Two call shapes for backwards compat:
  //   isPinned(stateName)               → state pin?
  //   isPinned(name, state, "city")     → city pin?
  if (typeof arg === "string" && state === undefined) {
    return _pinned.some((p) => p.kind === "state" && p.name === arg);
  }
  return _pinned.some((p) => p.kind === kind && p.state === state && p.name === arg);
}

export function togglePin(arg, state, kind = "state") {
  let entry;
  if (typeof arg === "string" && state === undefined) {
    entry = { kind: "state", state: arg, name: arg };
  } else {
    entry = { kind, state, name: arg };
  }
  const idx = _pinned.findIndex((p) => _eq(p, entry));
  if (idx >= 0) {
    _pinned.splice(idx, 1);
  } else {
    if (_pinned.length >= MAX_PINS) _pinned.shift();
    _pinned.push(entry);
  }
  _savePinned();
  if (_onChange) _onChange();
}

export function clearPins() {
  _pinned = [];
  _savePinned();
  if (_onChange) _onChange();
}

export function onChange(fn) { _onChange = fn; }

// Build the comparison table given the current pins.
//   stateBreakdownFor(name)        → state's module list
//   cityBreakdownFor(state, name)  → city's module list (or null)
export function renderCompare(stateBreakdownFor, cityBreakdownFor) {
  const card = document.getElementById("compare-card");
  const wrap = document.getElementById("compare-table-wrap");
  const summary = document.getElementById("compare-summary");

  if (_pinned.length < 1) {
    card.classList.add("hidden");
    wrap.innerHTML = "";
    return;
  }
  card.classList.remove("hidden");
  const cityCount = _pinned.filter((p) => p.kind === "city").length;
  const stateCount = _pinned.length - cityCount;
  summary.textContent = _pinned.length === 1
    ? "Pin another place to compare"
    : `${stateCount} state${stateCount === 1 ? "" : "s"}` +
      (cityCount ? ` · ${cityCount} cit${cityCount === 1 ? "y" : "ies"}` : "") +
      " pinned";

  // Gather rows once per pinned entry.
  const breakdowns = _pinned.map((p) => {
    let rows = [];
    if (p.kind === "state") rows = stateBreakdownFor(p.name) || [];
    else if (cityBreakdownFor) rows = cityBreakdownFor(p.state, p.name) || [];
    return {
      ...p,
      title: p.kind === "city" ? `${p.name}, ${_postal(p.state)}` : p.name,
      sub: p.kind === "city" ? "City" : "State",
      rows,
    };
  });

  // Module list (assume all states have the same modules; use first as
  // reference, fall back to union otherwise).
  const ref = breakdowns[0]?.rows || [];
  const modules = ref.map((r) => ({
    id: r.module_id,
    label: r.label,
    unit: r.unit,
    category: r.category,
  }));

  // Group modules by category for readability.
  const grouped = new Map();
  for (const m of modules) {
    if (!grouped.has(m.category)) grouped.set(m.category, []);
    grouped.get(m.category).push(m);
  }

  let html = '<table class="compare-table"><thead><tr><th>Factor</th>';
  for (const b of breakdowns) {
    const removeData = `data-kind="${b.kind}" data-state="${b.state.replace(/"/g, "&quot;")}" data-name="${b.name.replace(/"/g, "&quot;")}"`;
    html += `<th><div class="compare-col-title">${b.title}<button class="col-remove" ${removeData} title="Remove">×</button></div><div class="compare-col-sub">${b.sub}</div></th>`;
  }
  html += "</tr></thead><tbody>";

  for (const [cat, ms] of grouped) {
    html += `<tr class="category-row"><td colspan="${1 + breakdowns.length}">${cat}</td></tr>`;
    for (const m of ms) {
      // Pull each state's value for this module.
      const cells = breakdowns.map((b) => {
        const row = b.rows.find((r) => r.module_id === m.id);
        return row || null;
      });
      const norms = cells.map((c) => (c ? c.normalized : null));
      const validNorms = norms.filter((n) => n != null);
      const max = Math.max(...validNorms, -Infinity);
      const min = Math.min(...validNorms, Infinity);

      html += `<tr><td title="${m.unit || ""}">${m.label}</td>`;
      for (const c of cells) {
        if (!c) {
          html += `<td><span class="compare-cell" style="opacity:0.4">—</span></td>`;
          continue;
        }
        const cls = ["compare-cell"];
        if (validNorms.length > 1 && c.normalized === max) cls.push("best");
        if (validNorms.length > 1 && c.normalized === min) cls.push("worst");
        const bar = `<span class="bar" style="width:${Math.round(c.normalized * 100)}%"></span>`;
        html += `<td><span class="${cls.join(" ")}">${_fmt(c.value)}${c.unit ? " " + c.unit : ""}${bar}</span></td>`;
      }
      html += "</tr>";
    }
  }

  html += "</tbody></table>";
  wrap.innerHTML = html;

  // Wire per-column remove buttons.
  wrap.querySelectorAll(".col-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      togglePin(btn.dataset.name, btn.dataset.state, btn.dataset.kind);
    });
  });
}

const POSTAL = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR",
  California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI",
  Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
  Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX",
  Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA",
  "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};
function _postal(state) { return POSTAL[state] || state; }

function _fmt(v) {
  if (v == null || isNaN(v)) return "—";
  if (Math.abs(v) >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 100)   return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(v) >= 1)     return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

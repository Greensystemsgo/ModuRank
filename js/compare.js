// Compare 2-4 pinned states side-by-side across every module.

const MAX_PINS = 4;
const STORAGE_KEY = "moduRank.pins";

let _pinned = _loadPinned();
let _onChange = null;

function _loadPinned() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
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

export function getPinned() {
  return [..._pinned];
}

export function isPinned(stateName) {
  return _pinned.includes(stateName);
}

export function togglePin(stateName) {
  if (isPinned(stateName)) {
    _pinned = _pinned.filter((s) => s !== stateName);
  } else {
    if (_pinned.length >= MAX_PINS) _pinned.shift();
    _pinned.push(stateName);
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
// `breakdownFor` is a function (stateName) → list of {module_id, label,
// category, unit, value, normalized}.
export function renderCompare(breakdownFor) {
  const card = document.getElementById("compare-card");
  const wrap = document.getElementById("compare-table-wrap");
  const summary = document.getElementById("compare-summary");

  if (_pinned.length < 1) {
    card.classList.add("hidden");
    wrap.innerHTML = "";
    return;
  }
  card.classList.remove("hidden");
  summary.textContent = _pinned.length === 1
    ? "Pin another state to compare"
    : `${_pinned.length} states pinned`;

  // Gather rows once per pinned state.
  const breakdowns = _pinned.map((name) => ({ name, rows: breakdownFor(name) }));

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
    html += `<th>${b.name} <button class="col-remove" data-state="${b.name.replace(/"/g, "&quot;")}" title="Remove">×</button></th>`;
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
    btn.addEventListener("click", () => togglePin(btn.dataset.state));
  });
}

function _fmt(v) {
  if (v == null || isNaN(v)) return "—";
  if (Math.abs(v) >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 100)   return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(v) >= 1)     return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

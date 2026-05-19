// Renders one slider per module and exposes weight reads + change listener.
// Each row has an on/off toggle: off = weight 0 = excluded from scoring.

const DEFAULT_WEIGHT = 50;
let _modules = [];
let _listener = null;

// Remembers the last non-zero weight so toggling back on restores it.
const _lastWeight = new Map();

const CATEGORY_ORDER = [
  "Cost & Taxes",
  "Housing",
  "Economy",
  "Demographics",
  "Climate",
  "Safety & Risk",
  "Outdoors",
  "Politics & Culture",
  "Other",
];

const ALL_TAB = "All";
let _activeTab = ALL_TAB;
let _tabBar = null;

function _groupByCategory(modules) {
  const groups = new Map();
  for (const m of modules) {
    const cat = m.category || "Other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(m);
  }
  const ordered = [];
  for (const cat of CATEGORY_ORDER) {
    if (groups.has(cat)) ordered.push([cat, groups.get(cat)]);
    groups.delete(cat);
  }
  for (const [cat, ms] of groups) ordered.push([cat, ms]);
  return ordered;
}

export function renderSliders(modules) {
  _modules = modules;
  const container = document.getElementById("sliders");
  container.innerHTML = "";

  const grouped = _groupByCategory(modules);

  // Tab bar
  _tabBar = document.createElement("div");
  _tabBar.className = "tab-bar";
  _tabBar.append(_makeTab(ALL_TAB, modules.length));
  for (const [cat, group] of grouped) _tabBar.append(_makeTab(cat, group.length));
  container.append(_tabBar);

  // Sections (always rendered; visibility toggled by tab)
  for (const [cat, group] of grouped) {
    const section = document.createElement("section");
    section.className = "slider-group";
    section.dataset.category = cat;

    const header = document.createElement("h3");
    header.className = "slider-group-header";
    header.textContent = cat;
    header.append(_categoryCount(group));
    section.append(header);

    const grid = document.createElement("div");
    grid.className = "slider-group-grid";
    section.append(grid);

    for (const m of group) {
      _lastWeight.set(m.id, DEFAULT_WEIGHT);
      grid.append(_renderRow(m));
    }
    container.append(section);
  }
  _applyTabFilter();
}

function _makeTab(name, count) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tab" + (name === _activeTab ? " active" : "");
  btn.dataset.tab = name;
  const labelSpan = document.createElement("span");
  labelSpan.textContent = name;
  const countSpan = document.createElement("span");
  countSpan.className = "tab-count";
  countSpan.textContent = String(count);
  btn.append(labelSpan, countSpan);
  btn.addEventListener("click", () => {
    _activeTab = name;
    for (const t of _tabBar.querySelectorAll(".tab")) {
      t.classList.toggle("active", t.dataset.tab === name);
    }
    _applyTabFilter();
  });
  return btn;
}

function _applyTabFilter() {
  for (const section of document.querySelectorAll(".slider-group")) {
    const visible = _activeTab === ALL_TAB || section.dataset.category === _activeTab;
    section.style.display = visible ? "" : "none";
    // When a tab is active (not "All"), hide the redundant header.
    const header = section.querySelector(".slider-group-header");
    if (header) header.style.display = (_activeTab === ALL_TAB) ? "" : "none";
  }
}

function _categoryCount(group) {
  const span = document.createElement("span");
  span.className = "slider-group-count";
  span.textContent = `${group.length}`;
  return span;
}

function _renderRow(m) {
    const row = document.createElement("div");
    row.className = "slider-row";
    row.dataset.moduleId = m.id;

    const labelLine = document.createElement("div");
    labelLine.className = "label-line";

    const left = document.createElement("span");
    left.className = "label-left";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toggle on";
    toggle.setAttribute("aria-pressed", "true");
    toggle.title = "Click to ignore this factor";
    toggle.textContent = "on";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = m.label;

    left.append(toggle, label);

    const weight = document.createElement("span");
    weight.className = "weight";
    weight.textContent = String(DEFAULT_WEIGHT);

    labelLine.append(left, weight);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(DEFAULT_WEIGHT);

    const desc = document.createElement("p");
    desc.className = "description";
    desc.textContent = m.description || "";

    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      weight.textContent = slider.value;
      if (v > 0) {
        _lastWeight.set(m.id, v);
        _setEnabled(row, true);
      } else {
        _setEnabled(row, false);
      }
      if (_listener) _listener();
    });

    toggle.addEventListener("click", () => {
      const enabled = !row.classList.contains("off");
      if (enabled) {
        const cur = Number(slider.value);
        if (cur > 0) _lastWeight.set(m.id, cur);
        slider.value = "0";
        weight.textContent = "off";
        _setEnabled(row, false);
      } else {
        const restored = _lastWeight.get(m.id) || DEFAULT_WEIGHT;
        slider.value = String(restored);
        weight.textContent = String(restored);
        _setEnabled(row, true);
      }
      if (_listener) _listener();
    });

    row.append(labelLine, slider, desc);
    return row;
}

function _setEnabled(row, enabled) {
  row.classList.toggle("off", !enabled);
  const toggle = row.querySelector(".toggle");
  toggle.classList.toggle("on", enabled);
  toggle.classList.toggle("off", !enabled);
  toggle.textContent = enabled ? "on" : "off";
  toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
  toggle.title = enabled ? "Click to ignore this factor" : "Click to include this factor";
  const weight = row.querySelector(".weight");
  if (!enabled) weight.textContent = "off";
}

export function getWeights() {
  return _modules.map((m) => {
    const el = document.querySelector(`.slider-row[data-module-id="${m.id}"] input`);
    return { id: m.id, label: m.label, weight: el ? Number(el.value) : 0 };
  });
}

export function resetWeights() {
  for (const m of _modules) {
    const row = document.querySelector(`.slider-row[data-module-id="${m.id}"]`);
    if (!row) continue;
    row.querySelector("input").value = String(DEFAULT_WEIGHT);
    row.querySelector(".weight").textContent = String(DEFAULT_WEIGHT);
    _lastWeight.set(m.id, DEFAULT_WEIGHT);
    _setEnabled(row, true);
  }
}

export function randomizeWeights() {
  for (const m of _modules) {
    const row = document.querySelector(`.slider-row[data-module-id="${m.id}"]`);
    if (!row) continue;
    const v = 1 + Math.floor(Math.random() * 100);
    row.querySelector("input").value = String(v);
    row.querySelector(".weight").textContent = String(v);
    _lastWeight.set(m.id, v);
    _setEnabled(row, true);
  }
}

// Apply a {moduleId: weight} map from a shared URL.
export function applyWeights(weightMap) {
  for (const m of _modules) {
    const row = document.querySelector(`.slider-row[data-module-id="${m.id}"]`);
    if (!row) continue;
    const v = weightMap[m.id];
    if (v === undefined) continue;
    row.querySelector("input").value = String(v);
    row.querySelector(".weight").textContent = v === 0 ? "off" : String(v);
    if (v > 0) {
      _lastWeight.set(m.id, v);
      _setEnabled(row, true);
    } else {
      _setEnabled(row, false);
    }
  }
}

export function onWeightsChange(fn) { _listener = fn; }

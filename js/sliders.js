// Renders one slider per module and exposes weight reads + change listener.
// Each row has an on/off toggle: off = weight 0 = excluded from scoring.
// Each row also has a direction toggle: respects the module's natural
// direction by default, but the user can flip it (e.g., for humidity:
// default "drier = better" → user flips to "wetter = better").

const DEFAULT_WEIGHT = 50;
let _modules = [];
let _listener = null;
let _simpleMode = false;

const _lastWeight = new Map();
const _flipped = new Map();

const CATEGORY_ORDER = [
  "Cost & Taxes",
  "Housing",
  "Economy",
  "Demographics",
  "Education",
  "Health",
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
    row.className = "slider-row compact";
    row.dataset.moduleId = m.id;
    if (m.description) row.title = m.description;
    _flipped.set(m.id, false);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toggle on";
    toggle.setAttribute("aria-pressed", "true");
    toggle.title = "Click to ignore this factor";
    toggle.textContent = "on";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = m.label;
    if (m.description) label.title = m.description;

    // Info icon — tap to show description (mobile-friendly).
    const info = document.createElement("button");
    info.type = "button";
    info.className = "info-btn";
    info.textContent = "i";
    info.title = m.description || "";
    info.setAttribute("aria-label", `About ${m.label}`);
    info.addEventListener("click", (e) => {
      e.stopPropagation();
      _showInfoPopover(info, m);
    });
    label.append(" ");
    label.append(info);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(DEFAULT_WEIGHT);
    slider.title = m.description || "";

    const weight = document.createElement("span");
    weight.className = "weight";
    weight.textContent = String(DEFAULT_WEIGHT);

    // Direction button — shows arrow indicating "want HIGH" (↑) or "want LOW" (↓).
    // Defaults reflect the module's lower_is_better: true → ↓, false → ↑.
    const dirBtn = document.createElement("button");
    dirBtn.type = "button";
    dirBtn.className = "dir-btn";
    const naturalLow = !!m.lower_is_better;
    dirBtn.dataset.naturalLow = naturalLow ? "1" : "0";
    _setDirVisual(dirBtn, naturalLow);
    dirBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const cur = _flipped.get(m.id);
      _flipped.set(m.id, !cur);
      _setDirVisual(dirBtn, _effectiveLowerIsBetter(m.id, naturalLow));
      if (_listener) _listener();
    });

    // (No separate description element — it lives on the row's title attr.)
    const desc = document.createElement("span");
    desc.className = "description";
    desc.textContent = "";  // kept for backwards-compat with _setEnabled queries

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

    row.append(toggle, label, slider, weight, dirBtn);
    return row;
}

function _effectiveLowerIsBetter(moduleId, naturalLow) {
  // If user flipped, invert the natural direction.
  return _flipped.get(moduleId) ? !naturalLow : naturalLow;
}

function _setDirVisual(btn, lowerIsBetter) {
  btn.textContent = lowerIsBetter ? "↓" : "↑";
  btn.title = lowerIsBetter
    ? "Lower is better — click to flip (more = better)"
    : "Higher is better — click to flip (less = better)";
}

let _activeInfoPopover = null;
function _showInfoPopover(anchor, m) {
  if (_activeInfoPopover) {
    _activeInfoPopover.remove();
    _activeInfoPopover = null;
  }
  const pop = document.createElement("div");
  pop.className = "info-popover";
  pop.innerHTML = `
    <div class="info-popover-title">${_esc(m.label)}</div>
    <div class="info-popover-body">${_esc(m.description || "")}</div>
    <div class="info-popover-meta">
      ${m.unit ? `<span><b>Unit:</b> ${_esc(m.unit)}</span>` : ""}
      <span><b>Direction:</b> ${m.lower_is_better ? "Lower is better" : "Higher is better"}</span>
      ${m.source ? `<span><b>Source:</b> ${_esc(m.source)}</span>` : ""}
    </div>
  `;
  document.body.appendChild(pop);

  const rect = anchor.getBoundingClientRect();
  pop.style.position = "fixed";
  pop.style.left = `${Math.min(window.innerWidth - 320, rect.left)}px`;
  pop.style.top = `${rect.bottom + 4}px`;

  const dismiss = (e) => {
    if (e && (pop.contains(e.target) || anchor.contains(e.target))) return;
    pop.remove();
    _activeInfoPopover = null;
    document.removeEventListener("click", dismiss);
  };
  setTimeout(() => document.addEventListener("click", dismiss), 0);
  _activeInfoPopover = pop;
}

function _esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
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
    return {
      id: m.id,
      label: m.label,
      weight: el ? Number(el.value) : 0,
      flipped: !!_flipped.get(m.id),
    };
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

// Apply a {moduleId: {weight, flipped} | weight} map from a shared URL or preset.
export function applyWeights(weightMap) {
  for (const m of _modules) {
    const row = document.querySelector(`.slider-row[data-module-id="${m.id}"]`);
    if (!row) continue;
    let entry = weightMap[m.id];
    if (entry === undefined) continue;
    // Accept either a raw number (presets) or {weight, flipped} (URL hash).
    let v, flipped = false;
    if (typeof entry === "object") {
      v = entry.weight;
      flipped = !!entry.flipped;
    } else {
      v = entry;
    }
    row.querySelector("input").value = String(v);
    row.querySelector(".weight").textContent = v === 0 ? "off" : String(v);
    if (v > 0) {
      _lastWeight.set(m.id, v);
      _setEnabled(row, true);
    } else {
      _setEnabled(row, false);
    }
    // Apply direction.
    _flipped.set(m.id, flipped);
    const dirBtn = row.querySelector(".dir-btn");
    if (dirBtn) {
      const naturalLow = dirBtn.dataset.naturalLow === "1";
      _setDirVisual(dirBtn, _effectiveLowerIsBetter(m.id, naturalLow));
    }
  }
}

export function onWeightsChange(fn) { _listener = fn; }

// Simple mode: one slider per category. Sets all modules in that category
// to the same weight. Toggled via the Simple/Advanced buttons in the UI.
let _simpleSlidersEl = null;

export function setSliderMode(mode) {
  _simpleMode = mode === "simple";
  const advancedEl = document.getElementById("sliders");
  if (!advancedEl) return;

  // Toggle visibility of advanced sliders (tab bar + groups)
  const tabBar = advancedEl.querySelector(".tab-bar");
  const groups = advancedEl.querySelectorAll(".slider-group");
  if (_simpleMode) {
    if (tabBar) tabBar.style.display = "none";
    groups.forEach((g) => { g.style.display = "none"; });
    _ensureSimpleSliders(advancedEl);
    _simpleSlidersEl.style.display = "";
  } else {
    if (tabBar) tabBar.style.display = "";
    _applyTabFilter();
    if (_simpleSlidersEl) _simpleSlidersEl.style.display = "none";
  }
}

function _ensureSimpleSliders(container) {
  if (_simpleSlidersEl) return;
  _simpleSlidersEl = document.createElement("div");
  _simpleSlidersEl.className = "simple-sliders";

  const grouped = _groupByCategory(_modules);
  for (const [cat, group] of grouped) {
    const row = document.createElement("div");
    row.className = "slider-row compact";
    row.dataset.category = cat;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toggle on";
    toggle.setAttribute("aria-pressed", "true");
    toggle.textContent = "on";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = `${cat} (${group.length})`;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(DEFAULT_WEIGHT);

    const weight = document.createElement("span");
    weight.className = "weight";
    weight.textContent = String(DEFAULT_WEIGHT);

    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      weight.textContent = v === 0 ? "off" : String(v);
      _setCategoryWeight(cat, v);
      if (v > 0) {
        row.classList.remove("off");
        toggle.classList.add("on"); toggle.classList.remove("off");
        toggle.textContent = "on";
      } else {
        row.classList.add("off");
        toggle.classList.remove("on"); toggle.classList.add("off");
        toggle.textContent = "off";
      }
      if (_listener) _listener();
    });

    toggle.addEventListener("click", () => {
      const isOn = !row.classList.contains("off");
      if (isOn) {
        slider.value = "0";
        weight.textContent = "off";
        _setCategoryWeight(cat, 0);
        row.classList.add("off");
        toggle.classList.remove("on"); toggle.classList.add("off");
        toggle.textContent = "off";
      } else {
        slider.value = String(DEFAULT_WEIGHT);
        weight.textContent = String(DEFAULT_WEIGHT);
        _setCategoryWeight(cat, DEFAULT_WEIGHT);
        row.classList.remove("off");
        toggle.classList.add("on"); toggle.classList.remove("off");
        toggle.textContent = "on";
      }
      if (_listener) _listener();
    });

    row.append(toggle, label, slider, weight);
    _simpleSlidersEl.append(row);
  }
  container.append(_simpleSlidersEl);
}

function _setCategoryWeight(cat, value) {
  for (const m of _modules) {
    if ((m.category || "Other") !== cat) continue;
    const row = document.querySelector(`.slider-row[data-module-id="${m.id}"]`);
    if (!row) continue;
    row.querySelector("input").value = String(value);
    row.querySelector(".weight").textContent = value === 0 ? "off" : String(value);
    if (value > 0) {
      _lastWeight.set(m.id, value);
      _setEnabled(row, true);
    } else {
      _setEnabled(row, false);
    }
  }
}

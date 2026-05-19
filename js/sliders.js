// Renders one slider per module and exposes weight reads + change listener.
// Each row has an on/off toggle: off = weight 0 = excluded from scoring.

const DEFAULT_WEIGHT = 50;
let _modules = [];
let _listener = null;

// Remembers the last non-zero weight so toggling back on restores it.
const _lastWeight = new Map();

export function renderSliders(modules) {
  _modules = modules;
  const container = document.getElementById("sliders");
  container.innerHTML = "";

  for (const m of modules) {
    _lastWeight.set(m.id, DEFAULT_WEIGHT);

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
    container.append(row);
  }
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

export function onWeightsChange(fn) { _listener = fn; }

// Renders one slider per module and exposes weight reads + change listener.

const DEFAULT_WEIGHT = 50;
let _modules = [];
let _listener = null;

export function renderSliders(modules) {
  _modules = modules;
  const container = document.getElementById("sliders");
  container.innerHTML = "";

  for (const m of modules) {
    const row = document.createElement("div");
    row.className = "slider-row";
    row.dataset.moduleId = m.id;

    const labelLine = document.createElement("div");
    labelLine.className = "label-line";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = m.label;

    const weight = document.createElement("span");
    weight.className = "weight";
    weight.textContent = String(DEFAULT_WEIGHT);

    labelLine.append(label, weight);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(DEFAULT_WEIGHT);
    slider.addEventListener("input", () => {
      weight.textContent = slider.value;
      if (_listener) _listener();
    });

    const desc = document.createElement("p");
    desc.className = "description";
    desc.textContent = m.description || "";

    row.append(labelLine, slider, desc);
    container.append(row);
  }
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
  }
}

export function onWeightsChange(fn) { _listener = fn; }

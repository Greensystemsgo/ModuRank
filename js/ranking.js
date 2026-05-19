// Ordered list of states. Two modes:
//   weighted  — show 0-100 weighted-score percentile
//   single    — show that module's raw value with its unit

export function renderRanking(ranking, activeFactors, opts = {}) {
  const { mode = "weighted", moduleLabel = null } = opts;
  const ol = document.getElementById("ranking");
  const summary = document.getElementById("ranking-summary");
  ol.innerHTML = "";

  if (mode === "single") {
    summary.textContent = `Sorted by ${moduleLabel}`;
  } else {
    summary.textContent = activeFactors === 0
      ? "All sliders are at 0 — turn one up to rank states."
      : `${activeFactors} factor${activeFactors === 1 ? "" : "s"} active`;
  }

  ranking.forEach((r, idx) => {
    const li = document.createElement("li");
    if (idx < 3 && (mode === "single" || activeFactors > 0)) li.classList.add("top-rank");
    if (mode === "weighted" && activeFactors === 0) li.classList.add("disabled");

    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `#${idx + 1}`;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = r.state;

    const score = document.createElement("span");
    score.className = "score";
    if (mode === "single") {
      score.textContent = _fmt(r.value) + (r.unit ? ` ${r.unit}` : "");
    } else {
      score.textContent = activeFactors === 0 ? "—" : (r.score * 100).toFixed(1);
    }

    li.append(rank, name, score);
    ol.append(li);
  });
}

function _fmt(v) {
  if (Math.abs(v) >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 100)   return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(v) >= 1)     return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

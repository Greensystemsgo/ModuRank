// Ordered list of states. Modes:
//   weighted  — show 0-100 weighted-score percentile
//   single    — show that module's raw value with its unit
//   cities    — same as weighted but for cities in a focused state
//
// State Profile view (renderStateProfile) lives in this file too — same card,
// different panel, swapped by the tabs in the card header.

import { isPinned, togglePin } from "./compare.js";

export function renderRanking(ranking, activeFactors, opts = {}) {
  const { mode = "weighted", moduleLabel = null, focusedState = null } = opts;
  const ol = document.getElementById("ranking");
  const summary = document.getElementById("ranking-summary");
  const heading = document.querySelector(".ranking-card .card-header h2");
  ol.innerHTML = "";

  if (heading) {
    heading.textContent = mode === "cities" ? `Cities in ${focusedState}` : "Ranking";
  }

  if (mode === "single") {
    summary.textContent = `Sorted by ${moduleLabel}`;
  } else if (mode === "cities") {
    summary.textContent = activeFactors === 0
      ? "Turn up a slider to rank these cities"
      : `${ranking.length} cities scored`;
  } else {
    summary.textContent = activeFactors === 0
      ? "All sliders are at 0 — turn one up to rank states."
      : `${activeFactors} factor${activeFactors === 1 ? "" : "s"} active`;
  }

  // Sort cities by score descending; states should already be sorted.
  if (mode === "cities") {
    ranking = [...ranking].sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  // Cap to top 15 by default; user can expand. Keeps the column scannable.
  const COLLAPSED_LIMIT = 15;
  const expanded = ol.dataset.expanded === "1";
  const visible = expanded ? ranking : ranking.slice(0, COLLAPSED_LIMIT);

  visible.forEach((r, idx) => {
    const li = document.createElement("li");
    if (idx < 3 && (mode === "single" || mode === "cities" || activeFactors > 0)) li.classList.add("top-rank");
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
    } else if (mode === "cities") {
      score.textContent = r.score != null ? (r.score * 100).toFixed(1) : "—";
    } else {
      score.textContent = activeFactors === 0 ? "—" : (r.score * 100).toFixed(1);
    }

    const pinBtn = document.createElement("button");
    pinBtn.className = "pin-btn";
    let pinnedHere;
    if (mode === "cities") {
      pinnedHere = isPinned(r.state, focusedState, "city");
    } else {
      pinnedHere = isPinned(r.state);
    }
    pinBtn.textContent = pinnedHere ? "Pinned" : "Pin";
    pinBtn.title = pinnedHere ? "Remove from compare" : "Add to compare";
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (mode === "cities") togglePin(r.state, focusedState, "city");
      else togglePin(r.state);
    });
    if (pinnedHere) li.classList.add("pinned");
    li.append(rank, name, score, pinBtn);
    ol.append(li);
  });

  // "Show all" expander
  if (ranking.length > COLLAPSED_LIMIT) {
    const li = document.createElement("li");
    li.className = "ranking-expand";
    const btn = document.createElement("button");
    btn.className = "btn-secondary";
    btn.textContent = expanded
      ? `Show top 15`
      : `Show all ${ranking.length}`;
    btn.addEventListener("click", () => {
      ol.dataset.expanded = expanded ? "0" : "1";
      renderRanking(ranking, activeFactors, opts);
    });
    li.append(btn);
    ol.append(li);
  }
}

function _fmt(v) {
  if (Math.abs(v) >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 100)   return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(v) >= 1)     return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

// "Work backwards" view — pick a state, see how it ranks across every module
// bucketed by category. Rows are passed in pre-ranked (see getStateProfile in
// data.js); we just lay them out and color the percentile bar.
export function renderStateProfile(rows, stateName) {
  const wrap = document.getElementById("state-profile");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!rows || !rows.length) {
    wrap.innerHTML = `<div class="profile-summary">No data for ${stateName}.</div>`;
    return;
  }

  const top5 = rows.filter((r) => r.rnk <= 5).length;
  const bottom5 = rows.filter((r) => r.total - r.rnk + 1 <= 5).length;
  const summary = document.createElement("div");
  summary.className = "profile-summary";
  summary.innerHTML =
    `<b>${stateName}</b> &middot; ${rows.length} modules &middot; ` +
    `top-5 in <b>${top5}</b> &middot; bottom-5 in <b>${bottom5}</b>`;
  wrap.append(summary);

  // Group by category, preserve a stable order based on best-rank-in-category
  // so the state's strongest categories surface first.
  const byCat = new Map();
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category).push(r);
  }
  const catOrder = [...byCat.entries()]
    .map(([cat, list]) => [cat, Math.min(...list.map((r) => r.rnk))])
    .sort((a, b) => a[1] - b[1])
    .map(([cat]) => cat);

  for (const cat of catOrder) {
    const list = byCat.get(cat);
    const section = document.createElement("div");
    section.className = "profile-cat";

    const title = document.createElement("div");
    title.className = "profile-cat-title";
    title.textContent = cat;
    section.append(title);

    list.sort((a, b) => a.rnk - b.rnk);
    for (const row of list) {
      const pct = row.total > 1 ? (row.total - row.rnk) / (row.total - 1) : 1;
      const isTop = row.rnk <= 5;
      const isBottom = row.total - row.rnk + 1 <= 5;
      const rankClass = isTop ? "p-rank-good" : isBottom ? "p-rank-bad" : "";

      const r = document.createElement("div");
      r.className = "profile-row";
      r.innerHTML =
        `<span class="p-label">${row.label}</span>` +
        `<span class="p-value">${_fmtProfileValue(row)}</span>` +
        `<span class="p-rank ${rankClass}">#${row.rnk}/${row.total}</span>` +
        `<div class="profile-bar"><div class="profile-bar-fill"` +
        ` style="width:${(pct * 100).toFixed(1)}%;background:hsl(${(pct * 120).toFixed(0)}, 60%, 50%)"></div></div>`;
      section.append(r);
    }
    wrap.append(section);
  }
}

function _fmtProfileValue(row) {
  const v = row.value;
  const u = row.unit || "";
  const s = _fmt(v);
  return u ? `${s} ${u}` : s;
}

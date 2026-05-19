// Ordered list of states with their weighted score.

export function renderRanking(ranking, activeFactors) {
  const ol = document.getElementById("ranking");
  const summary = document.getElementById("ranking-summary");
  ol.innerHTML = "";

  summary.textContent = activeFactors === 0
    ? "All sliders are at 0 — turn one up to rank states."
    : `${activeFactors} factor${activeFactors === 1 ? "" : "s"} active`;

  ranking.forEach((r, idx) => {
    const li = document.createElement("li");
    if (idx < 3 && activeFactors > 0) li.classList.add("top-rank");
    if (activeFactors === 0) li.classList.add("disabled");

    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `#${idx + 1}`;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = r.state;

    const score = document.createElement("span");
    score.className = "score";
    score.textContent = activeFactors === 0 ? "—" : (r.score * 100).toFixed(1);

    li.append(rank, name, score);
    ol.append(li);
  });
}

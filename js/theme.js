// Dark/light mode toggle. Persists choice in localStorage.

const KEY = "moduRank.theme";

export function initTheme() {
  const stored = localStorage.getItem(KEY);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const initial = stored || (prefersDark ? "dark" : "light");
  applyTheme(initial);

  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem(KEY, next);
    });
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

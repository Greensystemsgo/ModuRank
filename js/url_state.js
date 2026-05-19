// Encode active slider weights into the URL hash so the page is shareable.
//
// Format: #cost_of_living=100,gun_friendliness=80,...
// Omitted modules default to enabled at DEFAULT_WEIGHT; weight=0 means
// disabled (toggle off).

const DEFAULT_WEIGHT = 50;

export function readHash() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;
  const out = {};
  for (const pair of raw.split(",")) {
    const [k, v] = pair.split("=");
    if (!k) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = Math.max(0, Math.min(100, Math.round(n)));
  }
  return Object.keys(out).length ? out : null;
}

// Debounced writer so dragging the slider doesn't spam history.
let _writeTimer = null;
export function writeHash(weights) {
  clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    const parts = weights
      .filter((w) => w.weight !== DEFAULT_WEIGHT) // omit defaults for short URLs
      .map((w) => `${w.id}=${w.weight}`);
    const hash = parts.length ? `#${parts.join(",")}` : "";
    if (hash !== window.location.hash) {
      // Use replaceState so back-button doesn't fill up with weight nudges.
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    }
  }, 250);
}

export async function copyShareLink() {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // Fallback for older browsers / non-secure contexts.
    const ta = document.createElement("textarea");
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    ta.remove();
    return ok;
  }
}

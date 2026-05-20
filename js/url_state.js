// Encode active slider weights into the URL hash so the page is shareable.
//
// Format: #cost_of_living=80,humidity=-50,gun_friendliness=0
// - Positive int: weight, module uses its natural direction
// - Negative int: weight magnitude, module direction is flipped
// - Omitted: default weight (50), natural direction
// - 0: disabled (toggle off)

const DEFAULT_WEIGHT = 50;

export function readHash() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;
  const out = {};
  for (const pair of raw.split(",")) {
    const [k, v] = pair.split("=");
    if (!k) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const abs = Math.min(100, Math.abs(Math.round(n)));
    out[k] = { weight: abs, flipped: n < 0 };
  }
  return Object.keys(out).length ? out : null;
}

// Debounced writer so dragging the slider doesn't spam history.
let _writeTimer = null;
export function writeHash(weights) {
  clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    const parts = weights
      .filter((w) => w.weight !== DEFAULT_WEIGHT || w.flipped) // omit defaults for short URLs
      .map((w) => `${w.id}=${(w.flipped ? -1 : 1) * w.weight}`);
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

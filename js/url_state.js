// Shareable URL state: weights + direction flips + pinned places.
//
// Hash uses & to separate sections:
//   #w=cost_of_living:80,humidity:-50&pins=s:Texas,c:Texas:Austin,c:Colorado:Denver
//
// w= section:
//   key:value pairs comma-separated
//   value positive = natural direction, negative = flipped
//   missing = default weight (50), 0 = disabled
//
// pins= section:
//   's:STATE'           = pinned state
//   'c:STATE:CITY'      = pinned city
//
// Backwards-compat: hashes without an "s=" prefix on the first section
// are parsed as the old plain weights format.

const DEFAULT_WEIGHT = 50;

export function readHash() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;
  const out = { weights: null, pins: null };

  // Two formats supported:
  //   New:  "w=...&pins=..." (sections)
  //   Old:  "cost_of_living=80,humidity=-50" (just weights)
  let weightsPart = null, pinsPart = null;
  if (raw.includes("=") && (raw.startsWith("w=") || raw.includes("&"))) {
    // Sectioned format.
    for (const section of raw.split("&")) {
      const [k, v] = _splitOnce(section, "=");
      if (k === "w") weightsPart = v;
      else if (k === "pins") pinsPart = v;
    }
  } else {
    // Old format: the entire hash is the weights list.
    weightsPart = raw;
  }

  if (weightsPart) {
    const w = {};
    for (const pair of weightsPart.split(",")) {
      const [k, v] = _splitOnce(pair, ":");
      const altK = k && (v === undefined ? null : k);
      // Tolerate old hashes using "=" inside the weights chunk too.
      const [k2, v2] = v === undefined ? _splitOnce(pair, "=") : [altK, v];
      const key = k2;
      const valStr = v2;
      if (!key) continue;
      const n = Number(valStr);
      if (!Number.isFinite(n)) continue;
      const abs = Math.min(100, Math.abs(Math.round(n)));
      w[key] = { weight: abs, flipped: n < 0 };
    }
    out.weights = Object.keys(w).length ? w : null;
  }

  if (pinsPart) {
    const pins = [];
    for (const tok of pinsPart.split(",")) {
      const parts = tok.split(":");
      if (parts[0] === "s" && parts[1]) {
        const state = decodeURIComponent(parts[1]);
        pins.push({ kind: "state", state, name: state });
      } else if (parts[0] === "c" && parts[1] && parts[2]) {
        pins.push({
          kind: "city",
          state: decodeURIComponent(parts[1]),
          name: decodeURIComponent(parts.slice(2).join(":")),
        });
      }
    }
    out.pins = pins.length ? pins : null;
  }

  if (!out.weights && !out.pins) return null;
  return out;
}

let _writeTimer = null;
export function writeHash(weights, pins) {
  clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    const sections = [];
    const weightParts = (weights || [])
      .filter((w) => w.weight !== DEFAULT_WEIGHT || w.flipped)
      .map((w) => `${w.id}:${(w.flipped ? -1 : 1) * w.weight}`);
    if (weightParts.length) sections.push("w=" + weightParts.join(","));

    if (pins && pins.length) {
      const pinParts = pins.map((p) => {
        if (p.kind === "state") return `s:${encodeURIComponent(p.state)}`;
        return `c:${encodeURIComponent(p.state)}:${encodeURIComponent(p.name)}`;
      });
      sections.push("pins=" + pinParts.join(","));
    }

    const hash = sections.length ? `#${sections.join("&")}` : "";
    if (hash !== window.location.hash) {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    }
  }, 250);
}

function _splitOnce(s, sep) {
  const i = s.indexOf(sep);
  return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
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

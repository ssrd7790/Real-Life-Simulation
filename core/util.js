// Gate 4 core/util — tiny primitives with EXACT engine semantics.
// Duplicated (not imported) so core/* never imports engine.js: the import
// graph stays one-directional (engine -> render/context -> core/*), which
// keeps the browser ESM load cycle-safe. Drift guard: tests/differential-core
// (500 seeded cases) fails on any semantic divergence.
//   clamp100(v) === Math.max(0, Math.min(100, Math.round(v)))  [engine:1539]
//   isFiniteNum(v) === typeof v === "number" && Number.isFinite(v) [engine:271]
//   hasOwn: own-property check, never the `in` operator [engine:249]
export const clamp100 = (v) => Math.max(0, Math.min(100, Math.round(v)));

export function isFiniteNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

export function hasOwn(obj, k) {
  try {
    if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return false;
    if (typeof k !== "string") return false;
    return Object.prototype.hasOwnProperty.call(obj, k);
  } catch (_) { return false; }
}

// FNV-1a string hash -> uint32. Deterministic seed source for weather and
// schedule jitter (no Date.now/Math.random anywhere in core).
export function hashStr(s) {
  let h = 0x811c9dc5;
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — same algorithm as tests/helpers.mjs (independent copy so core
// has no test-only dependency). Takes a uint32 seed, returns a () => [0,1) fn.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Local Bengali-safe name normalization for scheduler relevance matching.
// Matching here is NEW behavior (no legacy equality constraint), so a local
// copy is safe: zero-width strip + whitespace collapse + lowercase.
export function normLocal(s) {
  try {
    return String(s ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
  } catch (_) { return ""; }
}

// Shared DOM + formatting primitives for the frontend (Gate 6).
// Leaf module: imports engine (shortMemText) + clock only. No DOM access
// at import time. Bodies moved verbatim from src/app.js.
import { shortMemText } from "../engine.js";
import { now as clockNow, rand as clockRand } from "../clock.js";

export const $ = (id) => document.getElementById(id);
export const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
export const escH = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const bnDigits = (s) => String(s).replace(/[0-9]/g, (c) => "০১২৩৪৫৬৭৮৯"[+c]);
// C3: tolerant memory-entry text for HUD (legacy string/null/object entries;
// never throws, never renders "[object Object]").
export const memText = (m) => { try { return shortMemText(m); } catch (_) { return ""; } };
// Issue #04: deep clone so a live sim never shares references with PRESETS.
// Why JSON fallback: structuredClone is preferred where available (handles all
// plain data); JSON clone covers older webviews. All preset data is JSON-safe.
export const deepClone = (o) => {
  if (o === null || o === undefined) return o;
  try {
    if (typeof structuredClone === "function") return structuredClone(o);
  } catch (_) {}
  return JSON.parse(JSON.stringify(o));
};
export function parseBnInt(s) {
  const bn = { "০": 0, "১": 1, "২": 2, "৩": 3, "৪": 4, "৫": 5, "৬": 6, "৭": 7, "৮": 8, "৯": 9 };
  let out = "";
  for (const ch of String(s)) out += ch in bn ? bn[ch] : ch;
  const m = out.match(/[0-9]+/);
  return m ? parseInt(m[0], 10) : null;
}
// Determinism seam: uid() reads via src/clock.js (production: Date.now/Math.random).
// Shape unchanged: prefix + base36 + digits. createdAt/updatedAt stay real.
export const uid = (p) => p + clockNow().toString(36) + Math.floor(clockRand() * 9999);

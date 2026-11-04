// Gate 3 reconcile: scale-aware windfall scrutiny (extracted verbatim from
// applyPatch's money block). Extraordinary positive deltas without a
// chronicle cause are clamped to the wealth-scaled threshold. `vals` is
// {cd, bd} and is mutated in place, exactly as the old locals were.
import { cov } from "../coverage.js";

export const BRANCHES = [
  "windfall:clamped",
  "windfall:pass",
];

export function clampWindfall(sim, patch, vals, windfallThreshold) {
  const hasChron = Array.isArray(patch.chronicle_add) && patch.chronicle_add.some((c) => String(c || "").trim().length > 0);
  const posTotal = Math.max(0, vals.cd) + Math.max(0, vals.bd);
  const thr = windfallThreshold(sim);
  if (posTotal > thr && !hasChron) {
    console.warn(`[rails] extraordinary windfall +${posTotal} without chronicle cause clamped to +${thr}.`);
    let allow = thr;
    if (vals.cd > 0) { const take = Math.min(vals.cd, allow); vals.cd = take; allow -= take; } else vals.cd = Math.min(0, vals.cd);
    if (vals.bd > 0) { const take = Math.min(vals.bd, allow); vals.bd = take; allow -= take; } else vals.bd = Math.min(0, vals.bd);
    cov("windfall:clamped");
  } else {
    cov("windfall:pass");
  }
}

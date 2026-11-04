// Gate 3 applier: STATS — per-turn stat rate limits (JS-backed gradual
// change; skips allow wider arcs). Runs inside the ECONOMY flow, before bills.
// Splice: verbatim applyPatch lines 1964-1980 (isSkip -> ctx.isSkip).
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { STAT_MAX_STEP_NORMAL, STAT_MAX_STEP_SKIP, clamp100, isFiniteNum } from "../../engine.js";

export const BRANCHES = [
  "stats:capped",
  "stats:entry",
  "stats:nonfinite",
];

export function validateStats(sim, patch, ctx) {
  return !!(patch && patch.stats);
}

export function applyStats(sim, patch, ctx) {
  cov("stats:entry");
  // Issue #10(i): per-turn stat rate limits (JS-backed gradual change).
  const statCap = ctx.isSkip ? STAT_MAX_STEP_SKIP : STAT_MAX_STEP_NORMAL;
  if (patch.stats) {
    for (const k of ["health", "mood", "satiety", "energy"]) {
      // M9: finite-only acceptance (isNaN let Infinity through to a windfall clamp).
      if (!isFiniteNum(patch.stats[k])) {
        if (typeof patch.stats[k] === "number") console.warn("[rails] non-finite stat rejected:", k);
        cov("stats:nonfinite");
        continue;
      }
        const target = clamp100(patch.stats[k]);
        const curV = clamp100(sim.stats[k]);
        const d = target - curV;
        const limited = Math.max(-statCap, Math.min(statCap, d));
        if (limited !== d) console.warn(`[rails] stat ${k} move ${curV}->${target} capped to ${curV + limited} (cap ±${statCap}).`);
        cov("stats:capped");
        sim.stats[k] = clamp100(curV + limited);
    }
  }
}

export const ENTRIES = [
  {
    id: "stats",
    key: "stats",
    phase: PHASES.ECONOMY,
    order: 40,
    owns: ["stats"],
    notes: "Stat teleport guard: normal beats ±25, skips ±60. Non-finite values rejected with a warning, never applied.",
    validate: validateStats,
    apply: applyStats,
  },
];

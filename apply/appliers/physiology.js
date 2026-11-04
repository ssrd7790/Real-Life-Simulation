// Gate 3 applier: PHYSIOLOGY — minimal coupling with fractional drain
// accumulator + daily cap, scaled by FULL elapsed hours against the LANDED
// zero flags (satiety/energy at 0 after landing). Dual-zero drains faster
// than single-zero. Critical set/cleared with player-visible notes.
// Gate 4: arithmetic lives in src/core/physiology.js (applier = order+rails,
// core = numbers). Splice origin: verbatim lines 2713-2750.
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { applyDrainAndCritical } from "../../core/physiology.js";
import { appendEvent, JOURNAL_OWN_KEYS } from "../../core/events.js";

export const BRANCHES = [
  "physiology:critical-set",
  "physiology:drained",
  "physiology:entry",
  "physiology:recovered",
];

export function validatePhysiology(sim, patch, ctx) {
  return true; // always runs: zero flags are landed state
}

export function applyPhysiology(sim, patch, ctx) {
  cov("physiology:entry");
  const wasCrit = !!(sim.critical && sim.critical.active);
  applyDrainAndCritical(sim, ctx.hrsFull, { warn: (m) => console.warn(m), mark: (id) => cov(id) });
  try {
    const isCrit = !!(sim.critical && sim.critical.active);
    if (isCrit && !wasCrit) appendEvent(sim, { kind: "health", actors: [], text: `সংকট: শরীর ভেঙে পড়েছে — নড়াচড়ার শক্তি নেই।`, weight: 5, narrated: false });
    else if (!isCrit && wasCrit) appendEvent(sim, { kind: "health", actors: [], text: `সেরে ওঠা: শরীরে আবার শক্তি ফিরেছে।`, weight: 3, narrated: false });
  } catch (_) {}
}

export const ENTRIES = [
  {
    id: "physiology",
    key: null,
    phase: PHASES.BODY,
    order: 280,
    owns: ["stats", "critical", "memories", "healthDrainAcc", ...JOURNAL_OWN_KEYS],
    notes: "Sub-1 drains persist in healthDrainAcc; a 24h window loses at most 12 (dual-zero) / 6 (single). Critical at 0, recovery above the threshold — both announced in shortTerm.",
    validate: validatePhysiology,
    apply: applyPhysiology,
  },
];

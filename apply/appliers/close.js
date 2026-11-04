// Gate 3 applier: CLOSE — prunePaidBills (30d) + hygienePass (merge->
// compact->drop, never canon/debt) + updatedAt stamp (always runs, last).
// Splice: verbatim lines 2751-2755.
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { prunePaidBills, hygienePass } from "../../engine.js";

export const BRANCHES = [
  "close:entry",
];

export function validateClose(sim, patch, ctx) {
  return true; // always runs
}

export function applyClose(sim, patch, ctx) {
  cov("close:entry");
  // v2 (R4): prune paid bills older than 30 sim-days.
  prunePaidBills(sim, 30);
  // Issue #13: canon-safe hygiene (merge -> compact -> drop, never canon/debt).
  hygienePass(sim);
  sim.updatedAt = Date.now();
}

export const ENTRIES = [
  {
    id: "close",
    key: null,
    phase: PHASES.CLOSE,
    order: 290,
    owns: ["finances", "storylines", "relationships", "npcs", "persona", "world", "inventory", "updatedAt"],
    notes: "End-of-beat canon-safe hygiene. updatedAt stamped last (Date.now tick order preserved).",
    validate: validateClose,
    apply: applyClose,
  },
];


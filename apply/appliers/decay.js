// Gate 3 applier: DECAY — passive physiology (satiety/energy) + hot NPC
// states + persona drift, BEFORE any landing state (the LLM's landing wins
// for at least the following beat). Reads ctx.hrsEff from TIME.
// Gate 4: arithmetic lives in src/core/physiology.js (applier = rails+order,
// core = numbers). Splice origin: verbatim applyPatch lines 1874-1932.
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { applyPassiveDecay, applyNpcDrift, applyPersonaDrift } from "../../core/physiology.js";

export const BRANCHES = [
  "decay:entry",
  "decay:minor-lock",
  "decay:persona-minor",
];

export function validateDecay(sim, patch, ctx) {
  return true; // always runs
}

export function applyDecay(sim, patch, ctx) {
  cov("decay:entry");
  const mark = (id) => cov(id);
  applyPassiveDecay(sim, ctx.hrsEff);
  applyNpcDrift(sim, ctx.hrsEff, mark);
  applyPersonaDrift(sim, ctx.hrsEff, mark);
}

export const ENTRIES = [
  {
    id: "decay",
    key: null,
    phase: PHASES.DECAY,
    order: 20,
    owns: ["stats", "npcs", "persona"],
    notes: "Passive decay BEFORE landing: satiety/energy drain, hot NPC states drift to baseline, persona states cooled. Controlled record never decayed independently; minor desire locked at 0.",
    validate: validateDecay,
    apply: applyDecay,
  },
];

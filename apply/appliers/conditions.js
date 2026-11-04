// Gate 3 applier: CONDITIONS — organic body/mind states (no meters).
// Splice: verbatim lines 2624-2642.
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { PATCH_MAX_CONDITIONS_ADD, PATCH_MAX_CONDITIONS_REMOVE, normName } from "../../engine.js";
import { CONDITION_TEXT_MAX, CONDITION_MAX } from "../../personality.js";

export const BRANCHES = [
  "conditionsAdd:entry",
  "conditionsRemove:entry",
];

export function validateConditionsAdd(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.conditions_add));
}

export function applyConditionsAdd(sim, patch, ctx) {
  cov("conditionsAdd:entry");
  // Living World: organic body/mind conditions (no meters — short Bengali states).
  if (Array.isArray(patch.conditions_add)) {
    if (!Array.isArray(sim.persona.conditions)) sim.persona.conditions = [];
    const seen = new Set(sim.persona.conditions.map((x) => normName(x)));
    for (const c of patch.conditions_add.slice(0, PATCH_MAX_CONDITIONS_ADD)) {
      if (typeof c !== "string" || !c.trim()) continue;
      const t = c.trim().slice(0, CONDITION_TEXT_MAX);
      const k = normName(t);
      if (seen.has(k)) continue;
      seen.add(k);
      sim.persona.conditions.push(t);
    }
    sim.persona.conditions = sim.persona.conditions.slice(-CONDITION_MAX);
  }
}

export function validateConditionsRemove(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.conditions_remove));
}

export function applyConditionsRemove(sim, patch, ctx) {
  cov("conditionsRemove:entry");
  if (Array.isArray(patch.conditions_remove)) {
    if (!Array.isArray(sim.persona.conditions)) sim.persona.conditions = [];
    const drop = new Set(patch.conditions_remove.slice(0, PATCH_MAX_CONDITIONS_REMOVE).filter((x) => typeof x === "string").map((x) => normName(x)));
    if (drop.size) sim.persona.conditions = sim.persona.conditions.filter((x) => !drop.has(normName(x)));
  }
}

export const ENTRIES = [
  {
    id: "conditionsAdd",
    key: "conditions_add",
    phase: PHASES.SELF,
    order: 200,
    owns: ["persona"],
    notes: "Deduped by normalized name, capped at 8 (newest kept). Empty/whitespace dropped.",
    validate: validateConditionsAdd,
    apply: applyConditionsAdd,
  },
  {
    id: "conditionsRemove",
    key: "conditions_remove",
    phase: PHASES.SELF,
    order: 210,
    owns: ["persona"],
    notes: "Normalized-name drop set, max 3 keys/beat.",
    validate: validateConditionsRemove,
    apply: applyConditionsRemove,
  },
];

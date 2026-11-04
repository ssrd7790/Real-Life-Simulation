// Gate 3 applier: EXPERIENCES — lived competence / local standing.
// Splice: verbatim lines 2643-2656.
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { PATCH_MAX_EXPERIENCES_ADD, normName } from "../../engine.js";
import { EXPERIENCE_TEXT_MAX, EXPERIENCE_MAX } from "../../personality.js";

export const BRANCHES = [
  "experiences:entry",
];

export function validateExperiences(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.experiences_add));
}

export function applyExperiences(sim, patch, ctx) {
  cov("experiences:entry");
  // Living World: lived experience (practical competence / local standing).
  if (Array.isArray(patch.experiences_add)) {
    if (!Array.isArray(sim.persona.experiences)) sim.persona.experiences = [];
    const seen = new Set(sim.persona.experiences.map((x) => normName(x)));
    for (const c of patch.experiences_add.slice(0, PATCH_MAX_EXPERIENCES_ADD)) {
      if (typeof c !== "string" || !c.trim()) continue;
      const t = c.trim().slice(0, EXPERIENCE_TEXT_MAX);
      const k = normName(t);
      if (seen.has(k)) continue;
      seen.add(k);
      sim.persona.experiences.push(t);
    }
    sim.persona.experiences = sim.persona.experiences.slice(-EXPERIENCE_MAX);
  }
}

export const ENTRIES = [
  {
    id: "experiences",
    key: "experiences_add",
    phase: PHASES.SELF,
    order: 220,
    owns: ["persona"],
    notes: "Deduped by normalized name, capped at 12 (newest kept).",
    validate: validateExperiences,
    apply: applyExperiences,
  },
];

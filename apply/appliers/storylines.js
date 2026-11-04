// Gate 3 applier: STORYLINES — add (open threads) + close (active=false,
// closedDay stamped; cap-by-10 keys/beat). Splice: verbatim 2699-2704 (add)
// and 2705-2712 (close).
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { PATCH_MAX_STORY_ADD } from "../../engine.js";

export const BRANCHES = [
  "storylinesAdd:entry",
  "storylinesClose:closed",
  "storylinesClose:entry",
];

export function validateStorylinesAdd(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.storylines_add));
}

export function applyStorylinesAdd(sim, patch, ctx) {
  cov("storylinesAdd:entry");
  if (Array.isArray(patch.storylines_add)) {
    for (const s of patch.storylines_add.slice(0, PATCH_MAX_STORY_ADD)) {
      if (!s || !s.title) continue;
      sim.storylines.push({ id: "s" + Date.now() + Math.floor(Math.random() * 999), title: String(s.title).slice(0, 120), desc: String(s.desc || "").slice(0, 500), active: true, closedDay: null });
    }
  }
}

export function validateStorylinesClose(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.storylines_close));
}

export function applyStorylinesClose(sim, patch, ctx) {
  cov("storylinesClose:entry");
  // v2 (R4): storyline close mechanism.
  if (Array.isArray(patch.storylines_close)) {
    for (const key of patch.storylines_close.slice(0, 10)) {
      if (!key) continue;
      const s = sim.storylines.find((x) => x.id === key || x.title === key);
      if (s && s.active !== false) { s.active = false; s.closedDay = Math.max(1, Math.round(sim.world.dayCount || 1)); }
      cov("storylinesClose:closed");
    }
  }
}

export const ENTRIES = [
  {
    id: "storylinesAdd",
    key: "storylines_add",
    phase: PHASES.CANON,
    order: 260,
    owns: ["storylines"],
    notes: "New threads open with s+Date.now ids; hygiene prunes only closed ones later.",
    validate: validateStorylinesAdd,
    apply: applyStorylinesAdd,
  },
  {
    id: "storylinesClose",
    key: "storylines_close",
    phase: PHASES.CANON,
    order: 270,
    owns: ["storylines"],
    notes: "Close matches by id or title (first 10 keys); already-closed untouched.",
    validate: validateStorylinesClose,
    apply: applyStorylinesClose,
  },
];

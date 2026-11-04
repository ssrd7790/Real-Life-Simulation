// Gate 3 applier: MEMORY — short-term window (60, overflow -> longTerm faded,
// longTerm capped) with legacy `event` fallback; core identity memories
// (deduped, capped at 30). Splice: verbatim lines 2657-2676 (short) and
// 2688-2698 (core).
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { PATCH_MAX_SHORT_ADD, PATCH_MAX_CORE_ADD, V2_LONGTERM_CAP, V2_CORE_MAX_SIM } from "../../engine.js";
import { appendEvent, JOURNAL_OWN_KEYS } from "../../core/events.js";

export const BRANCHES = [
  "memoryCore:deduped",
  "memoryCore:entry",
  "memoryShort:entry",
  "memoryShort:event-fallback",
];

export function validateMemoryShort(sim, patch, ctx) {
  return !!(patch && (Array.isArray(patch.memory_short_add) || patch.event));
}

export function applyMemoryShort(sim, patch, ctx) {
  cov("memoryShort:entry");
  if (Array.isArray(patch.memory_short_add)) {
    for (const m of patch.memory_short_add.slice(0, PATCH_MAX_SHORT_ADD)) {
      if (!m) continue;
      sim.memories.shortTerm.push({ day: sim.world.date, text: String(m).slice(0, 500) });
      try { appendEvent(sim, { kind: "note", actors: [], text: String(m).slice(0, 220), narrated: false, weight: 1 }); } catch (_) {}
    }
    // keep last 60 short-term; older -> long-term faded
    while (sim.memories.shortTerm.length > 60) {
      const old = sim.memories.shortTerm.shift();
      sim.memories.longTerm.push({ day: old.day, text: old.text, faded: true });
    }
    // v2 (R1): longTerm was unbounded — cap it.
    if (sim.memories.longTerm.length > V2_LONGTERM_CAP) sim.memories.longTerm = sim.memories.longTerm.slice(-V2_LONGTERM_CAP);
  } else if (patch.event) {
  cov("memoryShort:event-fallback");
    sim.memories.shortTerm.push({ day: sim.world.date, text: String(patch.event).slice(0, 500) });
    try { appendEvent(sim, { kind: "note", actors: [], text: String(patch.event).slice(0, 220), narrated: false, weight: 1 }); } catch (_) {}
    if (sim.memories.shortTerm.length > 60) {
      const old = sim.memories.shortTerm.shift();
      sim.memories.longTerm.push({ day: old.day, text: old.text, faded: true });
    }
    if (sim.memories.longTerm.length > V2_LONGTERM_CAP) sim.memories.longTerm = sim.memories.longTerm.slice(-V2_LONGTERM_CAP);
  }
}

export function validateMemoryCore(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.memory_core_add));
}

export function applyMemoryCore(sim, patch, ctx) {
  cov("memoryCore:entry");
  // v2 (R1): rare identity-defining core memories, deduped, capped at 30.
  if (Array.isArray(patch.memory_core_add)) {
    for (const c of patch.memory_core_add.slice(0, PATCH_MAX_CORE_ADD)) {
      if (!c) continue;
      const text = String(c).slice(0, 220).trim();
      if (!text) continue;
      if (sim.memories.core.some((x) => x === text)) { cov("memoryCore:deduped"); continue; }
      sim.memories.core.push(text);
    }
    if (sim.memories.core.length > V2_CORE_MAX_SIM) sim.memories.core = sim.memories.core.slice(-V2_CORE_MAX_SIM);
  }
}

export const ENTRIES = [
  {
    id: "memoryShort",
    key: "memory_short_add",
    phase: PHASES.SELF,
    order: 230,
    owns: ["memories", ...JOURNAL_OWN_KEYS],
    notes: "Last 60 kept; older shift to longTerm as faded. Legacy single `event` string takes the else-branch (never both).",
    validate: validateMemoryShort,
    apply: applyMemoryShort,
  },
  {
    id: "memoryCore",
    key: "memory_core_add",
    phase: PHASES.CANON,
    order: 250,
    owns: ["memories"],
    notes: "Rare identity-defining lines, exact-text deduped, capped at 30.",
    validate: validateMemoryCore,
    apply: applyMemoryCore,
  },
];

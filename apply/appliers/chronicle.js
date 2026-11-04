// Gate 3 applier: CHRONICLE — permanent canon log (Bengali, 220 chars/line,
// exact-repeat dedupe, keep last 120). The windfall clamp in CASH reads
// patch.chronicle_add (not sim.chronicle), so this later landing cannot
// change the clamp decision — order documented, not accidental.
// Splice: verbatim lines 2677-2687.
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { PATCH_MAX_CHRON_ADD, V2_CHRON_MAX_SIM } from "../../engine.js";
import { appendEvent, JOURNAL_OWN_KEYS } from "../../core/events.js";

export const BRANCHES = [
  "chronicle:appended",
  "chronicle:deduped",
  "chronicle:entry",
];

export function validateChronicle(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.chronicle_add));
}

export function applyChronicle(sim, patch, ctx) {
  cov("chronicle:entry");
  // v2 (R1): chronicle — permanent canon log, Bengali, 220 chars/line, keep last 120.
  if (Array.isArray(patch.chronicle_add)) {
    for (const c of patch.chronicle_add.slice(0, PATCH_MAX_CHRON_ADD)) {
      if (!c) continue;
      const text = String(c).slice(0, 220).trim();
      if (!text) continue;
      if (sim.chronicle.some((e) => e.text === text)) { cov("chronicle:deduped"); continue; } // dedupe exact repeats
      sim.chronicle.push({ day: Math.max(1, Math.round(sim.world.dayCount || 1)), date: sim.world.date, text });
      try { appendEvent(sim, { kind: "canon", actors: [], text, narrated: true }); } catch (_) {}
      cov("chronicle:appended");
    }
    if (sim.chronicle.length > V2_CHRON_MAX_SIM) sim.chronicle = sim.chronicle.slice(-V2_CHRON_MAX_SIM);
  }
}

export const ENTRIES = [
  {
    id: "chronicle",
    key: "chronicle_add",
    phase: PHASES.CANON,
    order: 240,
    owns: ["chronicle", ...JOURNAL_OWN_KEYS],
    notes: "Canon log; exact repeats skipped. Windfall scrutiny reads the patch key, so landing order vs CASH is irrelevant.",
    validate: validateChronicle,
    apply: applyChronicle,
  },
];

// Gate 3 registry: every patch key (and every always-run beat step) is one
// ordered entry. The pipeline SORTS by (phase, order) — adding a 29th key is
// a new entry (new file or appended here), never a pipeline edit.
//
// Entry shape: {id, key, phase, order, owns, notes, validate, apply}
//   id       stable unique id (registry key)
//   key      patch key, or null for always-run beat steps (prep/time/decay/...)
//   phase    PHASES.* constant (execution-ordered; see phases.js)
//   order    global sequence number (unique; encodes the old intra-function order)
//   owns     top-level sim paths the entry may write (dev-only owns check)
//   notes    the cross-cutting interaction this ordering preserves
//   validate(sim,patch,ctx)  pure shape predicate (tests/tooling; the pipeline
//            always runs apply, mirroring the old every-block-evaluated flow)
//   apply(sim,patch,ctx)     the verbatim transplanted block
import { ENTRIES as prepEntries } from "./appliers/prep.js";
import { ENTRIES as timeEntries } from "./appliers/time.js";
import { ENTRIES as decayEntries } from "./appliers/decay.js";
import { ENTRIES as incomeEntries } from "./appliers/income.js";
import { ENTRIES as statsEntries } from "./appliers/stats.js";
import { ENTRIES as billsEntries } from "./appliers/bills.js";
import { ENTRIES as cashEntries } from "./appliers/cash.js";
import { ENTRIES as inventoryEntries } from "./appliers/inventory.js";
import { ENTRIES as relationshipsEntries } from "./appliers/relationships.js";
import { ENTRIES as npcEntries } from "./appliers/npc.js";
import { ENTRIES as mindEntries } from "./appliers/mind.js";
import { ENTRIES as rosterEntries } from "./appliers/roster.js";
import { ENTRIES as npcStatesEntries } from "./appliers/npcStates.js";
import { ENTRIES as npcMemoryEntries } from "./appliers/npcMemory.js";
import { ENTRIES as worldEntries } from "./appliers/world.js";
import { ENTRIES as conditionsEntries } from "./appliers/conditions.js";
import { ENTRIES as experiencesEntries } from "./appliers/experiences.js";
import { ENTRIES as memoryEntries } from "./appliers/memory.js";
import { ENTRIES as chronicleEntries } from "./appliers/chronicle.js";
import { ENTRIES as storylinesEntries } from "./appliers/storylines.js";
import { ENTRIES as physiologyEntries } from "./appliers/physiology.js";
import { ENTRIES as closeEntries } from "./appliers/close.js";

const ALL = [
  ...prepEntries,
  ...timeEntries,
  ...decayEntries,
  ...incomeEntries,
  ...statsEntries,
  ...billsEntries,
  ...cashEntries,
  ...inventoryEntries,
  ...relationshipsEntries,
  ...npcEntries,
  ...mindEntries,
  ...rosterEntries,
  ...npcStatesEntries,
  ...npcMemoryEntries,
  ...worldEntries,
  ...conditionsEntries,
  ...experiencesEntries,
  ...memoryEntries,
  ...chronicleEntries,
  ...storylinesEntries,
  ...physiologyEntries,
  ...closeEntries,
];

export const APPLIERS = new Map();
for (const e of ALL) {
  if (!e || typeof e.id !== "string" || !e.id) throw new Error("[apply] entry without id");
  if (APPLIERS.has(e.id)) throw new Error(`[apply] duplicate entry id: ${e.id}`);
  if (typeof e.apply !== "function" || typeof e.validate !== "function") throw new Error(`[apply] entry ${e.id} missing apply/validate`);
  if (!Number.isFinite(e.phase) || !Number.isFinite(e.order)) throw new Error(`[apply] entry ${e.id} missing phase/order`);
  if (!Array.isArray(e.owns)) throw new Error(`[apply] entry ${e.id} missing owns`);
  APPLIERS.set(e.id, e);
}

// Shared per-beat scratch state. These fields are the ONLY cross-applier
// channels (the implicit locals of the old monolith, now explicit):
//   mins/hrsFull/hrsEff  time arithmetic (TIME -> DECAY, BODY)
//   presentAtStart/locChanged  roster inputs (PREP/TIME -> ROSTER)
//   newNpcIds        npcs_add -> ROSTER tag fallback
//   touchedNpcIds    npc_states -> emotion derivation
//   totalPaid/settledAmounts  bills_paid -> CASH M1 neutralize
export function createCtx(isSkip = false, extra = {}) {
  return {
    isSkip: !!isSkip,
    fourth: extra.fourth,
    hasFourth: !!extra.hasFourth,
    mins: 8,
    hrsFull: 0,
    hrsEff: 0,
    presentAtStart: [],
    locChanged: false,
    newNpcIds: [],
    touchedNpcIds: new Set(),
    totalPaid: 0,
    settledAmounts: [],
  };
}

export function sortedEntries(reg = APPLIERS) {
  return [...reg.values()].sort((a, b) => (a.phase - b.phase) || (a.order - b.order));
}

// A7: ordering is data. Overlay a new key by building a derived registry —
// the pipeline module is never touched.
export function registerApplier(reg, entry) {
  if (!entry || typeof entry.id !== "string" || !entry.id) throw new Error("[apply] overlay entry needs an id");
  if (typeof entry.apply !== "function" || typeof entry.validate !== "function") throw new Error("[apply] overlay entry needs apply/validate");
  if (!Number.isFinite(entry.phase) || !Number.isFinite(entry.order)) throw new Error("[apply] overlay entry needs phase/order");
  const next = new Map(reg);
  next.set(entry.id, entry);
  return next;
}

// Gate 3 applier: PREP — sim defensive defaults (always runs).
// Gate 4: also advances the journal beat counter and journals the once-per-day
// derived events (noteworthy weather, money pressure, critical onset) with
// spike-suppression flags, so the scheduler always has system signal even on
// quiet beats. All derived inputs are sim-time (never wall-clock/RNG).
// Splice origin: verbatim applyPatch lines 1797-1825 (defaults block).
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { defaultLocationFacts, LOC_FACTS_MAX } from "../../personality.js";
import { ensureJournal, appendEvent, JOURNAL_OWN_KEYS } from "../../core/events.js";
import { weatherFor, isNoteworthy } from "../../core/weather.js";
import { unpaidBills, liquidTotal } from "../../core/economy.js";

export const BRANCHES = [
  "prep:entry",
];

export function validatePrep(sim, patch, ctx) {
  return !!(sim && typeof sim === "object");
}

export function applyPrep(sim, patch, ctx) {
  cov("prep:entry");
  if (!Array.isArray(sim.chronicle)) sim.chronicle = [];
  if (!sim.memories) sim.memories = { core: [], shortTerm: [], longTerm: [] };
  if (!Array.isArray(sim.memories.core)) sim.memories.core = [];
  if (!Array.isArray(sim.memories.shortTerm)) sim.memories.shortTerm = [];
  if (!Array.isArray(sim.memories.longTerm)) sim.memories.longTerm = [];
  if (!Array.isArray(sim.storylines)) sim.storylines = [];
  if (!sim.finances) sim.finances = { cash: 0, bank: 0, bills: [] };
  if (!Array.isArray(sim.finances.bills)) sim.finances.bills = [];
  if (!sim.relationships) sim.relationships = {};
  if (!sim.npcs) sim.npcs = {};
  if (!sim.stats) sim.stats = { health: 70, mood: 55, satiety: 60, energy: 70 };
  if (!sim.world) sim.world = { date: "15/08", dayCount: 1, timeMin: 540, location: "" };
  if (!Array.isArray(sim.world.present)) sim.world.present = [];
  if (sim.world.phoneCall === undefined) sim.world.phoneCall = null;
  if (typeof sim.world.phoneCall !== "string" && sim.world.phoneCall !== null) sim.world.phoneCall = null;
  ctx.presentAtStart = Array.isArray(sim.world.present) ? [...sim.world.present] : [];
  ctx.locChanged = false;
  if (!sim.critical || typeof sim.critical !== "object") sim.critical = { active: false, sinceDay: null };
  // R3: fractional drain accumulator (migrated default 0; additive float, never corrupts old readers).
  if (typeof sim.healthDrainAcc !== "number" || isNaN(sim.healthDrainAcc)) sim.healthDrainAcc = 0;
  // Living World: defensive defaults (migrated "" / [] so old saves never crash).
  if (typeof sim.world.pulse !== "string") sim.world.pulse = "";
  // Anti-hallucination: physical layout lock backfill (old saves never crash).
  if (typeof sim.world.locationFacts !== "string" || !sim.world.locationFacts.trim()) {
    try { sim.world.locationFacts = defaultLocationFacts(sim.world.location, sim.persona?.socialClass); } catch (_) { sim.world.locationFacts = ""; }
  } else if (sim.world.locationFacts.length > LOC_FACTS_MAX) sim.world.locationFacts = sim.world.locationFacts.slice(0, LOC_FACTS_MAX);
  if (!sim.persona || typeof sim.persona !== "object") sim.persona = {};
  if (!Array.isArray(sim.persona.conditions)) sim.persona.conditions = [];
  if (!Array.isArray(sim.persona.experiences)) sim.persona.experiences = [];
  // Gate 4: journal beat + once-per-day derived system events (deterministic).
  try {
    ensureJournal(sim);
    sim.journalBeat = (sim.journalBeat || 0) + 1;
    const dc = Math.max(1, Math.round(sim.world.dayCount || 1));
    if (dc !== sim.derivedJournalDay) {
      sim.derivedJournalDay = dc;
      try {
        const wx = weatherFor(sim.city, sim.world.date);
        if (isNoteworthy(wx)) appendEvent(sim, { kind: "weather", actors: [], text: `আবহাওয়া: আজ ${wx.kind}।`, weight: 2, narrated: false });
      } catch (_) {}
      try {
        const bills = unpaidBills(sim);
        const total = bills.reduce((a, b) => a + (b.amount || 0), 0);
        const liquid = liquidTotal(sim);
        const pressed = bills.length > 0 && total > liquid;
        if (pressed && !sim.derivedMoneyFlag) appendEvent(sim, { kind: "money", actors: [], text: `বাকির চাপ: মোট বকেয়া ${total} টাকা, হাতে ${liquid}।`, weight: 4, narrated: false });
        sim.derivedMoneyFlag = !!pressed;
      } catch (_) { try { sim.derivedMoneyFlag = false; } catch (_) {} }
      try {
        const crit = !!(sim.critical && sim.critical.active);
        if (crit && !sim.derivedCritFlag) appendEvent(sim, { kind: "health", actors: [], text: `সংকট চলছে: শরীর ভেঙে পড়া অবস্থা।`, weight: 5, narrated: false });
        sim.derivedCritFlag = !!crit;
      } catch (_) {}
    }
  } catch (_) {}
}

export const ENTRIES = [
  {
    id: "prep",
    key: null,
    phase: PHASES.PREP,
    order: 0,
    owns: ["chronicle", "memories", "storylines", "finances", "relationships", "npcs", "stats", "world", "critical", "healthDrainAcc", "persona", ...JOURNAL_OWN_KEYS],
    notes: "Defensive defaults so old saves never crash. Runs first; later appliers assume these structures exist. Journal beat + daily derived events (weather/money/critical) with spike-suppression flags.",
    validate: validatePrep,
    apply: applyPrep,
  },
];

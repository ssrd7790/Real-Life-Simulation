// Gate 4 core/events — append-only event journal + archive fallback.
// Pure: no DOM, no LLM, no kv, no Date.now/Math.random. Ids come from the
// sim's own sequence counter (deterministic across identical patch streams);
// timestamps come from sim time (day/timeMin/beat). This is THE key idea:
// chronicle[] becomes a VIEW over narrated journal entries, so canon is
// reconstructable and compaction is safe.
import { hasOwn } from "./util.js";

// Journal capacity: 400 live entries, then the oldest narrated entries spill
// to the archive (200), then only a dropped counter grows. Rationale: a beat
// appends ~1-4 events, so 400 covers ~100-200 beats of live context; the
// archive keeps one more window for the scheduler's uniqueness scoring.
export const JOURNAL_MAX = 400;
export const JOURNAL_ARCHIVE_MAX = 200;

// Event kinds (stable strings; scheduler scores by kind).
export const EVENT_KIND = {
  CANON: "canon",       // lasting consequence (dual-written with chronicle_add)
  NOTE: "note",         // short-term memory worth re-narrating
  MONEY: "money",       // bill settled / payday / windfall-class delta
  HEALTH: "health",     // critical entered / recovered / drain milestone
  ROSTER: "roster",     // NPC exit / arrival
  WEATHER: "weather",   // noteworthy weather of the day
  WORLD: "world",       // pulse-grade neighborhood happening (derived)
};

// Top-level sim keys the journal family may write (spread into `owns` of
// every applier entry that appends events, so the dev-only owns check stays
// exact). Covers the list, counters, archive, and daily-derived flags.
export const JOURNAL_OWN_KEYS = [
  "journal", "journalSeq", "journalBeat", "journalArchive", "journalDropped",
  "journalMigrated", "derivedJournalDay", "derivedMoneyFlag", "derivedCritFlag",
];

// Defensive defaults for saves that predate the journal (also called by
// migrateSim before synthesis). Never touches existing entries.
export function ensureJournal(sim) {
  if (!Array.isArray(sim.journal)) sim.journal = [];
  if (!Number.isInteger(sim.journalSeq) || sim.journalSeq < 0) {
    sim.journalSeq = sim.journal.reduce((m, e) => Math.max(m, typeof e.id === "string" && e.id[0] === "j" ? (parseInt(e.id.slice(1), 10) || 0) : 0), 0);
  }
  if (!Array.isArray(sim.journalArchive)) sim.journalArchive = [];
  if (!Number.isInteger(sim.journalDropped) || sim.journalDropped < 0) sim.journalDropped = 0;
  if (sim.journalMigrated !== true) sim.journalMigrated = false;
  if (!Number.isInteger(sim.journalBeat) || sim.journalBeat < 0) sim.journalBeat = 0;
}

// Append one event. Returns the entry (or null when the payload is empty).
// Cap enforcement: overflow shifts the oldest NARRATED entry to the archive
// (narrated canon stays recoverable longest); when everything is unnarrated,
// the oldest entry archives. Full archive => dropped counter only.
export function appendEvent(sim, { kind, actors, text, weight, day, timeMin, beat, narrated }) {
  ensureJournal(sim);
  const t = String(text || "").trim().slice(0, 220);
  if (!t) return null;
  const entry = {
    id: "j" + (++sim.journalSeq),
    day: Number.isInteger(day) ? day : Math.max(1, Math.round(sim.world.dayCount || 1)),
    timeMin: Number.isInteger(timeMin) ? timeMin : (Math.round(sim.world.timeMin) || 0),
    beat: Number.isInteger(beat) ? beat : sim.journalBeat,
    kind: typeof kind === "string" && kind ? kind.slice(0, 20) : EVENT_KIND.NOTE,
    actors: Array.isArray(actors) ? actors.filter((a) => typeof a === "string" && a).slice(0, 4) : [],
    text: t,
    weight: typeof weight === "number" && Number.isFinite(weight) ? Math.max(0, Math.min(10, weight)) : 1,
    narrated: narrated === true,
    cooldownUntil: 0,
  };
  sim.journal.push(entry);
  while (sim.journal.length > JOURNAL_MAX) {
    let idx = sim.journal.findIndex((e) => e.narrated);
    if (idx === -1) idx = 0;
    const [spilled] = sim.journal.splice(idx, 1);
    if (sim.journalArchive.length < JOURNAL_ARCHIVE_MAX) sim.journalArchive.push(spilled);
    else sim.journalDropped++;
  }
  return entry;
}

// C3: synthesize a journal from an old save's chronicle + shortTerm so migrated
// saves do not start with an empty world. Idempotent: skips when the flag is
// set OR when a journal already exists. Chronicle lines become narrated canon;
// shortTerm lines become unnarrated notes (oldest first, day-stamped "then").
export function synthesizeFromSave(sim) {
  ensureJournal(sim);
  // Skip silently (no writes) when already migrated or a journal exists —
  // post-pipeline sims reach migrateSim with a live journal; touching them
  // would break hygiene/migrate idempotence (golden G4).
  if (sim.journalMigrated === true || sim.journal.length > 0) return 0;
  let n = 0;
  const ch = Array.isArray(sim.chronicle) ? sim.chronicle : [];
  for (const e of ch) {
    const text = e && typeof e.text === "string" ? e.text : String(e || "");
    if (!text.trim()) continue;
    appendEvent(sim, { kind: EVENT_KIND.CANON, actors: [], text, day: (e && Number.isInteger(e.day)) ? e.day : 1, narrated: true });
    n++;
  }
  const st = (sim.memories && Array.isArray(sim.memories.shortTerm)) ? sim.memories.shortTerm : [];
  for (const m of st) {
    const text = m && typeof m.text === "string" ? m.text : String((m && m.text) ?? m ?? "");
    if (!text.trim()) continue;
    appendEvent(sim, { kind: EVENT_KIND.NOTE, actors: [], text, narrated: false });
    n++;
  }
  sim.journalMigrated = true;
  return n;
}

// V5: chronicle as a VIEW — the texts of narrated canon entries, in order.
// Merges the live journal with the archive (both keep sequence ids), so
// replay is exact as long as nothing was hard-dropped (journalDropped == 0;
// the counter names the missing prefix when the 600-entry window overflows).
export function rebuildChronicle(sim) {
  ensureJournal(sim);
  const seqOf = (e) => (typeof e.id === "string" && e.id[0] === "j" ? (parseInt(e.id.slice(1), 10) || 0) : 0);
  const all = [...(sim.journalArchive || []), ...(sim.journal || [])]
    .filter((e) => e && e.kind === EVENT_KIND.CANON && e.narrated)
    .sort((a, b) => seqOf(a) - seqOf(b));
  return all.map((e) => String(e.text));
}

export function storedChronicleTexts(sim) {
  const ch = Array.isArray(sim.chronicle) ? sim.chronicle : [];
  return ch.map((e) => (e && typeof e.text === "string" ? e.text : String(e || ""))).filter((t) => t.trim());
}

// Cooldown helpers (beats, from sim.journalBeat — never wall-clock).
export function isCooledDown(ev, nowBeat) {
  try { return !!(ev && Number.isInteger(ev.cooldownUntil) && ev.cooldownUntil > nowBeat); } catch (_) { return false; }
}

export function setCooldown(ev, nowBeat, beats) {
  try { if (ev && typeof ev === "object") ev.cooldownUntil = nowBeat + Math.max(1, Math.round(beats || 1)); } catch (_) {}
}

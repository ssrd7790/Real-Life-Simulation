// Gate 5 src/memory/tiers.js — tiered memory: ACTIVE / DORMANT / ARCHIVED.
// The world can hold hundreds of actors; the prompt stays sublinear because
// only ACTIVE NPCs get full dossiers, DORMANT get one-liners, ARCHIVED get
// roster entries (+ the journal carries the lossless event index).
//
// Thresholds (named constants; rationale inline):
//   TIER_ACTIVE_RECENT_DAYS = 3 — a beat is ~15 min; 3 days is the current
//     scene arc. Contact within 3 days => still warm in working memory.
//   TIER_DORMANT_WITHIN_DAYS = 30 — a sim month (year = 360 days). Contact
//     within a month => one-line brief; older => archived roster pointer.
// Promotion/demotion are pure functions of (npc, ctx); ctx carries the
// precomputed journal contact index (actors UNION read-time text mentions,
// so old saves with unattributed journals still tier correctly).
import { mentionsNpc } from "./matching.js";

export const TIER_ACTIVE = "active";
export const TIER_DORMANT = "dormant";
export const TIER_ARCHIVED = "archived";
export const TIER_EXCLUDED = "excluded";

export const TIER_ACTIVE_RECENT_DAYS = 3;
export const TIER_DORMANT_WITHIN_DAYS = 30;

// Live NPCs: mirrors engine liveNpcs (non-inactive, non-controlled).
// Controlled persons are excluded from every model-facing slice (M3), and
// inactive records are history, not cast — both tier as EXCLUDED, never
// deleted (M3: no NPC record is ever removed by tiering).
export function liveNpcs(sim) {
  try {
    return Object.values(sim.npcs || {}).filter((n) => n && typeof n === "object" && !n.inactive && !n.controlled && n.id && n.name);
  } catch (_) { return []; }
}

// Contact index: npcId -> last journal day the NPC appears in (explicit
// actors[] UNION read-time text mentions). Pure read; never mutates the sim.
// Day granularity (beats are too fine for a 30-day horizon; day is stamped
// on every journal event). Deterministic: same journal => same index.
export function indexContacts(sim) {
  const out = new Map();
  try {
    const journal = Array.isArray(sim.journal) ? sim.journal : [];
    const live = liveNpcs(sim);
    if (!live.length || !journal.length) return out;
    for (const ev of journal) {
      if (!ev || typeof ev !== "object") continue;
      const day = Number.isInteger(ev.day) ? ev.day : null;
      if (day === null) continue;
      const actors = Array.isArray(ev.actors) ? ev.actors : [];
      const text = String(ev.text || "");
      for (const npc of live) {
        let hit = false;
        for (const a of actors) {
          try {
            if (typeof a === "string" && a && (a === npc.id || a === npc.name)) { hit = true; break; }
          } catch (_) {}
        }
        if (!hit && text && mentionsNpc(text, npc)) hit = true;
        if (hit) {
          const prev = out.get(npc.id);
          if (prev === undefined || day > prev) out.set(npc.id, day);
        }
      }
    }
  } catch (_) {}
  return out;
}

// One NPC's tier. ctx = { dayCount, presentIds[], targetId, phoneId,
// contacts: Map(id->day), }. M3: inactive/controlled => EXCLUDED (callers
// must have filtered already; belt-and-braces here).
export function tierOf(npc, ctx) {
  try {
    if (!npc || typeof npc !== "object") return TIER_EXCLUDED;
    if (npc.inactive || npc.controlled) return TIER_EXCLUDED;
    const c = ctx || {};
    const day = Number.isInteger(c.dayCount) ? c.dayCount : 1;
    const present = c.presentIds || c.present || [];
    try {
      if (Array.isArray(present) && npc.id && present.includes(npc.id)) return TIER_ACTIVE;
    } catch (_) {}
    try {
      if (c.targetId && npc.id === c.targetId) return TIER_ACTIVE;
      if (c.phoneId && npc.id === c.phoneId) return TIER_ACTIVE;
    } catch (_) {}
    let last = null;
    try {
      if (c.contacts instanceof Map && npc.id) {
        const v = c.contacts.get(npc.id);
        if (Number.isInteger(v)) last = v;
      }
    } catch (_) {}
    if (last !== null) {
      const age = day - last;
      if (age <= TIER_ACTIVE_RECENT_DAYS) return TIER_ACTIVE;
      if (age <= TIER_DORMANT_WITHIN_DAYS) return TIER_DORMANT;
      return TIER_ARCHIVED;
    }
    // M6 warmth floor (no journal, old save): a record WITH memories is
    // known-warm (dormant), never archived-cold. NPC memory feeds tiering
    // directly — minting journal events for it would perturb small-fixture
    // FACTS (V3), so tiering reads it here instead (documented deviation).
    try {
      if (Array.isArray(npc.memory) && npc.memory.length) return TIER_DORMANT;
    } catch (_) {}
    return TIER_ARCHIVED;
  } catch (_) { return TIER_ARCHIVED; }
}

// Classify every live NPC. Returns { tierById: Map, contacts: Map }.
// Pure: same (sim, query-ish ctx) => same classification, always (M2).
export function classifyAll(sim, ctx) {
  const contacts = indexContacts(sim);
  const tierById = new Map();
  try {
    const full = { ...(ctx || {}), contacts };
    for (const npc of liveNpcs(sim)) tierById.set(npc.id, tierOf(npc, full));
  } catch (_) {}
  return { tierById, contacts };
}

// Context builder shared by retrieval + tests: pulls presence / target /
// phone / dayCount out of (sim, query). query = { targetId } (engine
// pre-resolves via resolvePersonKey — no engine import, no cycle).
export function tierContext(sim, query) {
  let presentIds = [];
  try {
    if (Array.isArray(sim.world.present)) presentIds = sim.world.present.filter((id) => typeof id === "string");
  } catch (_) {}
  let phoneId = null;
  try {
    const p = sim.world.phoneCall;
    if (typeof p === "string" && p) phoneId = p;
  } catch (_) {}
  let dayCount = 1;
  try {
    const d = sim.world.dayCount;
    if (Number.isInteger(d)) dayCount = d;
    else if (typeof d === "number" && Number.isFinite(d)) dayCount = Math.max(1, Math.round(d));
  } catch (_) {}
  let targetId = null;
  try {
    if (query && typeof query.targetId === "string" && query.targetId) targetId = query.targetId;
  } catch (_) {}
  return { dayCount, presentIds, targetId, phoneId };
}


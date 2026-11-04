// Gate 5 src/memory/retrieval.js — retrieval-on-demand: ranked slices over
// the NPC registry so the prompt covers hundreds of actors while staying
// sublinear. retrieve(sim, query, opts) -> { detailed, summarizedLines,
// rosterEntries, moreCount, tiers, scores, scarce }.
//
// Scoring (weights table — legacy-mirroring base + new signals):
//   name/id in player input ............ +500  (mirrors npcRelevance)
//   exact target (name or id) .......... +1000 (mirrors npcRelevance)
//   honorific-base exact target ........ +1000 (mirrors npcRelevance BUG5)
//   physically present ................. +750  (mirrors npcRelevance BUG4)
//   active phone interlocutor .......... +400  (mirrors npcRelevance BUG9)
//   recent-shortTerm name mention ...... +100  (mirrors npcRelevance)
//   recent-log name mention ............ +60   (mirrors npcRelevance)
//   location-string name mention ....... +50   (mirrors npcRelevance)
//   familiarity/10 + trust/20 .......... 0-15  (mirrors npcRelevance)
//   schedule proximity ................. <=60   NEW (routine place vs location)
//   recency (linear decay, 30d window) . <=120  NEW (journal contacts)
//   unresolved hooks ................... <=120  NEW (40 each, capped)
//   max event weight x10 ............... <=100  NEW (journal salience)
//   relationship (trust+fam)/10 ........ <=20   NEW (linked record)
// New-signal total (<=420) never outranks a legacy name hit (>=500):
// explicit naming always wins; new signals decide among the unnamed.
// Deterministic tie-break by id ascending (M2), same as legacy.
//
// Embedding seam: pass opts.scorer(npc, sim, query, ctx) to replace the
// lexical scorer — same signature, returns a number. Callers (engine,
// tests) never change. Do NOT add a network dependency: the default scorer
// is pure local text + journal arithmetic.
import { normName, normBase, hasWordBoundary } from "./matching.js";
import { TIER_ACTIVE, TIER_DORMANT, TIER_ARCHIVED, classifyAll, tierContext, liveNpcs } from "./tiers.js";
import { routineFor } from "../core/schedules.js";
import { dormantLine, rosterEntry, SUMMARIZED_MAX_N, ROSTER_MAX_N } from "./summarize.js";

export const RET_W_NAME = 500;
export const RET_W_TARGET = 1000;
export const RET_W_TARGET_BASE = 1000;
export const RET_W_PRESENT = 750;
export const RET_W_PHONE = 400;
export const RET_W_RECENT = 100;
export const RET_W_LOG = 60;
export const RET_W_LOCNM = 50;
export const RET_W_PROXIMITY = 60;
export const RET_W_RECENCY_MAX = 120;
export const RET_W_RECENCY_WINDOW_DAYS = 30;
export const RET_W_HOOK_EACH = 40;
export const RET_W_HOOK_CAP = 120;
export const RET_W_EVENT_WEIGHT = 10;
export const RET_W_EVENT_WEIGHT_CAP = 100;
export const RET_W_REL_CAP = 20;

// Default dossier width when the caller does not pass topN. Mirrors engine
// V2_DOSSIER_N; the engine always passes it explicitly — this default only
// serves standalone/test callers. If V2_DOSSIER_N changes, update both.
export const RETRIEVAL_TOPN_DEFAULT = 6;

// Legacy-small-signal readers (mirror npcRelevance sources verbatim).
function recentShortTerm(sim) {
  try { return (sim.memories.shortTerm || []).slice(-6).map((m) => m.text || "").join(" \n "); } catch (_) { return ""; }
}
function recentLog(sim) {
  try { return (sim.log || []).slice(-4).map((t) => t.text || "").join(" \n "); } catch (_) { return ""; }
}

// Schedule proximity: routine place vs player location keywords. Heuristic
// (a shopkeeper's routine "market" matches a player at the bazaar); the
// authoritative roster still comes from the patch, never the schedule.
function proximityBonus(npc, sim) {
  try {
    const timeMin = (sim.world && Number.isFinite(sim.world.timeMin)) ? sim.world.timeMin : 720;
    const r = routineFor(npc, timeMin);
    if (!r || r.place === "away") return 0;
    const loc = normName((sim.world && sim.world.location) || "");
    if (!loc) return 0;
    const has = (...ws) => ws.some((w) => loc.includes(w));
    if (r.place === "market" || r.place === "work") {
      if (has("বাজার", "হাট", "দোকান", "market", "কাজ", "অফিস")) return RET_W_PROXIMITY;
      return 0;
    }
    if (r.place === "home") {
      if (has("ঘর", "বাড়ি", "বাসা")) return RET_W_PROXIMITY;
      return 0;
    }
    return 0;
  } catch (_) { return 0; }
}

// Default lexical scorer. ctx = { contacts: Map, dayCount, journal }.
export function lexicalScore(npc, sim, query, ctx) {
  try {
    if (!npc || typeof npc !== "object") return -Infinity;
    const q = query || {};
    const c = ctx || {};
    let s = 0;
    const txt = typeof q.text === "string" ? q.text : "";
    const tgt = typeof q.target === "string" ? q.target : "";
    const hay = normName(String(txt || "") + " " + tgt);
    if (hay && npc.name && hay.includes(normName(npc.name))) s += RET_W_NAME;
    if (hay && npc.id && hay.includes(normName(npc.id)) && normName(npc.id).length >= 2) s += RET_W_NAME;
    if (tgt && (normName(tgt) === normName(npc.name) || normName(tgt) === normName(npc.id))) s += RET_W_TARGET;
    try {
      const tb = normBase(tgt);
      if (tb && tb.length >= 2 && npc.name && normBase(npc.name) === tb) s += RET_W_TARGET_BASE;
    } catch (_) {}
    try {
      if (Array.isArray(sim.world.present) && npc.id && sim.world.present.includes(npc.id)) s += RET_W_PRESENT;
    } catch (_) {}
    try {
      if (sim.world.phoneCall && sim.world.phoneCall === npc.id) s += RET_W_PHONE;
    } catch (_) {}
    const recent = recentShortTerm(sim);
    if (recent && npc.name && recent.includes(npc.name)) s += RET_W_RECENT;
    const logs = recentLog(sim);
    if (logs && npc.name && logs.includes(npc.name)) s += RET_W_LOG;
    const loc = (sim.world && sim.world.location) || "";
    if (loc && npc.name && loc.includes(npc.name)) s += RET_W_LOCNM;
    s += (Math.round(npc.familiarity) || 0) / 10 + (Math.round(npc.trust) || 0) / 20;
    // NEW signals below (bounded; see header table).
    s += proximityBonus(npc, sim);
    try {
      const contacts = c.contacts instanceof Map ? c.contacts : null;
      const day = Number.isInteger(c.dayCount) ? c.dayCount : 1;
      const last = contacts && npc.id ? contacts.get(npc.id) : undefined;
      if (Number.isInteger(last)) {
        const age = Math.max(0, day - last);
        if (age <= RET_W_RECENCY_WINDOW_DAYS) s += RET_W_RECENCY_MAX * (1 - age / RET_W_RECENCY_WINDOW_DAYS);
      }
    } catch (_) {}
    try {
      const journal = Array.isArray(c.journal) ? c.journal : (Array.isArray(sim.journal) ? sim.journal : []);
      let hooks = 0, maxW = 0;
      const nm = normName(npc.name);
      for (const ev of journal) {
        if (!ev || typeof ev !== "object") continue;
        const acts = Array.isArray(ev.actors) ? ev.actors : [];
        const nmatch = nm && String(ev.text || "").includes(npc.name);
        const mine = acts.some((a) => typeof a === "string" && a && (a === npc.id || normName(a) === nm)) || !!nmatch;
        if (!mine) continue;
        if (ev.narrated !== true && hooks < 99) hooks++;
        const w = typeof ev.weight === "number" && Number.isFinite(ev.weight) ? ev.weight : 0;
        if (w > maxW) maxW = w;
      }
      s += Math.min(RET_W_HOOK_CAP, hooks * RET_W_HOOK_EACH);
      s += Math.min(RET_W_EVENT_WEIGHT_CAP, Math.max(0, maxW) * RET_W_EVENT_WEIGHT);
    } catch (_) {}
    try {
      const rels = (sim && sim.relationships) || {};
      let rel = rels["r_" + npc.id];
      if (!rel || typeof rel !== "object") {
        const nm = normName(npc.name);
        for (const r of Object.values(rels)) {
          if (r && typeof r === "object" && normName(r.name) === nm) { rel = r; break; }
        }
      }
      if (rel) {
        const t = (typeof rel.trust === "number" && Number.isFinite(rel.trust)) ? rel.trust : 0;
        const f = (typeof rel.familiarity === "number" && Number.isFinite(rel.familiarity)) ? rel.familiarity : 0;
        s += Math.min(RET_W_REL_CAP, Math.max(0, (t + f) / 10));
      }
    } catch (_) {}
    return s;
  } catch (_) { return -Infinity; }
}

function cmpRanked(a, b) {
  if (b.s !== a.s) return b.s - a.s;
  const ai = String(a.npc.id), bi = String(b.npc.id);
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

// Query extractor (no resolution — the engine pre-resolves targetId via
// resolvePersonKey, so memory/ never imports engine/).
export function buildRetrievalQuery(sim, currentInput) {
  let text = "", target = "", type = null;
  try {
    if (typeof currentInput === "string") text = currentInput;
    else if (currentInput && typeof currentInput === "object") {
      text = String(currentInput.text || "");
      target = String(currentInput.target || "");
      type = currentInput.type ?? null;
    }
  } catch (_) {}
  return { text, target, targetId: null, type };
}

// Main entry. opts = { topN, legacyOrder(n)->npc[], scorer }.
// M4: the resolved target is ALWAYS detailed (forced slot, even over
// budget — the unchanged fit machinery enforces budgets downstream and
// never drops the target). Present NPCs are forced too (the
// PRESENT/OFF-SCREEN partition must reflect world.present exactly).
// No-scarcity rule: when every live NPC fits in topN, detailed order
// defers to legacyOrder verbatim (rankedNpcs) — retrieval prioritization
// engages only under scarcity, so small fixtures render byte-identically.
export function retrieve(sim, query, opts) {
  const o = opts || {};
  const topN = Math.max(0, Math.round(o.topN ?? RETRIEVAL_TOPN_DEFAULT));
  const scorer = typeof o.scorer === "function" ? o.scorer : lexicalScore;
  const q = query || {};
  const out = { detailed: [], summarized: [], roster: [], moreCount: 0, tiers: new Map(), scores: new Map(), scarce: false };
  try {
    const live = liveNpcs(sim);
    if (!live.length || topN === 0) return out;
    const tctx = tierContext(sim, q);
    const cls = classifyAll(sim, tctx);
    out.tiers = cls.tierById;
    const journal = Array.isArray(sim.journal) ? sim.journal : [];
    const sctx = { contacts: cls.contacts, dayCount: tctx.dayCount, journal };
    for (const npc of live) {
      let s = -Infinity;
      try { s = scorer(npc, sim, q, sctx); } catch (_) { s = -Infinity; }
      if (typeof s !== "number" || !Number.isFinite(s)) s = -Infinity;
      out.scores.set(npc.id, s);
    }
    const scarce = live.length > topN;
    out.scarce = scarce;
    if (!scarce && typeof o.legacyOrder === "function") {
      let det = [];
      try { det = o.legacyOrder(topN) || []; } catch (_) { det = []; }
      out.detailed = det.filter((n) => n && typeof n === "object" && !n.inactive && !n.controlled);
      return out;
    }
    const byId = new Map(live.map((n) => [n.id, n]));
    const scored = live.map((npc) => ({ npc, s: out.scores.get(npc.id) ?? -Infinity }));
    scored.sort(cmpRanked);
    const rankOf = (t) => (t === "active" ? 0 : t === "dormant" ? 1 : 2);
    const tierOrdered = scored.slice().sort((a, b) => {
      const ta = rankOf(cls.tierById.get(a.npc.id)), tb = rankOf(cls.tierById.get(b.npc.id));
      if (ta !== tb) return ta - tb;
      return cmpRanked(a, b);
    });
    // Forced: present + resolved target first (M4 + partition fidelity),
    // score order within; then tier-then-score fill; target displaced in if
    // sliced out (mirrors rankedNpcs legacy guarantee).
    const presentSet = new Set(tctx.presentIds || []);
    const forced = [];
    const seen = new Set();
    for (const x of tierOrdered) {
      if (presentSet.has(x.npc.id) || (tctx.targetId && x.npc.id === tctx.targetId)) { forced.push(x); seen.add(x.npc.id); }
    }
    forced.sort(cmpRanked);
    const rest = tierOrdered.filter((x) => !seen.has(x.npc.id));
    let detailed = [...forced, ...rest].slice(0, Math.max(topN, forced.length)).map((x) => x.npc);
    if (tctx.targetId && !detailed.find((n) => n.id === tctx.targetId)) {
      const tn = byId.get(tctx.targetId);
      if (tn) {
        if (detailed.length >= Math.max(topN, 1) && topN > 0) detailed[detailed.length - 1] = tn;
        else detailed.push(tn);
      }
    }
    out.detailed = detailed;
    // Slices for rendering (engine maps them to text via summarize.js):
    // summarized = dormant-tier omitted (one-liners); roster = the rest.
    const inDet = new Set(detailed.map((n) => n.id));
    const omitted = scored.filter((x) => !inDet.has(x.npc.id));
    out.summarized = omitted.filter((x) => cls.tierById.get(x.npc.id) === "dormant").slice(0, SUMMARIZED_MAX_N).map((x) => x.npc);
    const sumSet = new Set(out.summarized.map((n) => n.id));
    const rosCands = omitted.filter((x) => !sumSet.has(x.npc.id)).map((x) => x.npc);
    out.roster = rosCands.slice(0, ROSTER_MAX_N);
    out.moreCount = Math.max(0, rosCands.length - out.roster.length);
    return out;
  } catch (_) {
    return out;
  }
}

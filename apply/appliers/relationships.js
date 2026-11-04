// Gate 3 applier: RELATIONSHIPS — resolve-or-create + ±REL_MAX_STEP rails,
// mirror-sync to the linked NPC record. Splice: verbatim lines 2087-2162.
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { isValidPatchKey, isReservedKey, hasOwn, safeGet, safeSet, isFiniteNum, normName, resolvePersonKey, clamp100, REL_MAX_STEP, ensureRelationship, findLinkedRel, isIdShaped } from "../../engine.js";

export const BRANCHES = [
  "relationships:capped",
  "relationships:created",
  "relationships:entry",
  "relationships:ignored-controlled",
];

export function validateRelationships(sim, patch, ctx) {
  return !!(patch && patch.relationships && typeof patch.relationships === "object");
}

export function applyRelationships(sim, patch, ctx) {
  cov("relationships:entry");
  if (patch.relationships && typeof patch.relationships === "object") {
    for (const [k, v] of Object.entries(patch.relationships)) {
      if (!v || typeof v !== "object") continue;
      // C1: reject prototype-chain and injection keys before any resolution.
      if (!isValidPatchKey(k)) { console.warn("[people] ignoring unsafe relationship key:", String(k).slice(0, 40)); continue; }
      // C4: id-based controlled guard (stable link; survives persona renames).
      try {
        const _cid = typeof sim.controlledNpcId === "string" ? sim.controlledNpcId : null;
        if (_cid) {
          const _ctl = safeGet(sim.npcs, _cid);
          if (_ctl && (normName(k) === normName(_ctl.name) || normName(k) === normName(_ctl.id))) { console.debug("[swap] ignoring relationships block for controlled id:", k); continue; }
          cov("relationships:ignored-controlled");
        }
      } catch (_) {}
      const hit = resolvePersonKey(sim, k);
      // R5 flag: never resurrect or double-apply the controlled person as an NPC.
      // The HUD may keep showing their pre-existing relationship row; the model
      // must not create or mutate it via patch keys.
      try {
        const _cn = normName(sim.persona?.name || "");
        if (_cn && normName(k) === _cn) { console.debug("[swap] ignoring relationships block for controlled person:", k); continue; }
        cov("relationships:ignored-controlled");
      } catch (_) {}
      if (hit && hit.npc && hit.npc.controlled) { console.debug("[swap] ignoring relationships block for controlled NPC:", k); continue; }
      cov("relationships:ignored-controlled");
      let rel = hit ? hit.rel : null;
      if (!rel && hit && hit.npc) {
        // known person but no relationship record yet: create with real display name
        const npc = hit.npc;
        const nid = "r_" + npc.id;
        rel = { id: nid, name: npc.name, type: String(npc.role || "পরিচিত").slice(0, 40), trust: clamp100(npc.trust ?? 30), familiarity: clamp100(npc.familiarity ?? 10), emotion: String(npc.emotion || "নিরপেক্ষ").slice(0, 40), lastChange: "", lastDay: Math.max(1, Math.round(sim.world.dayCount || 1)) };
        sim.relationships[nid] = rel;
        cov("relationships:created");
      }
      if (!rel) {
        // Issue #02: never create id-named relationships; only plausible human names.
        // C1: unsafe keys were already rejected above; keep both rails.
        if (isIdShaped(k)) { console.warn("[people] ignoring id-shaped relationship key with no match:", k); continue; }
        const nm = String(k).trim();
        if (!nm || /[\u0980-\u09FF]/.test(nm) === false && nm.length < 2) { console.warn("[people] ignoring implausible relationship key:", k); continue; }
        // R5 flag: a stranger-controlled player has no NPC record — still ignore
        // relationship creation for their own name (checked above by persona-name match).
        const id = "r" + Date.now() + Math.floor(Math.random() * 999);
        rel = { id, name: nm.slice(0, 60), type: "পরিচিত", trust: 30, familiarity: 10, emotion: "নিরপেক্ষ", lastChange: "", lastDay: Math.max(1, Math.round(sim.world.dayCount || 1)) };
        if (!safeSet(sim.relationships, id, rel)) continue;
      }
      // Issue #10(ii): gradual social change, JS-backed.
      if (isFiniteNum(v.trust)) {
        const t = clamp100(v.trust), d = t - rel.trust;
        const lim = Math.max(-REL_MAX_STEP, Math.min(REL_MAX_STEP, d));
        if (lim !== d) { console.warn(`[rails] trust move for ${rel.name} capped ±${REL_MAX_STEP}.`); cov("relationships:capped"); }
        rel.trust = clamp100(rel.trust + lim);
      }
      if (isFiniteNum(v.familiarity)) {
        const t = clamp100(v.familiarity), d = t - rel.familiarity;
        const lim = Math.max(-REL_MAX_STEP, Math.min(REL_MAX_STEP, d));
        if (lim !== d) { console.warn(`[rails] familiarity move for ${rel.name} capped ±${REL_MAX_STEP}.`); cov("relationships:capped"); }
        rel.familiarity = clamp100(rel.familiarity + lim);
      }
      if (v.emotion) rel.emotion = String(v.emotion).slice(0, 40);
      if (v.note) rel.lastChange = String(v.note).slice(0, 200);
      if (v.type) rel.type = String(v.type).slice(0, 40);
      rel.lastDay = Math.max(1, Math.round(sim.world.dayCount || 1));
      // B4: keep the linked NPC record synchronized with the clamped/rate-limited
      // relationship values (npcRelevance + CAST read the npc side). Never touch
      // a controlled record.
      try {
        const _ln = hit ? hit.npc : null;
        if (_ln && !_ln.controlled) {
          let _cnB4 = "";
          try { _cnB4 = normName(sim.persona?.name || ""); } catch (_) {}
          if (!(_cnB4 && normName(_ln.name) === _cnB4)) {
            _ln.trust = clamp100(rel.trust);
            _ln.familiarity = clamp100(rel.familiarity);
            if (v && v.emotion) _ln.emotion = String(rel.emotion || "").slice(0, 40);
          }
        }
      } catch (_) {}
    }
  }
}

export const ENTRIES = [
  {
    id: "relationships",
    key: "relationships",
    phase: PHASES.PEOPLE,
    order: 100,
    owns: ["relationships", "npcs"],
    notes: "Every key resolved via resolvePersonKey; unsafe/controlled/id-shaped/implausible keys rejected. Trust/familiarity move at most ±15/beat; linked NPC record mirrors the clamped values. Controlled person never created/mutated.",
    validate: validateRelationships,
    apply: applyRelationships,
  },
];

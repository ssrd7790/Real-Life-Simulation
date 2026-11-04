// Gate 3 applier: MIND — npc_mind chunks (thought/intent/doing), applied
// BEFORE the roster resolves so returning NPCs carry fresh doing lines.
// Splice: verbatim lines 2329-2361.
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { PATCH_MAX_MIND_KEYS, isValidPatchKey, resolvePersonKey, normName, safeGet } from "../../engine.js";
import { validateMindChunk, migrateNpc } from "../../personality.js";

export const BRANCHES = [
  "npcMind:applied",
  "npcMind:entry",
];

export function validateNpcMind(sim, patch, ctx) {
  return !!(patch && patch.npc_mind && typeof patch.npc_mind === "object");
}

export function applyNpcMind(sim, patch, ctx) {
  cov("npcMind:entry");
  // BUG2: npc_mind applied BEFORE present resolution (after add/exit) so returns work.
  // Inactive NPCs never touched; controlled person ignored.
  if (patch.npc_mind && typeof patch.npc_mind === "object") {
    let _n = 0;
    for (const [k, v] of Object.entries(patch.npc_mind)) {
      if (_n >= PATCH_MAX_MIND_KEYS) break;
      if (!v || typeof v !== "object") continue;
      // C1: reject unsafe keys before resolution.
      if (!isValidPatchKey(k)) { console.warn("[people] ignoring npc_mind with unsafe key:", String(k).slice(0, 40)); continue; }
      // C4: id-based controlled guard (stable link; survives persona renames).
      try {
        const _cidM = typeof sim.controlledNpcId === "string" ? sim.controlledNpcId : null;
        if (_cidM) {
          const _ctlM = safeGet(sim.npcs, _cidM);
          if (_ctlM && (normName(k) === normName(_ctlM.name) || normName(k) === normName(_ctlM.id))) { console.debug("[swap] ignoring npc_mind for controlled id:", k); continue; }
        }
      } catch (_) {}
      const chunk = validateMindChunk(v);
      if (!chunk) continue;
      const hit = resolvePersonKey(sim, k);
      const npc = hit ? hit.npc : null;
      if (!npc || npc.inactive) continue;
      if (npc.controlled) { console.debug("[swap] ignoring npc_mind for controlled person:", k); continue; }
      try {
        const _cnm = normName(sim.persona?.name || "");
        if (_cnm && normName(k) === _cnm) { console.debug("[swap] ignoring npc_mind matching controlled name:", k); continue; }
      } catch (_) {}
      try { if (migrateNpc(npc)) {} } catch (_) {}
      if (!npc.mind || typeof npc.mind !== "object") npc.mind = {};
      for (const [fk, fv] of Object.entries(chunk)) npc.mind[fk] = fv;
      _n++;
      cov("npcMind:applied");
    }
  }
}

export const ENTRIES = [
  {
    id: "npcMind",
    key: "npc_mind",
    phase: PHASES.PEOPLE,
    order: 130,
    owns: ["npcs"],
    notes: "Validated chunks only (thought<=160/intent<=140/doing<=120); capped at 20 keys/beat. Inactive/controlled records never touched. Must run before ROSTER (doing lines prune the roster).",
    validate: validateNpcMind,
    apply: applyNpcMind,
  },
];

// Gate 3 applier: NPC-MEMORY — per-NPC memory lines (capped 5/key, kept 20).
// Splice: verbatim lines 2533-2559.
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { PATCH_MAX_NPC_MEM_PER_KEY, NPC_MEMORY_MAX, isValidPatchKey, safeGet, resolvePersonKey, normName } from "../../engine.js";

export const BRANCHES = [
  "npcMemory:appended",
  "npcMemory:entry",
];

export function validateNpcMemory(sim, patch, ctx) {
  return !!(patch && patch.npc_memory_add && typeof patch.npc_memory_add === "object");
}

export function applyNpcMemory(sim, patch, ctx) {
  cov("npcMemory:entry");
  if (patch.npc_memory_add && typeof patch.npc_memory_add === "object") {
    for (const [k, v] of Object.entries(patch.npc_memory_add)) {
      if (!Array.isArray(v)) continue;
      // C1: reject unsafe keys before resolution.
      if (!isValidPatchKey(k)) { console.warn("[people] ignoring npc_memory_add with unsafe key:", String(k).slice(0, 40)); continue; }
      // C4: id-based controlled guard (stable link; survives persona renames).
      try {
        const _cidA2 = typeof sim.controlledNpcId === "string" ? sim.controlledNpcId : null;
        if (_cidA2) {
          const _ctlA2 = safeGet(sim.npcs, _cidA2);
          if (_ctlA2 && (normName(k) === normName(_ctlA2.name) || normName(k) === normName(_ctlA2.id))) { console.debug("[swap] ignoring npc_memory_add for controlled id:", k); continue; }
        }
      } catch (_) {}
      const hit = resolvePersonKey(sim, k);
      const npc = hit ? hit.npc : null;
      if (!npc || npc.inactive) continue;
      // R5 flag: model addressing the controlled character as an NPC — ignore.
      if (npc.controlled) { console.debug("[swap] ignoring npc_memory_add for controlled person:", k); continue; }
      try {
        const _cn6 = normName(sim.persona?.name || "");
        if (_cn6 && normName(k) === _cn6) { console.debug("[swap] ignoring npc_memory_add matching controlled name:", k); continue; }
      } catch (_) {}
      if (!Array.isArray(npc.memory)) npc.memory = [];
      for (const m of v.slice(0, PATCH_MAX_NPC_MEM_PER_KEY)) { if (m) npc.memory.push(String(m).slice(0, 300)); }
      cov("npcMemory:appended");
      npc.memory = npc.memory.slice(-NPC_MEMORY_MAX);
    }
  }
}

export const ENTRIES = [
  {
    id: "npcMemory",
    key: "npc_memory_add",
    phase: PHASES.LAND,
    order: 170,
    owns: ["npcs"],
    notes: "Non-array values ignored; controlled/inactive records untouched.",
    validate: validateNpcMemory,
    apply: applyNpcMemory,
  },
];

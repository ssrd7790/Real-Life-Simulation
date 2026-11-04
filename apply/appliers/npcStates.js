// Gate 3 applier: NPC-STATES — validated state landing + dominant-emotion
// derivation (from FINAL post-decay+patch values, >=60) mirrored to the
// linked relationship unless the same patch set an emotion via relationships.
// Splice: verbatim lines 2461-2532 (touchedNpcIds -> ctx).
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { isValidPatchKey, isReservedKey, hasOwn, safeGet, resolvePersonKey, normName, EMOTION_LABEL, findLinkedRel } from "../../engine.js";
import { validateStates, isMinorNpc, MINOR_DESIRE_VALUE } from "../../personality.js";

export const BRANCHES = [
  "emotion:derived",
  "emotion:entry",
  "emotion:skipped-rel-wins",
  "npcStates:entry",
  "npcStates:landed",
];

export function validateNpcStates(sim, patch, ctx) {
  return !!(patch && patch.npc_states && typeof patch.npc_states === "object");
}

export function applyNpcStates(sim, patch, ctx) {
  cov("npcStates:entry");
  if (patch.npc_states && typeof patch.npc_states === "object") {
    for (const [k, v] of Object.entries(patch.npc_states)) {
      // C1: reject unsafe keys before resolution.
      if (!isValidPatchKey(k)) { console.warn("[people] ignoring npc_states with unsafe key:", String(k).slice(0, 40)); continue; }
      // C4: id-based controlled guard (stable link; survives persona renames).
      try {
        const _cidS = typeof sim.controlledNpcId === "string" ? sim.controlledNpcId : null;
        if (_cidS) {
          const _ctlS = safeGet(sim.npcs, _cidS);
          if (_ctlS && (normName(k) === normName(_ctlS.name) || normName(k) === normName(_ctlS.id))) { console.debug("[swap] ignoring npc_states for controlled id:", k); continue; }
        }
      } catch (_) {}
      const st = validateStates(v);
      if (!st) continue;
      const hit = resolvePersonKey(sim, k);
      const npc = hit ? hit.npc : null;
      if (!npc || npc.inactive) continue;
      // R5 flag: model addressing the controlled character as an NPC — ignore.
      if (npc.controlled) { console.debug("[swap] ignoring npc_states for controlled person:", k); continue; }
      try {
        const _cn5 = normName(sim.persona?.name || "");
        if (_cn5 && normName(k) === _cn5) { console.debug("[swap] ignoring npc_states matching controlled name:", k); continue; }
      } catch (_) {}
      // R1: model-supplied desire for a confirmed minor is discarded, never applied.
      if (isMinorNpc(npc) && hasOwn(st, "desire")) delete st.desire;
      if (Object.keys(st).length === 0) continue;
      npc.states = { ...(npc.states || {}), ...st };
      // Enforce zero even if a legacy save carried a nonzero value.
      if (isMinorNpc(npc)) npc.states.desire = MINOR_DESIRE_VALUE;
      ctx.touchedNpcIds.add(npc.id);
      cov("npcStates:landed");
    }
  }
}

export function validateEmotion(sim, patch, ctx) {
  return true; // runs whenever states landed (no-op on empty touch set)
}

export function applyEmotion(sim, patch, ctx) {
  cov("emotion:entry");
  // Issue #01: dominant-emotion label derived from FINAL state values (post-decay + patch).
  // B4: mirror the derived mood to the linked relationship record so HUD and
  // CAST never contradict — unless this same patch explicitly set an emotion
  // via patch.relationships for that person (relationships wins then).
  const _relEmotionIds = new Set();
  try {
    if (patch.relationships && typeof patch.relationships === "object") {
      for (const [rk, rv] of Object.entries(patch.relationships)) {
        if (!rv || typeof rv !== "object" || !rv.emotion) continue;
        try {
          const _h = resolvePersonKey(sim, rk);
          if (_h && _h.npc && _h.npc.id) _relEmotionIds.add(_h.npc.id);
        } catch (_) {}
      }
    }
  } catch (_) {}
  for (const id of ctx.touchedNpcIds) {
    if (isReservedKey(id)) continue;
    const npc = safeGet(sim.npcs, id);
    if (!npc || !npc.states) continue;
    // Never mutate or resurrect a controlled record via this path.
    if (npc.controlled) continue;
    try {
      const _cnB4s = normName(sim.persona?.name || "");
      if (_cnB4s && normName(npc.name) === _cnB4s) continue;
    } catch (_) {}
    const entries = Object.entries(npc.states).sort((a, b) => b[1] - a[1]);
    const dom = entries[0];
    if (dom && dom[1] >= 60 && EMOTION_LABEL[dom[0]]) { npc.emotion = EMOTION_LABEL[dom[0]]; cov("emotion:derived"); }
    else continue;
    if (_relEmotionIds.has(npc.id)) continue;
    cov("emotion:skipped-rel-wins");
    try {
      const _rel = findLinkedRel(sim, npc);
      if (_rel) {
        _rel.emotion = String(npc.emotion).slice(0, 40);
        _rel.lastDay = Math.max(1, Math.round(sim.world.dayCount || 1));
      }
    } catch (_) {}
  }
}

export const ENTRIES = [
  {
    id: "npcStates",
    key: "npc_states",
    phase: PHASES.LAND,
    order: 150,
    owns: ["npcs"],
    notes: "Hot-decay ran in DECAY, so the model's landing state wins. Minor desire discarded (forced 0). Controlled person ignored.",
    validate: validateNpcStates,
    apply: applyNpcStates,
  },
  {
    id: "emotion",
    key: null,
    phase: PHASES.LAND,
    order: 160,
    owns: ["npcs", "relationships"],
    notes: "Label derived from final numbers (>=60) so label and numbers never contradict; relationships-block emotion wins ties.",
    validate: validateEmotion,
    apply: applyEmotion,
  },
];

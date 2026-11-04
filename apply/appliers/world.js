// Gate 3 applier: WORLD — world_pulse atmosphere line + offscreen_events
// attribution (fog-safe: attributed entries land in that NPC's invisible
// memory; unattributed strings dropped, never in player memory).
// Splice: verbatim lines 2561-2623.
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { PATCH_MAX_OFFSCREEN_ADD, NPC_MEMORY_MAX, isValidPatchKey, resolvePersonKey, normName, normBase, hasWordBoundary, safeGet, tokenHasNegationMarker, tokenHasRemoteMarker, tokenHasDepartureMarker } from "../../engine.js";
import { WORLD_PULSE_MAX } from "../../personality.js";

export const BRANCHES = [
  "offscreen:attributed",
  "offscreen:dropped",
  "offscreen:entry",
  "worldPulse:entry",
];

export function validateWorldPulse(sim, patch, ctx) {
  return typeof (patch && patch.world_pulse) === "string" && !!(patch.world_pulse.trim());
}

export function applyWorldPulse(sim, patch, ctx) {
  cov("worldPulse:entry");
  // Living World: neighborhood pulse (single atmosphere line, player learns via narration).
  if (typeof patch.world_pulse === "string" && patch.world_pulse.trim()) {
    sim.world.pulse = patch.world_pulse.trim().slice(0, WORLD_PULSE_MAX);
  }
}

export function validateOffscreen(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.offscreen_events));
}

export function applyOffscreen(sim, patch, ctx) {
  cov("offscreen:entry");
  // Living World: off-screen happenings (fog-safe). Attributed entries land in
  // that NPC's player-invisible memory; unattributed strings are dropped with a
  // debug (atmosphere belongs in world_pulse, player memory must not gain
  // unwitnessed events). Never touches player narration or short-term memory.
  if (Array.isArray(patch.offscreen_events)) {
    for (const e of patch.offscreen_events.slice(0, PATCH_MAX_OFFSCREEN_ADD)) {
      if (!e) continue;
      let npcKey = null, txt = "";
      if (typeof e === "string") { txt = e.slice(0, 220).trim(); }
      else if (typeof e === "object") {
        npcKey = e.npc ?? e.id ?? e.name ?? e.who ?? null;
        txt = String(e.text ?? e.what ?? e.event ?? "").slice(0, 220).trim();
      }
      if (!txt) continue;
      // C1: validate explicit off-screen keys before resolution.
      if (npcKey != null && String(npcKey).trim() && !isValidPatchKey(String(npcKey))) { console.warn("[world] ignoring offscreen_events with unsafe key:", String(npcKey).slice(0, 40)); continue; }
      // C4: id-based controlled guard (stable link; survives persona renames).
      try {
        const _cidO = typeof sim.controlledNpcId === "string" ? sim.controlledNpcId : null;
        if (_cidO && npcKey != null && String(npcKey).trim()) {
          const _ctlO = safeGet(sim.npcs, _cidO);
          if (_ctlO && (normName(String(npcKey)) === normName(_ctlO.name) || normName(String(npcKey)) === normName(_ctlO.id))) { console.debug("[swap] ignoring offscreen_events for controlled id."); continue; }
        }
      } catch (_) {}
      let npc = null;
      try {
        if (npcKey != null && String(npcKey).trim()) {
          const hit = resolvePersonKey(sim, String(npcKey));
          npc = hit ? hit.npc : null;
        } else {
          // BUG9: safe word-boundary/honorific-aware attribution (never raw includes).
          const low = normName(txt);
          const lowBase = normBase(txt);
          npc = Object.values(sim.npcs || {}).find((n) => {
            if (!n || n.inactive || n.controlled || !n.name) return false;
            const nn = normName(n.name);
            const nb = normBase(n.name);
            return (nn && hasWordBoundary(low, nn)) || (nb && nb.length >= 3 && hasWordBoundary(lowBase, nb));
          }) || null;
        }
      } catch (_) { npc = null; }
      if (!npc || npc.inactive) { cov("offscreen:dropped"); console.debug("[world] unattributed offscreen event dropped (use world_pulse for atmosphere)."); continue; }
      // BUG9: NPCs physically in-room never get off-screen notes.
      try {
        if (Array.isArray(sim.world.present) && sim.world.present.includes(npc.id)) continue;
      } catch (_) {}
      if (npc.controlled) { console.debug("[swap] ignoring offscreen_events for controlled person."); continue; }
      try {
        const _cno = normName(sim.persona?.name || "");
        if (_cno && npc.name && normName(npc.name) === _cno) { console.debug("[swap] ignoring offscreen_events matching controlled name."); continue; }
      } catch (_) {}
      if (!Array.isArray(npc.memory)) npc.memory = [];
      // BUG9: tag off-screen notes so player-interaction memories survive the 3-item window.
      let tag = String(txt);
      if (!tag.startsWith("[অফ-স্ক্রিন]")) tag = "[অফ-স্ক্রিন] " + tag;
      npc.memory.push(tag.slice(0, 300));
      cov("offscreen:attributed");
      npc.memory = npc.memory.slice(-NPC_MEMORY_MAX);
    }
  }
}

export const ENTRIES = [
  {
    id: "worldPulse",
    key: "world_pulse",
    phase: PHASES.WORLD,
    order: 180,
    owns: ["world"],
    notes: "Single atmosphere line, sliced to 220. Player learns via narration, not state.",
    validate: validateWorldPulse,
    apply: applyWorldPulse,
  },
  {
    id: "offscreen",
    key: "offscreen_events",
    phase: PHASES.WORLD,
    order: 190,
    owns: ["npcs"],
    notes: "Attribution via explicit key or word-boundary/honorific name match (never raw includes). In-room NPCs never get off-screen notes; off-screen notes are tagged so interaction memories survive the window.",
    validate: validateOffscreen,
    apply: applyOffscreen,
  },
];

// Gate 3 applier: ROSTER — authoritative end-of-beat presence resolution
// (always runs). scene_present JSON first, _scene_tag_present fallback (with
// new-NPC retention), locChanged => [], no signal => [] (M3: a departed NPC
// must not linger). Only newly-supplied doing prunes; arrival verbs exempt.
// Splice: verbatim lines 2362-2460 (_patchDoingFor -> module fn;
// _presentAtStart/locChanged/_newNpcIds -> ctx).
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { resolvePresentIds, resolvePersonKey, isReservedKey, safeGet, normName, normBase, hasWordBoundary, tokenHasNegationMarker, tokenHasArrivalMarker, tokenHasRemoteMarker, tokenHasDepartureMarker } from "../../engine.js";

export const BRANCHES = [
  "roster:empty",
  "roster:entry",
  "roster:json",
  "roster:loc-changed",
  "roster:tag",
];

export function validateRoster(sim, patch, ctx) {
  return true; // always runs: presence is authoritative every beat
}

export function applyRoster(sim, patch, ctx) {
  cov("roster:entry");
  // BUG1+BUG2: authoritative end-of-beat roster (scene_present JSON first, SCENE tag fallback).
  // locChanged => keep [] (pre-narration SCENE described the OLD room). New-only doing prunes.
  // M3: no signal at all (neither JSON nor tag) clears the roster — a departed NPC
  // must not linger as [PRESENT] on the following beat.
  const _patchDoingFor = (id) => {
    try {
      if (isReservedKey(id)) return "";
      if (!patch.npc_mind || typeof patch.npc_mind !== "object") return "";
      for (const [k, v] of Object.entries(patch.npc_mind)) {
        try {
          const _h = resolvePersonKey(sim, k);
          if (_h && _h.npc && _h.npc.id === id && v && typeof v.doing === "string" && v.doing.trim()) return v.doing;
        } catch (_) {}
      }
      const _direct = safeGet(patch.npc_mind, id);
      if (_direct && typeof _direct.doing === "string") return _direct.doing;
    } catch (_) {}
    return "";
  };
  try {
    if (!Array.isArray(sim.world.present)) sim.world.present = [];
    cov("roster:empty");
    if (Array.isArray(patch.scene_present)) {
      sim.world.present = resolvePresentIds(sim, patch.scene_present);
      cov("roster:json");
    } else if (ctx.locChanged) {
      cov("roster:loc-changed");
      sim.world.present = [];
      cov("roster:empty");
    } else if (Array.isArray(patch._scene_tag_present)) {
      sim.world.present = resolvePresentIds(sim, patch._scene_tag_present);
      cov("roster:tag");
      // Don't drop brand-new live NPCs introduced this beat when SCENE was pre-arrival.
      try {
        for (const nid of ctx.newNpcIds) {
          const nn = safeGet(sim.npcs, nid);
          if (!nn || nn.inactive || nn.controlled) continue;
          if (sim.world.present.includes(nid)) continue;
          const nd = _patchDoingFor(nid);
          if (nd && (tokenHasRemoteMarker(nd) || tokenHasDepartureMarker(nd) || tokenHasNegationMarker(nd))) continue;
          sim.world.present.push(nid);
        }
      } catch (_) {}
    } else {
      // M3: no roster signal — clear rather than retain a stale roster.
      sim.world.present = [];
      cov("roster:empty");
    }
    // Prune: inactive/controlled never present; ONLY newly-supplied doing prunes.
    // Arrival verbs elsewhere-toward-here exempt departure pruning.
    const _depMarks = ["চলে গেছে", "চলে গেল", "চলে গেছেন", "বেরিয়ে গেছে", "বেরিয়ে গেল", "বেরিয়ে পড়েছে", "বের হয়ে গেছে", "বের হয়ে গেল", "বিদায় নিয়ে"];
    sim.world.present = (sim.world.present || []).filter((id) => {
      const npc = safeGet(sim.npcs || {}, id);
      if (!npc || npc.inactive || npc.controlled) return false;
      try {
        const _doing = _patchDoingFor(id);
        if (!_doing) return true;
        if (tokenHasArrivalMarker(_doing)) return true;
        for (const m of _depMarks) if (_doing.includes(m)) return false;
      } catch (_) {}
      return true;
    });
    // BUG9: active phone call never physically present (unless explicitly hung up this beat).
    try {
      if (sim.world.phoneCall && patch.phone_call !== null) {
        sim.world.present = (sim.world.present || []).filter((id) => id !== sim.world.phoneCall);
      }
    } catch (_) {}
    try {
      const _seen = new Set(); const _out = [];
      for (const _id of sim.world.present) {
        if (typeof _id !== "string" || !_id || _seen.has(_id)) continue;
        if (isReservedKey(_id)) continue;
        const _nn = safeGet(sim.npcs || {}, _id);
        if (!_nn || _nn.inactive || _nn.controlled) continue;
        _seen.add(_id); _out.push(_id);
      }
      sim.world.present = _out;
    } catch (_) {}
    // BUG2: present->off refresh: stale player-talk doing must not haunt OFF-SCREEN prompts.
    try {
      const nowSet = new Set(sim.world.present || []);
      const mindKeys = new Set();
      try {
        if (patch.npc_mind && typeof patch.npc_mind === "object") {
          for (const k of Object.keys(patch.npc_mind)) {
            try {
              const _h = resolvePersonKey(sim, k);
              if (_h && _h.npc) mindKeys.add(_h.npc.id);
            } catch (_) {}
          }
        }
      } catch (_) {}
      for (const pid of ctx.presentAtStart) {
        if (nowSet.has(pid)) continue;
        if (mindKeys.has(pid)) continue;
        const pn = safeGet(sim.npcs || {}, pid);
        if (!pn || !pn.mind || typeof pn.mind.doing !== "string") continue;
        const d = pn.mind.doing;
        if (d.includes("তোমার সঙ্গে") || d.includes("তোমাকে") || d.includes("তোমায়") || d.includes("আপনার সঙ্গে") || d.includes("আপনাকে")) {
          pn.mind.doing = "নিজের দৈনন্দিন কাজে ব্যস্ত।";
        }
      }
    } catch (_) {}
  } catch (_) { if (!Array.isArray(sim.world.present)) sim.world.present = []; }
  cov("roster:empty");
}

export const ENTRIES = [
  {
    id: "roster",
    key: "scene_present",
    phase: PHASES.ROSTER,
    order: 140,
    owns: ["world", "npcs"],
    notes: "Mention/thought/dialogue history never implies presence — only this resolution writes sim.world.present. Phone interlocutors and inactive/controlled ids are filtered; stale player-talk doing is refreshed to neutral for the newly absent.",
    validate: validateRoster,
    apply: applyRoster,
  },
];

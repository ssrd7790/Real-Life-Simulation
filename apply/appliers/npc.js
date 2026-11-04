// Gate 3 applier: NPC — npcs_add (merge-not-duplicate, records
// ctx.newNpcIds for the ROSTER fallback) + npcs_exit (flag-only, never
// delete). Splice: verbatim lines 2163-2299 (add) and 2300-2328 (exit).
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { isValidPatchKey, hasOwn, safeGet, safeSet, normName, resolvePersonKey, clamp100, isFiniteNum, PATCH_MAX_NPCS_ADD, PATCH_MAX_EXIT, REL_MAX_STEP, ensureRelationship, findLinkedRel } from "../../engine.js";
import { validateTraits, validateStates, validateMindChunk, migrateNpc, normalizeNpcAge, shouldIncludeRomance, MINOR_LUST_VALUE, MINOR_DESIRE_VALUE } from "../../personality.js";
import { appendEvent, JOURNAL_OWN_KEYS } from "../../core/events.js";

export const BRANCHES = [
  "npcsAdd:created",
  "npcsAdd:entry",
  "npcsAdd:merged",
  "npcsAdd:minor-clamp",
  "npcsExit:entry",
  "npcsExit:flagged",
];

export function validateNpcsAdd(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.npcs_add));
}

export function applyNpcsAdd(sim, patch, ctx) {
  cov("npcsAdd:entry");
  const _newNpcIds = ctx.newNpcIds;
  if (Array.isArray(patch.npcs_add)) {
    for (const n of patch.npcs_add.slice(0, PATCH_MAX_NPCS_ADD)) {
      if (!n || !n.name) continue;
      // C1: model-supplied names/ids are untrusted — validate before any map use.
      if (typeof n.name !== "string" || !isValidPatchKey(n.name)) { console.warn("[people] ignoring npcs_add with unsafe name:", String(n && n.name).slice(0, 40)); continue; }
      if (n.id != null && (typeof n.id !== "string" || !isValidPatchKey(n.id))) { console.warn("[people] ignoring npcs_add with unsafe id:", String(n.id).slice(0, 40)); continue; }
      // v2 (R4): name-based dedupe — same normalized name = same person even with a
      // fresh id. Merge (update presence fields, fill empty bio slots, preserve
      // established psych) instead of creating a duplicate.
      const wantId = String(n.id || n.name).slice(0, 60).replace(/\s+/g, "_");
      if (!isValidPatchKey(wantId)) { console.warn("[people] ignoring npcs_add with unsafe derived id:", wantId.slice(0, 40)); continue; }
      // C4: id-based controlled guard (stable link; survives persona renames).
      try {
        const _cidA = typeof sim.controlledNpcId === "string" ? sim.controlledNpcId : null;
        if (_cidA && (wantId === _cidA || normName(n.name) === normName((safeGet(sim.npcs, _cidA) || {}).name || ""))) { console.debug("[swap] ignoring npcs_add for controlled id:", n.name); continue; }
      } catch (_) {}
      const dup = safeGet(sim.npcs, wantId) || Object.values(sim.npcs).find((x) => normName(x.name) === normName(n.name));
      if (dup) {
        // R5 flag: the controlled person already has a persistent record — never
        // double-apply a model-proposed duplicate onto it.
        if (dup.controlled) { console.debug("[swap] ignoring npcs_add for controlled person:", n.name); continue; }
        try {
          const _cn2 = normName(sim.persona?.name || "");
          if (_cn2 && normName(n.name) === _cn2) { console.debug("[swap] ignoring npcs_add matching controlled name:", n.name); continue; }
        } catch (_) {}
        if (typeof n.role === "string" && n.role.trim()) dup.role = n.role.trim().slice(0, 60);
        // B4: duplicate-merge respects the ±REL_MAX_STEP rail (no teleporting
        // trust/familiarity) and syncs any existing linked relationship record.
        if (isFiniteNum(n.trust)) {
          const _t = clamp100(n.trust), _d = _t - (dup.trust ?? 0);
          const _lim = Math.max(-REL_MAX_STEP, Math.min(REL_MAX_STEP, _d));
          if (_lim !== _d) console.warn(`[rails] trust move for ${dup.name} capped ±${REL_MAX_STEP} (npcs_add merge).`);
          dup.trust = clamp100((dup.trust ?? 0) + _lim);
        }
        if (isFiniteNum(n.familiarity)) {
          const _t2 = clamp100(n.familiarity), _d2 = _t2 - (dup.familiarity ?? 0);
          const _lim2 = Math.max(-REL_MAX_STEP, Math.min(REL_MAX_STEP, _d2));
          if (_lim2 !== _d2) console.warn(`[rails] familiarity move for ${dup.name} capped ±${REL_MAX_STEP} (npcs_add merge).`);
          dup.familiarity = clamp100((dup.familiarity ?? 0) + _lim2);
        }
        if (typeof n.emotion === "string" && n.emotion.trim()) dup.emotion = n.emotion.trim().slice(0, 40);
        for (const f of ["background", "personality", "publicPersona", "privateReality", "secrets", "goals"]) {
          if (!dup[f] && typeof n[f] === "string" && n[f].trim()) dup[f] = n[f].trim().slice(0, f === "background" || f === "personality" ? 500 : 300);
        }
        // Later merges may confirm age on an existing NPC (Issue #08).
        if (n.age !== undefined && n.age !== null) {
          const na = normalizeNpcAge(n.age);
          if (na !== null) {
            dup.age = na;
            if (!shouldIncludeRomance(dup) && dup.romance) delete dup.romance;
          }
        }
        if (dup.inactive) { dup.inactive = false; dup.exitNote = ""; dup.exitDay = null; }
        cov("npcsAdd:merged");
        migrateNpc(dup);
        // BUG2: accept inline mind on merge so returning NPCs don't stick with generic doing.
        try {
          if (n.mind && typeof n.mind === "object") {
            const mc = validateMindChunk(n.mind);
            if (mc) {
              if (!dup.mind || typeof dup.mind !== "object") dup.mind = {};
              for (const [fk, fv] of Object.entries(mc)) dup.mind[fk] = fv;
            }
          }
        } catch (_) {}
        // B4: sync any existing linked relationship to the rate-limited dup values
        // (ensureRelationship alone returns early without updating when one exists).
        try {
          const _lr = findLinkedRel(sim, dup);
          if (_lr && !_lr.controlled) {
            _lr.trust = clamp100(dup.trust ?? _lr.trust ?? 25);
            _lr.familiarity = clamp100(dup.familiarity ?? _lr.familiarity ?? 5);
            if (typeof dup.emotion === "string" && dup.emotion.trim()) _lr.emotion = String(dup.emotion).slice(0, 40);
            _lr.lastDay = Math.max(1, Math.round(sim.world.dayCount || 1));
          } else {
            ensureRelationship(sim, dup.name, dup.role, dup.trust, dup.familiarity, dup.emotion);
          }
        } catch (_) {
          try { ensureRelationship(sim, dup.name, dup.role, dup.trust, dup.familiarity, dup.emotion); } catch (_) {}
        }
        continue;
      }
      const id = wantId;
      // R5 flag: never create a second NPC record duplicating the controlled name.
      try {
        const _cn3 = normName(sim.persona?.name || "");
        if (_cn3 && normName(n.name) === _cn3) { console.debug("[swap] ignoring npcs_add creating duplicate of controlled:", n.name); continue; }
      } catch (_) {}
      const traits = validateTraits(n.core_traits) || undefined;
      const states = validateStates(n.states) || undefined;
      const age = (n.age === undefined || n.age === null) ? null : normalizeNpcAge(n.age);
      // R1: discard model-supplied lust/desire for confirmed minors at intake.
      if (typeof age === "number" && age < 18) {
        if (traits && hasOwn(traits, "lust")) traits.lust = MINOR_LUST_VALUE;
        cov("npcsAdd:minor-clamp");
        if (states && hasOwn(states, "desire")) states.desire = MINOR_DESIRE_VALUE;
      }
      // C1: validated above — safeSet creates a real own entry (never a prototype).
      if (!safeSet(sim.npcs, id, {
        id, name: String(n.name).slice(0, 60), role: String(n.role || "অপরিচিত").slice(0, 60),
        age,
        trust: clamp100(n.trust ?? 25), familiarity: clamp100(n.familiarity ?? 5), emotion: String(n.emotion || "নিরপেক্ষ").slice(0, 40),
        background: String(n.background || "").slice(0, 500), personality: String(n.personality || "").slice(0, 500),
        publicPersona: String(n.publicPersona || "").slice(0, 300), privateReality: String(n.privateReality || "").slice(0, 300),
        secrets: String(n.secrets || "").slice(0, 300), goals: String(n.goals || "").slice(0, 300), memory: [],
        inactive: false, exitNote: "", exitDay: null,
      })) continue;
      if (traits) safeGet(sim.npcs, id).core_traits = traits;
      if (states) safeGet(sim.npcs, id).states = states;
      // Issue #08: discard any LLM romance payload for minors/unconfirmed.
      if (shouldIncludeRomance(safeGet(sim.npcs, id)) && n.romance && typeof n.romance === "object") {
        safeGet(sim.npcs, id).romance = {
          openness: clamp100(n.romance.openness ?? 40),
          attractions: String(n.romance.attractions || "").slice(0, 200),
          boundaries: String(n.romance.boundaries || "").slice(0, 200),
        };
      }
      migrateNpc(safeGet(sim.npcs, id)); // fills any missing psych with a distinct profile (adult-only romance)
      // BUG2: inline mind for brand-new NPCs (model-supplied doing wins over generic default).
      try {
        if (n.mind && typeof n.mind === "object") {
          const mc2 = validateMindChunk(n.mind);
          if (mc2) {
            const _rec = safeGet(sim.npcs, id);
            if (_rec) {
              if (!_rec.mind || typeof _rec.mind !== "object") _rec.mind = {};
              for (const [fk, fv] of Object.entries(mc2)) _rec.mind[fk] = fv;
            }
          }
        }
      } catch (_) {}
      _newNpcIds.push(id);
      cov("npcsAdd:created");
      try { appendEvent(sim, { kind: "roster", actors: [String(n.name).slice(0, 60)], text: `নতুন মুখ: ${String(n.name).slice(0, 60)} এলো।`, weight: 2, narrated: false }); } catch (_) {}
      if (!Object.values(sim.relationships).find((r) => normName(r.name) === normName(n.name))) {
        const rid = "r" + Date.now() + Math.floor(Math.random() * 999);
        safeSet(sim.relationships, rid, { id: rid, name: String(n.name).slice(0, 60), type: String(n.role || "পরিচিত").slice(0, 40), trust: clamp100(n.trust ?? 25), familiarity: clamp100(n.familiarity ?? 5), emotion: String(n.emotion || "নিরপেক্ষ").slice(0, 40), lastChange: "নতুন পরিচয়", lastDay: Math.max(1, Math.round(sim.world.dayCount || 1)) });
      }
    }
  }
}

export function validateNpcsExit(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.npcs_exit));
}

export function applyNpcsExit(sim, patch, ctx) {
  cov("npcsExit:entry");
  // v2 (R4): npcs_exit — mark inactive + short note; stays in save, leaves CAST/dossiers.
  if (Array.isArray(patch.npcs_exit)) {
    for (const e of patch.npcs_exit.slice(0, PATCH_MAX_EXIT)) {
      const key = typeof e === "string" ? e : (e && (e.idOrName ?? e.id ?? e.name));
      const reason = typeof e === "string" ? "" : String((e && e.reason) || "").slice(0, 200);
      if (!key) continue;
      if (!isValidPatchKey(String(key))) { console.warn("[people] ignoring npcs_exit with unsafe key:", String(key).slice(0, 40)); continue; }
      // C4: id-based controlled guard (stable link; survives persona renames).
      try {
        const _cidE = typeof sim.controlledNpcId === "string" ? sim.controlledNpcId : null;
        if (_cidE) {
          const _ctlE = safeGet(sim.npcs, _cidE);
          if (_ctlE && (normName(String(key)) === normName(_ctlE.name) || normName(String(key)) === normName(_ctlE.id))) { console.debug("[swap] ignoring npcs_exit for controlled id:", key); continue; }
        }
      } catch (_) {}
      const hit = resolvePersonKey(sim, String(key));
      const npc = hit ? hit.npc : null;
      if (!npc || npc.inactive) continue;
      // R5 flag: the controlled person cannot exit while controlled.
      if (npc.controlled) { console.debug("[swap] ignoring npcs_exit for controlled person:", key); continue; }
      try {
        const _cn4 = normName(sim.persona?.name || "");
        if (_cn4 && normName(String(key)) === _cn4) { console.debug("[swap] ignoring npcs_exit matching controlled name:", key); continue; }
      } catch (_) {}
      npc.inactive = true;
      npc.exitNote = reason;
      npc.exitDay = Math.max(1, Math.round(sim.world.dayCount || 1));
      try { appendEvent(sim, { kind: "roster", actors: [String(npc.name || key).slice(0, 60)], text: `${String(npc.name || key).slice(0, 60)} চলে গেল।`, weight: 2, narrated: false }); } catch (_) {}
      cov("npcsExit:flagged");
    }
  }
}

export const ENTRIES = [
  {
    id: "npcsAdd",
    key: "npcs_add",
    phase: PHASES.PEOPLE,
    order: 110,
    owns: ["npcs", "relationships", ...JOURNAL_OWN_KEYS],
    notes: "Name-based dedupe: same normalized name merges (presence fields updated, empty bio slots filled, psych preserved, trust rails respected) instead of duplicating. Minors: lust/desire forced 0 at intake. New ids recorded for the roster fallback.",
    validate: validateNpcsAdd,
    apply: applyNpcsAdd,
  },
  {
    id: "npcsExit",
    key: "npcs_exit",
    phase: PHASES.PEOPLE,
    order: 120,
    owns: ["npcs", ...JOURNAL_OWN_KEYS],
    notes: "Exit flags inactive + note + exitDay; the record (identity/psych/memory) survives for hygiene compaction. Controlled person can never exit.",
    validate: validateNpcsExit,
    apply: applyNpcsExit,
  },
];

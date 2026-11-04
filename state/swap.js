// Character-sheet + perspective-swap state surgery (Gate 6). Pure w.r.t.
// the UI: every function takes the sim as a parameter. Moved verbatim from
// src/app.js (bodies + comments unchanged); only imports changed.
import { deepClone, memText, uid } from "../ui/dom.js";
import { normName, isReservedKey, hasOwn, currentAge } from "../engine.js";
import { migrateNpc, profileFor, baseStates, shouldIncludeRomance, isMinorNpc } from "../personality.js";

// Issue #07 (D3): personal vs shared split. Personal travels in the sheet:
// persona (incl. age + internal psych traits/states/romance + living-world
// conditions/experiences), stats, finances,
// inventory, memories, recurring income, personal chronicle view. Shared stays in
// the sim: calendar/time, location, NPC registry, relationships, storylines.
// NPC mind stays on the registry record (never in the sheet) and is preserved
// seamlessly across swaps by never overwriting it on leave/enter.
export function snapshotSheet(s) {
  return deepClone({ persona: s.persona, stats: s.stats, finances: s.finances, inventory: s.inventory, memories: s.memories, income: s.income ?? null, chronicle: Array.isArray(s.chronicle) ? s.chronicle : [] });
}
export function restoreSheet(s, sheet) {
  const sh = deepClone(sheet) || {};
  s.persona = sh.persona || s.persona;
  s.stats = sh.stats || s.stats;
  s.finances = sh.finances || s.finances;
  s.inventory = Array.isArray(sh.inventory) ? sh.inventory : [];
  s.memories = sh.memories || s.memories;
  if (!Array.isArray(s.memories.core)) s.memories.core = [];
  if (!Array.isArray(s.memories.shortTerm)) s.memories.shortTerm = [];
  if (!Array.isArray(s.memories.longTerm)) s.memories.longTerm = [];
  s.income = ("income" in sh) ? sh.income : (s.income ?? null);
  s.chronicle = Array.isArray(sh.chronicle) ? sh.chronicle : [];
  // Legacy sheets (no baseAge/income/chronicle) still swap safely via migration defaults.
  if (s.persona && (typeof s.persona.baseAge !== "number" || isNaN(s.persona.baseAge))) s.persona.baseAge = Math.max(18, Math.round(s.persona.age) || 25);
  if (s.persona && (typeof s.persona.baseDay !== "number" || isNaN(s.persona.baseDay))) s.persona.baseDay = Math.max(1, Math.round(s.world?.dayCount || 1));
  // Living World: legacy sheets gain empty condition/experience lists (no history touch).
  if (s.persona && !Array.isArray(s.persona.conditions)) s.persona.conditions = [];
  if (s.persona && !Array.isArray(s.persona.experiences)) s.persona.experiences = [];
}
// R5 flag mechanism (minimal redesign): NPC records are never deleted on swap and
// never stashed inside character sheets. The currently-controlled NPC-origin person
// keeps a persistent record with npc.controlled=true; leaving clears it. The original
// player (and any stranger) gains an npc_<id> record once, then it is only flagged.
// Personal sheets (snapshotSheet/restoreSheet) are unchanged; leaving writes carried
// age/psych/memory back into the single persistent NPC record.
// B3: deterministic prioritized swap-target resolution (no bidirectional substring).
// Tier 1 exact normalized name/id, Tier 2 word-boundary/prefix, Tier 3
// unidirectional substring fallback (name.includes(q) for reasonable length,
// NEVER q.includes(name) which collides "প্রিয়া".includes("রিয়া")).
function swapTier(nName, nId, nq) {
  if (!nq) return 99;
  const nn = normName(nName || "");
  const nid = normName(nId || "");
  if (!nn && !nid) return 99;
  if ((nn && nn === nq) || (nid && nid === nq)) return 1;
  if (nq.length >= 3) {
    if (nn && nn.startsWith(nq)) return 2;
    if (nid && nid.startsWith(nq)) return 2;
    try {
      const words = nn.split(" ").filter(Boolean);
      for (const w of words) {
        if (w === nq || w.startsWith(nq)) return 2;
      }
    } catch (_) {}
  }
  if (nq.length >= 4 && nn && nn.includes(nq)) return 3;
  return 99;
}
function resolveSwapTarget(sim, qRaw, oldId) {
  const nq = normName(String(qRaw || ""));
  if (!nq) return null;
  const cands = [];
  try {
    for (const [k, ent] of Object.entries(sim.characters || {})) {
      if (k === oldId) continue;
      if (isReservedKey(k)) continue;
      const sh = ent && ent.sheet ? ent.sheet : ent;
      const nm = sh && sh.persona ? sh.persona.name : "";
      if (!nm) continue;
      const t = swapTier(nm, k, nq);
      if (t <= 3) cands.push({ kind: "sheet", key: k, tier: t });
    }
  } catch (_) {}
  try {
    const curN = normName(sim?.persona?.name || "");
    for (const [k, n] of Object.entries(sim.npcs || {})) {
      if (isReservedKey(k)) continue;
      if (!n || !n.name) continue;
      if (n.controlled) continue;
      if (curN && normName(n.name) === curN) continue;
      const t = swapTier(n.name, n.id || k, nq);
      if (t <= 3) cands.push({ kind: "npc", key: k, tier: t });
    }
  } catch (_) {}
  if (!cands.length) return null;
  cands.sort((a, b) => (a.tier - b.tier) || (a.kind === b.kind ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : (a.kind === "sheet" ? -1 : 1)));
  return cands[0];
}
export function applySwap(sim, qRaw) {
  const q = String(qRaw ?? "").trim();
  if (!q) return { ok: false, reason: "empty", message: "কার দৃষ্টিতে যাবে? যেমন: /swap নাসিমা" };
  try {
    if (sim.persona && sim.persona.name && normName(q) === normName(sim.persona.name)) {
      return { ok: false, reason: "same", message: "তুমি ইতিমধ্যে " + sim.persona.name + "।" };
    }
  } catch (_) {}
  // R1: confirmed minors are never playable — resolve the intended target FIRST
  // (sheets + npcs in the same priority tier, exact beats prefix beats substring)
  // then refuse strictly against that resolved target BEFORE any state mutation.
  try {
    const _preOld = sim.controlledId;
    const _res = resolveSwapTarget(sim, q, _preOld);
    if (_res) {
      if (_res.kind === "npc") {
        const _npc = (sim.npcs || {})[_res.key];
        if (_npc && isMinorNpc(_npc)) {
          return { ok: false, reason: "minor", message: "“" + _npc.name + "” এখনো অপ্রাপ্তবয়স্ক, তাই ওর চোখে খেলা যাবে না। অন্য কাউকে বেছে নাও।" };
        }
        try {
          const _nm = _npc ? normName(_npc.name) : "";
          const _linkedSheet = _nm ? Object.values(sim.characters || {}).find((e) => {
            const _sh = e && e.sheet ? e.sheet : e;
            return _sh && _sh.persona && normName(_sh.persona.name) === _nm;
          }) : null;
          if (_linkedSheet) {
            const _sh2 = _linkedSheet && _linkedSheet.sheet ? _linkedSheet.sheet : _linkedSheet;
            const _sa = _sh2 && _sh2.persona ? (_sh2.persona.baseAge ?? _sh2.persona.age) : null;
            if (typeof _sa === "number" && Math.round(_sa) < 18) {
              const _nm2 = (_sh2 && _sh2.persona && _sh2.persona.name) || (_npc ? _npc.name : q);
              return { ok: false, reason: "minor", message: "“" + _nm2 + "” এখনো অপ্রাপ্তবয়স্ক, তাই ওর চোখে খেলা যাবে না। অন্য কাউকে বেছে নাও।" };
            }
          }
        } catch (_) {}
      } else {
        const _e = (sim.characters || {})[_res.key];
        const _sh = _e && _e.sheet ? _e.sheet : _e;
        const _nm = (_sh && _sh.persona && _sh.persona.name) || q;
        try {
          const _npcMatch = Object.values(sim.npcs || {}).find((n) => n && _sh && _sh.persona && normName(n.name) === normName(_sh.persona.name)) || null;
          if (_npcMatch && isMinorNpc(_npcMatch)) {
            return { ok: false, reason: "minor", message: "“" + _nm + "” এখনো অপ্রাপ্তবয়স্ক, তাই ওর চোখে খেলা যাবে না। অন্য কাউকে বেছে নাও।" };
          }
        } catch (_) {}
        const _sheetAge = _sh && _sh.persona ? (_sh.persona.baseAge ?? _sh.persona.age) : null;
        if (typeof _sheetAge === "number" && Math.round(_sheetAge) < 18) {
          return { ok: false, reason: "minor", message: "“" + _nm + "” এখনো অপ্রাপ্তবয়স্ক, তাই ওর চোখে খেলা যাবে না। অন্য কাউকে বেছে নাও।" };
        }
      }
    }
  } catch (_) {}
  if (!sim.characters || typeof sim.characters !== "object") sim.characters = {};
  if (!sim.npcs || typeof sim.npcs !== "object") sim.npcs = {};
  const oldId = sim.controlledId;
  const oldName = (sim.persona && sim.persona.name) || "";
  // Save current personal sheet (personal travels; shared stays in sim).
  try {
    sim.characters[oldId] = { ...(sim.characters[oldId] || {}), sheet: snapshotSheet(sim) };
  } catch (_) {
    sim.characters[oldId] = { sheet: snapshotSheet(sim) };
  }
  // Drop any legacy stash/link fields (R5 removes the stash mechanism entirely).
  try {
    for (const ent of Object.values(sim.characters)) {
      if (!ent || typeof ent !== "object") continue;
      if ("stashedNpc" in ent) delete ent.stashedNpc;
      if ("stashedNpcId" in ent) delete ent.stashedNpcId;
      if ("npcId" in ent) delete ent.npcId;
      if (ent.sheet && typeof ent.sheet === "object") {
        if ("stashedNpc" in ent.sheet) delete ent.sheet.stashedNpc;
        if ("stashedNpcId" in ent.sheet) delete ent.sheet.stashedNpcId;
      }
    }
  } catch (_) {}
  // Leaving: write carried age/psych/memory back into the single persistent NPC
  // record for the old person and clear its flag. Living World: npc.mind stays
  // on the registry record untouched (never overwritten from persona) so inner
  // life resumes seamlessly; persona conditions/experiences travel in the sheet.
  let oldNpcKey = null;
  try {
    if (oldName) oldNpcKey = Object.keys(sim.npcs).find((k) => !isReservedKey(k) && hasOwn(sim.npcs, k) && sim.npcs[k] && normName(sim.npcs[k].name) === normName(oldName)) || null;
  } catch (_) { oldNpcKey = null; }
  if (!oldNpcKey && !isReservedKey("npc_" + oldId) && hasOwn(sim.npcs, "npc_" + oldId)) oldNpcKey = "npc_" + oldId;
  if (oldNpcKey && !isReservedKey(oldNpcKey) && hasOwn(sim.npcs, oldNpcKey)) {
    try {
      const rec = sim.npcs[oldNpcKey];
      rec.age = currentAge(sim);
      if (sim.persona.traits && typeof sim.persona.traits === "object") rec.core_traits = deepClone(sim.persona.traits);
      if (sim.persona.states && typeof sim.persona.states === "object") rec.states = deepClone(sim.persona.states);
      if (sim.persona.romance && typeof sim.persona.romance === "object" && shouldIncludeRomance(rec)) rec.romance = deepClone(sim.persona.romance);
      else if (rec.romance && !shouldIncludeRomance(rec)) delete rec.romance;
      if (Array.isArray(sim.memories && sim.memories.shortTerm)) {
        const add = sim.memories.shortTerm.slice(-3).map((m) => memText(m).slice(0, 300));
        rec.memory = [...(rec.memory || []), ...add].slice(-20);
      }
      rec.inactive = false; rec.exitNote = ""; rec.exitDay = null;
      migrateNpc(rec);
      rec.controlled = false;
    } catch (_) {}
  } else if (oldName) {
    // First time leaving a person with no NPC record (original player / stranger):
    // gain a persistent npc_<id> record (unflagged while uncontrolled).
    try {
      const curAge = currentAge(sim);
      const carried = {
        id: "npc_" + oldId, name: oldName, role: (sim.persona && sim.persona.occupation) || "পরিচিত",
        age: curAge, trust: 60, familiarity: 80, emotion: "নিরপেক্ষ",
        background: (sim.persona && sim.persona.background) || "", personality: (sim.persona && sim.persona.personality) || "",
        publicPersona: "", privateReality: "", secrets: "", goals: "নিজের জীবন চালিয়ে যাওয়া।",
        memory: Array.isArray(sim.memories && sim.memories.shortTerm) ? sim.memories.shortTerm.slice(-3).map((m) => memText(m).slice(0, 300)) : [],
        inactive: false, exitNote: "", exitDay: null, controlled: false,
      };
      if (sim.persona.traits && !Array.isArray(sim.persona.traits) && typeof sim.persona.traits === "object") carried.core_traits = deepClone(sim.persona.traits);
      if (sim.persona.states && typeof sim.persona.states === "object") carried.states = deepClone(sim.persona.states);
      else carried.states = baseStates();
      if (sim.persona.romance && typeof sim.persona.romance === "object" && shouldIncludeRomance({ age: curAge, role: carried.role })) carried.romance = deepClone(sim.persona.romance);
      migrateNpc(carried);
      carried.controlled = false;
      sim.npcs[carried.id] = carried;
      oldNpcKey = carried.id;
    } catch (_) {}
  }
  // Ensure no stale flag survives the handoff (at most one controlled below).
  try { for (const n of Object.values(sim.npcs)) if (n && typeof n === "object" && n.controlled) n.controlled = false; } catch (_) {}
  // Find target: previously-controlled sheet or live NPC via prioritized tiers.
  const _found = resolveSwapTarget(sim, q, oldId);
  const cid = (_found && _found.kind === "sheet") ? _found.key : null;
  const npcKey = (_found && _found.kind === "npc") ? _found.key : null;
  // Co-located check BEFORE sheet restore deletes sim.characters[cid] (pre-swap present intact here).
  let wasTargetPresent = false;
  try {
    let _tid = null;
    if (_found && _found.kind === "npc") _tid = _found.key;
    else if (_found && _found.kind === "sheet") {
      try {
        const _ent = (!isReservedKey(_found.key) && hasOwn(sim.characters || {}, _found.key)) ? sim.characters[_found.key] : undefined;
        const _sh = _ent && _ent.sheet ? _ent.sheet : _ent;
        const _nm = _sh && _sh.persona ? _sh.persona.name : "";
        if (_nm) {
          const _hit = Object.entries(sim.npcs || {}).find(([k, n]) => !isReservedKey(k) && n && normName(n.name) === normName(_nm));
          if (_hit) _tid = _hit[0];
          if (!_tid && !isReservedKey("npc_" + _found.key) && hasOwn(sim.npcs || {}, "npc_" + _found.key)) _tid = "npc_" + _found.key;
        }
      } catch (_) {}
    }
    if (_tid && Array.isArray(sim.world.present) && sim.world.present.includes(_tid)) wasTargetPresent = true;
  } catch (_) {}
  if (cid) {
    // Swap into a previously-controlled character: restore their personal sheet.
    const entry = (!isReservedKey(cid) && hasOwn(sim.characters || {}, cid)) ? sim.characters[cid] : undefined;
    const sheet = entry && entry.sheet ? entry.sheet : entry;
    sim.controlledId = cid;
    restoreSheet(sim, deepClone(sheet));
    try { delete sim.characters[cid]; } catch (_) {}
    // Flag the persistent NPC record for the resumed person (exactly one).
    try { for (const n of Object.values(sim.npcs)) if (n && typeof n === "object") n.controlled = false; } catch (_) {}
    let rk = null;
    try {
      const resumedName = sim.persona.name;
      rk = Object.keys(sim.npcs).find((k) => !isReservedKey(k) && hasOwn(sim.npcs, k) && sim.npcs[k] && normName(sim.npcs[k].name) === normName(resumedName)) || null;
      if (!rk && !isReservedKey("npc_" + cid) && hasOwn(sim.npcs, "npc_" + cid)) rk = "npc_" + cid;
    } catch (_) {}
    if (rk && !isReservedKey(rk) && hasOwn(sim.npcs, rk)) {
      sim.npcs[rk].inactive = false; sim.npcs[rk].exitNote = ""; sim.npcs[rk].exitDay = null;
      try { migrateNpc(sim.npcs[rk]); } catch (_) {}
      sim.npcs[rk].controlled = true;
    }
    // C4: entering a known person adopts the stable link (migrateSim keeps the
    // flag consistent from here; null when no registry record exists).
    try { sim.controlledNpcId = (rk && !isReservedKey(rk) && hasOwn(sim.npcs, rk)) ? rk : null; } catch (_) { try { sim.controlledNpcId = null; } catch (_) {} }
    sim.name = sim.persona.name + " — দৃষ্টি বদল";
  } else if (npcKey) {
    const npc = (!isReservedKey(npcKey) && hasOwn(sim.npcs || {}, npcKey)) ? sim.npcs[npcKey] : null;
    if (!npc) return { ok: false, reason: "gone", message: "ওই চরিত্রটাকে এখন খুঁজে পাওয়া যাচ্ছে না।" };
    sim.controlledId = "c_" + npcKey;
    const npcAge = (typeof npc.age === "number" && Number.isFinite(npc.age)) ? Math.round(npc.age) : 30;
    const traits = npc.core_traits ? deepClone(npc.core_traits) : profileFor({ id: "tmp_" + npcKey, name: npc.name, role: npc.role, background: npc.background, personality: npc.personality });
    const states = npc.states ? deepClone(npc.states) : baseStates();
    let romance;
    if (shouldIncludeRomance(npc) && npc.romance) romance = deepClone(npc.romance);
    else if (shouldIncludeRomance({ age: npcAge, role: npc.role })) romance = { openness: 40, attractions: "", boundaries: "অসম্মতিতে না।" };
    sim.persona = { name: npc.name, age: npcAge, gender: "", occupation: npc.role || "", socialClass: "", personality: npc.personality || "", background: npc.background || "", traits, states, romance, traitLabels: [], conditions: [], experiences: [], baseAge: npcAge, baseDay: Math.max(1, Math.round(sim.world.dayCount || 1)) };
    const recalled = Array.isArray(npc.memory) ? npc.memory.slice(-3) : [];
    sim.stats = { health: 70, mood: 55, satiety: 60, energy: 70 };
    sim.finances = { cash: 500, bank: 0, bills: [] };
    sim.inventory = [];
    sim.memories = { core: [npc.background || "অতীত ঝাপসা।"], shortTerm: recalled.map((m) => ({ day: sim.world.date, text: "মনে আছে: " + memText(m).slice(0, 280) })), longTerm: [] };
    sim.income = null;
    sim.chronicle = [];
    // Flag the entered NPC record; never delete it.
    try { for (const n of Object.values(sim.npcs)) if (n && typeof n === "object") n.controlled = false; } catch (_) {}
    npc.inactive = false; npc.exitNote = ""; npc.exitDay = null;
    try { migrateNpc(npc); } catch (_) {}
    npc.controlled = true;
    // C4: entering a known NPC adopts the stable link.
    try { sim.controlledNpcId = (!isReservedKey(npcKey) && hasOwn(sim.npcs, npcKey)) ? npcKey : null; } catch (_) { try { sim.controlledNpcId = null; } catch (_) {} }
    sim.name = sim.persona.name + " — দৃষ্টি বদল";
  } else {
    // Brand-new stranger: documented deterministic defaults (no undefined traits).
    const nid = uid("c_");
    sim.controlledId = nid;
    sim.controlledNpcId = null; // brand-new stranger: no registry record yet
    const prof = profileFor({ id: nid, name: q.slice(0, 40), role: "অজানা", background: "", personality: "" });
    sim.persona = { name: q.slice(0, 40), age: 28, gender: "", occupation: "অজানা", socialClass: "", personality: "", background: "নতুন চরিত্র — গল্প এখনো লেখা হয়নি।", traits: prof, states: baseStates(), romance: { openness: 40, attractions: "", boundaries: "অসম্মতিতে না।" }, traitLabels: [], conditions: [], experiences: [], baseAge: 28, baseDay: Math.max(1, Math.round(sim.world.dayCount || 1)) };
    sim.stats = { health: 70, mood: 55, satiety: 60, energy: 70 };
    sim.finances = { cash: 500, bank: 0, bills: [] };
    sim.inventory = [];
    sim.memories = { core: [], shortTerm: [], longTerm: [] };
    sim.income = null;
    sim.chronicle = [];
    try { for (const n of Object.values(sim.npcs)) if (n && typeof n === "object") n.controlled = false; } catch (_) {}
    sim.name = q + " — দৃষ্টি বদল";
  }
  // BUG6: co-located swap keeps room; off-screen swap resets (no teleport).
  // wasTargetPresent was computed BEFORE the sheet/npc mutation above.
  try {
    if (sim.world && typeof sim.world === "object") sim.world.phoneCall = null;
  } catch (_) {}
  try {
    if (!sim.world || typeof sim.world !== "object") sim.world = { present: [] };
    if (!Array.isArray(sim.world.present)) sim.world.present = [];
    if (wasTargetPresent) {
      try {
        const curN = normName(sim.persona?.name || "");
        if (curN) {
          for (const [k, n] of Object.entries(sim.npcs || {})) {
            if (n && normName(n.name) === curN) {
              sim.world.present = sim.world.present.filter((id) => id !== k && id !== n.id);
            }
          }
        }
      } catch (_) {}
      if (oldNpcKey && sim.npcs[oldNpcKey] && !sim.npcs[oldNpcKey].controlled && !sim.npcs[oldNpcKey].inactive) {
        if (!sim.world.present.includes(oldNpcKey)) sim.world.present.push(oldNpcKey);
      }
    } else {
      sim.world.present = [];
    }
  } catch (_) {}
  // Issue #07: model-facing history boundary — pre-swap POV never leaks to the new eyes.
  // On-screen log stays visible; only the model-facing prompt respects fog of war.
  try {
    if (typeof sim.historyCutoff !== "number" || isNaN(sim.historyCutoff)) sim.historyCutoff = 0;
    if (Array.isArray(sim.log)) sim.historyCutoff = sim.log.length;
  } catch (_) {}
  try {
    if (typeof wasTargetPresent !== "boolean") wasTargetPresent = false;
  } catch (_) {}
  return { ok: true, wasTargetPresent };
}


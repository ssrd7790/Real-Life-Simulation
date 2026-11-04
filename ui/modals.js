// Wizard / menus / edit / custom-character flows (Gate 6).
// Split from src/app.js: bodies moved verbatim; bare state refs now read the
// shared session. Owns openModal/closeModal (trivial, spec'd here) and
// renderSimList (menu list); renderAll (ui/hud.js) fans out to it.
import { session, persist, store } from "../state/store.js";
import { simFromPreset, switchSim } from "../state/sim.js";
import { setBusy } from "../commands/turn.js";
import { renderAll } from "./hud.js";
import { pushLog, formatNarrative } from "./log.js";
import { $, escH, bnDigits, uid, clamp } from "./dom.js";
import { currentAge, normName, hasOwn, isReservedKey, callRealityEngine, splitNarrativeAndPatch, applyPatch, headerString } from "../engine.js";
import { PRESETS, CITIES } from "../presets.js";
import { migrateSim, defaultLocationFacts } from "../personality.js";

export function openModal(id) { $(id).hidden = false; }
export function closeModal(id) { $(id).hidden = true; }
export function renderPresetCards(filterCity = "all") {
  const el = $("presetCards");
  el.innerHTML = "";
  for (const p of PRESETS) {
    if (filterCity !== "all" && (p.city || "kolkata") !== filterCity) continue;
    const d = document.createElement("div");
    d.className = "preset-card";
    d.innerHTML = `<b>${escH(p.title)}</b><div class="muted">${escH(p.desc)}</div><div class="muted">📍 ${escH(CITIES[p.city].bn)}</div>`;
    d.onclick = () => startFromPreset(p.id);
    el.appendChild(d);
  }
}
export async function startFromPreset(pid, custom) {
  const preset = PRESETS.find((p) => p.id === pid);
  const s = simFromPreset(preset, custom);
  closeModal("wizardModal"); closeModal("menuModal");
  session.sims.unshift({ id: s.id, name: s.name, updatedAt: s.updatedAt, sim: s });
  session.activeId = s.id; session.sim = s;
  store.set("jibon_active", s.id);
  await persist(); renderAll();
  setBusy(true, "নতুন জীবন শুরু হচ্ছে…");
  try {
    const _hasPresent = Array.isArray(s.world?.present) && s.world.present.length > 0;
    const _openPrompt = _hasPresent
      ? `(নতুন জীবন শুরু) ${preset.opening} এই দৃশ্য দিয়ে গল্প শুরু করো — সংবেদনশীল বর্ণনা, একজন NPC-এর সংলাপ সহ।`
      : `(নতুন জীবন শুরু) ${preset.opening} এই দৃশ্য দিয়ে গল্প শুরু করো — একাকী সংবেদনশীল বর্ণনা, ঘরে কেউ নেই, কোনো অতিথি এনো না।`;
    const raw = await callRealityEngine(session.sim, _openPrompt, null, null);
    const { narrative, patch } = splitNarrativeAndPatch(raw);
    applyPatch(session.sim, { ...patch, time_advance_minutes: 5 });
    pushLog("world", narrative, formatNarrative(narrative), headerString(session.sim));
  } catch (e) {
    pushLog("world", preset.opening, formatNarrative(preset.opening), headerString(session.sim));
  } finally { setBusy(false); }
  renderAll(); await persist();
  $("actionInput").focus();
}
export function renderSimList() {
  const el = $("simList");
  el.innerHTML = session.sims.length ? session.sims.map((s) =>
    `<div class="sim-row${s.id === session.activeId ? " active" : ""}" data-id="${s.id}"><div><b>${escH(s.name)}</b><div class="muted">${bnDigits(new Date(s.updatedAt).toLocaleDateString("bn-IN"))}</div></div><span class="dot"></span></div>`).join("")
    : `<div class="muted">কোনো সেভ নেই — নতুন জীবন শুরু করো।</div>`;
  el.querySelectorAll(".sim-row").forEach((r) => r.onclick = () => switchSim(r.dataset.id));
}
export function openEdit() {
  if (!session.sim) return;
  // Issue #06: edit modal shows the live computed age (re-anchoring preserved on save).
  $("eName").value = session.sim.persona.name; $("eAge").value = currentAge(session.sim);
  $("eOcc").value = session.sim.persona.occupation; $("eLoc").value = session.sim.world.location;
  $("eHealth").value = session.sim.stats.health; $("eMood").value = session.sim.stats.mood;
  $("eSat").value = session.sim.stats.satiety; $("eEnergy").value = session.sim.stats.energy;
  $("eCash").value = session.sim.finances.cash; $("eBank").value = session.sim.finances.bank;
  $("ePers").value = session.sim.persona.personality; $("eBg").value = session.sim.persona.background;
  openModal("editModal");
}
export function applyLocationEdit(sim, newLocation) {
  const nl = String(newLocation ?? "").trim();
  if (!sim || !sim.world || !nl || nl === sim.world.location) return false;
  sim.world.location = nl;
  try { sim.world.locationFacts = defaultLocationFacts(nl, sim.persona?.socialClass); } catch (_) {}
  if (!Array.isArray(sim.world.present)) sim.world.present = [];
  else sim.world.present = [];
  return true;
}
export async function saveEdit() {
  // v2 (bug 4): blank inputs fell back to 0 (+""===0). Fall back to current values like age does.
  const numOrKeep = (v, keep) => { const s2 = String(v ?? "").trim(); if (s2 === "") return keep; const n = Number(s2); return isNaN(n) ? keep : n; };
  const _oldPName = session.sim.persona.name;
  session.sim.persona.name = $("eName").value.trim() || session.sim.persona.name;
  session.sim.persona.age = Math.max(18, parseInt($("eAge").value) || currentAge(session.sim));
  session.sim.persona.baseAge = session.sim.persona.age; session.sim.persona.baseDay = Math.max(1, Math.round(session.sim.world.dayCount || 1));
  session.sim.persona.occupation = $("eOcc").value.trim();
  try { applyLocationEdit(session.sim, $("eLoc").value); } catch (_) { session.sim.world.location = $("eLoc").value.trim() || session.sim.world.location; }
  session.sim.stats.health = clamp(numOrKeep($("eHealth").value, session.sim.stats.health)); session.sim.stats.mood = clamp(numOrKeep($("eMood").value, session.sim.stats.mood));
  session.sim.stats.satiety = clamp(numOrKeep($("eSat").value, session.sim.stats.satiety)); session.sim.stats.energy = clamp(numOrKeep($("eEnergy").value, session.sim.stats.energy));
  session.sim.finances.cash = Math.max(0, Math.round(numOrKeep($("eCash").value, session.sim.finances.cash)));
  session.sim.finances.bank = Math.max(0, Math.round(numOrKeep($("eBank").value, session.sim.finances.bank)));
  session.sim.persona.personality = $("ePers").value; session.sim.persona.background = $("eBg").value;
  // C4: persona rename follows the linked NPC record so the stable link survives.
  try {
    const _newPName = session.sim.persona.name;
    if (_oldPName && _newPName && _oldPName !== _newPName) {
      let _rk = null;
      try {
        const _lnk = typeof session.sim.controlledNpcId === "string" ? session.sim.controlledNpcId : null;
        if (_lnk && !isReservedKey(_lnk) && hasOwn(session.sim.npcs, _lnk)) _rk = _lnk;
      } catch (_) {}
      if (!_rk) {
        try { _rk = Object.keys(session.sim.npcs || {}).find((k) => !isReservedKey(k) && hasOwn(session.sim.npcs, k) && session.sim.npcs[k] && normName(session.sim.npcs[k].name) === normName(_oldPName)) || null; } catch (_) { _rk = null; }
      }
      if (_rk) { try { session.sim.npcs[_rk].name = _newPName; } catch (_) {} }
    }
  } catch (_) {}
  session.sim.name = `${session.sim.persona.name} — ${session.sim.name.split("—").slice(1).join("—").trim() || "চলমান জীবন"}`;
  closeModal("editModal"); renderAll(); await persist();
}
export function startCustom() {
  openModal("customModal");
}
export async function startCustomReal() {
  const cityId = $("cCity").value || "kolkata";
  const s = {
    id: uid("sim_"), name: "", presetId: "custom", city: cityId,
    createdAt: Date.now(), updatedAt: Date.now(), controlledId: "player0", characters: {},
    persona: {
      name: $("cName").value.trim() || "নতুন চরিত্র",
      age: Math.max(18, parseInt($("cAge").value) || 25), gender: $("cGender").value,
      occupation: $("cOcc").value.trim() || "অজানা পেশা",
      socialClass: $("cClass").value,
      personality: $("cPers").value.trim() || "সাধারণ মানুষ, নিজের মতো করে বাঁচে।",
      background: $("cBg").value.trim() || "অতীত সাধারণ।", traitLabels: [],
      // v2 (bug 2 + R3): display labels live in traitLabels; numeric profile is
      // backfilled by migrateSim; baseAge/baseDay anchor JS-computed aging.
      baseAge: Math.max(18, parseInt($("cAge").value) || 25), baseDay: 1,
      conditions: [], experiences: [],
    },
    world: { date: "15/08", dayCount: 1, timeMin: 8 * 60, location: CITIES[cityId].bn + " — ভাড়া বাসা", pulse: "", locationFacts: defaultLocationFacts(CITIES[cityId].bn + " — ভাড়া বাসা", $("cClass").value), present: [] },
    stats: { health: 70, mood: 55, satiety: 60, energy: 70 },
    finances: { cash: 1000, bank: 0, bills: [] },
    inventory: [], relationships: {}, npcs: {},
    memories: { core: [], shortTerm: [], longTerm: [] },
    chronicle: [], income: null, // v2 (R1/R5)
    storylines: [], log: [],
    historyCutoff: 0,
    critical: { active: false, sinceDay: null },
    opening: "সকাল আটটা। নতুন দিন, নতুন জীবন। ঘরের বাইরে শহরের শব্দ।",
  };
  s.name = `${s.persona.name} — কাস্টম জীবন`;
  s.memories.shortTerm.push({ day: "15/08", text: s.opening });
  try { const { migrateSim: m2 } = await import("../personality.js"); m2(s); } catch (_) {} // v2: backfill numeric traits
  closeModal("customModal"); closeModal("wizardModal"); closeModal("menuModal");
  session.sims.unshift({ id: s.id, name: s.name, updatedAt: s.updatedAt, sim: s });
  session.activeId = s.id; session.sim = s;
  store.set("jibon_active", s.id);
  await persist(); renderAll();
  setBusy(true, "নতুন জীবন শুরু হচ্ছে…");
  try {
    const raw = await callRealityEngine(session.sim, `(নতুন জীবন শুরু) ${s.persona.name}, ${s.persona.occupation}, ${s.world.location}। এই দৃশ্য দিয়ে গল্প শুরু করো — সংবেদনশীল বর্ণনা সহ।`, null, null);
    const { narrative, patch } = splitNarrativeAndPatch(raw);
    const { applyPatch: ap } = await import("../engine.js");
    ap(session.sim, { ...patch, time_advance_minutes: 5 });
    pushLog("world", narrative, formatNarrative(narrative), headerString(session.sim));
  } catch (e) { pushLog("world", s.opening, formatNarrative(s.opening), headerString(session.sim)); }
  finally { setBusy(false); }
  renderAll(); await persist();
}

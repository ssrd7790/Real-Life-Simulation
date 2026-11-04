// Sim lifecycle: factory, switching, deletion, export/import (Gate 6).
// Split from src/app.js: bodies moved verbatim; bare state refs now read the
// shared session. startFromPreset/startCustomReal live in ui/modals.js (they
// are wizard flows); this file owns the sim objects themselves.
import { session, persist, store, kvSims } from "./store.js";
import { $, uid, deepClone } from "../ui/dom.js";
import { migrateSim, defaultLocationFacts } from "../personality.js";
import { hygienePass, headerString, isReservedKey } from "../engine.js";
import { formatNarrative } from "../ui/log.js";
import { renderAll } from "../ui/hud.js";
import { closeModal } from "../ui/modals.js";

export function simFromPreset(preset, custom) {
  const p = custom || preset.persona;
  const id = uid("sim_");
  const npcs = {}, rels = {};
  // Issue #04: deep-clone every preset-derived structure (seed NPC nested
  // core_traits/states/romance included) so play never mutates PRESETS.
  for (const n of preset.seedNpcs || []) {
    npcs[n.id] = { ...deepClone(n), memory: [] };
    if (!Array.isArray(npcs[n.id].memory)) npcs[n.id].memory = [];
    rels["r_" + n.id] = { id: "r_" + n.id, name: n.name, type: n.role, trust: n.trust, familiarity: n.familiarity, emotion: n.emotion, lastChange: "শুরুর পরিচয়", lastDay: 1 };
  }
  // v2 (bug 1): code after `return` was unreachable (`migrateSim(s)` never ran).
  // Build into a variable, migrate, then return. Also seeds v2 fields.
  const s = {
    id, name: `${p.name} — ${preset.title}`,
    presetId: preset.id, city: preset.city || "kolkata",
    createdAt: Date.now(), updatedAt: Date.now(),
    controlledId: "player0",
    characters: {},
    persona: { ...deepClone(p), baseAge: Math.max(18, Math.round(p.age) || 25), baseDay: 1, conditions: [], experiences: [] },
    world: { date: preset.date || "15/08", dayCount: 1, timeMin: preset.timeMin ?? 540, location: preset.location, pulse: "", locationFacts: (preset.locationFacts || defaultLocationFacts(preset.location, preset.persona?.socialClass)), present: Array.isArray(preset.present) ? [...preset.present] : [] },
    stats: { ...deepClone(preset.stats) },
    finances: { cash: preset.finances.cash, bank: preset.finances.bank, bills: (preset.finances.bills || []).map((b) => ({ ...deepClone(b), paidDay: b.paid ? 1 : null })) },
    inventory: (preset.inventory || []).map((i) => ({ ...deepClone(i) })),
    relationships: rels, npcs,
    memories: { core: [...deepClone(preset.coreMemories || [])], shortTerm: [{ day: preset.date || "15/08", text: preset.opening }], longTerm: [] },
    chronicle: [], income: null,
    storylines: [],
    log: [],
    historyCutoff: 0,
    critical: { active: false, sinceDay: null },
    opening: preset.opening,
  };
  migrateSim(s); // v2: persona.traits numeric profile + npc psych fields on fresh sims too
  return s;
}
export async function switchSim(id) {
  if (session.busy) return;
  session.activeId = id; store.set("jibon_active", id);
  session.sim = session.sims.find((s) => s.id === id)?.sim || null;
  closeModal("menuModal"); renderAll(); await persist();
}
export async function deleteActive() {
  if (!session.sim) return;
  const btn = $("deleteBtn");
  if (btn.dataset.arm !== "1") { btn.dataset.arm = "1"; btn.textContent = "নিশ্চিত? আবার চাপ দাও"; setTimeout(() => { btn.dataset.arm = ""; btn.textContent = "🗑️ মুছো"; }, 3000); return; }
  try { await kvSims().delete(session.sim.id); } catch (_) {}
  session.sims = session.sims.filter((s) => s.id !== session.sim.id);
  session.sim = session.sims[0]?.sim || null; session.activeId = session.sim?.id || null;
  store.set("jibon_active", session.activeId || "");
  btn.dataset.arm = ""; btn.textContent = "🗑️ মুছো";
  closeModal("menuModal"); renderAll();
}
export function exportSave() {
  if (!session.sim) return;
  const blob = new Blob([JSON.stringify(session.sim, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `jibon-${session.sim.id}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// M14: imported files are untrusted — coerce every player/model-facing string,
// normalize memory shapes ({day,text} shortTerm, string core, {text} longTerm),
// drop reserved map keys, finite-check numbers. migrateSim/hygienePass run after.
export function sanitizeImportedSim(o) {
  if (!o || typeof o !== "object") return;
  try {
    const str = (v, max) => String(v ?? "").slice(0, max);
    const fin = (v, dflt) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
    o.name = str(o.name, 120) || "আমদানি করা জীবন";
    if (typeof o.controlledId !== "string") o.controlledId = "player0";
    else o.controlledId = o.controlledId.slice(0, 80);
    if (typeof o.controlledNpcId !== "string") o.controlledNpcId = null;
    const p = (o.persona && typeof o.persona === "object") ? o.persona : (o.persona = {});
    for (const k of ["name", "gender", "occupation", "socialClass"]) p[k] = str(p[k], 120);
    for (const k of ["personality", "background"]) p[k] = str(p[k], 2000);
    if (Array.isArray(p.traitLabels)) p.traitLabels = p.traitLabels.map((x) => str(x, 60)).slice(0, 40);
    for (const k of ["conditions", "experiences"]) if (Array.isArray(p[k])) p[k] = p[k].map((x) => str(x && x.text !== undefined ? x.text : x, 120)).slice(0, 30);
    const st = (o.stats && typeof o.stats === "object") ? o.stats : (o.stats = {});
    for (const k of ["health", "mood", "satiety", "energy"]) st[k] = Math.max(0, Math.min(100, Math.round(fin(st[k], 60))));
    const f = (o.finances && typeof o.finances === "object") ? o.finances : (o.finances = {});
    f.cash = Math.max(0, Math.round(fin(f.cash, 0))); f.bank = Math.max(0, Math.round(fin(f.bank, 0)));
    if (Array.isArray(f.bills)) f.bills = f.bills.slice(0, 60).map((b) => {
      if (!b || typeof b !== "object") return null;
      return { id: str(b.id, 40), name: str(b.name, 120), amount: Math.max(0, Math.round(fin(b.amount, 0))), due: str(b.due, 120), paid: b.paid === true, paidDay: (typeof b.paidDay === "number" && Number.isFinite(b.paidDay)) ? Math.round(b.paidDay) : null };
    }).filter(Boolean);
    else f.bills = [];
    if (Array.isArray(o.inventory)) o.inventory = o.inventory.slice(0, 120).map((it) => {
      if (!it || typeof it !== "object") return null;
      return { name: str(it.name, 120), qty: Math.max(1, Math.round(fin(it.qty, 1))) };
    }).filter(Boolean);
    else o.inventory = [];
    for (const mapKey of ["relationships", "npcs"]) {
      const mp = o[mapKey];
      if (!mp || typeof mp !== "object") { o[mapKey] = {}; continue; }
      for (const k of Object.keys(mp)) {
        if (isReservedKey(k)) { try { delete mp[k]; } catch (_) {} continue; }
        const v = mp[k];
        if (!v || typeof v !== "object") { try { delete mp[k]; } catch (_) {} continue; }
        if (typeof v.name === "string") v.name = v.name.slice(0, 120);
        if (typeof v.type === "string") v.type = v.type.slice(0, 80);
        if (typeof v.emotion === "string") v.emotion = v.emotion.slice(0, 60);
        if (typeof v.role === "string") v.role = v.role.slice(0, 80);
        for (const nk of ["trust", "familiarity", "age"]) if (nk in v && (typeof v[nk] !== "number" || !Number.isFinite(v[nk]))) delete v[nk];
        if (typeof v.background === "string") v.background = v.background.slice(0, 2000);
      }
    }
    const mm = (o.memories && typeof o.memories === "object") ? o.memories : (o.memories = {});
    if (Array.isArray(mm.shortTerm)) mm.shortTerm = mm.shortTerm.slice(-60).map((m) => {
      if (m == null) return null;
      if (typeof m === "string") return { day: str(o.world && o.world.date, 20), text: m.slice(0, 1500) };
      if (typeof m !== "object") return null;
      return { day: str(m.day ?? (o.world && o.world.date), 20), text: str(m.text, 1500) };
    }).filter(Boolean);
    else mm.shortTerm = [];
    if (Array.isArray(mm.core)) mm.core = mm.core.map((x) => (typeof x === "string" ? x : (x && typeof x.text === "string" ? x.text : ""))).filter((s) => s && s.trim()).map((s) => s.slice(0, 1500)).slice(-60);
    else mm.core = [];
    if (!Array.isArray(mm.longTerm)) mm.longTerm = [];
    if (Array.isArray(o.storylines)) o.storylines = o.storylines.slice(-60).map((s) => {
      if (typeof s === "string") return s.slice(0, 600);
      if (!s || typeof s !== "object") return null;
      return { id: str(s.id, 40), title: str(s.title, 200), status: str(s.status, 40) };
    }).filter((x) => x !== null);
    else o.storylines = [];
    if (Array.isArray(o.chronicle)) o.chronicle = o.chronicle.filter((c) => typeof c === "string").map((c) => c.slice(0, 600)).slice(-300);
    else o.chronicle = [];
    const w = (o.world && typeof o.world === "object") ? o.world : (o.world = {});
    for (const k of ["date", "location", "pulse"]) if (k in w) w[k] = str(w[k], k === "location" ? 200 : 300);
    if ("dayCount" in w) w.dayCount = Math.max(1, Math.round(fin(w.dayCount, 1)));
    if ("timeMin" in w) w.timeMin = Math.max(0, Math.min(1439, Math.round(fin(w.timeMin, 480))));
    if (Array.isArray(w.present)) w.present = w.present.filter((x) => typeof x === "string" && !isReservedKey(x)).slice(0, 40);
  } catch (_) {}
}
export function importSave(file) {
  const r = new FileReader();
  r.onload = async () => {
    try {
      const obj = JSON.parse(r.result);
      if (!obj.id || !obj.persona) throw new Error("bad file");
      obj.id = uid("sim_"); obj.updatedAt = Date.now();
      // v2 (bug 3): imported saves rendered log[].html raw (self-XSS via shared
      // files). Sanitize first, then migrate; rebuild html safely from text.
      try { sanitizeImportedSim(obj); } catch (_) {}
      try { migrateSim(obj); hygienePass(obj); } catch (_) {}
      if (Array.isArray(obj.log)) {
        for (const t of obj.log) {
          if (!t || typeof t !== "object") continue;
          t.text = String(t.text ?? "").slice(0, 8000);
          t.header = String(t.header ?? "").slice(0, 300);
          t.time = String(t.time ?? "").slice(0, 100);
          if (!t.controlledId) t.controlledId = obj.controlledId || "player0";
          if (t.role === "player") { t.html = ""; }
          else { try { t.html = formatNarrative(t.text); } catch (_) { t.html = ""; } }
        }
        if (obj.log.length > 200) {
          const drop = obj.log.length - 200;
          obj.log = obj.log.slice(-200);
          if (typeof obj.historyCutoff === "number") obj.historyCutoff = Math.max(0, obj.historyCutoff - drop);
        }
      }
      // Legacy character sheets migrate safely (already in migrateSim).
      session.sims.unshift({ id: obj.id, name: obj.name || "আমদানি করা জীবন", updatedAt: obj.updatedAt, sim: obj });
      session.activeId = obj.id; session.sim = obj;
      store.set("jibon_active", obj.id);
      closeModal("menuModal"); renderAll(); await persist();
    } catch (_) { alert("ফাইলটা পড়া গেল না।"); }
  };
  r.readAsText(file);
}

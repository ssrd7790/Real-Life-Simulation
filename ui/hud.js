// Status bar + HUD + composite render + system messages (Gate 6).
// Split from src/app.js: bodies moved verbatim; bare state refs now read the
// shared session. renderAll fans out to renderSimList (ui/modals.js) — that
// cycle is call-time only and safe.
import { session, persist } from "../state/store.js";
import { $, escH, bnDigits, clamp, memText } from "./dom.js";
import { fmtTime, currentAge, headerString } from "../engine.js";
import { CITIES } from "../presets.js";
import { renderSimList } from "./modals.js";
import { renderLog, pushLog, formatNarrative } from "./log.js";

export function renderAll() {
  renderStatus(); renderHUD(); renderLog(); renderSimList();
  const has = !!session.sim;
  $("emptyCtn").hidden = has;
  $("stageWrap").hidden = !has;
  $("hudToggle").hidden = !has;
  if (session.sim) {
    $("simNameEl").textContent = session.sim.name;
    $("charNameEl").textContent = `${session.sim.persona.name} · ${session.sim.persona.occupation || ""}`;
  }
}
export function renderStatus() {
  if (!session.sim) { $("statusBar").innerHTML = `<span class="st">📅 --/-- &nbsp;|&nbsp; ⏰ --:-- &nbsp;|&nbsp; 📍 —</span>`; return; }
  $("statusBar").innerHTML =
    `<span class="st">📅 ${escH(bnDigits(session.sim.world.date))}</span><span class="sep">|</span>` +
    `<span class="st">⏰ ${escH(bnDigits(fmtTime(session.sim.world.timeMin)))}</span><span class="sep">|</span>` +
    `<span class="st loc">📍 ${escH(session.sim.world.location)}</span>`;
}
export function bar(label, val, cls) {
  const v = clamp(val);
  const emo = v >= 60 ? "🙂" : v >= 35 ? "😐" : "😟";
  return `<div class="stat"><div class="stat-top"><span>${label} ${v < 30 ? emo : ""}</span><span class="stat-v">${bnDigits(v)}</span></div>` +
    `<div class="bar"><div class="fill ${cls}" style="width:${v}%"></div></div></div>`;
}
export function renderHUD() {
  if (!session.sim) { $("hudBody").innerHTML = ""; return; }
  const cur = CITIES[session.sim.city]?.currency || "₹";
  const inv = session.sim.inventory.length ? session.sim.inventory.map((i) => `<div class="inv-row"><span>🎒 ${escH(i.name)}</span><span class="qty">×${bnDigits(i.qty)}</span></div>`).join("") : `<div class="muted">খালি</div>`;
  const unpaid = session.sim.finances.bills.filter((b) => !b.paid);
  const bills = unpaid.length ? unpaid.map((b) => `<div class="bill-row"><span>${escH(b.name)}</span><b>${bnDigits(b.amount)}${cur}</b></div><div class="bill-due">${escH(b.due || "")}</div>`).join("") : `<div class="muted">কোনো বাকি বিল নেই ✓</div>`;
  const rels = Object.values(session.sim.relationships);
  const relHtml = rels.length ? rels.slice(0, 12).map((r) =>
    `<div class="rel-row"><div class="rel-top"><b>${escH(r.name)}</b><span class="rel-type">${escH(r.type || "")}</span></div>` +
    `<div class="rel-sub">বিশ্বাস ${bnDigits(r.trust)} · চেনা ${bnDigits(r.familiarity)} · ${escH(r.emotion || "")}</div>` +
    (r.lastChange ? `<div class="rel-note">${escH(r.lastChange)}</div>` : "") + `</div>`).join("") : `<div class="muted">এখনো কেউ নেই</div>`;
  const mems = session.sim.memories.shortTerm.slice(-3).reverse().map((m) => `<div class="mem-row">💭 ${escH(memText(m).slice(0, 90))}</div>`).join("");
  // Living World: organic conditions/experiences (existing CSS classes only, no new DOM ids).
  const condArr = Array.isArray(session.sim.persona.conditions) ? session.sim.persona.conditions : [];
  const expArr = Array.isArray(session.sim.persona.experiences) ? session.sim.persona.experiences : [];
  const condHtml = condArr.length ? condArr.slice(0, 8).map((c) => `<div class="rel-note">🩺 ${escH(String(c).slice(0, 80))}</div>`).join("") : "";
  const expHtml = expArr.length ? expArr.slice(0, 12).map((e) => `<div class="rel-note">🌱 ${escH(String(e).slice(0, 100))}</div>`).join("") : "";
  // Issue #06: HUD shows JS-computed currentAge, never stale persona.age.
  const ageShown = currentAge(session.sim);
  $("hudBody").innerHTML = `
    <section class="hud-sec"><h3>🧍 চরিত্র</h3>
      <div class="char-big">${escH(session.sim.persona.name)}</div>
      <div class="muted">${escH(bnDigits(ageShown))} বছর · ${escH(session.sim.persona.gender)} · ${escH(session.sim.persona.socialClass)}</div>
      <div class="muted">${escH(session.sim.persona.occupation)}</div>${expHtml}</section>
    <section class="hud-sec"><h3>❤️ শরীর ও মন</h3>
      ${bar("স্বাস্থ্য", session.sim.stats.health, "h")}${bar("মন", session.sim.stats.mood, "m")}${bar("পেট ভরা", session.sim.stats.satiety, "s")}${bar("শক্তি", session.sim.stats.energy, "e")}${condHtml}</section>
    <section class="hud-sec"><h3>💰 টাকা</h3>
      <div class="money"><div><span class="muted">নগদ</span><b>${bnDigits(session.sim.finances.cash)}${cur}</b></div>
      <div><span class="muted">ব্যাংক</span><b>${bnDigits(session.sim.finances.bank)}${cur}</b></div></div>
      <h4>🧾 বিল / ধার</h4>${bills}</section>
    <section class="hud-sec"><h3>🎒 জিনিসপত্র</h3>${inv}</section>
    <section class="hud-sec"><h3>🤝 সম্পর্ক</h3>${relHtml}</section>
    <section class="hud-sec"><h3>🧠 সাম্প্রতিক স্মৃতি</h3>${mems || '<div class="muted">—</div>'}</section>`;
}
export function sysMsg(t) {
  pushLog("world", t, formatNarrative(t), headerString(session.sim));
  renderAll(); persist();
}

// /pay command + money-guard rail (Gate 6).
// Split from src/app.js: bodies moved verbatim; bare `sim` refs now read the
// shared session. Calls runTurn (commands/turn.js) — that cycle is call-time
// only and safe.
import { session, persist } from "../state/store.js";
import { sysMsg, renderAll } from "../ui/hud.js";
import { runTurn } from "./turn.js";
import { findBillForPayment, payBillByKey, SKIP_MAX_MIN } from "../engine.js";
import { CITIES } from "../presets.js";

// M19/C6 (pure, headless-testable): /pay money guards + requested-skip clamp.
// runTurn applies this to every model patch before applyPatch. Failure path
// (blockMoneyDeltas) blocks ALL deltas. Success path (paidInJs) neutralizes
// ONLY the exact duplicate of the JS-settled amount (per-balance or combined
// cash+bank split); an unrelated legitimate expense narrated in the same beat
// (tea) still applies. A model over-proposal can never advance more than
// min(requested, SKIP_MAX_MIN) via the threaded _skip_want.
export function neutralizePaidDeltas(patch, opts = {}, command = null) {
  if (!patch || typeof patch !== "object") return patch;
  if (opts.blockMoneyDeltas) { patch.cash_delta = 0; patch.bank_delta = 0; patch._block_money_deltas = true; }
  else if (opts.paidInJs) {
    const _settled = Math.max(0, Math.round(opts.paidAmount || 0));
    if (_settled > 0) {
      const _cd = (typeof patch.cash_delta === "number" && Number.isFinite(patch.cash_delta)) ? Math.round(patch.cash_delta) : 0;
      const _bd = (typeof patch.bank_delta === "number" && Number.isFinite(patch.bank_delta)) ? Math.round(patch.bank_delta) : 0;
      const _cu = Math.max(0, Math.round(opts.paidCashUsed || 0));
      const _bu = Math.max(0, Math.round(opts.paidBankUsed || 0));
      if (_cd < 0 && _cu > 0 && -_cd === _cu && _bu === 0) patch.cash_delta = 0;
      if (_bd < 0 && _bu > 0 && -_bd === _bu && _cu === 0) patch.bank_delta = 0;
      // Split settlement (cash part + bank remainder): neutralize the pair.
      if (_cd < 0 && _bd < 0 && _cu > 0 && _bu > 0 && -_cd === _cu && -_bd === _bu) { patch.cash_delta = 0; patch.bank_delta = 0; }
      // Whole-bill duplicate in one balance (JS split unknown to the model).
      else if (_cd < 0 && -_cd === _settled && _bd >= 0) patch.cash_delta = 0;
      else if (_bd < 0 && -_bd === _settled && _cd >= 0) patch.bank_delta = 0;
    }
    if (opts.isSkip && command && typeof command.minutes === "number" && Number.isFinite(command.minutes)) {
      patch._skip_want = Math.max(5, Math.min(SKIP_MAX_MIN, Math.round(command.minutes)));
    }
  } else if (opts.isSkip && command && typeof command.minutes === "number" && Number.isFinite(command.minutes)) {
    patch._skip_want = Math.max(5, Math.min(SKIP_MAX_MIN, Math.round(command.minutes)));
  }
  return patch;
}
export async function doPay(q) {
  // Issue #05 (D1): route through the shared atomic routine (cash first, then bank).
  const preview = findBillForPayment(session.sim, q);
  if (!preview) { sysMsg(`“${q}” নামে কোনো বাকি বিল পাওয়া গেল না। HUD-এ বিলের তালিকা দেখো।`); return; }
  const cur = CITIES[session.sim.city]?.currency || "₹";
  const res = payBillByKey(session.sim, q);
  if (!res.ok) {
    // M2: insufficient total keeps the engine-narrated failed-attempt path, but
    // the failure turn must not move money: blockMoneyDeltas zeroes any
    // model-sent cash/bank deltas so the failed payment deducts nothing.
    runTurn(`(কমান্ড /pay) আমি “${preview.name}” (${preview.amount}${cur}) পরিশোধ করতে গেলাম, কিন্তু হাতে যথেষ্ট টাকা নেই। দুনিয়া এই ব্যর্থ চেষ্টাটা বাস্তবভাবে দেখাক।`, { type: "pay", target: q }, { blockMoneyDeltas: true });
    renderAll(); await persist();
    return;
  }
  renderAll(); await persist();
  runTurn(`(কমান্ড /pay) আমি “${res.bill.name}” বাবদ ${res.bill.amount}${cur} পরিশোধ করলাম। দুনিয়া এই পরিশোধের মুহূর্তটা বাস্তবভাবে বর্ণনা করুক।`, { type: "pay", target: q }, { paidInJs: true, paidAmount: res.bill.amount, paidCashUsed: res.cashUsed, paidBankUsed: res.bankUsed });
}

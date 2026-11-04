// Gate 3 applier: BILLS — bills_add (dedupe exact unpaid duplicates) then
// bills_paid (atomic settlement, records ctx.totalPaid/settledAmounts for the
// M1 neutralize step in CASH). Splice: verbatim lines 1981-2006
// (totalPaid/settledAmounts -> ctx).
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { PATCH_MAX_BILLS_ADD, payBillByKey, normName, isFiniteNum } from "../../engine.js";
import { appendEvent, JOURNAL_OWN_KEYS } from "../../core/events.js";

export const BRANCHES = [
  "billsAdd:dup-skipped",
  "billsAdd:entry",
  "billsAdd:nonfinite",
  "billsPaid:entry",
  "billsPaid:settled",
];

export function validateBillsAdd(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.bills_add));
}

export function applyBillsAdd(sim, patch, ctx) {
  cov("billsAdd:entry");
  // Bills: adds (dedupe exact unpaid duplicates) then atomic settlement.
  if (Array.isArray(patch.bills_add)) {
    for (const b of patch.bills_add.slice(0, PATCH_MAX_BILLS_ADD)) {
      if (!b || !b.name) continue;
      // M9: non-finite amounts are rejected (Infinity silently became a windfall).
      if (typeof b.amount === "number" && !isFiniteNum(b.amount)) { console.warn("[rails] non-finite bills_add amount rejected:", String(b.name).slice(0, 40)); continue; }
      cov("billsAdd:nonfinite");
      const nm = String(b.name).slice(0, 100);
      const amt = Math.max(0, Math.round(b.amount || 0));
      const due = String(b.due || "").slice(0, 60);
      const dup = sim.finances.bills.find((x) => !x.paid && normName(x.name) === normName(nm) && Math.round(x.amount) === amt && String(x.due || "") === due);
      if (dup) { console.warn("[hygiene] duplicate unpaid bill skipped:", nm); continue; }
      cov("billsAdd:dup-skipped");
      sim.finances.bills.push({ id: "b" + Date.now() + Math.floor(Math.random() * 999), name: nm, amount: amt, due, paid: false, paidDay: null });
    }
  }
}

export function validateBillsPaid(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.bills_paid));
}

export function applyBillsPaid(sim, patch, ctx) {
  cov("billsPaid:entry");
  ctx.totalPaid = 0;
  ctx.settledAmounts = [];
  if (Array.isArray(patch.bills_paid)) {
    for (const key of patch.bills_paid) {
      const res = payBillByKey(sim, key);
      if (res.ok) {
        const _amt = Math.max(0, Math.round(res.bill.amount || 0));
        ctx.totalPaid += _amt;
        ctx.settledAmounts.push(_amt);
        try { appendEvent(sim, { kind: "money", actors: [], text: `পরিশোধ: ${String(res.bill.name || "বিল").slice(0, 60)} (${_amt})।`, weight: 3, narrated: false }); } catch (_) {}
        cov("billsPaid:settled");
      }
    }
  }
}

export const ENTRIES = [
  {
    id: "billsAdd",
    key: "bills_add",
    phase: PHASES.ECONOMY,
    order: 50,
    owns: ["finances"],
    notes: "Exact-duplicate unpaid bills_add skipped (never reduce/erase debt). Non-finite amounts rejected.",
    validate: validateBillsAdd,
    apply: applyBillsAdd,
  },
  {
    id: "billsPaid",
    key: "bills_paid",
    phase: PHASES.ECONOMY,
    order: 60,
    owns: ["finances", "memories", ...JOURNAL_OWN_KEYS],
    notes: "Atomic cash-first settlement via payBillByKey; records settled totals for M1. Insufficient-funds failure writes one idempotent shortTerm note.",
    validate: validateBillsPaid,
    apply: applyBillsPaid,
  },
];

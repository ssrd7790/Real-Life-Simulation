// Gate 3 applier: INCOME — recurring_income update + immediate auto-credit
// (survives model amnesia; job-switch never inherits lastPaidDay).
// The update block lives in reconcile/income.js; the credit moment stays here,
// exactly where the old code ran it (before stats/bills of the same beat).
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { normName, isFiniteNum } from "../../engine.js";
import { creditIncome } from "../../core/economy.js";
import { appendEvent, JOURNAL_OWN_KEYS } from "../../core/events.js";
import { applyRecurringIncomeUpdate, BRANCHES as INCOME_BRANCHES } from "../reconcile/income.js";

export const BRANCHES = [
  "income:credit-called",
];

export function validateIncome(sim, patch, ctx) {
  return true; // credit moment always runs, even without a recurring_income key
}

export function applyIncome(sim, patch, ctx) {
  applyRecurringIncomeUpdate(sim, patch, { normName, isFiniteNum });
  try {
    const got = creditIncome(sim);
    if (got > 0) appendEvent(sim, { kind: "money", actors: [], text: `আয় জমা: ${String((sim.income && sim.income.source) || "আয়").slice(0, 60)} থেকে কিস্তি এলো।`, weight: 4, narrated: false });
  } catch (_) { try { creditIncome(sim); } catch (_) {} }
  cov("income:credit-called");
}

export const ENTRIES = [
  {
    id: "income",
    key: "recurring_income",
    phase: PHASES.ECONOMY,
    order: 30,
    owns: ["income", "finances", "memories", ...JOURNAL_OWN_KEYS],
    notes: "Update-then-credit moment runs before stats/bills. Zero-amount income nulls the schedule. Catch-up credits in one bounded batch (never lost, never doubled).",
    validate: validateIncome,
    apply: applyIncome,
  },
];

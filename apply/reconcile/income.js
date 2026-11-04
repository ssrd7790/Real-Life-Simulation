// Gate 3 reconcile: recurring-income update block (extracted verbatim from
// applyPatch). Runs at its ordered ECONOMY moment, BEFORE the stats rails and
// bill settlement of the same beat; the auto-credit (creditRecurringIncome)
// fires immediately after the update, so model amnesia about paydays can
// never lose or double income.
import { cov } from "../coverage.js";

export const BRANCHES = [
  "income:cleared",
  "income:rejected-nonfinite",
  "income:skipped",
  "income:updated",
  "income:zero-amount-nulled",
];

export function applyRecurringIncomeUpdate(sim, patch, helpers) {
  const { normName, isFiniteNum } = helpers;
  if (patch.recurring_income && typeof patch.recurring_income === "object") {
    const ri = patch.recurring_income;
    if (ri.cleared === true) {
      sim.income = null;
      cov("income:cleared");
    } else if (typeof ri.source === "string" || typeof ri.amount === "number" || typeof ri.cadence_days === "number") {
      // M9: non-finite income fields are rejected with a warning, no state change.
      if ((typeof ri.amount === "number" && !isFiniteNum(ri.amount)) || (typeof ri.cadence_days === "number" && !isFiniteNum(ri.cadence_days))) {
        console.warn("[rails] non-finite recurring_income rejected.");
        cov("income:rejected-nonfinite");
      } else {
      const _dayNow = Math.max(1, Math.round(sim.world.dayCount || 1));
      const _prevSource = (sim.income && typeof sim.income.source === "string") ? normName(sim.income.source) : null;
      const _prevLast = (sim.income && isFiniteNum(sim.income.lastPaidDay)) ? Math.round(sim.income.lastPaidDay) : _dayNow;
      const _newSourceRaw = String(ri.source || (sim.income?.source) || "কাজ").slice(0, 80);
      const _newSourceN = normName(_newSourceRaw);
      // Job-switch: a new/different source never inherits the previous job's
      // lastPaidDay (prevents an instant full-month payout a day after a new job).
      const _newLast = (_prevSource && _newSourceN && _newSourceN !== _prevSource) ? _dayNow : _prevLast;
      sim.income = {
        source: _newSourceRaw,
        amount: Math.max(0, Math.min(10000000, Math.round(ri.amount ?? sim.income?.amount ?? 0))),
        cadence_days: Math.max(1, Math.min(365, Math.round(ri.cadence_days ?? sim.income?.cadence_days ?? 30))),
        lastPaidDay: _newLast,
      };
      // Zero-amount income means no recurring income (the old ternary kept it
      // alive because clamped cadence_days >= 1 is always truthy).
      if (!(sim.income.amount > 0)) { sim.income = null; cov("income:zero-amount-nulled"); }
      else cov("income:updated");
      }
    } else {
      cov("income:skipped");
    }
  } else {
    cov("income:skipped");
  }
}


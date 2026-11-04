// Gate 3 reconcile: M1 duplicate-delta guard (extracted verbatim from
// applyPatch's money block). Neutralizes ONLY deltas that genuinely duplicate
// a settled bill (per-bill, combined cash+bank split, or multi-bill sum). An
// unrelated legitimate expense in the same beat is left intact; a remainder
// beyond the matched total stays as a real expense.
//
// `vals` is {cd, bd} and is mutated in place, exactly as the old locals were.
// Returns the neutralized total (0 when nothing matched).
import { cov } from "../coverage.js";

export const BRANCHES = [
  "paidVsDelta:exact-bank",
  "paidVsDelta:exact-cash",
  "paidVsDelta:exact-take",
  "paidVsDelta:no-match",
  "paidVsDelta:split-pair",
  "paidVsDelta:sum-match",
  "paidVsDelta:warn",
];

export function neutralizeSettledDuplicates(vals, settledAmounts, totalPaid) {
  let neutralized = 0;
  if (totalPaid > 0 && (vals.cd < 0 || vals.bd < 0)) {
    const _pool = settledAmounts.slice();
    const _takeMatch = (mag) => {
      if (!(mag > 0)) return 0;
      const i = _pool.indexOf(mag);
      if (i !== -1) { _pool.splice(i, 1); cov("paidVsDelta:exact-take"); return mag; }
      if (_pool.length && _pool.reduce((a, b) => a + b, 0) === mag) { _pool.length = 0; cov("paidVsDelta:sum-match"); return mag; }
      return 0;
    };
    if (vals.cd < 0) { const m = _takeMatch(-vals.cd); if (m) { vals.cd += m; neutralized += m; cov("paidVsDelta:exact-cash"); } }
    if (vals.bd < 0) { const m = _takeMatch(-vals.bd); if (m) { vals.bd += m; neutralized += m; cov("paidVsDelta:exact-bank"); } }
    // Split-payment duplicate: cash and bank negatives that sum to one bill.
    if ((vals.cd < 0 || vals.bd < 0) && _pool.length) {
      const mag = (vals.cd < 0 ? -vals.cd : 0) + (vals.bd < 0 ? -vals.bd : 0);
      const i = _pool.indexOf(mag);
      if (i !== -1 && mag > 0) {
        neutralized += mag;
        if (vals.cd < 0) vals.cd = 0;
        if (vals.bd < 0) vals.bd = 0;
        _pool.splice(i, 1);
        cov("paidVsDelta:split-pair");
      }
    }
    if (neutralized === 0) cov("paidVsDelta:no-match");
    if (neutralized > 0) {
      console.warn(`[pay] neutralized ${neutralized} of duplicate cash/bank deltas for bills_paid (matched settled amounts ${totalPaid}).`);
      cov("paidVsDelta:warn");
    }
  } else {
    cov("paidVsDelta:no-match");
  }
  return neutralized;
}

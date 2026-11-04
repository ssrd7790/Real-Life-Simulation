// Gate 3 applier: CASH — cash_delta/bank_delta with windfall scrutiny,
// M1 duplicate neutralization (reconcile/paidVsDelta), floor-to-zero with
// visible shortfall notes. Reads ctx.totalPaid/settledAmounts from BILLS_PAID.
// Splice: verbatim lines 2007-2070 (totalPaid/settledAmounts/cd/bd rewired).
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { isFiniteNum, hasOwn, clamp100, windfallThreshold } from "../../engine.js";
import { neutralizeSettledDuplicates, BRANCHES as PD_BRANCHES } from "../reconcile/paidVsDelta.js";
import { clampWindfall, BRANCHES as W_BRANCHES } from "../reconcile/windfall.js";

export const BRANCHES = [
  "cash:blocked",
  "cash:entry",
  "cash:floored",
  "cash:nonfinite",
];

export function validateCash(sim, patch, ctx) {
  return !!(patch && (typeof patch.cash_delta === "number" || typeof patch.bank_delta === "number"));
}

export function applyCash(sim, patch, ctx) {
  cov("cash:entry");
  // Money deltas: scale-aware windfall scrutiny + shortfall visibility + duplicate guard.
  if (typeof patch.cash_delta === "number" || typeof patch.bank_delta === "number") {
    // M9: non-finite deltas are rejected with a warning and no state change.
    if (hasOwn(patch, "cash_delta") && typeof patch.cash_delta === "number" && !isFiniteNum(patch.cash_delta)) console.warn("[rails] non-finite cash_delta rejected:", String(patch.cash_delta).slice(0, 20));
    cov("cash:nonfinite");
    if (hasOwn(patch, "bank_delta") && typeof patch.bank_delta === "number" && !isFiniteNum(patch.bank_delta)) console.warn("[rails] non-finite bank_delta rejected:", String(patch.bank_delta).slice(0, 20));
    cov("cash:nonfinite");
    let cd = isFiniteNum(patch.cash_delta) ? Math.round(patch.cash_delta) : 0;
    let bd = isFiniteNum(patch.bank_delta) ? Math.round(patch.bank_delta) : 0;
    // M2: failed-/pay-beat flag (set by runTurn via opts.blockMoneyDeltas) —
    // the narration says the payment failed, so no money may move this beat.
    if (patch._block_money_deltas) { cd = 0; bd = 0; }
    cov("cash:blocked");
    // Scale-aware windfall scrutiny + M1 duplicate guard live in
    // reconcile/ (single source); called here at the exact old position:
    // after the block flag, before the floor/apply.
    {
      const _vals = { cd, bd };
      clampWindfall(sim, patch, _vals, windfallThreshold);
      neutralizeSettledDuplicates(_vals, ctx.settledAmounts, ctx.totalPaid);
      cd = _vals.cd; bd = _vals.bd;
    }
    // Apply with floor (never below 0); shortfalls become visible via memory, not silent free.
    if (cd !== 0) {
      const cash = Math.max(0, Math.round(sim.finances.cash || 0));
      if (cd < 0 && cash + cd < 0) {
        console.warn(`[rails] cash_delta ${cd} exceeds cash ${cash}; floored to ${-cash}.`);
        cov("cash:floored");
        sim.memories.shortTerm.push({ day: sim.world.date, text: `টাকার টানাটানি: নগদ ${cash} থেকে ${-cd} খরচের চেষ্টা, ঘাটতি ছিল।` });
        cd = -cash;
      }
      sim.finances.cash = Math.max(0, cash + cd);
    }
    if (bd !== 0) {
      const bank = Math.max(0, Math.round(sim.finances.bank || 0));
      if (bd < 0 && bank + bd < 0) {
        console.warn(`[rails] bank_delta ${bd} exceeds bank ${bank}; floored to ${-bank}.`);
        cov("cash:floored");
        sim.memories.shortTerm.push({ day: sim.world.date, text: `ব্যাংকে টানাটানি: ${bank} থেকে ${-bd} খরচের চেষ্টা, ঘাটতি ছিল।` });
        bd = -bank;
      }
      sim.finances.bank = Math.max(0, bank + bd);
    }
  }
}

export const ENTRIES = [
  {
    id: "cashBank",
    key: "cash_delta",
    phase: PHASES.ECONOMY,
    order: 70,
    owns: ["finances", "memories"],
    notes: "Windfall (+posTotal > wealth-scaled threshold) clamped unless chronicle_add carries a cause. M1: settled-bill duplicates neutralized per-bill/split/sum. Floors never go below 0; shortfalls surface as player-visible notes, never silent free money.",
    validate: validateCash,
    apply: applyCash,
  },
];

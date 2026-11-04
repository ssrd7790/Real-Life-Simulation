// Gate 4 core/economy — deterministic money arithmetic. Pure: no DOM, no
// LLM, no kv, no Date.now/Math.random. `creditIncome` is the MOVED body of
// engine.creditRecurringIncome (engine keeps a thin wrapper; behavior tests
// call through unchanged). Drift guard: differential-core V2.
// Scale constants mirrored from engine.js (same values, same comments):
//   INCOME_CATCHUP_MAX = 3650 (max paydays credited per call; 10y daily).
import { isFiniteNum } from "./util.js";

export const INCOME_CATCHUP_MAX = 3650;

// v2 (R5): auto-credit recurring income surviving model amnesia. Credits once
// per elapsed cadence, pushes a shortTerm payday memory, advances lastPaidDay.
// Catch-up completes in ONE bounded batch; never lost, never doubled.
export function creditIncome(sim, notes) {
  const N = notes || { warn: (m) => console.warn(m) };
  const inc = sim.income;
  if (!inc || typeof inc !== "object" || inc.cleared) return 0;
  if (!isFiniteNum(inc.amount) || !isFiniteNum(inc.cadence_days)) { N.warn("[rails] non-finite recurring income ignored."); return 0; }
  const amount = Math.round(inc.amount || 0);
  const cad = Math.round(inc.cadence_days || 0);
  if (!(amount > 0) || !(cad >= 1)) return 0;
  if (!isFiniteNum(inc.lastPaidDay)) inc.lastPaidDay = Math.max(1, Math.round(sim.world.dayCount || 1));
  const dc = Math.max(1, Math.round(sim.world.dayCount || 1));
  let elapsed = Math.floor((dc - Math.round(inc.lastPaidDay)) / cad);
  if (!(elapsed > 0)) return 0;
  if (!isFiniteNum(elapsed) || elapsed > INCOME_CATCHUP_MAX) {
    N.warn(`[rails] income catch-up capped at ${INCOME_CATCHUP_MAX} paydays (gap ${elapsed}).`);
    elapsed = Math.min(isFiniteNum(elapsed) ? elapsed : INCOME_CATCHUP_MAX, INCOME_CATCHUP_MAX);
  }
  for (let i = 0; i < elapsed; i++) {
    sim.finances.cash = Math.max(0, Math.round((sim.finances.cash || 0) + amount));
    inc.lastPaidDay = Math.round(inc.lastPaidDay) + cad;
  }
  sim.memories.shortTerm.push({ day: sim.world.date, text: `আয় পেলাম: ${String(inc.source || "আয়").slice(0, 60)} থেকে ${amount} টাকা।${elapsed > 1 ? ` (${elapsed} কিস্তি)` : ""}` });
  while (sim.memories.shortTerm.length > 60) {
    const old = sim.memories.shortTerm.shift();
    sim.memories.longTerm.push({ day: old.day, text: old.text, faded: true });
  }
  if (sim.memories.longTerm.length > 200) sim.memories.longTerm = sim.memories.longTerm.slice(-200); // V2_LONGTERM_CAP
  return elapsed;
}

// --- New deterministic derivations (no legacy counterpart; feed the
// scheduler + FACTS slice). All pure reads, never mutate. ---

// Days until the next payday (<=0 means due now/overdue). Null when no income.
export function daysToPayday(sim) {
  const inc = sim && sim.income;
  if (!inc || typeof inc !== "object" || inc.cleared) return null;
  if (!isFiniteNum(inc.amount) || !(inc.amount > 0)) return null;
  if (!isFiniteNum(inc.cadence_days) || !(inc.cadence_days >= 1)) return null;
  const dc = Math.max(1, Math.round(sim.world.dayCount || 1));
  const last = isFiniteNum(inc.lastPaidDay) ? Math.round(inc.lastPaidDay) : dc;
  return (last + Math.round(inc.cadence_days)) - dc;
}

// Unpaid bills, largest first (scheduler stakes + FACTS money line).
export function unpaidBills(sim) {
  const bills = (sim && sim.finances && Array.isArray(sim.finances.bills)) ? sim.finances.bills : [];
  return bills
    .filter((b) => b && !b.paid)
    .map((b) => ({ id: b.id, name: String(b.name || "বিল"), amount: Math.max(0, Math.round(b.amount || 0)), due: String(b.due || "") }))
    .sort((a, b) => b.amount - a.amount);
}

// Total cash+bank (never negative inputs).
export function liquidTotal(sim) {
  try {
    return Math.max(0, Math.round(sim.finances.cash || 0)) + Math.max(0, Math.round(sim.finances.bank || 0));
  } catch (_) { return 0; }
}


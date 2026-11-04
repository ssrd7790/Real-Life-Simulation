// Gate 3 applier: TIME — time clamp + advanceTime + location/locationFacts +
// phone_call (always runs; sets ctx.mins/hrsFull/hrsEff for DECAY and BODY).
// Splice: verbatim applyPatch lines 1827-1873. Only rewiring: `arguments[3]`
// becomes ctx (the wrapper preserves Function.length === 3 and forwards the
// 4th argument + its presence flag), and locChanged/presentAtStart become ctx.
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { SKIP_MAX_MIN, SKIP_DECAY_MAX_HRS, advanceTime, normName, hasOwn, resolvePersonKey } from "../../engine.js";
import { LOC_FACTS_MAX, defaultLocationFacts } from "../../personality.js";

export const BRANCHES = [
  "time:entry",
  "time:loc-changed",
  "time:normal",
  "time:phone-miss",
  "time:phone-null",
  "time:phone-set",
  "time:skip",
];

export function validateTime(sim, patch, ctx) {
  return true; // always runs: every beat advances the clock
}

export function applyTime(sim, patch, ctx) {
  cov("time:entry");
  if (!ctx.isSkip) {
    // normal actions: clamp to 3-20 min to enforce UCRT even if model proposes more
    patch.time_advance_minutes = Math.max(3, Math.min(20, patch.time_advance_minutes));
    cov("time:normal");
  } else {
    // v2 (R5): skip cap raised to 7 days to match the README/top-up promise.
    // C6: clamp to the REQUESTED duration (4th arg, or patch._skip_want from the
    // caller) as well as the global cap, so a 60-minute skip never advances
    // 10080 minutes when the model over-proposes. Function.length stays 3
    // (arity preserved) — the 4th argument is read via `arguments`.
    let _cap = SKIP_MAX_MIN;
    try {
      const _req = ctx.hasFourth ? ctx.fourth : patch._skip_want;
      if (typeof _req === "number" && Number.isFinite(_req) && _req > 0) {
        _cap = Math.max(5, Math.min(SKIP_MAX_MIN, Math.round(_req)));
      }
    } catch (_) {}
    patch.time_advance_minutes = Math.max(5, Math.min(_cap, patch.time_advance_minutes));
    cov("time:skip");
  }
  ctx.mins = Math.max(1, Math.round(patch.time_advance_minutes || 8));
  ctx.hrsFull = ctx.mins / 60;
  // Issue #01 (D2): capped effective hours for decay — skips assume routine survival.
  ctx.hrsEff = ctx.isSkip ? Math.min(ctx.hrsFull, SKIP_DECAY_MAX_HRS) : ctx.hrsFull;
  advanceTime(sim, ctx.mins);
  if (patch.location && typeof patch.location === "string" && patch.location.trim()) {
    const _prevLoc = String(sim.world.location || "");
    const _nextLoc = patch.location.trim().slice(0, 160);
    if (normName(_prevLoc) !== normName(_nextLoc)) { sim.world.present = []; ctx.locChanged = true; }
    cov("time:loc-changed");
    sim.world.location = _nextLoc;
  }
  // Anti-hallucination: lock the physical architecture whenever the model reports
  // a move or discovers permanent structural facts (Bengali, <=200).
  if (typeof patch.location_facts === "string" && patch.location_facts.trim()) {
    sim.world.locationFacts = patch.location_facts.trim().slice(0, LOC_FACTS_MAX);
  }
  // BUG9: lightweight phone-call tracking (remote voice only, never in-room).
  try {
    if (ctx.isSkip) { sim.world.phoneCall = null; }
    else if (hasOwn(patch, "phone_call")) {
      const pc = patch.phone_call;
      if (pc === null) { sim.world.phoneCall = null; cov("time:phone-null"); }
      else if (typeof pc === "string" && pc.trim()) {
        const hit = resolvePersonKey(sim, pc.trim());
        if (hit && hit.npc && !hit.npc.inactive && !hit.npc.controlled) { sim.world.phoneCall = hit.npc.id; cov("time:phone-set"); }
        else { sim.world.phoneCall = null; cov("time:phone-miss"); }
      }
    }
  } catch (_) {}
}

export const ENTRIES = [
  {
    id: "time",
    key: "time_advance_minutes",
    phase: PHASES.TIME,
    order: 10,
    owns: ["world"],
    notes: "Clamps patch.time_advance_minutes in place (mutates patch, as before); computes hrsEff (skip-capped). Location change clears present. phone_call resolves to a live id or null.",
    validate: validateTime,
    apply: applyTime,
  },
];

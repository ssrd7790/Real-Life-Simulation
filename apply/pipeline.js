// Gate 3 pipeline: applyPatch as an explicit ordered pipeline.
//   1) guard(patch)       reserved/prototype keys stripped; shape-tolerant
//                         (null/primitive patches pass through to the same
//                         downstream behavior as the old code).
//   2) prep/decay/time    always-run entries (defaults, clock, decay) —
//                         ordered by (phase, order) like everything else.
//   3) applyAll           every registry entry in (phase, order).
//   4) reconcile          inline at ordered positions (windfall + M1 inside
//                         CASH; income/prune moments as ordered entries).
//   5) postCaps/close     CLOSE entry: prunePaidBills + hygienePass + stamp.
//   6) hygienePass        part of CLOSE (same call, same position as before).
//
// This file intentionally names NO patch keys (A7: adding a key never edits
// this file — verified by tests). It also performs the dev-only owns check
// (OFF by default; see coverage.js).
import { isReservedKey } from "../engine.js";
import { APPLIERS, sortedEntries, createCtx } from "./registry.js";
import { cov, topLevelDiffKeys } from "./coverage.js";

export const BRANCHES = [
  "pipeline:owns-checked",
  "pipeline:run",
];

export function guardPatch(patch) {
  if (!patch || typeof patch !== "object") return patch;
  try {
    for (const k of Object.keys(patch)) {
      if (isReservedKey(k)) delete patch[k];
    }
  } catch (_) {}
  return patch;
}

function snapshotTop(sim) {
  const out = {};
  try {
    for (const k of Object.keys(sim || {})) {
      try { out[k] = JSON.stringify(sim[k]); } catch (_) { out[k] = "[unstringifiable]"; }
    }
  } catch (_) {}
  return out;
}

export function runPipeline(sim, patch, isSkip = false, opts = {}) {
  cov("pipeline:run");
  const reg = opts.registry || APPLIERS;
  guardPatch(patch);
  const ctx = opts.ctx || createCtx(isSkip, opts);
  ctx.isSkip = !!isSkip;
  if (opts.ctx && opts.fourth !== undefined) { ctx.fourth = opts.fourth; ctx.hasFourth = !!opts.hasFourth; }
  const entries = sortedEntries(reg);
  const debugOwns = opts.debugOwns === true;
  for (const e of entries) {
    let before = null;
    if (debugOwns) before = snapshotTop(sim);
    e.apply(sim, patch, ctx);
    if (debugOwns) {
      try {
        const after = snapshotTop(sim);
        const changed = topLevelDiffKeys(before, after);
        if (changed.length) {
          const allowed = new Set((e.owns || []).map((o) => String(o).split(".")[0]));
          const bad = changed.filter((k) => !allowed.has(k));
          if (bad.length) console.warn(`[apply-owns] ${e.id} wrote outside owns [${(e.owns || []).join(",")}]: ${bad.join(",")}`);
          cov("pipeline:owns-checked");
        }
      } catch (_) {}
    }
  }
  return ctx;
}

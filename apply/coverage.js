// Gate 3: dev-only instrumentation for the apply pipeline.
// BOTH facilities are OFF by default (single boolean gate each, ~zero cost
// when disabled). They never touch sim/patch — coverage state lives in a
// module-level Map keyed by mark id, so enabling them cannot change behavior.
//
// Branch marks: appliers call cov("file:branch-id") at each interesting
// branch. With coverage enabled, the mark records {hits, file, line} (line
// parsed from a captured stack). The committed coverage test enables this,
// runs the suite, and asserts >=90% of registered BRANCHES are hit.
// Line numbers come from the captured stack, so the per-applier report lists
// real file:line pairs without any build tooling.
//
// Ownership check: each registry entry declares `owns` (top-level sim paths
// it may write). With debugOwns enabled, the pipeline snapshots the sim's
// top-level keys before/after each applier and console.warns on writes
// outside the declared list. OFF by default (no perf cost, A6).
const _marks = new Map(); // id -> { hits, file, line }

function _parseLoc(stack) {
  try {
    const lines = String(stack || "").split("\n");
    for (const ln of lines) {
      const m = ln.match(/\/src\/apply\/([^\s:)]+):(\d+):\d+/);
      if (m) return { file: `src/apply/${m[1]}`, line: parseInt(m[2], 10) };
    }
  } catch (_) {}
  return { file: "", line: 0 };
}

export function cov(id) {
  if (globalThis.__APPLY_COVERAGE !== true) return;
  try {
    let e = _marks.get(id);
    if (!e) {
      const loc = _parseLoc(new Error("cov").stack);
      e = { hits: 0, file: loc.file, line: loc.line };
      _marks.set(id, e);
    }
    e.hits++;
  } catch (_) {}
}

export function covReset() {
  _marks.clear();
}

export function covReport() {
  const out = {};
  for (const [id, e] of _marks) out[id] = { hits: e.hits, file: e.file, line: e.line };
  return out;
}

// Idempotent failure note helper shared by appliers would live here; the
// pipeline's owns-check lives in pipeline.js and calls this predicate.
export function topLevelDiffKeys(beforeJson, afterJson) {
  // Both are maps: topKey -> stable string. Returns keys whose value changed
  // plus keys added/removed. Pure (used by the dev-only owns check).
  const out = [];
  try {
    const b = beforeJson || {}, a = afterJson || {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const k of keys) {
      if (b[k] !== a[k]) out.push(k);
    }
  } catch (_) {}
  return out;
}

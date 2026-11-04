// Session state + crash-proof storage for the frontend (Gate 6).
// Split from src/app.js: bodies moved verbatim; the bare module-level mutable
// state (sims/activeId/sim/busy/logFilter) now lives on the ONE `session`
// object every UI module shares. Only this module ever replaces those slots.
// Imports renderSimList (ui/modals.js) for persist(); that cycle is call-time
// only (persist runs on user action, never at import), so it is safe.
import { migrateSim } from "../personality.js";
import { hygienePass } from "../engine.js";
import { renderSimList } from "../ui/modals.js";

const R = () => globalThis.root;
export const kvSims = () => R().kv.sims;

// M15: crash-proof storage wrapper (private-mode/denied localStorage falls
// back to an in-memory slot instead of throwing on every save).
export const store = {
  _m: {},
  get(k) { try { const v = localStorage.getItem(k); return v == null ? null : v; } catch (_) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { this._m[String(k)] = String(v); } },
};

export const session = {
  sims: [],        // [{id,name,updatedAt,sim}]
  activeId: store.get("jibon_active"),
  sim: null,       // active sim object
  busy: false,
  logFilter: "all",
};

export async function loadIndex() {
  try {
    const entries = await kvSims().entries();
    session.sims = entries.map(([key, val]) => ({ id: key, name: val?.name || "অনামা জীবন", updatedAt: val?.updatedAt || 0, sim: val }));
    session.sims.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (e) { console.warn("kv load failed", e); session.sims = []; }
  if (session.activeId && !session.sims.find((s) => s.id === session.activeId)) session.activeId = null;
  if (!session.activeId && session.sims.length) session.activeId = session.sims[0].id;
  session.sim = session.activeId ? session.sims.find((s) => s.id === session.activeId)?.sim || null : null;
  // migrate old saves: distinct psych profiles for NPCs without them (history untouched)
  // M10: persist only when a pass actually changed the sim (snapshot compare),
  // so steady-state boots never rewrite storage.
  for (const s of session.sims) {
    try {
      let touched = false;
      if (migrateSim(s.sim)) touched = true;
      try { const _b = JSON.stringify(s.sim); hygienePass(s.sim); if (JSON.stringify(s.sim) !== _b) touched = true; } catch (_) {}
      if (touched) await kvSims().set(s.id, s.sim);
    } catch (_) {}
  }
}

export async function persist() {
  if (!session.sim) return;
  session.sim.updatedAt = Date.now();
  try { await kvSims().set(session.sim.id, session.sim); } catch (e) { console.warn("kv save failed", e); }
  const ex = session.sims.find((s) => s.id === session.sim.id);
  if (ex) { ex.sim = session.sim; ex.updatedAt = session.sim.updatedAt; ex.name = session.sim.name; }
  else session.sims.unshift({ id: session.sim.id, name: session.sim.name, updatedAt: session.sim.updatedAt, sim: session.sim });
  store.set("jibon_active", session.sim.id);
  renderSimList();
}

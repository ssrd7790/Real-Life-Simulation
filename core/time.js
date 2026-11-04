// Gate 4 core/time — authoritative calendar. Pure: no DOM, no LLM, no kv,
// no Date.now/Math.random. `advanceCalendar` is the MOVED body of
// engine.advanceTime (engine keeps a thin wrapper; behavior tests and the
// TIME applier call through unchanged). Drift guard: differential-core V2.
export function advanceCalendar(sim, mins) {
  let t = sim.world.timeMin + mins;
  let days = 0;
  while (t >= 1440) { t -= 1440; days++; }
  sim.world.timeMin = t;
  if (days > 0) {
    sim.world.dayCount += days;
    // M8: validate/normalize DD/MM (same tolerance as monthOf: month 1-12 else
    // the 08 fallback; day 1-30). A malformed date falls back to a safe date
    // instead of writing NaN/undefined back into the save, HUD or prompt.
    let nd = 15, nm = 8;
    try {
      const parts = String(sim.world.date || "").split("/");
      if (parts.length === 2) {
        const d = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
        if (Number.isFinite(d) && d >= 1 && d <= 30) nd = Math.round(d);
        if (Number.isFinite(m) && m >= 1 && m <= 12) nm = Math.round(m);
      }
    } catch (_) {}
    nd += days;
    while (nd > 30) { nd -= 30; nm = nm % 12 + 1; }
    sim.world.date = `${String(nd).padStart(2, "0")}/${String(nm).padStart(2, "0")}`;
  }
}

// Beat-length clamp inputs live in the TIME applier (rails stay there, C1);
// this helper documents the resulting hour figures both sides must agree on.
export function beatHours(mins, isSkip, skipCapHrs = 8) {
  const hrsFull = mins / 60;
  const hrsEff = isSkip ? Math.min(hrsFull, skipCapHrs) : hrsFull;
  return { hrsFull, hrsEff };
}

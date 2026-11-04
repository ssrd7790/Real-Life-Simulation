// Gate 4 core/physiology — survival arithmetic of the sim. Pure: no DOM, no
// LLM, no kv, no Date.now/Math.random. Bodies are the MOVED blocks from the
// Gate 3 DECAY/BODY appliers (which now delegate here); all clamps/rails in
// the appliers are untouched (C1). Drift guard: differential-core V2.
// Scale constants (single source of truth lives in engine.js; mirrored here
// with the same values so core stays import-cycle-free):
//   SATIETY_ZERO_DRAIN_PER_HR = 1.0, ENERGY_ZERO_DRAIN_PER_HR = 1.0,
//   PHYS_DRAIN_DAILY_CAP = 12, HEALTH_RECOVERY_THRESHOLD = 20.
import { clamp100, isFiniteNum } from "./util.js";
import { baseStates, STATE_KEYS, MINOR_LUST_VALUE, MINOR_DESIRE_VALUE, isMinorNpc } from "../personality.js";

export const SATIETY_DRAIN_PER_HR = 2.2;   // passive satiety loss per hour
export const ENERGY_DRAIN_DAY_PER_HR = 2.5; // passive energy loss per waking hour
export const ENERGY_DRAIN_NIGHT_PER_HR = 6; // ... per night hour (23:00-06:00)
// Per-state drift rates toward baseline per hour (moved with the block).
export const STATE_DRIFT_PER_HR = { anger: 4, fear: 4, suspicion: 4, stress: 4, desire: 3, joy: 1.5, sadness: 2, affection: 1.5 };

// Single drift step: move cur toward base by at most step (minors: desire
// locked at 0, never revived). Returns the new value (pure).
export function driftValue(cur, base, step, minorLock, mark) {
  if (minorLock) { if (typeof mark === "function") { try { mark("decay:minor-lock"); } catch (_) {} } return cur; }
  if (!isFiniteNum(cur)) return base;
  const diff = cur - base;
  if (diff === 0) return cur;
  return clamp100(Math.round(cur - Math.sign(diff) * Math.min(Math.abs(diff), step)));
}

// Issue #01: passive decay BEFORE patch stats/npc_states land (LLM landing wins).
export function applyPassiveDecay(sim, hrsEff) {
  sim.stats.satiety = clamp100(sim.stats.satiety - hrsEff * SATIETY_DRAIN_PER_HR);
  sim.stats.energy = clamp100(sim.stats.energy - hrsEff * (sim.world.timeMin >= 1320 || sim.world.timeMin < 360 ? ENERGY_DRAIN_NIGHT_PER_HR : ENERGY_DRAIN_DAY_PER_HR));
}

// C7/M20: gradual drift of ALL 8 hot NPC states toward the documented
// baseline. Controlled records never decay independently; minor desire locked.
export function applyNpcDrift(sim, hrsEff, mark) {
  const h2 = Math.max(0.2, hrsEff);
  const base = baseStates();
  for (const npc of Object.values(sim.npcs || {})) {
    if (!npc || typeof npc !== "object") continue;
    if (!npc.states || typeof npc.states !== "object") { npc.states = { ...base }; }
    if (npc.controlled) continue;
    const minor = isMinorNpc(npc);
    for (const k of STATE_KEYS) {
      npc.states[k] = driftValue(npc.states[k], base[k], h2 * (STATE_DRIFT_PER_HR[k] ?? 2), minor && k === "desire", mark);
    }
    if (minor) {
      if (npc.states.desire !== MINOR_DESIRE_VALUE) npc.states.desire = MINOR_DESIRE_VALUE;
      if (npc.core_traits && typeof npc.core_traits === "object" && npc.core_traits.lust !== MINOR_LUST_VALUE) npc.core_traits.lust = MINOR_LUST_VALUE;
    }
  }
}

// Passive cooling of the controlled persona's own states over the same hours.
export function applyPersonaDrift(sim, hrsEff, mark) {
  try {
    if (sim.persona && sim.persona.states && typeof sim.persona.states === "object") {
      const h2 = Math.max(0.2, hrsEff);
      const base = baseStates();
      const st = sim.persona.states;
      let pAge = null;
      try {
        if (isFiniteNum(sim.persona.baseAge)) pAge = Math.round(sim.persona.baseAge);
        else if (isFiniteNum(sim.persona.age)) pAge = Math.round(sim.persona.age);
      } catch (_) { pAge = null; }
      const pMinor = (typeof pAge === "number" && pAge < 18);
      for (const k of STATE_KEYS) {
        st[k] = driftValue(st[k], base[k], h2 * (STATE_DRIFT_PER_HR[k] ?? 2), pMinor && k === "desire", mark);
      }
      if (pMinor) {
        if (typeof mark === "function") { try { mark("decay:persona-minor"); } catch (_) {} }
        if (st.desire !== MINOR_DESIRE_VALUE) st.desire = MINOR_DESIRE_VALUE;
        if (sim.persona.traits && typeof sim.persona.traits === "object" && sim.persona.traits.lust !== MINOR_LUST_VALUE) {
          try { sim.persona.traits.lust = MINOR_LUST_VALUE; } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

// R3: minimal physiology coupling with fractional accumulator + daily cap,
// scaled by FULL elapsed hours against the LANDED zero flags. Dual-zero
// drains strictly faster than single-zero. Critical set/cleared with notes.
export function applyDrainAndCritical(sim, hrsFull, hooks) {
  const N = hooks || {};
  const warn = typeof N.warn === "function" ? N.warn : (m) => console.warn(m);
  const mark = typeof N.mark === "function" ? N.mark : null;
  const fire = (id) => { if (mark) { try { mark(id); } catch (_) {} } };
  const zeroSat = (sim.stats.satiety <= 0);
  const zeroEn = (sim.stats.energy <= 0);
  if (zeroSat || zeroEn) {
    let raw = 0;
    if (zeroSat) raw += hrsFull * 1.0; // SATIETY_ZERO_DRAIN_PER_HR
    if (zeroEn) raw += hrsFull * 1.0;  // ENERGY_ZERO_DRAIN_PER_HR
    if (raw > 0) {
      const dailyCap = (zeroSat && zeroEn) ? 12 : 6; // PHYS_DRAIN_DAILY_CAP / half
      const maxForPatch = Math.max(0, dailyCap * hrsFull / 24);
      const cappedRaw = Math.min(raw, maxForPatch);
      sim.healthDrainAcc = (sim.healthDrainAcc || 0) + cappedRaw;
      const toApply = Math.floor(sim.healthDrainAcc);
      if (toApply > 0) {
        sim.healthDrainAcc -= toApply;
        sim.stats.health = clamp100(sim.stats.health - toApply);
        sim.memories.shortTerm.push({ day: sim.world.date, text: `শরীর ভেঙে পড়ছে: ${zeroSat ? "খালি পেটে" : ""}${zeroSat && zeroEn ? " ও " : ""}${zeroEn ? "নিদ্রাহীন" : ""} কাটানোর জেরে স্বাস্থ্য কমলো।` });
        fire("physiology:drained");
      }
    }
  }
  if (sim.stats.health <= 0) {
    sim.stats.health = 0;
    if (!sim.critical.active) {
      sim.critical = { active: true, sinceDay: Math.max(1, Math.round(sim.world.dayCount || 1)) };
      sim.memories.shortTerm.push({ day: sim.world.date, text: `সংকট: শরীর ভেঙে পড়েছে, নড়াচড়ার শক্তি নেই — জরুরি যত্ন দরকার।` });
      warn("[health] character incapacitated (health 0).");
      fire("physiology:critical-set");
    }
  } else if (sim.critical.active && sim.stats.health >= 20) { // HEALTH_RECOVERY_THRESHOLD
    sim.critical = { active: false, sinceDay: null };
    sim.memories.shortTerm.push({ day: sim.world.date, text: `সেরে ওঠা: শরীরে আবার শক্তি ফিরেছে।` });
    fire("physiology:recovered");
  }
}

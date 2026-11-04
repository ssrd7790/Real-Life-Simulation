// Gate 4 core/schedules — per-NPC daily routine: who is where when. Pure:
// no DOM, no LLM, no kv, no Date.now/Math.random. Jitter comes from hashing
// the NPC id (stable per NPC, zero PRNG drift). Schedules NEVER write to the
// sim and never override the patch-driven roster; they drive `world.present`
// CANDIDATES and off-screen plausibility in the scheduler + FACTS slice.
import { hashStr, mulberry32 } from "./util.js";

// Day slots (sim minutes). Routine derivation, not a rail: the model's
// scene_present still decides presence; the schedule only says who COULD
// plausibly be around.
export const SLOT = {
  NIGHT: "night",     // 23:00-05:00 — home, asleep
  MORNING: "morning", // 05:00-10:00 — home/tea-shop, waking errands
  MIDDAY: "midday",   // 10:00-17:00 — work/role place
  EVENING: "evening", // 17:00-23:00 — home/market/tea-shop, social
};

export function slotOf(timeMin) {
  const t = ((Math.round(timeMin) % 1440) + 1440) % 1440;
  if (t >= 1380 || t < 300) return SLOT.NIGHT;
  if (t < 600) return SLOT.MORNING;
  if (t < 1020) return SLOT.MIDDAY;
  return SLOT.EVENING;
}

// Stable per-NPC jitter 0..1 from the id (same NPC, same answer, every load).
export function npcJitter(npc) {
  try {
    const id = (npc && (npc.id || npc.name)) || "?";
    return mulberry32(hashStr("sched:" + String(id)))();
  } catch (_) { return 0.5; }
}

// Where the routine says this NPC is, and whether they are out-and-about
// (present-plausible) vs home/asleep. Returns {slot, place, out}.
// place: "home" | "work" | "market" | "away". `away` = travelling/off-map
// (rare, jitter-gated) — the scheduler treats away NPCs as off-screen-only.
export function routineFor(npc, timeMin) {
  const slot = slotOf(timeMin);
  const j = npcJitter(npc);
  const role = String((npc && npc.role) || "").toLowerCase();
  const isShop = /দোকান|shop|বাজার|market|চা/.test(role);
  if (slot === SLOT.NIGHT) return { slot, place: "home", out: false };
  if (slot === SLOT.MORNING) {
    if (j < 0.25) return { slot, place: "market", out: true };
    return { slot, place: isShop ? "work" : "home", out: !!isShop };
  }
  if (slot === SLOT.MIDDAY) {
    if (j < 0.12) return { slot, place: "away", out: false };
    if (j < 0.30) return { slot, place: "market", out: true };
    return { slot, place: isShop || j < 0.7 ? "work" : "home", out: true };
  }
  // evening
  if (j < 0.35) return { slot, place: "market", out: true };
  return { slot, place: "home", out: j < 0.6 };
}

// Present candidates: live, non-controlled NPCs whose routine has them out
// (or at work) right now. Ordered by id for determinism.
export function presentCandidates(sim, timeMin) {
  const out = [];
  try {
    for (const npc of Object.values(sim.npcs || {})) {
      if (!npc || typeof npc !== "object") continue;
      if (npc.inactive || npc.controlled) continue;
      if (!npc.id || !npc.name) continue;
      const r = routineFor(npc, timeMin);
      if (r.out || r.place === "work") out.push(npc.id);
    }
  } catch (_) {}
  return out.sort();
}

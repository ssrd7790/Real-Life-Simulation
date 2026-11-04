// Gate 4 core/scheduler — top-k event selection for the FACTS slice. PURE
// READS by default: same (sim, ctx) => same selection, no mutation, so prompt
// builders and replay verifiers (measurePrompt exact mode) can call it any
// number of times. Cooldown marking (the anti-repeat mechanism) is OPT-IN:
// pass mark=true, or call markShown(picks, nowBeat) explicitly. The runtime
// (callRealityEngine) marks after measuring; tests mark explicitly. No DOM,
// no LLM, no kv, no Date.now/Math.random. Candidates come ONLY from
// sim.journal (system beats journal daily derived events + model-landing
// dual-writes in the appliers), so selection is fully determined by
// (sim, ctx).
import { isCooledDown, setCooldown } from "./events.js";
import { normLocal } from "./util.js";

// Default select count: ≤5-8 events worth narrating (mission: top-k, k=5).
export const SCHED_K_DEFAULT = 5;
// Stakes by kind: what the beat is ABOUT when this kind fires. Health and
// money dominate (survival arithmetic); canon anchors continuity; notes and
// roster fill texture; weather/world set scene only.
export const W_STAKES = { health: 5, money: 4, canon: 4, roster: 2, weather: 2, world: 2, note: 1 };
// Recency: fresher beats score higher, decaying over ~20 beats (a quiet week
// buries old news, but canon-adjacent money/health linger via stakes).
export const W_RECENCY_MAX = 3;
export const W_RECENCY_HALF_BEATS = 20;
// Relevance: token overlap with the player's input (+1.5/hit, capped) plus a
// bonus when the event's actors are in the room or named in the input.
export const W_RELEVANCE_PER_HIT = 1.5;
export const W_RELEVANCE_CAP = 4.5;
export const W_PRESENT_ACTOR = 2;
// Novelty: within one selection, repeats of an already-picked kind/actor fade.
export const W_SAME_KIND_PENALTY = 1.5;
export const W_SAME_ACTOR_PENALTY = 1;
// Cooldown after selection, in beats (health lingers longest on purpose).
export const COOLDOWN_BEATS = { health: 8, canon: 6, money: 4, roster: 4, weather: 6, world: 4, note: 3 };
export const COOLDOWN_DEFAULT = 3;

function tokens(s) {
  return normLocal(s).split(/\s+/).filter((t) => t.length >= 2);
}

// Score one event against ctx. ctx: {inputText, presentIds[], inputNames[],
// controlledNames[] (normalized, excluded), nowBeat}. Higher = narrate first.
export function scoreEvent(ev, ctx) {
  const c = ctx || {};
  const nowBeat = Number.isInteger(c.nowBeat) ? c.nowBeat : 0;
  let s = W_STAKES[ev.kind] ?? 1;
  const age = Math.max(0, nowBeat - (ev.beat || 0));
  s += W_RECENCY_MAX * Math.max(0, 1 - age / W_RECENCY_HALF_BEATS);
  if (ev.narrated) s -= 2; // already told once — prefer unnarrated news
  const inToks = new Set(tokens(c.inputText));
  if (inToks.size) {
    let hits = 0;
    const evToks = tokens(ev.text || "");
    for (const e of evToks) {
      for (const u of inToks) {
        // Bengali inflection (করিম/করিমের/করিমকে): exact or either-contains.
        if (e === u || (e.length >= 3 && u.includes(e)) || (u.length >= 3 && e.includes(u))) { hits++; break; }
      }
    }
    for (const a of ev.actors || []) for (const t of tokens(a)) if (inToks.has(t)) hits++;
    s += Math.min(W_RELEVANCE_CAP, hits * W_RELEVANCE_PER_HIT);
    const names = new Set([...(c.inputNames || []), ...(c.presentIds || [])].map(normLocal));
    for (const a of ev.actors || []) {
      if (names.has(normLocal(a))) { s += W_PRESENT_ACTOR; break; }
    }
  }
  return s;
}

function leaksControlled(ev, controlledNames) {
  if (!controlledNames || !controlledNames.length) return false;
  const hay = normLocal(ev.text) + " " + (ev.actors || []).map(normLocal).join(" ");
  return controlledNames.some((n) => n && hay.includes(n));
}

// Top-k: unnarrated-or-fresh, uncooled, non-leaking events, score order with
// novelty penalties, ties broken by journal id (stable). PURE by default —
// no mutation, so repeated calls with the same (sim, ctx) return the same
// picks (prompt replay stability). Pass mark=true to ALSO start cooldowns
// on the returned events (runtime anti-repeat; equivalent to calling
// markShown(picked, nowBeat) afterwards). Never returns more than k.
export function topK(sim, k, ctx, mark = false) {
  const n = Math.max(0, Math.min(50, Math.round(k ?? SCHED_K_DEFAULT)));
  const c = ctx || {};
  const nowBeat = Number.isInteger(c.nowBeat) ? c.nowBeat : (sim.journalBeat || 0);
  if (n === 0) return [];
  const controlled = (c.controlledNames || []).map(normLocal).filter(Boolean);
  const scored = [];
  for (const ev of sim.journal || []) {
    if (!ev || typeof ev !== "object") continue;
    if (isCooledDown(ev, nowBeat)) continue;
    if (leaksControlled(ev, controlled)) continue;
    scored.push({ ev, s: scoreEvent(ev, { ...c, nowBeat }) });
  }
  scored.sort((a, b) => (b.s - a.s) || (String(a.ev.id) < String(b.ev.id) ? -1 : 1));
  // Greedy pick with novelty penalties: each step takes the highest
  // (base score − same-kind/same-actor penalties from already-picked).
  // Ties break by journal id — fully deterministic for identical inputs.
  const picked = [];
  const kindCount = {};
  const actorSeen = new Set();
  const pool = scored.slice();
  while (picked.length < n && pool.length) {
    let bi = 0, bs = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const { ev, s } = pool[i];
      let pen = (kindCount[ev.kind] || 0) * W_SAME_KIND_PENALTY;
      for (const a of ev.actors || []) if (actorSeen.has(normLocal(a))) pen += W_SAME_ACTOR_PENALTY;
      const eff = s - pen;
      if (eff > bs || (eff === bs && String(ev.id) < String(pool[bi].ev.id))) { bs = eff; bi = i; }
    }
    const [one] = pool.splice(bi, 1);
    picked.push(one.ev);
    kindCount[one.ev.kind] = (kindCount[one.ev.kind] || 0) + 1;
    for (const a of one.ev.actors || []) actorSeen.add(normLocal(a));
  }
  if (mark) markShown(picked, nowBeat);
  return picked;
}

// Start cooldowns on shown events (the anti-repeat mechanism): each picked
// event is hidden from selection for COOLDOWN_BEATS[kn] beats. Idempotent
// per beat (re-marking at the same nowBeat sets the same values); a LATER
// nowBeat extends. Pure w.r.t. selection — only cooldownUntil changes.
export function markShown(picks, nowBeat) {
  for (const e of picks || []) setCooldown(e, nowBeat, COOLDOWN_BEATS[e && e.kind] ?? COOLDOWN_DEFAULT);
}

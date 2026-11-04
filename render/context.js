// Gate 4 render/context — turns the computed slice into prompt text using the
// existing budget constants. Imports core/* only (never engine.js: the graph
// stays engine -> render/context -> core/*, one-directional and cycle-free).
import { topK, markShown, SCHED_K_DEFAULT } from "../core/scheduler.js";

// FACTS block budget (chars). The block replaces the raw Recent-memories and
// Faded-echoes dumps, so the prompt shrinks while carrying scored signal.
export const FACTS_BUDGET = 400;
export const FACTS_LABEL = "- FACTS (computed, canon — narrate these; never contradict): ";

// One journal event as a terse prompt line: [Day d] text (≤90 chars, sliced
// on a space boundary, never mid-word).
function eventLine(ev) {
  const t = String(ev.text || "").trim().replace(/\s+/g, " ");
  const head = `[D${ev.day ?? "?"}] `;
  const max = 90 - head.length;
  if (t.length <= max) return head + t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return head + (sp > 30 ? cut.slice(0, sp) : cut) + "…";
}

// Scheduler context for one turn: the player's text, who's in the room, the
// addressed target (player-targeted events score higher), the controlled NPC
// (whose name must never leak into FACTS), and the current beat. Pure read.
export function factsContext(sim, currentInput) {
  let text = "";
  let target = "";
  try {
    if (typeof currentInput === "string") text = currentInput;
    else if (currentInput && typeof currentInput === "object") {
      text = String(currentInput.text || "");
      target = String(currentInput.target || "");
    }
  } catch (_) {}
  let presentIds = [];
  try {
    if (Array.isArray(sim.world.present)) {
      for (const id of sim.world.present) {
        if (typeof id !== "string") continue;
        presentIds.push(id);
        // Match by name too: journal actors are display names, not ids.
        try {
          const nm = sim.npcs && sim.npcs[id] && sim.npcs[id].name;
          if (typeof nm === "string" && nm.trim()) presentIds.push(nm);
        } catch (_) {}
      }
    }
  } catch (_) {}
  let controlledNames = [];
  try {
    const cid = sim.controlledNpcId;
    if (typeof cid === "string" && sim.npcs && sim.npcs[cid] && typeof sim.npcs[cid].name === "string") {
      controlledNames = [sim.npcs[cid].name];
    }
  } catch (_) {}
  return {
    inputText: text,
    presentIds,
    inputNames: target ? [target] : [],
    controlledNames,
    nowBeat: Number.isInteger(sim.journalBeat) ? sim.journalBeat : 0,
  };
}

// The computed slice: top-k journal events as FACTS. ctx: {inputText,
// presentIds, inputNames, controlledNames, nowBeat} — buildSystemPrompt
// passes the live turn context. Deterministic: same (journal, ctx) => same
// string. PURE (no cooldown marking), so prompt builders and replay
// verifiers can call it any number of times. Never throws (a broken slice
// must not break the prompt).
export function renderFacts(sim, ctx) {
  try {
    const picked = topK(sim, SCHED_K_DEFAULT, ctx);
    if (!picked.length) return "(quiet beat — no new developments)";
    const lines = picked.map(eventLine);
    // Entry-boundary fit: newest-picked first that fit the budget (same
    // newest-wins discipline as chronicleBlock/coreBlock).
    let out = lines.join(" | ");
    if (out.length > FACTS_BUDGET) {
      out = "";
      for (let i = lines.length - 1; i >= 0; i--) {
        const cand = lines[i] + (out ? " | " + out : "");
        if (cand.length > FACTS_BUDGET) break;
        out = cand;
      }
    }
    return out || lines[lines.length - 1].slice(0, FACTS_BUDGET);
  } catch (_) {
    return "(slice unavailable)";
  }
}

// Runtime anti-repeat: select exactly what the prompt showed, then start
// cooldowns on those events so the NEXT beat surfaces something else.
// Called by callRealityEngine AFTER measuring (measurePrompt exact-mode
// replay must see the unmarked journal), and by the soak harness to model
// real turns. Deterministic: same (journal, input) => same picks, same
// cooldowns — rerun-safe. Never throws. Returns the picked events.
export function selectAndMark(sim, currentInput) {
  try {
    const ctx = factsContext(sim, currentInput);
    const picked = topK(sim, SCHED_K_DEFAULT, ctx);
    markShown(picked, ctx.nowBeat);
    return picked;
  } catch (_) {
    return [];
  }
}


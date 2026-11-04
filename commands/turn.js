// Turn engine: busy flag, streaming runTurn, command router, /swap (Gate 6).
// Split from src/app.js: bodies moved verbatim; bare state refs now read the
// shared session. Dynamic engine/personality imports use ../ paths (same
// modules, fixed relative location). doSwap IS the /swap command handler; the
// pure state surgery it calls lives in state/swap.js.
import { session, persist } from "../state/store.js";
import { $, escH, uid } from "../ui/dom.js";
import { pushLog, renderLog, formatNarrative } from "../ui/log.js";
import { renderAll, sysMsg } from "../ui/hud.js";
import { parseCommand } from "./parse.js";
import { doPay, neutralizePaidDeltas } from "./pay.js";
import { applySwap } from "../state/swap.js";
import { callRealityEngine, splitNarrativeAndPatch, applyPatch, headerString, resolvePersonKey, stripSceneBlock, creditRecurringIncome, prunePaidBills, SKIP_MAX_MIN } from "../engine.js";
import { hideSuggest } from "../ui/suggest.js";

export function setBusy(b, msg) {
  session.busy = b;
  $("sendBtn").disabled = b; $("actionInput").disabled = b;
  const ind = $("typingInd");
  ind.hidden = !b;
  if (b) ind.querySelector(".tmsg").textContent = msg || "দুনিয়া ভাবছে…";
}
export async function runTurn(playerText, command, opts = {}) {
  if (!session.sim || session.busy) return;
  setBusy(true, opts.loadingMsg);
  // show player turn immediately
  pushLog("player", playerText, "", headerString(session.sim));
  renderLog(); await persist();
  // streaming bubble
  const streamId = uid("st_");
  const box = $("narrativeCtn");
  box.insertAdjacentHTML("beforeend", `<div class="turn world streaming" id="${streamId}"><div class="who">🌏 দুনিয়া <span class="blink">লিখছে…</span></div><div class="whead">${escH(headerString(session.sim))}</div><div class="wbody stream-body"></div></div>`);
  box.scrollTop = box.scrollHeight;
  let streamed = "";
  try {
    const raw = await callRealityEngine(session.sim, playerText, command, (d) => {
      streamed = d.fullTextSoFar || "";
      const body = document.querySelector(`#${CSS.escape(streamId)} .stream-body`);
      // Anti-hallucination: never show the @@SCENE@@ scratchpad while streaming (strip incl. partial).
      if (body) { const preState = String(streamed).split("@@STATE@@")[0]; const clean = stripSceneBlock(preState); body.innerHTML = formatNarrative(clean) || `<span class="blink">…</span>`; box.scrollTop = box.scrollHeight; }
    });
    const { narrative, patch } = splitNarrativeAndPatch(raw);
    // M2/M19: /pay money guards (pure helper) + C6 skip clamp, then apply.
    neutralizePaidDeltas(patch, opts, command);
    applyPatch(session.sim, patch, opts.isSkip);
    // Issue #01: top-up advances through the same income-credit moment as patch time.
    // Documented choice: top-up credits income immediately (never lost, never
    // double-credited — creditRecurringIncome advances lastPaidDay idempotently);
    // decay is NOT re-applied to the landing stats (D2 routine-survival).
    if (opts.isSkip && command && typeof command.minutes === "number") {
      const want = Math.max(5, Math.min(SKIP_MAX_MIN, Math.round(command.minutes)));
      const got = patch.time_advance_minutes || 0;
      if (got < want) {
        const { advanceTime: adv } = await import("../engine.js");
        adv(session.sim, want - got);
        try { creditRecurringIncome(session.sim); prunePaidBills(session.sim, 30); } catch (_) {}
      }
    }
    document.getElementById(streamId)?.remove();
    pushLog("world", narrative, formatNarrative(narrative), headerString(session.sim));
    renderAll(); await persist();
  } catch (e) {
    document.getElementById(streamId)?.remove();
    pushLog("world", "দুনিয়া মুহূর্তে থমকে গেল। (AI ত্রুটি — আবার চেষ্টা করো)", formatNarrative("হঠাৎ সব থেমে গেল — যেন সময় আটকে গেছে। একটু পরে আবার চেষ্টা করো।"), headerString(session.sim));
    console.error(e);
    renderAll(); await persist();
  } finally { setBusy(false); $("actionInput").focus(); }
}
export async function handleSubmit() {
  const inp = $("actionInput");
  const text = inp.value.trim();
  if (!text || session.busy || !session.sim) return;
  inp.value = ""; hideSuggest();
  const cmd = parseCommand(text);
  if (!cmd) { runTurn(text, null); return; }
  if (cmd.type === "help") { showHelp(); return; }
  if (cmd.type === "unknown") {
    pushLog("world", `অজানা কমান্ড। /help লেখো।`, formatNarrative(`কমান্ডটা চেনা গেল না। **/help** লিখে তালিকা দেখো।`), headerString(session.sim));
    renderAll(); await persist(); return;
  }
  if (cmd.type === "talk") {
    if (!cmd.target) { sysMsg("কার সঙ্গে কথা বলবে? যেমন: /talk মালতী"); return; }
    // BUG3: grounded contact — no teleport. Present => talk now; off-screen => call/seek without auto-travel.
    let _isPresent = false;
    try {
      const _hit = resolvePersonKey(session.sim, String(cmd.target).trim());
      const _nid = _hit && _hit.npc ? _hit.npc.id : null;
      _isPresent = !!(_nid && Array.isArray(session.sim.world.present) && session.sim.world.present.includes(_nid));
    } catch (_) {}
    if (_isPresent) {
      runTurn(`(কমান্ড /talk) আমি সামনে উপস্থিত ${cmd.target}-এর সঙ্গে কথা বললাম।`, cmd, { loadingMsg: "কথা শুরু হচ্ছে…" });
    } else {
      let _hasPhone = false;
      try { _hasPhone = (session.sim.inventory || []).some((it) => /ফোন|মোবাইল|স্মার্টফোন/i.test(String(it.name || ""))); } catch (_) {}
      const _prompt = _hasPhone
        ? `(কমান্ড /talk) আমি ${cmd.target}-এর সঙ্গে কথা বলতে চাই। সে এখন এই ঘরে নেই — হাতে ফোন আছে, তাই ফোন করে যোগাযোগের চেষ্টা করলাম (ঘরে টেনে আনা নয়, যাত্রা শেষ নয়)।`
        : `(কমান্ড /talk) আমি ${cmd.target}-এর সঙ্গে কথা বলতে চাই। সে এখন এই ঘরে নেই — দেখা করতে বেরোনোর প্রস্তুতি নিলাম (টেলিপোর্ট নয়, যাত্রা শেষ নয়)।`;
      runTurn(_prompt, cmd, { loadingMsg: "যোগাযোগের চেষ্টা হচ্ছে…" });
    }
    return;
  }
  if (cmd.type === "skip") {
    const mins = cmd.minutes || 60;
    runTurn(`(কমান্ড /skip) ${mins} মিনিট সময় কেটে গেল — এই সময়ে আমি সাধারণ রুটিনে ছিলাম, গুরুত্বপূর্ণ সিদ্ধান্ত নিইনি। আশপাশে কী ঘটল বর্ণনা করো।`, cmd, { isSkip: true, loadingMsg: "সময় এগোচ্ছে…" });
    // force the model's advance toward requested duration (applied inside applyPatch via patch, but nudge: pre-advance half? No — let model propose, then top-up)
    return;
  }
  if (cmd.type === "swap") {
    if (!cmd.target) { sysMsg("কার দৃষ্টিতে যাবে? যেমন: /swap নাসিমা"); return; }
    doSwap(cmd.target);
    return;
  }
  if (cmd.type === "pay") {
    if (!cmd.target) { sysMsg("কোন বিল? যেমন: /pay ঘর ভাড়া"); return; }
    doPay(cmd.target);
    return;
  }
}
export function showHelp() {
  const t = `কমান্ড তালিকা:\n\n— /talk [নাম] — ওই চরিত্রের সঙ্গে কথা বলো।\n— /skip [সময়] — সময় এগিয়ে নাও (যেমন /skip ৩০ মিনিট, /skip ২ ঘণ্টা, /skip ১ দিন)।\n— /swap [নাম] — ওই চরিত্রের চোখে খেলো।\n— /pay [বিল] — বিল পরিশোধ করো।\n\nসাধারণ কাজ সরাসরি লেখো — যেমন: আমি চায়ের দোকানে গিয়ে একটা চা অর্ডার করলাম।`;
  pushLog("world", t, formatNarrative(t), headerString(session.sim));
  renderAll(); persist();
}
export async function doSwap(target) {
  const q = String(target || "").trim();
  if (!q) { sysMsg("কার দৃষ্টিতে যাবে? যেমন: /swap নাসিমা"); return; }
  const res = applySwap(session.sim, q);
  if (!res || !res.ok) { sysMsg(res && res.message ? res.message : "কার দৃষ্টিতে যাবে? যেমন: /swap নাসিমা"); return; }
  try { if (session.sim.world && typeof session.sim.world === "object") session.sim.world.phoneCall = null; } catch (_) {}
  // BUG6: off-screen entry grounds in real whereabouts (applySwap keeps present=[] for sync compat).
  let _where = "";
  try {
    if (res && res.wasTargetPresent === false) {
      const _ctl = Object.values(session.sim.npcs || {}).find((n) => n && n.controlled);
      const _d = _ctl && _ctl.mind && typeof _ctl.mind.doing === "string" ? _ctl.mind.doing.trim() : "";
      if (_d && _d !== "নিজের দৈনন্দিন কাজে ব্যস্ত।") _where = _d.slice(0, 120);
    }
  } catch (_) {}
  pushLog("world", "দৃষ্টি বদল: এখন তুমি " + session.sim.persona.name + "। তুমি শুধু ওর চোখে দেখো, ওর কানে শোনো, ও যা জানে তা-ই জানো।", formatNarrative("দৃষ্টি বদলে গেল।\n\nএখন থেকে তুমি **" + session.sim.persona.name + "**। আগের জীবনটা পেছনে রইল — সামনে নতুন চোখ, নতুন সীমা।"), headerString(session.sim));
  renderAll(); await persist();
  // opening beat for the new eyes
  runTurn("(কমান্ড /swap) আমি " + session.sim.persona.name + " — এই মুহূর্তে চারপাশে কী দেখছি, কী শুনছি, শরীরটা কেমন লাগছে, বর্ণনা করো।" + (_where ? " সে আগে " + _where + " — এই বাস্তব অবস্থান থেকে দৃশ্য শুরু করো, মানানসই location/location_facts/scene_present JSON-এ দাও।" : ""), { type: "swap", target: q });
}


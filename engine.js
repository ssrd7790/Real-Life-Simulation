// Reality Engine: prompt building, LLM call, structured patch parsing/application.
import { CITIES } from "./presets.js";
import { npcPsychBlock, validateTraits, validateStates, validateMindChunk, migrateNpc, normalizeNpcAge, shouldIncludeRomance, isConfirmedAdult, isMinorNpc, baseStates, STATE_KEYS, MINOR_LUST_VALUE, MINOR_DESIRE_VALUE, WORLD_PULSE_MAX, CONDITION_MAX, CONDITION_TEXT_MAX, EXPERIENCE_MAX, EXPERIENCE_TEXT_MAX, LOC_FACTS_MAX, defaultLocationFacts } from "./personality.js";
import { selectRules, renderRulebook, validateRuleCosts, alwaysOnIntact } from "./rules/registry.js";
import { selectSchemaFields, renderSchema } from "./rules/schema.js";
import { renderFacts, FACTS_BUDGET, FACTS_LABEL, factsContext, selectAndMark } from "./render/context.js";
import { retrieve, buildRetrievalQuery } from "./memory/retrieval.js";
import { dormantLine, rosterEntry, renderExtras, buildArchive, eventsForNpc, SUM_EXTRAS_ROSTER_HEADER, SUM_EXTRAS_ONELINER_HEADER } from "./memory/summarize.js";
import { runPipeline } from "./apply/pipeline.js";
import { advanceCalendar } from "./core/time.js";
import { creditIncome } from "./core/economy.js";

const R = () => globalThis.root;

// v2: long-run integrity budgets (R1/R2/R5). All prompt blocks are capped so the
// per-turn system prompt stays flat. Measured ceilings (Issues #11):
// system <= 17,500 chars, user history <= 6,000 chars.
export const V2_CHRON_MAX_SIM = 120;      // chronicle entries kept in save
const V2_CHRON_PROMPT_N = 40;      // chronicle entries offered to prompt (then char-budgeted)
const V2_CHRON_BUDGET = 700;       // chars of chronicle text in prompt (cut 1100->900 for SCENE/locationFacts headroom)
const V2_CORE_BUDGET = 300;        // chars of core memories in prompt (cut 400->300 for grounding headroom)
export const V2_LONGTERM_CAP = 200;       // longTerm entries kept (was unbounded)
export const V2_CORE_MAX_SIM = 30;        // core memories kept in save
const V2_DOSSIER_N = 6;            // NPC dossiers in prompt (ranked; Gate 4: 8->6 — the scored FACTS slice now carries off-screen news, so fewer full psych dossiers are needed)
const V2_CAST_MAX = 16;            // NPCs listed in CAST census
const V2_BILL_PROMPT_N = 8;        // unpaid bills shown in prompt
const V2_REL_PROMPT_N = 12;        // relationships shown in prompt
const V2_STORY_PROMPT_N = 6;       // active storylines shown in prompt
export const SKIP_MAX_MIN = 7 * 24 * 60;  // v2: /skip cap raised to 7 days (was 24h; README promises 7d)

// Issue #11: hard measured ceilings enforced on final strings (tunable in one place).
// Why: per-turn cost/latency must stay flat on arbitrarily long runs. Trim order
// (lowest priority first): faded echoes -> excess inventory/relationship tail ->
// oldest chronicle tail beyond its own budget -> dossier count. Never trimmed:
// rulebook, current stats/money/location, targeted NPC dossier (Issue #12).
export const SYSTEM_PROMPT_MAX_CHARS = 17500;
export const USER_HISTORY_MAX_CHARS = 6000;
export const DOSSIER_TOTAL_BUDGET = 4000;   // all dossiers combined in prompt
export const CAST_BUDGET = 600;             // CAST line total
export const REL_BUDGET = 250;            // relationships line total (cut 600->400 for grounding headroom)
export const BILLS_BUDGET = 350;            // bills line total
export const STORY_BUDGET = 250;            // storylines line total
export const SHORTMEM_BUDGET = 500;         // recent short-term memories in prompt (cut 1200->800 for grounding headroom)
export const INV_PROMPT_BUDGET = 350;       // inventory line in prompt
export const PULSE_BUDGET = 220;            // world pulse line in prompt
export const COND_PROMPT_BUDGET = 250;      // conditions line in prompt
export const EXP_PROMPT_BUDGET = 250;       // experiences line in prompt
export const FADED_ECHOES_BUDGET = 300;      // faded-echoes line in prompt (was an inline literal; same value)
// Gate 1 floor: the maximal fixture's total system headroom must stay above
// this many chars. Named (not magic) so any future attempt to lower it is a
// visible contract change. NOTE: current maximal headroom is far below this
// (see docs/prompt-budget.md) — the ceilings test reports that honestly.
export const MIN_SYSTEM_HEADROOM = 300;

// Issue #01: skip decay assumes routine survival (eating/drinking/sleeping).
// Why 8h: one waking day's worth of passive drift; landing stats stay plausible
// while hot-state cooling still visibly applies for untouched NPCs.
export const SKIP_DECAY_MAX_HRS = 8;
// Issue #10: plausibility rails (relative/class-aware, never flat rupee caps).
// Why these: normal beats move stats gradually (25 allows believable swings but
// blocks 5->100 teleports); skips allow wider arcs (60); trust builds slowly.
export const STAT_MAX_STEP_NORMAL = 25;
export const STAT_MAX_STEP_SKIP = 60;
export const REL_MAX_STEP = 15;             // per-turn trust/familiarity movement
export const WINDFALL_BASE_THRESHOLD = 100000; // extraordinary windfall scrutiny
export const WINDFALL_WEALTH_MULT = 2;      // scale-aware: threshold = max(base, wealth*mult)
export const SATIETY_ZERO_DRAIN_PER_HR = 1.0;  // health erosion when satiety lands 0
export const ENERGY_ZERO_DRAIN_PER_HR = 1.0;   // health erosion when energy lands 0
// R3: fractional drain accumulator + daily cap (tunable in one place).
// Why: per-patch Math.round loses sub-1 drains on 3–20 min beats (0.33 → 0), so
// starving across normal turns never erodes; uncapped 24 h zero/zero (48 raw)
// collapses 70→22 in one skip. Accumulator preserves fractions; daily cap keeps
// the worst full-day neglect survivable (~12) instead of instantly critical.
export const PHYS_DRAIN_DAILY_CAP = 12;        // max physiology health loss per 24 sim-hours
export const HEALTH_RECOVERY_THRESHOLD = 20;   // critical clears when health rises above this
// Issue #13: save-hygiene caps (conservative, canon-safe; merge->compact->drop).
export const PATCH_MAX_SHORT_ADD = 10;
export const PATCH_MAX_CHRON_ADD = 3;
export const PATCH_MAX_CORE_ADD = 2;
export const PATCH_MAX_STORY_ADD = 5;
export const PATCH_MAX_INV_ADD = 10;
export const PATCH_MAX_BILLS_ADD = 5;
export const PATCH_MAX_NPCS_ADD = 5;
export const PATCH_MAX_NPC_MEM_PER_KEY = 5;
export const PATCH_MAX_EXIT = 10;
// Living World: organic flood caps (tunable in one place).
export const PATCH_MAX_CONDITIONS_ADD = 3;   // body/mind conditions per turn
export const PATCH_MAX_CONDITIONS_REMOVE = 3; // condition clears per turn
export const PATCH_MAX_EXPERIENCES_ADD = 2;  // lived competences per turn
export const PATCH_MAX_OFFSCREEN_ADD = 5;    // off-screen events per turn
export const PATCH_MAX_MIND_KEYS = 20;       // npc_mind entries per turn (safety cap)
export const STORYLINES_MAX_SIM = 50;
export const REL_MAX_SIM = 100;
export const INV_MAX_DISTINCT = 120;
export const NPC_COMPACT_AFTER_DAYS = 90;   // inactivity age for memory compaction
export const NPC_MEMORY_COMPACT_KEEP = 5;   // recent memory lines kept after compaction
export const NPC_MEMORY_MAX = 20;           // per-NPC memory lines kept normally
// M5: per-line prompt caps so one unbounded input/history line cannot break the
// USER_HISTORY_MAX_CHARS ceiling (mirrors the WORLD-line 1500 cap).
export const USER_PLAYER_INPUT_MAX = 1500;    // PLAYER INPUT NOW tail cap
export const USER_HISTORY_LINE_MAX = 1500;    // each PLAYER history line cap

// Gate 2: validate declared rule-pack costs once at load (throws on drift
// >32 chars, keeping the budget ledger honest). Runs here — after all
// constants above are initialized — so text() interpolation is exact.
validateRuleCosts({ scope: "full", consts: { HEALTH_RECOVERY_THRESHOLD } });

export const EMOTION_LABEL = { anger: "রাগান্বিত", fear: "ভীত", sadness: "বিষণ্ণ", joy: "উৎফুল্ল", desire: "আকৃষ্ট", suspicion: "সন্দেহপ্রবণ", stress: "চাপে", affection: "স্নেহশীল" };

export function fmtTime(min) {
  min = ((min % 1440) + 1440) % 1440;
  let h = Math.floor(min / 60), m = min % 60;
  // M16: Bengali meridiem — no Latin "AM"/"PM" may reach the HUD, status bar,
  // log headers or prompt. Return shape unchanged (still "h:mm label").
  const ap = h >= 12 ? "অপরাহ্ণ" : "পূর্বাহ্ণ";
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

export function bnDigits(n) {
  const d = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  return String(n).replace(/[0-9]/g, (c) => d[+c]);
}

// Anti-hallucination: deterministic time-of-day + lighting truth (JS-computed).
// Maps 0..1439 into explicit Bengali phases so the model never invents daylight
// at midnight or streetlights at noon. Injected into the Calendar state line.
export function dayPhaseLabel(timeMin) {
  const t = ((Math.round(timeMin) % 1440) + 1440) % 1440;
  if (t >= 270 && t < 360) return "ভোর (আলো ফুটছে)";
  if (t >= 360 && t < 660) return "সকাল (দিনের আলো)";
  if (t >= 660 && t < 900) return "দুপুর (কড়া রোদ)";
  if (t >= 900 && t < 1050) return "বিকেল (নরম রোদ)";
  if (t >= 1050 && t < 1230) return "সন্ধ্যা (বাতি জ্বলছে)";
  return "গভীর রাত (ঘুটঘুটে অন্ধকার)";
}

// Anti-hallucination: strip the @@SCENE@@ verification tag so narrative is pure
// Bengali story text. Handles full, partial, and unclosed tags (streaming cuts).
export function stripSceneBlock(s) {
  let out = String(s ?? "");
  out = out.replace(/@@SCENE@@[\s\S]*?@@\/SCENE@@/g, "");
  // C5: an unclosed @@SCENE@@ is stripped to end-of-line ONLY when the tag
  // opens a SCENE-looking line (pipe / উপস্থিত / সময় markers). A tag sharing
  // a line with plain narrative keeps the narrative text (canon over scratch).
  out = out.replace(/@@SCENE@@[^\n]*/g, (m) => (/[|]/.test(m) || /উপস্থিত|সময়/.test(m) ? "" : m.slice("@@SCENE@@".length)));
  out = out.replace(/@@SCENE@@/g, "");
  out = out.replace(/@@\/SCENE@@/g, "");
  // Streaming flicker guard: strip a trailing incomplete tag prefix
  // ("@@SC" / "@@SCENE" / "@@STATE" ...) left mid-chunk before the full token
  // arrives — but ONLY at a genuine token boundary (start of string, or after
  // whitespace/newline) and at least "@@" long. A lone trailing "@" (email /
  // handle) or "@@" glued to a word is legitimate narrative and must survive,
  // which also makes the email guard below reachable (C5).
  try {
    const tags = ["@@/SCENE@@", "@@SCENE@@", "@@STATE@@", "@@END@@", "@@/SCENE"];
    const _atBoundary = (pos) => pos === 0 || /[\s\u200B-\u200D\uFEFF]/.test(out[pos - 1]);
    let stripped = true;
    while (stripped) {
      stripped = false;
      for (const tag of tags) {
        for (let len = tag.length - 1; len >= 2; len--) {
          const pre = tag.slice(0, len);
                    if (pre && out.endsWith(pre) && _atBoundary(out.length - pre.length)) {
            out = out.slice(0, out.length - pre.length);
            stripped = true;
            break;
          }
        }
        if (stripped) break;
      }
      // lone "@" tail (common first streaming chunk)
      if (!stripped && /@\s*$/.test(out)) {
        // Only strip if the "@" looks like a tag start (at string start or
        // preceded by whitespace/newline, not an email-like foo@bar).
        const m = out.match(/(\s|^)@\s*$/);
        if (m) { out = out.replace(/@\s*$/, ""); stripped = true; }
        else break;
      }
    }
    // Leading incomplete prefix at the very start (stream opened mid-tag).
    out = out.replace(/^@(?:@(?:\/(?:S(?:C(?:E(?:N(?:E(?:@(?:@?)?)?)?)?)?)?)?|S(?:C(?:E(?:N(?:E(?:@(?:@?)?)?)?)?)?)?|S(?:T(?:A(?:T(?:E(?:@(?:@?)?)?)?)?)?)?|E(?:N(?:D(?:@(?:@?)?)?)?)?)?)?\s*/, "");
  } catch (_) {}
  return out.trim();
}

function truncPrompt(s) {
  return String(s ?? "").replace(new RegExp(String.fromCharCode(64,64), "g"), "--").slice(0, 2000);
}
// M6: per-field prompt sanitizer - length-cap, scratch-marker neutralization,
// newline folding (single-line dossier/CAST entries keep line structure).
function cleanPromptStr(s, max) {
  let out = String(s ?? "").replace(new RegExp(String.fromCharCode(64,64), "g"), "--");
  out = out.split(String.fromCharCode(13,10)).join(" ").split(String.fromCharCode(13)).join(" ").split(String.fromCharCode(10)).join(" ").trim();
  if (out.length > max) out = out.slice(0, max);
  return out;
}

// v2 (R4): normalized name compare for dedupe (case/space/zero-width insensitive).
export function normName(s) {
  return String(s ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

// M17: boundary-aware hard cut — never truncate mid-sentence/mid-entry.
// Backtracks to the last newline, then Bengali dari, then space; the 40%
// floor keeps pathological no-boundary strings from collapsing to nothing.
export function cutAtBoundary(s, max) {
  const t = String(s ?? "");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const nl = cut.lastIndexOf("\n");
  if (nl > max * 0.4) return cut.slice(0, nl);
  const dari = cut.lastIndexOf("।");
  if (dari > max * 0.4) return cut.slice(0, dari + 1);
  const sp = cut.lastIndexOf(" ");
  if (sp > max * 0.4) return cut.slice(0, sp);
  return cut;
}

// C1: centralized prototype-pollution guard (single source of truth).
// Plain {} maps inherit from Object.prototype; model-supplied keys are untrusted.
// Every map access in this file (and personality.js/app.js via these helpers)
// must go through hasOwn/safeGet/safeSet + isValidPatchKey.
export const RESERVED_KEYS = new Set([
  "__proto__", "constructor", "prototype",
  "toString", "toLocaleString", "valueOf",
  "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
  "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
]);
export function isReservedKey(k) {
  try {
    if (typeof k !== "string") return true;
    if (RESERVED_KEYS.has(k)) return true;
    // Any other inherited Object.prototype member (future-proof).
    if (k in Object.prototype) return true;
    if (k.includes("__proto__")) return true;
    return false;
  } catch (_) { return true; }
}
// Allowlist for model-supplied person/bill keys: stable latin ids (korim, r_korim,
// npc_<id>, c_<key>, b1, s1) plus Bengali human names. Rejects reserved keys,
// empty/whitespace/zero-width keys, over-long keys and injection punctuation.
export function isValidPatchKey(k) {
  try {
    if (typeof k !== "string") return false;
    const t = String(k).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
    if (!t || t.length > 80) return false;
    if (isReservedKey(t)) return false;
    if (t.includes("@@")) return false;
    if (!/^[A-Za-z0-9_\-. \u0980-\u09FF()—–,'"/]+$/.test(t)) return false;
    return true;
  } catch (_) { return false; }
}
export function hasOwn(obj, k) {
  try {
    if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return false;
    if (typeof k !== "string") return false;
    return Object.prototype.hasOwnProperty.call(obj, k);
  } catch (_) { return false; }
}
export function safeGet(obj, k) {
  try {
    if (!obj || typeof k !== "string") return undefined;
    if (isReservedKey(k)) return undefined;
    return hasOwn(obj, k) ? obj[k] : undefined;
  } catch (_) { return undefined; }
}
export function safeSet(obj, k, v) {
  try {
    if (!obj || typeof k !== "string") return false;
    if (!isValidPatchKey(k)) { console.warn("[people] rejected unsafe map key:", String(k).slice(0, 40)); return false; }
    obj[k] = v;
    return true;
  } catch (_) { return false; }
}
export function isFiniteNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
// C3: tolerant memory-entry text (legacy saves/imports may hold plain-string,
// null, or object entries). Never throws, never renders "[object Object]".
export function shortMemText(m) {
  try {
    if (m == null) return "";
    if (typeof m === "string") return m;
    if (typeof m === "object") {
      const t = m.text;
      if (typeof t === "string") return t;
      if (t == null) return "";
      return isFiniteNum(t) ? String(t) : "";
    }
    return isFiniteNum(m) ? String(m) : "";
  } catch (_) { return ""; }
}

// Issue #02: id-shaped keys (stable latin ids like korim/r_korim) must never become
// display names. Why: the CAST line lists stable ids so the model naturally sends
// ids; creating a person named "korim" duplicates the real করিম চাচা record.
export function isIdShaped(key) {
  const t = String(key ?? "").trim();
  if (!t) return false;
  if (/[\u0980-\u09FF]/.test(t)) return false; // Bengali script = human name
  if (/\s/.test(t)) return false; // spaces = human name
  return /^[A-Za-z0-9_\-]+$/.test(t);
}

// v2 (R3): calendar. 1 sim year = 12 x 30 = 360 days. dayCount starts at 1.
export function simYear(sim) {
  const dc = Math.max(1, Math.round(sim?.world?.dayCount || 1));
  return Math.floor((dc - 1) / 360) + 1;
}
export function monthOf(sim) {
  const m = parseInt(String(sim?.world?.date || "15/08").split("/")[1], 10);
  return (m >= 1 && m <= 12) ? m : 8;
}
// v2 (R3): month -> Bengali season.
export function seasonForMonth(m) {
  if (m === 3 || m === 4) return "বসন্ত";
  if (m === 5 || m === 6) return "গ্রীষ্ম";
  if (m === 7 || m === 8) return "বর্ষা";
  if (m === 9 || m === 10) return "শরৎ";
  if (m === 11 || m === 12) return "হেমন্ত";
  return "শীত"; // 1, 2
}
// v2 (R3): JS-computed current age. baseAge/baseDay backfilled by migrateSim for old saves.
export function currentAge(sim) {
  const p = sim?.persona || {};
  const baseAge = isFiniteNum(p.baseAge) ? Math.round(p.baseAge) : (Math.round(p.age) || 25);
  const baseDay = isFiniteNum(p.baseDay) ? Math.round(p.baseDay) : 1;
  const dc = Math.max(1, Math.round(sim?.world?.dayCount || 1));
  return Math.max(18, baseAge + Math.floor(Math.max(0, dc - baseDay) / 360));
}

// v2 (R5): class/city-appropriate price anchors so amounts stay believable across years.
function priceAnchors(sim) {
  const dhaka = sim.city === "dhaka";
  const cur = dhaka ? "৳" : "₹";
  const rent = sim.city === "mumbai" ? `ঘর ভাড়া ${cur}15000-60000/মাস` : dhaka ? `ঘর ভাড়া ${cur}4000-15000/মাস` : `ঘর ভাড়া ${cur}2500-8000/মাস`;
  return `চা ${cur}10-15, ভাত-ডাল ${cur}80-150, দিনমজুরি ${cur}500-800/দিন, ${rent}`;
}

// v2 (R5): recurring-income prompt line.
function incomeLine(sim) {
  const inc = sim.income;
  const cur = CITIES[sim.city] ? CITIES[sim.city].currency : "₹";
  if (!inc || typeof inc !== "object" || !(inc.amount > 0) || !(inc.cadence_days >= 1)) return "Recurring income: none";
  const last = Math.round(inc.lastPaidDay ?? sim.world.dayCount);
  const next = last + Math.round(inc.cadence_days);
  return `Recurring income: ${String(inc.source || "income").slice(0, 60)} +${Math.round(inc.amount)}${cur} every ${Math.round(inc.cadence_days)}d (last paid Day ${last}, next Day ${next}). JS auto-credits on payday — do NOT also send cash_delta for the same payday.`;
}

// v2 (R1): chronicle block — newest entries kept on entry boundaries, never cut mid-sentence.
function chronicleBlock(sim, budget = V2_CHRON_BUDGET) {
  const ch = Array.isArray(sim.chronicle) ? sim.chronicle : [];
  if (!ch.length) return "(empty — no lasting consequences yet)";
  const tail = ch.slice(-V2_CHRON_PROMPT_N);
  const lines = tail.map((e) => `[D${e.day ?? "?"} ${e.date ?? ""}] ${e.text || ""}`);
  let out = lines.join(" | ");
  if (out.length > budget) {
    // keep the most recent whole entries that fit the budget (newest-canon-last-dropped)
    out = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      const cand = lines[i] + (out ? " | " + out : "");
      if (cand.length > budget) break;
      out = cand;
    }
  }
  return out || "(empty — no lasting consequences yet)";
}
// Issue #11: coreBlock honours its named budget on entry boundaries (no mid-sentence cut).
function coreBlock(sim, budget = V2_CORE_BUDGET) {
  const core = Array.isArray(sim?.memories?.core) ? sim.memories.core : [];
  // C3: tolerate legacy string/null/object entries (never "[object Object]").
  const lines = core.map((x) => shortMemText(x)).filter((s) => s && s.trim());
  if (!lines.length) return "(none)";
  let out = lines.join(" | ");
  if (out.length > budget) {
    out = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      const cand = lines[i] + (out ? " | " + out : "");
      if (cand.length > budget) break;
      out = cand;
    }
  }
  return out || lines[lines.length - 1].slice(0, budget);
}
// v2 (R1): longTerm sampled as vague non-canon faded echoes, budgeted, entry-boundary.
function fadedEchoes(sim) {
  const lt = Array.isArray(sim?.memories?.longTerm) ? sim.memories.longTerm : [];
  if (!lt.length) return "(none)";
  // C3: tolerate legacy string/null/object entries (never "[object Object]").
  const pick = lt.slice(-3).map((e) => shortMemText(e)).filter((s) => s && s.trim());
  if (!pick.length) return "(none)";
  let out = pick.join(" | ");
  if (out.length > FADED_ECHOES_BUDGET) {
    out = "";
    for (let i = pick.length - 1; i >= 0; i--) {
      const cand = pick[i] + (out ? " | " + out : "");
      if (cand.length > FADED_ECHOES_BUDGET) break;
      out = cand;
    }
  }
  return out || "(none)";
}

// Issue #02: one canonical people-key resolver used by ALL patch blocks.
// Accepts npc id, relationship id, exact name, normalized name; maps all to the
// same person. Preset-seeded (r_<npcId>) and engine-created relationships resolve
// identically. Returns {npc, rel} (either may be null) or null if nobody matches.
export function resolvePersonKey(sim, key) {
  if (key == null) return null;
  const ks = String(key);
  if (!ks.trim()) return null;
  const npcs = sim.npcs || {};
  const rels = sim.relationships || {};
  // direct id hits first (stable ids the model sees in CAST)
  if (!isReservedKey(ks) && hasOwn(npcs, ks)) {
    const npc = npcs[ks];
    const rel = safeGet(rels, "r_" + npc.id) || Object.values(rels).find((r) => normName(r.name) === normName(npc.name)) || null;
    return { npc, rel };
  }
  if (!isReservedKey(ks) && hasOwn(rels, ks)) {
    const rel = rels[ks];
    let npc = null;
    if (typeof rel.id === "string" && rel.id.startsWith("r_")) npc = safeGet(npcs, rel.id.slice(2)) || null;
    if (!npc) npc = Object.values(npcs).find((n) => normName(n.name) === normName(rel.name)) || null;
    return { npc, rel };
  }
  const nk = normName(ks);
  const npcHit = Object.values(npcs).find((n) => normName(n.name) === nk || normName(n.id) === nk) || null;
  if (npcHit) {
    const rel = safeGet(rels, "r_" + npcHit.id) || Object.values(rels).find((r) => normName(r.name) === normName(npcHit.name)) || null;
    return { npc: npcHit, rel };
  }
  const relHit = Object.values(rels).find((r) => normName(r.name) === nk || normName(r.id) === nk) || null;
  if (relHit) {
    let npc = null;
    if (typeof relHit.id === "string" && relHit.id.startsWith("r_")) npc = safeGet(npcs, relHit.id.slice(2)) || null;
    if (!npc) npc = Object.values(npcs).find((n) => normName(n.name) === normName(relHit.name)) || null;
    return { npc, rel: relHit };
  }
  // BUG5 tiered: honorific-stripped / first-word / word-boundary (unambiguous only).
  try {
    const qb = normBase(ks);
    if (qb && qb.length >= 2) {
      const liveList = Object.values(npcs).filter((n) => n && n.name);
      const activeList = liveList.filter((n) => !n.inactive && !n.controlled);
      // Tier 2a: honorific/case-stripped exact (active first, fallback to all only if 0 hits).
      let cands = activeList.filter((n) => normBase(n.name) === qb || normBase(n.id) === qb);
      if (cands.length === 0) cands = liveList.filter((n) => normBase(n.name) === qb || normBase(n.id) === qb);
      if (cands.length === 1) {
        const npc = cands[0];
        const rel = safeGet(rels, "r_" + npc.id) || Object.values(rels).find((r) => normName(r.name) === normName(npc.name)) || null;
        return { npc, rel };
      }
      // Tier 2b: first-word / prefix (short নাম → full সম্মানসূচক নাম).
      if (qb.length >= 3) {
        const fwPred = (n) => {
          const nb = normBase(n.name);
          if (!nb) return false;
          const first = nb.split(" ")[0];
          return first === qb || nb.startsWith(qb + " ");
        };
        let fw = activeList.filter(fwPred);
        if (fw.length === 0) fw = liveList.filter(fwPred);
        if (fw.length === 1) {
          const npc = fw[0];
          const rel = safeGet(rels, "r_" + npc.id) || Object.values(rels).find((r) => normName(r.name) === normName(npc.name)) || null;
          return { npc, rel };
        }
      }
      // Tier 3: word-boundary containment (never raw includes).
      const wcPred = (n) => {
        const nn = normName(n.name || "");
        const nb = normBase(n.name || "");
        return (nn && hasWordBoundary(nk, nn)) || (nb && qb && hasWordBoundary(qb, nb)) || (nn && hasWordBoundary(qb, nn));
      };
      let wc = activeList.filter(wcPred);
      if (wc.length === 0) wc = liveList.filter(wcPred);
      if (wc.length === 1) {
        const npc = wc[0];
        const rel = safeGet(rels, "r_" + npc.id) || Object.values(rels).find((r) => normName(r.name) === normName(npc.name)) || null;
        return { npc, rel };
      }
      // Relationship names, same tiers (unambiguous only).
      const relList = Object.values(rels);
      const rc = relList.filter((r) => normBase(r.name) === qb);
      if (rc.length === 1) {
        const rel = rc[0];
        let npc = null;
        if (typeof rel.id === "string" && rel.id.startsWith("r_")) npc = safeGet(npcs, rel.id.slice(2)) || null;
        if (!npc) npc = Object.values(npcs).find((n) => n && !n.inactive && !n.controlled && normBase(n.name) === qb) || Object.values(npcs).find((n) => normBase(n.name) === qb) || null;
        return { npc, rel };
      }
    }
  } catch (_) {}
  return null;
}
export function findLinkedRel(sim, npc) {
  if (!npc) return null;
  return safeGet(sim.relationships || {}, "r_" + npc.id) || Object.values(sim.relationships || {}).find((r) => normName(r.name) === normName(npc.name)) || null;
}

// v2 (R2): relevance score. Current input (Issue #12) outranks retrospective signals.
export function npcRelevance(npc, sim, currentInput) {
  let s = 0;
  // Issue #12: whatever/whoever the player acts on THIS turn gets the top boost tier.
  if (currentInput) {
    const txt = typeof currentInput === "string" ? currentInput : (currentInput.text || "");
    const tgt = (typeof currentInput === "object" && currentInput.target) ? String(currentInput.target) : "";
    const hay = normName(String(txt || "") + " " + tgt);
    if (hay && npc.name && hay.includes(normName(npc.name))) s += 500;
    if (hay && npc.id && hay.includes(normName(npc.id)) && normName(npc.id).length >= 2) s += 500;
    if (tgt && (normName(tgt) === normName(npc.name) || normName(tgt) === normName(npc.id))) s += 1000;
    // BUG5 short-name target: honorific-stripped exact also gets top boost.
    try {
      const tb = normBase(tgt);
      if (tb && tb.length >= 2 && npc.name && normBase(npc.name) === tb) s += 1000;
    } catch (_) {}
  }
  // BUG4: physical presence outranks retrospective familiarity/mentions.
  try {
    if (Array.isArray(sim?.world?.present) && sim.world.present.includes(npc.id)) s += 750;
  } catch (_) {}
  // BUG9: active phone interlocutor stays in dossiers across multi-turn calls.
  try {
    if (sim?.world?.phoneCall && sim.world.phoneCall === npc.id) s += 400;
  } catch (_) {}
  const recent = (sim?.memories?.shortTerm || []).slice(-6).map((m) => m.text || "").join(" \n ");
  if (recent && npc.name && recent.includes(npc.name)) s += 100;
  const logs = (sim?.log || []).slice(-4).map((t) => t.text || "").join(" \n ");
  if (logs && npc.name && logs.includes(npc.name)) s += 60;
  const loc = sim?.world?.location || "";
  if (loc && npc.name && loc.includes(npc.name)) s += 50;
  s += (Math.round(npc.familiarity) || 0) / 10 + (Math.round(npc.trust) || 0) / 20;
  return s;
}
function liveNpcs(sim) {
  // R5 flag: the currently-controlled person keeps a persistent NPC record with
  // controlled=true, but is excluded from every model-facing list exactly as if absent.
  return Object.values(sim.npcs || {}).filter((n) => !n.inactive && !n.controlled);
}
// Gate 5: resolve the player-targeted NPC id (mirrors the resolution inside
// rankedNpcs below; used to build the retrieval query). Invalid/controlled/
// inactive targets resolve to null — same guards as rankedNpcs.
function targetIdFor(sim, currentInput) {
  try {
    if (currentInput && typeof currentInput === "object" && currentInput.target) {
      const hit = resolvePersonKey(sim, String(currentInput.target).trim());
      if (hit && hit.npc && !hit.npc.inactive && !hit.npc.controlled) return hit.npc.id;
    }
  } catch (_) {}
  return null;
}
// Gate 5: run retrieval for one prompt build. Returns { dossierNpcs, extras }.
// extras is the pre-rendered dormant/roster appendix ("" when nobody is
// omitted — the V3 byte-identity guarantee). opts.retrieval === false selects
// the legacy path (rankedNpcs, no extras) for A/B measurement only.
function retrieveForPrompt(sim, currentInput, opts) {
  const useRet = !opts || opts.retrieval !== false;
  if (!useRet) {
    return { dossierNpcs: rankedNpcs(sim, V2_DOSSIER_N, currentInput), extras: "" };
  }
  let query = null;
  try {
    query = buildRetrievalQuery(sim, currentInput);
    query.targetId = targetIdFor(sim, currentInput);
  } catch (_) { query = { text: "", target: "", targetId: null, type: null }; }
  let ret = null;
  try {
    ret = retrieve(sim, query, { topN: V2_DOSSIER_N, legacyOrder: (n) => rankedNpcs(sim, n, currentInput) });
  } catch (_) { ret = null; }
  if (!ret || !Array.isArray(ret.detailed)) {
    return { dossierNpcs: rankedNpcs(sim, V2_DOSSIER_N, currentInput), extras: "" };
  }
  let extras = "";
  try {
    const journal = Array.isArray(sim.journal) ? sim.journal : [];
    const lines = (ret.summarized || []).map((n) => dormantLine(n, sim, journal)).filter((s) => s);
    const ros = (ret.roster || []).map((n) => rosterEntry(n, sim, journal)).filter((s) => s);
    extras = renderExtras(lines, ros, ret.moreCount || 0);
  } catch (_) { extras = ""; }
  return { dossierNpcs: ret.detailed, extras };
}
// v2 (R2): relevance-ranked NPCs, top N. Deterministic tie-break (id) so prompts
// don't jitter turn-to-turn. Guarantees an explicitly targeted live NPC a slot.
export function rankedNpcs(sim, n, currentInput) {
  const live = liveNpcs(sim);
  const scored = live.map((npc) => ({ npc, s: npcRelevance(npc, sim, currentInput) }));
  scored.sort((a, b) => (b.s - a.s) || (a.npc.id < b.npc.id ? -1 : a.npc.id > b.npc.id ? 1 : 0));
  // BUG4: live in-room + explicit target retained ahead of OFF-SCREEN.
  let targetId = null;
  try {
    if (currentInput && typeof currentInput === "object" && currentInput.target) {
      const hit = resolvePersonKey(sim, String(currentInput.target).trim());
      if (hit && hit.npc && !hit.npc.inactive && !hit.npc.controlled) targetId = hit.npc.id;
    }
  } catch (_) {}
  let presentSet = null;
  try { presentSet = new Set(Array.isArray(sim?.world?.present) ? sim.world.present : []); } catch (_) { presentSet = new Set(); }
  const guaranteed = scored.filter((x) => presentSet.has(x.npc.id) || (targetId && x.npc.id === targetId));
  const others = scored.filter((x) => !(presentSet.has(x.npc.id) || (targetId && x.npc.id === targetId)));
  let top = [...guaranteed, ...others].slice(0, n).map((x) => x.npc);
  // Legacy fallback: explicit target displaces lowest non-target if still missing.
  if (targetId && !top.find((x) => x.id === targetId)) {
    const tn = live.find((x) => x.id === targetId);
    if (tn) {
      if (top.length >= n && n > 0) top[top.length - 1] = tn;
      else if (top.length < n) top.push(tn);
    }
  }
  return top;
}
// v2 (R2): CAST census — live NPCs only, relevance-ordered, capped. Target always shown.
export function castLine(sim, currentInput) {
  let ranked = liveNpcs(sim).map((npc) => ({ npc, s: npcRelevance(npc, sim, currentInput) }))
    .sort((a, b) => (b.s - a.s) || (a.npc.id < b.npc.id ? -1 : a.npc.id > b.npc.id ? 1 : 0)).slice(0, V2_CAST_MAX);
  if (currentInput && typeof currentInput === "object" && currentInput.target) {
    const hit = resolvePersonKey(sim, String(currentInput.target).trim());
    // R5 flag: never force the controlled person back into CAST, even when targeted.
    // M4: the resolved target is placed FIRST (budget reserved) so the entry-
    // boundary walk below always keeps it — never appended last and cut off.
    if (hit && hit.npc && !hit.npc.inactive && !hit.npc.controlled) {
      ranked = [{ npc: hit.npc, s: Infinity }, ...ranked.filter((x) => x.npc.id !== hit.npc.id)].slice(0, V2_CAST_MAX);
    }
  }
  if (!ranked.length) return "(no one known yet)";
  // BUG8: compact presence marker + entry-boundary CAST_BUDGET (never mid-slice).
  // M4/M6: string fields are prompt-capped at render so one pathological bio
  // cannot blow the budget; injected "@@" scratchpad markers are neutralized.
  const entries = ranked.map((x) => {
    let pin = "OFF";
    try { if (Array.isArray(sim?.world?.present) && sim.world.present.includes(x.npc.id)) pin = "IN"; } catch (_) {}
    return `${cleanPromptStr(x.npc.id, 40)}: ${cleanPromptStr(x.npc.name, 60)} [${cleanPromptStr(x.npc.role || "?", 60)}, ${cleanPromptStr(x.npc.emotion || "-", 40)}, ${pin}]`;
  });
  let out = "";
  for (const e of entries) {
    const cand = out ? out + "; " + e : e;
    if (cand.length > CAST_BUDGET) break;
    out = cand;
  }
  // M4: trim on entry boundaries only — the first entry (target) is atomic and
  // individually capped above, so it is returned whole rather than mid-name.
  return out || entries[0];
}
// v2: bounded relationship/bill/storyline lines.
function relLine(sim) {
  const rels = Object.values(sim.relationships || {});
  if (!rels.length) return "none";
  const recent = (sim?.memories?.shortTerm || []).slice(-6).map((m) => m.text || "").join(" ");
  const scored = rels.map((r) => ({ r, s: (recent.includes(r.name) ? 50 : 0) + (r.familiarity || 0) / 10 + (r.trust || 0) / 20 }))
    .sort((a, b) => (b.s - a.s) || (a.r.id < b.r.id ? -1 : 1)).slice(0, V2_REL_PROMPT_N);
  return scored.map((x) => `${x.r.name}(${x.r.trust}/${x.r.familiarity}/${x.r.emotion})`).join("; ").slice(0, REL_BUDGET) || "none";
}
function billsLine(sim, cur) {
  const unpaid = (sim.finances.bills || []).filter((b) => !b.paid);
  if (!unpaid.length) return "none";
  const shown = unpaid.slice(0, V2_BILL_PROMPT_N).map((b) => `${b.name} ${b.amount}${cur}`).join("; ");
  const rest = unpaid.length > V2_BILL_PROMPT_N ? ` (+${unpaid.length - V2_BILL_PROMPT_N} more)` : "";
  return (shown + rest).slice(0, BILLS_BUDGET);
}
function storyLine(sim) {
  const act = (sim.storylines || []).filter((s) => s.active !== false);
  if (!act.length) return "none";
  return act.slice(0, V2_STORY_PROMPT_N).map((s) => s.title).join("; ").slice(0, STORY_BUDGET) || "none";
}
function inventoryLine(sim) {
  const inv = (sim.inventory || []).map((i) => i.name + "x" + i.qty).join(", ") || "empty";
  return inv.slice(0, INV_PROMPT_BUDGET);
}
// Living World: concise prompt lines (all budgeted, entry-boundary safe).
function pulseLine(sim) {
  const p = String(sim?.world?.pulse || "").trim();
  if (!p) return "none";
  return p.slice(0, PULSE_BUDGET);
}
function conditionsLine(sim) {
  const c = Array.isArray(sim?.persona?.conditions) ? sim.persona.conditions : [];
  if (!c.length) return "none";
  return c.join("; ").slice(0, COND_PROMPT_BUDGET) || "none";
}
function experiencesLine(sim) {
  const e = Array.isArray(sim?.persona?.experiences) ? sim.persona.experiences : [];
  if (!e.length) return "none";
  return e.join("; ").slice(0, EXP_PROMPT_BUDGET) || "none";
}
// Anti-hallucination: physical layout lock line (budgeted <=200).
function locationFactsLine(sim) {
  const f = String(sim?.world?.locationFacts || "").trim();
  if (!f) return "none";
  return f.slice(0, LOC_FACTS_MAX);
}
// Authoritative scene roster: who is physically in-room right now.
// sim.world.present is the single source of truth (array of live NPC ids).
// Phone interlocutors, distant people, and departed NPCs NEVER enter it.
// Mention/thought/dialogue history NEVER implies presence — only the resolved
// roster (model scene_present JSON first, @@SCENE@@ tag fallback) does.
function hasKataWordBoundaryForKal(s, word) {
  // "কল" must match as a standalone word — never inside "কলকাতা".
  try {
    const escW = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[\\s,;:\\/|()\\[\\]{}।!?.…]+)" + escW + "(ে|ের|টা|টি|েতে)?([\\s,;:\\/|()\\[\\]{}।!?.…]+|$)").test(String(s || ""));
  } catch (_) { return false; }
}
// Honorific / case-suffix helpers for safe Bengali name matching (BUG5).
// Never touch hashStr/jitter/ARCHETYPES/profileFor — matching only.
const HONORIFIC_WORDS = new Set(["আপা", "চাচা", "সাহেব", "দা", "দাদা", "দি", "দিদি", "বাবু", "মামা", "কাকা", "চাচি", "খালা", "খালু", "মাসি", "পিসি", "আঙ্কেল", "আন্টি", "স্যার", "ম্যাডাম"]);
function stripHonorificWords(normed) {
  try {
    const words = String(normed || "").split(" ").filter(Boolean);
    while (words.length > 1 && HONORIFIC_WORDS.has(words[words.length - 1])) words.pop();
    return words.join(" ");
  } catch (_) { return String(normed || ""); }
}
function stripCaseSuffixWord(w) {
  try {
    let s = String(w || "");
    if (s.length < 3) return s;
    // yer genitive: precomposed YA (U+09DF) or decomposed YA+NUKTA (U+09AF U+09BC).
    if ((s.endsWith("\u09DF\u09C7\u09B0") && s.slice(0, -3).length >= 2) || (s.endsWith("\u09AF\u09BC\u09C7\u09B0") && s.slice(0, -4).length >= 2)) return s.endsWith("\u09DF\u09C7\u09B0") ? s.slice(0, -3) : s.slice(0, -4);
    if (s.endsWith("\u09C7\u09B0") && s.slice(0, -2).length >= 3) return s.slice(0, -2);
    if (s.endsWith("\u098F\u09B0") && s.slice(0, -2).length >= 3) return s.slice(0, -2);
    if (s.endsWith("\u0995\u09C7") && s.slice(0, -2).length >= 2) return s.slice(0, -2);
    if (/[\u09BE\u09BF\u09C0\u09C1\u09C2\u09C7\u09C8\u09CB\u09CC\u09DF\u09AF\u09BC]\u09B0$/.test(s) && s.slice(0, -1).length >= 2) return s.slice(0, -1);
    return s;
  } catch (_) { return String(w || ""); }
}
export function normBase(s) {
  try {
    const nn = normName(s);
    if (!nn) return "";
    const noHon = stripHonorificWords(nn);
    const words = noHon.split(" ").filter(Boolean).map(stripCaseSuffixWord);
    return words.join(" ").trim();
  } catch (_) { return normName(s); }
}
export function hasWordBoundary(hayNorm, needleNorm) {
  try {
    const hay = String(hayNorm || ""), nd = String(needleNorm || "").trim();
    if (!hay || !nd) return false;
    const escN = nd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[\\s,;:\\/|()\\[\\]{}।!?.…]+)" + escN + "([\\s,;:\\/|()\\[\\]{}।!?.…]+|$)").test(hay);
  } catch (_) { return false; }
}
export function tokenHasNegationMarker(token) {
  const t = String(token || "");
  if (!t) return false;
  if (t.includes("আসেনি") || t.includes("অনুপস্থিত") || t.includes("ছাড়া") || t.includes("বাদে")) return true;
  try {
    if (hasWordBoundary(normName(t), "নেই")) return true;
    if (hasWordBoundary(normName(t), "নয়")) return true;
    if (hasWordBoundary(normName(t), "নেই")) return true;
  } catch (_) {}
  // Fallback includes for compact tokens (word-boundary helper covers most).
  if (t.includes("নেই") || t.includes("আসেনি")) return true;
  return false;
}
const ARRIVAL_MARKS = ["এসেছে", "এসেছেন", "ঢুকেছে", "ঢুকেছেন", "ফিরেছে", "ফিরেছেন", "ফিরে এসেছে", "ফিরে এসেছেন", "পৌঁছেছে", "পৌঁছেছেন", "আসতে", "আসছে", "আসছেন"];
export function tokenHasArrivalMarker(token) {
  const t = String(token || "");
  if (!t) return false;
  for (const m of ARRIVAL_MARKS) if (t.includes(m)) return true;
  return false;
}
export function tokenHasRemoteMarker(token) {
  const t = String(token || "");
  if (!t) return false;
  // Explicit absence/distance always remote.
  if (t.includes("অনুপস্থিত") || t.includes("দূরে")) return true;
  // Water-tap / in-hand phone / doorway scenes are NEVER remote.
  const tapEx = t.includes("কলের পাড়ে") || t.includes("জলের কল") || t.includes("টিউবওয়েল");
  const handEx = t.includes("হাতে ফোন") || t.includes("ফোন হাতে") || t.includes("ফোন রেখে") || t.includes("ফোন দেখছে");
  // Remote voice only: explicit phone-call/message phrases (BUG5 tight, no raw ফোন/বাইরে).
  if (!handEx) {
    if (t.includes("ফোনে কথা") || t.includes("ফোনে কল") || t.includes("ফোন কলে") || t.includes("ফোনে যুক্ত") || t.includes("ফোনের ওপাশে") || t.includes("ভিডিও কলে")) return true;
    // Standalone ফোনে = remote voice, unless viewing/holding qualifier.
    if (t.includes("ফোনে") && !t.includes("দেখছে") && !t.includes("রেখে") && !t.includes("হাতে")) return true;
    if (t.includes("মেসেজে")) return true;
    if (t.includes("হোয়াটস")) return true;
    try {
      if (/on\s+phone|phone\s+call|over\s+phone/i.test(t)) return true;
      if (/\bsms\b/i.test(t)) return true;
      if (/whatsapp/i.test(t)) return true;
    } catch (_) {}
    // Bare কল = phone call only (tap phrases excluded above).
    if (!tapEx && hasKataWordBoundaryForKal(t, "কল")) return true;
  } else {
    // Even with phone in hand, explicit call-join phrases still count as remote.
    if (t.includes("ফোনে কথা") || t.includes("ফোনে যুক্ত") || t.includes("ফোনের ওপাশে")) return true;
  }
  return false;
}
export function tokenHasDepartureMarker(token) {
  const t = String(token || "");
  if (!t) return false;
  if (t.includes("চলে গেছে") || t.includes("চলে গেল") || t.includes("চলে গেছেন") || t.includes("বেরিয়ে গেছে") || t.includes("বেরিয়ে গেল") || t.includes("বেরিয়ে পড়েছে") || t.includes("বের হয়ে গেছে") || t.includes("বের হয়ে গেল") || t.includes("বিদায় নিয়ে")) return true;
  return false;
}
// Dual-source roster parser: @@SCENE@@ tag fallback when JSON omits scene_present.
// Returns null (no tag), [] (explicitly nobody), or candidate name strings.
export function extractScenePresentFromTag(raw) {
  try {
    let s = String(raw ?? "");
    // Isolate @@SCENE@@ block up to @@/SCENE@@ or newline first (BUG5).
    try {
      const bi = s.indexOf("@@SCENE@@");
      if (bi !== -1) {
        let sub = s.slice(bi);
        const ei = sub.indexOf("@@/SCENE@@");
        if (ei !== -1) sub = sub.slice(0, ei + "@@/SCENE@@".length);
        else { const nl = sub.indexOf("\n"); if (nl !== -1) sub = sub.slice(0, nl); }
        s = sub;
      }
    } catch (_) {}
    s = s.replace(/@@SCENE@@/g, " ").replace(/@@\/SCENE@@/g, " ").replace(/@@\/SCENE/g, " ");
    s = s.trim();
    // Outer [...] wrapper around the whole scene line.
    if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1).trim();
    // Markdown bold/italic from ChatGPT/Gemini.
    s = s.replace(/[*_]+/g, "");
    const m = s.match(/(?:দৃশ্যে\s+)?উপস্থিত\s*:\s*([^|\n]+)/);
    if (!m) return null;
    let val = String(m[1] || "").trim();
    if (!val || val === "-" || val === "—" || val === "--") return [];
    const low = val.toLowerCase().trim();
    if (low === "none" || low === "empty" || low === "-") return [];
    if (/কেউ\s*না|কেউ\s*নেই|কেউই\s*নেই|কেউ\s*উপস্থিত\s*নেই/.test(val)) return [];
    if (val === "একা" || val === "শূন্য" || val === "শুধু আমি") return [];
    const parts = val.split(/[,،;\/]+|\s+(?:ও|এবং|আর)\s+/).map((x) => String(x || "").trim()).filter(Boolean);
    const out = [];
    for (let tok of parts) {
      if (!tok) continue;
      // Collect inline qualifiers; only the qualifier saying remote/absent excludes.
      let quals = [];
      try {
        const q1 = tok.match(/\([^)]*\)/g) || [];
        const q2 = tok.match(/\[[^\]]*\]/g) || [];
        quals = [...q1, ...q2].map((q) => q.slice(1, -1));
      } catch (_) { quals = []; }
      let qualRemote = false;
      try {
        for (const q of quals) {
          if (tokenHasRemoteMarker(q) || tokenHasDepartureMarker(q) || tokenHasNegationMarker(q)) { qualRemote = true; break; }
        }
      } catch (_) {}
      if (qualRemote) continue;
      // Strip qualifiers for the base name.
      try { tok = tok.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s*\[[^\]]*\]\s*/g, " ").trim().replace(/\s+/g, " "); } catch (_) {}
      if (!tok || tok === "-" || tok === "—" || tok === "--") continue;
      const tl = tok.toLowerCase();
      if (tl === "none" || tl === "empty") continue;
      if (/কেউ\s*না|কেউ\s*নেই|কেউই\s*নেই|কেউ\s*উপস্থিত\s*নেই/.test(tok)) continue;
      if (tok === "একা" || tok === "শূন্য" || tok === "শুধু আমি") continue;
      if (tokenHasRemoteMarker(tok) || tokenHasDepartureMarker(tok) || tokenHasNegationMarker(tok)) continue;
      if (tok) out.push(tok);
    }
    return out;
  } catch (_) { return null; }
}
// Map raw roster strings (ids or Bengali names, with/without qualifiers) to live NPC ids.
export function resolvePresentIds(sim, rawNamesArray) {
  const out = [];
  const seen = new Set();
  try {
    if (!Array.isArray(rawNamesArray)) return out;
    const playerN = normName(sim?.persona?.name || "");
    const live = Object.values(sim?.npcs || {}).filter((n) => n && !n.inactive && !n.controlled);
    for (let item of rawNamesArray) {
      if (item == null) continue;
      let s = String(item).trim();
      if (!s) continue;
      if (tokenHasRemoteMarker(s) || tokenHasDepartureMarker(s) || tokenHasNegationMarker(s)) continue;
      // Qualifier-aware: check qualifier for remote first, then strip.
      let quals = [];
      try {
        const q1 = s.match(/\([^)]*\)/g) || [];
        const q2 = s.match(/\[[^\]]*\]/g) || [];
        quals = [...q1, ...q2].map((q) => q.slice(1, -1));
      } catch (_) { quals = []; }
      let qRemote = false;
      try {
        for (const q of quals) {
          if (tokenHasRemoteMarker(q) || tokenHasDepartureMarker(q) || tokenHasNegationMarker(q)) { qRemote = true; break; }
        }
      } catch (_) {}
      if (qRemote) continue;
      let cleaned = s;
      try { cleaned = cleaned.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s*\[[^\]]*\]\s*/g, " ").trim().replace(/\s+/g, " "); } catch (_) {}
      if (!cleaned) continue;
      if (tokenHasRemoteMarker(cleaned) || tokenHasDepartureMarker(cleaned) || tokenHasNegationMarker(cleaned)) continue;
      if (playerN && (normName(cleaned) === playerN || normBase(cleaned) === normBase(sim?.persona?.name || ""))) continue;
      let hit = null;
      try { hit = resolvePersonKey(sim, cleaned); } catch (_) { hit = null; }
      if (hit && hit.npc && !hit.npc.inactive && !hit.npc.controlled) {
        if (!seen.has(hit.npc.id)) { seen.add(hit.npc.id); out.push(hit.npc.id); }
        continue;
      }
      // Safe fallback: word-boundary or honorific-base match only (never raw includes).
      try {
        const nt = normName(cleaned);
        const nb = normBase(cleaned);
        for (const npc of live) {
          const nn = normName(npc.name || "");
          const nbb = normBase(npc.name || "");
          const nid = normName(npc.id || "");
          let ok = false;
          if (nn && hasWordBoundary(nt, nn)) ok = true;
          else if (nbb && nb && nbb === nb) ok = true;
          else if (nid && nid.length >= 2 && hasWordBoundary(nt, nid)) ok = true;
          else if (nid && nid.length >= 2 && nb === nid) ok = true;
          if (ok) {
            if (!seen.has(npc.id)) { seen.add(npc.id); out.push(npc.id); }
            break;
          }
        }
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}
export function isPresentForScene(npc, sim, currentInput) {
  try {
    if (!npc || npc.inactive || npc.controlled) return false;
  } catch (_) { return false; }
  // BUG3: [PRESENT] strictly reflects sim.world.present (no /talk teleport).
  try {
    if (Array.isArray(sim?.world?.present)) return sim.world.present.includes(npc.id);
  } catch (_) {}
  return false;
}
// Anti-hallucination: partitioned dossier section (present vs off-screen).
// Headers count toward DOSSIER_TOTAL_BUDGET; trimming drops absent first.
// Gate 5: `extras` appends the dormant one-liner + known-but-undetailed
// roster subsections ("" when nobody is omitted — then output is byte-for
// byte the legacy section, the V3 guarantee).
function buildDossierSection(list, sim, currentInput, extras) {
  if (!list.length && !extras) return "(no NPCs yet)";
  const present = list.filter((n) => isPresentForScene(n, sim, currentInput));
  const absent = list.filter((n) => !isPresentForScene(n, sim, currentInput));
  const pTxt = present.length ? present.map((n) => npcPsychBlock(n, sim)).join("\n") : "(none currently in room — do not conjure visitors)";
  const aTxt = absent.length ? absent.map((n) => npcPsychBlock(n, sim)).join("\n") : "(none)";
  return `[PRESENT — only these may speak/act in person now]:\n${pTxt}\n\n[OFF-SCREEN — DO NOT BRING IN UNLESS SCHEDULE/TRAVEL/CALL MATCHES TIME]:\n${aTxt}${extras || ""}`;
}

// Gate 1: dossier-budget trim as a pure, testable step. Verbatim move of the
// inline block it replaces (same drops, same fallback); it additionally
// records trim events into `trims` when an array is passed. `trims` entries:
// {name, droppedChars, reason}. No prompt-string change.
export function fitDossiersToBudget(dossierNpcs, sim, currentInput, trims, extras) {
  const ex = typeof extras === "string" ? extras : "";
  let dossiers = buildDossierSection(dossierNpcs, sim, currentInput, ex);
  if (dossiers.length <= DOSSIER_TOTAL_BUDGET) return { dossierNpcs, dossiers };
  const before = dossiers.length;
  const beforeCount = dossierNpcs.length;
  // BUG4: drop lowest-ranked OFF-SCREEN non-target first, never abort on target-last.
  let targetId = (currentInput && typeof currentInput === "object" && currentInput.target)
    ? ((resolvePersonKey(sim, String(currentInput.target).trim()) || {}).npc || {}).id : null;
  try {
    const _t = (currentInput && typeof currentInput === "object" && currentInput.target)
      ? (resolvePersonKey(sim, String(currentInput.target).trim()) || {}).npc : null;
    if (_t && _t.controlled) targetId = null;
  } catch (_) {}
  let keep = dossierNpcs.slice();
  while (keep.length > 1) {
    const txt = buildDossierSection(keep, sim, currentInput, ex);
    if (txt.length <= DOSSIER_TOTAL_BUDGET) { dossiers = txt; break; }
    let di = -1;
    for (let i = keep.length - 1; i >= 0; i--) {
      if (targetId && keep[i].id === targetId) continue;
      if (!isPresentForScene(keep[i], sim, currentInput)) { di = i; break; }
    }
    if (di === -1) {
      for (let i = keep.length - 1; i >= 0; i--) {
        if (targetId && keep[i].id === targetId) continue;
        di = i; break;
      }
    }
    if (di === -1) break;
    keep.splice(di, 1);
    dossiers = buildDossierSection(keep, sim, currentInput, ex);
  }
  if (dossiers.length > DOSSIER_TOTAL_BUDGET) {
    // M17: entry-boundary fallback (never mid-sentence) when even the
    // OFF-SCREEN-first dropping cannot fit the budget.
    const preCut = dossiers.length;
    dossiers = cutAtBoundary(dossiers, DOSSIER_TOTAL_BUDGET);
    if (Array.isArray(trims) && preCut !== dossiers.length) trims.push({ name: "dossiers.cut", droppedChars: preCut - dossiers.length, reason: `entry-boundary fallback to DOSSIER_TOTAL_BUDGET=${DOSSIER_TOTAL_BUDGET}` });
  }
  if (Array.isArray(trims) && before !== dossiers.length) trims.push({ name: "dossiers.trim", droppedChars: before - dossiers.length, reason: `dropped ${beforeCount - keep.length} dossier(s) to fit DOSSIER_TOTAL_BUDGET=${DOSSIER_TOTAL_BUDGET}` });
  return { dossierNpcs: keep, dossiers };
}

// Gate 2: pure rule-selection context. Derived from sim + input + command
// only (never reaches into anything else). `scope` is "full" for every
// existing scenario — future narrowed scopes unlock per-pack gating while
// full scope always renders everything (byte-identical to the old template).
// Fail-open: any shape problem yields a full-coverage ctx, never a throw.
export function buildRuleContext(sim, input, command) {
  try {
    const cmd = (command && typeof command === "object") ? command : null;
    const commandType = cmd?.type ?? null;
    const s = (sim && typeof sim === "object") ? sim : {};
    const present = Array.isArray(s.world?.present) ? s.world.present : [];
    const bills = Array.isArray(s.finances?.bills) ? s.finances.bills.filter((b) => b && !b.paid) : [];
    const income = s.income;
    const incomeActive = !!(income && typeof income === "object" && income.amount > 0 && income.cadence_days >= 1);
    const needsEconomy = bills.length > 0 || incomeActive || ["pay", "loan", "job", "shop"].includes(commandType);
    const needsTravel = commandType === "travel";
    const needsPhone = !!s.world?.phoneCall || commandType === "call";
    const isSkip = commandType === "skip";
    const npcScope = present.length > 0 || !!s.world?.phoneCall;
    const conds = Array.isArray(s.persona?.conditions) ? s.persona.conditions : [];
    const exps = Array.isArray(s.persona?.experiences) ? s.persona.experiences : [];
    const lifeDepth = conds.length > 0 || exps.length > 0;
    const st = (s.stats && typeof s.stats === "object") ? s.stats : {};
    const lowPhysio = !!(s.critical?.active || st.health === 0 || st.satiety === 0 || st.energy === 0 || isSkip);
    let hasMinors = false, hasUnconfirmed = false;
    try {
      const pa = s.persona;
      if (pa && typeof pa.age === "number" && pa.age < 18) hasMinors = true;
      for (const n of Object.values(s.npcs ?? {})) {
        if (!n || n.controlled || n.inactive) continue;
        if (typeof n.age === "number" && n.age < 18) hasMinors = true;
        else if (typeof n.age !== "number") hasUnconfirmed = true;
      }
    } catch (_) {}
    return { scope: cmd?.scope ?? "full", input: typeof input === "string" ? input : (input?.text ?? ""), commandType, present, bills, hasBills: bills.length > 0, incomeActive, needsEconomy, needsTravel, locationChanged: needsTravel, needsPhone, isSkip, npcScope, lifeDepth, lowPhysio, criticalActive: !!s.critical?.active, hasMinors, hasUnconfirmed, consts: { HEALTH_RECOVERY_THRESHOLD } };
  } catch (_) {
    return { scope: "full", input: "", commandType: null, present: [], bills: [], hasBills: false, incomeActive: false, needsEconomy: true, needsTravel: true, locationChanged: true, needsPhone: true, isSkip: false, npcScope: true, lifeDepth: true, lowPhysio: true, criticalActive: false, hasMinors: false, hasUnconfirmed: false, consts: { HEALTH_RECOVERY_THRESHOLD } };
  }
}

export function buildSystemPrompt(sim, currentInput, opts) {
  const city = CITIES[sim.city] ? CITIES[sim.city].bn : sim.world.location;
  const cur = CITIES[sim.city] ? CITIES[sim.city].currency : "₹";
  // Dossiers: relevance-ranked with total budget; targeted NPC guaranteed.
  // Partitioned present vs off-screen (anti-hallucination); headers count to budget.
  // Gate 5: retrieved slices (ACTIVE full dossiers + dormant one-liners +
  // known-but-undetailed roster) instead of liveNpcs() slices wholesale.
  // opts.retrieval === false selects the legacy path (A/B measurement only).
  const _ret = retrieveForPrompt(sim, currentInput, opts);
  const _fit0 = fitDossiersToBudget(_ret.dossierNpcs, sim, currentInput, null, _ret.extras);
  let dossierNpcs = _fit0.dossierNpcs;
  let dossiers = _fit0.dossiers;
  // v2 (R3): JS-computed calendar + age (never model-computed).
  const yr = simYear(sim);
  const mo = monthOf(sim);
  const season = seasonForMonth(mo);
  const age = currentAge(sim);
  const crit = sim.critical && sim.critical.active
    ? `CRITICAL: the controlled character is INCAPACITATED (collapsed/unconscious, since Day ${sim.critical.sinceDay ?? "?"}). They cannot act normally until health rises above ${HEALTH_RECOVERY_THRESHOLD} through narrated care/rest/treatment. Narrate vulnerability and consequences; do not let them walk it off.`
    : "Critical state: none (conscious and mobile).";
  const inputText = typeof currentInput === "string" ? currentInput : (currentInput?.text ?? "");
  const commandObj = (currentInput && typeof currentInput === "object") ? currentInput : null;
  // Gate 2: the rulebook + JSON schema are assembled from discrete packs
  // (src/rules/registry.js + schema.js) in FIXED order. Full scope renders
  // every pack — byte-identical to the old monolithic literal (R1).
  const ctx = buildRuleContext(sim, inputText, commandObj);
  const rules = selectRules(ctx);
  const fields = selectSchemaFields(ctx);
  // Gate 4: the computed slice. Top-k journal events as FACTS replace the raw
  // Recent-memories + Faded-echoes dumps (the model narrates + socialises
  // only, and may not contradict the FACTS block).
  const factsCtx = factsContext(sim, currentInput);
  const sys =
`You are the REALITY ENGINE of a Bengali first-person life simulation. You are NOT a chatbot, NOT an assistant. You ARE the world itself: environment, NPCs, consequences, time, sensory detail.

ABSOLUTE RULES:
`
+ renderRulebook(rules, ctx)
+ `
JSON schema (required: time_advance_minutes + scene_present; rest optional):
{
`
+ renderSchema(fields)
+ `}

CURRENT AUTHORITATIVE STATE (do NOT invent contradictions):
- FACTS (computed, canon — narrate these; never contradict): ${truncPrompt(renderFacts(sim, factsCtx))}
- Character: ${truncPrompt(sim.persona.name)}, ${age}y, ${truncPrompt(sim.persona.gender)}, ${truncPrompt(sim.persona.occupation)} (${truncPrompt(sim.persona.socialClass)})
- Personality: ${truncPrompt(sim.persona.personality)}
- Background: ${truncPrompt(sim.persona.background)}
- Calendar: Day ${Math.max(1, Math.round(sim.world.dayCount || 1))} | Year ${yr} | Date: ${truncPrompt(sim.world.date)} (${truncPrompt(season)}) | Time: ${fmtTime(sim.world.timeMin)} (${dayPhaseLabel(sim.world.timeMin)}) | Location: ${truncPrompt(sim.world.location)} (city: ${truncPrompt(city)}, currency: ${cur})
- ${crit}
- Stats: health ${sim.stats.health}, mood ${sim.stats.mood}, satiety ${sim.stats.satiety}, energy ${sim.stats.energy} (0-100)
- Money: cash ${sim.finances.cash}${cur}, bank ${sim.finances.bank}${cur}; bills: ${truncPrompt(billsLine(sim, cur))}
- ${truncPrompt(incomeLine(sim))}
- Price anchors: ${truncPrompt(priceAnchors(sim))}
- Inventory: ${truncPrompt(inventoryLine(sim))}
- Location Facts (physical layout lock): ${truncPrompt(locationFactsLine(sim))}
- Pulse: ${truncPrompt(pulseLine(sim))}
- Conditions: ${truncPrompt(conditionsLine(sim))}
- Lived experience: ${truncPrompt(experiencesLine(sim))}
- Relationships: ${truncPrompt(relLine(sim))}
- Core memories (canon): ${truncPrompt(coreBlock(sim))}
- CHRONICLE (canon, [Day date] lasting consequences, newest last): ${truncPrompt(chronicleBlock(sim))}
- CAST (live npcId: name [role, mood], relevance order): ${truncPrompt(castLine(sim, currentInput))}
- Active storylines: ${truncPrompt(storyLine(sim))}

NPC PSYCHOLOGY DOSSIERS (internal, PLAYER-INVISIBLE — relevance-ranked; reveal ONLY through behavior. OFF-SCREEN group MUST NOT appear/speak in person unless Time matches schedule or player travels/calls):
${dossiers}
`;
  // Issue #11: hard final ceiling (newest-canon-last-dropped; rulebook never trimmed).
  const finalSys = fitSystemToCeiling(sys, dossiers, dossierNpcs, sim, currentInput, null, _ret.extras).out;
  // Gate 2 (R2): rules render ahead of the dossier section and trims only ever
  // touch dossiers/tail — assert no alwaysOn pack was harmed. console.assert
  // never throws: zero behavior change.
  console.assert(alwaysOnIntact(finalSys, ctx), "[rules] alwaysOn pack missing after trim");
  return finalSys;
}

// Gate 1: system-ceiling trim as a pure, testable step. Verbatim move of the
// inline block it replaces (same drops, same tail cut); it additionally
// records trim events into `trims` when an array is passed. No prompt change.
// Gate 4: the dossier-drop loop stops at an operating margin — it keeps
// dropping while headroom is below MIN_SYSTEM_HEADROOM (not merely while
// over the ceiling). Rationale: the Gate 1 floor tripwire prescribes
// "shrink the prompt", and C5 requires every fixture's prompt to shrink;
// stopping exactly at the ceiling let ceiling-pinned fixtures (F2-woman,
// F2-youth) grow whenever a smaller pre-ceiling prompt meant fewer drops.
// The hard ceiling still always holds (tail-cut fallback unchanged); the
// margin is best-effort via dossier drops only.
export function fitSystemToCeiling(sys, dossiers, dossierNpcs, sim, currentInput, trims, extras) {
  const ex = typeof extras === "string" ? extras : "";
  let out = sys;
  let keptNpcs = dossierNpcs;
  let dTxt = dossiers;
  if (out.length > SYSTEM_PROMPT_MAX_CHARS - MIN_SYSTEM_HEADROOM) {
    // BUG4: drop OFF-SCREEN non-target first (never mid-sentence abort).
    let targetId2 = (currentInput && typeof currentInput === "object" && currentInput.target)
      ? ((resolvePersonKey(sim, String(currentInput.target).trim()) || {}).npc || {}).id : null;
    try {
      const _t2 = (currentInput && typeof currentInput === "object" && currentInput.target)
        ? (resolvePersonKey(sim, String(currentInput.target).trim()) || {}).npc : null;
      if (_t2 && _t2.controlled) targetId2 = null;
    } catch (_) {}
    let keep2 = keptNpcs.slice();
    const beforeCount = keep2.length;
    // curSec tracks the section text actually inside `out`: the loop rebuilds
    // from the original every iteration, so after iteration 1+ `out` holds
    // the latest d2 even when the margin is never reached (pre-existing quirk:
    // dTxt/keptNpcs used to go stale in that case — fixed below by syncing).
    let curSec = dossiers;
    while (out.length > SYSTEM_PROMPT_MAX_CHARS - MIN_SYSTEM_HEADROOM && keep2.length > 1) {
      let di = -1;
      for (let i = keep2.length - 1; i >= 0; i--) {
        if (targetId2 && keep2[i].id === targetId2) continue;
        if (!isPresentForScene(keep2[i], sim, currentInput)) { di = i; break; }
      }
      if (di === -1) {
        for (let i = keep2.length - 1; i >= 0; i--) {
          if (targetId2 && keep2[i].id === targetId2) continue;
          di = i; break;
        }
      }
      if (di === -1) break;
      keep2.splice(di, 1);
      const d2 = buildDossierSection(keep2, sim, currentInput, ex);
      out = sys.replace(dTxt, () => d2);
      curSec = d2;
      if (out.length <= SYSTEM_PROMPT_MAX_CHARS - MIN_SYSTEM_HEADROOM) { dTxt = d2; keptNpcs = keep2; break; }
    }
    // Quirk fix: sync bookkeeping with the drops that actually happened, even
    // when the loop exhausts above the margin (keep2.length == 1). Returns
    // and trims now always describe `out`.
    if (keep2.length !== beforeCount) { dTxt = curSec; keptNpcs = keep2; }
    if (Array.isArray(trims) && keep2.length < beforeCount) {
      const _pre = sys.replace(dossiers, () => dTxt);
      trims.push({ name: "system.dossier_drop", droppedChars: sys.length - _pre.length, reason: `dropped ${beforeCount - keep2.length} dossier(s) to fit SYSTEM_PROMPT_MAX_CHARS=${SYSTEM_PROMPT_MAX_CHARS}` });
    }
    if (out.length > SYSTEM_PROMPT_MAX_CHARS) {
      const preCut = out.length;
      out = cutAtBoundary(out, SYSTEM_PROMPT_MAX_CHARS);
      // Gate 5: stump-strip. The coverage appendix (roster first, one-liners
      // after) sits at the very end of the prompt, so a hard-ceiling tail cut
      // can amputate every entry yet leave a dangling section header behind —
      // a ~160-char stump that promises entries which do not exist. Strip a
      // trailing dangling header (roster, then one-liners): the model loses
      // nothing (zero entries followed), the floor regains the margin, and
      // surviving partial appendices (F6-late: roster entries before the cut)
      // are untouched — only a header with NOTHING after it is removed.
      if (ex) {
        try {
          let stripped = out.replace(/[\s]*$/, "");
          for (const h of [SUM_EXTRAS_ROSTER_HEADER, SUM_EXTRAS_ONELINER_HEADER]) {
            if (typeof h === "string" && h && stripped.endsWith(h)) stripped = stripped.slice(0, -h.length).replace(/[\s]*$/, "");
          }
          out = stripped;
        } catch (_) {}
      }
      if (Array.isArray(trims) && preCut !== out.length) trims.push({ name: "system.tail_cut", droppedChars: preCut - out.length, reason: `entry-boundary tail cut to SYSTEM_PROMPT_MAX_CHARS=${SYSTEM_PROMPT_MAX_CHARS}` });
    }
    if (out.length > SYSTEM_PROMPT_MAX_CHARS) {
      const preCut = out.length;
      out = cutAtBoundary(out, SYSTEM_PROMPT_MAX_CHARS);
      if (Array.isArray(trims) && preCut !== out.length) trims.push({ name: "system.tail_cut", droppedChars: preCut - out.length, reason: `entry-boundary tail cut to SYSTEM_PROMPT_MAX_CHARS=${SYSTEM_PROMPT_MAX_CHARS}` });
    }
  }
  return { out, dossiers: dTxt, dossierNpcs: keptNpcs };
}

export function buildUserPrompt(sim, playerText, command) {
  const cutoff = Math.max(0, Math.round(sim.historyCutoff || 0));
  // Issue #07: model-facing history respects the POV boundary (swap seam).
  // Issue #09: trailing player line duplicating PLAYER INPUT NOW is excluded.
  let entries = (sim.log || []).slice(cutoff);
  if (entries.length && entries[entries.length - 1] && entries[entries.length - 1].role === "player" && entries[entries.length - 1].text === playerText) {
    entries = entries.slice(0, -1);
  }
  // Newest-preserved history budget (Issue #11): walk newest-first until budget.
  // M5: PLAYER lines are capped exactly like WORLD lines — one huge history
  // line can no longer wedge the while-loop below into a mid-word hard cut.
  const rendered = [];
  let used = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const t = entries[i];
    const line = t.role === "player" ? `PLAYER DID/SAID: ${String(t.text || "").slice(0, USER_HISTORY_LINE_MAX)}` : `WORLD: ${String(t.text || "").replace(/<[^>]*>/g, "").slice(0, 1500)}`;
    if (used + line.length > USER_HISTORY_MAX_CHARS && rendered.length) break;
    rendered.unshift(line);
    used += line.length + 2;
    if (used >= USER_HISTORY_MAX_CHARS) break;
  }
  const recent0 = rendered.join("\n\n");
  // v2 (R5): skip montage mandate so skipped time is never a silent void.
  let skipNote = "";
  if (command && command.type === "skip") {
    // M5/C6: the SAME capped value everywhere (player text, skipNote, top-up,
    // applyPatch) — never the uncapped request.
    const want = Math.max(5, Math.min(SKIP_MAX_MIN, (typeof command.minutes === "number" && command.minutes > 0) ? Math.round(command.minutes) : 60));
    skipNote = `\nSKIP MODE: ${want} minutes must pass (your time_advance_minutes should be ≈${want}). Write a compact montage paragraph (routine + at most ONE small event), then land on "now" with sensory grounding. Never skip silently.`;
  }
  // Hard final ceiling: full user prompt (history + wrapper) stays within
  // USER_HISTORY_MAX_CHARS. Trim oldest history lines entry-boundary first
  // (newest canon preserved, never mid-sentence); wrapper never trimmed.
  // BUG9+BUG1: 1-line authoritative PRESENT anchor (kept in USER_HISTORY_MAX_CHARS).
  let presentAnchor = "nobody — alone";
  try {
    const ids = Array.isArray(sim?.world?.present) ? sim.world.present : [];
    if (ids.length) {
      const nms = ids.map((id) => { if (typeof id !== "string" || isReservedKey(id)) return null; const n = safeGet(sim.npcs || {}, id); return n ? `${n.name} (${id})` : id; }).filter(Boolean);
      if (nms.length) presentAnchor = nms.join(", ").slice(0, 200);
    }
  } catch (_) {}
  const head = `RECENT HISTORY (oldest first):\n`;
  // M5: the tail (player text) is capped — an arbitrarily long input can no
  // longer blow the ceiling by itself; "@@" markers are neutralized.
  const _safePlayerText = String(playerText ?? "").replace(/@@/g, "--").slice(0, USER_PLAYER_INPUT_MAX);
  const tail = `\n\nPLAYER INPUT NOW (${command ? "command: " + command.type : "free action"}): ${_safePlayerText}\n${skipNote}\nAuthoritative PRESENT now: ${presentAnchor}. Never put phone/distant/departed in scene_present.\nWrite the next moment. Rules: one beat only (5-15 min unless /skip), end waiting. Start with @@SCENE@@, then Bengali narrative, then @@STATE@@ JSON (scene_present required) @@END@@.`;
  const body0 = recent0 || "(story just began)";
  let body = body0;
  if ((head + body + tail).length > USER_HISTORY_MAX_CHARS) {
    const lines = rendered.slice();
    while (lines.length > 1 && (head + lines.join("\n\n") + tail).length > USER_HISTORY_MAX_CHARS) {
      lines.shift();
    }
    body = lines.length ? lines.join("\n\n") : body0;
    if ((head + body + tail).length > USER_HISTORY_MAX_CHARS) {
      // M5/M17: last-resort single-line trim lands on a word boundary, never
      // mid-word (mid-sentence for multi-line bodies via cutAtBoundary).
      const over = (head + body + tail).length - USER_HISTORY_MAX_CHARS;
      body = cutAtBoundary(body, Math.max(0, body.length - over));
    }
  }
  return head + body + tail;
}

// v2 (R5): repair helper — does this raw text contain a parsable @@STATE@@ JSON block?
function hasParsableStateBlock(raw) {
  const i = String(raw || "").indexOf("@@STATE@@");
  if (i === -1) return false;
  let jsonText = String(raw).slice(i + "@@STATE@@".length).trim().replace(/@@END@@[\s\S]*$/, "").trim();
  jsonText = jsonText.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = jsonText.indexOf("{"), e = jsonText.lastIndexOf("}");
  if (s === -1 || e === -1 || e <= s) return false;
  try { JSON.parse(jsonText.slice(s, e + 1)); return true; }
  catch (_) { try { JSON.parse(jsonText.slice(s, e + 1).replace(/,\s*([}\]])/g, "$1")); return true; } catch (_) { return false; } }
}

// Gate 1: structured, testable prompt-size report. Pure: same inputs ⇒ same
// report. Every character of sysStr is attributed to exactly one block; the
// tests assert sum(blocks.chars) === sysStr.length (reconciliation).
//
// Convention (declared label overhead): a block's `chars` INCLUDES its label
// prefix ("- Character: " etc.) and trailing newline, so reconciliation is
// exact; `valueChars` is the length of the dynamic value the named budget
// constrains (label excluded). Budgets are checked against valueChars.
// Two declared splits: the money line's bills value is its own budgeted
// `bills` block (money keeps the fixed "- Money: ...; bills: " prefix, no
// budget); the `storylines` block owns the blank line separating it from the
// dossier section (chars end "VALUE\n\n", valueChars strips label + 2).
// `trims` records system trims that fired during assembly ({name,
// droppedChars, reason}); per-block `trimmed` is set on dossiers (the only
// block trims can touch — trims always land at the end of the prompt).
// Pass the same currentInput the prompt was built with for exact trim replay
// + rebuild verification; omit it for a totals-only fallback (trims unknown).
export const SYS_BLOCK_BUDGETS = {
  dossiers: DOSSIER_TOTAL_BUDGET,
  cast: CAST_BUDGET,
  chronicle: V2_CHRON_BUDGET,
  core: V2_CORE_BUDGET,
  // Gate 4: the echoes/shortmem lines are retired (replaced by FACTS); their
  // budget keys stay so the Gate 0/1 budget ledger keeps its shape.
  echoes: FADED_ECHOES_BUDGET,
  shortmem: SHORTMEM_BUDGET,
  facts: FACTS_BUDGET,
  relationships: REL_BUDGET,
  bills: BILLS_BUDGET,
  inventory: INV_PROMPT_BUDGET,
  storylines: STORY_BUDGET,
  conditions: COND_PROMPT_BUDGET,
  experiences: EXP_PROMPT_BUDGET,
  location_facts: LOC_FACTS_MAX,
  pulse: PULSE_BUDGET,
};
const CAST_LINE_LABEL = "- CAST (live npcId: name [role, mood], relevance order): ";
const SYS_LINE_LABELS = [
  ["facts", FACTS_LABEL],
  ["character", "- Character: "],
  ["personality", "- Personality: "],
  ["background", "- Background: "],
  ["calendar", "- Calendar: "],
  // critical has no fixed label (two variants) — split out of the calendar region.
  ["stats", "- Stats: "],
  ["money", "- Money: "],
  ["income", "- Recurring income: "],
  ["price_anchors", "- Price anchors: "],
  ["inventory", "- Inventory: "],
  ["location_facts", "- Location Facts (physical layout lock): "],
  ["pulse", "- Pulse: "],
  ["conditions", "- Conditions: "],
  ["experiences", "- Lived experience: "],
  ["relationships", "- Relationships: "],
  ["core", "- Core memories (canon): "],
  ["chronicle", "- CHRONICLE (canon, [Day date] lasting consequences, newest last): "],
  ["cast", CAST_LINE_LABEL],
  ["storylines", "- Active storylines: "],
];
const SYS_SCHEMA_MARK = "JSON schema (required: time_advance_minutes + scene_present; rest optional):";
const SYS_STATE_MARK = "CURRENT AUTHORITATIVE STATE (do NOT invent contradictions):";
const SYS_DOSSIER_MARK = "NPC PSYCHOLOGY DOSSIERS (internal, PLAYER-INVISIBLE";

// Pure string surgery: split a built system prompt into named blocks.
// Reconciliation holds by construction (contiguous slices cover the string).
// Anything unrecognized lands in `unparsed` (tests require it to be empty).
function partitionSystemPrompt(sysStr) {
  const s = String(sysStr ?? "");
  const parts = [];
  const push = (name, text) => { parts.push({ name, text }); };
  let pos = 0;
  const fail = () => { push("unparsed", s.slice(pos)); return parts; };
  const i1 = s.indexOf(SYS_SCHEMA_MARK, pos);
  if (i1 === -1) return fail();
  push("rulebook", s.slice(0, i1));
  const i2 = s.indexOf(SYS_STATE_MARK, i1);
  if (i2 === -1) return fail();
  push("json_schema", s.slice(i1, i2));
  const hEnd = s.indexOf("\n", i2);
  if (hEnd === -1) return fail();
  push("state_header", s.slice(i2, hEnd + 1));
  pos = hEnd + 1;
  // Ordered state lines. Each block runs to the next label's line start.
  const labels = SYS_LINE_LABELS;
  for (let li = 0; li < labels.length; li++) {
    const [name, label] = labels[li];
    if (name === "calendar") {
      const statsIdx = s.indexOf("\n- Stats: ", pos);
      if (statsIdx === -1) return fail();
      const region = s.slice(pos, statsIdx);
      const k = region.lastIndexOf("\n- ");
      if (k === -1) return fail();
      push("calendar", s.slice(pos, pos + k + 1));
      // Critical line keeps its trailing newline (uniform with every other
      // state line); the next block starts after it. No char is dropped.
      push("critical", s.slice(pos + k + 1, statsIdx + 1));
      pos = statsIdx + 1;
      continue;
    }
    if (li + 1 < labels.length) {
      if (name === "money") {
        // The bills value is its own budgeted block: split the money line at
        // the "; bills: " marker (numbers can never contain it). Contiguous:
        // money prefix + bills value + "\n" — reconciliation unaffected.
        const nextLabel = labels[li + 1][1];
        const ni = s.indexOf("\n" + nextLabel, pos);
        if (ni === -1) return fail();
        const billsMark = "; bills: ";
        const bi = s.indexOf(billsMark, pos);
        if (bi === -1 || bi > ni) return fail();
        push("money", s.slice(pos, bi + billsMark.length));
        push("bills", s.slice(bi + billsMark.length, ni + 1));
        pos = ni + 1;
        continue;
      }
      const nextLabel = labels[li + 1][1];
      const ni = s.indexOf("\n" + nextLabel, pos);
      if (ni === -1) return fail();
      push(name, s.slice(pos, ni + 1));
      pos = ni + 1;
    } else {
      // storylines: runs to the dossier section, OWNING the section-separating
      // blank line (block ends "VALUE\n\n"). The expected value must include
      // both newlines; valueChars strips label + 2.
      const dIdx = s.indexOf("\n" + SYS_DOSSIER_MARK, pos);
      if (dIdx === -1) return fail();
      push(name, s.slice(pos, dIdx + 1));
      pos = dIdx + 1;
    }
  }
  const dhEnd = s.indexOf("\n", pos);
  if (dhEnd === -1) return fail();
  push("dossier_header", s.slice(pos, dhEnd + 1));
  push("dossiers", s.slice(dhEnd + 1));
  return parts;
}

function utf8len(s) {
  try { return new TextEncoder().encode(String(s ?? "")).length; }
  catch (_) { return String(s ?? "").length; }
}

export function measurePrompt(sim, sysStr, userStr, currentInput) {
  const hasInput = arguments.length >= 4;
  const sys = String(sysStr ?? "");
  const usr = String(userStr ?? "");
  const out = {
    system: { chars: sys.length, bytes: utf8len(sys) },
    user: { chars: usr.length, bytes: utf8len(usr) },
    ceiling: { system: SYSTEM_PROMPT_MAX_CHARS, user: USER_HISTORY_MAX_CHARS },
    headroom: { system: SYSTEM_PROMPT_MAX_CHARS - sys.length, user: USER_HISTORY_MAX_CHARS - usr.length },
    blocks: [],
    trims: [],
    exact: false,
    reconciled: false,
    error: null,
  };
  try {
    const parts = partitionSystemPrompt(sys);
    const byName = {};
    for (const p of parts) {
      const b = { name: p.name, chars: p.text.length, bytes: utf8len(p.text), budget: Object.prototype.hasOwnProperty.call(SYS_BLOCK_BUDGETS, p.name) ? SYS_BLOCK_BUDGETS[p.name] : null, valueChars: null, trimmed: false };
      byName[p.name] = b;
      out.blocks.push(b);
    }
    out.reconciled = parts.reduce((a, p) => a + p.text.length, 0) === sys.length;
    // Value verification + budget inputs (sim-only lines need no currentInput).
    if (sim && typeof sim === "object") {
      const T = truncPrompt;
      try {
        const cityV = CITIES[sim.city] ? CITIES[sim.city].bn : sim.world.location;
        const curV = CITIES[sim.city] ? CITIES[sim.city].currency : "₹";
        const yrV = simYear(sim), moV = monthOf(sim), seasonV = seasonForMonth(moV), ageV = currentAge(sim);
        const critV = sim.critical && sim.critical.active
          ? `CRITICAL: the controlled character is INCAPACITATED (collapsed/unconscious, since Day ${sim.critical.sinceDay ?? "?"}). They cannot act normally until health rises above ${HEALTH_RECOVERY_THRESHOLD} through narrated care/rest/treatment. Narrate vulnerability and consequences; do not let them walk it off.`
          : "Critical state: none (conscious and mobile).";
        const expect = {
          character: `- Character: ${T(sim.persona.name)}, ${ageV}y, ${T(sim.persona.gender)}, ${T(sim.persona.occupation)} (${T(sim.persona.socialClass)})\n`,
          personality: `- Personality: ${T(sim.persona.personality)}\n`,
          background: `- Background: ${T(sim.persona.background)}\n`,
          calendar: `- Calendar: Day ${Math.max(1, Math.round(sim.world.dayCount || 1))} | Year ${yrV} | Date: ${T(sim.world.date)} (${T(seasonV)}) | Time: ${fmtTime(sim.world.timeMin)} (${dayPhaseLabel(sim.world.timeMin)}) | Location: ${T(sim.world.location)} (city: ${T(cityV)}, currency: ${curV})\n`,
          critical: `- ${critV}\n`,
          stats: `- Stats: health ${sim.stats.health}, mood ${sim.stats.mood}, satiety ${sim.stats.satiety}, energy ${sim.stats.energy} (0-100)\n`,
          money: `- Money: cash ${sim.finances.cash}${curV}, bank ${sim.finances.bank}${curV}; bills: `,
          bills: `${T(billsLine(sim, curV))}\n`,
          income: `- ${T(incomeLine(sim))}\n`,
          price_anchors: `- Price anchors: ${T(priceAnchors(sim))}\n`,
          inventory: `- Inventory: ${T(inventoryLine(sim))}\n`,
          location_facts: `- Location Facts (physical layout lock): ${T(locationFactsLine(sim))}\n`,
          pulse: `- Pulse: ${T(pulseLine(sim))}\n`,
          conditions: `- Conditions: ${T(conditionsLine(sim))}\n`,
          experiences: `- Lived experience: ${T(experiencesLine(sim))}\n`,
          relationships: `- Relationships: ${T(relLine(sim))}\n`,
          core: `- Core memories (canon): ${T(coreBlock(sim))}\n`,
          chronicle: `- CHRONICLE (canon, [Day date] lasting consequences, newest last): ${T(chronicleBlock(sim))}\n`,
          storylines: `- Active storylines: ${T(storyLine(sim))}\n\n`,
        };
        for (const [k, v] of Object.entries(expect)) {
          if (!byName[k]) continue;
          if (byName[k].chars !== v.length || textOf(parts, k) !== v) continue;
          // value = dynamic part the named budget constrains (label + line
          // newline excluded). Critical label is "- " (2 chars) + trailing
          // "\n" (1). Storylines owns the section blank line ("\n\n": -2).
          // Bills is the bare value + "\n" (-1). Money is a fixed-format
          // prefix (no budget) — its budgeted value lives in bills.
          if (k === "critical") byName[k].valueChars = v.length - 3;
          else if (k === "storylines") byName[k].valueChars = v.length - "- Active storylines: ".length - 2;
          else if (k === "bills") byName[k].valueChars = v.length - 1;
          else if (k === "money") byName[k].valueChars = null;
          else {
            const labelLen = SYS_LINE_LABELS.find((l) => l[0] === k)[1].length;
            byName[k].valueChars = v.length - labelLen - 1;
          }
        }
        // bills/inventory/etc. values double-check via endsWith (same thing, kept simple):
        void cityV;
      } catch (_) { /* per-block verification is best-effort; reconciliation still holds */ }
      // FACTS: exact mode recomputes with currentInput (same factsContext as
      // the builder), else label arithmetic.
      if (byName.facts) {
        if (hasInput) {
          try {
            const fv = truncPrompt(renderFacts(sim, factsContext(sim, currentInput)));
            if (textOf(parts, "facts") === FACTS_LABEL + fv + "\n") byName.facts.valueChars = fv.length;
          } catch (_) {}
        } else if (textOf(parts, "facts").startsWith(FACTS_LABEL)) {
          byName.facts.valueChars = byName.facts.chars - FACTS_LABEL.length - 1;
        }
      }
      // CAST: exact mode recomputes with currentInput, else label arithmetic.
      if (byName.cast) {
        if (hasInput) {
          try {
            const cv = truncPrompt(castLine(sim, currentInput));
            if (textOf(parts, "cast") === CAST_LINE_LABEL + cv + "\n") byName.cast.valueChars = cv.length;
          } catch (_) {}
        } else if (textOf(parts, "cast").startsWith(CAST_LINE_LABEL)) {
          byName.cast.valueChars = byName.cast.chars - CAST_LINE_LABEL.length - 1;
        }
      }
      if (byName.dossiers && !hasInput) {
        // Dossiers value = dossier text the budget constrains (template
        // newline after ${dossiers} excluded).
        const dt = textOf(parts, "dossiers");
        byName.dossiers.valueChars = dt.endsWith("\n") ? dt.length - 1 : dt.length;
      }
    }
    // Exact mode: replay the trim pipeline + full rebuild, verify byte-identity.
    if (hasInput && sim && typeof sim === "object") {
      try {
        // Gate 5: mirror the builder exactly (retrieved dossier set + extras).
        const _rr = retrieveForPrompt(sim, currentInput);
        const r1 = fitDossiersToBudget(_rr.dossierNpcs, sim, currentInput, out.trims, _rr.extras);
        const dPart = textOf(parts, "dossiers");
        // Rebuild the pre-ceiling sys by swapping the (possibly trimmed) dossier
        // block for the replayed pre-ceiling dossiers text.
        const dStart = sys.length - dPart.length;
        const preSys = sys.slice(0, dStart) + r1.dossiers + "\n";
        const r2 = fitSystemToCeiling(preSys, r1.dossiers, r1.dossierNpcs, sim, currentInput, out.trims, _rr.extras);
        const rebuilt = buildSystemPrompt(sim, currentInput);
        if (r2.out !== sys || rebuilt !== sys) {
          out.reconciled = false;
          out.error = out.error || "replay mismatch: rebuilt prompt differs from sysStr";
        } else {
          if (byName.dossiers) {
            // Dossiers value = dossier text the budget constrains (template
            // newline excluded when present; a tail cut may remove it).
            byName.dossiers.valueChars = dPart.endsWith("\n") ? dPart.length - 1 : dPart.length;
          }
          if (out.trims.length && byName.dossiers) byName.dossiers.trimmed = true;
        }
        out.exact = true;
      } catch (e) {
        out.error = out.error || String((e && e.message) || e);
      }
    }
  } catch (e) {
    out.error = out.error || String((e && e.message) || e);
  }
  return out;
}
function textOf(parts, name) {
  const p = parts.find((p) => p.name === name);
  return p ? p.text : "";
}

function promptSizeReport(sysStr, userStr) {
  // Legacy totals-only wrapper (kept for compat); the enforced contract is measurePrompt.
  try {
    const r = measurePrompt(null, sysStr, userStr);
    console.debug(`[prompt] system ${r.system.chars} chars / ${r.system.bytes} B; user ${r.user.chars} chars / ${r.user.bytes} B`);
    return { systemChars: r.system.chars, systemBytes: r.system.bytes, userChars: r.user.chars, userBytes: r.user.bytes };
  } catch (_) { return null; }
}

export async function callRealityEngine(sim, playerText, command, onChunk) {
  const engine = R().generateText;
  if (!engine) throw new Error("AI engine not loaded");
  // Issue #12: thread current input + command target into ranking (optional param).
  const currentInput = command && command.target
    ? { text: playerText, target: command.target, type: command.type }
    : { text: playerText, type: command ? command.type : null };
  const sysStr = buildSystemPrompt(sim, currentInput);
  const userStr = buildUserPrompt(sim, playerText, command);
  try {
    const rpt = measurePrompt(sim, sysStr, userStr, currentInput);
    console.debug(`[prompt] system ${rpt.system.chars} chars / ${rpt.system.bytes} B; user ${rpt.user.chars} chars / ${rpt.user.bytes} B; headroom ${rpt.headroom.system}/${rpt.headroom.user}`);
  } catch (_) { promptSizeReport(sysStr, userStr); }
  // Gate 4: start cooldowns on the events this prompt showed (anti-repeat
  // for the next beat). AFTER measuring: exact-mode replay must rebuild from
  // the unmarked journal. Pure selection => marks match exactly what FACTS
  // showed (nothing mutates the journal between build and mark).
  try { selectAndMark(sim, currentInput); } catch (_) {}
  const instruction = sysStr + "\n\n" + userStr;
  const full = await engine({
    instruction,
    stopSequences: ["@@END@@"],
    onChunk: (d) => { if (onChunk) { try { onChunk(d); } catch (_) {} } },
  });
  let text = String(full.text ?? full);
  // v2 (R5): ONE repair retry when the response lacks a valid @@STATE@@ block.
  if (!hasParsableStateBlock(text)) {
    try {
      const repair = instruction + `\n\nREPAIR: Your last output missed the required @@STATE@@ JSON @@END@@ block. Re-emit the SAME beat starting with the @@SCENE@@ line, then the Bengali narrative, then a valid @@STATE@@ {"time_advance_minutes":8,"scene_present":[]} @@END@@ block. No other changes.`;
      const full2 = await engine({
        instruction: repair,
        stopSequences: ["@@END@@"],
        onChunk: (d) => { if (onChunk) { try { onChunk(d); } catch (_) {} } },
      });
      const text2 = String(full2.text ?? full2);
      if (hasParsableStateBlock(text2)) return text2;
      console.warn("[engine] repair retry still missing @@STATE@@; applying fallback patch.");
      return text2;
    } catch (e) { console.warn("[engine] repair retry failed", e); }
  }
  return text;
}

export function splitNarrativeAndPatch(raw) {
  // Authoritative roster: capture @@SCENE@@ tag candidates BEFORE stripping.
  let sceneTag = null;
  try { sceneTag = extractScenePresentFromTag(raw); } catch (_) { sceneTag = null; }
  const i = raw.indexOf("@@STATE@@");
  // v2 (R5): log a console warning on the silent-fallback path (game stays playable).
  // Anti-hallucination: @@SCENE@@ scratchpad is model-only — never player-visible.
  if (i === -1) { console.warn("[engine] missing @@STATE@@ block; applying fallback 8-min patch."); const _p = { time_advance_minutes: 8 }; if (sceneTag !== null) _p._scene_tag_present = sceneTag; else _p.scene_present = []; return { narrative: stripSceneBlock(raw), patch: _p }; }
  const narrative = stripSceneBlock(raw.slice(0, i));
  let jsonText = raw.slice(i + "@@STATE@@".length).trim();
  jsonText = jsonText.replace(/@@END@@[\s\S]*$/, "").trim();
  // strip code fences
  jsonText = jsonText.replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
  // extract first {...} block
  const s = jsonText.indexOf("{"), e = jsonText.lastIndexOf("}");
  if (s !== -1 && e !== -1 && e > s) jsonText = jsonText.slice(s, e + 1);
  let patch = { time_advance_minutes: 8 };
  let ok = false;
  try {
    patch = { ...patch, ...JSON.parse(jsonText) }; ok = true;
  } catch (_) {
    // try trailing-comma repair
    try { patch = { ...patch, ...JSON.parse(jsonText.replace(/,\s*([}\]])/g, "$1")) }; ok = true; } catch (_) {}
  }
  if (!ok) console.warn("[engine] unparseable @@STATE@@ JSON; applying fallback 8-min patch.");
  if (!isFiniteNum(patch.time_advance_minutes)) patch.time_advance_minutes = 8;
  // v2 (R5): skip cap raised to 7 days so the model can cover a full /skip in one patch.
  patch.time_advance_minutes = Math.max(1, Math.min(SKIP_MAX_MIN, Math.round(patch.time_advance_minutes)));
  if (sceneTag !== null) patch._scene_tag_present = sceneTag;
  // M3: no roster signal at all (no JSON scene_present and no SCENE tag) must
  // not retain a stale roster — default the fallback to an empty room.
  if (!Array.isArray(patch.scene_present) && sceneTag === null) patch.scene_present = [];
  return { narrative, patch };
}

export const clamp100 = (v) => Math.max(0, Math.min(100, Math.round(v)));

// v2 (R4): prune paid bills older than N sim-days (keeps totals sane; HUD filters !paid so it stays consistent).
export function prunePaidBills(sim, olderThanDays = 30) {
  if (!Array.isArray(sim?.finances?.bills)) return;
  const dc = Math.max(1, Math.round(sim.world.dayCount || 1));
  const before = sim.finances.bills.length;
  sim.finances.bills = sim.finances.bills.filter((b) => {
    if (!b.paid) return true;
    if (!isFiniteNum(b.paidDay)) return true; // unknown age: keep
    return (dc - b.paidDay) <= olderThanDays;
  });
  if (sim.finances.bills.length !== before) sim.updatedAt = Date.now();
}

// v2 (R5): auto-credit recurring income surviving model amnesia. Credits once per
// elapsed cadence, pushes a shortTerm payday memory, advances lastPaidDay.
// M9: catch-up completes in ONE bounded batch (no 24-payday deferral): every
// elapsed cadence is credited this turn, lastPaidDay advances idempotently, so
// income is never lost and never doubled on the next turn. The batch bound
// (10 years of daily paydays) only caps pathological gaps; the credited count
// and the lastPaidDay are always consistent. Documented deferral: none —
// long gaps credit in full on the next turn that runs this routine.
export const INCOME_CATCHUP_MAX = 3650; // max paydays credited per call (10y daily)
export function creditRecurringIncome(sim) {
  // Gate 4: body moved to src/core/economy.js (deterministic core); this
  // wrapper preserves the engine API (INCOME applier, app.js /pay, tests).
  creditIncome(sim);
}

// v2 (R4): find an existing NPC by id OR normalized name (kept for compat; new code
// should prefer resolvePersonKey which also links relationships).
function findNpc(sim, key) {
  if (!key) return null;
  const ks = String(key);
  if (isReservedKey(ks)) return null;
  if (hasOwn(sim.npcs, ks)) return sim.npcs[ks];
  const nk = normName(ks);
  return Object.values(sim.npcs || {}).find((n) => normName(n.name) === nk || normName(n.id) === nk) || null;
}
export function ensureRelationship(sim, name, role, trust, familiarity, emotion) {
  if (Object.values(sim.relationships || {}).find((r) => normName(r.name) === normName(name))) return;
  const rid = "r" + Date.now() + Math.floor(Math.random() * 999);
  sim.relationships[rid] = { id: rid, name: String(name).slice(0, 60), type: String(role || "পরিচিত").slice(0, 40), trust: clamp100(trust ?? 25), familiarity: clamp100(familiarity ?? 5), emotion: String(emotion || "নিরপেক্ষ").slice(0, 40), lastChange: "নতুন পরিচয়", lastDay: Math.max(1, Math.round(sim.world?.dayCount || 1)) };
}

// Issues #03/#05 (D1): one shared, pure, testable bill-payment routine.
// Policy: cash first, then bank for the remainder; atomic (full amount or nothing);
// balances never below 0. Returns {ok, bill, cashUsed, bankUsed}.
export function findBillForPayment(sim, key) {
  if (key == null) return null;
  const ks = String(key).trim();
  if (!ks) return null;
  const bills = (sim.finances?.bills || []).filter((b) => !b.paid);
  if (!bills.length) return null;
  let hit = bills.find((b) => b.id === ks) || bills.find((b) => b.name === ks);
  if (hit) return hit;
  // M13: normalize, then reject empty/zero-width queries — String.includes("")
  // is true for every bill, so an empty stripped key must never match.
  const nk = normName(ks).replace(/^(বিল|bill)\s+/i, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!nk || nk.length < 2) return null;
  hit = bills.find((b) => normName(b.name) === nk || normName(b.id) === nk);
  if (hit) return hit;
  const stripped = nk;
  hit = bills.find((b) => normName(b.name).includes(stripped) || stripped.includes(normName(b.name)));
  return hit || null;
}
export function payBillByKey(sim, key) {
  const b = findBillForPayment(sim, key);
  if (!b) { console.warn("[pay] bill not found:", key); return { ok: false, reason: "not-found" }; }
  // M9: non-finite bill amounts can never settle (a legacy Infinity must not mint).
  if (typeof b.amount === "number" && !isFiniteNum(b.amount)) { console.warn("[pay] non-finite bill amount rejected:", String(b.name).slice(0, 40)); return { ok: false, reason: "invalid-amount", bill: b }; }
  const amount = Math.max(0, Math.round(b.amount || 0));
  const cash = Math.max(0, Math.round(sim.finances.cash || 0));
  const bank = Math.max(0, Math.round(sim.finances.bank || 0));
  if (cash + bank < amount) {
    console.warn(`[pay] insufficient total for "${b.name}" (${amount}); have cash ${cash}+bank ${bank}.`);
    // M2: idempotent failure note — a second bills_paid attempt for the same
    // bill in the same beat must not push a duplicate shortTerm entry.
    const _note = `বিল পরিশোধ ব্যর্থ: “${String(b.name).slice(0, 60)}” (${amount}) — মোট টাকা কম ছিল।`;
    try {
      const _last = sim.memories.shortTerm[sim.memories.shortTerm.length - 1];
      if (!(_last && typeof _last.text === "string" && _last.text === _note)) {
        sim.memories.shortTerm.push({ day: sim.world.date, text: _note });
        while (sim.memories.shortTerm.length > 60) {
          const old = sim.memories.shortTerm.shift();
          sim.memories.longTerm.push({ day: old.day, text: old.text, faded: true });
        }
        if (sim.memories.longTerm.length > V2_LONGTERM_CAP) sim.memories.longTerm = sim.memories.longTerm.slice(-V2_LONGTERM_CAP);
      }
    } catch (_) {}
    return { ok: false, reason: "insufficient", bill: b };
  }
  const cashUsed = Math.min(cash, amount);
  const bankUsed = amount - cashUsed;
  sim.finances.cash = cash - cashUsed;
  sim.finances.bank = bank - bankUsed;
  b.paid = true;
  b.paidDay = Math.max(1, Math.round(sim.world.dayCount || 1));
  return { ok: true, bill: b, cashUsed, bankUsed };
}

export function windfallThreshold(sim) {
  const wealth = Math.max(0, Math.round(sim.finances?.cash || 0)) + Math.max(0, Math.round(sim.finances?.bank || 0));
  return Math.max(WINDFALL_BASE_THRESHOLD, wealth * WINDFALL_WEALTH_MULT);
}

// Issue #13: conservative canon-safe hygiene pass (merge -> compact -> drop).
// Never silently erases canon (chronicle/core), live NPC identities, or unpaid debts.
export function hygienePass(sim) {
  const dc = Math.max(1, Math.round(sim.world?.dayCount || 1));
  // C1: purge reserved/prototype keys that legacy polluted saves may carry as
  // own properties (JSON.parse creates own "__proto__" entries). Garbage only —
  // never canon — and future patches are rejected at the gate (isValidPatchKey).
  try {
    if (sim.relationships && typeof sim.relationships === "object") {
      for (const k of Object.keys(sim.relationships)) {
        if (isReservedKey(k)) { delete sim.relationships[k]; console.warn("[hygiene] removed reserved relationship key:", String(k).slice(0, 40)); }
      }
    }
    if (sim.npcs && typeof sim.npcs === "object") {
      for (const k of Object.keys(sim.npcs)) {
        if (isReservedKey(k)) { delete sim.npcs[k]; console.warn("[hygiene] removed reserved npc key:", String(k).slice(0, 40)); }
      }
    }
  } catch (_) {}
  // storylines: cap total, prune oldest CLOSED beyond cap (active never auto-dropped)
  if (Array.isArray(sim.storylines) && sim.storylines.length > STORYLINES_MAX_SIM) {
    const closed = sim.storylines.filter((s) => s.active === false).sort((a, b) => (a.closedDay ?? 1) - (b.closedDay ?? 1));
    const over = sim.storylines.length - STORYLINES_MAX_SIM;
    // C2: prune by object identity (legacy closed entries share undefined ids;
    // an id-based Set would match every id-less entry including active ones).
    const dropSet = new Set(closed.slice(0, over));
    if (dropSet.size) sim.storylines = sim.storylines.filter((s) => !dropSet.has(s));
  }
  // relationships: merge duplicates by resolved person, then cap by relevance
  if (sim.relationships && typeof sim.relationships === "object") {
    const seen = new Map();
    for (const [id, r] of Object.entries(sim.relationships)) {
      const k = normName(r.name);
      if (!seen.has(k)) { seen.set(k, r); continue; }
      // duplicate: keep the stronger/more recent record
      const keep = seen.get(k);
      const score = (x) => (x.trust || 0) + (x.familiarity || 0) + ((x.lastDay || 1) / 1000);
      const winner = score(r) >= score(keep) ? r : keep;
      const loserId = (winner === r) ? keep.id : r.id;
      // merge notes
      if (r.lastChange && winner.lastChange !== r.lastChange) winner.lastChange = String(r.lastChange).slice(0, 200);
      winner.trust = Math.max(winner.trust || 0, r.trust || 0);
      winner.familiarity = Math.max(winner.familiarity || 0, r.familiarity || 0);
      winner.lastDay = Math.max(winner.lastDay || 1, r.lastDay || 1);
      delete sim.relationships[loserId];
      seen.set(k, winner);
    }
    const ids = Object.keys(sim.relationships);
    if (ids.length > REL_MAX_SIM) {
      // R5 flag: hygiene must still protect the controlled person's relationship
      // (they are live in the HUD even though prompt lists exclude them).
      const liveNames = new Set(Object.values(sim.npcs || {}).filter((n) => !n.inactive).map((n) => normName(n.name)));
      const scored = ids.map((id) => {
        const r = sim.relationships[id];
        const live = liveNames.has(normName(r.name));
        const s = (live ? 10000 : 0) + (r.familiarity || 0) / 10 + (r.trust || 0) / 20 + ((r.lastDay || 1) / 10000);
        return { id, s };
      }).sort((a, b) => a.s - b.s);
      const dropN = ids.length - REL_MAX_SIM;
      // M18: walk the ranked list until the quota is met (protected live names
      // are skipped but do not consume the quota).
      let removed = 0;
      for (const cand of scored) {
        if (removed >= dropN) break;
        const r = safeGet(sim.relationships, cand.id);
        if (!r) continue;
        if (liveNames.has(normName(r.name))) continue; // never drop live-scene relationships
        delete sim.relationships[cand.id];
        removed++;
      }
    }
  }
  // NPCs: never delete identity; compact long-inactive memory bulk.
  // M11: the NPC_MEMORY_MAX hard bound applies to ALL NPCs (active included);
  // only the deeper 90-day compaction stays inactive-only.
  for (const npc of Object.values(sim.npcs || {})) {
    if (!npc || typeof npc !== "object") continue;
    if (Array.isArray(npc.memory) && npc.memory.length > NPC_MEMORY_MAX) npc.memory = npc.memory.slice(-NPC_MEMORY_MAX);
    if (!npc.inactive) continue;
    const exitD = isFiniteNum(npc.exitDay) ? npc.exitDay : dc;
    if ((dc - exitD) > NPC_COMPACT_AFTER_DAYS && Array.isArray(npc.memory) && npc.memory.length > NPC_MEMORY_COMPACT_KEEP) {
      // Gate 5: compaction is SUMMARISATION, not deletion — capture the
      // archive (endpoints + count + journal event index, all derived) BEFORE
      // trimming. Identity/psych/mind/exit notes are never touched (I4/I5);
      // only npc.archive is ADDED and memory bulk trimmed (legacy behavior).
      try {
        npc.archive = buildArchive(npc, eventsForNpc(Array.isArray(sim.journal) ? sim.journal : [], npc), dc);
      } catch (_) {}
      npc.memory = npc.memory.slice(-NPC_MEMORY_COMPACT_KEEP);
    }
  }
  // Living World: conditions/experiences dedupe + caps (conservative, newest kept).
  try {
    if (sim.persona && typeof sim.persona === "object") {
      for (const [field, mx, cap] of [["conditions", CONDITION_TEXT_MAX, CONDITION_MAX], ["experiences", EXPERIENCE_TEXT_MAX, EXPERIENCE_MAX]]) {
        const arr = sim.persona[field];
        if (!Array.isArray(arr)) { sim.persona[field] = []; continue; }
        const seen = new Set(); const out = [];
        for (const x of arr) {
          if (typeof x !== "string") continue;
          const t = x.trim().slice(0, mx);
          if (!t) continue;
          const k = normName(t);
          if (seen.has(k)) continue;
          seen.add(k); out.push(t);
        }
        sim.persona[field] = out.slice(-cap);
      }
      if (typeof sim.world.pulse === "string" && sim.world.pulse.length > WORLD_PULSE_MAX) sim.world.pulse = sim.world.pulse.slice(0, WORLD_PULSE_MAX);
    }
  } catch (_) {}
  // Authoritative roster hygiene: dedupe + drop unknown/inactive/controlled ids.
  try {
    if (sim.world && typeof sim.world === "object" && Array.isArray(sim.world.present)) {
      const seen = new Set(); const out = [];
      for (const id of sim.world.present) {
        if (typeof id !== "string" || !id || seen.has(id)) continue;
        if (isReservedKey(id)) continue;
        const npc = safeGet(sim.npcs || {}, id);
        if (!npc || npc.inactive || npc.controlled) continue;
        seen.add(id); out.push(id);
      }
      sim.world.present = out;
    }
  } catch (_) {}
  // inventory: already merged on add; cap distinct entries by lowest-qty oldest first
  if (Array.isArray(sim.inventory) && sim.inventory.length > INV_MAX_DISTINCT) {
    const sorted = sim.inventory.map((it, idx) => ({ it, idx })).sort((a, b) => (a.it.qty - b.it.qty) || (a.idx - b.idx));
    const dropN = sim.inventory.length - INV_MAX_DISTINCT;
    const dropSet = new Set(sorted.slice(0, dropN).map((x) => x.it));
    sim.inventory = sim.inventory.filter((it) => !dropSet.has(it));
    console.warn(`[hygiene] inventory capped: dropped ${dropN} lowest-qty clutter entries.`);
  }
}

// Gate 3: thin wrapper over the explicit pipeline (src/apply/). Every block of
// the old monolith now lives in exactly one registry entry, executed in the
// same order with the same shared scratch state (ctx) — byte-identical.
// (sim, patch, isSkip = false): Function.length is 2 (params before the first
// default), exactly as before. The optional 4th skip-cap argument is forwarded
// with its presence flag (an explicit undefined still counts as present,
// matching the old `arguments.length > 3` read).
export function applyPatch(sim, patch, isSkip = false) {
  const hasFourth = arguments.length > 3;
  runPipeline(sim, patch, isSkip, {
    fourth: hasFourth ? arguments[3] : undefined,
    hasFourth,
  });
}

export function advanceTime(sim, mins) {
  // Gate 4: body moved to src/core/time.js (deterministic core); this wrapper
  // preserves the engine API (TIME applier, app.js, tests call through).
  return advanceCalendar(sim, mins);
}

export function headerString(sim) {
  return `📅 ${bnDigits(sim.world.date)} | ⏰ ${bnDigits(fmtTime(sim.world.timeMin))} | 📍 ${sim.world.location}`;
}

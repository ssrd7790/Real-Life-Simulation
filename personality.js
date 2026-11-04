// NPC psychology engine: stable traits vs temporary states vs observable behavior.
// Internal data — NEVER shown to the player (fog of war). Only the model sees it.
import { synthesizeFromSave } from "./core/events.js";

// 16 stable traits, 0-100. High = strong tendency, not a caricature.
export const TRAIT_KEYS = [
  "greed", "jealousy", "lust", "anger", "pride", "envy",
  "manipulativeness", "deceitfulness", "possessiveness", "impulsiveness",
  "insecurity", "cruelty", "empathy", "loyalty", "honesty", "self_control",
];
export const TRAIT_BN = {
  greed: "লোভ", jealousy: "ঈর্ষা", lust: "কামনা", anger: "রাগ", pride: "অহংকার",
  envy: "পরশ্রীকাতরতা", manipulativeness: "কারসাজি", deceitfulness: "প্রতারণা",
  possessiveness: "অধিকারবোধ", impulsiveness: "হঠকারিতা", insecurity: "নিরাপত্তাহীনতা",
  cruelty: "নিষ্ঠুরতা", empathy: "সহানুভূতি", loyalty: "আনুগত্য", honesty: "সততা",
  self_control: "আত্মসংযম",
};

// Temporary emotional states, 0-100. Change with events; decay over time.
export const STATE_KEYS = ["anger", "fear", "sadness", "joy", "desire", "suspicion", "stress", "affection"];
export const STATE_BN = {
  anger: "ক্রোধ", fear: "ভয়", sadness: "দুঃখ", joy: "আনন্দ",
  desire: "আকাঙ্ক্ষা", suspicion: "সন্দেহ", stress: "চাপ", affection: "স্নেহ",
};

// Living World: NPC inner life (player-invisible). No meters, just short Bengali
// private monologue + agenda + off-screen activity. Tunable maxima in one place.
export const MIND_THOUGHT_MAX = 160; // private unspoken feeling / monologue
export const MIND_INTENT_MAX = 140;  // immediate agenda / what they want or hide
export const MIND_DOING_MAX = 120;   // off-screen life when not with the player
export const WORLD_PULSE_MAX = 220;  // neighborhood atmosphere / rumors line
export const CONDITION_MAX = 8;       // active body/mind conditions on persona
export const CONDITION_TEXT_MAX = 80;
export const EXPERIENCE_MAX = 12;     // lived competences / local standing
export const EXPERIENCE_TEXT_MAX = 100;
export const LOC_FACTS_MAX = 200;      // world.locationFacts: physical layout lock (Bengali)

// Anti-hallucination: persistent physical layout lock for the current place.
// Short Bengali truth (rooms/floors/furniture/boundaries) — never extra stairs
// or bedrooms beyond this. Derived from socialClass + location keywords so old
// saves and custom starts get a sensible lock without hardcoded item rules.
export function defaultLocationFacts(location, socialClass) {
  const loc = String(location || "");
  const cls = String(socialClass || "");
  const has = (...frags) => frags.some((f) => loc.includes(f) || cls.includes(f));
  let s = "";
  if (has("সি-ফেসিং", "বান্দ্রা") || cls.includes("উচ্চবিত্ত")) {
    s = "সি-ফেসিং ফ্ল্যাট: ড্রয়িং-ডাইনিং, ৩ বেডরুম, সমুদ্রমুখী বারান্দা; লিফট-গেট আছে, ঘরের ভেতর বাড়তি সিঁড়ি নেই।";
  } else if (has("মেস") || cls.includes("নিম্ন-মধ্যবিত্ত")) {
    s = "মেসের এক ঘর: দুটো চৌকি, ফ্যান, যৌথ রান্নাঘর-বাথরুম; আলাদা বেডরুম বা সিঁড়ি নেই।";
  } else if (cls.includes("নিম্নবিত্ত") || has("ভাড়া ঘর", "শিয়ালদহ")) {
    s = "এক কামরার ভাড়া ঘর: একটাই ঘর আর রান্নার জায়গা, বাইরে যৌথ বাথরুম; সিঁড়ি বা আলাদা বেডরুম নেই।";
  } else if (cls.includes("উচ্চ-মধ্যবিত্ত")) {
    s = "শহুরে ফ্ল্যাট: ড্রয়িং, ২-৩ বেডরুম, বারান্দা; সিঁড়ি কমন, ঘরের ভেতর বাড়তি তলা নেই।";
  } else if (cls.includes("মধ্যবিত্ত") || has("বেলঘরিয়া", "বাড়ি")) {
    s = "ছোট ফ্ল্যাট/বাড়ি: ২ ঘর, রান্নাঘর, বাথরুম; ওপরতলা বা লিফট নেই।";
  } else if (has("ফ্ল্যাট")) {
    s = "শহুরে ফ্ল্যাট: ড্রয়িং, ২ বেডরুম, রান্নাঘর-বাথরুম; ঘরের ভেতর বাড়তি সিঁড়ি নেই।";
  } else {
    s = "ছোট ভাড়া বাসা: এক-দুটো ঘর, রান্নাঘর-বাথরুম; বাড়তি তলা বা সিঁড়ি নেই।";
  }
  return s.slice(0, LOC_FACTS_MAX);
}

const _sliceMind = (v, n, fb) => {
  const s = String(v ?? "").trim();
  if (!s) return fb;
  return s.slice(0, n);
};
// Deterministic backfill from existing bio — zero PRNG, zero trait-hash drift.
// Uses privateReality/goals as seed context; never calls profileFor().
export function defaultMind(npc) {
  const priv = String(npc?.privateReality || "").trim();
  const goals = String(npc?.goals || "").trim();
  return {
    thought: (priv ? priv : "মনে মনে নিজের সুবিধা-অসুবিধা মাপছে।").slice(0, MIND_THOUGHT_MAX),
    intent: (goals ? goals : "নিজের কাজ ঠিকঠাক রাখা।").slice(0, MIND_INTENT_MAX),
    doing: "নিজের দৈনন্দিন কাজে ব্যস্ত।".slice(0, MIND_DOING_MAX),
  };
}
export function ensureNpcMind(npc) {
  if (!npc || typeof npc !== "object") return false;
  let touched = false;
  if (!npc.mind || typeof npc.mind !== "object" || Array.isArray(npc.mind)) {
    npc.mind = defaultMind(npc);
    return true;
  }
  const d = defaultMind(npc);
  for (const [k, mx] of [["thought", MIND_THOUGHT_MAX], ["intent", MIND_INTENT_MAX], ["doing", MIND_DOING_MAX]]) {
    const v = npc.mind[k];
    if (typeof v !== "string") { npc.mind[k] = d[k]; touched = true; }
    else if (v.length > mx) { npc.mind[k] = v.slice(0, mx); touched = true; }
  }
  return touched;
}

// Issue #08: age + romance gating constants (tunable in one place).
// Why these values: ADULT_AGE=18 is the hard safety rule; age range 0-120 covers
// plausible human ages. Confirmed adulthood (age >= 18) is the sole criterion
// for carrying a romance profile; minors (<18) and unconfirmed (null) never do.
export const ADULT_AGE = 18;
export const NPC_AGE_MIN = 0;
export const NPC_AGE_MAX = 120;

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

// Deterministic hash so the same NPC always migrates to the same profile.
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function jitter(rand, amt) {
  return () => Math.round((rand() * 2 - 1) * amt);
}

// Role archetypes: which traits run high/low for this kind of person.
const ARCHETYPES = [
  { match: ["মালিক", "landlord", "বাড়িওয়ালা"], high: { greed: 75, pride: 65, anger: 55 }, low: { empathy: 30 } },
  { match: ["দোকানদার", "shop", "ব্যবসায়ী", "ব্যবসা"], high: { greed: 70, manipulativeness: 60, pride: 60 }, low: { honesty: 40 } },
  { match: ["অংশীদার", "partner", "সাহেব", "বস", "supervisor", "সুপারভাইজার", "মালিক"], high: { greed: 70, pride: 70, manipulativeness: 60 }, low: { loyalty: 35 } },
  { match: ["স্ত্রী", "স্বামী", "wife", "husband", "প্রেমিক", "প্রেমিকা", "বন্ধু", "friend"], high: { loyalty: 70, empathy: 65 }, low: { cruelty: 20 } },
  { match: ["বাবা", "মা", "father", "mother", "parent"], high: { loyalty: 80, pride: 60, empathy: 60 }, low: { cruelty: 15 } },
  { match: ["ভাই", "বোন", "sibling"], high: { loyalty: 65, envy: 55 }, low: {} },
  { match: ["পুলিশ", "মাস্তান", "গুণ্ডা", "নেতা"], high: { anger: 75, pride: 75, cruelty: 55 }, low: { empathy: 25 } },
];

export function baseTraits() {
  return {
    greed: 45, jealousy: 40, lust: 45, anger: 45, pride: 50, envy: 40,
    manipulativeness: 35, deceitfulness: 35, possessiveness: 40, impulsiveness: 45,
    insecurity: 50, cruelty: 25, empathy: 55, loyalty: 55, honesty: 55, self_control: 50,
  };
}

// Build a DISTINCT profile from role/background/name. Never identical across NPCs.
export function profileFor(npc) {
  const t = baseTraits();
  const hay = `${npc.role || ""} ${npc.background || ""} ${npc.personality || ""}`.toLowerCase();
  // v2 (bug 6): longest-keyword-first matching — pick the archetype whose longest
  // matched keyword is longest (e.g. "ব্যবসায়িক অংশীদার" beats "ব্যবসা" shopkeeper).
  let best = null, bestLen = -1;
  for (const a of ARCHETYPES) {
    let ml = -1;
    for (const m of a.match) { if (hay.includes(m.toLowerCase())) ml = Math.max(ml, m.length); }
    if (ml > bestLen) { bestLen = ml; best = a; }
  }
  if (best) {
    for (const [k, v] of Object.entries(best.high)) t[k] = v;
    for (const [k, v] of Object.entries(best.low)) t[k] = v;
  }
  let seed = hashStr(npc.id + "|" + npc.name) || 1;
  const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  const j = jitter(rand, 16);
  for (const k of TRAIT_KEYS) t[k] = clamp(t[k] + j());
  // force contrast: pick 1-2 signature spikes and 1 soft spot so no two NPCs match
  const r1 = TRAIT_KEYS[Math.floor(rand() * TRAIT_KEYS.length)];
  t[r1] = clamp(t[r1] + 20 + Math.floor(rand() * 15));
  if (rand() < 0.7) {
    const soft = ["empathy", "loyalty", "honesty", "cruelty", "self_control"][Math.floor(rand() * 5)];
    const delta = 15 + Math.floor(rand() * 15);
    t[soft] = soft === "cruelty" ? clamp(t[soft] - delta) : clamp(t[soft] + delta);
  }
  return t;
}

export function baseStates() {
  return { anger: 10, fear: 10, sadness: 15, joy: 40, desire: 10, suspicion: 10, stress: 25, affection: 30 };
}

// R1 (safety): confirmed minors can never carry lust/desire psychologically.
// Why: attraction circuitry must be architecturally impossible for <18 —
// zero the numbers in state (not just hide them) so no prompt or merge can revive them.
export const MINOR_LUST_VALUE = 0;
export const MINOR_DESIRE_VALUE = 0;

// Issue #08: age helpers. Age is number|null; null/missing/invalid = unconfirmed.
export function normalizeNpcAge(v) {
  if (typeof v !== "number" || !isFinite(v) || isNaN(v)) return null;
  const r = Math.round(v);
  if (r < NPC_AGE_MIN || r > NPC_AGE_MAX) return null;
  return r;
}
export function isConfirmedAdult(npcOrAge) {
  const a = (npcOrAge && typeof npcOrAge === "object") ? npcOrAge.age : npcOrAge;
  return typeof a === "number" && isFinite(a) && Math.round(a) >= ADULT_AGE;
}
export function isMinorNpc(npcOrAge) {
  const a = (npcOrAge && typeof npcOrAge === "object") ? npcOrAge.age : npcOrAge;
  return typeof a === "number" && isFinite(a) && Math.round(a) < ADULT_AGE && Math.round(a) >= NPC_AGE_MIN;
}
// Romance is architecturally possible only for confirmed adults (age >= 18).
// Role/occupation labels never gate romance: adult status is the sole criterion.
export function shouldIncludeRomance(npc) {
  if (!npc || !isConfirmedAdult(npc)) return false;
  return true;
}

export function defaultRomance(npc) {
  // Caller must gate via shouldIncludeRomance; this stays pure/deterministic.
  const seed = hashStr("rom|" + npc.id + npc.name) || 7;
  const openness = 20 + (seed % 61); // 20-80
  return {
    openness,
    attractions: "",
    boundaries: "অসম্মতিতে না; জোরাজুরিতে সরে যায়।",
  };
}

// Migrate an old-save NPC (no profile) without rewriting its history.
export function migrateNpc(npc) {
  let touched = false;
  // C1: local own-property helper (no engine import — avoids circular import).
  const _hasOwn = (o, k) => { try { return !!o && typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k); } catch (_) { return false; } };
  if (!npc.core_traits || typeof npc.core_traits !== "object") { npc.core_traits = profileFor(npc); touched = true; }
  else { for (const k of TRAIT_KEYS) if (typeof npc.core_traits[k] !== "number") npc.core_traits[k] = 50; }
  if (!npc.states || typeof npc.states !== "object") { npc.states = baseStates(); touched = true; }
  // v2 (bug 5): backfill missing states from baseStates() (joy base is 40, not 10).
  else { const b = baseStates(); for (const k of STATE_KEYS) if (typeof npc.states[k] !== "number") { npc.states[k] = b[k]; touched = true; } }
  // Issue #08: age backfill + romance gating. Unknown means romance-off, never assume adult.
  if (!_hasOwn(npc, "age") || normalizeNpcAge(npc.age) === null) {
    // Distinguish explicit minor (number <18 kept) from missing/invalid (null).
    if (typeof npc.age === "number" && isFinite(npc.age) && Math.round(npc.age) >= NPC_AGE_MIN && Math.round(npc.age) <= NPC_AGE_MAX) {
      npc.age = Math.round(npc.age);
    } else {
      if (npc.age !== null && npc.age !== undefined) { /* invalid -> null */ }
      npc.age = null;
      touched = true;
    }
  } else {
    npc.age = normalizeNpcAge(npc.age);
  }
  if (!shouldIncludeRomance(npc)) {
    if (_hasOwn(npc, "romance") && npc.romance != null) { delete npc.romance; touched = true; }
  } else {
    if (!npc.romance || typeof npc.romance !== "object") { npc.romance = defaultRomance(npc); touched = true; }
  }
  // R1: confirmed minors are architecturally non-sexual — zero lust/desire in state.
  if (isMinorNpc(npc)) {
    if (!npc.core_traits || typeof npc.core_traits !== "object") npc.core_traits = baseTraits();
    if (npc.core_traits.lust !== MINOR_LUST_VALUE) { npc.core_traits.lust = MINOR_LUST_VALUE; touched = true; }
    if (!npc.states || typeof npc.states !== "object") npc.states = baseStates();
    if (npc.states.desire !== MINOR_DESIRE_VALUE) { npc.states.desire = MINOR_DESIRE_VALUE; touched = true; }
  }
  if (!Array.isArray(npc.memory)) npc.memory = [];
  // v2 (R4): inactive/exitNote default for old saves.
  if (typeof npc.inactive !== "boolean") { npc.inactive = false; touched = true; }
  if (typeof npc.exitNote !== "string") { npc.exitNote = ""; touched = true; }
  // Issue #13: inactivity age for compaction (null = never exited / still active).
  // M10: only mark touched when the value actually changes (idempotence).
  if (typeof npc.exitDay !== "number" || isNaN(npc.exitDay)) {
    const _wantExit = npc.inactive ? 1 : null;
    if (npc.exitDay !== _wantExit) { npc.exitDay = _wantExit; touched = true; }
  }
  // Living World: player-invisible inner life. Deterministic backfill from
  // privateReality/goals only — never touches profileFor PRNG, so existing
  // trait hashes stay 100% identical on old saves.
  try { if (ensureNpcMind(npc)) touched = true; } catch (_) {}
  // M6: intake caps for unbounded legacy/imported bio strings (presets are far
  // shorter, so well-formed saves are byte-identical). Guards the prompt budget
  // and blocks @@STATE@@/JSON injection via bio fields at the source.
  try {
    const _cap = (v, mx) => (typeof v === "string" && v.length > mx ? v.slice(0, mx) : v);
    for (const [f, mx] of [["name", 60], ["role", 60], ["emotion", 40]]) {
      if (typeof npc[f] === "string" && npc[f].length > mx) { npc[f] = npc[f].slice(0, mx); touched = true; }
    }
    for (const f of ["background", "personality"]) {
      const c = _cap(npc[f], 500);
      if (c !== npc[f]) { npc[f] = c; touched = true; }
    }
    for (const f of ["publicPersona", "privateReality", "secrets", "goals"]) {
      const c = _cap(npc[f], 300);
      if (c !== npc[f]) { npc[f] = c; touched = true; }
    }
    if (npc.romance && typeof npc.romance === "object") {
      for (const f of ["attractions", "boundaries"]) {
        const c = _cap(npc.romance[f], 200);
        if (typeof npc.romance[f] === "string" && c !== npc.romance[f]) { npc.romance[f] = c; touched = true; }
      }
    }
    // C3: normalize legacy NPC memory entry shapes (bare strings stay strings;
    // objects/null coerce to their text). Caps each line at 300 (patch rail).
    if (Array.isArray(npc.memory)) {
      let dirty = false;
      const norm = npc.memory.map((m) => {
        if (typeof m === "string") return m.length > 300 ? (dirty = true, m.slice(0, 300)) : m;
        if (m && typeof m === "object" && typeof m.text === "string") { dirty = true; return m.text.slice(0, 300); }
        if (m == null) { dirty = true; return ""; }
        dirty = true; return String(m).slice(0, 300);
      }).filter((m) => typeof m === "string" && m.length > 0);
      if (dirty || norm.length !== npc.memory.length) { npc.memory = norm.slice(-20); touched = true; }
    }
  } catch (_) {}
  return touched;
}

export function migrateSim(sim) {
  let touched = false;
  if (!sim.npcs) sim.npcs = {};
  for (const npc of Object.values(sim.npcs)) if (migrateNpc(npc)) touched = true;
  // R5 flag helpers (local to avoid engine circular import).
  const _norm = (s) => String(s ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
  // C1/M10: own-property checks (never the `in` operator over polluted prototypes).
  const _hasOwn = (o, k) => { try { return !!o && typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k); } catch (_) { return false; } };
  const _isResKey = (k) => { try { if (typeof k !== "string") return true; if (k === "__proto__" || k === "constructor" || k === "prototype") return true; return (k in Object.prototype); } catch (_) { return true; } };
  // Living World: neighborhood pulse (single atmosphere line, player-visible
  // only through narration). Old saves get "".
  try {
    if (sim.world && typeof sim.world === "object") {
      if (sim.world.phoneCall === undefined) { sim.world.phoneCall = null; touched = true; }
      else if (typeof sim.world.phoneCall !== "string" && sim.world.phoneCall !== null) { sim.world.phoneCall = null; touched = true; }
      if (typeof sim.world.pulse !== "string") { sim.world.pulse = ""; touched = true; }
      else if (sim.world.pulse.length > WORLD_PULSE_MAX) { sim.world.pulse = sim.world.pulse.slice(0, WORLD_PULSE_MAX); touched = true; }
      // Anti-hallucination: persistent physical layout lock (Bengali, <=200).
      if (typeof sim.world.locationFacts !== "string" || !sim.world.locationFacts.trim()) {
        try { sim.world.locationFacts = defaultLocationFacts(sim.world.location, sim.persona?.socialClass); } catch (_) { sim.world.locationFacts = ""; }
        touched = true;
      } else if (sim.world.locationFacts.length > LOC_FACTS_MAX) { sim.world.locationFacts = sim.world.locationFacts.slice(0, LOC_FACTS_MAX); touched = true; }
    }
  } catch (_) {}
  // Living World: organic condition/experience backfill (persona-scoped, no meters).
  const _cleanStrArr = (arr, mx, cap) => {
    const seen = new Set(); const out = [];
    for (const x of arr) {
      if (typeof x !== "string") continue;
      const t = x.trim().slice(0, mx);
      if (!t) continue;
      const k = _norm(t);
      if (seen.has(k)) continue;
      seen.add(k); out.push(t);
    }
    return out.slice(-cap);
  };
  try {
    if (sim.persona && typeof sim.persona === "object") {
      if (!Array.isArray(sim.persona.conditions)) { sim.persona.conditions = []; touched = true; }
      else {
        const c = _cleanStrArr(sim.persona.conditions, CONDITION_TEXT_MAX, CONDITION_MAX);
        if (c.length !== sim.persona.conditions.length || c.some((v, i) => v !== sim.persona.conditions[i])) { sim.persona.conditions = c; touched = true; }
      }
      if (!Array.isArray(sim.persona.experiences)) { sim.persona.experiences = []; touched = true; }
      else {
        const e = _cleanStrArr(sim.persona.experiences, EXPERIENCE_TEXT_MAX, EXPERIENCE_MAX);
        if (e.length !== sim.persona.experiences.length || e.some((v, i) => v !== sim.persona.experiences[i])) { sim.persona.experiences = e; touched = true; }
      }
    }
  } catch (_) {}
  // v2 (bug 2): presets used persona.traits for display string arrays; the engine
  // uses persona.traits as the 16-key numeric profile. String arrays passed the old
  // typeof check and were kept, corrupting /swap. Fix: move string arrays to
  // traitLabels, replace any non-numeric shape with a real profile.
  if (sim.persona) {
    if (Array.isArray(sim.persona.traits)) {
      if (!Array.isArray(sim.persona.traitLabels)) sim.persona.traitLabels = sim.persona.traits.slice(0, 12);
      sim.persona.traits = profileFor({ id: "player", name: sim.persona.name, role: sim.persona.occupation, background: sim.persona.background, personality: sim.persona.personality });
      touched = true;
    } else if (!sim.persona.traits || typeof sim.persona.traits !== "object") {
      sim.persona.traits = profileFor({ id: "player", name: sim.persona.name, role: sim.persona.occupation, background: sim.persona.background, personality: sim.persona.personality });
      touched = true;
    } else {
      let bad = false;
      for (const k of TRAIT_KEYS) if (typeof sim.persona.traits[k] !== "number") { bad = true; break; }
      if (bad) {
        sim.persona.traits = profileFor({ id: "player", name: sim.persona.name, role: sim.persona.occupation, background: sim.persona.background, personality: sim.persona.personality });
        touched = true;
      }
    }
    // v2 (R3): age baseline for old saves (currentAge = baseAge + elapsed years).
    if (typeof sim.persona.baseAge !== "number" || isNaN(sim.persona.baseAge)) { sim.persona.baseAge = Math.max(18, Math.round(sim.persona.age) || 25); touched = true; }
    if (typeof sim.persona.baseDay !== "number" || isNaN(sim.persona.baseDay)) { sim.persona.baseDay = 1; touched = true; }
    // Issue #07/#08: persona states + romance backfill (legally-applicable only).
    if (!sim.persona.states || typeof sim.persona.states !== "object") {
      // Player temp states default like NPC base; old saves get them silently.
      sim.persona.states = baseStates();
      touched = true;
    } else {
      const b = baseStates();
      for (const k of STATE_KEYS) if (typeof sim.persona.states[k] !== "number") { sim.persona.states[k] = b[k]; touched = true; }
    }
    if (!_hasOwn(sim, "personaRomanceEligible")) { /* marker not needed */ }
    // Persona romance: only if persona age adult; player age always >=18 via UI/migration.
    const pAge = (typeof sim.persona.baseAge === "number") ? sim.persona.baseAge : sim.persona.age;
    if (typeof pAge === "number" && Math.round(pAge) >= ADULT_AGE) {
      if (!sim.persona.romance || typeof sim.persona.romance !== "object") {
        sim.persona.romance = { openness: 40, attractions: "", boundaries: "অসম্মতিতে না।" };
        touched = true;
      }
    } else if (sim.persona.romance != null) {
      delete sim.persona.romance;
      touched = true;
    }
  }
  // v2 (R1/R4/R5): backfill new optional fields (old saves keep working, no history touch).
  if (!Array.isArray(sim.chronicle)) { sim.chronicle = []; touched = true; }
  if (!sim.memories) { sim.memories = { core: [], shortTerm: [], longTerm: [] }; touched = true; }
  if (!Array.isArray(sim.memories.core)) { sim.memories.core = []; touched = true; }
  if (!Array.isArray(sim.memories.shortTerm)) { sim.memories.shortTerm = []; touched = true; }
  if (!Array.isArray(sim.memories.longTerm)) { sim.memories.longTerm = []; touched = true; }
  // C3: normalize legacy memory entry shapes (shortTerm bare strings / nulls ->
  // {day,text} objects; core objects -> plain strings). Rendering (app.js
  // renderHUD/coreBlock) is additionally tolerant, but the canonical shape is
  // enforced here so every downstream reader sees documented objects.
  try {
    const _day = (() => { try { return String(sim.world?.date || "15/08"); } catch (_) { return "15/08"; } })();
    if (Array.isArray(sim.memories.shortTerm) && sim.memories.shortTerm.some((m) => typeof m !== "object" || m === null || typeof m.text !== "string")) {
      sim.memories.shortTerm = sim.memories.shortTerm.map((m) => {
        if (m && typeof m === "object" && typeof m.text === "string") {
          if (typeof m.day !== "string" && typeof m.day !== "number") return { day: _day, text: String(m.text).slice(0, 500) };
          return m;
        }
        if (typeof m === "string") return { day: _day, text: m.slice(0, 500) };
        if (m == null) return { day: _day, text: "" };
        return { day: _day, text: String(m.text ?? m).slice(0, 500) };
      }).filter((m) => m && typeof m.text === "string" && m.text.length > 0);
      touched = true;
    }
    if (Array.isArray(sim.memories.longTerm) && sim.memories.longTerm.some((m) => typeof m !== "object" || m === null || typeof m.text !== "string")) {
      sim.memories.longTerm = sim.memories.longTerm.map((m) => {
        if (m && typeof m === "object" && typeof m.text === "string") return m;
        if (typeof m === "string") return { day: _day, text: m.slice(0, 500), faded: true };
        if (m == null) return null;
        return { day: _day, text: String(m.text ?? m).slice(0, 500), faded: true };
      }).filter((m) => m && typeof m.text === "string" && m.text.length > 0);
      touched = true;
    }
    if (Array.isArray(sim.memories.core) && sim.memories.core.some((c) => typeof c !== "string")) {
      sim.memories.core = sim.memories.core.map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object" && typeof c.text === "string") return c.text.slice(0, 220);
        if (c == null) return "";
        return String(c).slice(0, 220);
      }).filter((c) => typeof c === "string" && c.length > 0);
      touched = true;
    }
  } catch (_) {}
  if (!_hasOwn(sim, "income")) { sim.income = null; touched = true; }
  if (!Array.isArray(sim.storylines)) { sim.storylines = []; touched = true; }
  for (const s of sim.storylines) {
    if (typeof s.active !== "boolean") { s.active = true; touched = true; }
    // Issue #13: closedDay for age-based pruning (null = open/unknown).
    if (typeof s.closedDay !== "number" || isNaN(s.closedDay)) {
      s.closedDay = (s.active === false) ? 1 : null;
      if (s.active === false) touched = true;
    }
  }
  if (!sim.relationships) sim.relationships = {};
  for (const r of Object.values(sim.relationships)) {
    // Issue #13: lightweight recency touch.
    if (typeof r.lastDay !== "number" || isNaN(r.lastDay)) { r.lastDay = 1; touched = true; }
  }
  if (sim.finances && Array.isArray(sim.finances.bills)) {
    for (const b of sim.finances.bills) {
      if (!_hasOwn(b, "paidDay")) { b.paidDay = b.paid ? Math.max(1, Math.round(sim.world?.dayCount || 1)) : null; touched = true; }
    }
  }
  // Issue #10: incapacitated/critical backfill (additive, never corrupts old readers).
  if (!sim.critical || typeof sim.critical !== "object") { sim.critical = { active: false, sinceDay: null }; touched = true; }
  else {
    if (typeof sim.critical.active !== "boolean") { sim.critical.active = false; touched = true; }
    if (sim.critical.active && (typeof sim.critical.sinceDay !== "number" || isNaN(sim.critical.sinceDay))) { sim.critical.sinceDay = Math.max(1, Math.round(sim.world?.dayCount || 1)); touched = true; }
  }
  // R3: fractional physiology-drain accumulator (additive float; old saves start at 0).
  if (typeof sim.healthDrainAcc !== "number" || isNaN(sim.healthDrainAcc)) { sim.healthDrainAcc = 0; touched = true; }
  // Issue #07: model-facing history boundary (0 = no swap yet, show all).
  if (typeof sim.historyCutoff !== "number" || isNaN(sim.historyCutoff)) { sim.historyCutoff = 0; touched = true; }
  if (!sim.characters || typeof sim.characters !== "object") { sim.characters = {}; touched = true; }
  else {
    // Legacy sheets (persona/stats/finances/inventory/memories only) still swap safely.
    for (const sheet of Object.values(sim.characters)) {
      if (!sheet || typeof sheet !== "object") continue;
      if (!_hasOwn(sheet, "income")) { sheet.income = null; touched = true; }
      if (!Array.isArray(sheet.chronicle)) { sheet.chronicle = []; touched = true; }
      if (!sheet.persona) continue;
      if (typeof sheet.persona.baseAge !== "number" || isNaN(sheet.persona.baseAge)) { sheet.persona.baseAge = Math.max(18, Math.round(sheet.persona.age) || 25); touched = true; }
      if (typeof sheet.persona.baseDay !== "number" || isNaN(sheet.persona.baseDay)) { sheet.persona.baseDay = 1; touched = true; }
      // Living World: stashed sheets travel conditions/experiences like the live persona.
      if (!Array.isArray(sheet.persona.conditions)) { sheet.persona.conditions = []; touched = true; }
      if (!Array.isArray(sheet.persona.experiences)) { sheet.persona.experiences = []; touched = true; }
      // M23: the INNER sheet.persona (entry.sheet.persona) also needs the aging
      // anchor + living-world lists — otherwise a swapped-in legacy sheet resets
      // carried conditions/experiences to empty on restoreSheet.
      const _sh = sheet.sheet && typeof sheet.sheet === "object" ? sheet.sheet : null;
      if (_sh && _sh.persona && typeof _sh.persona === "object") {
        if (typeof _sh.persona.baseAge !== "number" || isNaN(_sh.persona.baseAge)) { _sh.persona.baseAge = Math.max(18, Math.round(_sh.persona.age) || 25); touched = true; }
        if (typeof _sh.persona.baseDay !== "number" || isNaN(_sh.persona.baseDay)) { _sh.persona.baseDay = Math.max(1, Math.round(sim.world?.dayCount || 1)); touched = true; }
        // C3: normalize legacy inner-sheet memory entry shapes.
        try {
          if (_sh.memories && typeof _sh.memories === "object") {
            const _d = String(sim.world?.date || "15/08");
            if (Array.isArray(_sh.memories.shortTerm) && _sh.memories.shortTerm.some((m) => typeof m !== "object" || m === null || typeof m.text !== "string")) {
              _sh.memories.shortTerm = _sh.memories.shortTerm.map((m) => (typeof m === "string" ? { day: _d, text: m.slice(0, 500) } : (m && typeof m === "object" && typeof m.text === "string" ? m : { day: _d, text: String((m && m.text) ?? m).slice(0, 500) }))).filter((m) => m && typeof m.text === "string" && m.text.length > 0);
              touched = true;
            }
            if (Array.isArray(_sh.memories.core) && _sh.memories.core.some((c) => typeof c !== "string")) {
              _sh.memories.core = _sh.memories.core.map((c) => (typeof c === "string" ? c : (c && typeof c === "object" && typeof c.text === "string" ? c.text.slice(0, 220) : String(c).slice(0, 220)))).filter((c) => typeof c === "string" && c.length > 0);
              touched = true;
            }
          }
        } catch (_) {}
        if (!Array.isArray(_sh.persona.conditions)) { _sh.persona.conditions = []; touched = true; }
        if (!Array.isArray(_sh.persona.experiences)) { _sh.persona.experiences = []; touched = true; }
      }
    }
  }
  // R5 flag migration: drop stash mechanism, restore stashed records, dedupe
  // same-person npc_<id> + original-id pairs, fix the controlled flag.
  // 1) Restore any stashed NPC records into sim.npcs, then drop stash fields.
  // C1: every map access below uses own-property checks + reserved-key guards.
  if (sim.characters && typeof sim.characters === "object") {
    for (const entry of Object.values(sim.characters)) {
      if (!entry || typeof entry !== "object") continue;
      const stashed = _hasOwn(entry, "stashedNpc") ? entry.stashedNpc : undefined;
      const stashedId = _hasOwn(entry, "stashedNpcId") ? entry.stashedNpcId : undefined;
      if (stashed && typeof stashed === "object" && stashed.name) {
        const sid = (typeof stashed.id === "string" && stashed.id && !_isResKey(stashed.id)) ? stashed.id : (typeof stashedId === "string" && !_isResKey(stashedId) ? stashedId : null);
        const _hasSid = (k) => !!k && !_isResKey(k) && Object.prototype.hasOwnProperty.call(sim.npcs, k);
        // R5: if the stashed id itself is missing from the registry, always restore it
        // under its own id (even when a same-name npc_<id> duplicate already exists) —
        // the dedupe step below then collapses the pair keeping the original id.
        if (sid && !_hasSid(sid)) {
          try {
            const clone = JSON.parse(JSON.stringify(stashed));
            clone.id = sid;
            if (!Array.isArray(clone.memory)) clone.memory = [];
            if (_hasOwn(clone, "controlled")) delete clone.controlled;
            sim.npcs[clone.id] = clone;
            touched = true;
          } catch (_) {}
        } else {
          let existing = null;
          if (sid && _hasSid(sid)) existing = sim.npcs[sid];
          else existing = Object.values(sim.npcs).find((n) => _norm(n.name) === _norm(stashed.name)) || null;
          if (!existing) {
            try {
              const clone = JSON.parse(JSON.stringify(stashed));
              if (!clone.id || _isResKey(clone.id)) clone.id = sid || ("restored_" + String(Math.floor(Math.random() * 1e9)));
              if (!Array.isArray(clone.memory)) clone.memory = [];
              if (_hasOwn(clone, "controlled")) delete clone.controlled;
              if (_isResKey(clone.id)) { touched = true; }
              else { sim.npcs[clone.id] = clone; touched = true; }
            } catch (_) {}
          } else {
            try {
              if (Array.isArray(stashed.memory) && stashed.memory.length) {
                existing.memory = [...(existing.memory || []), ...stashed.memory].slice(-20);
              }
              if ((existing.age == null) && (typeof stashed.age === "number" && isFinite(stashed.age))) existing.age = Math.round(stashed.age);
              if (stashed.core_traits && typeof stashed.core_traits === "object") {
                if (!existing.core_traits || typeof existing.core_traits !== "object") existing.core_traits = { ...stashed.core_traits };
                else for (const k of TRAIT_KEYS) if (typeof existing.core_traits[k] !== "number" && typeof stashed.core_traits[k] === "number") existing.core_traits[k] = stashed.core_traits[k];
              }
              if (stashed.states && typeof stashed.states === "object") {
                if (!existing.states || typeof existing.states !== "object") existing.states = { ...stashed.states };
                else for (const k of STATE_KEYS) if (typeof existing.states[k] !== "number" && typeof stashed.states[k] === "number") existing.states[k] = stashed.states[k];
              }
              if (stashed.romance && typeof stashed.romance === "object" && !existing.romance) {
                try { if (shouldIncludeRomance(existing)) existing.romance = { ...stashed.romance }; } catch (_) {}
              }
              // Living World: preserve inner life across legacy stash restores.
              if (stashed.mind && typeof stashed.mind === "object" && !Array.isArray(stashed.mind)) {
                try {
                  if (!existing.mind || typeof existing.mind !== "object" || Array.isArray(existing.mind)) existing.mind = { ...stashed.mind };
                  else for (const k of ["thought", "intent", "doing"]) {
                    if (typeof existing.mind[k] !== "string" && typeof stashed.mind[k] === "string" && stashed.mind[k].trim()) existing.mind[k] = stashed.mind[k];
                  }
                } catch (_) {}
              }
            } catch (_) {}
            touched = true;
          }
        }
      }
      if (_hasOwn(entry, "stashedNpc")) { delete entry.stashedNpc; touched = true; }
      if (_hasOwn(entry, "stashedNpcId")) { delete entry.stashedNpcId; touched = true; }
      if (_hasOwn(entry, "npcId")) { delete entry.npcId; touched = true; }
      if (entry.sheet && typeof entry.sheet === "object") {
        if (_hasOwn(entry.sheet, "stashedNpc")) { delete entry.sheet.stashedNpc; touched = true; }
        if (_hasOwn(entry.sheet, "stashedNpcId")) { delete entry.sheet.stashedNpcId; touched = true; }
      }
    }
  }
  // 2) De-duplicate same-person pairs by normalized name (keep original id).
  {
    const groups = new Map();
    for (const [id, npc] of Object.entries(sim.npcs || {})) {
      if (!npc || typeof npc !== "object" || !npc.name) continue;
      if (_isResKey(id)) continue; // C1: never treat prototype keys as records
      const k = _norm(npc.name);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push([id, npc]);
    }
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      const originals = arr.filter(([id]) => !String(id).startsWith("npc_"));
      const dups = arr.filter(([id]) => String(id).startsWith("npc_"));
      let keeperId = null;
      let victims = [];
      if (originals.length) { keeperId = originals[0][0]; victims = [...originals.slice(1).map((x) => x[0]), ...dups.map((x) => x[0])]; }
      else { keeperId = arr[0][0]; victims = arr.slice(1).map((x) => x[0]); }
      const keeper = _hasOwn(sim.npcs, keeperId) ? sim.npcs[keeperId] : null;
      if (!keeper) continue;
      for (const vid of victims) {
        if (_isResKey(vid) || !_hasOwn(sim.npcs, vid)) continue;
        const v = sim.npcs[vid];
        if (!v) continue;
        try {
          if (Array.isArray(v.memory) && v.memory.length) keeper.memory = [...(keeper.memory || []), ...v.memory].slice(-20);
          if ((keeper.age == null) && (typeof v.age === "number" && isFinite(v.age))) keeper.age = Math.round(v.age);
          for (const f of ["background", "personality", "publicPersona", "privateReality", "secrets", "goals"]) {
            if (!keeper[f] && typeof v[f] === "string" && v[f].trim()) keeper[f] = v[f].trim().slice(0, f === "background" || f === "personality" ? 500 : 300);
          }
          if (v.core_traits && typeof v.core_traits === "object") {
            if (!keeper.core_traits || typeof keeper.core_traits !== "object") keeper.core_traits = { ...v.core_traits };
            else for (const k of TRAIT_KEYS) if (typeof keeper.core_traits[k] !== "number" && typeof v.core_traits[k] === "number") keeper.core_traits[k] = v.core_traits[k];
          }
          if (v.states && typeof v.states === "object") {
            if (!keeper.states || typeof keeper.states !== "object") keeper.states = { ...v.states };
            else for (const k of STATE_KEYS) if (typeof keeper.states[k] !== "number" && typeof v.states[k] === "number") keeper.states[k] = v.states[k];
          }
          if (v.romance && typeof v.romance === "object" && !keeper.romance) {
            try { if (shouldIncludeRomance(keeper)) keeper.romance = { ...v.romance }; } catch (_) {}
          }
          // Living World: never drop inner life when collapsing duplicates.
          if (v.mind && typeof v.mind === "object" && !Array.isArray(v.mind)) {
            try {
              if (!keeper.mind || typeof keeper.mind !== "object" || Array.isArray(keeper.mind)) keeper.mind = { ...v.mind };
              else for (const k of ["thought", "intent", "doing"]) {
                if (typeof keeper.mind[k] !== "string" && typeof v.mind[k] === "string" && v.mind[k].trim()) keeper.mind[k] = v.mind[k];
              }
            } catch (_) {}
          }
        } catch (_) {}
        delete sim.npcs[vid];
        touched = true;
      }
    }
  }
  // 3) C4/M10: exactly one controlled flag via the STABLE controlledNpcId link
  // (set on swap-enter, cleared on leaving the original player). The persona
  // display name is only a fallback for legacy saves — renaming the persona no
  // longer orphans the record. Idempotent: a second run changes nothing.
  {
    // Backfill the stable link from a legacy flag when the link is absent.
    try {
      const _link = typeof sim.controlledNpcId === "string" ? sim.controlledNpcId : null;
      const _linkValid = !!_link && !_isResKey(_link) && _hasOwn(sim.npcs, _link);
      if (!_linkValid) {
        const _flagged = Object.values(sim.npcs || {}).filter((n) => n && typeof n === "object" && _hasOwn(n, "controlled") && n.controlled === true);
        if (_flagged.length === 1 && !_isResKey(_flagged[0].id) && typeof _flagged[0].id === "string") {
          sim.controlledNpcId = _flagged[0].id;
          touched = true;
        } else if (sim.controlledNpcId !== null && sim.controlledNpcId !== undefined) {
          // Normalize absent/invalid links to null exactly once (then stable).
          const _bad = _link != null && (typeof _link !== "string" || _isResKey(_link));
          const _gone = typeof _link === "string" && !_isResKey(_link) && !_hasOwn(sim.npcs, _link);
          if (_bad || _gone) { sim.controlledNpcId = null; touched = true; }
        } else if (sim.controlledNpcId === undefined) {
          sim.controlledNpcId = null;
          touched = true;
        }
      }
    } catch (_) {}
    // Resolve the desired flagged record: stable id first, name match fallback.
    let wantId = null;
    try {
      const _link2 = typeof sim.controlledNpcId === "string" ? sim.controlledNpcId : null;
      if (_link2 && !_isResKey(_link2) && _hasOwn(sim.npcs, _link2)) wantId = _link2;
      else {
        let curName = "";
        try { curName = _norm(sim.persona?.name || ""); } catch (_) { curName = ""; }
        if (curName) {
          const match = Object.values(sim.npcs || {}).find((n) => n && typeof n === "object" && !_isResKey(n.id) && _norm(n.name) === curName) || null;
          if (match) {
            wantId = match.id;
            // Adopt the legacy name-matched record into the stable link once.
            if (sim.controlledNpcId !== wantId) { sim.controlledNpcId = wantId; touched = true; }
          }
        }
      }
    } catch (_) {}
    // Apply: clear every other flag (own-property only), set the wanted one.
    // No-ops when the registry already matches (M10 idempotence).
    try {
      for (const npc of Object.values(sim.npcs || {})) {
        if (!npc || typeof npc !== "object" || _isResKey(npc.id)) continue;
        if (_hasOwn(npc, "controlled") && (wantId === null || npc.id !== wantId)) { delete npc.controlled; touched = true; }
      }
      if (wantId && _hasOwn(sim.npcs, wantId)) {
        const rec = sim.npcs[wantId];
        if (rec && typeof rec === "object" && rec.controlled !== true) { rec.controlled = true; touched = true; }
      }
    } catch (_) {}
    for (const npc of Object.values(sim.npcs || {})) {
      if (npc && typeof npc === "object" && !_isResKey(npc.id)) {
        if (migrateNpc(npc)) touched = true;
        if (_hasOwn(npc, "controlled") && npc.controlled === true && npc.inactive) { npc.inactive = false; npc.exitNote = ""; npc.exitDay = null; touched = true; }
      }
    }
  }
  // Authoritative scene roster backfill (world.present: string[] of live NPC ids).
  // Runs last so inactive/controlled flags above are final.
  try {
    if (sim.world && typeof sim.world === "object") {
      if (!Array.isArray(sim.world.present)) {
        const wasUndefined = (sim.world.present === undefined);
        let init = [];
        try {
          if (wasUndefined && Array.isArray(sim.log) && sim.log.length === 0) {
            const pid = String(sim.presetId || "");
            if (pid === "wealthy") init = ["priya"];
            else if (pid === "woman") init = ["nasima"];
            else if (pid === "youth") init = ["baba"];
            else init = [];
          }
        } catch (_) { init = []; }
        try {
          const liveIds = new Set(Object.values(sim.npcs || {}).filter((n) => n && !n.inactive && !n.controlled).map((n) => n.id));
          sim.world.present = init.filter((id) => typeof id === "string" && liveIds.has(id));
        } catch (_) { sim.world.present = []; }
        touched = true;
      } else {
        const seen = new Set(); const out = [];
        for (const id of sim.world.present) {
          if (typeof id !== "string" || !id) continue;
          if (_isResKey(id) || !_hasOwn(sim.npcs, id)) continue;
          const npc = sim.npcs[id];
          if (!npc || npc.inactive || npc.controlled) continue;
          if (seen.has(id)) continue;
          seen.add(id); out.push(id);
        }
        if (out.length !== sim.world.present.length || out.some((v, i) => v !== sim.world.present[i])) { sim.world.present = out; touched = true; }
      }
    }
  } catch (_) {}
  // Gate 4: synthesize the event journal from chronicle + shortTerm so old
  // saves do not start with an empty world (C3). Idempotent: synthesis skips
  // when the flag is set or a journal already exists.
  try {
    const pre = Array.isArray(sim.journal) ? sim.journal.length : -1;
    const added = synthesizeFromSave(sim);
    if (added > 0 || pre < 0) touched = true;
  } catch (_) {}
  return touched;
}
// Compact INTERNAL block for the prompt. Player must never see this.
// Second arg sim is optional (kept for future controlled-link checks + backward compat).
// M6: render-time defense — every interpolated string is length-capped and
// "@@"-neutralized here as well as at intake, so one pathological legacy field
// cannot blow DOSSIER_TOTAL_BUDGET or inject scratchpad markers. (Local copy:
// engine.js cannot be imported here without a circular import.)
const _promptStr = (s, max) => {
  let out = String(s ?? "").split("@@").join("--").replace(/[\r\n]+/g, " ").trim();
  if (out.length > max) out = out.slice(0, max);
  return out;
};
export function npcPsychBlock(npc, sim) {
  const minor = isMinorNpc(npc);
  const t = npc.core_traits || {};
  const s = npc.states || {};
  // R1: minors omit lust/desire entirely — neither the numbers nor the keys appear.
  const traitKeys = minor ? TRAIT_KEYS.filter((k) => k !== "lust") : TRAIT_KEYS;
  const stateKeys = minor ? STATE_KEYS.filter((k) => k !== "desire") : STATE_KEYS;
  const traitStr = traitKeys.map((k) => `${k}:${t[k] ?? 50}`).join(" ");
  const stateStr = stateKeys.map((k) => `${k}:${s[k] ?? 10}`).join(" ");
  const age = normalizeNpcAge(npc.age);
  const ageStr = (age === null) ? "unconfirmed" : String(age);
  const showRomance = shouldIncludeRomance(npc);
  const r = (showRomance && npc.romance) ? npc.romance : null;
  const line1 = r
    ? `- ${_promptStr(npc.name, 60)} (${_promptStr(npc.id, 40)}) [${_promptStr(npc.role || "?", 60)} | age:${ageStr}]: traits {${traitStr}} | states {${stateStr}} | openness:${r.openness ?? 40}`
    : `- ${_promptStr(npc.name, 60)} (${_promptStr(npc.id, 40)}) [${_promptStr(npc.role || "?", 60)} | age:${ageStr}]: traits {${traitStr}} | states {${stateStr}}`;
  const line3 = r
    ? `- secrets: ${_promptStr(npc.secrets || "-", 300)} | attractions: ${_promptStr(r.attractions || "-", 200)} | boundaries: ${_promptStr(r.boundaries || "-", 200)}`
    : `- secrets: ${_promptStr(npc.secrets || "-", 300)}`;
  // BUG8: doing 60->110 word-boundary (SOV negation safe); thought 90->80 to hold budget.
  // Player-invisible; reveal only through observable behavior, never narration.
  const _m = (npc.mind && typeof npc.mind === "object") ? npc.mind : {};
  const _sliceW = (v, mx) => {
    const ss = String(v ?? "").trim();
    if (!ss) return "-";
    if (ss.length <= mx) return ss;
    const cut = ss.slice(0, mx);
    const sp = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("।"), cut.lastIndexOf(","));
    return (sp > mx * 0.5 ? cut.slice(0, sp) : cut).trim() || cut;
  };
  const _mT = _promptStr(_sliceW(_m.thought, 80), 80);
  const _mI = _promptStr(_sliceW(_m.intent, 70), 70);
  const _mD = _promptStr(_sliceW(_m.doing, 110), 110);
  let mindLine = `- mind: [thought: ${_mT}] | [intent/schedule: ${_mI}] | [doing/whereabouts: ${_mD}]`;
  try {
    if (sim && sim.world && sim.world.phoneCall && sim.world.phoneCall === npc.id) mindLine += " [ON PHONE — remote voice only, NOT in room]";
  } catch (_) {}
  // BUG9: preserve >=2 direct memories in the 3-item recent window (off-screen tagged).
  let recentTxt = "-";
  try {
    const mem = Array.isArray(npc.memory) ? npc.memory : [];
    if (mem.length) {
      const isOff = (x) => String(x || "").startsWith("[অফ-স্ক্রিন]");
      const direct = mem.filter((x) => !isOff(x));
      const want = [];
      for (const d of direct.slice(-2)) want.push(d);
      const newest = mem[mem.length - 1];
      if (newest && !want.includes(newest)) want.push(newest);
      for (let i = mem.length - 1; i >= 0 && want.length < 3; i--) {
        if (!want.includes(mem[i])) want.unshift(mem[i]);
      }
      recentTxt = _promptStr(want.slice(-3).join(" | ").slice(0, 300) || "-", 300);
    }
  } catch (_) {
    try { recentTxt = _promptStr((npc.memory || []).slice(-3).join(" | ").slice(0, 300) || "-", 300); } catch (_) {}
  }
  return `[INTERNAL — PLAYER-INVISIBLE]
${line1}
- public: ${_promptStr(npc.publicPersona || "-", 300)} | private: ${_promptStr(npc.privateReality || "-", 300)} | goals: ${_promptStr(npc.goals || "-", 300)}
${line3}
- recent: ${recentTxt}
${mindLine}`;
}

export function validateTraits(obj) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  // M9: Number.isFinite (isNaN let Infinity through into state).
  for (const k of TRAIT_KEYS) if (typeof obj[k] === "number" && Number.isFinite(obj[k])) out[k] = clamp(obj[k]);
  return Object.keys(out).length ? out : null;
}
export function validateStates(obj) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  // M9: Number.isFinite (isNaN let Infinity through into state).
  for (const k of STATE_KEYS) if (typeof obj[k] === "number" && Number.isFinite(obj[k])) out[k] = clamp(obj[k]);
  return Object.keys(out).length ? out : null;
}

// Living World: safe slicer for LLM-supplied mind chunks (patch npc_mind).
// Returns {thought?,intent?,doing?} with Bengali strings sliced to maxima,
// or null when nothing usable was supplied.
export function validateMindChunk(obj) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  if (typeof obj.thought === "string" && obj.thought.trim()) out.thought = obj.thought.trim().slice(0, MIND_THOUGHT_MAX);
  if (typeof obj.intent === "string" && obj.intent.trim()) out.intent = obj.intent.trim().slice(0, MIND_INTENT_MAX);
  if (typeof obj.doing === "string" && obj.doing.trim()) out.doing = obj.doing.trim().slice(0, MIND_DOING_MAX);
  return Object.keys(out).length ? out : null;
}

// Gate 2: the JSON schema as discrete, addressable fields. Same contract as
// src/rules/registry.js: every `text` is a verbatim line of the former
// monolithic schema literal (flush-left literals on purpose — indentation
// would become prompt bytes). Rendered in FIXED field order; field text is
// byte-identical to today's schema. Gated fields mirror the rulebook's
// relevance clusters; everything else is alwaysOn.
export const SCHEMA_ORDER = [
  "time_advance_minutes",
  "location",
  "location_facts",
  "stats",
  "cash_bank",
  "inventory_add",
  "inventory_remove",
  "bills_add",
  "bills_paid",
  "relationships",
  "npcs_add",
  "npc_states",
  "npc_memory_add",
  "npc_mind",
  "world_pulse",
  "offscreen_events",
  "conditions",
  "experiences_add",
  "scene_present",
  "phone_call",
  "npcs_exit",
  "memory_short_add",
  "memory_core_add",
  "chronicle_add",
  "storylines_add",
  "storylines_close",
  "recurring_income",
  "event",
];

export const SCHEMA_FIELDS = [
{ key: "time_advance_minutes", alwaysOn: true, appliesTo: null, text: `  "time_advance_minutes": 8,
` },
{ key: "location", alwaysOn: true, appliesTo: null, text: `  "location": "string (only if changed)",
` },
{ key: "location_facts", alwaysOn: true, appliesTo: null, text: `  "location_facts": "string (only if moved/discovered permanent layout, Bengali <=200)",
` },
{ key: "stats", alwaysOn: true, appliesTo: null, text: `  "stats": {"health": 0-100, "mood": 0-100, "satiety": 0-100, "energy": 0-100},
` },
{ key: "cash_bank", alwaysOn: false, appliesTo: (ctx) => ctx.needsEconomy, text: `  "cash_delta": 0, "bank_delta": 0,
` },
{ key: "inventory_add", alwaysOn: true, appliesTo: null, text: `  "inventory_add": [{"name":"...","qty":1}],
` },
{ key: "inventory_remove", alwaysOn: true, appliesTo: null, text: `  "inventory_remove": [{"name":"...","qty":1}],
` },
{ key: "bills_add", alwaysOn: false, appliesTo: (ctx) => ctx.needsEconomy, text: `  "bills_add": [{"name":"...","amount":0,"due":"..."}],
` },
{ key: "bills_paid", alwaysOn: false, appliesTo: (ctx) => ctx.needsEconomy, text: `  "bills_paid": ["bill name or id — JS settles cash-then-bank atomically; send NO deltas for the same bill"],
` },
{ key: "relationships", alwaysOn: true, appliesTo: null, text: `  "relationships": {"npcId or name": {"trust":0-100,"familiarity":0-100,"emotion":"...","note":"..."}},
` },
{ key: "npcs_add", alwaysOn: true, appliesTo: null, text: `  "npcs_add": [{"id":"...","name":"...","role":"...","age":18,"trust":50,"familiarity":10,"emotion":"...","background":"...","personality":"...","publicPersona":"...","privateReality":"...","secrets":"...","goals":"...","core_traits":{"greed":0-100,...all 16...},"states":{"anger":0-100,...},"romance":{"openness":0-100,"attractions":"...","boundaries":"..."}}],
` },
{ key: "npc_states", alwaysOn: true, appliesTo: null, text: `  "npc_states": {"npcId or name": {"anger":0-100,"fear":0-100,"sadness":0-100,"joy":0-100,"desire":0-100,"suspicion":0-100,"stress":0-100,"affection":0-100}},
` },
{ key: "npc_memory_add", alwaysOn: true, appliesTo: null, text: `  "npc_memory_add": {"npcId or name": ["what THEY took away from this scene (grudges, suspicions, softening...)"]},
` },
{ key: "npc_mind", alwaysOn: false, appliesTo: (ctx) => ctx.npcScope || ctx.isSkip, text: `  "npc_mind": {"npcId or name": {"thought":"...","intent":"...","doing":"..."}},
` },
{ key: "world_pulse", alwaysOn: true, appliesTo: null, text: `  "world_pulse": "atmosphere/weather/prices/rumors, Bengali <=220",
` },
{ key: "offscreen_events", alwaysOn: false, appliesTo: (ctx) => ctx.npcScope || ctx.isSkip, text: `  "offscreen_events": [{"npc":"id or name","text":"off-screen happening, Bengali <=220"}],
` },
{ key: "conditions", alwaysOn: false, appliesTo: (ctx) => ctx.lifeDepth, text: `  "conditions_add": ["..."], "conditions_remove": ["..."],
` },
{ key: "experiences_add", alwaysOn: false, appliesTo: (ctx) => ctx.lifeDepth, text: `  "experiences_add": ["..."],
` },
{ key: "scene_present", alwaysOn: true, appliesTo: null, text: `  "scene_present": ["REQUIRED end-of-beat in-room ids/names (omit phone/distant/departed)"],
` },
{ key: "phone_call", alwaysOn: false, appliesTo: (ctx) => ctx.needsPhone, text: `  "phone_call": "npcId or null (remote voice only, never in-room)",
` },
{ key: "npcs_exit", alwaysOn: true, appliesTo: null, text: `  "npcs_exit": [{"idOrName":"...","reason":"..."}],
` },
{ key: "memory_short_add", alwaysOn: true, appliesTo: null, text: `  "memory_short_add": ["..."],
` },
{ key: "memory_core_add", alwaysOn: true, appliesTo: null, text: `  "memory_core_add": ["rare identity-defining memory (a few per year max), self-contained, Bengali, <=220 chars"],
` },
{ key: "chronicle_add", alwaysOn: true, appliesTo: null, text: `  "chronicle_add": ["ONE self-contained lasting-consequence line per event (job/debt/promise/betrayal/romance/move/birth/death/big money/grudge), Bengali, <=220 chars — REQUIRED for any extraordinary windfall"],
` },
{ key: "storylines_add", alwaysOn: true, appliesTo: null, text: `  "storylines_add": [{"title":"...","desc":"..."}],
` },
{ key: "storylines_close", alwaysOn: true, appliesTo: null, text: `  "storylines_close": ["title or id to close"],
` },
{ key: "recurring_income", alwaysOn: false, appliesTo: (ctx) => ctx.needsEconomy, text: `  "recurring_income": {"source":"...","amount":0,"cadence_days":30},
` },
{ key: "event", alwaysOn: true, appliesTo: null, text: `  "event": "one-line internal consequence summary in Bengali"
` },
];

export function selectSchemaFields(ctx) {
  if (!ctx || ctx.scope === "full" || ctx.scope == null) return SCHEMA_FIELDS.slice();
  return SCHEMA_FIELDS.filter((f) => f.alwaysOn || (typeof f.appliesTo === "function" && f.appliesTo(ctx)));
}

export function renderSchema(fields) {
  const order = new Map(SCHEMA_ORDER.map((key, i) => [key, i]));
  return fields.slice().sort((a, b) => order.get(a.key) - order.get(b.key)).map((f) => f.text).join("");
}


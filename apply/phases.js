// Gate 3: execution-ordered phases for the applyPatch pipeline.
// Deviation from the mission's proposed P1..P7 (documented in the Gate 3
// report): these numbers encode the CURRENT execution order, which must be
// preserved byte-for-byte (Date.now/Math.random tick order, shortTerm note
// order, landing-wins semantics):
//   - DECAY runs after TIME (it needs hrsEff from the time clamp/advance).
//   - ROSTER runs after PEOPLE (scene_present fallback needs _newNpcIds).
//   - MATERIAL (inventory) runs before PEOPLE (current code order).
//   - stats rails run inside the ECONOMY flow before bills (current order).
// Adding a future key = choosing a (phase, order) pair. The pipeline sorts by
// (phase, order), so no pipeline edit is ever needed.
export const PHASES = {
  PREP: 10,      // sim defensive defaults (always runs)
  TIME: 20,      // time clamp + advanceTime + location/facts + phone_call
  DECAY: 30,     // passive stats + hot NPC states + persona drift (LLM lands after)
  ECONOMY: 40,   // recurring_income + credit, stats rails, bills_add/paid, cash/bank
  MATERIAL: 45,  // inventory_add/remove
  PEOPLE: 50,    // relationships, npcs_add, npcs_exit, npc_mind
  ROSTER: 60,    // scene_present resolution + doing refresh (needs _newNpcIds)
  LAND: 70,      // npc_states + dominant-emotion derivation + npc_memory_add
  WORLD: 80,     // world_pulse + offscreen_events
  SELF: 90,      // conditions + experiences + memory_short
  CANON: 100,    // chronicle + memory_core + storylines
  BODY: 110,     // physiology drain + critical (uses landed zero flags)
  CLOSE: 120,    // prunePaidBills + hygienePass + updatedAt
  RECONCILE: 130, // reserved for future cross-cutting reconcilers
};

export const PHASE_NAMES = Object.fromEntries(
  Object.entries(PHASES).map(([k, v]) => [v, k]),
);


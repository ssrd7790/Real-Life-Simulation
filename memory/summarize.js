// Gate 5 src/memory/summarize.js — compaction as SUMMARISATION, not deletion.
// An NPC going ARCHIVED keeps a lossless event index (journal ids) plus a
// compact summary. Never deleted: identity/psych/mind/exit notes (I4, I5 —
// enforced by only ever ADDING npc.archive and trimming npc.memory bulk,
// exactly like the legacy 90-day path). Every string below is DERIVED from
// record/journal data (M5: never invented); M3-safe by construction —
// one-liners and roster entries carry no psych numbers (no lust/desire keys
// can appear), only public record facts.
import { normName, mentionsNpc } from "./matching.js";

// Rendering caps (named; rationale: one-liner ~120 chars x8 ~= 1KB, roster
// ~50 chars x12 ~= 600B — both live INSIDE the existing dossier/ceiling
// budgets via the unchanged fit machinery, per M1).
export const SUMMARIZED_MAX_N = 8;
export const ROSTER_MAX_N = 12;
export const ARCHIVE_SUMMARY_MAX = 300;
export const ARCHIVE_EVENT_IDS_MAX = 20;
export const ONELINER_EVENT_MAX = 90;
export const ONELINER_HOOK_MAX = 90;

// Journal events attributable to this NPC (explicit actors[] UNION
// read-time text mentions). Newest-last order preserved. Pure.
export function eventsForNpc(journal, npc) {
  const out = [];
  try {
    if (!Array.isArray(journal) || !npc || typeof npc !== "object") return out;
    for (const ev of journal) {
      if (!ev || typeof ev !== "object") continue;
      let hit = false;
      try {
        const actors = Array.isArray(ev.actors) ? ev.actors : [];
        for (const a of actors) {
          if (typeof a === "string" && a && (a === npc.id || normName(a) === normName(npc.name))) { hit = true; break; }
        }
      } catch (_) {}
      if (!hit) {
        try { if (mentionsNpc(ev.text, npc)) hit = true; } catch (_) {}
      }
      if (hit) out.push(ev);
    }
  } catch (_) {}
  return out;
}

function sliceWord(s, max) {
  try {
    const t = String(s || "").trim().replace(/\s+/g, " ");
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const sp = cut.lastIndexOf(" ");
    return (sp > max * 0.4 ? cut.slice(0, sp) : cut).trim();
  } catch (_) { return ""; }
}

function ageStr(npc) {
  try {
    const a = npc.age;
    if (typeof a === "number" && Number.isFinite(a)) return String(Math.max(0, Math.round(a)));
    return "unconfirmed";
  } catch (_) { return "unconfirmed"; }
}

// Linked relationship record (mirrors engine findLinkedRel tiers 1-2:
// r_<id> key, then normalized name match). Numbers only; never throws.
export function linkedRel(sim, npc) {
  try {
    const rels = (sim && sim.npcs && sim.relationships) || {};
    const byId = rels["r_" + npc.id];
    if (byId && typeof byId === "object") return byId;
    const nm = normName(npc.name);
    if (!nm) return null;
    for (const r of Object.values(rels)) {
      if (r && typeof r === "object" && normName(r.name) === nm) return r;
    }
    return null;
  } catch (_) { return null; }
}

function relSeg(sim, npc) {
  try {
    const r = linkedRel(sim, npc);
    if (!r) return "";
    const t = (typeof r.trust === "number" && Number.isFinite(r.trust)) ? Math.round(r.trust) : "-";
    const f = (typeof r.familiarity === "number" && Number.isFinite(r.familiarity)) ? Math.round(r.familiarity) : "-";
    const e = (typeof r.emotion === "string" && r.emotion) ? r.emotion.slice(0, 30) : "-";
    return `rel ${t}/${f}/${e}`;
  } catch (_) { return ""; }
}

// Newest journal event text mentioning this NPC (any kind), sliced.
function newestEventText(journal, npc, max) {
  try {
    const evs = eventsForNpc(journal, npc);
    for (let i = evs.length - 1; i >= 0; i--) {
      const t = sliceWord(evs[i].text, max);
      if (t) return t;
    }
    return "";
  } catch (_) { return ""; }
}

// One unresolved hook: newest UNNARRATED journal event, else an open
// storyline whose title/desc names the NPC, else "". Derived only (M5).
function openHook(sim, journal, npc) {
  try {
    const evs = eventsForNpc(journal, npc);
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i];
      if (e && e.narrated !== true) {
        const t = sliceWord(e.text, ONELINER_HOOK_MAX);
        if (t) return t;
      }
    }
    const nm = normName(npc.name);
    if (nm) {
      for (const s of Object.values((sim && sim.storylines) || [])) {
        if (!s || typeof s !== "object" || s.active === false) continue;
        const hay = normName((s.title || "") + " " + (s.desc || ""));
        if (hay && hay.includes(nm)) {
          const t = sliceWord(s.title || s.desc, ONELINER_HOOK_MAX);
          if (t) return t;
        }
      }
    }
    return "";
  } catch (_) { return ""; }
}

// DORMANT one-liner: name/role/age + newest event + relationship numbers +
// one unresolved hook. No psych numbers (M3), no invention (M5).
export function dormantLine(npc, sim, journal) {
  try {
    const name = String((npc && npc.name) || "?").slice(0, 60);
    const id = String((npc && npc.id) || "?").slice(0, 40);
    const role = String((npc && npc.role) || "?").slice(0, 60);
    const segs = [`- ${name} (${id}) [${role} | age:${ageStr(npc)}]`];
    const newest = newestEventText(journal, npc, ONELINER_EVENT_MAX);
    if (newest) segs.push(newest);
    const rel = relSeg(sim, npc);
    if (rel) segs.push(rel);
    const hook = openHook(sim, journal, npc);
    segs.push(hook ? `hook: ${hook}` : "hook: none known");
    return segs.join(" | ").slice(0, 400);
  } catch (_) { return ""; }
}

// ARCHIVED roster entry: name + id + role + relationship + journal event
// pointers. Relationship numbers ride along so a roster hit still
// recognizes the character (continuity); psych numbers never appear (M3).
export function rosterEntry(npc, sim, journal) {
  try {
    const name = String((npc && npc.name) || "?").slice(0, 60);
    const id = String((npc && npc.id) || "?").slice(0, 40);
    const role = String((npc && npc.role) || "?").slice(0, 60);
    const rel = relSeg(sim, npc);
    let ptr = "";
    try {
      const ids = eventsForNpc(journal, npc).map((e) => e && e.id).filter((x) => typeof x === "string" && x);
      if (ids.length) ptr = " ~" + ids.slice(-5).join(",");
    } catch (_) {}
    return `${name} (${id}) [${role}${rel ? " | " + rel : ""}]${ptr}`;
  } catch (_) { return ""; }
}

// Section headers for the extras block (exported: engine stump-strips a
// trailing dangling header after a hard-ceiling tail cut).
export const SUM_EXTRAS_ROSTER_HEADER = "[KNOWN TO EXIST BUT NOT CURRENTLY DETAILED — do NOT invent biography, voice, or whereabouts for these; they enter play only via travel, call, or schedule:]";
export const SUM_EXTRAS_ONELINER_HEADER = "[DORMANT CONTACTS — known but off-screen: one-line briefs. Full detail only if they enter the scene:]";

// Assemble the appended extras block. EMPTY inputs => "" (zero chars — the
// V3 byte-identity guarantee for small fixtures: nothing omitted means the
// dossier section renders exactly as legacy).
export function renderExtras(summarizedLines, rosterEntries, moreCount) {
  try {
    const lines = (Array.isArray(summarizedLines) ? summarizedLines : []).filter((s) => typeof s === "string" && s.trim());
    const ros = (Array.isArray(rosterEntries) ? rosterEntries : []).filter((s) => typeof s === "string" && s.trim());
    const more = Math.max(0, Math.round(moreCount || 0));
    if (!lines.length && !ros.length) return "";
    // Roster FIRST (cheap, highest-guarantee: the anti-confabulation list
    // must survive budget pressure), one-liners after (richer, cut first).
    let out = "";
    if (ros.length || more > 0) {
      out += "\n\n" + SUM_EXTRAS_ROSTER_HEADER + "\n";
      out += ros.length ? ros.join("; ") : "(none listed)";
      if (more > 0) out += " (+" + more + " more exist — ask, travel, or call to learn more)";
    }
    if (lines.length) {
      out += "\n\n" + SUM_EXTRAS_ONELINER_HEADER + "\n" + lines.join("\n");
    }
    return out;
  } catch (_) { return ""; }
}

// Archive summary built at 90-day compaction time, BEFORE memory bulk is
// trimmed. Endpoints + count + date + event ids — everything derived from
// the deleted lines and the journal (M5). Stored as npc.archive; the trim
// itself is unchanged legacy behavior.
export function buildArchive(npc, journal, dayCount) {
  try {
    const mem = Array.isArray(npc.memory) ? npc.memory.filter((m) => typeof m === "string" && m.trim()) : [];
    const evs = eventsForNpc(journal, npc);
    const ids = evs.map((e) => e && e.id).filter((x) => typeof x === "string" && x).slice(-ARCHIVE_EVENT_IDS_MAX);
    const day = Number.isInteger(dayCount) ? dayCount : 1;
    let summary = `${mem.length} older memories (compacted day ${day})`;
    if (mem.length) {
      const first = sliceWord(mem[0], 100);
      const last = sliceWord(mem[mem.length - 1], 100);
      summary += `: "${first}" ... "${last}"`;
    }
    if (ids.length) summary += ` | journal: ${ids.join(",")}`;
    summary = summary.slice(0, ARCHIVE_SUMMARY_MAX);
    return { summary, eventIds: ids, archivedDay: day, memoryCount: mem.length };
  } catch (_) {
    return { summary: "", eventIds: [], archivedDay: 1, memoryCount: 0 };
  }
}

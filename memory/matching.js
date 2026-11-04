// Gate 5 src/memory/matching — Bengali-safe name matching for the memory
// layer. Exact-semantics duplicates (Gate 4 precedent: duplicated, not
// imported, so memory/* never imports engine.js and the import graph stays
// one-directional engine -> memory -> core/*):
//   normName(s) === engine normName [engine:198] === core normLocal
//   HONORIFIC_WORDS / stripHonorificWords / stripCaseSuffixWord === engine
//     [engine:662-681] (BUG5 honorific/case handling — same code points,
//     written with \u escapes so precomposed vs decomposed YA+NUKTA forms
//     cannot drift through source normalization)
//   hasWordBoundary === engine [engine:692] (same code points; the separator
//     class is built from \u escapes below: U+0964 DARI and U+2026 ELLIPSIS
//     are word separators exactly like upstream)
// Drift guard: run scratch/verify-matching.js (worker) — bundles the real
// engine and asserts normBase parity on a battery incl. decomposed forms.
// mentionsNpc(text, npc): heuristic read-time actor attribution — true when
// the text names the NPC (exact, honorific/case-stripped, or inflected
// either-contains like the scheduler's Bengali matching). Heuristic by
// design (fiction text inflects); the embedding-seam scorer in retrieval.js
// can replace it later without touching callers.
import { normLocal } from "../core/util.js";

export const normName = normLocal;

const HONORIFIC_WORDS = new Set(["\u0986\u09AA\u09BE", "\u099A\u09BE\u099A\u09BE", "\u09B8\u09BE\u09B9\u09C7\u09AC", "\u09A6\u09BE", "\u09A6\u09BE\u09A6\u09BE", "\u09A6\u09BF", "\u09A6\u09BF\u09A6\u09BF", "\u09AC\u09BE\u09AC\u09C1", "\u09AE\u09BE\u09AE\u09BE", "\u0995\u09BE\u0995\u09BE", "\u099A\u09BE\u099A\u09BF", "\u0996\u09BE\u09B2\u09BE", "\u0996\u09BE\u09B2\u09C1", "\u09AE\u09BE\u09B8\u09BF", "\u09AA\u09BF\u09B8\u09BF", "\u0986\u0999\u09CD\u0995\u09C7\u09B2", "\u0986\u09A8\u09CD\u099F\u09BF", "\u09B8\u09CD\u09AF\u09BE\u09B0", "\u09AE\u09CD\u09AF\u09BE\u09A1\u09BE\u09AE"]);
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
// Separator class identical to upstream: \s , ; : / | ( ) [ ] { } U+0964 ! ? . U+2026
const WB_SEP = "[\\s,;:\\/|()\\[\\]{}" + "\u0964" + "!?." + "\u2026" + "]+";
export function hasWordBoundary(hayNorm, needleNorm) {
  try {
    const hay = String(hayNorm || ""), nd = String(needleNorm || "").trim();
    if (!hay || !nd) return false;
    const escN = nd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|" + WB_SEP + ")" + escN + "(" + WB_SEP + "|$)").test(hay);
  } catch (_) { return false; }
}

// Does this journal/memory text mention this NPC? Exact id, exact name,
// word-boundary or honorific-base match (unambiguous forms), or
// Bengali-inflected either-contains (mirrors the scheduler rule: e === u or
// either-contains when the short side is >= 3 chars). Pure, deterministic,
// never throws.
export function mentionsNpc(text, npc) {
  try {
    if (!npc || typeof npc !== "object") return false;
    const t = normName(text);
    if (!t) return false;
    const nm = normName(npc.name);
    const nid = normName(npc.id);
    if (nm && nm.length >= 2) {
      if (hasWordBoundary(t, nm)) return true;
      const nb = normBase(npc.name);
      if (nb && nb.length >= 3 && hasWordBoundary(t, nb)) return true;
      for (const cand of [nm, nb]) {
        if (!cand || cand.length < 3) continue;
        for (const w of t.split(" ")) {
          if (w.length < 3) continue;
          if (w === cand || w.includes(cand) || cand.includes(w)) return true;
        }
      }
    }
    if (nid && nid.length >= 2 && hasWordBoundary(t, nid)) return true;
    return false;
  } catch (_) { return false; }
}

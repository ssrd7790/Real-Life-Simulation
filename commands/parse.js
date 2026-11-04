// Command parsing for the frontend (Gate 6). Pure leaf module: COMMANDS +
// parseCommand + parseDuration, moved verbatim from src/app.js. Only dep is
// the SKIP_MAX_MIN ceiling from engine.
import { SKIP_MAX_MIN } from "../engine.js";

export const COMMANDS = [
  { name: "/talk", hint: "/talk [নাম] — ওই চরিত্রের সঙ্গে কথা বলো", desc: "কারো সঙ্গে কথা শুরু করো" },
  { name: "/skip", hint: "/skip [সময়] — যেমন /skip 2 ঘণ্টা", desc: "সময় এগিয়ে নাও" },
  { name: "/swap", hint: "/swap [নাম] — ওই চরিত্রের চোখে দেখো", desc: "অন্য চরিত্র হও" },
  { name: "/pay", hint: "/pay [বিলের নাম] — বিল পরিশোধ করো", desc: "বিল দাও" },
  { name: "/help", hint: "/help — সব কমান্ড দেখো", desc: "সাহায্য" },
];
export function parseCommand(text) {
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const [cmd, ...rest] = t.split(/\s+/);
  const arg = rest.join(" ").trim();
  if (cmd === "/talk") return { type: "talk", target: arg };
  if (cmd === "/skip") return { type: "skip", target: arg, minutes: parseDuration(arg) };
  if (cmd === "/swap") return { type: "swap", target: arg };
  if (cmd === "/pay") return { type: "pay", target: arg };
  if (cmd === "/help") return { type: "help" };
  return { type: "unknown", raw: cmd };
}
export function parseDuration(s) {
  // M7: parse ALL number+unit pairs (Bengali digits included), with unit
  // matching anchored right after each number — so "thr" never reads as "hr"
  // and "things" never reads as a unit. Unrecognized text falls back to the
  // default 60 (never a bare-number hours guess). Capped at SKIP_MAX_MIN so
  // the player text, skipNote, top-up and applyPatch all agree.
  if (!s) return 60;
  const latin = String(s).replace(/[০-৯]/g, (c) => "০১২৩৪৫৬৭৮৯".indexOf(c));
  const unitVal = (u) => {
    const t = String(u).toLowerCase();
    if (/^(দিন|days?)$/.test(t)) return 24 * 60;
    if (/^(ঘণ্টা|ঘন্টা|hours?|hrs?)$/.test(t)) return 60;
    if (/^(মিনিট|minutes?|mins?)$/.test(t)) return 1;
    if (/^(সপ্তাহ|weeks?)$/.test(t)) return 7 * 24 * 60;
    return 0;
  };
  let total = 0, pairs = 0;
  const re = /(\d+)\s*(দিন|days?|ঘণ্টা|ঘন্টা|hours?|hrs?|মিনিট|minutes?|mins?|সপ্তাহ|weeks?)(?![A-Za-z])/gi;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const v = unitVal(m[2]);
    if (v > 0) { total += parseInt(m[1], 10) * v; pairs++; }
  }
  if (pairs > 0) return Math.min(total || 60, SKIP_MAX_MIN);
  // Unit word with no number ("ঘণ্টা" alone) means one of that unit.
  const solo = latin.match(/দিন|days?|ঘণ্টা|ঘন্টা|hours?|hrs?|মিনিট|minutes?|mins?|সপ্তাহ|weeks?/i);
  if (solo && !/\d/.test(latin)) {
    const v = unitVal(solo[0]);
    if (v > 0) return Math.min(v, SKIP_MAX_MIN);
    return 60;
  }
  // Bare number (digits/whitespace only): <=24 = hours, else minutes.
  if (/^[\d\s]+$/.test(latin)) {
    const mm = latin.match(/\d+/g);
    if (mm && mm.length === 1) {
      const n = parseInt(mm[0], 10);
      if (n <= 24) return Math.min(n * 60, SKIP_MAX_MIN);
      return Math.min(n, SKIP_MAX_MIN);
    }
    return 60;
  }
  return 60;
}

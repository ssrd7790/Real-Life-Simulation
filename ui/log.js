// Narrative formatting + log rendering (Gate 6).
// Split from src/app.js: leaf UI module, bodies moved verbatim. Reads the
// active sim from the shared session (src/state/store.js); DOM via globals.
// No imports from other UI modules, so nothing imports back into this file.
import { session } from "../state/store.js";
import { $, escH, bnDigits, memText } from "./dom.js";
import { fmtTime, headerString } from "../engine.js";

export function formatNarrative(raw) {
  let t = String(raw || "").trim();
  // strip any header line the model echoed
  t = t.replace(/^.*📅.*$/m, "").trim();
  // M12: remove ALL code-fence lines (opening, closing, language-tagged) so no
  // stray ``` paragraph ever reaches the player.
  t = t.split("\n").filter((ln) => !ln.trim().startsWith("```")).join("\n").trim();
  const paras = t.split(/\n\s*\n|(?<=\S)\n(?=—)/).map((x) => x.trim()).filter(Boolean);
  const intenseWords = ["রেগে", "চিৎকার", "ধমক", "গালি", "রাগ", "হুমকি", "কাঁপছে", "ফুঁসে", "চুপ কর", "বিশ্বাসঘাতক"];
  return paras.map((p) => {
    const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.map((line) => {
      const dm = line.match(/^—\s*([^:：]+)\s*:\s*(.+)$/);
      if (dm) {
        const [, name, speech] = dm;
        const intense = /!|‼|？|\?{2,}/.test(speech) || intenseWords.some((w) => speech.includes(w));
        return `<p class="dlg${intense ? " intense" : ""}"><span class="dlg-name">${escH(name.trim())}</span><span class="dlg-text">${quoteHl(boldHl(escH(speech.trim())))}</span></p>`;
      }
      const intense = /!{1,}/.test(line) && line.length < 220 && intenseWords.some((w) => line.includes(w));
      return `<p class="para${intense ? " intense" : ""}">${quoteHl(boldHl(escH(line)))}</p>`;
    }).join("");
  }).join("");
}
export function quoteHl(escaped) {
  // highlight “...” / "..." spans as dialogue
  return escaped.replace(/(&quot;|“|")(.+?)(&quot;|”|")/g, '<span class="q">$1$2$3</span>');
}
export function boldHl(escaped) {
  // Safe bold: **...** => <strong>...</strong> AFTER HTML escaping (escH), so
  // system strings using **/help** and **name** render cleanly with zero XSS
  // surface (only <strong> tags are introduced; $ patterns untouched).
  try {
    return String(escaped ?? "").replace(/\*\*(.+?)\*\*/g, (_, inner) => `<strong>${inner}</strong>`);
  } catch (_) {
    return String(escaped ?? "");
  }
}
export function turnHtml(t) {
  if (t.role === "player") return `<div class="turn player"><div class="who">🧭 তুমি <span class="t">${escH(t.time)}</span></div><div class="ptext">${escH(t.text)}</div></div>`;
  return `<div class="turn world"><div class="who">🌏 দুনিয়া <span class="t">${escH(t.time)}</span></div><div class="whead">${escH(t.header)}</div><div class="wbody">${t.html}</div></div>`;
}
export function renderLog() {
  const box = $("narrativeCtn");
  if (!session.sim) { box.innerHTML = ""; return; }
  const items = session.sim.log.filter((t) => session.logFilter === "all" ? true : t.role === session.logFilter);
  box.innerHTML = items.map(turnHtml).join("");
  box.scrollTop = box.scrollHeight;
}
export function pushLog(role, text, html, header) {
  session.sim.log.push({ role, text, html: html || "", header: header || headerString(session.sim), time: bnDigits(fmtTime(session.sim.world.timeMin)) + " · " + bnDigits(session.sim.world.date), controlledId: session.sim.controlledId || "player0" });
  if (session.sim.log.length > 200) {
    const drop = session.sim.log.length - 200;
    session.sim.log = session.sim.log.slice(-200);
    // Keep the POV boundary valid when the log window slides.
    if (typeof session.sim.historyCutoff === "number") session.sim.historyCutoff = Math.max(0, session.sim.historyCutoff - drop);
  }
}

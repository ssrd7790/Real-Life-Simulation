// Input autocomplete for /commands (Gate 6).
// Split from src/app.js: showSuggest/hideSuggest/applySug verbatim; the
// keydown/input/click handlers that boot() used to wire inline are named
// exports here (handleSuggestKey/handleActionInput/handleOutsideClick) so
// boot stays wiring-only. sugIdx stays module-local to this file.
import { COMMANDS } from "../commands/parse.js";
import { $, escH } from "./dom.js";
import { handleSubmit } from "../commands/turn.js";

let sugIdx = -1;

export function showSuggest() {
  const inp = $("actionInput");
  const v = inp.value;
  const m = v.match(/\/\w*$/);
  const box = $("suggest");
  if (!m) { hideSuggest(); return; }
  const frag = m[0].toLowerCase();
  const list = COMMANDS.filter((c) => c.name.startsWith(frag));
  if (!list.length) { hideSuggest(); return; }
  box.innerHTML = list.map((c, i) => `<div class="sug${i === sugIdx ? " sel" : ""}" data-i="${i}"><b>${c.name}</b><span>${escH(c.desc)}</span></div>`).join("");
  box.hidden = false;
  box.querySelectorAll(".sug").forEach((el) => {
    el.onclick = () => { applySug(list[+el.dataset.i]); };
  });
  box._list = list;
}
export function hideSuggest() { $("suggest").hidden = true; sugIdx = -1; }
export function applySug(c) {
  const inp = $("actionInput");
  inp.value = inp.value.replace(/\/\w*$/, c.name + " ");
  hideSuggest(); inp.focus();
}
// Verbatim from the boot() keydown listener in src/app.js.
export function handleSuggestKey(e) {
  const box = $("suggest");
  if (!box.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Tab")) {
    const list = box._list || [];
    if (!list.length) return;
    e.preventDefault();
    if (e.key === "ArrowDown") sugIdx = (sugIdx + 1) % list.length;
    else if (e.key === "ArrowUp") sugIdx = (sugIdx - 1 + list.length) % list.length;
    else { applySug(list[Math.max(0, sugIdx)]); return; }
    showSuggest();
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
}
// Verbatim from the boot() input listener in src/app.js.
export function handleActionInput() { sugIdx = -1; showSuggest(); }
// Verbatim from the boot() document click listener in src/app.js.
export function handleOutsideClick(e) { if (!$("suggest").contains(e.target) && e.target !== $("actionInput")) hideSuggest(); }


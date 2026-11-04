// Bengali Life Sim — frontend entry (Gate 6). Wiring only: every behavior
// lives in src/ui/*, src/state/*, src/commands/*. This file wires DOM events
// (boot) and re-exports the public API so existing importers keep working
// (index.html boots from here; tests/build-fixtures.mjs imports simFromPreset
// from here). No business logic below this line may grow — add features in
// the modules, never here.
import { $ } from "./ui/dom.js";
import { session, loadIndex } from "./state/store.js";
import { renderAll, renderStatus, renderHUD } from "./ui/hud.js";
import { renderLog, turnHtml, formatNarrative, quoteHl, boldHl } from "./ui/log.js";
import { openModal, closeModal, renderPresetCards, renderSimList, openEdit, saveEdit, applyLocationEdit, startCustomReal } from "./ui/modals.js";
import { showSuggest, hideSuggest, applySug, handleSuggestKey, handleActionInput, handleOutsideClick } from "./ui/suggest.js";
import { handleSubmit, showHelp } from "./commands/turn.js";
import { neutralizePaidDeltas } from "./commands/pay.js";
import { COMMANDS, parseDuration } from "./commands/parse.js";
import { simFromPreset, sanitizeImportedSim, deleteActive, exportSave, importSave } from "./state/sim.js";
import { snapshotSheet, restoreSheet, applySwap } from "./state/swap.js";

async function boot() {
  $("sendBtn").onclick = handleSubmit;
  $("actionInput").addEventListener("keydown", handleSuggestKey);
  $("actionInput").addEventListener("input", handleActionInput);
  document.addEventListener("click", handleOutsideClick);
  $("menuBtn").onclick = () => { renderSimList(); openModal("menuModal"); };
  $("closeMenuBtn").onclick = () => closeModal("menuModal");
  $("newBtn").onclick = () => { renderPresetCards(); openModal("wizardModal"); };
  $("newBtn2").onclick = () => { renderPresetCards(); openModal("wizardModal"); };
  $("closeWizardBtn").onclick = () => closeModal("wizardModal");
  $("customBtn").onclick = () => openModal("customModal");
  $("closeCustomBtn").onclick = () => closeModal("customModal");
  $("startCustomBtn").onclick = () => { closeModal("customModal"); startCustomReal(); };
  $("editBtn").onclick = openEdit;
  $("closeEditBtn").onclick = () => closeModal("editModal");
  $("saveEditBtn").onclick = saveEdit;
  $("deleteBtn").onclick = deleteActive;
  $("exportBtn").onclick = exportSave;
  $("importInput").onchange = (e) => { if (e.target.files[0]) importSave(e.target.files[0]); e.target.value = ""; };
  $("cityFilter").onchange = (e) => renderPresetCards(e.target.value);
  $("hudToggle").onclick = () => document.body.classList.toggle("hud-open");
  $("hudClose").onclick = () => document.body.classList.remove("hud-open");
  document.querySelectorAll(".chip").forEach((c) => c.onclick = () => { session.logFilter = c.dataset.f; document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c)); renderLog(); });

  await loadIndex();
  renderAll();
  if (!session.sim) { openModal("menuModal"); }
}

if (typeof document !== "undefined") { document.readyState !== "loading" ? boot() : document.addEventListener("DOMContentLoaded", boot); }

// Public API compat: every name src/app.js previously exported still imports
// from here (implementations live in the modules above).
export { simFromPreset, snapshotSheet, restoreSheet, formatNarrative, quoteHl, boldHl, neutralizePaidDeltas, parseDuration, applyLocationEdit, saveEdit, sanitizeImportedSim, applySwap, renderAll, renderStatus, renderHUD, turnHtml, renderLog, renderSimList, openModal, closeModal, renderPresetCards, openEdit, showSuggest, hideSuggest, applySug, showHelp, COMMANDS };

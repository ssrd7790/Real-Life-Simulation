// Gate 3 applier: INVENTORY — add (merge by normalized name) / remove.
// Runs in MATERIAL, before PEOPLE (current code order — preserves
// Date.now/Math.random tick order for generated ids).
// Splice: verbatim lines 2071-2086.
import { cov } from "../coverage.js";
import { PHASES } from "../phases.js";
import { PATCH_MAX_INV_ADD, normName } from "../../engine.js";

export const BRANCHES = [
  "inventoryAdd:entry",
  "inventoryRemove:entry",
];

export function validateInventoryAdd(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.inventory_add));
}

export function applyInventoryAdd(sim, patch, ctx) {
  cov("inventoryAdd:entry");
  if (Array.isArray(patch.inventory_add)) {
    for (const it of patch.inventory_add.slice(0, PATCH_MAX_INV_ADD)) {
      if (!it || !it.name) continue;
      const name = String(it.name).slice(0, 80);
      const qty = Math.max(1, Math.min(99, Math.round(it.qty || 1)));
      const ex = sim.inventory.find((x) => normName(x.name) === normName(name));
      if (ex) ex.qty = Math.min(999, ex.qty + qty); else sim.inventory.push({ id: "i" + Date.now() + Math.floor(Math.random() * 999), name, qty });
    }
  }
}

export function validateInventoryRemove(sim, patch, ctx) {
  return !!(patch && Array.isArray(patch.inventory_remove));
}

export function applyInventoryRemove(sim, patch, ctx) {
  cov("inventoryRemove:entry");
  if (Array.isArray(patch.inventory_remove)) {
    for (const it of patch.inventory_remove) {
      if (!it || !it.name) continue;
      const ex = sim.inventory.find((x) => normName(x.name) === normName(String(it.name)));
      if (ex) { ex.qty -= Math.max(1, Math.round(it.qty || 1)); if (ex.qty <= 0) sim.inventory = sim.inventory.filter((x) => x !== ex); }
    }
  }
}

export const ENTRIES = [
  {
    id: "inventoryAdd",
    key: "inventory_add",
    phase: PHASES.MATERIAL,
    order: 80,
    owns: ["inventory"],
    notes: "Merged by normalized name (qty accumulates to 999); new rows get i+Date.now ids.",
    validate: validateInventoryAdd,
    apply: applyInventoryAdd,
  },
  {
    id: "inventoryRemove",
    key: "inventory_remove",
    phase: PHASES.MATERIAL,
    order: 90,
    owns: ["inventory"],
    notes: "Decrements and drops at 0. Unknown names ignored.",
    validate: validateInventoryRemove,
    apply: applyInventoryRemove,
  },
];

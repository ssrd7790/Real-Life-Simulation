// Determinism seam for uid() — behavior-neutral in production.
// Production defaults: now() === Date.now(), rand() === Math.random().
// Tests override via __setForTest(fnNow, fnRand) and restore via __reset().
// Only uid() in src/app.js uses this module; createdAt/updatedAt stay real.
// Shape preserved: prefix + base36(now) + 0..9998 digits, uniqueness unchanged.
export function now() {
  try {
    if (typeof globalThis.__clockNowFn === "function") return globalThis.__clockNowFn();
  } catch (_) {}
  return Date.now();
}

export function rand() {
  try {
    if (typeof globalThis.__clockRandFn === "function") return globalThis.__clockRandFn();
  } catch (_) {}
  return Math.random();
}

// Test hooks. Pass null/undefined to leave that side real.
// e.g. __setForTest(() => 1700000000000, mulberry32(1234))
export function __setForTest(fnNow, fnRand) {
  try {
    if (typeof fnNow === "function") globalThis.__clockNowFn = fnNow;
    else delete globalThis.__clockNowFn;
    if (typeof fnRand === "function") globalThis.__clockRandFn = fnRand;
    else delete globalThis.__clockRandFn;
  } catch (_) {}
}

export function __reset() {
  try {
    delete globalThis.__clockNowFn;
    delete globalThis.__clockRandFn;
  } catch (_) {}
}

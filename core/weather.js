// Gate 4 core/weather — seeded seasonal weather per city/date. Pure: no DOM,
// no LLM, no kv, no Date.now/Math.random. The seed is city+date, so the same
// sim-day always yields the same weather (recomputable, never stored except
// as a journal event). Per the mission, weather MUST NOT appear in the prompt
// unless the scheduler selects it as an event.
import { hashStr, mulberry32 } from "./util.js";

// Weather kinds with Bengali labels (short — FACTS lines stay terse).
export const WEATHER_KIND = {
  SUN: "রোদ",
  CLOUD: "মেঘলা",
  RAIN: "বৃষ্টি",
  STORM: "ঝড়",
  FOG: "কুয়াশা",
  HEAT: "ভ্যাপসা গরম",
};

// Seasonal likelihood tables by month (1-12). Weights: [sun, cloud, rain,
// storm, fog, heat]. Monsoon peaks Jun-Sep; winter fog Dec-Jan; heat Apr-Jun.
function seasonalWeights(month) {
  if (month === 6 || month === 7 || month === 8 || month === 9) return [1, 3, 5, 2, 0, 1]; // বর্ষা
  if (month === 3 || month === 4) return [4, 2, 1, 1, 0, 2];   // বসন্ত
  if (month === 5 || month === 6) return [3, 2, 2, 1, 0, 4];   // গ্রীষ্ম
  if (month === 10 || month === 11) return [4, 3, 1, 0, 1, 0]; // শরৎ
  if (month === 12 || month === 1) return [3, 2, 0, 0, 4, 0];  // হেমন্ত/শীত
  return [4, 2, 1, 0, 2, 0]; // ফেব্রুয়ারি শীত
}

const ORDER = [WEATHER_KIND.SUN, WEATHER_KIND.CLOUD, WEATHER_KIND.RAIN, WEATHER_KIND.STORM, WEATHER_KIND.FOG, WEATHER_KIND.HEAT];

function monthOfDate(dateStr) {
  try {
    const m = parseInt(String(dateStr || "15/08").split("/")[1], 10);
    if (m >= 1 && m <= 12) return m;
  } catch (_) {}
  return 8;
}

// Deterministic weather for a city+date. Same inputs => same output, forever.
export function weatherFor(city, dateStr) {
  const month = monthOfDate(dateStr);
  const w = seasonalWeights(month);
  const rng = mulberry32(hashStr(`wx:${String(city || "?")}:${String(dateStr || "?")}`));
  const total = w.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return { kind: ORDER[i], month };
  }
  return { kind: ORDER[0], month };
}

// Only storm/rain/fog are "noteworthy" enough to journal + narrate; ordinary
// sun/clouds/heat stay ambient (never reach the prompt).
export function isNoteworthy(weather) {
  try {
    return weather.kind === WEATHER_KIND.RAIN || weather.kind === WEATHER_KIND.STORM || weather.kind === WEATHER_KIND.FOG;
  } catch (_) { return false; }
}

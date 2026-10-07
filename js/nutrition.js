// Nutrient definitions, energy-requirement math, and serving-size conversions.

export const NUTRIENTS = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', dp: 0 },
  { key: 'p', label: 'Protein', unit: 'g', dp: 0 },
  { key: 'c', label: 'Carbs', unit: 'g', dp: 0 },
  { key: 'f', label: 'Fat', unit: 'g', dp: 0 },
  { key: 'fib', label: 'Fiber', unit: 'g', dp: 1 },
  { key: 'sug', label: 'Sugar', unit: 'g', dp: 0 },
  { key: 'sat', label: 'Saturated fat', unit: 'g', dp: 1 },
  { key: 'na', label: 'Sodium', unit: 'mg', dp: 0 },
  { key: 'chol', label: 'Cholesterol', unit: 'mg', dp: 0 },
  { key: 'k', label: 'Potassium', unit: 'mg', dp: 0 },
  { key: 'ca', label: 'Calcium', unit: 'mg', dp: 0 },
  { key: 'fe', label: 'Iron', unit: 'mg', dp: 1 },
  { key: 'vitc', label: 'Vitamin C', unit: 'mg', dp: 0 },
  { key: 'vitd', label: 'Vitamin D', unit: 'µg', dp: 1 },
  { key: 'caf', label: 'Caffeine', unit: 'mg', dp: 0 },
];
export const NKEYS = NUTRIENTS.map((n) => n.key);
export const MICROS = NUTRIENTS.filter((n) => !['kcal', 'p', 'c', 'f', 'caf'].includes(n.key));

export const ACTIVITY = [
  { key: 'sedentary', label: 'Sedentary', hint: 'Mostly sitting; little play or sport' },
  { key: 'low', label: 'Low active', hint: 'About 30–60 min of moderate activity a day' },
  { key: 'active', label: 'Active', hint: 'At least 60 min of activity a day' },
  { key: 'very', label: 'Very active', hint: 'Hours of sport or training most days' },
];

export const GOALS = [
  { key: 'lose', label: 'Lose', factor: 0.9 },
  { key: 'maintain', label: 'Maintain', factor: 1 },
  { key: 'gain', label: 'Gain', factor: 1.1 },
];

export function sumNutrients(list) {
  const t = Object.fromEntries(NKEYS.map((k) => [k, 0]));
  for (const n of list) for (const k of NKEYS) t[k] += n?.[k] || 0;
  return t;
}

export function scale(per100, grams) {
  const out = {};
  for (const k of NKEYS) out[k] = ((per100?.[k] || 0) * grams) / 100;
  return out;
}

export function ageYears(birth, on = new Date()) {
  if (!birth) return null;
  const b = new Date(birth + 'T00:00');
  let a = on.getFullYear() - b.getFullYear();
  const m = on.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) a--;
  return a;
}

// Estimated Energy Requirement, National Academies DRI (2005) equations.
// Children 3–18 include an energy-deposition term for growth.
const PA = {
  boy: { sedentary: 1.0, low: 1.13, active: 1.26, very: 1.42 },
  girl: { sedentary: 1.0, low: 1.16, active: 1.31, very: 1.56 },
  man: { sedentary: 1.0, low: 1.11, active: 1.25, very: 1.48 },
  woman: { sedentary: 1.0, low: 1.12, active: 1.27, very: 1.45 },
};

export function eer({ sex, age, kg, cm, activity }) {
  if (age == null || !kg || !cm) return null;
  const m = cm / 100;
  const male = sex !== 'f';
  if (age < 3) return 89 * kg - 100 + 20;
  if (age <= 18) {
    const growth = age <= 8 ? 20 : 25;
    if (male) return 88.5 - 61.9 * age + PA.boy[activity] * (26.7 * kg + 903 * m) + growth;
    return 135.3 - 30.8 * age + PA.girl[activity] * (10.0 * kg + 934 * m) + growth;
  }
  if (male) return 662 - 9.53 * age + PA.man[activity] * (15.91 * kg + 539.6 * m);
  return 354 - 6.91 * age + PA.woman[activity] * (9.36 * kg + 726 * m);
}

export function latestWeight(state) {
  return state.weights.length ? state.weights[state.weights.length - 1].kg : null;
}

export function latestHeight(state) {
  const hs = state.measures.filter((m) => m.type === 'height').sort((a, b) => a.d.localeCompare(b.d));
  return hs.length ? hs[hs.length - 1].cm : state.profile.heightCm;
}

// Returns { kcal, p, c, f, estimate, source }
export function targets(state) {
  const { profile: pr, goals: g } = state;
  const age = ageYears(pr.birth);
  const est = eer({ sex: pr.sex, age, kg: latestWeight(state), cm: latestHeight(state), activity: pr.activity });
  const factor = GOALS.find((x) => x.key === pr.goal)?.factor ?? 1;
  const estimate = est ? Math.round((est * factor) / 10) * 10 : null;
  const kcal = g.kcalOverride || estimate || 2000;
  let p, c, f;
  if (g.macroMode === 'g' && g.grams.p != null) {
    ({ p, c, f } = g.grams);
  } else {
    p = Math.round((kcal * g.pct.p) / 100 / 4);
    c = Math.round((kcal * g.pct.c) / 100 / 4);
    f = Math.round((kcal * g.pct.f) / 100 / 9);
  }
  return { kcal, p, c, f, estimate, source: g.kcalOverride ? 'manual' : estimate ? 'calculated' : 'default' };
}

// Daily reference values for the micronutrients we show, by age and sex (DRI RDA/AI;
// sodium is the chronic-disease-risk reduction limit). `limit: true` means "stay under".
export function microTargets(state, kcal) {
  const age = ageYears(state.profile.birth) ?? 30;
  const male = state.profile.sex !== 'f';
  const pick = (table) => {
    for (const [maxAge, m, f] of table) if (age <= maxAge) return male ? m : f;
    return null;
  };
  return {
    fib: { amt: Math.round((14 * kcal) / 1000) },
    na: { amt: pick([[3, 1200, 1200], [8, 1500, 1500], [13, 1800, 1800], [200, 2300, 2300]]), limit: true },
    sat: { amt: Math.round((kcal * 0.1) / 9), limit: true },
    ca: { amt: pick([[3, 700, 700], [8, 1000, 1000], [18, 1300, 1300], [50, 1000, 1000], [200, 1000, 1200]]) },
    fe: { amt: pick([[3, 7, 7], [8, 10, 10], [13, 8, 8], [18, 11, 15], [50, 8, 18], [200, 8, 8]]) },
    k: { amt: pick([[3, 2000, 2000], [8, 2300, 2300], [13, 2500, 2300], [18, 3000, 2300], [200, 3400, 2600]]) },
    vitc: { amt: pick([[3, 15, 15], [8, 25, 25], [13, 45, 45], [18, 75, 65], [200, 90, 75]]) },
    vitd: { amt: 15 },
    chol: null,
  };
}

// Health Canada caffeine guidance for children; 400 mg for adults.
export function caffeineLimit(state) {
  const age = ageYears(state.profile.birth);
  if (age == null || age >= 19) return 400;
  if (age <= 3) return 0;
  if (age <= 6) return 45;
  if (age <= 9) return 62;
  if (age <= 12) return 85;
  const kg = latestWeight(state);
  return kg ? Math.round(2.5 * kg) : 100;
}

export function waterGoalCups(state) {
  if (state.goals.waterCups) return state.goals.waterCups;
  const age = ageYears(state.profile.birth);
  if (age == null || age >= 14) return 8;
  if (age >= 9) return 7;
  if (age >= 4) return 5;
  return 4;
}

// MET values from the Compendium of Physical Activities.
export const ACTIVITIES = [
  ['Walking', 3.5], ['Running', 9.8], ['Cycling', 7.5], ['Swimming', 7],
  ['Soccer', 7], ['Basketball', 6.5], ['Football', 8], ['Baseball / softball', 5],
  ['Tennis', 7.3], ['Volleyball', 4], ['Hockey', 8], ['Lacrosse', 8],
  ['Wrestling', 6], ['Martial arts', 10], ['Gymnastics', 3.8], ['Dance', 5],
  ['Weight training', 5], ['Hiking', 6], ['Skateboarding', 5], ['Jump rope', 11],
  ['Track practice', 8], ['Cross country', 9], ['PE class', 5], ['Active video games', 3.8],
  ['Yoga', 2.5], ['Rowing', 7], ['Skiing / snowboarding', 5.3], ['Climbing', 8],
];

export function exerciseKcal(met, kg, minutes) {
  return Math.round(met * (kg || 50) * (minutes / 60));
}

// ---- servings and units ----

const OZ = 28.3495;

// Every unit a food can be measured in, each with its weight in grams.
export function unitsFor(food) {
  const units = [];
  if (food.servingG) units.push({ label: food.servingLabel || 'serving', g: food.servingG });
  for (const [label, g] of food.portions || []) {
    const clean = label.replace(/^1\s+/, '');
    if (!units.some((u) => u.label === clean)) units.push({ label: clean, g });
  }
  if (!food.noGrams) units.push({ label: 'g', g: 1 }, { label: 'oz', g: OZ });
  if (!units.length) units.push({ label: 'g', g: 1 });
  return units;
}

export function findUnit(food, label) {
  const units = unitsFor(food);
  return units.find((u) => u.label === label) || units[0];
}

// Accepts "2", "1.5", ".5", "1/2", "1 1/2".
export function parseQty(s) {
  s = String(s).trim().replace(',', '.');
  if (!s) return NaN;
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return +mixed[1] + +mixed[2] / +mixed[3];
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return +frac[1] / +frac[2];
  return Number(s);
}

const FRACTIONS = [[0.25, '¼'], [0.333, '⅓'], [0.5, '½'], [0.667, '⅔'], [0.75, '¾']];

export function fmtQty(q) {
  const whole = Math.floor(q);
  const rest = q - whole;
  if (rest < 0.01) return String(whole);
  for (const [v, s] of FRACTIONS) if (Math.abs(rest - v) < 0.01) return (whole || '') + s;
  return String(Math.round(q * 100) / 100);
}

export function fmt(v, dp = 0) {
  if (v == null || Number.isNaN(v)) return '–';
  const f = 10 ** dp;
  return (Math.round(v * f) / f).toLocaleString();
}

export const kgToLb = (kg) => kg * 2.20462;
export const lbToKg = (lb) => lb / 2.20462;
export const cmToIn = (cm) => cm / 2.54;
export const inToCm = (i) => i * 2.54;

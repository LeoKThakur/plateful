// Turns "2 eggs, a slice of toast with butter and a glass of milk" into separate items
// with an amount, a unit and a search phrase. Runs on the phone; no AI service involved.

import { unitsFor } from './nutrition.js';

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, dozen: 12, couple: 2, few: 3, half: 0.5, quarter: 0.25, some: 1,
};

// unit word -> words to look for in a food's portion labels (first match wins)
const UNITS = {
  cup: ['cup'], cups: ['cup'], glass: ['cup', 'glass', 'fl oz'], glasses: ['cup', 'glass'], mug: ['cup', 'mug'],
  bowl: ['bowl', 'cup'], bowls: ['bowl', 'cup'],
  tbsp: ['tablespoon', 'tbsp'], tablespoon: ['tablespoon', 'tbsp'], tablespoons: ['tablespoon', 'tbsp'],
  tsp: ['teaspoon', 'tsp'], teaspoon: ['teaspoon', 'tsp'], teaspoons: ['teaspoon', 'tsp'],
  slice: ['slice', 'piece'], slices: ['slice', 'piece'], piece: ['piece', 'slice'], pieces: ['piece', 'slice'],
  scoop: ['scoop', 'serving'], scoops: ['scoop', 'serving'], serving: ['serving'], servings: ['serving'],
  can: ['can'], cans: ['can'], bottle: ['bottle'], bottles: ['bottle'], packet: ['packet', 'package'], bar: ['bar'], bars: ['bar'],
  handful: ['handful', 'oz'], plate: ['plate', 'cup'], order: ['order', 'serving'], stick: ['stick'], sticks: ['stick'],
  oz: ['oz'], ounce: ['oz'], ounces: ['oz'], g: ['g'], gram: ['g'], grams: ['g'], lb: ['lb'], pound: ['lb'],
  small: ['small'], medium: ['medium'], large: ['large'],
};
const UNIT_GRAMS = { oz: 28.3495, g: 1, lb: 453.6 };
const VOLUME = { cup: 240, 'fl oz': 30, tablespoon: 15, teaspoon: 5 }; // ml

const NUM = String.raw`(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)`;

function parseNumber(s) {
  s = s.trim();
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return +m[1] + +m[2] / +m[3];
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return +m[1] / +m[2];
  return Number(s);
}

export function splitItems(text) {
  return text
    .toLowerCase()
    .replace(/[“”"]/g, '')
    .split(/[,;\n+]|\band then\b|\band\b|\bwith\b|\bplus\b|\balso\b|&/)
    .map((x) => x.trim().replace(/^(i (had|ate|drank)|had|ate|drank)\s+/, '').replace(/\.$/, ''))
    .filter((x) => x && !/^(some|a|an|the)$/.test(x));
}

// "1 1/2 cups of rice" -> { qty: 1.5, unit: 'cups', query: 'rice' }
export function parseItem(chunk) {
  let rest = chunk.trim();
  let qty = null;
  let m = rest.match(new RegExp(`^${NUM}\\s*`));
  if (m) {
    qty = parseNumber(m[1]);
    rest = rest.slice(m[0].length);
  } else {
    m = rest.match(/^(a\s+half|half\s+an?|a\s+quarter|[a-z]+)\s+/);
    if (m && m[1].replace(/\s+.*/, '') in NUMBER_WORDS) {
      const w = m[1];
      qty = /half/.test(w) ? 0.5 : /quarter/.test(w) ? 0.25 : NUMBER_WORDS[w];
      rest = rest.slice(m[0].length);
    }
  }
  // "2 1/2" style handled above; also "half a cup", "a couple of"
  rest = rest.replace(/^(a|an)\s+/, '').replace(/^of\s+/, '');
  let unit = null;
  m = rest.match(/^([a-z]+)\.?\s+(of\s+)?/);
  if (m && UNITS[m[1]] && rest.slice(m[0].length).trim()) {
    unit = m[1];
    rest = rest.slice(m[0].length);
  } else {
    m = rest.match(/^(\d+)\s*(g|oz)\b\s*(of\s+)?/); // "200g chicken" after a lost number
    if (m) { qty = +m[1]; unit = m[2]; rest = rest.slice(m[0].length); }
  }
  const query = rest.replace(/\b(some|of|the|my|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return { raw: chunk, qty: qty ?? 1, explicit: qty != null, unit, query: singular(query) };
}

function singular(q) {
  return q.split(' ').map((w) => (w.length > 3 && /[^s]s$/.test(w) && !/(ous|ics|ies)$/.test(w) ? w.slice(0, -1) : w.replace(/ies$/, 'ie'))).join(' ');
}

export function parseMeal(text) {
  return splitItems(text).map(parseItem).filter((x) => x.query);
}

// USDA lists odd portions too ("Guideline amount on large sandwich", "1 cubic inch").
const ODD = /guideline|cubic|snack-size|crust not eaten|individual container|\bdrop\b/i;
// How "everyday" a portion label is: medium/regular sizes first.
const typical = (u) => (/\b(medium|regular|nfs)\b/i.test(u.label) ? 2 : 0) - (ODD.test(u.label) ? 3 : 0);

// Pick the food's unit that best matches the words used. Returns { unit, qty, exact }.
// `explicit` is false when no amount was given ("butter"): then pick a normal-sized portion.
export function matchUnit(food, unitWord, qty, explicit = true) {
  const units = unitsFor(food);
  if (unitWord && UNIT_GRAMS[UNITS[unitWord]?.[0]] && !food.noGrams) {
    const key = UNITS[unitWord][0];
    if (key === 'lb') return { unit: 'oz', qty: qty * 16, exact: true };
    return { unit: key, qty, exact: true };
  }
  if (unitWord && VOLUME[UNITS[unitWord]?.[0]]) {
    // Volumes convert into each other: a glass of juice listed only in fl oz is 8 fl oz.
    const want = UNITS[unitWord][0];
    const wantMl = qty * VOLUME[want];
    const options = units.map((u) => {
      const m = u.label.toLowerCase().match(/^(cup|fl oz|tablespoon|teaspoon)\b/);
      return m && { unit: u.label, qty: Math.round((wantMl / VOLUME[m[1]]) * 100) / 100, exact: m[1] === want };
    }).filter(Boolean);
    // The same unit if listed, otherwise whichever gives the most natural number (2 tsp -> 2/3 tbsp, not 0.04 cup).
    const best = options.find((o) => o.exact) || options.sort((x, y) => Math.abs(Math.log(x.qty)) - Math.abs(Math.log(y.qty)))[0];
    if (best) return best;
  }
  if (unitWord) {
    for (const want of UNITS[unitWord] || [unitWord]) {
      // Prefer the plainest label: "slice" over "slice, crust not eaten".
      const u = units.filter((x) => x.label.toLowerCase().includes(want)).sort((a, b) => typical(b) - typical(a) || a.label.length - b.label.length)[0];
      if (u) return { unit: u.label, qty, exact: true };
    }
  }
  const naturals = units.filter((u) => u.label !== 'g' && u.label !== 'oz' && !ODD.test(u.label));
  if (!explicit && naturals.length) {
    // No amount given: the portion closest to an ordinary ~150 kcal helping, e.g. a pat of butter, not a cup.
    const kcal = (u) => Math.max(1, (food.n.kcal * u.g) / 100);
    const best = [...naturals].sort((a, b) => Math.abs(Math.log(kcal(a) / 150)) - Math.abs(Math.log(kcal(b) / 150)))[0];
    return { unit: best.label, qty: 1, exact: false };
  }
  // A count ("2 eggs"): use the first natural unit, not grams.
  const natural = naturals[0] || units[0];
  return { unit: natural.label, qty: natural.label === 'g' ? qty * 100 : qty, exact: !unitWord };
}

// Everyday words -> how the USDA database names them.
const SYNONYMS = {
  coke: 'cola', pepsi: 'cola', soda: 'soft drink', pop: 'soft drink', sprite: 'soft drink lemon-lime', 'mountain dew': 'soft drink',
  fries: 'french fries', 'french fry': 'french fries', fry: 'french fries', burger: 'hamburger', cheeseburger: 'cheeseburger',
  pb: 'peanut butter', 'pb&j': 'peanut butter and jelly sandwich', pbj: 'peanut butter and jelly sandwich', oj: 'orange juice',
  mac: 'macaroni and cheese', 'mac and cheese': 'macaroni and cheese', 'mac n cheese': 'macaroni and cheese',
  nugget: 'chicken nuggets', nuggets: 'chicken nuggets', 'chicken nugget': 'chicken nuggets', toast: 'bread white toasted',
  gatorade: 'sports drink', powerade: 'sports drink', 'energy drink': 'energy drink', redbull: 'energy drink', 'red bull': 'energy drink',
  cereal: 'cereal', oatmeal: 'oatmeal', pbandj: 'peanut butter and jelly sandwich', hotdog: 'hot dog', 'hot dog': 'hot dog',
  'protein shake': 'protein shake', shake: 'milk shake', chip: 'potato chips', chips: 'potato chips', 'potato chip': 'potato chips',
};

const FILLER = new Set(['slice', 'piece', 'small', 'medium', 'large', 'big', 'little', 'plain', 'homemade', 'fresh', 'whole']);

// Search phrases to try, best first.
export function queryVariants(q) {
  const out = [];
  const add = (x) => { x = x.trim(); if (x && !out.includes(x)) out.push(x); };
  add(SYNONYMS[q] || q);
  add(q);
  const words = q.split(' ');
  const kept = words.filter((w) => !FILLER.has(w));
  add(kept.join(' '));
  if (kept.length > 1) {
    add(kept.slice(0, -1).join(' '));
    add(kept.slice(1).join(' '));
  }
  for (const w of kept) if (SYNONYMS[w]) add(SYNONYMS[w]);
  return out;
}

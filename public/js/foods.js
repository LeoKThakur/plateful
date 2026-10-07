// Food sources: the bundled USDA database (offline), Open Food Facts (branded + barcodes),
// optional USDA Branded Foods (needs a free API key), and the user's own foods.

const UA = 'Plateful/1.0 (personal calorie tracker)';

// A food: { id, name, brand, source, verified, n (per 100 g), portions [[label, g]],
//           servingG, servingLabel, noGrams, barcode }

let local = null;
let localPromise = null;

export function loadLocal() {
  return (localPromise ??= fetch('data/fndds.json')
    .then((r) => r.json())
    .then((d) => {
      local = d.foods.map((f) => {
        const n = {};
        d.keys.forEach((k, i) => (n[k] = f.v[i]));
        const name = f.n;
        return {
          id: f.id, name, cat: f.cat, source: 'usda', verified: true, n, portions: f.pt,
          _lc: name.toLowerCase(), _words: name.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean),
        };
      });
      return local;
    }));
}

export function localFood(id) {
  return local?.find((f) => f.id === id) || null;
}

function tokens(q) {
  return q.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean);
}

function score(food, toks, q) {
  const words = food._words || (food._words = `${food.name} ${food.brand || ''}`.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean));
  let s = 0;
  for (const t of toks) {
    const i = words.findIndex((w) => w.startsWith(t));
    if (i < 0) return -Infinity;
    s += words[i] === t ? 12 : 6;
    s -= i * 1.5;
  }
  const lc = food._lc || (food._lc = food.name.toLowerCase());
  if (lc.startsWith(q)) s += 25;
  if (lc === q) s += 40;
  if (lc.startsWith(q + ',')) s += 8; // "Banana, raw" is the plain food; "Banana split" is a dish
  if (/\braw\b/.test(lc)) s += 2;
  s -= lc.length * 0.12;
  s -= (lc.match(/,/g) || []).length * 2;
  if (/\b(ns as to|nfs)\b/.test(lc)) s += 4; // "not further specified" entries are the generic ones people usually want
  if (/baby food|infant formula/.test(lc)) s -= 25;
  return s;
}

export function searchFoods(list, q, limit = 40) {
  const toks = tokens(q);
  if (!toks.length) return [];
  const ql = q.trim().toLowerCase();
  const scored = [];
  for (const f of list) {
    const s = score(f, toks, ql);
    if (s > -Infinity) scored.push([s, f]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map((x) => x[1]);
}

export async function searchLocal(q, limit) {
  await loadLocal();
  return searchFoods(local, q, limit);
}

// ---- Open Food Facts ----

function g2mg(v) { return v == null ? 0 : v * 1000; }

export function fromOff(p, code) {
  const nm = p.nutriments || {};
  let kcal = nm['energy-kcal_100g'];
  if (kcal == null && nm['energy_100g'] != null) kcal = nm['energy_100g'] / 4.184;
  if (kcal == null) return null;
  const brand = Array.isArray(p.brands) ? p.brands[0] : (p.brands || '').split(',')[0].trim();
  const servingG = Number(p.serving_quantity) || null;
  return {
    id: `off-${code || p.code}`,
    name: p.product_name || p.generic_name || 'Unnamed product',
    brand,
    source: 'off',
    verified: false,
    barcode: code || p.code,
    servingG,
    servingLabel: servingG ? (p.serving_size ? `serving (${p.serving_size})` : 'serving') : null,
    portions: [],
    n: {
      kcal,
      p: nm.proteins_100g || 0,
      c: nm.carbohydrates_100g || 0,
      f: nm.fat_100g || 0,
      fib: nm.fiber_100g || 0,
      sug: nm.sugars_100g || 0,
      sat: nm['saturated-fat_100g'] || 0,
      na: g2mg(nm.sodium_100g ?? (nm.salt_100g != null ? nm.salt_100g / 2.5 : 0)),
      chol: g2mg(nm.cholesterol_100g),
      k: g2mg(nm.potassium_100g),
      ca: g2mg(nm.calcium_100g),
      fe: g2mg(nm.iron_100g),
      vitc: g2mg(nm['vitamin-c_100g']),
      vitd: (nm['vitamin-d_100g'] || 0) * 1e6,
      caf: g2mg(nm.caffeine_100g),
    },
  };
}

const OFF_FIELDS = 'code,product_name,generic_name,brands,nutriments,serving_quantity,serving_size';

async function getJson(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// search.openfoodfacts.org doesn't send CORS headers, so use the classic search endpoint.
// US products first (most scanned first), then worldwide if nothing matches.
export async function searchOff(q) {
  const base = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&json=1&page_size=25&sort_by=unique_scans_n&fields=${OFF_FIELDS}`;
  // Their servers sometimes reject a request under load (with no CORS header); one retry usually works.
  const get = (url) => getJson(url, 12000).catch(() => new Promise((r) => setTimeout(r, 1500)).then(() => getJson(url, 12000)));
  let d = await get(`${base}&tagtype_0=countries&tag_contains_0=contains&tag_0=united-states`);
  if (!d.products?.length) d = await get(base);
  return (d.products || []).map((p) => fromOff(p, p.code)).filter(Boolean);
}

export async function offBarcode(code) {
  const tries = [code];
  if (code.length === 12) tries.push('0' + code);
  if (code.length === 13 && code.startsWith('0')) tries.push(code.slice(1));
  for (const c of tries) {
    const d = await getJson(`https://world.openfoodfacts.org/api/v2/product/${c}.json?fields=${OFF_FIELDS}&user_agent=${encodeURIComponent(UA)}`);
    if (d.status === 1 && d.product) return { found: true, food: fromOff(d.product, c), name: d.product.product_name };
  }
  return { found: false };
}

// ---- USDA Branded Foods (optional, needs an API key) ----

const USDA_IDS = { kcal: 1008, p: 1003, c: 1005, f: 1004, fib: 1079, sug: 2000, sat: 1258, na: 1093, chol: 1253, k: 1092, ca: 1087, fe: 1089, vitc: 1162, vitd: 1114, caf: 1057 };

function fromUsdaBranded(f) {
  const byId = {};
  for (const n of f.foodNutrients || []) byId[n.nutrientId] = n.value;
  if (byId[1008] == null) return null;
  const n = {};
  for (const [k, id] of Object.entries(USDA_IDS)) n[k] = byId[id] || 0;
  const unit = (f.servingSizeUnit || '').toLowerCase();
  const servingG = f.servingSize && (unit === 'g' || unit === 'grm' || unit === 'ml' || unit === 'mlt') ? f.servingSize : null;
  const hh = f.householdServingFullText;
  return {
    id: `usdab-${f.fdcId}`,
    name: titleCase(f.description),
    brand: titleCase(f.brandName || f.brandOwner || ''),
    source: 'usda-branded',
    verified: true,
    barcode: f.gtinUpc,
    servingG,
    servingLabel: servingG ? (hh ? `serving (${hh.toLowerCase()})` : 'serving') : null,
    portions: [],
    n,
  };
}

function titleCase(s) {
  if (!s || s !== s.toUpperCase()) return s || '';
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function searchUsdaBranded(q, key) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&dataType=Branded&pageSize=25`;
  const d = await getJson(url);
  return (d.foods || []).map(fromUsdaBranded).filter(Boolean);
}

export async function usdaBarcode(code, key) {
  const foods = await searchUsdaBranded(code, key);
  const strip = (s) => (s || '').replace(/^0+/, '');
  return foods.find((f) => strip(f.barcode) === strip(code)) || null;
}

export const SOURCE_BADGE = {
  usda: { label: 'USDA', cls: 'ok', title: 'USDA FoodData Central: lab-verified' },
  'usda-branded': { label: 'USDA brand', cls: 'ok', title: 'Manufacturer label data published by USDA' },
  off: { label: 'Community', cls: 'warn', title: 'Open Food Facts: crowd-sourced, check the label' },
  custom: { label: 'My food', cls: 'mine', title: 'Entered by you' },
  recipe: { label: 'Recipe', cls: 'mine', title: 'Your recipe' },
};

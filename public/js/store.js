// Persistence: the whole app state lives in one IndexedDB record on this device.

const DB_NAME = 'plateful';
const STORE = 'kv';
const KEY = 'state';

export const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snacks', label: 'Snacks' },
];

export function defaultState() {
  return {
    v: 1,
    profile: { name: '', sex: 'm', birth: '', heightCm: null, activity: 'low', goal: 'maintain', units: 'us' },
    goals: {
      kcalOverride: null,
      macroMode: 'pct',
      pct: { p: 20, c: 50, f: 30 },
      grams: { p: null, c: null, f: null },
      waterCups: null,
      micros: {},       // custom nutrient goals: key -> { mode: 'min' | 'max' | 'off', amt }
      addExercise: false,
    },
    settings: { usdaKey: '', onboarded: false },
    foods: {},          // id -> food (custom foods, recipes, and every food that has been logged)
    favorites: [],      // food ids
    recents: [],        // [{ id, qty, unit, t }], newest first
    meals: [],          // saved meals: [{ id, name, items: [{ foodId, qty, unit }] }]
    diary: {},          // 'YYYY-MM-DD' -> [entry]
    water: {},          // date -> ml
    caffeine: {},       // date -> mg logged by hand (food caffeine is added on top)
    exercise: {},       // date -> [{ id, name, min, kcal }]
    weights: [],        // [{ d, kg }] sorted by date
    measures: [],       // [{ id, d, type, cm }]
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise;
function db() {
  return (dbPromise ??= openDb());
}

async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

// Fill in keys added in later versions so old saves keep working.
export function migrate(saved) {
  const base = defaultState();
  const out = { ...base, ...saved };
  for (const k of ['profile', 'goals', 'settings']) out[k] = { ...base[k], ...(saved[k] || {}) };
  return out;
}

export async function load() {
  try {
    const saved = await idb('readonly', (s) => s.get(KEY));
    return saved ? migrate(saved) : defaultState();
  } catch (e) {
    console.error('load failed', e);
    return defaultState();
  }
}

let pending = null;
let timer = null;

export function save(state) {
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}

export async function flush() {
  clearTimeout(timer);
  if (!pending) return;
  const s = pending;
  pending = null;
  try {
    await idb('readwrite', (st) => st.put(s, KEY));
  } catch (e) {
    console.error('save failed', e);
  }
}

export async function wipe() {
  pending = null;
  clearTimeout(timer);
  await idb('readwrite', (st) => st.delete(KEY));
}

// Ask iOS not to evict our storage. Installed home-screen apps are exempt anyway.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {}
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

// A small "how is today going" record the service worker reads to write reminder text.
export async function saveSummary(summary) {
  try {
    await idb('readwrite', (st) => st.put(summary, 'summary'));
  } catch {}
}

// Push reminders and the app-icon badge (set by the service worker when a reminder
// arrives about something still missing; cleared whenever the app is open).
//
// The server only learns which meals have entries today, whether the day's goals are
// met, and the last weigh-in date. The notification text is written on the phone by the
// service worker from the `summary` record saved here.

import { saveSummary } from './store.js';
import { targets, waterGoalCups, sumNutrients, NUTRIENTS } from './nutrition.js';
import { todayStr, addDays } from './store.js';

export const DEFAULT_PREFS = {
  goal: { on: true, time: '19:30' },
  meals: { on: true, breakfast: '09:30', lunch: '13:30', dinner: '19:00' },
  weigh: { on: true, day: 1, time: '08:00' },
  weekly: { on: true, day: 0, time: '18:00' },
};

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function pushSupport() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const api = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (ios && !standalone) return { ok: false, reason: 'install' };
  if (!api) return { ok: false, reason: 'unsupported' };
  return { ok: true };
}

const dayTotals = (S, d) => sumNutrients((S.diary[d] || []).map((e) => e.n));

// A compact picture of today and this week, used for reminder text and goal flags.
export function computeSummary(S) {
  const d = todayStr();
  const t = targets(S);
  const tot = dayTotals(S, d);
  const entries = S.diary[d] || [];
  const meals = [...new Set(entries.map((e) => e.meal))];
  const waterGoal = waterGoalCups(S);
  const waterCups = (S.water[d] || 0) / 236.6;
  const open = [];
  if (tot.kcal < t.kcal * 0.9) open.push('kcal');
  if (tot.p < t.p * 0.9) open.push('protein');
  if (waterCups < waterGoal - 0.05) open.push('water');
  // Your own "at least" nutrient goals (fiber, calcium…) count too; recommended amounts don't,
  // or the reminder would nag about every vitamin.
  const extra = [];
  for (const [k, g] of Object.entries(S.goals.micros || {})) {
    if (g.mode !== 'min' || !(g.amt > 0) || tot[k] >= g.amt * 0.9) continue;
    const nn = NUTRIENTS.find((x) => x.key === k);
    if (!nn) continue;
    open.push(k);
    extra.push({ label: nn.label.toLowerCase(), left: Math.round((g.amt - tot[k]) * 10) / 10, unit: nn.unit });
  }

  const week = Array.from({ length: 7 }, (_, i) => addDays(d, i - 6));
  const logged = week.filter((x) => (S.diary[x] || []).length);
  const avgKcal = logged.length ? logged.reduce((a, x) => a + dayTotals(S, x).kcal, 0) / logged.length : 0;
  const proteinDays = logged.filter((x) => dayTotals(S, x).p >= t.p * 0.9).length;
  const kcalDays = logged.filter((x) => {
    const k = dayTotals(S, x).kcal;
    return k >= t.kcal * 0.9 && k <= t.kcal * 1.1;
  }).length;
  const w = S.weights;
  const weekAgo = w.filter((x) => x.d <= addDays(d, -7)).pop();
  const latest = w[w.length - 1];

  return {
    date: d,
    name: S.profile.name || '',
    units: S.profile.units,
    kcalGoal: Math.round(t.kcal),
    kcal: Math.round(tot.kcal),
    proteinGoal: Math.round(t.p),
    protein: Math.round(tot.p),
    waterGoal,
    water: Math.round(waterCups * 10) / 10,
    meals,
    open,
    extra,
    goalsMet: open.length === 0,
    badge: S.settings.push?.badge !== false,
    lastWeigh: latest?.d || null,
    week: {
      daysLogged: logged.length,
      avgKcal: Math.round(avgKcal),
      kcalDays,
      proteinDays,
      weightChangeKg: latest && weekAgo ? Math.round((latest.kg - weekAgo.kg) * 10) / 10 : null,
    },
  };
}

let statusTimer;
let lastStatusSent = '';

// Called after every change: refresh the summary, the badge, and (when it changed) the server flags.
export function afterChange(S) {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(async () => {
    const sum = computeSummary(S);
    await saveSummary(sum);
    updateBadge();
    const push = S.settings.push;
    if (!push?.on || !push.endpoint || !navigator.onLine) return;
    const status = { date: sum.date, meals: sum.meals, goalsMet: sum.goalsMet, lastWeigh: sum.lastWeigh };
    const key = JSON.stringify(status);
    if (key === lastStatusSent) return;
    try {
      const r = await post('/api/status', { endpoint: push.endpoint, tz: tz(), status });
      if (r.ok) lastStatusSent = key;
    } catch {}
  }, 1200);
}

// The badge means "a reminder is waiting". Opening the app counts as seeing it, so clear it.
function updateBadge() {
  if (document.visibilityState === 'visible') navigator.clearAppBadge?.().catch(() => {});
}

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}

function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Must be called from a tap (iOS only shows the permission prompt for a user gesture).
export async function enablePush(S) {
  const sup = pushSupport();
  if (!sup.ok) throw new Error(sup.reason === 'install' ? 'Add Plateful to your Home Screen first, then open it from there.' : 'This browser can\'t receive notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Turn them on in Settings › Notifications › Plateful.');
  const reg = await navigator.serviceWorker.ready;
  const { key } = await (await fetch('/api/vapid')).json();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  const prefs = S.settings.push?.prefs || structuredClone(DEFAULT_PREFS);
  const sum = computeSummary(S);
  await post('/api/subscribe', {
    subscription: sub.toJSON(), tz: tz(), prefs,
    status: { date: sum.date, meals: sum.meals, goalsMet: sum.goalsMet, lastWeigh: sum.lastWeigh },
  });
  S.settings.push = { badge: true, ...S.settings.push, on: true, endpoint: sub.endpoint, prefs };
  await saveSummary(sum);
}

export async function disablePush(S) {
  const endpoint = S.settings.push?.endpoint;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {}
  if (endpoint) await post('/api/unsubscribe', { endpoint }).catch(() => {});
  S.settings.push = { ...S.settings.push, on: false, endpoint: null };
  navigator.clearAppBadge?.().catch(() => {});
}

export async function savePrefs(S, prefs) {
  S.settings.push = { ...S.settings.push, prefs };
  if (S.settings.push.on && S.settings.push.endpoint) {
    const r = await post('/api/prefs', { endpoint: S.settings.push.endpoint, tz: tz(), prefs });
    if (!r.found) throw new Error('This phone\'s notification sign-up has expired. Turn notifications off and on again.');
  }
}

export async function sendTest(S) {
  return post('/api/test', { endpoint: S.settings.push.endpoint });
}

// iOS can drop a subscription (for example after a reinstall). Re-register quietly if so.
export async function checkSubscription(S) {
  const push = S.settings.push;
  if (!push?.on || pushSupport().ok === false || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub && sub.endpoint === push.endpoint) return;
    await enablePush(S);
  } catch {}
}

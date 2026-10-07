// Offline support: the app shell and food database are cached; everything else is network-first.
const VERSION = 'plateful-v7';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/nutrition.js', 'js/foods.js', 'js/scanner.js', 'js/charts.js', 'js/notify.js', 'js/parse.js', 'js/gestures.js', 'js/platform.js',
  'data/fndds.json', 'vendor/zxing-wasm/reader.js', 'vendor/zxing-wasm/zxing_reader.wasm',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/badge-96.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // APIs go straight to the network
  // Stale-while-revalidate: open instantly from cache, pick up new versions in the background.
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request).then((r) => {
      if (r.ok) cache.put(e.request, r.clone());
      return r;
    }).catch(() => cached);
    return cached || network;
  }));
});

// ---------- reminders ----------
// The push only says which reminder fired; the words come from today's summary on this phone.

function readSummary() {
  return new Promise((resolve) => {
    const req = indexedDB.open('plateful', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      try {
        const get = req.result.transaction('kv').objectStore('kv').get('summary');
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    };
  });
}

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const n = (v) => Math.round(v).toLocaleString('en-US');
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function message(kind, data, s) {
  const today = s && s.date === localDate();
  const kcalLeft = s ? s.kcalGoal - (today ? s.kcal : 0) : null;
  const leftLine = s ? (kcalLeft > 0 ? `${n(kcalLeft)} kcal left today.` : `Calorie goal reached for today.`) : '';

  if (kind === 'test') return { title: 'Notifications are on', body: 'This is how Plateful reminders will look.' };

  if (kind === 'meal') {
    const meal = data.meal || 'meal';
    if (today && s.meals.includes(meal)) return { title: `${cap(meal)} is logged`, body: leftLine };
    return { title: `Log ${meal}?`, body: `Nothing logged for ${meal} yet. ${leftLine}`.trim() };
  }

  if (kind === 'goal') {
    if (!s) return { title: 'Check today\'s goals', body: 'Open Plateful to see what\'s left today.' };
    if (!today) return { title: 'Nothing logged today', body: `Your goal is ${n(s.kcalGoal)} kcal. Log what you ate so far.` };
    const parts = [];
    if (s.open.includes('kcal')) parts.push(`${n(s.kcalGoal - s.kcal)} kcal`);
    if (s.open.includes('protein')) parts.push(`${n(s.proteinGoal - s.protein)} g protein`);
    if (s.open.includes('water')) parts.push(`${Math.max(1, Math.round(s.waterGoal - s.water))} cups of water`);
    for (const x of s.extra || []) parts.push(`${x.left >= 10 ? n(x.left) : x.left.toFixed(1)} ${x.unit} ${x.label}`);
    if (!parts.length) return { title: 'All goals hit today', body: `${n(s.kcal)} kcal and ${n(s.protein)} g protein. Nice work.` };
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    return { title: 'Goals still open', body: `Still to go today: ${list}.` };
  }

  if (kind === 'weigh') return { title: 'Weekly weigh-in', body: 'Step on the scale and log it to keep the trend accurate.' };

  if (kind === 'weekly') {
    if (!s || !s.week.daysLogged) return { title: 'Your week', body: 'No days logged this week. A fresh week starts tomorrow.' };
    const w = s.week;
    let body = `Logged ${w.daysLogged} of 7 days, averaging ${n(w.avgKcal)} kcal (goal ${n(s.kcalGoal)}). Protein goal hit on ${w.proteinDays} day${w.proteinDays === 1 ? '' : 's'}.`;
    if (w.weightChangeKg != null) {
      const v = s.units === 'us' ? w.weightChangeKg * 2.20462 : w.weightChangeKg;
      body += ` Weight ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} ${s.units === 'us' ? 'lb' : 'kg'}.`;
    }
    return { title: 'Your week in Plateful', body };
  }
  return { title: 'Plateful', body: 'Open Plateful to check today.' };
}

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil((async () => {
    const s = await readSummary();
    const { title, body } = message(data.kind, data, s);
    await self.registration.showNotification(title, {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: `plateful-${data.kind || 'note'}`,
      data: { url: data.kind === 'weigh' ? './?go=weigh' : data.kind === 'weekly' ? './?go=progress' : './' },
    });
    // Badge = "something needs you": a meal not logged, goals still open, a weigh-in due.
    // Opening the app clears it. Tests, summaries and "all done" messages don't set it.
    const needsAction = ['meal', 'goal', 'weigh'].includes(data.kind) && !/is logged|goals hit/i.test(title);
    if (needsAction && s?.badge !== false && 'setAppBadge' in self.navigator) {
      try { await self.navigator.setAppBadge(1); } catch {}
    }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) {
        await w.focus();
        w.postMessage({ type: 'open', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

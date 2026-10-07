// Plateful backend: stores push subscriptions and sends reminder pushes on a cron.
// Static files are served by the assets binding; only /api/* reaches this code.
//
// Privacy: the server never sees food entries. The app reports only which meals have
// something logged today, whether the day's goals are met, and the last weigh-in date,
// so it can skip reminders that aren't needed. The phone writes the notification text.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      if (url.pathname === '/api/vapid' && req.method === 'GET') return json({ key: env.VAPID_PUBLIC });
      if (url.pathname === '/api/food-search' && req.method === 'GET') return foodSearch(url.searchParams.get('q') || '', ctx);
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      // Real requests are a few hundred bytes; refuse anything large.
      const text = await req.text();
      if (text.length > 8192) return json({ error: 'too large' }, 413);
      const body = JSON.parse(text);
      const endpoint = body.subscription?.endpoint || body.endpoint;
      if (!validEndpoint(endpoint)) return json({ error: 'bad endpoint' }, 400);
      const id = await sha256(endpoint);

      if (url.pathname === '/api/subscribe') {
        const { keys } = body.subscription;
        if (!keys?.p256dh || !keys?.auth) return json({ error: 'missing keys' }, 400);
        await env.DB.prepare(
          `INSERT INTO subs (id, endpoint, p256dh, auth, tz, prefs, status, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT(id) DO UPDATE SET p256dh = ?3, auth = ?4, tz = ?5, prefs = ?6, status = ?7, updated = ?8`,
        ).bind(id, endpoint, keys.p256dh, keys.auth, cleanTz(body.tz), JSON.stringify(cleanPrefs(body.prefs)), JSON.stringify(cleanStatus(body.status)), Date.now()).run();
        return json({ ok: true });
      }
      if (url.pathname === '/api/prefs') {
        const r = await env.DB.prepare('UPDATE subs SET prefs = ?2, tz = ?3, updated = ?4 WHERE id = ?1')
          .bind(id, JSON.stringify(cleanPrefs(body.prefs)), cleanTz(body.tz), Date.now()).run();
        return json({ ok: true, found: r.meta.changes > 0 });
      }
      if (url.pathname === '/api/status') {
        const r = await env.DB.prepare('UPDATE subs SET status = ?2, tz = ?3, updated = ?4 WHERE id = ?1')
          .bind(id, JSON.stringify(cleanStatus(body.status)), cleanTz(body.tz), Date.now()).run();
        return json({ ok: true, found: r.meta.changes > 0 });
      }
      if (url.pathname === '/api/unsubscribe') {
        await env.DB.prepare('DELETE FROM subs WHERE id = ?1').bind(id).run();
        return json({ ok: true });
      }
      if (url.pathname === '/api/test') {
        const row = await env.DB.prepare('SELECT * FROM subs WHERE id = ?1').bind(id).first();
        if (!row) return json({ error: 'not subscribed' }, 404);
        const res = await sendPush(env, row, { kind: 'test' });
        return json({ ok: res.ok, status: res.status });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  },
};

// ---------- branded food search ----------
// Open Food Facts' search service is fast and reliable but has no CORS headers, and their
// older endpoint fails often under load. So the app searches through here; results are
// cached for a day at Cloudflare's edge, shared by everyone searching the same words.

const OFF_SEARCH = 'https://search.openfoodfacts.org/search';
const OFF_FIELDS = 'code,product_name,generic_name,brands,nutriments,serving_quantity,serving_size';

async function offQuery(q) {
  const params = new URLSearchParams({ q, page_size: '25', fields: OFF_FIELDS, langs: 'en' });
  const r = await fetch(`${OFF_SEARCH}?${params}`, { headers: { 'User-Agent': 'Plateful/1.0 (https://plateful.leokthakur.workers.dev)' } });
  if (!r.ok) throw new Error(`Open Food Facts ${r.status}`);
  return (await r.json()).hits || [];
}

async function foodSearch(raw, ctx) {
  // Plain words only, so nobody can inject search syntax.
  const words = raw.toLowerCase().replace(/[^\p{L}\p{N}%' ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (words.length < 2) return json({ products: [] });
  const cacheKey = new Request(`https://cache.plateful/food-search/v2?q=${encodeURIComponent(words)}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // US products first; fill up with worldwide matches when the US list is short.
  // Parentheses break their parser, so join terms with AND; drop words it reads as operators.
  const terms = words.split(' ').filter((w) => !['and', 'or', 'not', 'to'].includes(w));
  if (!terms.length) return json({ products: [] });
  const [us, all] = await Promise.allSettled([offQuery(`${terms.join(' AND ')} AND countries_tags:"en:united-states"`), offQuery(terms.join(' '))]);
  if (us.status === 'rejected' && all.status === 'rejected') return json({ error: 'search unavailable' }, 502);
  const seen = new Set();
  const products = [];
  for (const h of [...(us.value || []), ...(all.value || [])]) {
    if (!h.code || seen.has(h.code)) continue;
    seen.add(h.code);
    products.push(h);
    if (products.length >= 25) break;
  }
  const res = new Response(JSON.stringify({ products }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// ---------- validation ----------

// Only real browser push services, so this can't be used to make requests elsewhere.
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^android\.googleapis\.com$/];
function validEndpoint(e) {
  try {
    const u = new URL(e);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

function cleanTz(tz) {
  if (typeof tz !== 'string' || !tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const t = (v, d) => (TIME.test(v) ? v : d);
const day = (v, d) => (Number.isInteger(v) && v >= 0 && v <= 6 ? v : d);

export function cleanPrefs(p = {}) {
  return {
    goal: { on: !!p.goal?.on, time: t(p.goal?.time, '19:30') },
    meals: {
      on: !!p.meals?.on,
      breakfast: t(p.meals?.breakfast, '09:30'),
      lunch: t(p.meals?.lunch, '13:30'),
      dinner: t(p.meals?.dinner, '19:00'),
    },
    weigh: { on: !!p.weigh?.on, day: day(p.weigh?.day, 1), time: t(p.weigh?.time, '08:00') },
    weekly: { on: !!p.weekly?.on, day: day(p.weekly?.day, 0), time: t(p.weekly?.time, '18:00') },
  };
}

function cleanStatus(s = {}) {
  const date = /^\d{4}-\d\d-\d\d$/;
  return {
    date: date.test(s.date) ? s.date : null,
    meals: Array.isArray(s.meals) ? s.meals.filter((m) => ['breakfast', 'lunch', 'dinner', 'snacks'].includes(m)) : [],
    goalsMet: !!s.goalsMet,
    lastWeigh: date.test(s.lastWeigh) ? s.lastWeigh : null,
  };
}

// ---------- scheduling ----------

function localNow(tz, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
  };
}

const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Which reminders are due for this subscriber right now (and not already sent today)?
export function dueReminders(row, now = new Date()) {
  const prefs = JSON.parse(row.prefs);
  const status = JSON.parse(row.status || '{}');
  const sent = JSON.parse(row.sent || '{}');
  const L = localNow(row.tz, now);
  const today = status.date === L.date;
  // Fire within the hour after the chosen time, so a delayed cron run still sends it.
  const inWindow = (hhmm) => L.minutes >= toMin(hhmm) && L.minutes < toMin(hhmm) + 60;
  const due = [];
  const add = (key, payload) => { if (sent[key] !== L.date) due.push({ key, payload }); };

  if (prefs.meals.on) {
    for (const meal of ['breakfast', 'lunch', 'dinner']) {
      if (inWindow(prefs.meals[meal]) && !(today && status.meals.includes(meal))) add(`meal-${meal}`, { kind: 'meal', meal });
    }
  }
  if (prefs.goal.on && inWindow(prefs.goal.time) && !(today && status.goalsMet)) add('goal', { kind: 'goal' });
  if (prefs.weigh.on && L.weekday === prefs.weigh.day && inWindow(prefs.weigh.time)) {
    if (!status.lastWeigh || daysBetween(status.lastWeigh, L.date) >= 6) add('weigh', { kind: 'weigh' });
  }
  if (prefs.weekly.on && L.weekday === prefs.weekly.day && inWindow(prefs.weekly.time)) add('weekly', { kind: 'weekly' });
  return { due, date: L.date, sent };
}

async function runReminders(env) {
  const { results } = await env.DB.prepare('SELECT * FROM subs').all();
  for (const row of results) {
    const { due, date, sent } = dueReminders(row);
    if (!due.length) continue;
    // One notification per run; if several are due at once, the most useful one wins.
    const order = ['goal', 'meal-dinner', 'meal-lunch', 'meal-breakfast', 'weigh', 'weekly'];
    due.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    const res = await sendPush(env, row, due[0].payload);
    if (res.status === 404 || res.status === 410) {
      await env.DB.prepare('DELETE FROM subs WHERE id = ?1').bind(row.id).run();
      continue;
    }
    for (const d of due) sent[d.key] = date; // mark all as handled so they don't pile up
    await env.DB.prepare('UPDATE subs SET sent = ?2 WHERE id = ?1').bind(row.id, JSON.stringify(sent)).run();
  }
}

// ---------- Web Push (RFC 8291 encryption + RFC 8292 VAPID) ----------

const enc = new TextEncoder();
const b64u = {
  encode: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};

function concat(...arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of arrays) { out.set(a, i); i += a.length; }
  return out;
}

async function sha256(s) {
  return b64u.encode(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

export async function encryptPayload(p256dh, authSecret, plaintext) {
  const uaPublic = b64u.decode(p256dh);
  const auth = b64u.decode(authSecret);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(enc.encode(plaintext), new Uint8Array([2])); // 0x02 = last (only) record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record));

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

let signingKey;
async function vapidJwt(env, audience) {
  signingKey ??= await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, enc.encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64u.encode(sig)}`;
}

async function sendPush(env, row, payload) {
  const body = await encryptPayload(row.p256dh, row.auth, JSON.stringify(payload));
  const jwt = await vapidJwt(env, new URL(row.endpoint).origin);
  return fetch(row.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'normal',
    },
    body,
  });
}

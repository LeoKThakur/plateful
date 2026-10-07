import * as store from './store.js';
import { MEALS, uid, todayStr, addDays, parseDate } from './store.js';
import {
  NUTRIENTS, MICROS, GOAL_NUTRIENTS, defaultMicroTargets, NKEYS, ACTIVITY, GOALS, ACTIVITIES, sumNutrients, scale, targets, microTargets,
  caffeineLimit, waterGoalCups, unitsFor, findUnit, parseQty, fmtQty, fmt, ageYears, latestWeight,
  latestHeight, exerciseKcal, kgToLb, lbToKg, cmToIn, inToCm,
} from './nutrition.js';
import {
  loadLocal, localFood, searchLocal, searchFoods, searchOff, offBarcode, searchUsdaBranded, usdaBarcode, SOURCE_BADGE,
} from './foods.js';
import { isIOS, isAndroid, isStandalone, canPromptInstall, promptInstall, onInstallChange, cameraHelp } from './platform.js';
import { startScanner, readBarcodeFromFile, warmUpScanner } from './scanner.js';
import { barChart, lineChart, ring } from './charts.js';
import { parseMeal, matchUnit, queryVariants } from './parse.js';
import { swipeToDelete, swipeDays, dragToClose } from './gestures.js';
import { computeSummary, DEFAULT_PREFS, pushSupport, afterChange, enablePush, disablePush, savePrefs, sendTest, checkSubscription } from './notify.js';

let S;
const ui = { tab: 'diary', date: todayStr(), range: 7, foodsTab: 'foods' };

// ---------- helpers ----------

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isUS = () => S.profile.units === 'us';

function commit({ silent = false } = {}) {
  store.save(S);
  afterChange(S);
  if (!silent) renderAll();
}

function renderAll() {
  renderMain();
  sheets.forEach((s) => s.refresh?.());
}

function dayEntries(d) {
  return S.diary[d] || [];
}

function dayExercise(d) {
  return S.exercise[d] || [];
}

function dayTotals(d) {
  return sumNutrients(dayEntries(d).map((e) => e.n));
}

function getFood(id) {
  return S.foods[id] || localFood(id);
}

function storableFood(food) {
  const { _lc, _words, ...rest } = food;
  return rest;
}

function rememberFood(food) {
  if (!S.foods[food.id] || food.source !== 'custom') S.foods[food.id] = storableFood(food);
}

function recentFor(id) {
  return S.recents.find((r) => r.id === id);
}

function defaultAmount(food) {
  const r = recentFor(food.id);
  if (r) return { qty: r.qty, unit: findUnit(food, r.unit).label };
  const u = unitsFor(food)[0];
  return { qty: u.label === 'g' ? 100 : 1, unit: u.label };
}

function makeEntry(food, qty, unitLabel, meal) {
  const u = findUnit(food, unitLabel);
  const g = qty * u.g;
  return {
    id: uid(), meal, foodId: food.id, name: food.name, brand: food.brand || '', src: food.source,
    qty, unit: u.label, g, n: scale(food.n, g),
  };
}

function bumpRecent(food, qty, unit) {
  S.recents = [{ id: food.id, qty, unit, t: Date.now() }, ...S.recents.filter((r) => r.id !== food.id)].slice(0, 80);
}

function logFood(date, food, qty, unit, meal, { toastMsg = true } = {}) {
  rememberFood(food);
  const e = makeEntry(food, qty, unit, meal);
  (S.diary[date] ||= []).push(e);
  bumpRecent(food, qty, e.unit);
  commit();
  if (toastMsg) toast(`Added ${food.name} to ${mealLabel(meal)}`, { undo: () => removeEntry(date, e.id) });
  return e;
}

function removeEntry(date, id) {
  S.diary[date] = dayEntries(date).filter((e) => e.id !== id);
  if (!S.diary[date].length) delete S.diary[date];
  commit();
}

const mealLabel = (k) => MEALS.find((m) => m.key === k)?.label || k;

function amountText(qty, unit) {
  return `${fmtQty(qty)} ${unit}`;
}

function defaultMealForNow() {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h >= 17 && h < 21) return 'dinner';
  return 'snacks';
}

function prettyDate(d) {
  const t = todayStr();
  if (d === t) return 'Today';
  if (d === addDays(t, -1)) return 'Yesterday';
  if (d === addDays(t, 1)) return 'Tomorrow';
  return parseDate(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function weightStr(kg, dp = 1) {
  if (kg == null) return '–';
  return isUS() ? `${fmt(kgToLb(kg), dp)} lb` : `${fmt(kg, dp)} kg`;
}

function lengthStr(cm) {
  if (cm == null) return '–';
  return isUS() ? `${fmt(cmToIn(cm), 1)} in` : `${fmt(cm, 1)} cm`;
}

function heightStr(cm) {
  if (!cm) return '–';
  if (!isUS()) return `${fmt(cm, 0)} cm`;
  const inches = cmToIn(cm);
  return `${Math.floor(inches / 12)}′ ${fmt(inches % 12, 1)}″`;
}

function badge(src) {
  const b = SOURCE_BADGE[src];
  return b ? `<span class="badge ${b.cls}" title="${esc(b.title)}">${b.label}</span>` : '';
}

const ICON = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  scan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 9v6M10 9v6M13 9v6M16.5 9v6"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
};

// ---------- toast ----------

let toastTimer;
function toast(msg, { undo } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  el.classList.add('show');
  if (undo) $('button', el).onclick = () => { undo(); el.classList.remove('show'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

// ---------- sheets (modal stack) ----------

const sheets = [];
let sheetSeq = 0;

// spec: { title, html(): string, bind(el), refresh?, wide?, onClose? , left?: html, right?: html }
function openSheet(spec) {
  const el = document.createElement('section');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  const titleId = `sheet-title-${++sheetSeq}`;
  el.setAttribute('aria-labelledby', titleId);
  const s = { ...spec, el };
  s.render = () => {
    const scroll = $('.sheet-body', el)?.scrollTop || 0;
    el.innerHTML = `
      <div class="sheet-head">
        <button type="button" class="link" data-close>${spec.closeLabel || (sheets.length > 0 && sheets.indexOf(s) > 0 ? 'Back' : 'Close')}</button>
        <h2 id="${titleId}">${esc(typeof spec.title === 'function' ? spec.title() : spec.title)}</h2>
        <span class="head-right">${spec.right ? spec.right() : ''}</span>
      </div>
      <div class="sheet-body">${spec.html()}</div>`;
    $('[data-close]', el).onclick = () => closeSheet(s);
    dragToClose(el, $('.sheet-head', el), () => closeSheet(s));
    spec.bind?.(el, s);
    $('.sheet-body', el).scrollTop = scroll;
  };
  s.refresh = spec.live ? s.render : null;
  sheets.push(s);
  armBack();
  document.getElementById('sheets').appendChild(el);
  s.render();
  requestAnimationFrame(() => el.classList.add('open'));
  document.body.classList.add('has-sheet');
  return s;
}

function closeSheet(s = sheets[sheets.length - 1], { fromBack = false } = {}) {
  if (!s) return;
  const i = sheets.indexOf(s);
  if (i < 0) return;
  sheets.splice(i, 1);
  s.onClose?.();
  s.el.classList.remove('open');
  setTimeout(() => s.el.remove(), 280);
  if (!sheets.length) {
    document.body.classList.remove('has-sheet');
    if (!fromBack) disarmBack();
  }
}

// Android's Back button (and browser Back) closes the top sheet instead of leaving the app.
// While any sheet is open there is exactly one extra history entry to catch it.
let backArmed = false;
let swallowPops = 0;
function armBack() {
  if (backArmed) return;
  history.pushState({ plateful: 'sheet' }, '');
  backArmed = true;
}
function disarmBack() {
  if (!backArmed) return;
  backArmed = false;
  swallowPops++;
  history.back();
}
window.addEventListener('popstate', () => {
  if (swallowPops) {
    swallowPops--;
    if (sheets.length) armBack(); // a sheet opened while the old entry was being removed
    return;
  }
  backArmed = false;
  if (!sheets.length) return;
  closeSheet(sheets[sheets.length - 1], { fromBack: true });
  if (sheets.length) armBack();
});

function closeAllSheets() {
  [...sheets].reverse().forEach((s) => closeSheet(s));
}

// A small form in a sheet. fields: [{ name, label, type, value, options, step, placeholder, hint }]
function formSheet({ title, fields, submit = 'Save', onSubmit, extra = '', danger }) {
  const s = openSheet({
    title,
    html: () => `
      <form class="form" novalidate>
        ${fields.filter((f) => !f.more).map(fieldHtml).join('')}
        ${fields.some((f) => f.more) ? `<details class="more-fields"><summary>More nutrients</summary><div class="form">${fields.filter((f) => f.more).map(fieldHtml).join('')}</div></details>` : ''}
        ${extra}
        <button class="btn primary block" type="submit">${esc(submit)}</button>
        ${danger ? `<button class="btn danger block" type="button" data-danger>${esc(danger.label)}</button>` : ''}
      </form>`,
    bind: (el) => {
      $('form', el).onsubmit = (ev) => {
        ev.preventDefault();
        const vals = {};
        for (const f of fields) {
          const input = $(`[name="${f.name}"]`, el);
          if (!input) continue;
          vals[f.name] = f.type === 'checkbox' ? input.checked : input.value;
        }
        if (onSubmit(vals) !== false) closeSheet(s);
      };
      if (danger) $('[data-danger]', el).onclick = () => { if (danger.onClick() !== false) closeSheet(s); };
      const first = $('input:not([type=hidden]), select', el);
      if (first && fields[0]?.autofocus) setTimeout(() => first.focus(), 300);
    },
  });
  return s;
}

function fieldHtml(f) {
  const id = `f-${f.name}`;
  const label = `<label for="${id}">${esc(f.label)}</label>`;
  const hint = f.hint ? `<p class="hint">${esc(f.hint)}</p>` : '';
  if (f.type === 'select') {
    return `<div class="field">${label}<select id="${id}" name="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${hint}</div>`;
  }
  if (f.type === 'checkbox') {
    return `<label class="field check"><input type="checkbox" id="${id}" name="${f.name}" ${f.value ? 'checked' : ''}><span>${esc(f.label)}</span></label>${hint}`;
  }
  const mode = f.type === 'number' ? 'inputmode="decimal"' : '';
  const type = f.type === 'number' ? 'text' : f.type || 'text';
  return `<div class="field">${label}<input id="${id}" name="${f.name}" type="${type}" ${mode} value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.unit ? 'class="has-unit"' : ''} autocomplete="off">${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}${hint}</div>`;
}

const num = (v) => {
  const n = parseQty(v);
  return Number.isFinite(n) ? n : null;
};

// ---------- main tabs ----------

function renderMain() {
  const main = $('#main');
  const views = { diary: diaryView, progress: progressView, foods: foodsView, settings: settingsView };
  main.innerHTML = views[ui.tab]();
  ui.slide = '';
  $$('#tabbar button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
  bindMain(main);
  if (ui.tab === 'diary') {
    swipeToDelete(main, (id) => {
      const date = ui.date;
      const before = dayEntries(date);
      const e = before.find((x) => x.id === id);
      removeEntry(date, id);
      if (e) toast(`Deleted ${e.name}`, { undo: () => { S.diary[date] = before; commit(); } });
    });
    swipeDays($('.day-swipe', main), { prev: () => changeDay(-1), next: () => changeDay(1) });
  }
}

function changeDay(n) {
  ui.date = addDays(ui.date, n);
  ui.slide = n > 0 ? 'day-slide' : 'day-slide from-left';
  renderMain();
}

// ----- Diary -----

function diaryView() {
  const d = ui.date;
  const t = targets(S);
  const tot = dayTotals(d);
  const ex = dayExercise(d).reduce((a, e) => a + e.kcal, 0);
  const budget = t.kcal + (S.goals.addExercise ? ex : 0);
  const left = budget - tot.kcal;
  const macro = (k, label) => {
    const goal = t[k];
    const pct = goal ? Math.min(100, (tot[k] / goal) * 100) : 0;
    return `<div class="macro m-${k}">
      <div class="macro-top"><span>${label}</span><span><b>${fmt(tot[k])}</b> / ${fmt(goal)} g</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="macro-left">${goal - tot[k] >= 0 ? `${fmt(goal - tot[k])} g left` : `${fmt(tot[k] - goal)} g over`}</div>
    </div>`;
  };

  const water = S.water[d] || 0;
  const cups = Math.round((water / 236.6) * 10) / 10;
  const wGoal = waterGoalCups(S);
  const caf = (S.caffeine[d] || 0) + tot.caf;
  const cafLim = caffeineLimit(S);

  return `
  <div class="day-swipe ${ui.slide || ''}">
  <h1 class="sr-only">Diary, ${esc(prettyDate(d))}</h1>
  <header class="topbar">
    <button type="button" class="icon-btn" data-act="day-prev" aria-label="Previous day">${ICON.chevL}</button>
    <label class="date-pick">
      <span>${esc(prettyDate(d))}</span>
      <input type="date" value="${d}" data-act-change="day-set" aria-label="Pick a date">
    </label>
    <button type="button" class="icon-btn" data-act="day-next" aria-label="Next day">${ICON.chevR}</button>
    <button type="button" class="icon-btn end" data-act="day-menu" aria-label="Day options">${ICON.more}</button>
  </header>

  <section class="card summary">
    <div class="ring-wrap">
      ${ring(budget ? tot.kcal / budget : 0)}
      <div class="ring-label">
        <b>${fmt(Math.abs(left))}</b>
        <span>${left >= 0 ? 'left' : 'over'}</span>
      </div>
    </div>
    <dl class="equation">
      <div><dt>Goal</dt><dd>${fmt(t.kcal)}</dd></div>
      <div><dt>Food</dt><dd>${tot.kcal >= 0.5 ? "−" : ""}${fmt(tot.kcal)}</dd></div>
      ${S.goals.addExercise ? `<div><dt>Exercise</dt><dd>+${fmt(ex)}</dd></div>` : ''}
      <div class="eq-total"><dt>Remaining</dt><dd>${fmt(left)}</dd></div>
    </dl>
  </section>
  <section class="card macros">
    ${macro('p', 'Protein')}${macro('c', 'Carbs')}${macro('f', 'Fat')}
    <button type="button" class="link small" data-act="nutrients">All nutrients</button>
  </section>
  </div>

  ${MEALS.map((m) => mealCard(d, m)).join('')}
  ${d === todayStr() ? ideasCard(left, t.p - tot.p) : ''}

  <section class="card tracker">
    <div class="tracker-head"><h2>Water</h2><span class="muted">${fmt(cups, 1)} / ${wGoal} cups</span></div>
    <div class="cups" role="group" aria-label="Water cups">
      ${Array.from({ length: Math.max(wGoal, Math.ceil(cups)) }, (_, i) => `<span class="cup ${i < Math.floor(cups + 0.001) ? 'full' : ''}"></span>`).join('')}
    </div>
    <div class="row-btns">
      <button type="button" class="btn small" data-act="water" data-ml="-236.6" aria-label="Remove a cup">${ICON.minus}</button>
      <button type="button" class="btn small" data-act="water" data-ml="236.6">+ 1 cup</button>
      <button type="button" class="btn small" data-act="water" data-ml="500">+ bottle</button>
      <button type="button" class="btn small ghost" data-act="water-custom">Other</button>
    </div>
  </section>

  <section class="card tracker">
    <div class="tracker-head"><h2>Caffeine</h2><span class="muted ${cafLim != null && caf > cafLim ? 'warn-text' : ''}">${fmt(caf)}${cafLim != null ? ` / ${cafLim}` : ''} mg</span></div>
    <p class="hint">Includes caffeine from logged foods. ${cafLim == null ? 'No limit set.' : S.goals.micros?.caf?.mode === 'max' ? 'The limit is your own goal.' : 'Limit is Health Canada\'s guidance for your age.'}</p>
    <div class="row-btns">
      <button type="button" class="btn small" data-act="caffeine" data-mg="34">Soda</button>
      <button type="button" class="btn small" data-act="caffeine" data-mg="80">Energy drink</button>
      <button type="button" class="btn small" data-act="caffeine" data-mg="47">Tea</button>
      <button type="button" class="btn small" data-act="caffeine" data-mg="95">Coffee</button>
      <button type="button" class="btn small ghost" data-act="caffeine-custom">Other</button>
    </div>
    ${S.caffeine[d] ? `<button type="button" class="link small" data-act="caffeine-reset">Clear manual caffeine (${fmt(S.caffeine[d])} mg)</button>` : ''}
  </section>

  <section class="card tracker">
    <div class="tracker-head"><h2>Exercise</h2><span class="muted">${fmt(ex)} kcal</span></div>
    ${dayExercise(d).map((e) => `
      <button type="button" class="row" data-act="exercise-edit" data-id="${e.id}">
        <span class="row-main"><span class="row-title">${esc(e.name)}</span><span class="row-sub">${e.min} min</span></span>
        <span class="row-kcal">${fmt(e.kcal)}</span>
      </button>`).join('')}
    <button type="button" class="add-row" data-act="exercise-add">${ICON.plus}<span>Add exercise</span></button>
  </section>
  <div class="spacer"></div>`;
}

function mealCard(d, m) {
  const entries = dayEntries(d).filter((e) => e.meal === m.key);
  const kcal = entries.reduce((a, e) => a + e.n.kcal, 0);
  return `<section class="card meal">
    <div class="meal-head">
      <h2>${m.label}</h2>
      <span class="muted">${entries.length ? fmt(kcal) + ' kcal' : ''}</span>
      <button type="button" class="icon-btn small" data-act="meal-menu" data-meal="${m.key}" aria-label="${m.label} options">${ICON.more}</button>
    </div>
    ${entries.map((e) => `
      <div class="swipe"><div class="swipe-bg" aria-hidden="true">Delete</div>
      <button type="button" class="row" data-act="entry" data-id="${e.id}">
        <span class="row-main">
          <span class="row-title">${esc(e.name)}</span>
          <span class="row-sub">${e.brand ? esc(e.brand) + ' · ' : ''}${esc(amountText(e.qty, e.unit))}</span>
        </span>
        <span class="row-kcal">${fmt(e.n.kcal)}</span>
      </button></div>`).join('')}
    <button type="button" class="add-row" data-act="add-food" data-meal="${m.key}">${ICON.plus}<span>Add food</span></button>
  </section>`;
}

// ----- Progress -----

function progressView() {
  const n = ui.range;
  const end = todayStr();
  const days = Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));
  const t = targets(S);
  const totals = days.map((d) => dayTotals(d));
  const logged = days.map((d, i) => [d, totals[i]]).filter(([d]) => dayEntries(d).length);
  const avg = (k) => (logged.length ? logged.reduce((a, [, tt]) => a + tt[k], 0) / logged.length : 0);
  const exTotal = days.reduce((a, d) => a + dayExercise(d).reduce((b, e) => b + e.kcal, 0), 0);
  const fmtLabel = (d) => {
    const dt = parseDate(d);
    return n <= 7 ? dt.toLocaleDateString(undefined, { weekday: 'narrow' }) : `${dt.getMonth() + 1}/${dt.getDate()}`;
  };
  // For 90 days, show weekly averages so the bars stay readable.
  let bars;
  if (n > 31) {
    bars = [];
    for (let i = 0; i < days.length; i += 7) {
      const wk = days.slice(i, i + 7).filter((d) => dayEntries(d).length);
      const v = wk.length ? wk.reduce((a, d) => a + dayTotals(d).kcal, 0) / wk.length : 0;
      bars.push({ label: fmtLabel(days[i]), value: v });
    }
  } else {
    bars = days.map((d, i) => ({ label: fmtLabel(d), value: totals[i].kcal }));
  }

  const avgP = avg('p') * 4, avgC = avg('c') * 4, avgF = avg('f') * 9;
  const macroK = avgP + avgC + avgF || 1;
  const start = days[0];
  const weights = S.weights.filter((w) => w.d >= start);
  const wPoints = weights.map((w) => ({ t: parseDate(w.d).getTime(), value: isUS() ? kgToLb(w.kg) : w.kg, label: w.d }));
  const wChange = weights.length > 1 ? weights[weights.length - 1].kg - weights[0].kg : null;
  const mt = microTargets(S, t.kcal);
  const latestMeasures = {};
  for (const m of [...S.measures].sort((a, b) => a.d.localeCompare(b.d))) latestMeasures[m.type] = m;
  const waterAvg = days.reduce((a, d) => a + (S.water[d] || 0), 0) / n / 236.6;

  return `
  <header class="topbar"><h1>Progress</h1></header>
  <div class="seg" role="tablist">
    ${[[7, 'Week'], [30, 'Month'], [90, '3 months']].map(([v, l]) => `<button type="button" role="tab" aria-selected="${ui.range === v}" data-act="range" data-v="${v}">${l}</button>`).join('')}
  </div>

  ${weeklyCard()}
  ${adaptiveCard()}
  <section class="card">
    <div class="card-head"><h2>Calories</h2><span class="muted">${n > 31 ? 'weekly average' : 'per day'}</span></div>
    ${barChart(bars, t.kcal)}
    <div class="stats">
      <div><b>${fmt(avg('kcal'))}</b><span>avg / day</span></div>
      <div><b>${fmt(t.kcal)}</b><span>goal</span></div>
      <div><b>${logged.length}/${n}</b><span>days logged</span></div>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Macros</h2><span class="muted">avg on logged days</span></div>
    <div class="split" aria-hidden="true">
      <i class="m-p" style="flex:${avgP}"></i><i class="m-c" style="flex:${avgC}"></i><i class="m-f" style="flex:${avgF}"></i>
    </div>
    <div class="stats">
      <div><b>${fmt(avg('p'))} g</b><span class="key m-p">Protein ${fmt((avgP / macroK) * 100)}%</span></div>
      <div><b>${fmt(avg('c'))} g</b><span class="key m-c">Carbs ${fmt((avgC / macroK) * 100)}%</span></div>
      <div><b>${fmt(avg('f'))} g</b><span class="key m-f">Fat ${fmt((avgF / macroK) * 100)}%</span></div>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Weight</h2><button type="button" class="btn small" data-act="weight-add">Log weight</button></div>
    ${wPoints.length ? lineChart(wPoints, { unit: isUS() ? 'lb' : 'kg', title: 'Weight trend' }) : '<p class="empty">No weigh-ins in this period.</p>'}
    <div class="stats">
      <div><b>${weightStr(latestWeight(S))}</b><span>latest</span></div>
      <div><b>${wChange == null ? '–' : (wChange >= 0 ? '+' : '−') + weightStr(Math.abs(wChange))}</b><span>change</span></div>
      <div><b>${weights.length}</b><span>weigh-ins</span></div>
    </div>
    ${S.weights.length ? `<details><summary>All weigh-ins</summary>${[...S.weights].reverse().map((w) => `
      <button type="button" class="row" data-act="weight-edit" data-d="${w.d}"><span class="row-main"><span class="row-title">${esc(prettyDate(w.d))}</span><span class="row-sub">${w.d}</span></span><span class="row-kcal">${weightStr(w.kg)}</span></button>`).join('')}</details>` : ''}
  </section>

  <section class="card">
    <div class="card-head"><h2>Body measurements</h2><button type="button" class="btn small" data-act="measure-add">Add</button></div>
    ${Object.keys(latestMeasures).length ? Object.values(latestMeasures).map((m) => `
      <button type="button" class="row" data-act="measure-history" data-type="${esc(m.type)}"><span class="row-main"><span class="row-title">${esc(measureLabel(m.type))}</span><span class="row-sub">${esc(prettyDate(m.d))}</span></span><span class="row-kcal">${m.type === 'height' ? heightStr(m.cm) : lengthStr(m.cm)}</span></button>`).join('') : '<p class="empty">Track height, waist, chest, arms and more.</p>'}
  </section>

  <section class="card">
    <div class="card-head"><h2>Nutrients</h2><span class="muted">avg on logged days</span></div>
    ${MICROS.map((nn) => microRow(nn, avg(nn.key), mt[nn.key])).join('')}
  </section>

  <section class="card">
    <div class="stats">
      <div><b>${fmt(waterAvg, 1)}</b><span>cups water / day</span></div>
      <div><b>${fmt(exTotal)}</b><span>exercise kcal</span></div>
      <div><b>${fmt(days.reduce((a, d) => a + dayExercise(d).reduce((b, e) => b + e.min, 0), 0))}</b><span>active minutes</span></div>
    </div>
  </section>
  <div class="spacer"></div>`;
}

// ----- Smarter goals -----

// Foods you already eat that fit in what's left today, best protein value first when protein is short.
function ideasCard(kcalLeft, proteinLeft) {
  if (kcalLeft < 120) return '';
  const seen = new Set();
  const cands = [];
  const consider = (f) => {
    if (!f || seen.has(f.id)) return;
    seen.add(f.id);
    const a = defaultAmount(f);
    const g = a.qty * findUnit(f, a.unit).g;
    const n = scale(f.n, g);
    if (n.kcal < 40 || n.kcal > kcalLeft + 60) return;
    cands.push({ f, a, n });
  };
  S.favorites.forEach((id) => consider(getFood(id)));
  Object.values(S.foods).filter((f) => f.source === 'recipe').forEach(consider);
  S.recents.slice(0, 40).forEach((r) => consider(getFood(r.id)));
  if (!cands.length) return '';
  const wantProtein = proteinLeft > 15;
  cands.sort((x, y) => wantProtein
    ? y.n.p / y.n.kcal - x.n.p / x.n.kcal
    : Math.abs(kcalLeft / 2 - x.n.kcal) - Math.abs(kcalLeft / 2 - y.n.kcal));
  const top = cands.slice(0, 3);
  return `<section class="card ideas">
    <div class="card-head"><h2>Ideas for what's left</h2><span class="muted">${fmt(kcalLeft)} kcal${wantProtein ? ` · ${fmt(proteinLeft)} g protein` : ''}</span></div>
    ${top.map(({ f, a, n }) => `<div class="row-wrap">
      <button type="button" class="row" data-act="fav-open" data-id="${esc(f.id)}"><span class="row-main"><span class="row-title">${esc(f.name)}</span><span class="row-sub">${esc(amountText(a.qty, a.unit))} · ${fmt(n.p)} g protein</span></span><span class="row-kcal">${fmt(n.kcal)}</span></button>
      <button type="button" class="quick" data-act="idea-add" data-id="${esc(f.id)}" aria-label="Add ${esc(f.name)}">${ICON.plus}</button></div>`).join('')}
    <p class="hint">From your favorites, recipes and recent foods.</p>
  </section>`;
}

function weeklyCard() {
  const w = computeSummary(S);
  if (!w.week.daysLogged) return '';
  const t = targets(S);
  const change = w.week.weightChangeKg;
  return `<section class="card">
    <div class="card-head"><h2>Last 7 days</h2><span class="muted">${w.week.daysLogged} of 7 logged</span></div>
    <div class="stats">
      <div><b>${fmt(w.week.avgKcal)}</b><span>avg kcal (${fmt((w.week.avgKcal / t.kcal) * 100)}% of goal)</span></div>
      <div><b>${w.week.kcalDays}/${w.week.daysLogged}</b><span>days on target</span></div>
      <div><b>${w.week.proteinDays}/${w.week.daysLogged}</b><span>protein goal hit</span></div>
    </div>
    ${change != null ? `<p class="hint">Weight ${change >= 0 ? 'up' : 'down'} ${weightStr(Math.abs(change))} from a week ago.</p>` : ''}
  </section>`;
}

// Real maintenance calories from what was eaten and how weight actually moved:
// maintenance ≈ average intake − (weight change × 7,700 kcal/kg) ÷ days.
function adaptiveEstimate() {
  const end = todayStr();
  const start = addDays(end, -27);
  const days = Array.from({ length: 28 }, (_, i) => addDays(start, i)).filter((d) => d < end && dayEntries(d).length);
  const w = S.weights.filter((x) => x.d >= start);
  const need = { days: 14, weighs: 2 };
  if (days.length < need.days || w.length < 2) return { ready: false, days: days.length, weighs: w.length, need };
  const first = w[0];
  const last = w[w.length - 1];
  const span = (parseDate(last.d) - parseDate(first.d)) / 86400000;
  if (span < 14) return { ready: false, days: days.length, weighs: w.length, need, span };
  // Smooth each end with nearby weigh-ins so one heavy morning doesn't swing it.
  const near = (d) => {
    const pts = w.filter((x) => Math.abs((parseDate(x.d) - parseDate(d)) / 86400000) <= 4);
    return pts.reduce((a, x) => a + x.kg, 0) / pts.length;
  };
  const dKg = near(last.d) - near(first.d);
  const intake = days.reduce((a, d) => a + dayTotals(d).kcal, 0) / days.length;
  const maintenance = intake - (dKg * 7700) / span;
  const factor = GOALS.find((x) => x.key === S.profile.goal)?.factor ?? 1;
  return { ready: true, intake, dKg, span, maintenance, suggested: Math.round((maintenance * factor) / 10) * 10, days: days.length };
}

function adaptiveCard() {
  const a = adaptiveEstimate();
  if (!a.ready) {
    return `<section class="card">
      <div class="card-head"><h2>Smart calorie target</h2><span class="muted">learning</span></div>
      <p class="hint">After about two weeks of logging plus two weigh-ins at least 14 days apart, Plateful works out the calories your body actually uses and suggests a target. So far: ${a.days}/14 days logged, ${a.weighs} weigh-in${a.weighs === 1 ? '' : 's'}.</p>
    </section>`;
  }
  const t = targets(S);
  const diff = a.suggested - t.kcal;
  return `<section class="card">
    <div class="card-head"><h2>Smart calorie target</h2></div>
    <p>Over the last ${Math.round(a.span)} days you averaged <b>${fmt(a.intake)}</b> kcal and your weight went ${a.dKg >= 0 ? 'up' : 'down'} ${weightStr(Math.abs(a.dKg))}. That puts your real maintenance at about <b>${fmt(a.maintenance)}</b> kcal.</p>
    ${Math.abs(diff) >= 50
      ? `<button type="button" class="btn primary block" data-act="adaptive-apply" data-v="${a.suggested}">Use ${fmt(a.suggested)} kcal as my target</button>
         <p class="hint">Your current target is ${fmt(t.kcal)}. If you're still growing, some weight gain is normal. Days you forgot to log make this estimate too low.</p>`
      : `<p class="hint">That matches your current target (${fmt(t.kcal)} kcal), so nothing to change.</p>`}
  </section>`;
}

const MEASURES = [['height', 'Height'], ['waist', 'Waist'], ['chest', 'Chest'], ['hips', 'Hips'], ['arm', 'Upper arm'], ['thigh', 'Thigh'], ['neck', 'Neck']];
const measureLabel = (k) => MEASURES.find((m) => m[0] === k)?.[1] || k;

function microRow(nn, value, target) {
  const amt = target?.amt;
  const pct = amt ? Math.min(100, (value / amt) * 100) : 0;
  const bad = target?.limit && value > amt;
  return `<div class="micro">
    <div class="micro-top"><span>${nn.label}</span><span><b>${fmt(value, nn.dp)}</b>${amt ? ` / ${fmt(amt)}` : ''} ${nn.unit}${target?.limit ? ' <small>limit</small>' : ''}${target?.custom ? ' <small>your goal</small>' : ''}</span></div>
    ${amt ? `<div class="bar thin ${bad ? 'bad' : ''} ${target?.limit ? 'limit' : ''}"><i style="width:${pct}%"></i></div>` : ''}
  </div>`;
}

// ----- Foods tab -----

function foodsView() {
  const tab = ui.foodsTab;
  const foods = Object.values(S.foods);
  let list = '';
  if (tab === 'foods') {
    const mine = foods.filter((f) => f.source === 'custom').sort((a, b) => a.name.localeCompare(b.name));
    list = `<button type="button" class="btn primary block" data-act="custom-new">New food</button>
      ${mine.length ? mine.map((f) => foodRow(f, 'custom-edit')).join('') : '<p class="empty">Foods you create show up here: a homemade dish, or a product whose label you type in.</p>'}`;
  } else if (tab === 'recipes') {
    const rs = foods.filter((f) => f.source === 'recipe').sort((a, b) => a.name.localeCompare(b.name));
    list = `<button type="button" class="btn primary block" data-act="recipe-new">New recipe</button>
      ${rs.length ? rs.map((f) => foodRow(f, 'recipe-edit')).join('') : '<p class="empty">Combine ingredients, like your usual shake, into one entry you can log in a tap.</p>'}`;
  } else if (tab === 'meals') {
    list = `<button type="button" class="btn primary block" data-act="meal-new">New saved meal</button>
      ${S.meals.length ? S.meals.map((m) => {
        const kcal = mealItemsTotals(m.items).kcal;
        return `<button type="button" class="row" data-act="meal-edit" data-id="${m.id}"><span class="row-main"><span class="row-title">${esc(m.name)}</span><span class="row-sub">${m.items.length} items</span></span><span class="row-kcal">${fmt(kcal)}</span></button>`;
      }).join('') : '<p class="empty">Save a whole meal (say, the usual school lunch) and log it again with one tap. You can also save one from the ⋯ menu on any meal in the diary.</p>'}`;
  } else {
    const favs = S.favorites.map(getFood).filter(Boolean);
    list = favs.length ? favs.map((f) => foodRow(f, 'fav-open')).join('') : '<p class="empty">Tap the star on any food to keep it here.</p>';
  }
  return `
  <header class="topbar"><h1>My Foods</h1></header>
  <div class="seg" role="tablist">
    ${[['foods', 'Foods'], ['recipes', 'Recipes'], ['meals', 'Meals'], ['favs', 'Favorites']].map(([v, l]) => `<button type="button" role="tab" aria-selected="${tab === v}" data-act="foods-tab" data-v="${v}">${l}</button>`).join('')}
  </div>
  <section class="card list">${list}</section>
  <div class="spacer"></div>`;
}

function foodRow(f, act, extra = '') {
  const u = defaultAmount(f);
  const unit = findUnit(f, u.unit);
  const kcal = (f.n.kcal * unit.g * u.qty) / 100;
  return `<div class="row-wrap">
    <button type="button" class="row" data-act="${act}" data-id="${esc(f.id)}">
      <span class="row-main">
        <span class="row-title">${esc(f.name)}</span>
        <span class="row-sub">${badge(f.source)}${f.brand ? esc(f.brand) + ' · ' : ''}${esc(amountText(u.qty, u.unit))}</span>
      </span>
      <span class="row-kcal">${fmt(kcal)}</span>
    </button>${extra}</div>`;
}

function mealItemsTotals(items) {
  return sumNutrients(items.map((it) => {
    const f = getFood(it.foodId);
    return f ? scale(f.n, it.qty * findUnit(f, it.unit).g) : null;
  }));
}

// ----- Settings -----

function settingsView() {
  const p = S.profile;
  const t = targets(S);
  const age = ageYears(p.birth);
  const g = S.goals;
  return `
  <header class="topbar"><h1>Profile</h1></header>
  ${installCard()}
  <section class="card">
    <div class="card-head"><h2>${esc(p.name || 'Profile')}</h2><button type="button" class="btn small" data-act="profile">Edit</button></div>
    <dl class="kv">
      <div><dt>Age</dt><dd>${age ?? '–'}</dd></div>
      <div><dt>Sex</dt><dd>${p.sex === 'f' ? 'Female' : 'Male'}</dd></div>
      <div><dt>Height</dt><dd>${heightStr(latestHeight(S))}</dd></div>
      <div><dt>Weight</dt><dd>${weightStr(latestWeight(S))}</dd></div>
      <div><dt>Activity</dt><dd>${ACTIVITY.find((a) => a.key === p.activity)?.label}</dd></div>
      <div><dt>Goal</dt><dd>${GOALS.find((x) => x.key === p.goal)?.label}</dd></div>
    </dl>
  </section>
  <section class="card">
    <div class="card-head"><h2>Daily targets</h2><button type="button" class="btn small" data-act="targets">Edit</button></div>
    <dl class="kv">
      <div><dt>Calories</dt><dd>${fmt(t.kcal)} kcal <small class="muted">${t.source === 'manual' ? 'set by you' : t.source === 'calculated' ? 'calculated' : 'default; add profile details'}</small></dd></div>
      ${t.estimate && t.source === 'manual' ? `<div><dt>Calculated</dt><dd>${fmt(t.estimate)} kcal</dd></div>` : ''}
      <div><dt>Protein</dt><dd>${fmt(t.p)} g</dd></div>
      <div><dt>Carbs</dt><dd>${fmt(t.c)} g</dd></div>
      <div><dt>Fat</dt><dd>${fmt(t.f)} g</dd></div>
      <div><dt>Water</dt><dd>${waterGoalCups(S)} cups</dd></div>
      <div><dt>Nutrient goals</dt><dd>${(() => { const n = Object.keys(g.micros || {}).length; return n ? `${n} set by you` : 'recommended amounts'; })()}</dd></div>
      <div><dt>Exercise calories</dt><dd>${g.addExercise ? 'added to budget' : 'not added'}</dd></div>
    </dl>
    <p class="hint">Calories come from the National Academies' Estimated Energy Requirement equations, which for kids and teens include the extra energy needed to grow. If you're under 18, check with your doctor before aiming to lose weight.</p>
  </section>
  <section class="card">
    <div class="card-head"><h2>Notifications</h2><button type="button" class="btn small" data-act="notifications">${S.settings.push?.on ? 'Edit' : 'Set up'}</button></div>
    <p class="hint">${S.settings.push?.on ? notifySummary() : 'Get a nudge when a meal hasn\'t been logged or a goal is still open in the evening.'}</p>
  </section>
  <section class="card">
    <h2>Data</h2>
    <button type="button" class="row" data-act="export-csv"><span class="row-main"><span class="row-title">Export food diary (CSV)</span><span class="row-sub">Every entry with calories, macros and nutrients</span></span></button>
    <button type="button" class="row" data-act="export-weights"><span class="row-main"><span class="row-title">Export weight and measurements (CSV)</span></span></button>
    <button type="button" class="row" data-act="backup"><span class="row-main"><span class="row-title">Back up everything</span><span class="row-sub">A file you can restore on another phone</span></span></button>
    <label class="row"><span class="row-main"><span class="row-title">Restore from backup</span></span><input type="file" accept=".json,application/json" data-act-change="restore" hidden></label>
    <button type="button" class="row" data-act="usda-key"><span class="row-main"><span class="row-title">USDA API key</span><span class="row-sub">${S.settings.usdaKey ? 'Set: branded USDA foods are on' : 'Optional: adds 400,000+ branded foods'}</span></span></button>
    <button type="button" class="row danger" data-act="wipe"><span class="row-main"><span class="row-title">Delete all data</span></span></button>
  </section>
  <section class="card">
    <h2>Privacy</h2>
    <p class="hint">Your food diary, weight, measurements and profile stay on this phone. There is no account, and nothing is sold or shared.</p>
    <p class="hint">Two things go online. When you search for a food or scan a barcode, the search words or barcode number go to Open Food Facts (and to USDA if you added a key). If you turn on notifications, Plateful's server stores this phone's notification address, time zone, reminder times, and yes/no flags such as “lunch logged today” so it can skip reminders you don't need. It never receives what you ate, your weight or your name. Turning notifications off deletes that record.</p>
    <p class="hint">Delete all data above erases everything on this phone and turns notifications off.</p>
  </section>
  <section class="card">
    <h2>About the food data</h2>
    <p class="hint"><span class="badge ok">USDA</span> About 5,400 foods from USDA's FNDDS database, built into the app, so search works offline. <span class="badge ok">USDA brand</span> Manufacturer label data (needs a key). <span class="badge warn">Community</span> Open Food Facts, a crowd-sourced database: it covers the most barcodes, but check entries against the package label.</p>
  </section>
  <section class="card">
    <h2>Credits</h2>
    <p class="hint">Food data from <a href="https://fdc.nal.usda.gov/" target="_blank" rel="noopener">USDA FoodData Central</a> (public domain) and <a href="https://world.openfoodfacts.org/" target="_blank" rel="noopener">Open Food Facts</a> (Open Database License). Barcode scanning by <a href="https://github.com/zxing-cpp/zxing-cpp" target="_blank" rel="noopener">zxing-cpp</a> (Apache License 2.0) via <a href="https://github.com/Sec-ant/zxing-wasm" target="_blank" rel="noopener">zxing-wasm</a> (MIT). Calorie targets use the National Academies' Dietary Reference Intakes.</p>
    <p class="hint">Plateful gives estimates for general tracking. It isn't medical advice; talk to a doctor or dietitian about weight or eating concerns.</p>
  </section>
  <div class="spacer"></div>`;
}

function installCard() {
  if (isStandalone()) return '';
  const why = 'Plateful then opens full screen, works offline, can send reminders, and your phone keeps its data safe from automatic cleanup.';
  if (canPromptInstall()) {
    return `<section class="card notice"><b>Install Plateful</b><p>${why}</p><button type="button" class="btn primary block" data-act="install">Install app</button></section>`;
  }
  if (isIOS) return `<section class="card notice"><b>Install on your iPhone</b><p>In Safari, tap the Share button, then <b>Add to Home Screen</b>. ${why}</p></section>`;
  if (isAndroid) return `<section class="card notice"><b>Install on your phone</b><p>In Chrome, tap the <b>⋮</b> menu, then <b>Install app</b> (or <b>Add to Home screen</b>). ${why}</p></section>`;
  return '';
}

// ---------- event binding for the main view ----------

const actions = {
  'day-prev': () => changeDay(-1),
  'day-next': () => changeDay(1),
  'day-menu': () => dayMenu(),
  'add-food': (el) => openAddFood({ date: ui.date, meal: el.dataset.meal }),
  entry: (el) => {
    const e = dayEntries(ui.date).find((x) => x.id === el.dataset.id);
    if (e) openEntryEditor(ui.date, e);
  },
  'meal-menu': (el) => mealMenu(ui.date, el.dataset.meal),
  nutrients: () => openNutrients(ui.date),
  water: (el) => {
    const v = Math.max(0, (S.water[ui.date] || 0) + Number(el.dataset.ml));
    S.water[ui.date] = Math.round(v * 10) / 10;
    commit();
  },
  'water-custom': () => formSheet({
    title: 'Add water',
    fields: [{ name: 'amt', label: `Amount (${isUS() ? 'fl oz' : 'ml'})`, type: 'number', autofocus: true }],
    submit: 'Add',
    onSubmit: ({ amt }) => {
      const v = num(amt);
      if (!v) return false;
      S.water[ui.date] = (S.water[ui.date] || 0) + (isUS() ? v * 29.5735 : v);
      commit();
    },
  }),
  caffeine: (el) => {
    S.caffeine[ui.date] = (S.caffeine[ui.date] || 0) + Number(el.dataset.mg);
    commit();
    toast(`Added ${el.dataset.mg} mg caffeine`, { undo: () => { S.caffeine[ui.date] -= Number(el.dataset.mg); commit(); } });
  },
  'caffeine-custom': () => formSheet({
    title: 'Add caffeine',
    fields: [{ name: 'mg', label: 'Caffeine (mg)', type: 'number', autofocus: true, hint: 'Check the can or bottle; caffeine is often listed in mg.' }],
    submit: 'Add',
    onSubmit: ({ mg }) => {
      const v = num(mg);
      if (!v) return false;
      S.caffeine[ui.date] = (S.caffeine[ui.date] || 0) + v;
      commit();
    },
  }),
  'caffeine-reset': () => { delete S.caffeine[ui.date]; commit(); },
  'exercise-add': () => openExercise(ui.date),
  'exercise-edit': (el) => openExercise(ui.date, dayExercise(ui.date).find((e) => e.id === el.dataset.id)),
  range: (el) => { ui.range = Number(el.dataset.v); renderMain(); },
  'weight-add': () => openWeight(),
  'weight-edit': (el) => openWeight(S.weights.find((w) => w.d === el.dataset.d)),
  'measure-add': () => openMeasure(),
  'measure-history': (el) => openMeasureHistory(el.dataset.type),
  'foods-tab': (el) => { ui.foodsTab = el.dataset.v; renderMain(); },
  'custom-new': () => openCustomFood(),
  'custom-edit': (el) => openCustomFood(S.foods[el.dataset.id]),
  'recipe-new': () => openRecipe(),
  'recipe-edit': (el) => openRecipe(S.foods[el.dataset.id]),
  'meal-new': () => openSavedMeal({ id: uid(), name: '', items: [] }, true),
  'meal-edit': (el) => openSavedMeal(S.meals.find((m) => m.id === el.dataset.id)),
  'idea-add': (el) => {
    const f = getFood(el.dataset.id);
    if (!f) return;
    const a = defaultAmount(f);
    logFood(ui.date, f, a.qty, a.unit, defaultMealForNow());
  },
  'adaptive-apply': (el) => {
    const before = S.goals.kcalOverride;
    S.goals.kcalOverride = Number(el.dataset.v);
    commit();
    toast(`Target set to ${fmt(S.goals.kcalOverride)} kcal`, { undo: () => { S.goals.kcalOverride = before; commit(); } });
  },
  'fav-open': (el) => {
    const f = getFood(el.dataset.id);
    if (f) openFoodDetail(f, { date: ui.date, meal: defaultMealForNow() });
  },
  profile: () => openProfile(),
  install: async () => {
    if ((await promptInstall()) === 'accepted') toast('Installed. Open Plateful from your home screen.');
    renderMain();
  },
  notifications: () => openNotifications(),
  targets: () => openTargets(),
  'export-csv': () => exportDiaryCsv(),
  'export-weights': () => exportWeightsCsv(),
  backup: () => shareFile(`plateful-backup-${todayStr()}.json`, JSON.stringify(S), 'application/json'),
  'usda-key': () => formSheet({
    title: 'USDA API key',
    fields: [{ name: 'key', label: 'API key', value: S.settings.usdaKey, placeholder: 'Paste key', hint: 'Free from api.data.gov/signup: enter a name and email and the key arrives right away. With it, search and barcode lookups also check USDA\'s Branded Foods database.' }],
    onSubmit: ({ key }) => { S.settings.usdaKey = key.trim(); commit(); },
  }),
  wipe: async () => {
    if (!confirm('Delete every entry, food, weigh-in and setting? This cannot be undone.')) return;
    if (S.settings.push?.endpoint) await disablePush(S);
    await store.wipe();
    S = store.defaultState();
    renderAll();
    toast('All data deleted');
    openProfile(true);
  },
};

const changeActions = {
  'day-set': (el) => { if (el.value) { ui.date = el.value; renderMain(); } },
  restore: async (el) => {
    const file = el.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || !data.diary) throw new Error('not a Plateful backup');
      if (!confirm('Replace everything on this phone with this backup?')) return;
      // Notification sign-ups belong to a phone, not to the data, so keep this phone's.
      const push = S.settings.push;
      S = store.migrate(data);
      S.settings.push = push;
      commit();
      toast('Backup restored');
    } catch (e) {
      alert(`Could not restore: ${e.message}`);
    } finally {
      el.value = '';
    }
  },
};

function bindMain(root) {
  root.onclick = (ev) => {
    const el = ev.target.closest('[data-act]');
    if (el && root.contains(el)) actions[el.dataset.act]?.(el, ev);
  };
  root.onchange = (ev) => {
    const el = ev.target.closest('[data-act-change]');
    if (el) changeActions[el.dataset.actChange]?.(el, ev);
  };
}

// ---------- menus (action sheets) ----------

function actionSheet(title, items) {
  const s = openSheet({
    title,
    closeLabel: 'Cancel',
    html: () => `<div class="actions">${items.map((it, i) => `<button type="button" class="action ${it.danger ? 'danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('')}</div>`,
    bind: (el) => $$('.action', el).forEach((b) => (b.onclick = () => { closeSheet(s); items[b.dataset.i].run(); })),
  });
  s.el.classList.add('compact');
}

function mealMenu(date, meal) {
  const entries = dayEntries(date).filter((e) => e.meal === meal);
  const yday = addDays(date, -1);
  const yEntries = dayEntries(yday).filter((e) => e.meal === meal);
  const items = [];
  if (yEntries.length) items.push({ label: `Copy ${mealLabel(meal).toLowerCase()} from yesterday`, run: () => copyEntries(yEntries, date, meal) });
  if (entries.length) {
    items.push({ label: 'Copy to another day…', run: () => copyMealTo(date, meal) });
    items.push({ label: 'Save as a meal', run: () => saveAsMeal(entries, mealLabel(meal)) });
    items.push({ label: `Clear ${mealLabel(meal).toLowerCase()}`, danger: true, run: () => {
      const before = S.diary[date];
      S.diary[date] = before.filter((e) => e.meal !== meal);
      commit();
      toast(`Cleared ${mealLabel(meal)}`, { undo: () => { S.diary[date] = before; commit(); } });
    } });
  }
  items.push({ label: 'Copy from another day…', run: () => copyMealFrom(date, meal) });
  actionSheet(mealLabel(meal), items);
}

function copyEntries(entries, date, meal) {
  const copies = entries.map((e) => ({ ...e, id: uid(), meal: meal || e.meal }));
  (S.diary[date] ||= []).push(...copies);
  commit();
  const ids = new Set(copies.map((c) => c.id));
  toast(`Copied ${copies.length} item${copies.length === 1 ? '' : 's'}`, { undo: () => { S.diary[date] = dayEntries(date).filter((e) => !ids.has(e.id)); commit(); } });
}

function copyMealTo(date, meal) {
  formSheet({
    title: 'Copy to',
    fields: [
      { name: 'd', label: 'Date', type: 'date', value: addDays(date, 1) },
      { name: 'm', label: 'Meal', type: 'select', value: meal, options: MEALS.map((m) => [m.key, m.label]) },
    ],
    submit: 'Copy',
    onSubmit: ({ d, m }) => {
      if (!d) return false;
      copyEntries(dayEntries(date).filter((e) => e.meal === meal), d, m);
    },
  });
}

function copyMealFrom(date, meal) {
  formSheet({
    title: `Copy into ${mealLabel(meal)}`,
    fields: [
      { name: 'd', label: 'From date', type: 'date', value: addDays(date, -1) },
      { name: 'm', label: 'From meal', type: 'select', value: meal, options: MEALS.map((m) => [m.key, m.label]) },
    ],
    submit: 'Copy',
    onSubmit: ({ d, m }) => {
      const src = dayEntries(d).filter((e) => e.meal === m);
      if (!src.length) { alert(`Nothing logged for ${mealLabel(m)} on that day.`); return false; }
      copyEntries(src, date, meal);
    },
  });
}

function dayMenu() {
  const d = ui.date;
  const items = [
    { label: 'Copy whole day from yesterday', run: () => {
      const src = dayEntries(addDays(d, -1));
      if (!src.length) return toast('Nothing logged yesterday');
      copyEntries(src, d);
    } },
    { label: 'Copy whole day from…', run: () => formSheet({
      title: 'Copy day',
      fields: [{ name: 'from', label: 'Copy everything from', type: 'date', value: addDays(d, -1) }],
      submit: 'Copy',
      onSubmit: ({ from }) => {
        const src = dayEntries(from);
        if (!src.length) { alert('Nothing logged on that day.'); return false; }
        copyEntries(src, d);
      },
    }) },
    { label: 'Go to today', run: () => { ui.date = todayStr(); renderMain(); } },
  ];
  if (dayEntries(d).length) items.push({ label: 'Clear this day', danger: true, run: () => {
    const before = S.diary[d];
    delete S.diary[d];
    commit();
    toast('Day cleared', { undo: () => { S.diary[d] = before; commit(); } });
  } });
  actionSheet(prettyDate(d), items);
}

function saveAsMeal(entries, suggested) {
  formSheet({
    title: 'Save meal',
    fields: [{ name: 'name', label: 'Name', value: suggested, autofocus: true, placeholder: 'e.g. School lunch' }],
    onSubmit: ({ name }) => {
      if (!name.trim()) return false;
      S.meals.push({ id: uid(), name: name.trim(), items: entries.map((e) => ({ foodId: e.foodId, qty: e.qty, unit: e.unit })) });
      commit();
      toast(`Saved “${name.trim()}”`);
    },
  });
}

// ---------- Add food ----------

// opts: { date, meal } to log, or { onPick(food, qty, unit), pickLabel } to choose an ingredient
function openAddFood(opts) {
  const st = { q: opts.q || '', tab: 'recent', online: [], onlineState: 'idle', local: [], token: 0 };
  let timer;
  const picking = !!opts.onPick;

  const resultsHtml = () => {
    if (!st.q.trim()) return browseHtml();
    const mine = searchFoods(Object.values(S.foods), st.q, 12);
    const mineIds = new Set(mine.map((f) => f.id));
    const local = st.local.filter((f) => !mineIds.has(f.id));
    const online = st.online.filter((f) => !mineIds.has(f.id));
    let onlineHtml = '';
    if (st.onlineState === 'loading') onlineHtml = '<p class="empty"><span class="spinner"></span> Searching brands…</p>';
    else if (st.onlineState === 'offline') onlineHtml = '<p class="empty">Offline. Brand search needs a connection; the USDA foods above work anywhere.</p>';
    else if (st.onlineState === 'error') onlineHtml = '<p class="empty">Brand search is unavailable right now. Try again in a minute.</p>';
    else if (st.onlineState === 'done' && !online.length) onlineHtml = '<p class="empty">No branded matches.</p>';
    else onlineHtml = online.map((f) => foodRow(f, 'pick')).join('');
    return `
      ${mine.length ? `<h4 class="list-h">Your foods</h4>${mine.map((f) => foodRow(f, 'pick', quickAddBtn(f))).join('')}` : ''}
      <h4 class="list-h">Common foods <small>USDA, works offline</small></h4>
      ${local.length ? local.map((f) => foodRow(f, 'pick')).join('') : '<p class="empty">No matches.</p>'}
      ${st.q.trim().length >= 2 ? `<h4 class="list-h">Brands &amp; restaurants <small>online</small></h4>${onlineHtml}` : ''}
      <div class="list-foot">
        <button type="button" class="btn block" data-act="new-custom">Can't find it? Create a food</button>
      </div>`;
  };

  const quickAddBtn = (f) => (picking ? '' : `<button type="button" class="quick" data-act="quick" data-id="${esc(f.id)}" aria-label="Add ${esc(f.name)} with the last amount">${ICON.plus}</button>`);

  const browseHtml = () => {
    let body = '';
    if (st.tab === 'recent') {
      const rec = S.recents.map((r) => getFood(r.id)).filter(Boolean).slice(0, 40);
      body = rec.length ? rec.map((f) => foodRow(f, 'pick', quickAddBtn(f))).join('') : '<p class="empty">Foods you log show up here. Tap ＋ to log one again with the same amount.</p>';
    } else if (st.tab === 'favs') {
      const favs = S.favorites.map(getFood).filter(Boolean);
      body = favs.length ? favs.map((f) => foodRow(f, 'pick', quickAddBtn(f))).join('') : '<p class="empty">Star a food to keep it here.</p>';
    } else if (st.tab === 'mine') {
      const mine = Object.values(S.foods).filter((f) => f.source === 'custom' || f.source === 'recipe').sort((a, b) => a.name.localeCompare(b.name));
      body = `<div class="row-btns"><button type="button" class="btn small" data-act="new-custom">New food</button><button type="button" class="btn small" data-act="new-recipe">New recipe</button></div>` +
        (mine.length ? mine.map((f) => foodRow(f, 'pick', quickAddBtn(f))).join('') : '<p class="empty">No custom foods or recipes yet.</p>');
    } else if (st.tab === 'meals') {
      body = S.meals.length ? S.meals.map((m) => `
        <div class="row-wrap"><button type="button" class="row" data-act="log-meal" data-id="${m.id}"><span class="row-main"><span class="row-title">${esc(m.name)}</span><span class="row-sub">${esc(m.items.map((it) => getFood(it.foodId)?.name).filter(Boolean).join(', '))}</span></span><span class="row-kcal">${fmt(mealItemsTotals(m.items).kcal)}</span></button></div>`).join('')
        : '<p class="empty">No saved meals yet. Use the ⋯ menu on a meal in the diary to save one.</p>';
    }
    const tabs = [['recent', 'Recent'], ['favs', 'Favorites'], ['mine', 'My foods']];
    if (!picking) tabs.push(['meals', 'Meals']);
    return `<div class="seg small" role="tablist">${tabs.map(([v, l]) => `<button type="button" role="tab" aria-selected="${st.tab === v}" data-act="tab" data-v="${v}">${l}</button>`).join('')}</div>
      ${!picking ? `<button type="button" class="row quickcal describe-row" data-act="describe"><span class="row-main"><span class="row-title">Describe what you ate</span><span class="row-sub">Type or dictate: “2 eggs, toast and a glass of milk”</span></span></button>` : ''}
      ${!picking ? `<button type="button" class="row quickcal" data-act="quick-cal"><span class="row-main"><span class="row-title">Quick add calories</span><span class="row-sub">When you only know the number</span></span></button>` : ''}
      ${body}`;
  };

  const runSearch = async () => {
    const q = st.q.trim();
    const token = ++st.token;
    st.local = q ? await searchLocal(q, 30) : [];
    if (token !== st.token) return;
    st.online = [];
    st.onlineState = q.length >= 2 ? (navigator.onLine ? 'loading' : 'offline') : 'idle';
    paint();
    if (st.onlineState !== 'loading') return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const jobs = [searchOff(q)];
        if (S.settings.usdaKey) jobs.push(searchUsdaBranded(q, S.settings.usdaKey).catch(() => []));
        const res = await Promise.all(jobs);
        if (token !== st.token) return;
        st.online = res.reverse().flat(); // USDA branded (verified) first
        st.onlineState = 'done';
      } catch {
        if (token !== st.token) return;
        st.onlineState = 'error';
      }
      paint();
    }, 600);
  };

  const all = () => [...Object.values(S.foods), ...st.local, ...st.online];
  const findFood = (id) => all().find((f) => f.id === id) || getFood(id);

  let sheet;
  const paint = () => {
    const box = $('.results', sheet.el);
    if (box) box.innerHTML = resultsHtml();
  };

  const afterPick = () => {
    if (picking) closeSheet(sheet);
  };

  sheet = openSheet({
    title: picking ? opts.pickTitle || 'Add ingredient' : mealLabel(opts.meal),
    live: false,
    html: () => `
      <div class="searchbar">
        <span class="search-field">${ICON.search}<input type="search" placeholder="Search foods" value="${esc(st.q)}" aria-label="Search foods" enterkeyhint="search" autocomplete="off" autocorrect="off"></span>
        <button type="button" class="icon-btn scan" data-act="scan" aria-label="Scan a barcode">${ICON.scan}</button>
      </div>
      <div class="results">${resultsHtml()}</div>`,
    bind: (el) => {
      const input = $('input[type=search]', el);
      input.oninput = () => { st.q = input.value; runSearch(); };
      el.onclick = (ev) => {
        const a = ev.target.closest('[data-act]');
        if (!a) return;
        const act = a.dataset.act;
        if (act === 'tab') { st.tab = a.dataset.v; paint(); }
        else if (act === 'pick') {
          const f = findFood(a.dataset.id);
          if (f) openFoodDetail(f, { ...opts, onDone: afterPick });
        } else if (act === 'quick') {
          const f = findFood(a.dataset.id);
          if (!f) return;
          const amt = defaultAmount(f);
          logFood(opts.date, f, amt.qty, amt.unit, opts.meal);
          paint();
        } else if (act === 'scan') openScanner(opts, afterPick);
        else if (act === 'new-custom') openCustomFood(null, { prefillName: st.q.trim(), onSaved: (f) => openFoodDetail(f, { ...opts, onDone: afterPick }) });
        else if (act === 'new-recipe') openRecipe(null, { onSaved: (f) => openFoodDetail(f, { ...opts, onDone: afterPick }) });
        else if (act === 'log-meal') {
          const m = S.meals.find((x) => x.id === a.dataset.id);
          if (m) logSavedMeal(m, opts.date, opts.meal);
          closeSheet(sheet);
        } else if (act === 'quick-cal') openQuickCalories(opts.date, opts.meal, () => closeSheet(sheet));
        else if (act === 'describe') openDescribe({ date: opts.date, meal: opts.meal, text: st.q, onDone: () => closeSheet(sheet) });
      };
    },
  });
  sheet.refresh = paint;
  loadLocal();
  warmUpScanner();
  if (st.q) runSearch();
  return sheet;
}

function logSavedMeal(m, date, meal) {
  const added = [];
  for (const it of m.items) {
    const f = getFood(it.foodId);
    if (!f) continue;
    const e = makeEntry(f, it.qty, it.unit, meal);
    (S.diary[date] ||= []).push(e);
    added.push(e.id);
  }
  commit();
  const ids = new Set(added);
  toast(`Added “${m.name}” to ${mealLabel(meal)}`, { undo: () => { S.diary[date] = dayEntries(date).filter((e) => !ids.has(e.id)); commit(); } });
}

function openQuickCalories(date, meal, done) {
  formSheet({
    title: 'Quick add',
    fields: [
      { name: 'kcal', label: 'Calories', type: 'number', autofocus: true, unit: 'kcal' },
      { name: 'p', label: 'Protein (optional)', type: 'number', unit: 'g' },
      { name: 'c', label: 'Carbs (optional)', type: 'number', unit: 'g' },
      { name: 'f', label: 'Fat (optional)', type: 'number', unit: 'g' },
      { name: 'name', label: 'Description (optional)', placeholder: 'e.g. Birthday cake at a party' },
    ],
    submit: 'Add',
    onSubmit: (v) => {
      const kcal = num(v.kcal);
      if (!kcal) return false;
      const n = Object.fromEntries(NKEYS.map((k) => [k, 0]));
      Object.assign(n, { kcal, p: num(v.p) || 0, c: num(v.c) || 0, f: num(v.f) || 0 });
      (S.diary[date] ||= []).push({ id: uid(), meal, foodId: null, name: v.name.trim() || 'Quick add', brand: '', src: 'quick', qty: 1, unit: 'entry', g: 0, n });
      commit();
      done?.();
    },
  });
}

// ---------- Describe a meal in words ----------

async function findFoodFor(query) {
  const mine = Object.values(S.foods);
  for (const q of queryVariants(query)) {
    // A saved food wins only if it really is that food ("butter" shouldn't pick a PB&J sandwich).
    const hit = searchFoods(mine, q, 1)[0];
    if (hit && hit.name.toLowerCase().startsWith(q)) return hit;
    const local = (await searchLocal(q, 1))[0];
    if (local) return local;
  }
  if (navigator.onLine) {
    try {
      return (await searchOff(query))[0] || null;
    } catch {}
  }
  return null;
}

function openDescribe({ date, meal, text = '', onDone }) {
  const st = { text, items: [], busy: false, meal, parsed: false };
  const itemKcal = (it) => (it.food ? (it.food.n.kcal * it.qty * findUnit(it.food, it.unit).g) / 100 : 0);
  let sheet;
  const find = async () => {
    st.busy = true;
    sheet.render();
    const parsed = parseMeal(st.text);
    st.items = await Promise.all(parsed.map(async (p) => {
      const food = await findFoodFor(p.query);
      if (!food) return { ...p, food: null };
      const m = matchUnit(food, p.unit, p.qty, p.explicit);
      return { ...p, food, qty: m.qty, unit: m.unit, check: !m.exact };
    }));
    st.busy = false;
    st.parsed = true;
    sheet.render();
  };
  sheet = openSheet({
    title: 'Describe a meal',
    html: () => {
      const total = st.items.reduce((a, it) => a + itemKcal(it), 0);
      const ok = st.items.filter((it) => it.food);
      return `
        <div class="field">
          <label for="desc">What did you eat?</label>
          <textarea id="desc" rows="3" placeholder="2 eggs, a slice of toast with butter and a glass of milk">${esc(st.text)}</textarea>
          <p class="hint">Tap the microphone on the keyboard to say it instead. Separate foods with commas or “and”.</p>
        </div>
        <button type="button" class="btn ${st.parsed ? '' : 'primary'} block" data-find ${st.busy ? 'disabled' : ''}>${st.busy ? '<span class="spinner"></span> Finding foods…' : st.parsed ? 'Find again' : 'Find foods'}</button>
        ${st.items.length ? `<h4 class="list-h">Check these</h4>
          ${st.items.map((it, i) => `
            <div class="row-wrap">
              <button type="button" class="row" data-item="${i}">
                <span class="row-main">
                  <span class="row-sub">“${esc(it.raw)}”</span>
                  <span class="row-title">${it.food ? esc(it.food.name) : '<span class="warn-text">No match: tap to search</span>'}</span>
                  ${it.food ? `<span class="row-sub">${badge(it.food.source)}${esc(amountText(it.qty, it.unit))}${it.check ? ' · <span class="warn-text">check amount</span>' : ''}</span>` : ''}
                </span>
                <span class="row-kcal">${it.food ? fmt(itemKcal(it)) : ''}</span>
              </button>
              <button type="button" class="quick remove" data-rm="${i}" aria-label="Remove">${ICON.close}</button>
            </div>`).join('')}
          <p class="hint">Tap an item to fix the amount or pick a different food.</p>
          <div class="seg small meal-seg" role="radiogroup" aria-label="Meal">${MEALS.map((m) => `<button type="button" role="radio" aria-checked="${st.meal === m.key}" data-meal="${m.key}">${m.label}</button>`).join('')}</div>
          <button type="button" class="btn primary block" data-log ${ok.length ? '' : 'disabled'}>Add ${ok.length} item${ok.length === 1 ? '' : 's'} · ${fmt(total)} kcal</button>`
        : st.parsed ? '<p class="empty">Couldn\'t pick out any foods. Try “2 eggs and toast”.</p>' : ''}`;
    },
    bind: (el) => {
      const ta = $('#desc', el);
      ta.oninput = () => (st.text = ta.value);
      if (!st.text) setTimeout(() => ta.focus(), 300);
      $('[data-find]', el).onclick = () => { if (st.text.trim()) find(); };
      $$('[data-rm]', el).forEach((b) => (b.onclick = () => { st.items.splice(Number(b.dataset.rm), 1); sheet.render(); }));
      $$('[data-meal]', el).forEach((b) => (b.onclick = () => { st.meal = b.dataset.meal; sheet.render(); }));
      $$('[data-item]', el).forEach((b) => (b.onclick = () => {
        const i = Number(b.dataset.item);
        const it = st.items[i];
        const pick = (food, qty, unit) => { st.items[i] = { ...it, food, qty, unit, check: false }; sheet.render(); };
        if (!it.food) return openAddFood({ q: it.query, pickTitle: 'Pick food', pickLabel: 'Use this', onPick: pick });
        actionSheet(it.food.name, [
          { label: 'Change amount', run: () => openFoodDetail(it.food, { qty: it.qty, unit: it.unit, pickLabel: 'Update', onPick: pick }) },
          { label: 'Pick a different food', run: () => openAddFood({ q: it.query, pickTitle: 'Pick food', pickLabel: 'Use this', onPick: pick }) },
        ]);
      }));
      const log = $('[data-log]', el);
      if (log) log.onclick = () => {
        const added = [];
        for (const it of st.items) {
          if (!it.food) continue;
          rememberFood(it.food);
          const e = makeEntry(it.food, it.qty, it.unit, st.meal);
          (S.diary[date] ||= []).push(e);
          bumpRecent(it.food, it.qty, e.unit);
          added.push(e.id);
        }
        commit();
        const ids = new Set(added);
        toast(`Added ${added.length} item${added.length === 1 ? '' : 's'} to ${mealLabel(st.meal)}`, { undo: () => { S.diary[date] = dayEntries(date).filter((e) => !ids.has(e.id)); commit(); } });
        closeSheet(sheet);
        onDone?.();
      };
    },
  });
  if (st.text.trim()) find();
}

// ---------- Food detail / amount picker ----------

// opts: { date, meal, entry?, onPick?, onDone? }
function openFoodDetail(food, opts) {
  const editing = opts.entry;
  const st = editing ? { qty: editing.qty, unit: editing.unit, meal: editing.meal, date: opts.date } : { ...defaultAmount(food), meal: opts.meal, date: opts.date };
  if (opts.qty != null) Object.assign(st, { qty: opts.qty, unit: opts.unit });
  st.qtyText = fmtQtyInput(st.qty);
  const units = unitsFor(food);
  if (!units.some((u) => u.label === st.unit)) st.unit = units[0].label;

  const nowN = () => {
    const q = parseQty(st.qtyText);
    const g = (Number.isFinite(q) ? q : 0) * findUnit(food, st.unit).g;
    return { n: scale(food.n, g), g, q };
  };

  const nutritionHtml = () => {
    const { n, g } = nowN();
    const macroK = n.p * 4 + n.c * 4 + n.f * 9 || 1;
    return `
      <div class="big-kcal"><b>${fmt(n.kcal)}</b><span>kcal${!food.noGrams && g ? ` · ${fmt(g)} g` : ''}</span></div>
      <div class="macro-trio">
        <div class="m-p"><b>${fmt(n.p, 1)} g</b><span>Protein ${fmt((n.p * 400) / macroK)}%</span></div>
        <div class="m-c"><b>${fmt(n.c, 1)} g</b><span>Carbs ${fmt((n.c * 400) / macroK)}%</span></div>
        <div class="m-f"><b>${fmt(n.f, 1)} g</b><span>Fat ${fmt((n.f * 900) / macroK)}%</span></div>
      </div>
      <details class="micros"><summary>More nutrients</summary>
        ${NUTRIENTS.filter((x) => !['kcal', 'p', 'c', 'f'].includes(x.key)).map((x) => `<div class="kv-row"><span>${x.label}</span><span>${fmt(n[x.key], x.dp)} ${x.unit}</span></div>`).join('')}
      </details>`;
  };

  const isFav = () => S.favorites.includes(food.id);
  const editable = food.source === 'custom' || food.source === 'recipe';
  let sheet;
  sheet = openSheet({
    title: editing ? 'Edit entry' : opts.onPick ? 'Ingredient' : 'Add food',
    right: () => `<button type="button" class="icon-btn star ${isFav() ? 'on' : ''}" data-fav aria-pressed="${isFav()}" aria-label="Favorite">${ICON.star}</button>`,
    html: () => `
      <div class="food-head">
        <h2>${esc(food.name)}</h2>
        <p class="muted">${badge(food.source)}${esc(food.brand || '')}</p>
        ${food.source === 'off' ? '<p class="hint">Community entry. Compare it with the nutrition label before relying on it.</p>' : ''}
      </div>
      <div class="amount">
        <div class="field">
          <label for="qty">Amount</label>
          <input id="qty" type="text" inputmode="decimal" value="${esc(st.qtyText)}" autocomplete="off">
        </div>
        <div class="field grow">
          <label for="unit">Unit</label>
          <select id="unit">${units.map((u) => `<option value="${esc(u.label)}" ${u.label === st.unit ? 'selected' : ''}>${esc(u.label)}${u.label !== 'g' && u.label !== 'oz' && !food.noGrams ? ` (${fmt(u.g)} g)` : ''}</option>`).join('')}</select>
        </div>
      </div>
      <div class="chips">${['¼', '½', '1', '1½', '2', '3'].map((c) => `<button type="button" class="chip" data-chip="${c}">${c}</button>`).join('')}</div>
      ${opts.onPick ? '' : `
      <div class="seg small meal-seg" role="radiogroup" aria-label="Meal">${MEALS.map((m) => `<button type="button" role="radio" aria-checked="${st.meal === m.key}" data-meal="${m.key}">${m.label}</button>`).join('')}</div>
      ${editing ? `<div class="field"><label for="edate">Date</label><input id="edate" type="date" value="${st.date}"></div>` : ''}`}
      <section class="nutri">${nutritionHtml()}</section>
      <button type="button" class="btn primary block" data-save>${editing ? 'Save' : opts.onPick ? (opts.pickLabel || 'Add ingredient') : `Add to ${mealLabel(st.meal)}`}</button>
      ${editing ? '<button type="button" class="btn danger block" data-del>Delete entry</button>' : ''}
      ${editable ? `<button type="button" class="link block" data-edit-food>Edit this ${food.source === 'recipe' ? 'recipe' : 'food'}</button>` : ''}`,
    bind: (el) => {
      const qty = $('#qty', el);
      const unit = $('#unit', el);
      const update = () => {
        $('.nutri', el).innerHTML = nutritionHtml();
        const btn = $('[data-save]', el);
        if (!editing && !opts.onPick) btn.textContent = `Add to ${mealLabel(st.meal)}`;
        btn.disabled = !(nowN().q > 0);
      };
      qty.oninput = () => { st.qtyText = qty.value; update(); };
      qty.onfocus = () => qty.select();
      unit.onchange = () => {
        // Keep the same weight when switching between g and oz; otherwise reset to 1.
        const prev = findUnit(food, st.unit);
        const next = findUnit(food, unit.value);
        const q = parseQty(st.qtyText);
        if (next.label === 'g' || next.label === 'oz') st.qtyText = fmtQtyInput(Math.round(((q || 1) * prev.g / next.g) * 10) / 10);
        else st.qtyText = '1';
        st.unit = unit.value;
        qty.value = st.qtyText;
        update();
      };
      $$('[data-chip]', el).forEach((c) => (c.onclick = () => {
        const map = { '¼': '1/4', '½': '1/2', '1½': '1 1/2' };
        st.qtyText = map[c.dataset.chip] || c.dataset.chip;
        qty.value = st.qtyText;
        update();
      }));
      $$('[data-meal]', el).forEach((b) => (b.onclick = () => {
        st.meal = b.dataset.meal;
        $$('[data-meal]', el).forEach((x) => x.setAttribute('aria-checked', x === b));
        update();
      }));
      const ed = $('#edate', el);
      if (ed) ed.onchange = () => { if (ed.value) st.date = ed.value; };
      $('[data-fav]', el).onclick = (ev) => {
        rememberFood(food);
        S.favorites = isFav() ? S.favorites.filter((x) => x !== food.id) : [food.id, ...S.favorites];
        commit();
        const b = ev.currentTarget;
        b.classList.toggle('on', isFav());
        b.setAttribute('aria-pressed', isFav());
      };
      $('[data-save]', el).onclick = () => {
        const q = parseQty(st.qtyText);
        if (!(q > 0)) return;
        if (opts.onPick) {
          rememberFood(food);
          opts.onPick(food, q, st.unit);
        } else if (editing) {
          const fresh = makeEntry(food, q, st.unit, st.meal);
          const list = dayEntries(opts.date).filter((e) => e.id !== editing.id);
          if (list.length) S.diary[opts.date] = list; else delete S.diary[opts.date];
          (S.diary[st.date] ||= []).push({ ...fresh, id: editing.id });
          bumpRecent(food, q, fresh.unit);
          commit();
        } else {
          logFood(st.date, food, q, st.unit, st.meal);
        }
        closeSheet(sheet);
        opts.onDone?.();
      };
      const del = $('[data-del]', el);
      if (del) del.onclick = () => {
        const date = opts.date;
        const before = dayEntries(date);
        removeEntry(date, editing.id);
        toast(`Deleted ${food.name}`, { undo: () => { S.diary[date] = before; commit(); } });
        closeSheet(sheet);
      };
      const ef = $('[data-edit-food]', el);
      if (ef) ef.onclick = () => (food.source === 'recipe' ? openRecipe(S.foods[food.id]) : openCustomFood(S.foods[food.id]));
      update();
    },
  });
  return sheet;
}

function fmtQtyInput(q) {
  const s = fmtQty(q);
  return s.replace('¼', ' 1/4').replace('⅓', ' 1/3').replace('½', ' 1/2').replace('⅔', ' 2/3').replace('¾', ' 3/4').trim();
}

function openEntryEditor(date, e) {
  if (e.src === 'quick') {
    return formSheet({
      title: 'Quick add',
      fields: [
        { name: 'kcal', label: 'Calories', type: 'number', value: e.n.kcal, unit: 'kcal' },
        { name: 'p', label: 'Protein', type: 'number', value: e.n.p || '', unit: 'g' },
        { name: 'c', label: 'Carbs', type: 'number', value: e.n.c || '', unit: 'g' },
        { name: 'f', label: 'Fat', type: 'number', value: e.n.f || '', unit: 'g' },
        { name: 'name', label: 'Description', value: e.name },
        { name: 'meal', label: 'Meal', type: 'select', value: e.meal, options: MEALS.map((m) => [m.key, m.label]) },
      ],
      onSubmit: (v) => {
        Object.assign(e.n, { kcal: num(v.kcal) || 0, p: num(v.p) || 0, c: num(v.c) || 0, f: num(v.f) || 0 });
        e.name = v.name.trim() || 'Quick add';
        e.meal = v.meal;
        commit();
      },
      danger: { label: 'Delete entry', onClick: () => removeEntry(date, e.id) },
    });
  }
  let food = getFood(e.foodId);
  if (!food) {
    // The food was deleted; rebuild one from the entry so the amount can still be edited.
    const per100 = Object.fromEntries(NKEYS.map((k) => [k, e.g ? (e.n[k] * 100) / e.g : e.n[k]]));
    food = { id: e.foodId || uid(), name: e.name, brand: e.brand, source: e.src, n: per100, portions: [], servingG: e.g || 100, servingLabel: e.unit, noGrams: !e.g };
  }
  openFoodDetail(food, { date, meal: e.meal, entry: e });
}

// ---------- Scanner ----------

function openScanner(opts, afterPick) {
  let stop = () => {};
  let sheet;
  const handle = async (code) => {
    code = code.replace(/\D/g, '');
    if (!code) return;
    const status = $('.scan-status', sheet.el);
    status.textContent = `Looking up ${code}…`;
    const strip = (s) => (s || '').replace(/^0+/, '');
    const known = Object.values(S.foods).find((f) => f.barcode && strip(f.barcode) === strip(code));
    const show = (food) => {
      closeSheet(sheet);
      openFoodDetail(food, { ...opts, onDone: afterPick });
    };
    if (known) return show(known);
    if (!navigator.onLine) {
      status.textContent = 'Offline. Barcode lookups need a connection.';
      return notFound(code, 'You\'re offline, so this barcode can\'t be looked up. Enter the label yourself, or try again when you\'re back online.');
    }
    try {
      if (S.settings.usdaKey) {
        const u = await usdaBarcode(code, S.settings.usdaKey).catch(() => null);
        if (u) return show(u);
      }
      const r = await offBarcode(code);
      if (r.found && r.food) return show(r.food);
      notFound(code, r.found ? `Found “${r.name || 'this product'}”, but it has no nutrition data yet.` : 'This barcode isn\'t in the database yet.');
    } catch {
      status.textContent = 'Lookup failed. Check the connection and try again.';
    }
  };
  const notFound = (code, msg) => {
    closeSheet(sheet);
    const s = openSheet({
      title: 'Not found',
      html: () => `<div class="center-msg"><p>${esc(msg)}</p><p class="muted">Barcode ${esc(code)}</p>
        <button type="button" class="btn primary block" data-create>Enter it from the label</button>
        <p class="hint">It's saved with this barcode, so the next scan finds it.</p></div>`,
      bind: (el) => ($('[data-create]', el).onclick = () => {
        closeSheet(s);
        openCustomFood(null, { barcode: code, onSaved: (f) => openFoodDetail(f, { ...opts, onDone: afterPick }) });
      }),
    });
  };

  sheet = openSheet({
    title: 'Scan barcode',
    closeLabel: 'Cancel',
    html: () => `
      <div class="scanner">
        <video playsinline muted autoplay></video>
        <div class="scan-frame" aria-hidden="true"></div>
        <button type="button" class="torch" hidden aria-pressed="false" aria-label="Flashlight">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l-1.5 5v3l-1.5 2v8h-2v-8L9.5 11V8z"/></svg>
        </button>
      </div>
      <p class="scan-status muted">Hold the barcode inside the box, about 4 to 6 inches away.</p>
      <label class="btn block photo-scan">Take a photo of the barcode instead<input type="file" accept="image/*" capture="environment" hidden></label>
      <form class="manual-code">
        <input type="text" inputmode="numeric" placeholder="Or type the barcode number" aria-label="Barcode number" autocomplete="off">
        <button class="btn" type="submit">Look up</button>
      </form>`,
    bind: (el) => {
      $('.photo-scan input', el).onchange = async (ev) => {
        const file = ev.target.files?.[0];
        ev.target.value = '';
        if (!file) return;
        const status = $('.scan-status', el);
        status.textContent = 'Reading the photo…';
        try {
          const code = await readBarcodeFromFile(file);
          if (code) { stop(); handle(code); }
          else status.textContent = 'No barcode found in that photo. Try again closer, with the whole barcode in view and in focus.';
        } catch {
          status.textContent = 'Couldn\'t read that photo. You can type the number below.';
        }
      };
      $('.manual-code', el).onsubmit = (ev) => {
        ev.preventDefault();
        stop();
        handle($('input', ev.target).value);
      };
    },
    onClose: () => stop(),
  });
  startScanner($('video', sheet.el), handle)
    .then((fn) => {
      stop = fn;
      if (!sheets.includes(sheet)) return fn();
      const torch = $('.torch', sheet.el);
      if (fn.torch && torch) {
        torch.hidden = false;
        torch.onclick = async () => {
          const on = torch.getAttribute('aria-pressed') !== 'true';
          if (await fn.torch(on)) torch.setAttribute('aria-pressed', on);
        };
      }
    })
    .catch((e) => {
      const msg = e?.name === 'NotAllowedError'
        ? cameraHelp()
        : 'The camera couldn\'t start. You can type the barcode number below.';
      $('.scan-status', sheet.el).textContent = msg;
    });
}

// ---------- Custom foods ----------

function openCustomFood(food, { barcode, prefillName, onSaved } = {}) {
  const editing = !!food;
  const sg = food ? (food.noGrams ? null : food.servingG) : null;
  const base = food ? (food.servingG || 100) : 100;
  const per = (k) => (food ? Math.round((food.n[k] * base) / 100 * 10) / 10 : '');
  const fields = [
    { name: 'name', label: 'Name', value: food?.name || prefillName || '', autofocus: !editing, placeholder: 'e.g. Grandma\'s lasagna' },
    { name: 'brand', label: 'Brand (optional)', value: food?.brand || '' },
    { name: 'servingLabel', label: 'Serving name', value: food?.servingLabel || 'serving', placeholder: 'serving, scoop, bar, slice…', hint: 'Name it whatever you measure with: "scoop" for protein powder, "bar", "slice".' },
    { name: 'servingG', label: 'Serving weight (optional)', type: 'number', value: sg || '', unit: 'g', hint: 'From the label. Lets you log in grams and ounces too.' },
    { name: 'kcal', label: 'Calories per serving', type: 'number', value: per('kcal'), unit: 'kcal' },
    { name: 'p', label: 'Protein', type: 'number', value: per('p'), unit: 'g' },
    { name: 'c', label: 'Carbohydrates', type: 'number', value: per('c'), unit: 'g' },
    { name: 'f', label: 'Fat', type: 'number', value: per('f'), unit: 'g' },
  ];
  const more = [
    ['fib', 'Fiber', 'g'], ['sug', 'Sugars', 'g'], ['sat', 'Saturated fat', 'g'], ['na', 'Sodium', 'mg'], ['chol', 'Cholesterol', 'mg'],
    ['k', 'Potassium', 'mg'], ['ca', 'Calcium', 'mg'], ['fe', 'Iron', 'mg'], ['vitc', 'Vitamin C', 'mg'], ['vitd', 'Vitamin D', 'µg'], ['caf', 'Caffeine', 'mg'],
  ].map(([k, label, unit]) => ({ name: k, label, type: 'number', value: per(k), unit, more: true }));
  const bc = { name: 'barcode', label: 'Barcode (optional)', type: 'number', value: food?.barcode || barcode || '' };

  formSheet({
    title: editing ? 'Edit food' : 'New food',
    fields: [...fields, ...more, bc],
    extra: '',
    onSubmit: (v) => {
      const name = v.name.trim();
      const kcal = num(v.kcal);
      if (!name || kcal == null) { alert('A name and calories per serving are required.'); return false; }
      const servingG = num(v.servingG);
      const g = servingG || 100;
      const n = {};
      for (const k of NKEYS) n[k] = ((num(v[k]) || 0) * 100) / g;
      const f = {
        id: food?.id || `custom-${uid()}`, name, brand: v.brand.trim(), source: 'custom', verified: false,
        n, portions: [], servingG: g, servingLabel: v.servingLabel.trim() || 'serving', noGrams: !servingG,
        barcode: v.barcode.replace(/\D/g, '') || undefined,
      };
      S.foods[f.id] = f;
      commit();
      toast(editing ? 'Food updated' : `Created ${name}`);
      onSaved?.(f);
    },
    danger: editing ? { label: 'Delete food', onClick: () => deleteFood(food) } : null,
  });
}

function deleteFood(food) {
  if (!confirm(`Delete ${food.name}? Diary entries that used it are kept.`)) return false;
  delete S.foods[food.id];
  S.favorites = S.favorites.filter((x) => x !== food.id);
  S.recents = S.recents.filter((x) => x.id !== food.id);
  commit();
  sheets.filter((s) => s.title === 'Add food' || s.title === 'Ingredient').forEach((s) => closeSheet(s));
}

// ---------- Recipes ----------

function openRecipe(food, { onSaved } = {}) {
  const st = {
    name: food?.name || '',
    servings: food?.servings || 1,
    items: (food?.ingredients || []).map((x) => ({ ...x })),
  };
  const totals = () => sumNutrients(st.items.map((it) => {
    const f = getFood(it.foodId);
    return f ? scale(f.n, it.qty * findUnit(f, it.unit).g) : null;
  }));
  const grams = () => st.items.reduce((a, it) => {
    const f = getFood(it.foodId);
    return a + (f ? it.qty * findUnit(f, it.unit).g : 0);
  }, 0);

  let sheet;
  const html = () => {
    const t = totals();
    const sv = Math.max(1, st.servings || 1);
    return `
      <div class="field"><label for="rname">Recipe name</label><input id="rname" value="${esc(st.name)}" placeholder="e.g. Post-practice shake" autocomplete="off"></div>
      <div class="field"><label for="rserv">Makes how many servings?</label><input id="rserv" inputmode="decimal" value="${esc(st.servings)}"></div>
      <h4 class="list-h">Ingredients</h4>
      ${st.items.length ? st.items.map((it, i) => {
        const f = getFood(it.foodId);
        const kcal = f ? (f.n.kcal * it.qty * findUnit(f, it.unit).g) / 100 : 0;
        return `<button type="button" class="row" data-item="${i}"><span class="row-main"><span class="row-title">${esc(f?.name || 'Missing food')}</span><span class="row-sub">${esc(amountText(it.qty, it.unit))}</span></span><span class="row-kcal">${fmt(kcal)}</span></button>`;
      }).join('') : '<p class="empty">Add each ingredient with the amount you use for the whole batch.</p>'}
      <button type="button" class="add-row" data-add>${ICON.plus}<span>Add ingredient</span></button>
      <section class="card inset">
        <div class="stats">
          <div><b>${fmt(t.kcal / sv)}</b><span>kcal / serving</span></div>
          <div><b>${fmt(t.p / sv)} g</b><span class="key m-p">protein</span></div>
          <div><b>${fmt(t.c / sv)} g</b><span class="key m-c">carbs</span></div>
          <div><b>${fmt(t.f / sv)} g</b><span class="key m-f">fat</span></div>
        </div>
        <p class="hint center">Whole recipe: ${fmt(t.kcal)} kcal</p>
      </section>
      <button type="button" class="btn primary block" data-save>Save recipe</button>
      ${food ? '<button type="button" class="btn danger block" data-del>Delete recipe</button>' : ''}`;
  };
  sheet = openSheet({
    title: food ? 'Edit recipe' : 'New recipe',
    html,
    bind: (el) => {
      $('#rname', el).oninput = (e) => (st.name = e.target.value);
      $('#rserv', el).onchange = (e) => { st.servings = num(e.target.value) || 1; sheet.render(); };
      $('[data-add]', el).onclick = () => openAddFood({
        pickTitle: 'Add ingredient',
        onPick: (f, qty, unit) => { st.items.push({ foodId: f.id, qty, unit }); sheet.render(); },
      });
      $$('[data-item]', el).forEach((b) => (b.onclick = () => {
        const i = Number(b.dataset.item);
        const it = st.items[i];
        const f = getFood(it.foodId);
        actionSheet(f?.name || 'Ingredient', [
          ...(f ? [{ label: 'Change amount', run: () => openFoodDetail(f, { qty: it.qty, unit: it.unit, pickLabel: 'Update', onPick: (_, qty, unit) => { st.items[i] = { ...it, qty, unit }; sheet.render(); } }) }] : []),
          { label: 'Remove', danger: true, run: () => { st.items.splice(i, 1); sheet.render(); } },
        ]);
      }));
      $('[data-save]', el).onclick = () => {
        if (!st.name.trim()) return alert('Give the recipe a name.');
        if (!st.items.length) return alert('Add at least one ingredient.');
        const t = totals();
        const g = grams() || 100;
        const sv = Math.max(1, st.servings || 1);
        const n = {};
        for (const k of NKEYS) n[k] = (t[k] * 100) / g;
        const f = {
          id: food?.id || `recipe-${uid()}`, name: st.name.trim(), brand: '', source: 'recipe', verified: false,
          n, portions: [], servingG: g / sv, servingLabel: 'serving', servings: sv, ingredients: st.items,
        };
        S.foods[f.id] = f;
        commit();
        closeSheet(sheet);
        toast(food ? 'Recipe updated' : `Saved ${f.name}`);
        onSaved?.(f);
      };
      const del = $('[data-del]', el);
      if (del) del.onclick = () => { if (deleteFood(food) !== false) closeSheet(sheet); };
    },
  });
}

// ---------- Saved meals ----------

function openSavedMeal(meal, isNew = false) {
  const st = { name: meal.name, items: meal.items.map((x) => ({ ...x })) };
  let sheet;
  sheet = openSheet({
    title: isNew ? 'New meal' : 'Edit meal',
    html: () => `
      <div class="field"><label for="mname">Name</label><input id="mname" value="${esc(st.name)}" placeholder="e.g. School lunch" autocomplete="off"></div>
      <h4 class="list-h">Items</h4>
      ${st.items.map((it, i) => {
        const f = getFood(it.foodId);
        const kcal = f ? (f.n.kcal * it.qty * findUnit(f, it.unit).g) / 100 : 0;
        return `<div class="row-wrap"><div class="row static"><span class="row-main"><span class="row-title">${esc(f?.name || 'Missing food')}</span><span class="row-sub">${esc(amountText(it.qty, it.unit))}</span></span><span class="row-kcal">${fmt(kcal)}</span></div><button type="button" class="quick remove" data-rm="${i}" aria-label="Remove">${ICON.close}</button></div>`;
      }).join('') || '<p class="empty">No items yet.</p>'}
      <button type="button" class="add-row" data-add>${ICON.plus}<span>Add item</span></button>
      <p class="hint center">${fmt(mealItemsTotals(st.items).kcal)} kcal total</p>
      <button type="button" class="btn primary block" data-save>Save meal</button>
      ${isNew ? '' : '<button type="button" class="btn danger block" data-del>Delete meal</button>'}`,
    bind: (el) => {
      $('#mname', el).oninput = (e) => (st.name = e.target.value);
      $('[data-add]', el).onclick = () => openAddFood({ pickTitle: 'Add item', pickLabel: 'Add to meal', onPick: (f, qty, unit) => { st.items.push({ foodId: f.id, qty, unit }); sheet.render(); } });
      $$('[data-rm]', el).forEach((b) => (b.onclick = () => { st.items.splice(Number(b.dataset.rm), 1); sheet.render(); }));
      $('[data-save]', el).onclick = () => {
        if (!st.name.trim()) return alert('Give the meal a name.');
        if (!st.items.length) return alert('Add at least one item.');
        const m = { id: meal.id, name: st.name.trim(), items: st.items };
        const i = S.meals.findIndex((x) => x.id === meal.id);
        if (i >= 0) S.meals[i] = m; else S.meals.push(m);
        commit();
        closeSheet(sheet);
      };
      const del = $('[data-del]', el);
      if (del) del.onclick = () => {
        if (!confirm(`Delete ${meal.name}?`)) return;
        S.meals = S.meals.filter((x) => x.id !== meal.id);
        commit();
        closeSheet(sheet);
      };
    },
  });
}

// ---------- Nutrients detail ----------

function openNutrients(date) {
  openSheet({
    title: `Nutrients · ${prettyDate(date)}`,
    html: () => {
      const tot = dayTotals(date);
      const t = targets(S);
      const mt = microTargets(S, t.kcal);
      return `
      <section class="card inset">
        ${microRow({ label: 'Calories', unit: 'kcal', dp: 0 }, tot.kcal, { amt: t.kcal })}
        ${microRow({ label: 'Protein', unit: 'g', dp: 0 }, tot.p, { amt: t.p })}
        ${microRow({ label: 'Carbs', unit: 'g', dp: 0 }, tot.c, { amt: t.c })}
        ${microRow({ label: 'Fat', unit: 'g', dp: 0 }, tot.f, { amt: t.f })}
      </section>
      <section class="card inset">
        ${MICROS.map((nn) => microRow(nn, tot[nn.key], mt[nn.key])).join('')}
        ${microRow({ label: 'Caffeine (incl. manual)', unit: 'mg', dp: 0 }, tot.caf + (S.caffeine[date] || 0), mt.caf)}
      </section>
      <p class="hint">Targets are the daily Recommended Dietary Allowances for your age and sex unless you set your own (marked “your goal”). Items marked limit are amounts to stay under. Quick-add entries only count calories and macros.</p>
      <button type="button" class="btn block" data-goals>Set nutrient goals</button>`;
    },
    bind: (el) => { $('[data-goals]', el).onclick = () => openNutrientGoals(); },
    live: true,
  });
}

// ---------- Exercise ----------

function openExercise(date, ex) {
  const kg = latestWeight(S);
  formSheet({
    title: ex ? 'Edit exercise' : 'Add exercise',
    fields: [
      { name: 'act', label: 'Activity', type: 'select', value: ex ? (ACTIVITIES.some(([n]) => n === ex.name) ? ex.name : '__custom') : 'Soccer', options: [...ACTIVITIES.map(([n]) => [n, n]), ['__custom', 'Other (enter calories)']] },
      { name: 'min', label: 'Minutes', type: 'number', value: ex?.min ?? 60, unit: 'min' },
      { name: 'kcal', label: 'Calories burned (optional)', type: 'number', value: ex && !ex.met ? ex.kcal : '', unit: 'kcal', hint: kg ? 'Leave blank to estimate from the activity, time and your weight.' : 'Log a weight to get calorie estimates.' },
      { name: 'name', label: 'Name (for Other)', value: ex && !ex.met ? ex.name : '' },
    ],
    submit: ex ? 'Save' : 'Add',
    onSubmit: (v) => {
      const min = num(v.min) || 0;
      const found = ACTIVITIES.find(([n]) => n === v.act);
      const manual = num(v.kcal);
      const kcal = manual ?? (found ? exerciseKcal(found[1], kg, min) : 0);
      const entry = { id: ex?.id || uid(), name: found ? found[0] : (v.name.trim() || 'Exercise'), met: manual == null && found ? found[1] : null, min, kcal: Math.round(kcal) };
      const list = dayExercise(date).filter((e) => e.id !== entry.id);
      S.exercise[date] = [...list, entry];
      commit();
    },
    danger: ex ? { label: 'Delete', onClick: () => { S.exercise[date] = dayExercise(date).filter((e) => e.id !== ex.id); commit(); } } : null,
  });
}

// ---------- Weight & measurements ----------

function openWeight(w) {
  formSheet({
    title: w ? 'Edit weigh-in' : 'Log weight',
    fields: [
      { name: 'v', label: 'Weight', type: 'number', autofocus: !w, value: w ? fmt(isUS() ? kgToLb(w.kg) : w.kg, 1).replace(/,/g, '') : '', unit: isUS() ? 'lb' : 'kg' },
      { name: 'd', label: 'Date', type: 'date', value: w?.d || todayStr() },
    ],
    onSubmit: ({ v, d }) => {
      const val = num(v);
      if (!val || !d) return false;
      const kg = isUS() ? lbToKg(val) : val;
      S.weights = S.weights.filter((x) => x.d !== d && x.d !== w?.d);
      S.weights.push({ d, kg });
      S.weights.sort((a, b) => a.d.localeCompare(b.d));
      commit();
    },
    danger: w ? { label: 'Delete', onClick: () => { S.weights = S.weights.filter((x) => x.d !== w.d); commit(); } } : null,
  });
}

function openMeasure(type = 'waist') {
  const u = isUS() ? 'in' : 'cm';
  formSheet({
    title: 'Add measurement',
    fields: [
      { name: 'type', label: 'Measurement', type: 'select', value: type, options: MEASURES },
      { name: 'v', label: `Value (${u})`, type: 'number', unit: u, hint: isUS() ? 'For height, enter total inches (5′ 2″ = 62).' : '' },
      { name: 'd', label: 'Date', type: 'date', value: todayStr() },
    ],
    onSubmit: ({ type: t, v, d }) => {
      const val = num(v);
      if (!val || !d) return false;
      const cm = isUS() ? inToCm(val) : val;
      S.measures.push({ id: uid(), d, type: t, cm });
      if (t === 'height') S.profile.heightCm = cm;
      commit();
    },
  });
}

function openMeasureHistory(type) {
  const list = () => S.measures.filter((m) => m.type === type).sort((a, b) => a.d.localeCompare(b.d));
  const sheet = openSheet({
    title: measureLabel(type),
    live: true,
    html: () => {
      const l = list();
      const pts = l.map((m) => ({ t: parseDate(m.d).getTime(), value: isUS() ? cmToIn(m.cm) : m.cm, label: m.d }));
      return `${pts.length > 1 ? `<section class="card inset">${lineChart(pts, { unit: isUS() ? 'in' : 'cm', title: measureLabel(type) })}</section>` : ''}
        ${[...l].reverse().map((m) => `<div class="row-wrap"><div class="row static"><span class="row-main"><span class="row-title">${esc(prettyDate(m.d))}</span></span><span class="row-kcal">${type === 'height' ? heightStr(m.cm) : lengthStr(m.cm)}</span></div><button type="button" class="quick remove" data-rm="${m.id}" aria-label="Delete">${ICON.close}</button></div>`).join('')}
        <button type="button" class="btn primary block" data-add>Add ${esc(measureLabel(type).toLowerCase())}</button>`;
    },
    bind: (el) => {
      $$('[data-rm]', el).forEach((b) => (b.onclick = () => { S.measures = S.measures.filter((m) => m.id !== b.dataset.rm); commit(); }));
      $('[data-add]', el).onclick = () => openMeasure(type);
    },
  });
  return sheet;
}

// ---------- Profile & targets ----------

function openProfile(first = false) {
  const p = S.profile;
  const us = isUS();
  const h = latestHeight(S);
  const hIn = h ? cmToIn(h) : null;
  const w = latestWeight(S);
  formSheet({
    title: first ? 'Welcome' : 'Profile',
    fields: [
      { name: 'name', label: 'Name', value: p.name, placeholder: 'Your name', autofocus: first },
      { name: 'sex', label: 'Sex', type: 'select', value: p.sex, options: [['m', 'Male'], ['f', 'Female']] },
      { name: 'birth', label: 'Birth date', type: 'date', value: p.birth, hint: 'Calorie needs change with age, so this keeps your target current as you grow.' },
      { name: 'units', label: 'Units', type: 'select', value: p.units, options: [['us', 'Pounds, feet and inches'], ['metric', 'Kilograms and centimeters']] },
      ...(us
        ? [
          { name: 'ft', label: 'Height: feet', type: 'number', value: hIn ? Math.floor(hIn / 12) : '', unit: 'ft' },
          { name: 'in', label: 'Height: inches', type: 'number', value: hIn ? Math.round((hIn % 12) * 10) / 10 : '', unit: 'in' },
        ]
        : [{ name: 'cm', label: 'Height', type: 'number', value: h ? Math.round(h) : '', unit: 'cm' }]),
      { name: 'w', label: 'Current weight', type: 'number', value: w ? Math.round((us ? kgToLb(w) : w) * 10) / 10 : '', unit: us ? 'lb' : 'kg', hint: 'Saved as today\'s weigh-in if it changed.' },
      { name: 'activity', label: 'Activity level', type: 'select', value: p.activity, options: ACTIVITY.map((a) => [a.key, `${a.label}: ${a.hint}`]) },
      { name: 'goal', label: 'Goal', type: 'select', value: p.goal, options: [['maintain', 'Maintain and grow normally'], ['gain', 'Gain (about +10%)'], ['lose', 'Lose (about −10%)']] },
    ],
    submit: first ? 'Start tracking' : 'Save',
    extra: first ? '<p class="hint">Everything stays on this phone. You can change any of this later under Profile.</p>' : '',
    onSubmit: (v) => {
      const unitsChanged = v.units !== p.units;
      Object.assign(p, { name: v.name.trim(), sex: v.sex, birth: v.birth, activity: v.activity, goal: v.goal });
      let cm = null;
      if (us && (num(v.ft) || num(v.in))) cm = inToCm((num(v.ft) || 0) * 12 + (num(v.in) || 0));
      if (!us && num(v.cm)) cm = num(v.cm);
      if (cm && Math.abs(cm - (h || 0)) > 0.3) {
        p.heightCm = cm;
        S.measures.push({ id: uid(), d: todayStr(), type: 'height', cm });
      }
      const wv = num(v.w);
      if (wv) {
        const kg = us ? lbToKg(wv) : wv;
        if (!w || Math.abs(kg - w) > 0.05) {
          S.weights = S.weights.filter((x) => x.d !== todayStr());
          S.weights.push({ d: todayStr(), kg });
          S.weights.sort((a, b) => a.d.localeCompare(b.d));
        }
      }
      p.units = v.units;
      S.settings.onboarded = true;
      commit();
      if (unitsChanged) toast('Units updated');
    },
  });
}

function openTargets() {
  const g = S.goals;
  const t = targets(S);
  const sheet = openSheet({
    title: 'Daily targets',
    html: () => `
      <form class="form" novalidate>
        <div class="field"><label for="kcal">Calories</label>
          <input id="kcal" name="kcal" inputmode="decimal" class="has-unit" value="${g.kcalOverride || ''}" placeholder="${t.estimate ? `${t.estimate} (calculated)` : 'e.g. 2200'}"><span class="unit">kcal</span>
          <p class="hint">${t.estimate ? `Calculated from your profile: ${fmt(t.estimate)} kcal. Leave blank to use it; it updates as you grow.` : 'Add birth date, height and weight in Profile to calculate this.'} Or type a number from your doctor or dietitian.</p>
        </div>
        <div class="field"><label>Macros as</label>
          <div class="seg small" role="radiogroup">
            <button type="button" role="radio" aria-checked="${g.macroMode !== 'g'}" data-mode="pct">% of calories</button>
            <button type="button" role="radio" aria-checked="${g.macroMode === 'g'}" data-mode="g">Grams</button>
          </div>
        </div>
        <div class="macro-inputs" data-for="pct" ${g.macroMode === 'g' ? 'hidden' : ''}>
          ${[['p', 'Protein'], ['c', 'Carbs'], ['f', 'Fat']].map(([k, l]) => `<div class="field"><label for="pct-${k}">${l}</label><input id="pct-${k}" name="pct-${k}" inputmode="decimal" class="has-unit" value="${g.pct[k]}"><span class="unit">%</span></div>`).join('')}
          <p class="hint pct-sum"></p>
        </div>
        <div class="macro-inputs" data-for="g" ${g.macroMode === 'g' ? '' : 'hidden'}>
          ${[['p', 'Protein'], ['c', 'Carbs'], ['f', 'Fat']].map(([k, l]) => `<div class="field"><label for="g-${k}">${l}</label><input id="g-${k}" name="g-${k}" inputmode="decimal" class="has-unit" value="${g.grams[k] ?? t[k]}"><span class="unit">g</span></div>`).join('')}
        </div>
        <p class="hint">Recommended ranges for ages 4–18: protein 10–30%, carbs 45–65%, fat 25–35%.</p>
        <div class="field"><label for="water">Water goal</label><input id="water" name="water" inputmode="decimal" class="has-unit" value="${g.waterCups || ''}" placeholder="${waterGoalCups({ ...S, goals: { ...g, waterCups: null } })} (by age)"><span class="unit">cups</span></div>
        <button type="button" class="row" data-micro-goals><span class="row-main"><span class="row-title">Nutrient goals</span><span class="row-sub">Fiber, sugar, sodium, vitamins, caffeine and more</span></span><span class="row-kcal">›</span></button>
        <label class="field check"><input type="checkbox" name="addEx" ${g.addExercise ? 'checked' : ''}><span>Add exercise calories to the daily budget</span></label>
        <p class="hint">Usually leave this off: the activity level in your profile already covers normal sport. Turn it on if you set activity to Sedentary and log every practice.</p>
        <button class="btn primary block" type="submit">Save</button>
      </form>`,
    bind: (el) => {
      $('[data-micro-goals]', el).onclick = () => openNutrientGoals();
      let mode = g.macroMode === 'g' ? 'g' : 'pct';
      const sum = () => {
        const s = ['p', 'c', 'f'].reduce((a, k) => a + (num($(`[name=pct-${k}]`, el).value) || 0), 0);
        const out = $('.pct-sum', el);
        out.textContent = `Total ${fmt(s)}%${Math.round(s) === 100 ? '' : ' (should be 100%)'}`;
        out.classList.toggle('warn-text', Math.round(s) !== 100);
        return s;
      };
      $$('[name^=pct-]', el).forEach((i) => (i.oninput = sum));
      sum();
      $$('[data-mode]', el).forEach((b) => (b.onclick = () => {
        mode = b.dataset.mode;
        $$('[data-mode]', el).forEach((x) => x.setAttribute('aria-checked', x === b));
        $$('.macro-inputs', el).forEach((x) => (x.hidden = x.dataset.for !== mode));
      }));
      $('form', el).onsubmit = (ev) => {
        ev.preventDefault();
        const f = ev.target;
        if (mode === 'pct' && Math.round(sum()) !== 100) return alert('Macro percentages need to add up to 100%.');
        g.kcalOverride = num(f.kcal.value) || null;
        g.macroMode = mode;
        if (mode === 'pct') for (const k of ['p', 'c', 'f']) g.pct[k] = num(f[`pct-${k}`].value) || 0;
        else for (const k of ['p', 'c', 'f']) g.grams[k] = num(f[`g-${k}`].value) || 0;
        g.waterCups = num(f.water.value) || null;
        g.addExercise = f.addEx.checked;
        commit();
        closeSheet(sheet);
      };
    },
  });
}

// ---------- Notifications ----------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function notifySummary() {
  const p = S.settings.push.prefs;
  const on = [];
  if (p.meals.on) on.push('meal reminders');
  if (p.goal.on) on.push(`goal check at ${fmtTime(p.goal.time)}`);
  if (p.weigh.on) on.push(`weigh-in on ${DAYS[p.weigh.day]}s`);
  if (p.weekly.on) on.push('weekly summary');
  return on.length ? `On: ${on.join(', ')}.` : 'On, but every reminder is switched off.';
}

function openNotifications() {
  const push = () => S.settings.push || { on: false, badge: true, prefs: structuredClone(DEFAULT_PREFS) };
  const st = { prefs: structuredClone(push().prefs || DEFAULT_PREFS), busy: false, msg: '' };
  const sup = pushSupport();
  const timeInput = (name, v) => `<input type="time" name="${name}" value="${esc(v)}">`;
  const dayInput = (name, v) => `<select name="${name}">${DAYS.map((d, i) => `<option value="${i}" ${i === v ? 'selected' : ''}>${d}</option>`).join('')}</select>`;
  const toggle = (name, on, label, hint) => `<label class="switch-row"><span><b>${label}</b><small>${hint}</small></span><input type="checkbox" role="switch" name="${name}" ${on ? 'checked' : ''}></label>`;

  let sheet;
  sheet = openSheet({
    title: 'Notifications',
    html: () => {
      const p = st.prefs;
      const on = push().on;
      if (!sup.ok) {
        return `<section class="card notice"><b>${sup.reason === 'install' ? 'Install Plateful first' : 'Not available here'}</b>
          <p>${sup.reason === 'install' ? 'iPhone only sends notifications to apps on the Home Screen. In Safari tap Share › Add to Home Screen, open Plateful from the new icon, then come back here.' : 'This browser can\'t receive notifications. On iPhone, use the Home Screen app (iOS 16.4 or newer).'}</p></section>`;
      }
      return `
        ${st.msg ? `<p class="hint ${st.msgBad ? 'warn-text' : ''}">${esc(st.msg)}</p>` : ''}
        ${on ? '' : `<button type="button" class="btn primary block" data-enable ${st.busy ? 'disabled' : ''}>${st.busy ? 'Turning on…' : 'Turn on notifications'}</button>
          <p class="hint">Your phone will ask for permission. Reminders only go out when something is still missing: a meal you haven't logged, or goals that are still open in the evening.</p>`}
        <form class="form notif-form" ${on ? '' : 'hidden'}>
          <section class="card">
            ${toggle('goal-on', p.goal.on, 'Evening goal check', 'Calories, protein or water still short')}
            <div class="field inline"><label>Time</label>${timeInput('goal-time', p.goal.time)}</div>
          </section>
          <section class="card">
            ${toggle('meals-on', p.meals.on, 'Meal reminders', 'Only if that meal has nothing logged')}
            <div class="field inline"><label>Breakfast</label>${timeInput('meals-breakfast', p.meals.breakfast)}</div>
            <div class="field inline"><label>Lunch</label>${timeInput('meals-lunch', p.meals.lunch)}</div>
            <div class="field inline"><label>Dinner</label>${timeInput('meals-dinner', p.meals.dinner)}</div>
          </section>
          <section class="card">
            ${toggle('weigh-on', p.weigh.on, 'Weekly weigh-in', 'Skipped if you weighed in this week')}
            <div class="field inline"><label>Day</label>${dayInput('weigh-day', p.weigh.day)}</div>
            <div class="field inline"><label>Time</label>${timeInput('weigh-time', p.weigh.time)}</div>
          </section>
          <section class="card">
            ${toggle('weekly-on', p.weekly.on, 'Weekly summary', 'Average calories, protein days, weight change')}
            <div class="field inline"><label>Day</label>${dayInput('weekly-day', p.weekly.day)}</div>
            <div class="field inline"><label>Time</label>${timeInput('weekly-time', p.weekly.time)}</div>
          </section>
          <section class="card">
            ${toggle('badge', push().badge !== false, 'App icon badge', 'A 1 on the icon when a reminder is waiting. Opening Plateful clears it.')}
          </section>
          <button class="btn primary block" type="submit" ${st.busy ? 'disabled' : ''}>Save</button>
          <button type="button" class="btn block" data-test>Send a test notification</button>
          <button type="button" class="btn danger block" data-disable>Turn off notifications</button>
        </form>`;
    },
    bind: (el) => {
      const run = async (fn, okMsg) => {
        st.busy = true; st.msg = ''; sheet.render();
        try {
          await fn();
          st.msg = okMsg || ''; st.msgBad = false;
        } catch (e) {
          st.msg = e.message; st.msgBad = true;
        }
        st.busy = false;
        commit();
        sheet.render();
      };
      const en = $('[data-enable]', el);
      if (en) en.onclick = () => run(() => enablePush(S), 'Notifications are on. Adjust the times below.');
      const form = $('.notif-form', el);
      if (!form) return;
      const read = () => {
        const v = (n) => form.elements[n];
        st.prefs = {
          goal: { on: v('goal-on').checked, time: v('goal-time').value || '19:30' },
          meals: { on: v('meals-on').checked, breakfast: v('meals-breakfast').value || '09:30', lunch: v('meals-lunch').value || '13:30', dinner: v('meals-dinner').value || '19:00' },
          weigh: { on: v('weigh-on').checked, day: Number(v('weigh-day').value), time: v('weigh-time').value || '08:00' },
          weekly: { on: v('weekly-on').checked, day: Number(v('weekly-day').value), time: v('weekly-time').value || '18:00' },
        };
        S.settings.push = { ...push(), badge: v('badge').checked };
      };
      form.onsubmit = (ev) => {
        ev.preventDefault();
        read();
        run(() => savePrefs(S, st.prefs), 'Saved.');
      };
      $('[data-test]', el).onclick = () => run(() => sendTest(S), 'Sent. It should arrive in a few seconds.');
      $('[data-disable]', el).onclick = () => run(() => disablePush(S), 'Notifications are off.');
    },
  });
}

// ---------- Nutrient goals ----------

function openNutrientGoals() {
  const t = targets(S);
  const defs = defaultMicroTargets(S, t.kcal);
  const st = structuredClone(S.goals.micros || {});
  const describe = (d) => (d ? `${d.limit ? 'at most' : 'at least'} ${fmt(d.amt)}` : 'no target');
  let sheet;
  sheet = openSheet({
    title: 'Nutrient goals',
    html: () => `
      <p class="hint">Leave a nutrient on Recommended to use the standard amount for your age and sex, or set your own. “At least” goals you haven't reached show up in the evening goal reminder.</p>
      <form class="form goals-form" novalidate>
        ${GOAL_NUTRIENTS.map((nn) => {
          const g = st[nn.key];
          const mode = g?.mode || 'default';
          return `<section class="card goal-row">
            <div class="goal-head"><b>${nn.label}</b><small class="muted">Recommended: ${describe(defs[nn.key])}${defs[nn.key] ? ` ${nn.unit}` : ''}</small></div>
            <div class="goal-inputs">
              <select name="mode-${nn.key}" aria-label="${nn.label} goal type">
                <option value="default" ${mode === 'default' ? 'selected' : ''}>Recommended</option>
                <option value="min" ${mode === 'min' ? 'selected' : ''}>At least</option>
                <option value="max" ${mode === 'max' ? 'selected' : ''}>At most</option>
                <option value="off" ${mode === 'off' ? 'selected' : ''}>No goal</option>
              </select>
              <span class="goal-amt" ${mode === 'min' || mode === 'max' ? '' : 'hidden'}>
                <input name="amt-${nn.key}" inputmode="decimal" value="${g?.amt ?? ''}" placeholder="${defs[nn.key]?.amt ?? ''}" aria-label="${nn.label} amount"><span>${nn.unit}</span>
              </span>
            </div>
          </section>`;
        }).join('')}
        <button class="btn primary block" type="submit">Save</button>
        <button type="button" class="btn danger block" data-reset>Reset all to recommended</button>
      </form>`,
    bind: (el) => {
      const form = $('form', el);
      $$('select[name^=mode-]', el).forEach((sel) => (sel.onchange = () => {
        const box = sel.parentElement.querySelector('.goal-amt');
        box.hidden = !['min', 'max'].includes(sel.value);
        if (!box.hidden) {
          const input = box.querySelector('input');
          if (!input.value) input.value = input.placeholder;
          input.focus();
        }
      }));
      form.onsubmit = (ev) => {
        ev.preventDefault();
        const out = {};
        for (const nn of GOAL_NUTRIENTS) {
          const mode = form.elements[`mode-${nn.key}`].value;
          if (mode === 'off') out[nn.key] = { mode };
          if (mode === 'min' || mode === 'max') {
            const amt = num(form.elements[`amt-${nn.key}`].value);
            if (!(amt > 0)) { alert(`Enter an amount for ${nn.label}, or set it back to Recommended.`); return; }
            out[nn.key] = { mode, amt };
          }
        }
        S.goals.micros = out;
        commit();
        closeSheet(sheet);
        toast('Nutrient goals saved');
      };
      $('[data-reset]', el).onclick = () => {
        if (!confirm('Use the recommended amounts for every nutrient?')) return;
        S.goals.micros = {};
        commit();
        closeSheet(sheet);
        toast('Back to recommended amounts');
      };
    },
  });
}

// ---------- Export ----------

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportDiaryCsv() {
  const head = ['date', 'meal', 'food', 'brand', 'source', 'amount', 'unit', 'grams', ...NUTRIENTS.map((n) => `${n.key === 'kcal' ? 'calories' : n.label.toLowerCase().replace(/ /g, '_')}_${n.unit}`)];
  const rows = [head];
  for (const d of Object.keys(S.diary).sort()) {
    for (const e of S.diary[d]) {
      rows.push([d, e.meal, e.name, e.brand, e.src, e.qty, e.unit, Math.round(e.g * 10) / 10, ...NUTRIENTS.map((n) => Math.round((e.n[n.key] || 0) * 10) / 10)]);
    }
  }
  for (const d of Object.keys(S.exercise).sort()) for (const e of S.exercise[d]) rows.push([d, 'exercise', e.name, '', '', e.min, 'min', '', -e.kcal]);
  for (const d of Object.keys(S.water).sort()) if (S.water[d]) rows.push([d, 'water', 'Water', '', '', Math.round(S.water[d]), 'ml']);
  shareFile(`plateful-diary-${todayStr()}.csv`, rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
}

function exportWeightsCsv() {
  const rows = [['date', 'measurement', 'value', 'unit']];
  for (const w of S.weights) rows.push([w.d, 'weight', Math.round(w.kg * 100) / 100, 'kg']);
  for (const m of [...S.measures].sort((a, b) => a.d.localeCompare(b.d))) rows.push([m.d, m.type, Math.round(m.cm * 10) / 10, 'cm']);
  shareFile(`plateful-body-${todayStr()}.csv`, rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
}

async function shareFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- boot ----------

function openDeepLink(go) {
  if (go === 'progress') ui.tab = 'progress';
  if (go === 'weigh') {
    ui.tab = 'progress';
    setTimeout(() => openWeight(), 50);
  }
}

async function boot() {
  S = await store.load();
  store.requestPersistence();
  $('#tabbar').onclick = (ev) => {
    const b = ev.target.closest('[data-tab]');
    if (!b) return;
    if (b.dataset.tab === 'add') return openAddFood({ date: ui.tab === 'diary' ? ui.date : todayStr(), meal: defaultMealForNow() });
    closeAllSheets();
    ui.tab = b.dataset.tab;
    renderMain();
    window.scrollTo(0, 0);
  };
  const go = new URLSearchParams(location.search).get('go');
  if (go) {
    history.replaceState(null, '', location.pathname);
    openDeepLink(go);
  }
  renderMain();
  onInstallChange(() => { if (ui.tab === 'settings') renderMain(); });
  if (!S.settings.onboarded) openProfile(true);
  afterChange(S);
  checkSubscription(S).then(() => store.save(S));
  navigator.serviceWorker?.addEventListener('message', (ev) => {
    if (ev.data?.type !== 'open') return;
    const g = new URL(ev.data.url).searchParams.get('go');
    closeAllSheets();
    ui.date = todayStr();
    ui.tab = 'diary';
    if (g) openDeepLink(g);
    renderMain();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      store.flush();
      ui.wasToday = ui.date === todayStr();
    } else {
      afterChange(S);
    }
    if (document.visibilityState === 'visible' && ui.wasToday && ui.date !== todayStr()) {
      // Reopened the app on a new day: follow it, unless a past day was being edited.
      ui.date = todayStr();
      renderMain();
    }
  });
  window.addEventListener('pagehide', () => store.flush());
  window.addEventListener('online', () => sheets.forEach((s) => s.refresh?.()));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  loadLocal();
}

boot();

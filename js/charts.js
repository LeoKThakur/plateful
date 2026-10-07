// Small hand-rolled SVG charts. Colors come from CSS variables so they follow dark mode.

const W = 340;
const H = 170;
const PAD = { l: 34, r: 8, t: 10, b: 22 };

function niceRange(min, max) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step = 10 ** Math.floor(Math.log10(span / 4));
  const s = [1, 2, 2.5, 5, 10].map((m) => m * step).find((x) => span / x <= 5) || step * 10;
  return { lo: Math.floor(min / s) * s, hi: Math.ceil(max / s) * s, step: s };
}

function axis(lo, hi, step, y) {
  let out = '';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    const yy = y(v);
    out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${yy}" y2="${yy}" class="grid"/>`;
    out += `<text x="${PAD.l - 5}" y="${yy + 3.5}" class="tick" text-anchor="end">${Math.round(v * 10) / 10}</text>`;
  }
  return out;
}

function xLabels(labels, x) {
  const every = Math.max(1, Math.ceil(labels.length / 7));
  return labels.map((l, i) => (i % every ? '' : `<text x="${x(i)}" y="${H - 6}" class="tick" text-anchor="middle">${l}</text>`)).join('');
}

// bars: [{ label, value }], target: number|null
export function barChart(bars, target, { title = 'Calories by day' } = {}) {
  const max = Math.max(target || 0, ...bars.map((b) => b.value), 10);
  const { lo, hi, step } = niceRange(0, max * 1.05);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const y = (v) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  const bw = iw / bars.length;
  const x = (i) => PAD.l + bw * i + bw / 2;
  const barW = Math.max(2, Math.min(22, bw * 0.62));
  let rects = '';
  bars.forEach((b, i) => {
    if (!b.value) return;
    const yy = y(b.value);
    const over = target && b.value > target * 1.1;
    rects += `<rect x="${x(i) - barW / 2}" y="${yy}" width="${barW}" height="${y(0) - yy}" rx="${Math.min(4, barW / 2)}" class="${over ? 'cbar over' : 'cbar'}"><title>${b.label}: ${Math.round(b.value)}</title></rect>`;
  });
  const tline = target ? `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(target)}" y2="${y(target)}" class="target"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${title}">${axis(lo, hi, step, y)}${rects}${tline}${xLabels(bars.map((b) => b.label), x)}</svg>`;
}

// points: [{ t (ms), value, label }] — dots plus a smoothed trend line.
export function lineChart(points, { unit = '', title = 'Trend' } = {}) {
  if (!points.length) return '';
  const vals = points.map((p) => p.value);
  const { lo, hi, step } = niceRange(Math.min(...vals), Math.max(...vals));
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (t) => PAD.l + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
  const y = (v) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;

  let trend = [];
  let ew = vals[0];
  for (const p of points) {
    ew = ew + 0.25 * (p.value - ew);
    trend.push([x(p.t), y(ew)]);
  }
  const path = trend.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('');
  const dots = points.map((p) => `<circle cx="${x(p.t)}" cy="${y(p.value)}" r="3" class="dot"><title>${p.label}: ${p.value.toFixed(1)} ${unit}</title></circle>`).join('');

  const fmtD = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const labels = `<text x="${PAD.l}" y="${H - 6}" class="tick">${fmtD(t0)}</text>` +
    (t1 !== t0 ? `<text x="${W - PAD.r}" y="${H - 6}" class="tick" text-anchor="end">${fmtD(t1)}</text>` : '');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${title}">${axis(lo, hi, step, y)}${points.length > 1 ? `<path d="${path}" class="trend"/>` : ''}${dots}${labels}</svg>`;
}

// Calorie ring for the diary header.
export function ring(fraction, { size = 132, stroke = 12 } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  const over = fraction > 1;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring${over ? ' over' : ''}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg" stroke-width="${stroke}" fill="none"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-width="${stroke}" fill="none"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}

// Schlanke SVG-Diagramme (keine externe Bibliothek, damit alles offline läuft).

import { fmtNum, fmtDate, isoFromDate } from './util.js';

function niceStep(range, count) {
  const raw = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

const dateLabel = ts => fmtDate(isoFromDate(new Date(ts)), { weekday: false });

// points: [{ x: timestamp, y: Zahl }]
export function lineChart(points, { width = 320, height = 200, unit = '' } = {}) {
  if (!points.length) return '<div class="chart-empty">Noch keine Daten</div>';
  const W = Math.max(240, Math.round(width));
  const H = height;
  const P = { l: 44, r: 16, t: 14, b: 28 };

  let x0 = points[0].x, x1 = points[points.length - 1].x;
  if (x1 - x0 < 864e5) { x0 -= 3 * 864e5; x1 += 3 * 864e5; }
  const ys = points.map(p => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const padY = (hi - lo) * 0.12 || Math.max(1, hi * 0.05);
  lo -= padY; hi += padY;
  const step = niceStep(hi - lo, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (lo < 0 && Math.min(...ys) >= 0) lo = 0;

  const X = x => P.l + ((x - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = y => P.t + ((hi - y) / (hi - lo)) * (H - P.t - P.b);

  let grid = '';
  for (let v = lo; v <= hi + step / 2; v += step) {
    const y = Y(v).toFixed(1);
    grid += `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}"/>`;
    grid += `<text class="tick" x="${P.l - 8}" y="${+y + 4}" text-anchor="end">${fmtNum(v, 1)}</text>`;
  }

  const first = points[0], last = points[points.length - 1];
  let xl = `<text class="tick" x="${X(first.x)}" y="${H - 8}" text-anchor="${points.length > 1 ? 'start' : 'middle'}">${dateLabel(first.x)}</text>`;
  if (points.length > 1) xl += `<text class="tick" x="${X(last.x)}" y="${H - 8}" text-anchor="end">${dateLabel(last.x)}</text>`;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = points.length > 1 ? `<path class="area" d="${line}L${X(last.x).toFixed(1)},${H - P.b}L${X(first.x).toFixed(1)},${H - P.b}Z"/>` : '';
  const tip = p => `${dateLabel(p.x)} · ${fmtNum(p.y, 1)} ${unit}`;
  const dots = points.map((p, i) => {
    const cx = X(p.x).toFixed(1), cy = Y(p.y).toFixed(1);
    return `<circle class="dot${i === points.length - 1 ? ' last' : ''}" cx="${cx}" cy="${cy}" r="${i === points.length - 1 ? 5 : 3.5}"/>`
      + `<circle class="hit" cx="${cx}" cy="${cy}" r="14" data-action="chart-point" data-tip="${tip(p)}"/>`;
  }).join('');

  return `<div class="chart">
    <div class="chart-tip">Zuletzt: ${tip(last)}</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Verlauf">${grid}${xl}${area}<path class="line" d="${line}"/>${dots}</svg>
  </div>`;
}

export function sparkline(values, w = 72, h = 26) {
  if (values.length < 2) return '';
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - lo) / span) * (h - 6)).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}"/></svg>`;
}

// Trainings pro Woche (letzte n Wochen)
export function weekBars(counts, labels) {
  const n = counts.length;
  const W = 320, H = 84, gap = 6, base = H - 18, top = 14;
  const bw = (W - gap * (n - 1)) / n;
  const max = Math.max(3, ...counts);
  const bars = counts.map((c, i) => {
    const bh = c ? Math.max(4, (c / max) * (base - top)) : 2;
    const x = i * (bw + gap);
    return `<rect class="${i === n - 1 ? 'bar now' : c ? 'bar' : 'bar zero'}" x="${x.toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3"/>`
      + (c ? `<text class="bar-val" x="${(x + bw / 2).toFixed(1)}" y="${(base - bh - 4).toFixed(1)}" text-anchor="middle">${c}</text>` : '');
  }).join('');
  const mid = Math.floor((n - 1) / 2);
  const lab = `<text class="tick" x="0" y="${H - 2}" text-anchor="start">${labels[0]}</text>`
    + `<text class="tick" x="${(mid * (bw + gap) + bw / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle">${labels[mid]}</text>`
    + `<text class="tick" x="${W}" y="${H - 2}" text-anchor="end">${labels[n - 1]}</text>`;
  return `<svg class="weeks" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Trainings pro Woche">${bars}${lab}</svg>`;
}

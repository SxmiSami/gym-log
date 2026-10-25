// Kleine Helfer: Formatierung, Datum, Satz-Schemata.

export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const pad = n => String(n).padStart(2, '0');

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// 63.5 -> "63,5"
export function fmtNum(n, digits = 2) {
  if (n == null || n === '' || !isFinite(n)) return '';
  return Number(n).toLocaleString('de-DE', { maximumFractionDigits: digits, useGrouping: false });
}

// 12345 -> "12.345"
export function fmtBig(n) {
  if (n == null || !isFinite(n)) return '';
  return Math.round(n).toLocaleString('de-DE');
}

// "63,5" / "63.5" -> 63.5, leer/ungültig -> null
export function parseNum(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return isFinite(n) && n >= 0 ? n : null;
}

export const roundTo = (n, step = 0.25) => Math.round(n / step) * step;
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ---------- Datum ----------

export function isoFromDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const todayISO = () => isoFromDate(new Date());

export function dateFromISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// "2026-10-24" -> "Sa, 24.10."
export function fmtDate(iso, { weekday = true, year = false } = {}) {
  const d = dateFromISO(iso);
  const s = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${year ? d.getFullYear() : ''}`;
  return weekday ? `${WD_SHORT[d.getDay()]}, ${s}` : s;
}

export function relDays(iso) {
  const diff = Math.round((dateFromISO(todayISO()) - dateFromISO(iso)) / 864e5);
  if (diff <= 0) return 'heute';
  if (diff === 1) return 'gestern';
  if (diff < 14) return `vor ${diff} Tagen`;
  if (diff < 60) return `vor ${Math.round(diff / 7)} Wochen`;
  return `vor ${Math.round(diff / 30)} Monaten`;
}

export function relTime(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'gerade eben';
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  return `am ${fmtDate(isoFromDate(new Date(ts)), { weekday: false })}`;
}

export function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

export function fmtClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ---------- Satz-Schemata ----------
// Schreibweise wie in deiner Liste: "3x 8-12", "2x (5-8) + 1x (8-12)", "3x 25", "3x"

export function parseScheme(str) {
  if (!str || !String(str).trim()) return null;
  const sets = [];
  for (const part of String(str).split('+')) {
    const m = part.trim().match(/^(\d+)\s*[x×*]\s*\(?\s*(?:(\d+)\s*(?:[-–]\s*(\d+))?)?\s*\)?\s*(?:wdh\.?)?$/i);
    if (!m) return null;
    const n = Number(m[1]);
    if (n < 1 || n > 20) return null;
    const min = m[2] != null ? Number(m[2]) : null;
    const max = m[3] != null ? Number(m[3]) : min;
    if (min != null && max < min) return null;
    for (let i = 0; i < n; i++) sets.push({ min, max });
  }
  return sets.length ? sets : null;
}

export function rangeText(min, max) {
  if (min == null) return '';
  return min === max || max == null ? `${min}` : `${min}–${max}`;
}

function schemeBlocks(sets) {
  const blocks = [];
  for (const s of sets) {
    const last = blocks[blocks.length - 1];
    if (last && last.min === (s.min ?? null) && last.max === (s.max ?? null)) last.n++;
    else blocks.push({ n: 1, min: s.min ?? null, max: s.max ?? null });
  }
  return blocks;
}

// Anzeige: "2× 5–8 + 1× 8–12"
export function formatScheme(sets) {
  if (!sets?.length) return 'keine Sätze';
  return schemeBlocks(sets).map(b => (b.min == null ? `${b.n} ${b.n === 1 ? 'Satz' : 'Sätze'}` : `${b.n}× ${rangeText(b.min, b.max)}`)).join(' + ');
}

// Eingabefeld: "2x 5-8 + 1x 8-12"
export function schemeInput(sets) {
  if (!sets?.length) return '';
  return schemeBlocks(sets).map(b => (b.min == null ? `${b.n}x` : `${b.n}x ${b.min === b.max ? b.min : `${b.min}-${b.max}`}`)).join(' + ');
}

// Sätze kompakt: "63,5 kg × 9 · 7 · –"  bzw. "27,5 kg × 7  |  25 kg × 10 · 7"
export function setsSummary(sets) {
  const segs = [];
  for (const s of sets) {
    const r = s.r != null && s.r !== '' ? fmtNum(s.r) : '–';
    const w = s.w ?? null;
    const last = segs[segs.length - 1];
    if (last && (last.w === w || s.r == null)) last.reps.push(r);
    else segs.push({ w, reps: [r] });
  }
  return segs.map(g => (g.w != null ? `${fmtNum(g.w)} kg × ` : '') + g.reps.join(' · ') + (g.w == null ? ' Wdh' : '')).join('  |  ');
}

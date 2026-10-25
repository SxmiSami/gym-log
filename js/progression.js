// Verlauf, Bestwerte und Vorschläge (Doppel-Progression):
// Erst Wiederholungen im Zielbereich steigern, oben angekommen Gewicht erhöhen.

import * as store from './store.js';
import { fmtNum, rangeText, roundTo, clamp } from './util.js';

// Geschätztes 1RM nach Epley
export function e1rm(w, r) {
  if (!(w > 0) || !(r > 0)) return 0;
  return r === 1 ? w : w * (1 + r / 30);
}

// Alle abgeschlossenen Trainings mit dieser Übung, neueste zuerst
export function history(exId, { before = Infinity, excludeSessionId = null } = {}) {
  const out = [];
  for (const s of store.all('sessions')) {
    if (!s.finishedAt || s.id === excludeSessionId || s.startedAt >= before) continue;
    for (const e of s.entries) {
      if (e.exId === exId && e.sets.some(x => x.r > 0)) out.push({ session: s, entry: e });
    }
  }
  return out.sort((a, b) => b.session.startedAt - a.session.startedAt);
}

export function entryStats(entry) {
  const st = { sets: 0, volume: 0, reps: 0, maxW: 0, maxE: 0, bestR: 0, bestSet: null, heavySet: null };
  for (const s of entry.sets) {
    if (!(s.r > 0)) continue;
    const w = s.w || 0;
    st.sets++;
    st.reps += s.r;
    st.volume += w * s.r;
    if (w > 0 && (w > st.maxW || (w === st.maxW && s.r > st.heavySet.r))) { st.maxW = w; st.heavySet = s; }
    const e = e1rm(w, s.r);
    if (e > st.maxE) { st.maxE = e; st.bestSet = s; }
    if (s.r > st.bestR) st.bestR = s.r;
  }
  return st;
}

export function bests(hist) {
  const b = { maxW: 0, maxE: 0, maxR: 0, count: hist.length, heavy: null, best: null };
  for (const h of hist) {
    const st = entryStats(h.entry);
    if (st.maxW > b.maxW) { b.maxW = st.maxW; b.heavy = { set: st.heavySet, session: h.session }; }
    if (st.maxE > b.maxE) { b.maxE = st.maxE; b.best = { set: st.bestSet, session: h.session }; }
    if (st.bestR > b.maxR) b.maxR = st.bestR;
  }
  return b;
}

// Neuer Rekord gegenüber den bisherigen Bestwerten?
export function isPR(set, b) {
  if (!b.count || !(set.r > 0)) return false;
  if (set.w > 0) return set.w > b.maxW || e1rm(set.w, set.r) > b.maxE + 0.01;
  return b.maxW === 0 && set.r > b.maxR;
}

export function metricValue(entry, metric) {
  const st = entryStats(entry);
  switch (metric) {
    case 'e1rm': return Math.round(st.maxE * 10) / 10;
    case 'weight': return st.maxW;
    case 'volume': return Math.round(st.volume);
    case 'reps': return st.reps;
    case 'best': return st.bestR;
    default: return 0;
  }
}

export function incrementFor(exId) {
  const ex = store.getAny('exercises', exId);
  return ex?.increment > 0 ? ex.increment : store.settings().increment || 2.5;
}

const kg = w => `${fmtNum(w)} kg`;

function satzList(rows) {
  const idx = rows.map(r => r.i + 1);
  const consecutive = idx.every((n, k) => k === 0 || n === idx[k - 1] + 1);
  if (idx.length > 1 && consecutive) return `Satz ${idx[0]}–${idx[idx.length - 1]}`;
  return `Satz ${idx.join(', ')}`;
}

const inAll = n => (n === 1 ? '' : n === 2 ? 'in beiden Sätzen ' : `in allen ${n} Sätzen `);

// Vorschlag für die geplanten Sätze: [{ w, target }] + Begründungen.
// Sätze mit gleichem Zielbereich und gleichem Gewicht werden gemeinsam bewertet,
// so bekommt z. B. ein leichterer letzter Satz seinen eigenen Vorschlag.
export function suggest(exId, planned, opts = {}, hist = history(exId, opts)) {
  if (!hist.length) {
    const w = opts.startWeight ?? null;
    return {
      sets: planned.map(p => ({ w, target: p.min ?? null })),
      reasons: [w != null
        ? `Noch keine Daten – Startgewicht ${kg(w)} aus deinem Plan.`
        : 'Noch keine Daten – wähle ein Gewicht, mit dem du im Zielbereich landest.'],
    };
  }

  const inc = incrementFor(exId);
  const last = hist[0].entry.sets;
  const prev = hist[1]?.entry.sets || null;
  const fallbackW = [...last].reverse().find(s => s.w != null)?.w ?? null;

  const rows = planned.map((p, i) => {
    const ls = last[i];
    const r = ls && ls.r > 0 ? ls.r : null;
    const w = ls && ls.w != null ? ls.w : r != null ? null : fallbackW;
    return { i, min: p.min ?? null, max: p.max ?? null, w, r };
  });

  const groups = [];
  for (const r of rows) {
    let g = groups.find(x => x.min === r.min && x.max === r.max && x.w === r.w);
    if (!g) groups.push((g = { min: r.min, max: r.max, w: r.w, rows: [] }));
    g.rows.push(r);
  }

  const sets = [];
  const reasons = [];
  for (const g of groups) {
    const { min, max, w } = g;
    const n = g.rows.length;
    const done = g.rows.filter(r => r.r != null);
    const missing = g.rows.filter(r => r.r == null);
    const weighted = w > 0;
    const step = r => (r.r == null ? min : clamp(Math.floor(r.r) + 1, min, max));
    let newW = w;
    let targets;
    let why;

    if (min == null) {
      targets = g.rows.map(r => (r.r != null ? Math.floor(r.r) + 1 : null));
      why = 'Kein Zielbereich festgelegt – versuch, das letzte Mal um je 1 Wdh zu schlagen.';
    } else if (!missing.length && done.every(r => r.r >= max)) {
      if (weighted) {
        newW = roundTo(w + inc);
        targets = g.rows.map(() => min);
        why = `Letztes Mal ${inAll(n)}${max}+ Wdh geschafft → +${fmtNum(inc)} kg auf ${kg(newW)}. Ziel wieder ab ${min} Wdh.`;
      } else {
        targets = g.rows.map(r => Math.floor(r.r) + 1);
        why = `Obere Grenze (${max} Wdh) erreicht → mehr Wdh oder mit Zusatzgewicht steigern.`;
      }
    } else if (done.some(r => r.r < min)) {
      const worst = done.reduce((a, b) => (b.r < a.r ? b : a));
      const avg = done.reduce((sum, r) => sum + r.r, 0) / done.length;
      targets = g.rows.map(step);
      const prevBelow = prev && g.rows.some(r => {
        const ps = prev[r.i];
        return ps && ps.r > 0 && ps.r < min && (ps.w ?? null) === w;
      });
      // Bei mehreren Gruppen steht "Satz X:" schon davor
      const own = groups.length > 1 && n === 1;
      if (weighted && avg <= min - 2 && w - inc >= w * 0.85) {
        newW = roundTo(w - inc);
        targets = g.rows.map(() => min);
        const how = done.length > 1 ? `Im Schnitt nur ${fmtNum(avg, 1)} Wdh` : `Nur ${fmtNum(worst.r)} Wdh`;
        why = `${how} – deutlich unter ${min}. Etwas leichter (${kg(newW)}), damit du im Zielbereich trainierst.`;
      } else if (prevBelow) {
        why = weighted
          ? `Schon zum 2. Mal unter ${min} Wdh mit ${kg(w)}. Gewicht halten und an ${min} Wdh arbeiten – oder etwas leichter gehen.`
          : `Schon zum 2. Mal unter ${min} Wdh – weiter an ${min} Wdh arbeiten.`;
      } else {
        why = `${own ? 'Mit' : `Satz ${worst.i + 1} lag mit`} ${fmtNum(worst.r)} Wdh unter dem Ziel (${min}) → ${weighted ? 'Gewicht halten, ' : ''}Ziel: alle Sätze ab ${min} Wdh.`;
      }
    } else if (missing.length) {
      targets = g.rows.map(step);
      const who = groups.length > 1 && missing.length === n ? 'Fehlte' : `${satzList(missing)} ${missing.length > 1 ? 'fehlten' : 'fehlte'}`;
      why = `${who} letztes Mal → ${weighted ? 'Gewicht halten und ' : ''}diesmal alle Sätze schaffen.`;
    } else {
      targets = g.rows.map(step);
      why = `Im Zielbereich (${rangeText(min, max)}) → ${weighted ? 'Gewicht halten, ' : ''}je Satz +1 Wdh.`;
    }

    g.rows.forEach((r, k) => { sets[r.i] = { w: newW, target: targets[k] }; });
    reasons.push((groups.length > 1 ? `${satzList(g.rows)}: ` : '') + why);
  }
  return { sets, reasons };
}

// Verlauf, Bestwerte und Vorschläge (Doppel-Progression):
// Erst Wiederholungen im Zielbereich steigern, oben angekommen Gewicht erhöhen.

import * as store from './store.js';
import { fmtNum, rangeText, roundTo } from './util.js';

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

// Erwartete Wdh bei einem anderen Gewicht (Epley-Formel umgestellt), leicht vorsichtig gerundet
const repsAt = (e, w) => (w > 0 ? 30 * (e / w - 1) : 0);
const realistic = p => Math.max(1, Math.floor(p + 0.3));

// Mit gleichem Gewicht ermüdet man von Satz zu Satz: ein späterer Satz bekommt
// nie mehr Wdh als der davor.
function descending(arr) {
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[i - 1]) arr[i] = arr[i - 1];
  return arr;
}

// Verteilt `gain` zusätzliche Wdh auf ein abfallendes Profil: zuerst wird der
// größte Einbruch gegenüber dem vorherigen Satz aufgefüllt (bei Gleichstand der
// spätere), sonst Satz 1 gesteigert. Aus 8 · 8 · 7 wird 9 · 8 · 8, aus 11 · 9 · 9 wird 11 · 10 · 10.
function addReps(base, gain, cap) {
  const t = [...base];
  for (let k = 0; k < gain; k++) {
    let best = -1, bestGap = -1;
    t.forEach((v, i) => {
      const ceiling = i === 0 ? cap : Math.min(cap, t[i - 1]);
      if (v + 1 > ceiling) return;
      const gap = i === 0 ? 0 : t[i - 1] - v;
      if (gap >= bestGap) { best = i; bestGap = gap; }
    });
    if (best < 0) break;
    t[best]++;
  }
  return t;
}

// Vorschlag für die geplanten Sätze: [{ w, target }] + Begründungen.
// Sätze mit gleichem Zielbereich und gleichem Gewicht werden gemeinsam bewertet,
// so bekommt z. B. ein leichterer letzter Satz seinen eigenen Vorschlag.
// Die Ziel-Wdh fallen von Satz zu Satz ab (Ermüdung), gesteigert wird über die Summe.
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
    const cap = max ?? Infinity;
    const own = groups.length > 1 && n === 1; // "Satz X:" steht dann schon davor

    // Letztes Mal als abfallendes Profil (stärkster Satz zuerst),
    // fehlende Sätze knapp unter dem letzten geschafften
    const base = done.map(r => Math.min(Math.floor(r.r), cap)).sort((a, b) => b - a);
    while (base.length < n) base.push(base.length ? Math.max(1, base[base.length - 1] - 1) : min ?? 1);
    const lastSum = done.reduce((s, r) => s + Math.floor(r.r), 0);
    const progress = () => {
      const t = addReps(base, n >= 3 ? 2 : 1, cap);
      const sum = t.reduce((s, v) => s + v, 0);
      let txt;
      if (t.every(v => v >= cap)) txt = `Ziel: alle Sätze auf ${max} – dann kommt mehr Gewicht`;
      else if (sum > lastSum) txt = `insgesamt ${sum - lastSum} Wdh mehr als letztes Mal (${sum} statt ${lastSum})`;
      else txt = 'Wdh halten und gleichmäßiger verteilen';
      return { t, txt };
    };
    // Geschätztes 1RM je Satz (stärkster zuerst) – für den Wechsel auf ein anderes Gewicht
    const e = done.map(r => e1rm(w, r.r)).sort((a, b) => b - a);
    const predictAt = nw => {
      const t = e.map(x => Math.min(cap, realistic(repsAt(x, nw))));
      while (t.length < n) t.push(Math.max(1, t[t.length - 1] - 1));
      return descending(t);
    };
    const missingTxt = missing.length ? `${satzList(missing)} ${missing.length > 1 ? 'fehlten' : 'fehlte'}` : '';

    let newW = w;
    let targets;
    let why;

    if (min == null) {
      const p = progress();
      targets = p.t;
      why = `Kein Zielbereich festgelegt – ${p.txt}.`;
    } else if (!missing.length && done.every(r => r.r >= max)) {
      if (weighted) {
        newW = roundTo(w + inc);
        targets = predictAt(newW).map(v => Math.max(v, min));
        why = `Letztes Mal ${inAll(n)}${max}+ Wdh → +${fmtNum(inc)} kg auf ${kg(newW)}. Mit dem höheren Gewicht sind etwa ${targets.join(' · ')} Wdh realistisch.`;
      } else {
        targets = [...base];
        why = `Obere Grenze (${max} Wdh) erreicht → mehr Wdh oder eine schwerere Variante.`;
      }
    } else if (done.some(r => r.r < min)) {
      const worst = done.reduce((a, b) => (b.r < a.r ? b : a));
      const avg = done.reduce((sum, r) => sum + r.r, 0) / done.length;
      const prevBelow = prev && g.rows.some(r => {
        const ps = prev[r.i];
        return ps && ps.r > 0 && ps.r < min && (ps.w ?? null) === w;
      });
      // Deutlich zu schwer: das schwerste Gewicht suchen, mit dem der erste Satz
      // wieder im Zielbereich landet (höchstens 20 % leichter)
      let lighter = null;
      if (weighted && avg <= min - 2) {
        for (let nw = roundTo(w - inc); nw > 0 && nw >= w * 0.8; nw = roundTo(nw - inc)) {
          if (repsAt(e[0], nw) + 0.3 >= min) { lighter = nw; break; }
        }
      }
      if (lighter) {
        newW = lighter;
        targets = predictAt(newW);
        const how = done.length > 1 ? `Im Schnitt nur ${fmtNum(avg, 1)} Wdh` : `Nur ${fmtNum(worst.r)} Wdh`;
        why = `${how} mit ${kg(w)} – für ${rangeText(min, max)} Wdh zu schwer. Mit ${kg(newW)} sind etwa ${targets.join(' · ')} Wdh drin.`;
      } else {
        const below = `${own ? 'Mit' : `Satz ${worst.i + 1} lag mit`} ${fmtNum(worst.r)} Wdh unter dem Ziel (ab ${min})`;
        if (missing.length) {
          // erst wieder alle Sätze schaffen, bevor mehr Wdh dazukommen
          targets = [...base];
          why = `${below}, ${missingTxt} → ${weighted ? 'Gewicht halten und ' : ''}diesmal alle Sätze schaffen.`;
        } else {
          const p = progress();
          targets = p.t;
          if (prevBelow) {
            why = weighted
              ? `Schon zum 2. Mal unter ${min} Wdh mit ${kg(w)}. Gewicht halten und hocharbeiten: ${p.txt} – oder etwas leichter gehen.`
              : `Schon zum 2. Mal unter ${min} Wdh – weiter hocharbeiten: ${p.txt}.`;
          } else {
            why = `${below} → ${weighted ? 'Gewicht halten und ' : ''}hocharbeiten: ${p.txt}.`;
          }
        }
      }
    } else if (missing.length) {
      targets = [...base];
      const who = groups.length > 1 && missing.length === n ? 'Fehlte' : missingTxt;
      why = `${who} letztes Mal → ${weighted ? 'Gewicht halten und ' : ''}diesmal alle Sätze schaffen.`;
    } else {
      const p = progress();
      targets = p.t;
      why = `Im Zielbereich (${rangeText(min, max)}) → ${weighted ? 'Gewicht halten, ' : ''}${p.txt}.`;
    }

    g.rows.forEach((r, k) => { sets[r.i] = { w: newW, target: targets[k] ?? null }; });
    reasons.push((groups.length > 1 ? `${satzList(g.rows)}: ` : '') + why);
  }

  // Auch über Gruppen hinweg: gleiches Gewicht, gleicher Bereich → nicht mehr als der Satz davor
  for (let i = 1; i < sets.length; i++) {
    const a = sets[i - 1], b = sets[i];
    const sameRange = planned[i].min === planned[i - 1].min && planned[i].max === planned[i - 1].max;
    if (a && b && a.w === b.w && sameRange && b.target != null && a.target != null && b.target > a.target) b.target = a.target;
  }
  return { sets, reasons };
}

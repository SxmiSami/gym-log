// Streak: Trainings in Folge. Ruhetage laut Plan unterbrechen nicht, ein verpasster
// geplanter Trainingstag schon. Heute zählt erst als verpasst, wenn der Tag vorbei ist.

import * as store from './store.js';
import { isoFromDate, todayISO, dateFromISO, WD_SHORT } from './util.js';

const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export function streakInfo(todayIso = todayISO()) {
  // Wochentage, an denen laut Plan trainiert wird (z. B. Mo, Di, Do, Fr, Sa)
  const planned = new Set(store.all('days').map(d => d.weekday).filter(w => w != null));
  const trained = new Set(store.all('sessions').filter(s => s.finishedAt).map(s => s.date));
  const today = dateFromISO(todayIso);
  const dates = [...trained].sort();
  const first = dates.length ? dateFromISO(dates[0]) : null;

  // Ohne festen Wochenplan: Streak endet nach mehr als 7 Tagen ohne Training
  const missed = (d, gap) => (planned.size ? planned.has(d.getDay()) : gap > 7);

  let current = 0, best = 0, gap = 0;
  if (first) {
    for (let d = first; d <= today; d = addDays(d, 1)) {
      const iso = isoFromDate(d);
      if (trained.has(iso)) {
        current++;
        gap = 0;
      } else if (iso !== todayIso) {
        gap++;
        if (missed(d, gap)) current = 0;
      }
      best = Math.max(best, current);
    }
  }

  // aktuelle Woche Mo–So
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    const iso = isoFromDate(d);
    const isPlanned = planned.has(d.getDay());
    let state;
    if (trained.has(iso)) state = 'done';
    else if (iso === todayIso) state = isPlanned ? 'today' : 'off';
    else if (d > today) state = isPlanned ? 'planned' : 'off';
    else if (!first || d < first) state = 'off';
    else state = isPlanned ? 'missed' : 'off';
    return { iso, label: WD_SHORT[d.getDay()], state, isToday: iso === todayIso };
  });

  return {
    current, best, week,
    trainedToday: trained.has(todayIso),
    todayPlanned: planned.has(today.getDay()),
  };
}

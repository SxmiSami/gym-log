// Trainingspläne: mehrere Pläne mit eigenen Trainingstagen, einer davon ist aktiv.
// Die Pläne stehen in den Einstellungen (settings.plans), jeder Tag trägt seine planId.
// Werte und Verlauf hängen an der Übung, nicht am Plan – ein Wechsel löscht also nichts.
// Ältere App-Versionen übernehmen settings und Tage beim Sync unverändert.

import * as store from './store.js';

const DEFAULT_PLAN = { id: 'plan-1', name: 'Mein Plan' };

// Pause für Sätze, die der Partner im Block nicht mehr hat
export const EXTRA_SET_REST = 60;

export const plans = () => store.settings().plans || [];

export function activePlanId() {
  const list = plans();
  const id = store.settings().activePlanId;
  return list.some(p => p.id === id) ? id : list[0]?.id ?? null;
}

export const activePlan = () => plans().find(p => p.id === activePlanId()) || null;
export const planName = id => plans().find(p => p.id === id)?.name || '';

// Tage eines Plans (ohne Angabe: aktiver Plan). Ohne Pläne: alle Tage ohne Zuordnung.
export const planDays = (planId = activePlanId()) => store.all('days').filter(d => (d.planId ?? null) === planId);

export function ensurePlan() {
  const id = activePlanId();
  if (id) return id;
  store.setSettings({ plans: [{ ...DEFAULT_PLAN }], activePlanId: DEFAULT_PLAN.id });
  return DEFAULT_PLAN.id;
}

// Daten aus der Zeit vor den Plänen übernehmen: Tage ohne planId kommen in den
// ersten Plan, Tage mit unbekannter planId bekommen ihren Plan zurück.
// Zeitstempel steigen nur um 1 ms und die Zuordnung ist als automatisch markiert –
// jede echte Änderung (auch von einem anderen Gerät) gewinnt beim Sync.
export function migratePlans() {
  const settings = store.settings();
  let list = [...(settings.plans || [])];
  const days = Object.values(store.getData().days).filter(d => !d.purged);
  const known = new Set(list.map(p => p.id));
  const orphans = [...new Set(days.map(d => d.planId).filter(id => id && !known.has(id)))];
  const missing = days.filter(d => !d.planId);

  orphans.forEach(id => list.push({ id, name: `Plan ${list.length + 1}` }));
  if (missing.length && !list.length) list.push({ ...DEFAULT_PLAN, auto: true });
  for (const d of missing) store.putRaw('days', { ...d, planId: list[0].id, planAuto: true, updatedAt: (d.updatedAt || 0) + 1 });
  // automatisch angelegter Übergangsplan ohne Tage wird wieder entfernt
  const used = new Set(Object.values(store.getData().days).filter(d => !d.purged).map(d => d.planId));
  list = list.filter(p => !p.auto || used.has(p.id));

  const changed = JSON.stringify(list) !== JSON.stringify(settings.plans || []);
  if (changed) {
    const activePlanId = list.some(p => p.id === settings.activePlanId) ? settings.activePlanId : list[0]?.id ?? null;
    store.setSettingsRaw({ plans: list, activePlanId }, (settings.updatedAt || 0) + 1);
  }
  return changed || missing.length > 0;
}

// ---------- Blöcke (A1/A2 = Supersatz oder im Wechsel) ----------

// "A1" → "A"; Einzelübungen ("1", "C") haben keinen Partner
export const blockLetter = b => /^([A-Za-z])\d+$/.exec(String(b || '').trim())?.[1].toUpperCase() ?? null;

const partnersOf = (s, e) => {
  const letter = blockLetter(e.block);
  return letter ? s.entries.filter(x => x !== e && blockLetter(x.block) === letter) : [];
};

// Nächste Übung im selben Block (für "ohne Pause weiter")
export function nextInBlock(s, e) {
  const partners = partnersOf(s, e);
  const i = s.entries.indexOf(e);
  return partners.find(x => s.entries.indexOf(x) > i) || partners[0] || null;
}

// "Supersatz", "im Wechsel" oder '' für Einzelübungen
export function blockType(s, letter) {
  const members = s.entries.filter(x => blockLetter(x.block) === letter);
  if (members.length < 2) return '';
  return members.some(x => x.restSeconds === 0) ? 'Supersatz' : 'im Wechsel';
}

// Pause nach Satz i: Plan-Eintrag → Übung → Standard. Hat der Partner im Block
// keinen Satz mehr übrig, gibt es für die restlichen Sätze 60 s.
export function restFor(s, e, i) {
  const ex = store.get('exercises', e.exId);
  let rest = e.restSeconds ?? ex?.restSeconds ?? store.settings().restSeconds ?? 90;
  const partners = partnersOf(s, e);
  if (partners.length && i >= Math.max(...partners.map(x => x.sets.length))) rest = EXTRA_SET_REST;
  return rest;
}

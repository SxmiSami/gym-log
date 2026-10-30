// Lokaler Datenspeicher (offline-first). Jeder Datensatz hat eine id und
// updatedAt; gelöschte Datensätze bleiben als { deleted: true } erhalten,
// damit das Löschen auch auf anderen Geräten ankommt.

const DATA_KEY = 'gymlog.data.v1';
const LOCAL_KEY = 'gymlog.local.v1';

export const COLLECTIONS = ['exercises', 'days', 'sessions', 'body'];
// Bewusst ohne Standard für plans/activePlanId: Fehlt das Feld in einer
// Version (z. B. von einem Gerät mit älterer App), bleibt es beim Zusammenführen erhalten.
const DEFAULT_SETTINGS = { id: 'settings', restSeconds: 90, increment: 2.5, sound: true, updatedAt: 0 };

let lastTs = 0;
export function now() {
  lastTs = Math.max(Date.now(), lastTs + 1);
  return lastTs;
}

export function emptyData() {
  const d = { schema: 1, settings: { ...DEFAULT_SETTINGS } };
  for (const c of COLLECTIONS) d[c] = {};
  return d;
}

export function normalizeData(d) {
  const out = emptyData();
  if (!d || typeof d !== 'object') return out;
  for (const c of COLLECTIONS) if (d[c] && typeof d[c] === 'object') out[c] = { ...d[c] };
  out.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  return out;
}

function readJSON(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('Speichern fehlgeschlagen', e);
    emit('error', e);
    return false;
  }
}

const subs = { change: new Set(), remote: new Set(), error: new Set() };
export function on(evt, fn) {
  subs[evt].add(fn);
  return () => subs[evt].delete(fn);
}
function emit(evt, payload) {
  subs[evt]?.forEach(fn => fn(payload));
}

let data = normalizeData(readJSON(DATA_KEY, null));
let local = { theme: 'system', sync: null, lastSync: 0, dirty: false, changeSeq: 0, ...readJSON(LOCAL_KEY, {}) };

const persist = () => writeJSON(DATA_KEY, data);
const saveLocal = () => writeJSON(LOCAL_KEY, local);

function touched() {
  persist();
  local.dirty = true;
  local.changeSeq++;
  saveLocal();
  emit('change');
}

// ---------- Lesen ----------

export const getData = () => data;
export const isEmpty = () => COLLECTIONS.every(c => Object.keys(data[c]).length === 0);
export const all = c => Object.values(data[c]).filter(r => !r.deleted);
export function get(c, id) {
  const r = data[c][id];
  return r && !r.deleted ? r : null;
}
// auch gelöschte (z. B. Name einer gelöschten Übung im Verlauf)
export const getAny = (c, id) => data[c][id] || null;
export const settings = () => data.settings;

// ---------- Schreiben ----------

export function put(c, rec) {
  rec.updatedAt = now();
  data[c][rec.id] = rec;
  touched();
  return rec;
}

// Für Migrationen: Zeitstempel wird vom Aufrufer gesetzt (nicht "jetzt"),
// damit echte Änderungen von anderen Geräten beim Sync Vorrang haben
export function putRaw(c, rec) {
  data[c][rec.id] = rec;
  touched();
  return rec;
}

export function remove(c, id) {
  const r = data[c][id];
  if (!r) return;
  data[c][id] = { ...r, deleted: true, updatedAt: now() };
  touched();
}

// Papierkorb: gelöschte Datensätze behalten ihren Inhalt, bis sie endgültig gelöscht werden
export const trash = c => Object.values(data[c]).filter(r => r.deleted && !r.purged);

export function restore(c, id) {
  const r = data[c][id];
  if (!r?.deleted || r.purged) return;
  const { deleted, ...rest } = r;
  data[c][id] = { ...rest, updatedAt: now() };
  touched();
}

// Endgültig löschen: Inhalt weg, nur die Lösch-Markierung bleibt,
// damit der Datensatz auch auf den anderen Geräten verschwindet
export function purge(c, id) {
  if (!data[c][id]) return;
  data[c][id] = { id, deleted: true, purged: true, updatedAt: now() };
  touched();
}

export function setSettings(patch) {
  data.settings = { ...data.settings, ...patch, updatedAt: now() };
  touched();
}

export function setSettingsRaw(patch, updatedAt) {
  data.settings = { ...data.settings, ...patch, updatedAt };
  touched();
}

// ---------- Gerätespezifisch (wird nicht synchronisiert) ----------

export const getLocal = () => local;
export function setLocal(patch) {
  local = { ...local, ...patch };
  saveLocal();
}

// ---------- Zusammenführen ----------

// Pro Datensatz gewinnt die neuere Version.
export function merge(a, b) {
  const out = emptyData();
  for (const c of COLLECTIONS) {
    const ids = new Set([...Object.keys(a[c] || {}), ...Object.keys(b[c] || {})]);
    for (const id of ids) {
      const x = a[c]?.[id], y = b[c]?.[id];
      let win = !x ? y : !y ? x : (y.updatedAt || 0) > (x.updatedAt || 0) ? y : x;
      // Eine automatisch (per Migration) gesetzte Plan-Zuordnung verdrängt nie eine echte
      const other = win === x ? y : x;
      if (c === 'days' && win?.planAuto && other?.planId && !other.planAuto) win = { ...win, planId: other.planId, planAuto: false };
      out[c][id] = win;
    }
  }
  const bNewer = (b.settings?.updatedAt || 0) > (a.settings?.updatedAt || 0);
  const [older, newer] = bNewer ? [a.settings, b.settings] : [b.settings, a.settings];
  out.settings = { ...older, ...newer };
  // Pläne werden nie gelöscht – Liste vereinigen, damit keine Seite einen Plan verliert
  if (older?.plans || newer?.plans) {
    const plans = [...(newer?.plans || [])];
    for (const p of older?.plans || []) if (!plans.some(q => q.id === p.id)) plans.push(p);
    out.settings.plans = plans;
  }
  return out;
}

// true, wenn a etwas Neueres enthält als b
export function hasNewer(a, b) {
  for (const c of COLLECTIONS) {
    for (const [id, r] of Object.entries(a[c] || {})) {
      const o = b[c]?.[id];
      if (!o || (o.updatedAt || 0) < (r.updatedAt || 0)) return true;
    }
  }
  return (a.settings?.updatedAt || 0) > (b.settings?.updatedAt || 0);
}

// Ergebnis eines Syncs übernehmen (zählt nicht als lokale Änderung)
export function replaceFromSync(merged) {
  const changed = hasNewer(merged, data);
  data = merged;
  persist();
  if (changed) emit('remote');
}

// Backup- oder Startdaten-Datei einlesen
export function importData(obj) {
  data = merge(data, normalizeData(obj));
  touched();
  emit('remote');
}

// Sync über eine JSON-Datei in einem privaten GitHub-Repository.
// Ablauf: Datei holen → pro Datensatz zusammenführen → zurückschreiben (mit sha,
// damit sich zwei Geräte nicht gegenseitig überschreiben).

import * as store from './store.js';

const API = 'https://api.github.com';
const DEFAULT_PATH = 'gym-log-daten.json';

let status = { state: 'off', message: '' };
const listeners = new Set();
let running = null;
let timer = null;

export function onStatus(fn) {
  listeners.add(fn);
  fn(status);
}
function setStatus(state, message = '') {
  status = { state, message };
  listeners.forEach(fn => fn(status));
}
export const getStatus = () => status;

export function configured() {
  const s = store.getLocal().sync;
  return !!(s && s.repo && s.token);
}

export function refreshStatus() {
  if (status.state === 'syncing') return;
  if (!configured()) setStatus('off');
  else if (store.getLocal().dirty) setStatus('pending');
  else if (status.state !== 'error' && status.state !== 'offline') setStatus('ok');
}

export function syncSoon(delay = 10000) {
  if (!configured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), delay);
}

export function syncNow() {
  if (!configured()) {
    setStatus('off');
    return Promise.resolve({ ok: false, reason: 'off' });
  }
  if (!running) running = run().finally(() => { running = null; });
  return running;
}

class SyncError extends Error {}
const fail = msg => new SyncError(msg);

async function run() {
  clearTimeout(timer);
  if (!navigator.onLine) {
    setStatus('offline', 'Offline – wird synchronisiert, sobald du wieder Netz hast.');
    return { ok: false, reason: 'offline' };
  }
  const cfg = store.getLocal().sync;
  setStatus('syncing');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await fetchRemote(cfg);
      const remoteData = store.normalizeData(remote.data);
      const seq = store.getLocal().changeSeq;
      const merged = store.merge(store.getData(), remoteData);
      store.replaceFromSync(merged);
      if (!remote.data || store.hasNewer(merged, remoteData)) {
        const res = await putRemote(cfg, merged, remote.sha);
        if (res === 'conflict') continue;
      }
      const changedMeanwhile = store.getLocal().changeSeq !== seq;
      store.setLocal({ lastSync: Date.now(), dirty: changedMeanwhile, syncError: null });
      setStatus(changedMeanwhile ? 'pending' : 'ok');
      if (changedMeanwhile) syncSoon();
      return { ok: true };
    }
    throw fail('Konflikt beim Speichern – bitte gleich nochmal versuchen.');
  } catch (e) {
    const offline = e instanceof TypeError; // fetch ohne Verbindung
    const msg = offline ? 'Keine Verbindung zu GitHub – wird später erneut versucht.' : e.message;
    store.setLocal({ syncError: msg });
    setStatus(offline ? 'offline' : 'error', msg);
    return { ok: false, reason: msg };
  }
}

function headers(cfg, accept = 'application/vnd.github+json') {
  return { Authorization: `Bearer ${cfg.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
}

function contentsUrl(cfg) {
  const path = (cfg.path || DEFAULT_PATH).split('/').map(encodeURIComponent).join('/');
  return `${API}/repos/${cfg.repo}/contents/${path}`;
}

async function check(res) {
  if (res.ok) return;
  if (res.status === 401) throw fail('Token ungültig oder abgelaufen – bitte neuen Token eintragen.');
  if (res.status === 403) throw fail('Zugriff verweigert – braucht der Token „Contents: Read and write“?');
  throw fail(`GitHub meldet Fehler ${res.status}.`);
}

async function fetchRemote(cfg) {
  const url = contentsUrl(cfg);
  const res = await fetch(url, { headers: headers(cfg), cache: 'no-store' });
  if (res.status === 404) return { data: null, sha: null };
  await check(res);
  const j = await res.json();
  let text;
  if (j.encoding === 'base64' && j.content) {
    text = b64decode(j.content);
  } else {
    // Dateien über 1 MB liefert GitHub nur roh aus
    const raw = await fetch(url, { headers: headers(cfg, 'application/vnd.github.raw+json'), cache: 'no-store' });
    await check(raw);
    text = await raw.text();
  }
  try {
    return { data: JSON.parse(text), sha: j.sha };
  } catch {
    throw fail('Die Datei im Repository ist kein gültiges JSON.');
  }
}

async function putRemote(cfg, data, sha) {
  const body = { message: `Sync ${new Date().toLocaleString('de-DE')}`, content: b64encode(JSON.stringify(data)) };
  if (sha) body.sha = sha;
  const res = await fetch(contentsUrl(cfg), {
    method: 'PUT',
    headers: { ...headers(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409 || res.status === 422) return 'conflict';
  if (res.status === 404) throw fail('Repository nicht gefunden oder der Token darf dort nicht schreiben.');
  await check(res);
  return 'ok';
}

// Prüft Repository + Token, bevor sie gespeichert werden
export async function checkRepo(cfg) {
  try {
    const res = await fetch(`${API}/repos/${cfg.repo}`, { headers: headers(cfg), cache: 'no-store' });
    if (res.status === 404) return { ok: false, message: 'Repository nicht gefunden – Schreibweise prüfen und ob der Token Zugriff darauf hat.' };
    if (res.status === 401) return { ok: false, message: 'Token ungültig oder abgelaufen.' };
    if (!res.ok) return { ok: false, message: `GitHub meldet Fehler ${res.status}.` };
    const j = await res.json();
    return { ok: true, private: !!j.private };
  } catch {
    return { ok: false, message: 'Keine Verbindung zu GitHub.' };
  }
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

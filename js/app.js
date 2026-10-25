import * as store from './store.js';
import * as sync from './sync.js';
import * as timer from './timer.js';
import { history, suggest, bests, isPR, entryStats, metricValue } from './progression.js';
import { lineChart, sparkline, weekBars } from './charts.js';
import { icon } from './icons.js';
import {
  esc, uid, fmtNum, fmtBig, parseNum, todayISO, dateFromISO, fmtDate, relDays, relTime,
  fmtDuration, parseScheme, formatScheme, schemeInput, rangeText, setsSummary, fmtClock,
  WEEKDAYS, WD_SHORT, MONTHS,
} from './util.js';

const VERSION = '1.0.1';

const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $back = document.getElementById('back');
const $sync = document.getElementById('sync-btn');

const ui = { metric: {}, noteOpen: new Set(), sheet: null, pendingSheet: null, deferred: false, stack: [] };
let cleanups = [];

// ---------- Helfer ----------

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const byName = (a, b) => a.name.localeCompare(b.name, 'de');
const exName = id => store.getAny('exercises', id)?.name || 'Unbekannte Übung';
const fmtRest = s => (s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`);
const saveSession = s => store.put('sessions', s);
const nUebungen = n => `${n} ${n === 1 ? 'Übung' : 'Übungen'}`;

function activeSession() {
  return store.all('sessions').filter(s => !s.finishedAt).sort((a, b) => b.startedAt - a.startedAt)[0] || null;
}

function finishedSessions() {
  return store.all('sessions').filter(s => s.finishedAt).sort((a, b) => b.startedAt - a.startedAt);
}

function countSets(s) {
  let done = 0, total = 0;
  for (const e of s.entries) for (const x of e.sets) { total++; if (x.done) done++; }
  return { done, total };
}

function sessionStats(s) {
  let sets = 0, volume = 0;
  for (const e of s.entries) {
    const st = entryStats(e);
    sets += st.sets;
    volume += st.volume;
  }
  return {
    sets, volume,
    exercises: s.entries.filter(e => e.sets.some(x => x.r > 0)).length,
    duration: (s.finishedAt || Date.now()) - s.startedAt,
  };
}

function createExercise(name) {
  const ex = { id: uid(), name, increment: null, restSeconds: null, note: '' };
  store.put('exercises', ex);
  return ex.id;
}

function saveBody(date, kg) {
  const existing = store.all('body').find(b => b.date === date);
  store.put('body', existing ? { ...existing, kg } : { id: uid(), date, kg });
}

function isBusy() {
  const a = document.activeElement;
  return !!ui.sheet || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}

let toastTimer;
function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  el.className = 'toast ' + kind;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 250);
  }, 2800);
}

// ---------- Sheets (Dialoge von unten) ----------

function openSheet(html, opts = {}) {
  const root = document.getElementById('sheet-root');
  ui.sheet = { onClose: opts.onClose || null, onOk: opts.onOk || null, ctx: opts.ctx || {} };
  root.innerHTML = `<div class="sheet-backdrop" data-action="sheet-close"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
  root.hidden = false;
  requestAnimationFrame(() => root.classList.add('open'));
  if (opts.focus) setTimeout(() => root.querySelector(opts.focus)?.focus(), 80);
}

function closeSheet(silent = false) {
  if (!ui.sheet) return;
  const root = document.getElementById('sheet-root');
  const cb = silent ? null : ui.sheet.onClose;
  ui.sheet = null;
  root.classList.remove('open');
  setTimeout(() => {
    if (!ui.sheet) { root.hidden = true; root.innerHTML = ''; }
    if (ui.deferred && !isBusy()) { ui.deferred = false; rerender(); }
  }, 220);
  cb?.();
}

function confirmSheet(text, { ok = 'OK', danger = false, title = '' } = {}) {
  return new Promise(resolve => openSheet(`
    ${title ? `<h2 class="sheet-title">${esc(title)}</h2>` : ''}
    <p class="sheet-text">${esc(text)}</p>
    <div class="sheet-btns">
      <button class="btn ghost" data-action="sheet-close">Abbrechen</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-action="sheet-ok">${esc(ok)}</button>
    </div>`, { onClose: () => resolve(false), onOk: () => resolve(true) }));
}

function promptSheet(title, value = '', { placeholder = '', multiline = false, ok = 'Speichern', hint = '' } = {}) {
  return new Promise(resolve => openSheet(`
    <h2 class="sheet-title">${esc(title)}</h2>
    ${hint ? `<p class="sheet-text muted small">${esc(hint)}</p>` : ''}
    ${multiline
      ? `<textarea id="prompt-input" rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input id="prompt-input" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`}
    <div class="sheet-btns">
      <button class="btn ghost" data-action="sheet-close">Abbrechen</button>
      <button class="btn primary" data-action="sheet-ok">${esc(ok)}</button>
    </div>`, {
    onClose: () => resolve(null),
    onOk: () => resolve(document.getElementById('prompt-input').value),
    focus: '#prompt-input',
  }));
}

function pickExercise(title = 'Übung wählen') {
  return new Promise(resolve => openSheet(`
    <h2 class="sheet-title">${esc(title)}</h2>
    <div class="search-wrap">${icon('search')}<input class="search" data-bind="picker-search" placeholder="Suchen oder neue Übung eingeben …" autocomplete="off"></div>
    <div class="sheet-list picker-list" id="picker-list">${pickerList('')}</div>`,
  { onClose: () => resolve(null), ctx: { resolve } }));
}

function pickerList(q) {
  const t = q.trim().toLowerCase();
  const exs = store.all('exercises').sort(byName).filter(e => !t || e.name.toLowerCase().includes(t));
  let html = '';
  if (t && !exs.some(e => e.name.toLowerCase() === t)) {
    html += `<button class="sheet-item accent" data-action="picker-create" data-name="${esc(q.trim())}">${icon('plus')} „${esc(q.trim())}“ neu anlegen</button>`;
  }
  html += exs.map(e => `<button class="sheet-item" data-action="picker-pick" data-id="${e.id}">${esc(e.name)}</button>`).join('');
  return html || '<p class="empty small">Keine Übungen gefunden.</p>';
}

function pickerResolve(id) {
  const resolve = ui.sheet?.ctx.resolve;
  ui.sheet.onClose = null;
  closeSheet();
  resolve?.(id);
}

// ---------- Router ----------

const views = {
  '': viewHome, workout: viewWorkout, history: viewHistory, session: viewSession,
  progress: viewProgress, body: viewBody, exercise: viewExercise,
  plans: viewPlans, day: viewDay, exercises: viewExercises, settings: viewSettings,
};

function resolveRoute() {
  const [name = '', arg = null] = location.hash.replace(/^#\/?/, '').split('/');
  return views[name] ? { name, arg } : { name: '', arg: null };
}

function render(keepScroll = false) {
  cleanups.forEach(fn => fn());
  cleanups = [];
  if (!keepScroll && ui.sheet) closeSheet(true);
  const { name, arg } = resolveRoute();
  const y = window.scrollY;
  const v = views[name](arg);
  if (!v) return;
  $title.textContent = v.title;
  document.title = name === '' ? 'Gym Log' : `${v.title} · Gym Log`;
  $back.hidden = !v.back;
  $back.dataset.href = v.back || '';
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === v.tab));
  $view.innerHTML = v.html;
  v.mount?.();
  window.scrollTo(0, keepScroll ? y : 0);
  if (ui.pendingSheet) {
    const f = ui.pendingSheet;
    ui.pendingSheet = null;
    f();
  }
}
const rerender = () => render(true);

function notFound(msg, back) {
  return { title: 'Nicht gefunden', tab: '', back, html: `<p class="empty">${esc(msg)}</p>` };
}

function startClocks() {
  const tick = () => document.querySelectorAll('[data-clock]').forEach(el => {
    el.textContent = fmtClock(Date.now() - Number(el.dataset.clock));
  });
  tick();
  const iv = setInterval(tick, 1000);
  cleanups.push(() => clearInterval(iv));
}

function mountChart(points, unit) {
  const draw = () => {
    const el = document.getElementById('chart');
    if (el) el.innerHTML = lineChart(points, { width: el.clientWidth, unit });
  };
  draw();
  let t;
  const onResize = () => { clearTimeout(t); t = setTimeout(draw, 150); };
  window.addEventListener('resize', onResize);
  cleanups.push(() => window.removeEventListener('resize', onResize));
}

// ---------- Ansicht: Training (Start) ----------

function viewWelcome() {
  return {
    title: 'Training', tab: 'home',
    html: `<div class="card hero welcome">
        <div class="welcome-badge">${icon('dumbbell')}</div>
        <h2>Willkommen bei Gym Log</h2>
        <p class="muted">Auf diesem Gerät sind noch keine Daten. Wie möchtest du starten?</p>
      </div>
      <div class="card flush">
        <a class="list-row" href="#/settings">${icon('cloud')}<div class="grow"><strong>Sync einrichten</strong><span class="muted small">Schon auf einem anderen Gerät im Einsatz? Dann kommen deine Daten von dort.</span></div>${icon('chev', 'chev')}</a>
        <button class="list-row" data-action="import">${icon('upload')}<div class="grow"><strong>Daten importieren</strong><span class="muted small">Startdaten- oder Backup-Datei (.json) einlesen</span></div>${icon('chev', 'chev')}</button>
        <button class="list-row" data-action="add-day">${icon('plus')}<div class="grow"><strong>Ersten Trainingstag anlegen</strong><span class="muted small">Deinen Plan selbst Schritt für Schritt erstellen</span></div>${icon('chev', 'chev')}</button>
      </div>`,
  };
}

function viewHome() {
  if (store.isEmpty()) return viewWelcome();
  const act = activeSession();
  const days = store.all('days').sort(byOrder);
  const now = new Date();
  const wd = now.getDay();
  const today = days.find(d => d.weekday === wd);
  const lastBy = {};
  for (const s of finishedSessions()) if (s.dayId && !lastBy[s.dayId]) lastBy[s.dayId] = s;
  const next = !today && days.filter(d => d.weekday != null)
    .sort((a, b) => ((a.weekday - wd + 7) % 7) - ((b.weekday - wd + 7) % 7))[0];
  const dateLine = `${WEEKDAYS[wd]}, ${now.getDate()}. ${MONTHS[now.getMonth()]}`;

  let hero;
  if (act) {
    const { done, total } = countSets(act);
    hero = `<a class="card hero live" href="#/workout/${act.id}">
      <span class="eyebrow"><span class="pulse"></span>Training läuft</span>
      <h2>${esc(act.name)}</h2>
      <p class="muted"><span data-clock="${act.startedAt}"></span> · ${done}/${total} Sätze</p>
      <span class="btn primary block lg">Weiter trainieren</span></a>`;
  } else if (today) {
    const last = lastBy[today.id];
    hero = `<div class="card hero">
      <span class="eyebrow">${dateLine}</span>
      <h2>Heute: ${esc(today.name)}</h2>
      <p class="muted">${nUebungen(today.items.length)}${last ? ` · zuletzt ${relDays(last.date)}` : ''}</p>
      <button class="btn primary block lg" data-action="start-day" data-id="${today.id}">${icon('dumbbell')} Training starten</button></div>`;
  } else {
    hero = `<div class="card hero">
      <span class="eyebrow">${dateLine}</span>
      <h2>Heute ist Ruhetag</h2>
      <p class="muted">${next ? `Nächstes Training: <b>${esc(next.name)}</b> am ${WEEKDAYS[next.weekday]}.` : 'Lege unter „Pläne“ deine Trainingstage an.'}</p></div>`;
  }

  const rows = days.map(d => {
    const last = lastBy[d.id];
    const isToday = d.id === today?.id;
    return `<div class="day-row${isToday ? ' today' : ''}">
      <a class="day-info" href="#/day/${d.id}">
        <span class="eyebrow">${d.weekday != null ? WEEKDAYS[d.weekday] : 'Ohne festen Tag'}</span>
        <strong>${esc(d.name)}</strong>
        <span class="muted small">${nUebungen(d.items.length)} · ${last ? 'zuletzt ' + relDays(last.date) : 'noch nicht trainiert'}</span>
      </a>
      <button class="btn ${isToday && !act ? 'primary' : 'soft'}" data-action="start-day" data-id="${d.id}">Start</button>
    </div>`;
  }).join('');

  const bw = store.all('body').sort((a, b) => b.date.localeCompare(a.date));
  const todays = bw.find(b => b.date === todayISO());
  const bwCard = `<div class="card bw-card">
    <div class="row-between"><span class="eyebrow">${icon('scale')} Körpergewicht</span><a class="link small" href="#/body">Verlauf ${icon('chev')}</a></div>
    <p class="muted small">${bw[0] ? `Zuletzt ${fmtNum(bw[0].kg, 1)} kg · ${relDays(bw[0].date)}` : 'Noch kein Eintrag.'}</p>
    <div class="bw-input">
      <div class="with-unit grow"><input class="num left" id="bw-quick" inputmode="decimal" autocomplete="off" placeholder="${bw[0] ? fmtNum(bw[0].kg, 1) : 'kg'}" value="${todays ? fmtNum(todays.kg, 1) : ''}" aria-label="Körpergewicht heute"><span class="unit">kg</span></div>
      <button class="btn primary" data-action="bw-quick">${todays ? 'Ändern' : 'Eintragen'}</button>
    </div>
  </div>`;

  return {
    title: 'Training', tab: 'home', mount: startClocks,
    html: `${hero}
      <h3 class="section-label">Deine Trainingstage</h3>
      <div class="card flush">${rows || '<p class="empty">Noch keine Trainingstage.</p>'}</div>
      <button class="btn ghost block" data-action="start-empty">${icon('plus')} Freies Training</button>
      ${bwCard}`,
  };
}

// ---------- Ansicht: laufendes / bearbeitetes Training ----------

function newEntry(s, exId, planned, group, startWeight) {
  const sug = suggest(exId, planned, { before: s.startedAt, excludeSessionId: s.id, startWeight });
  return {
    id: uid(), exId, group: group || '', startWeight: startWeight ?? null, note: '',
    sets: planned.map((p, i) => ({ min: p.min ?? null, max: p.max ?? null, w: sug.sets[i]?.w ?? null, r: null, done: false })),
  };
}

async function startSession(dayId) {
  const act = activeSession();
  if (act) {
    if (await confirmSheet(`„${act.name}“ läuft noch. Willst du damit weitermachen?`, { ok: 'Weiter trainieren' })) {
      location.hash = '#/workout/' + act.id;
    }
    return;
  }
  const day = dayId ? store.get('days', dayId) : null;
  const s = {
    id: uid(), dayId: day?.id || null, name: day ? day.name : 'Freies Training',
    date: todayISO(), startedAt: Date.now(), finishedAt: null, note: '', entries: [],
  };
  if (day) {
    s.entries = day.items
      .filter(it => store.get('exercises', it.exId))
      .map(it => newEntry(s, it.exId, it.sets, it.group, it.startWeight));
  }
  saveSession(s);
  location.hash = '#/workout/' + s.id;
}

function viewWorkout(id) {
  const s = store.get('sessions', id);
  if (!s) return notFound('Training nicht gefunden.', '#/');
  const editing = !!s.finishedAt;
  const { done, total } = countSets(s);

  let body = '';
  let lastGroup = null;
  for (const e of s.entries) {
    if (e.group && e.group !== lastGroup) body += `<h3 class="section-label">${esc(e.group)}</h3>`;
    if (e.group) lastGroup = e.group;
    body += entryCard(s, e);
  }

  const head = `<div class="card wk-head">
      <div class="row-between">
        ${editing
          ? `<label class="date-field">${icon('calendar')}<input type="date" data-bind="session-date" value="${s.date}" max="${todayISO()}" aria-label="Datum"></label>`
          : `<span class="clock">${icon('timer')}<span data-clock="${s.startedAt}"></span></span>`}
        <span class="muted small" id="wk-progress">${done}/${total} Sätze</span>
      </div>
      <div class="progress"><span id="wk-bar" style="width:${total ? (done / total) * 100 : 0}%"></span></div>
    </div>`;

  const foot = `
    <button class="btn ghost block" data-action="add-exercise">${icon('plus')} Übung hinzufügen</button>
    <label class="field-block notes"><span class="label">Notiz zum Training</span>
      <textarea data-bind="session-note" rows="2" placeholder="Wie lief's? Energie, Schlaf, Schmerzen …">${esc(s.note || '')}</textarea></label>
    ${editing
      ? `<button class="btn primary block lg" data-action="done-edit">${icon('check')} Fertig</button>`
      : `<button class="btn primary block lg" data-action="finish">${icon('check')} Training beenden</button>
         <button class="btn text danger block" data-action="discard">Training verwerfen</button>`}`;

  return {
    title: s.name, tab: editing ? 'history' : 'home', back: editing ? `#/session/${s.id}` : '#/',
    html: `<div class="workout" data-session="${s.id}">${head}${body || '<p class="empty">Noch keine Übungen – füg unten eine hinzu.</p>'}${foot}</div>`,
    mount: startClocks,
  };
}

function entryCard(s, e) {
  const ex = store.getAny('exercises', e.exId);
  const opts = { before: s.startedAt, excludeSessionId: s.id, startWeight: e.startWeight };
  const hist = history(e.exId, opts);
  const last = hist[0];
  const sug = suggest(e.exId, e.sets, opts, hist);
  const b = bests(hist);
  const complete = e.sets.length > 0 && e.sets.every(x => x.done);
  const noteOpen = !!e.note || ui.noteOpen.has(e.id);
  const tipSets = sug.sets.map(x => ({ w: x?.w ?? null, r: x?.target ?? null }));
  const showTipSets = hist.length > 0 || e.startWeight != null;

  return `<article class="card ex-card${complete ? ' complete' : ''}" data-entry="${e.id}">
    <header class="ex-head">
      <div class="grow">
        <h3>${esc(ex?.name || 'Unbekannte Übung')}</h3>
        <span class="muted small">Ziel: ${formatScheme(e.sets)}</span>
      </div>
      <button class="icon-btn" data-action="entry-menu" aria-label="Optionen">${icon('dots')}</button>
    </header>
    ${ex?.note ? `<p class="ex-pin">${icon('info')}<span>${esc(ex.note)}</span></p>` : ''}
    ${last ? `<p class="ex-last"><span class="tag">Letztes Mal</span><span class="muted">${fmtDate(last.session.date)}</span><b>${setsSummary(last.entry.sets)}</b></p>` : ''}
    ${s.finishedAt ? '' : `<div class="ex-tip">
      <p class="tip-head">${icon('bulb')}<b>Vorschlag</b>${showTipSets ? `<span>${setsSummary(tipSets)}</span>` : ''}</p>
      <ul>${sug.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>`}
    <div class="sets">
      <div class="set-row set-head"><span>Satz</span><span>kg</span><span>Wdh</span><span></span></div>
      ${e.sets.map((x, i) => setRow(x, i, sug.sets[i], b)).join('')}
    </div>
    <div class="ex-actions">
      <button class="btn text" data-action="add-set">${icon('plus')} Satz</button>
      <button class="btn text" data-action="toggle-note">${icon('note')} Notiz</button>
    </div>
    ${noteOpen ? `<textarea class="ex-note" data-bind="entry-note" rows="2" placeholder="Notiz zu dieser Übung heute …">${esc(e.note || '')}</textarea>` : ''}
  </article>`;
}

function setRow(x, i, sg, b) {
  const target = sg?.target != null ? fmtNum(sg.target) : x.min != null ? String(x.min) : '';
  const pr = x.done && isPR(x, b);
  return `<div class="set-row${x.done ? ' done' : ''}${pr ? ' pr' : ''}" data-i="${i}">
    <span class="set-no"><b>${i + 1}</b>${pr ? `<small class="pr-tag">${icon('trophy')}PR</small>` : x.min != null ? `<small>${rangeText(x.min, x.max)}</small>` : ''}</span>
    <input class="num" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="next" data-bind="set-w" value="${x.w != null ? fmtNum(x.w) : ''}" placeholder="–" aria-label="Gewicht Satz ${i + 1} in kg">
    <input class="num" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" data-bind="set-r" value="${x.r != null ? fmtNum(x.r) : ''}" placeholder="${target}" aria-label="Wiederholungen Satz ${i + 1}">
    <button class="check" data-action="toggle-set" aria-label="Satz ${i + 1} abhaken" aria-pressed="${x.done}">${icon('check')}</button>
  </div>`;
}

function ctxOf(el) {
  const sid = el.closest('[data-session]')?.dataset.session || ui.sheet?.ctx.sid;
  const s = sid ? store.get('sessions', sid) : null;
  if (!s) return {};
  const eid = el.closest('[data-entry]')?.dataset.entry || ui.sheet?.ctx.eid;
  const e = eid ? s.entries.find(x => x.id === eid) : null;
  const row = el.closest('[data-i]');
  const i = row ? Number(row.dataset.i) : -1;
  return { s, e, i, row, set: e && i >= 0 ? e.sets[i] : null };
}

function refreshCard(s, e) {
  const card = $view.querySelector(`[data-entry="${e.id}"]`);
  if (card) card.outerHTML = entryCard(s, e);
  const { done, total } = countSets(s);
  const p = document.getElementById('wk-progress');
  if (p) p.textContent = `${done}/${total} Sätze`;
  const bar = document.getElementById('wk-bar');
  if (bar) bar.style.width = (total ? (done / total) * 100 : 0) + '%';
}

function sessionPRs(s) {
  const out = [];
  for (const e of s.entries) {
    const b = bests(history(e.exId, { before: s.startedAt, excludeSessionId: s.id }));
    if (!b.count) continue;
    const st = entryStats(e);
    const name = exName(e.exId);
    if (st.maxW > b.maxW) out.push(`${name}: ${fmtNum(st.maxW)} kg – neues Höchstgewicht`);
    else if (st.maxE > b.maxE + 0.01 && st.bestSet) out.push(`${name}: ${fmtNum(st.bestSet.w)} kg × ${fmtNum(st.bestSet.r)} – bester Satz bisher`);
    else if (!st.maxW && !b.maxW && st.bestR > b.maxR) out.push(`${name}: ${fmtNum(st.bestR)} Wdh – neuer Rekord`);
  }
  return out;
}

function summarySheet(s) {
  const st = sessionStats(s);
  const prs = sessionPRs(s);
  openSheet(`<div class="summary">
    <div class="summary-badge">${icon('trophy')}</div>
    <h2>Training gespeichert</h2>
    <p class="muted">${esc(s.name)} · ${fmtDate(s.date)}</p>
    <div class="stat-row">
      <div><b>${fmtDuration(st.duration)}</b><span>Dauer</span></div>
      <div><b>${st.sets}</b><span>Sätze</span></div>
      <div><b>${fmtBig(st.volume)}</b><span>kg Volumen</span></div>
    </div>
    ${prs.length ? `<h3 class="section-label">Neue Rekorde</h3><ul class="pr-list">${prs.map(p => `<li>${icon('trophy')}<span>${esc(p)}</span></li>`).join('')}</ul>` : ''}
    <button class="btn primary block lg" data-action="sheet-close">Fertig</button>
  </div>`);
}

async function finishSession(sid) {
  let s = store.get('sessions', sid);
  if (!s) return;
  const open = s.entries.reduce((n, e) => n + e.sets.filter(x => !x.done && x.r == null).length, 0);
  if (open && !(await confirmSheet(`${open} ${open === 1 ? 'Satz ist' : 'Sätze sind'} noch ohne Eintrag. Training trotzdem beenden?`, { ok: 'Beenden' }))) return;
  s = store.get('sessions', sid);
  s.entries.forEach(e => e.sets.forEach(x => { if (!x.done && x.r != null) x.done = true; }));
  s.finishedAt = Date.now();
  saveSession(s);
  timer.stop();
  ui.pendingSheet = () => summarySheet(store.get('sessions', sid));
  location.replace('#/session/' + sid);
  sync.syncNow();
}

// ---------- Ansicht: Verlauf ----------

function mondayOf(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

function viewHistory() {
  const list = finishedSessions();
  const thisMon = mondayOf(Date.now());
  const counts = Array(12).fill(0);
  for (const s of list) {
    const w = Math.round((thisMon - mondayOf(s.startedAt)) / (7 * 864e5));
    if (w >= 0 && w < 12) counts[11 - w]++;
  }
  const labels = counts.map((_, i) => {
    const d = new Date(thisMon - (11 - i) * 7 * 864e5);
    return `${d.getDate()}.${d.getMonth() + 1}.`;
  });
  const month = list.filter(s => s.date.slice(0, 7) === todayISO().slice(0, 7)).length;

  let html = `<div class="card">
    <div class="stat-row">
      <div><b>${counts[11]}</b><span>diese Woche</span></div>
      <div><b>${month}</b><span>diesen Monat</span></div>
      <div><b>${list.length}</b><span>gesamt</span></div>
    </div>
    ${weekBars(counts, labels)}
    <p class="muted small center">Trainings pro Woche</p>
  </div>`;

  let curMonth = '';
  let group = '';
  const flush = () => { if (group) html += `<div class="card flush">${group}</div>`; group = ''; };
  for (const s of list) {
    const d = dateFromISO(s.date);
    if (s.date.slice(0, 7) !== curMonth) {
      flush();
      curMonth = s.date.slice(0, 7);
      html += `<h3 class="section-label">${MONTHS[d.getMonth()]} ${d.getFullYear()}</h3>`;
    }
    const st = sessionStats(s);
    group += `<a class="list-row" href="#/session/${s.id}">
      <div class="date-badge"><b>${d.getDate()}</b><span>${WD_SHORT[d.getDay()]}</span></div>
      <div class="grow"><strong>${esc(s.name)}</strong><span class="muted small">${nUebungen(st.exercises)} · ${st.sets} Sätze${s.imported ? '' : ' · ' + fmtDuration(st.duration)}</span></div>
      ${s.imported ? '<span class="pill">Import</span>' : ''}${icon('chev', 'chev')}</a>`;
  }
  flush();
  if (!list.length) html += '<p class="empty">Noch keine Trainings. Starte dein erstes unter „Training“.</p>';
  return { title: 'Verlauf', tab: 'history', html };
}

function viewSession(id) {
  const s = store.get('sessions', id);
  if (!s) return notFound('Training nicht gefunden.', '#/history');
  if (!s.finishedAt) {
    location.replace('#/workout/' + s.id);
    return null;
  }
  const st = sessionStats(s);
  const entries = s.entries.map(e => {
    const b = bests(history(e.exId, { before: s.startedAt, excludeSessionId: s.id }));
    const any = e.sets.some(x => x.r > 0);
    const chips = e.sets.map(x => {
      if (!(x.r > 0)) return '<span class="chip skip">–</span>';
      const pr = isPR(x, b);
      return `<span class="chip${pr ? ' pr' : ''}">${x.w > 0 ? `${fmtNum(x.w)} × ${fmtNum(x.r)}` : `${fmtNum(x.r)} Wdh`}${pr ? icon('trophy') : ''}</span>`;
    }).join('');
    return `<div class="detail-ex">
      <a class="row-between" href="#/exercise/${e.exId}"><strong>${esc(exName(e.exId))}</strong><span class="muted small">${any ? formatScheme(e.sets) : 'übersprungen'}</span></a>
      ${any ? `<div class="chips">${chips}</div>` : ''}
      ${e.note ? `<p class="note-text">${icon('note')}<span>${esc(e.note)}</span></p>` : ''}
    </div>`;
  }).join('');

  return {
    title: s.name, tab: 'history', back: '#/history',
    html: `<div class="card">
        <span class="eyebrow">${fmtDate(s.date, { year: true })}${s.imported ? ' · aus deiner Liste' : ''}</span>
        <div class="stat-row">
          ${s.imported ? '' : `<div><b>${fmtDuration(st.duration)}</b><span>Dauer</span></div>`}
          <div><b>${st.sets}</b><span>Sätze</span></div>
          <div><b>${fmtBig(st.volume)}</b><span>kg Volumen</span></div>
        </div>
        ${s.note ? `<p class="note-text">${icon('note')}<span>${esc(s.note)}</span></p>` : ''}
      </div>
      <div class="card">${entries || '<p class="empty">Keine Übungen.</p>'}<p class="muted small">Gewicht (kg) × Wiederholungen</p></div>
      <div class="btn-row">
        <a class="btn ghost grow" href="#/workout/${s.id}">${icon('note')} Bearbeiten</a>
        <button class="btn ghost danger-text" data-action="delete-session" data-id="${s.id}">${icon('trash')} Löschen</button>
      </div>`,
  };
}

// ---------- Ansicht: Fortschritt ----------

const progressTabs = cur => `<div class="seg">${[['exercises', 'Übungen', '#/progress'], ['body', 'Körpergewicht', '#/body']]
  .map(([k, l, h]) => `<a class="${k === cur ? 'active' : ''}" href="${h}">${l}</a>`).join('')}</div>`;

function viewProgress() {
  const rows = store.all('exercises').map(ex => ({ ex, h: history(ex.id) }));
  const trained = rows.filter(r => r.h.length).sort((a, b) => b.h[0].session.startedAt - a.h[0].session.startedAt);
  const fresh = rows.filter(r => !r.h.length).sort((a, b) => byName(a.ex, b.ex));
  const row = ({ ex, h }) => {
    const weighted = h.some(x => x.entry.sets.some(s => s.w > 0));
    const series = h.slice(0, 12).reverse().map(x => metricValue(x.entry, weighted ? 'e1rm' : 'reps'));
    return `<a class="list-row" href="#/exercise/${ex.id}" data-name="${esc(ex.name.toLowerCase())}">
      <div class="grow"><strong>${esc(ex.name)}</strong><span class="muted small">${h[0] ? `${setsSummary(h[0].entry.sets)} · ${relDays(h[0].session.date)}` : 'Noch nicht trainiert'}</span></div>
      ${sparkline(series)}${icon('chev', 'chev')}</a>`;
  };
  return {
    title: 'Fortschritt', tab: 'progress',
    html: `${progressTabs('exercises')}
      <div class="search-wrap">${icon('search')}<input class="search" data-bind="ex-search" placeholder="Übung suchen …" autocomplete="off"></div>
      ${trained.length ? `<div class="card flush">${trained.map(row).join('')}</div>` : '<p class="empty">Noch keine Trainingsdaten.</p>'}
      ${fresh.length ? `<h3 class="section-label">Noch keine Daten</h3><div class="card flush">${fresh.map(row).join('')}</div>` : ''}`,
  };
}

function viewExercise(id) {
  const ex = store.getAny('exercises', id);
  if (!ex) return notFound('Übung nicht gefunden.', '#/progress');
  const h = history(id);
  const chrono = [...h].reverse();
  const weighted = !h.length || h.some(x => x.entry.sets.some(s => s.w > 0));
  const metrics = weighted
    ? [['e1rm', '1RM'], ['weight', 'Gewicht'], ['volume', 'Volumen']]
    : [['reps', 'Wdh gesamt'], ['best', 'Bester Satz']];
  const m = metrics.some(x => x[0] === ui.metric[id]) ? ui.metric[id] : metrics[0][0];
  const unit = m === 'reps' || m === 'best' ? 'Wdh' : 'kg';
  const points = chrono.map(x => ({ x: x.session.startedAt, y: metricValue(x.entry, m) }));
  const b = bests(h);
  const usedIn = store.all('days').filter(d => d.items.some(it => it.exId === id)).sort(byOrder).map(d => d.name);
  const lastTxt = h[0] ? 'zuletzt ' + relDays(h[0].session.date) : '';
  const tiles = weighted
    ? [
      ['Höchstgewicht', b.heavy ? `${fmtNum(b.maxW)} kg` : '–', b.heavy ? `× ${fmtNum(b.heavy.set.r)} · ${fmtDate(b.heavy.session.date, { weekday: false })}` : ''],
      ['Gesch. 1RM', b.best ? `${fmtNum(b.maxE, 1)} kg` : '–', b.best ? `aus ${fmtNum(b.best.set.w)} × ${fmtNum(b.best.set.r)}` : ''],
      ['Trainings', String(h.length), lastTxt],
    ]
    : [['Beste Wdh', b.maxR ? fmtNum(b.maxR) : '–', ''], ['Trainings', String(h.length), lastTxt]];
  const histRows = h.map(x => `<a class="list-row" href="#/session/${x.session.id}">
      <div class="grow"><strong>${fmtDate(x.session.date)}</strong><span class="muted small">${esc(x.session.name)}</span></div>
      <span class="sets-text">${setsSummary(x.entry.sets)}</span></a>`).join('');
  const st = store.settings();
  const restOpts = [['', `Standard (${fmtRest(st.restSeconds)})`], ...[45, 60, 75, 90, 120, 150, 180, 240, 300].map(s => [String(s), fmtRest(s)])];

  return {
    title: ex.name, tab: 'progress', back: '#/progress',
    mount: () => mountChart(points, unit),
    html: `<div class="card">
        <div class="seg small">${metrics.map(([k, l]) => `<button class="${k === m ? 'active' : ''}" data-action="metric" data-ex="${id}" data-m="${k}">${l}</button>`).join('')}</div>
        <div id="chart" class="chart-wrap"></div>
        ${m === 'e1rm' ? '<p class="hint">Geschätztes Maximalgewicht für eine Wiederholung – so werden Sätze mit unterschiedlich vielen Wdh vergleichbar.</p>' : ''}
      </div>
      <div class="tiles">${tiles.map(([l, v, sub]) => `<div class="tile"><span class="eyebrow">${l}</span><b>${v}</b><span class="muted small">${sub}</span></div>`).join('')}</div>
      <h3 class="section-label">Verlauf</h3>
      <div class="card flush">${histRows || '<p class="empty">Noch nicht trainiert.</p>'}</div>
      <h3 class="section-label">Einstellungen</h3>
      <div class="card form" data-ex="${id}">
        <label class="field-block"><span class="label">Name</span><input data-bind="ex-name" value="${esc(ex.name)}"></label>
        <div class="two">
          <label class="field-block"><span class="label">Gewichts-Schritt</span>
            <span class="with-unit"><input class="num left" data-bind="ex-inc" inputmode="decimal" value="${fmtNum(ex.increment)}" placeholder="${fmtNum(st.increment)}"><span class="unit">kg</span></span></label>
          <label class="field-block"><span class="label">Pause</span>
            <select data-bind="ex-rest">${restOpts.map(([v, l]) => `<option value="${v}"${String(ex.restSeconds ?? '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <label class="field-block"><span class="label">Dauerhafte Notiz</span>
          <textarea data-bind="ex-note" rows="2" placeholder="z. B. Sitzhöhe 4, Griff eng">${esc(ex.note || '')}</textarea></label>
        <p class="hint">${usedIn.length ? `In deinen Plänen: ${usedIn.map(esc).join(', ')}` : 'In keinem Plan.'}</p>
      </div>
      ${ex.deleted ? '' : `<button class="btn text danger block" data-action="delete-exercise" data-id="${id}">${icon('trash')} Übung löschen</button>`}`,
  };
}

function viewBody() {
  const list = store.all('body').sort((a, b) => b.date.localeCompare(a.date));
  const last = list[0];
  const ref = list.find(b => (dateFromISO(todayISO()) - dateFromISO(b.date)) / 864e5 >= 28);
  const delta = last && ref && ref !== last ? last.kg - ref.kg : null;
  const points = [...list].reverse().map(b => ({ x: dateFromISO(b.date).getTime(), y: b.kg }));
  const rows = list.map(b => `<div class="list-row">
      <div class="grow"><strong>${fmtNum(b.kg, 1)} kg</strong><span class="muted small">${fmtDate(b.date, { year: true })}</span></div>
      <button class="icon-btn" data-action="bw-delete" data-id="${b.id}" aria-label="Eintrag löschen">${icon('trash')}</button></div>`).join('');
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';

  return {
    title: 'Körpergewicht', tab: 'progress', mount: () => mountChart(points, 'kg'),
    html: `${progressTabs('body')}
      <div class="card form">
        <div class="bw-add">
          <label class="field-block"><span class="label">Datum</span><input type="date" id="bw-date" value="${todayISO()}" max="${todayISO()}"></label>
          <label class="field-block"><span class="label">Gewicht</span>
            <span class="with-unit"><input class="num left" id="bw-kg" inputmode="decimal" autocomplete="off" placeholder="${last ? fmtNum(last.kg, 1) : 'z. B. 80,5'}"><span class="unit">kg</span></span></label>
          <button class="btn primary" data-action="bw-add">Eintragen</button>
        </div>
      </div>
      <div class="card">
        <div class="stat-row">
          <div><b>${last ? fmtNum(last.kg, 1) : '–'}</b><span>aktuell (kg)</span></div>
          <div><b>${delta != null ? `${sign}${fmtNum(Math.abs(delta), 1)}` : '–'}</b><span>vs. vor 4 Wochen</span></div>
          <div><b>${list.length}</b><span>Einträge</span></div>
        </div>
        <div id="chart" class="chart-wrap"></div>
      </div>
      ${rows ? `<div class="card flush">${rows}</div>` : ''}`,
  };
}

// ---------- Ansicht: Pläne ----------

function viewPlans() {
  const days = store.all('days').sort(byOrder);
  const rows = days.map((d, i) => {
    const groups = [...new Set(d.items.map(it => it.group).filter(Boolean))];
    return `<div class="day-row">
      <a class="day-info" href="#/day/${d.id}">
        <span class="eyebrow">${d.weekday != null ? WEEKDAYS[d.weekday] : 'Ohne festen Tag'}</span>
        <strong>${esc(d.name)}</strong>
        <span class="muted small">${nUebungen(d.items.length)}${groups.length ? ' · ' + groups.map(esc).join(', ') : ''}</span>
      </a>
      <div class="mini-btns">
        <button class="icon-btn" data-action="day-move" data-id="${d.id}" data-dir="-1"${i === 0 ? ' disabled' : ''} aria-label="Nach oben">${icon('up')}</button>
        <button class="icon-btn" data-action="day-move" data-id="${d.id}" data-dir="1"${i === days.length - 1 ? ' disabled' : ''} aria-label="Nach unten">${icon('down')}</button>
      </div>
    </div>`;
  }).join('');
  return {
    title: 'Pläne', tab: 'plans',
    html: `<div class="card flush">${rows || '<p class="empty">Noch keine Trainingstage.</p>'}</div>
      <button class="btn ghost block" data-action="add-day">${icon('plus')} Trainingstag hinzufügen</button>
      <a class="btn ghost block" href="#/exercises">${icon('list')} Alle Übungen verwalten</a>`,
  };
}

function viewDay(id) {
  const d = store.get('days', id);
  if (!d) return notFound('Trainingstag nicht gefunden.', '#/plans');
  const groups = [...new Set(store.all('days').flatMap(x => x.items.map(it => it.group)).filter(Boolean))];
  const wdOpts = [['', 'Kein fester Tag'], ...[1, 2, 3, 4, 5, 6, 0].map(n => [String(n), WEEKDAYS[n]])];
  const items = d.items.map((it, i) => `<div class="card item-card" data-item="${it.id}">
      <div class="item-top">
        <span class="item-no">${i + 1}</span>
        <button class="item-ex" data-action="item-exercise"><span>${esc(exName(it.exId))}</span>${icon('chev')}</button>
        <button class="icon-btn" data-action="item-move" data-dir="-1"${i === 0 ? ' disabled' : ''} aria-label="Nach oben">${icon('up')}</button>
        <button class="icon-btn" data-action="item-move" data-dir="1"${i === d.items.length - 1 ? ' disabled' : ''} aria-label="Nach unten">${icon('down')}</button>
        <button class="icon-btn danger-text" data-action="item-remove" aria-label="Aus dem Plan entfernen">${icon('x')}</button>
      </div>
      <div class="item-fields">
        <label class="field-block"><span class="label">Gruppe</span><input data-bind="item-group" value="${esc(it.group || '')}" placeholder="z. B. Brust" list="group-list"></label>
        <label class="field-block"><span class="label">Sätze × Wdh</span><input data-bind="item-scheme" value="${esc(schemeInput(it.sets))}" placeholder="3x 8-12" autocapitalize="off" autocorrect="off" spellcheck="false"><small class="scheme-preview">${formatScheme(it.sets)}</small></label>
        <label class="field-block"><span class="label">Startgewicht</span><span class="with-unit"><input class="num left" data-bind="item-start" inputmode="decimal" value="${fmtNum(it.startWeight)}" placeholder="optional"><span class="unit">kg</span></span></label>
      </div>
    </div>`).join('');

  return {
    title: d.name, tab: 'plans', back: '#/plans',
    html: `<div data-day="${id}">
        <div class="card form">
          <div class="two">
            <label class="field-block"><span class="label">Name</span><input data-bind="day-name" value="${esc(d.name)}"></label>
            <label class="field-block"><span class="label">Wochentag</span><select data-bind="day-weekday">${wdOpts.map(([v, l]) => `<option value="${v}"${String(d.weekday ?? '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          </div>
        </div>
        <h3 class="section-label">Übungen</h3>
        ${items || '<p class="empty">Noch keine Übungen in diesem Plan.</p>'}
        <datalist id="group-list">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
        <button class="btn ghost block" data-action="add-item">${icon('plus')} Übung hinzufügen</button>
        <p class="hint">Sätze schreibst du wie in deiner Liste: <code>3x 8-12</code>, <code>2x 5-8 + 1x 8-12</code>, <code>3x 25</code> oder nur <code>3x</code>. Das Startgewicht wird nur genutzt, solange es für die Übung noch keine Daten gibt.</p>
        <button class="btn soft block" data-action="start-day" data-id="${id}">${icon('dumbbell')} Diesen Tag jetzt trainieren</button>
        <button class="btn text danger block" data-action="delete-day" data-id="${id}">${icon('trash')} Trainingstag löschen</button>
      </div>`,
  };
}

function viewExercises() {
  const uses = {};
  store.all('days').forEach(d => d.items.forEach(it => { uses[it.exId] = (uses[it.exId] || 0) + 1; }));
  const rows = store.all('exercises').sort(byName).map(e => `<a class="list-row" href="#/exercise/${e.id}" data-name="${esc(e.name.toLowerCase())}">
      <div class="grow"><strong>${esc(e.name)}</strong><span class="muted small">${uses[e.id] ? `in ${uses[e.id]} ${uses[e.id] === 1 ? 'Plan' : 'Plänen'}` : 'in keinem Plan'}</span></div>
      ${icon('chev', 'chev')}</a>`).join('');
  return {
    title: 'Übungen', tab: 'plans', back: '#/plans',
    html: `<div class="search-wrap">${icon('search')}<input class="search" data-bind="ex-search" placeholder="Übung suchen …" autocomplete="off"></div>
      <div class="card flush">${rows || '<p class="empty">Noch keine Übungen.</p>'}</div>
      <button class="btn ghost block" data-action="new-exercise">${icon('plus')} Neue Übung</button>`,
  };
}

// ---------- Ansicht: Mehr / Einstellungen ----------

function statusText() {
  const st = sync.getStatus();
  const loc = store.getLocal();
  switch (st.state) {
    case 'off': return 'Nicht eingerichtet – deine Daten liegen nur auf diesem Gerät.';
    case 'syncing': return 'Synchronisiere …';
    case 'pending': return 'Änderungen warten auf den nächsten Sync.';
    case 'offline': return st.message || 'Offline.';
    case 'error': return st.message || 'Fehler beim Sync.';
    default: return `Synchronisiert${loc.lastSync ? ' · ' + relTime(loc.lastSync) : ''}.`;
  }
}

function renderSyncBtn(st) {
  const map = { off: 'cloudOff', syncing: 'refresh', pending: 'cloudUp', offline: 'cloudOff', error: 'alert', ok: 'cloudCheck' };
  $sync.innerHTML = icon(map[st.state] || 'cloud');
  $sync.className = 'icon-btn sync-btn s-' + st.state;
  $sync.title = statusText();
  $sync.setAttribute('aria-label', 'Sync: ' + statusText());
}

function viewSettings() {
  const st = store.settings();
  const loc = store.getLocal();
  const cfg = loc.sync || {};
  const on = sync.configured();
  const theme = loc.theme || 'system';
  const rest = [45, 60, 75, 90, 120, 150, 180, 240, 300];
  return {
    title: 'Mehr', tab: 'settings',
    html: `<h3 class="section-label">Synchronisierung</h3>
      <div class="card form">
        <p class="status-line s-${sync.getStatus().state}" id="sync-status">${esc(statusText())}</p>
        <label class="field-block"><span class="label">Privates GitHub-Repository</span>
          <input id="sync-repo" value="${esc(cfg.repo || '')}" placeholder="benutzername/gym-daten" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <label class="field-block"><span class="label">Zugriffs-Token</span>
          <input id="sync-token" type="password" value="${esc(cfg.token || '')}" placeholder="github_pat_…" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off"></label>
        <div class="btn-row">
          <button class="btn primary grow" data-action="sync-save">${on ? 'Speichern & synchronisieren' : 'Sync einrichten'}</button>
          ${on ? `<button class="btn soft" data-action="sync-now" aria-label="Jetzt synchronisieren">${icon('refresh')}</button>` : ''}
        </div>
        ${on ? '<button class="btn text danger block" data-action="sync-off">Sync auf diesem Gerät trennen</button>' : ''}
        <details class="help"${on ? '' : ' open'}><summary>Einrichtung – Schritt für Schritt</summary>
          <ol>
            <li>Auf <b>github.com</b> anmelden (oder kostenlos registrieren).</li>
            <li>Neues Repository anlegen, z. B. <code>gym-daten</code>, auf <b>Private</b> stellen und „Add a README file“ anhaken.</li>
            <li>Token erstellen: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a>
              <br>· Repository access: <i>Only select repositories</i> → <code>gym-daten</code>
              <br>· Permissions → Repository permissions → <i>Contents</i>: <b>Read and write</b>
              <br>· Ablaufdatum möglichst lang wählen</li>
            <li>Hier <code>benutzername/gym-daten</code> und den Token eintragen.</li>
            <li>Auf iPad und PC genauso eintragen – fertig.</li>
          </ol>
          <p class="hint">Der Token bleibt nur auf diesem Gerät. Ohne Netz speichert die App alles lokal und gleicht ab, sobald du wieder online bist.</p>
        </details>
      </div>

      <h3 class="section-label">Training</h3>
      <div class="card form">
        <label class="row-field"><span>Standard-Pause</span>
          <select data-bind="set-rest">${rest.map(s => `<option value="${s}"${st.restSeconds === s ? ' selected' : ''}>${fmtRest(s)}</option>`).join('')}</select></label>
        <label class="row-field"><span>Ton am Pausenende</span><input type="checkbox" class="switch" data-bind="set-sound"${st.sound !== false ? ' checked' : ''}></label>
        <label class="row-field"><span>Gewichts-Schritt</span>
          <span class="with-unit sm"><input class="num left" data-bind="set-inc" inputmode="decimal" value="${fmtNum(st.increment)}"><span class="unit">kg</span></span></label>
        <p class="hint">Pause und Schritt kannst du pro Übung ändern (Fortschritt → Übung → Einstellungen). Auf dem iPhone kommt der Ton nur, solange die App offen ist und der Stumm-Schalter aus ist.</p>
      </div>

      <h3 class="section-label">Darstellung</h3>
      <div class="card"><div class="seg">${[['system', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']]
        .map(([k, l]) => `<button class="${theme === k ? 'active' : ''}" data-action="theme" data-v="${k}">${l}</button>`).join('')}</div></div>

      <h3 class="section-label">Daten</h3>
      <div class="card flush">
        <a class="list-row" href="#/exercises">${icon('list')}<div class="grow"><strong>Übungen verwalten</strong></div>${icon('chev', 'chev')}</a>
        <button class="list-row" data-action="export">${icon('download')}<div class="grow"><strong>Backup exportieren</strong><span class="muted small">Alle Daten als JSON-Datei</span></div></button>
        <button class="list-row" data-action="import">${icon('upload')}<div class="grow"><strong>Daten importieren</strong><span class="muted small">Backup oder Startdaten – wird mit den vorhandenen Daten zusammengeführt</span></div></button>
      </div>

      <h3 class="section-label">Als App installieren</h3>
      <div class="card">
        <p class="small"><b>iPhone & iPad:</b> In Safari öffnen → Teilen-Symbol → „Zum Home-Bildschirm“.</p>
        <p class="small"><b>PC:</b> In Chrome oder Edge auf das Installieren-Symbol rechts in der Adressleiste klicken.</p>
      </div>
      <p class="muted small center">Gym Log ${VERSION}</p>`,
  };
}

function applyTheme() {
  const t = store.getLocal().theme;
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t;
  else delete root.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0e1013' : '#f3f4f6');
}

async function importFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  let obj;
  try {
    obj = JSON.parse(await file.text());
    if (!obj || typeof obj !== 'object' || !('sessions' in obj || 'exercises' in obj)) throw new Error('kein Backup');
  } catch {
    return toast('Die Datei ist keine gültige Gym-Log-Datei.', 'error');
  }
  const n = k => Object.values(obj[k] || {}).filter(r => !r.deleted).length;
  const what = `${n('days')} Trainingstage, ${n('exercises')} Übungen, ${n('sessions')} Trainings`;
  if (!(await confirmSheet(`„${file.name}“ einlesen (${what})? Vorhandene Daten bleiben erhalten, neuere Einträge gewinnen.`, { ok: 'Importieren' }))) return;
  store.importData(obj);
  toast('Daten importiert');
}

// ---------- Aktionen (Klicks) ----------

const exOf = el => store.getAny('exercises', el.closest('[data-ex]')?.dataset.ex);
const dayOf = el => store.get('days', el.closest('[data-day]')?.dataset.day);
function itemOf(el) {
  const d = dayOf(el);
  const itemId = el.closest('[data-item]')?.dataset.item;
  const idx = d ? d.items.findIndex(x => x.id === itemId) : -1;
  return { d, it: idx >= 0 ? d.items[idx] : null, idx };
}

async function syncWithToast() {
  const r = await sync.syncNow();
  if (r.ok) toast('Synchronisiert');
  else if (r.reason !== 'off') toast(r.reason === 'offline' ? 'Offline – wird später synchronisiert' : r.reason, 'error');
}

const actions = {
  back(el) {
    // window.history: "history" ist hier der Trainingsverlauf aus progression.js
    if (ui.stack.length > 1) window.history.back();
    else location.hash = el.dataset.href || '#/';
  },
  'sync-btn'() {
    if (!sync.configured()) location.hash = '#/settings';
    else syncWithToast();
  },

  // Start
  'start-day': el => startSession(el.dataset.id),
  'start-empty': () => startSession(null),
  'bw-quick'() {
    const inp = document.getElementById('bw-quick');
    const v = parseNum(inp.value);
    if (!(v > 20 && v < 400)) { inp.focus(); return toast('Bitte ein gültiges Gewicht eingeben.'); }
    saveBody(todayISO(), v);
    document.activeElement?.blur();
    toast(`${fmtNum(v, 1)} kg gespeichert`);
    rerender();
  },

  // Training
  'toggle-set'(el) {
    document.activeElement?.blur?.();
    const { s, e, set, row } = ctxOf(el);
    if (!set) return;
    if (!set.done) {
      if (set.r == null) {
        const input = row.querySelector('[data-bind="set-r"]');
        const t = parseNum(input.placeholder);
        if (t == null) { input.focus(); return toast('Trag erst die Wiederholungen ein.'); }
        set.r = t;
      }
      set.done = true;
      if (!s.finishedAt) {
        const ex = store.get('exercises', e.exId);
        timer.start(ex?.restSeconds || store.settings().restSeconds || 90);
      }
    } else {
      set.done = false;
    }
    saveSession(s);
    refreshCard(s, e);
  },
  'add-set'(el) {
    const { s, e } = ctxOf(el);
    if (!e) return;
    const last = e.sets[e.sets.length - 1];
    e.sets.push({ min: last?.min ?? null, max: last?.max ?? null, w: last?.w ?? null, r: null, done: false });
    saveSession(s);
    refreshCard(s, e);
  },
  'toggle-note'(el) {
    const { s, e } = ctxOf(el);
    if (!e) return;
    if (ui.noteOpen.has(e.id) && !e.note) ui.noteOpen.delete(e.id);
    else ui.noteOpen.add(e.id);
    refreshCard(s, e);
    $view.querySelector(`[data-entry="${e.id}"] .ex-note`)?.focus();
  },
  'entry-menu'(el) {
    const { s, e } = ctxOf(el);
    if (!e) return;
    const idx = s.entries.indexOf(e);
    const ex = store.getAny('exercises', e.exId);
    openSheet(`<h2 class="sheet-title">${esc(ex?.name || '')}</h2>
      <div class="sheet-list">
        ${idx > 0 ? `<button class="sheet-item" data-action="em-move" data-dir="-1">${icon('up')} Nach oben</button>` : ''}
        ${idx < s.entries.length - 1 ? `<button class="sheet-item" data-action="em-move" data-dir="1">${icon('down')} Nach unten</button>` : ''}
        ${e.sets.length > 1 ? `<button class="sheet-item" data-action="em-remove-set">${icon('minus')} Letzten Satz entfernen</button>` : ''}
        <button class="sheet-item" data-action="em-pin">${icon('info')} Dauerhafte Notiz${ex?.note ? ' bearbeiten' : ' (z. B. Sitzeinstellung)'}</button>
        <button class="sheet-item" data-action="em-swap">${icon('refresh')} Durch andere Übung ersetzen</button>
        <a class="sheet-item" href="#/exercise/${e.exId}">${icon('chart')} Verlauf & Fortschritt</a>
        <button class="sheet-item danger" data-action="em-remove">${icon('trash')} Aus diesem Training entfernen</button>
      </div>
      <button class="btn ghost block" data-action="sheet-close">Abbrechen</button>`, { ctx: { sid: s.id, eid: e.id } });
  },
  'em-move'(el) {
    const { s, e } = ctxOf(el);
    closeSheet(true);
    if (!e) return;
    const i = s.entries.indexOf(e);
    const j = i + Number(el.dataset.dir);
    if (j < 0 || j >= s.entries.length) return;
    [s.entries[i], s.entries[j]] = [s.entries[j], s.entries[i]];
    saveSession(s);
    rerender();
  },
  'em-remove-set'(el) {
    const { s, e } = ctxOf(el);
    closeSheet(true);
    if (!e || e.sets.length < 2) return;
    e.sets.pop();
    saveSession(s);
    refreshCard(s, e);
  },
  async 'em-pin'(el) {
    const { s, e } = ctxOf(el);
    closeSheet(true);
    if (!e) return;
    const ex = store.getAny('exercises', e.exId);
    const v = await promptSheet('Dauerhafte Notiz', ex.note || '', {
      multiline: true, placeholder: 'z. B. Sitzhöhe 4, Griff eng', hint: 'Wird bei jedem Training mit dieser Übung angezeigt.',
    });
    if (v == null) return;
    ex.note = v.trim();
    store.put('exercises', ex);
    const fresh = store.get('sessions', s.id);
    refreshCard(fresh, fresh.entries.find(x => x.id === e.id));
  },
  async 'em-swap'(el) {
    const { s, e } = ctxOf(el);
    closeSheet(true);
    if (!e) return;
    const id = await pickExercise('Ersetzen durch …');
    if (!id) return;
    const fresh = store.get('sessions', s.id);
    const entry = fresh.entries.find(x => x.id === e.id);
    entry.exId = id;
    const sug = suggest(id, entry.sets, { before: fresh.startedAt, excludeSessionId: fresh.id });
    entry.sets.forEach((x, i) => { if (!x.done) x.w = sug.sets[i]?.w ?? null; });
    saveSession(fresh);
    refreshCard(fresh, entry);
  },
  async 'em-remove'(el) {
    const { s, e } = ctxOf(el);
    closeSheet(true);
    if (!e) return;
    if (!(await confirmSheet(`„${exName(e.exId)}“ aus diesem Training entfernen?`, { ok: 'Entfernen', danger: true }))) return;
    const fresh = store.get('sessions', s.id);
    fresh.entries = fresh.entries.filter(x => x.id !== e.id);
    saveSession(fresh);
    rerender();
  },
  async 'add-exercise'(el) {
    const sid = el.closest('[data-session]').dataset.session;
    const exId = await pickExercise('Übung hinzufügen');
    if (!exId) return;
    const s = store.get('sessions', sid);
    const plan = store.all('days').flatMap(d => d.items).find(it => it.exId === exId);
    const lastE = history(exId)[0]?.entry;
    const planned = plan?.sets || lastE?.sets.map(x => ({ min: x.min ?? null, max: x.max ?? null })) || [{ min: null, max: null }, { min: null, max: null }, { min: null, max: null }];
    const entry = newEntry(s, exId, planned, plan?.group || '', plan?.startWeight ?? null);
    s.entries.push(entry);
    saveSession(s);
    rerender();
    setTimeout(() => $view.querySelector(`[data-entry="${entry.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  },
  finish(el) {
    finishSession(el.closest('[data-session]').dataset.session);
  },
  async discard(el) {
    const sid = el.closest('[data-session]').dataset.session;
    if (!(await confirmSheet('Training verwerfen? Alle Einträge dieses Trainings gehen verloren.', { ok: 'Verwerfen', danger: true }))) return;
    store.remove('sessions', sid);
    timer.stop();
    location.hash = '#/';
  },
  'done-edit'(el) {
    const target = '#/session/' + el.closest('[data-session]').dataset.session;
    if (ui.stack[ui.stack.length - 2] === target) window.history.back();
    else location.hash = target;
  },
  'rest-minus': () => timer.add(-15),
  'rest-plus': () => timer.add(15),
  'rest-skip': () => timer.stop(),

  // Verlauf
  async 'delete-session'(el) {
    if (!(await confirmSheet('Dieses Training löschen? Das lässt sich nicht rückgängig machen.', { ok: 'Löschen', danger: true }))) return;
    store.remove('sessions', el.dataset.id);
    location.hash = '#/history';
    toast('Training gelöscht');
  },

  // Fortschritt
  metric(el) {
    ui.metric[el.dataset.ex] = el.dataset.m;
    rerender();
  },
  'chart-point'(el) {
    const tip = el.closest('.chart')?.querySelector('.chart-tip');
    if (tip) tip.textContent = el.dataset.tip;
  },
  'bw-add'() {
    const date = document.getElementById('bw-date').value || todayISO();
    const inp = document.getElementById('bw-kg');
    const v = parseNum(inp.value);
    if (!(v > 20 && v < 400)) { inp.focus(); return toast('Bitte ein gültiges Gewicht eingeben.'); }
    saveBody(date, v);
    document.activeElement?.blur();
    toast(`${fmtNum(v, 1)} kg gespeichert`);
    rerender();
  },
  async 'bw-delete'(el) {
    if (!(await confirmSheet('Diesen Eintrag löschen?', { ok: 'Löschen', danger: true }))) return;
    store.remove('body', el.dataset.id);
    rerender();
  },
  async 'delete-exercise'(el) {
    const id = el.dataset.id;
    if (!(await confirmSheet('Übung löschen? Sie wird aus allen Plänen entfernt, dein Verlauf bleibt erhalten.', { ok: 'Löschen', danger: true }))) return;
    store.remove('exercises', id);
    for (const d of store.all('days')) {
      if (d.items.some(it => it.exId === id)) {
        d.items = d.items.filter(it => it.exId !== id);
        store.put('days', d);
      }
    }
    location.hash = '#/exercises';
    toast('Übung gelöscht');
  },

  // Pläne
  'day-move'(el) {
    const days = store.all('days').sort(byOrder);
    const i = days.findIndex(d => d.id === el.dataset.id);
    const j = i + Number(el.dataset.dir);
    if (i < 0 || j < 0 || j >= days.length) return;
    [days[i], days[j]] = [days[j], days[i]];
    days.forEach((d, k) => { if (d.order !== k) { d.order = k; store.put('days', d); } });
    rerender();
  },
  'add-day'() {
    const days = store.all('days');
    const d = { id: uid(), name: 'Neuer Tag', weekday: null, order: days.length ? Math.max(...days.map(x => x.order ?? 0)) + 1 : 0, items: [] };
    store.put('days', d);
    location.hash = '#/day/' + d.id;
  },
  'item-move'(el) {
    const { d, idx } = itemOf(el);
    const j = idx + Number(el.dataset.dir);
    if (!d || idx < 0 || j < 0 || j >= d.items.length) return;
    [d.items[idx], d.items[j]] = [d.items[j], d.items[idx]];
    store.put('days', d);
    rerender();
  },
  async 'item-remove'(el) {
    const { d, it } = itemOf(el);
    if (!it) return;
    if (!(await confirmSheet(`„${exName(it.exId)}“ aus „${d.name}“ entfernen?`, { ok: 'Entfernen', danger: true }))) return;
    const fresh = store.get('days', d.id);
    fresh.items = fresh.items.filter(x => x.id !== it.id);
    store.put('days', fresh);
    rerender();
  },
  async 'item-exercise'(el) {
    const { d, it } = itemOf(el);
    if (!it) return;
    const id = await pickExercise('Übung wählen');
    if (!id) return;
    const fresh = store.get('days', d.id);
    const item = fresh.items.find(x => x.id === it.id);
    if (!item) return;
    item.exId = id;
    store.put('days', fresh);
    rerender();
  },
  async 'add-item'(el) {
    const dayId = el.closest('[data-day]').dataset.day;
    const id = await pickExercise('Übung hinzufügen');
    if (!id) return;
    const d = store.get('days', dayId);
    const lastItem = d.items[d.items.length - 1];
    d.items.push({ id: uid(), exId: id, group: lastItem?.group || '', sets: parseScheme('3x 8-12'), startWeight: null });
    store.put('days', d);
    rerender();
    setTimeout(() => $view.querySelector(`[data-item="${d.items[d.items.length - 1].id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  },
  async 'delete-day'(el) {
    const d = store.get('days', el.dataset.id);
    if (!d || !(await confirmSheet(`Trainingstag „${d.name}“ löschen? Dein Verlauf bleibt erhalten.`, { ok: 'Löschen', danger: true }))) return;
    store.remove('days', d.id);
    location.hash = '#/plans';
  },
  async 'new-exercise'() {
    const name = await promptSheet('Neue Übung', '', { placeholder: 'Name der Übung', ok: 'Anlegen' });
    if (!name?.trim()) return;
    location.hash = '#/exercise/' + createExercise(name.trim());
  },

  // Einstellungen
  async 'sync-save'(el) {
    const repo = document.getElementById('sync-repo').value.trim()
      .replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    const token = document.getElementById('sync-token').value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return toast('Repository bitte als „benutzername/repo-name“ angeben.', 'error');
    if (!token) return toast('Bitte den Token einfügen.', 'error');
    el.disabled = true;
    el.textContent = 'Prüfe …';
    const res = await sync.checkRepo({ repo, token });
    if (!res.ok) {
      el.disabled = false;
      el.textContent = 'Sync einrichten';
      return toast(res.message, 'error');
    }
    store.setLocal({ sync: { repo, token, path: store.getLocal().sync?.path || 'gym-log-daten.json' } });
    const r = await sync.syncNow();
    rerender();
    if (!res.private) toast('Achtung: Das Repository ist öffentlich – stell es auf GitHub auf „Private“!', 'error');
    else toast(r.ok ? 'Sync eingerichtet ✓' : r.reason, r.ok ? '' : 'error');
  },
  'sync-now': () => syncWithToast(),
  async 'sync-off'() {
    if (!(await confirmSheet('Sync auf diesem Gerät trennen? Deine Daten bleiben hier und auf GitHub erhalten.', { ok: 'Trennen' }))) return;
    store.setLocal({ sync: null });
    sync.refreshStatus();
    rerender();
  },
  theme(el) {
    store.setLocal({ theme: el.dataset.v });
    applyTheme();
    rerender();
  },
  export() {
    const blob = new Blob([JSON.stringify(store.getData(), null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gym-log-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  import() {
    document.getElementById('import-file')?.click();
  },

  // Sheets
  'sheet-close': () => closeSheet(),
  'sheet-ok'() {
    const s = ui.sheet;
    if (!s) return;
    s.onClose = null;
    s.onOk?.();
    closeSheet();
  },
  'picker-pick': el => pickerResolve(el.dataset.id),
  'picker-create': el => pickerResolve(createExercise(el.dataset.name)),
};

// ---------- Eingaben (Felder) ----------

const binds = {
  'set-w'(el, type) {
    const c = ctxOf(el);
    if (!c.set) return;
    const v = parseNum(el.value);
    c.set.w = v;
    if (type === 'change') {
      // gleiches Gewicht in die folgenden, noch offenen Sätze übernehmen
      const old = parseNum(el.dataset.prev);
      if (old !== v) {
        c.e.sets.forEach((x, j) => {
          if (j <= c.i || x.done || x.w !== old) return;
          x.w = v;
          const inp = c.row.parentElement.querySelector(`[data-i="${j}"] [data-bind="set-w"]`);
          if (inp) inp.value = v != null ? fmtNum(v) : '';
        });
      }
      el.value = v != null ? fmtNum(v) : '';
      el.dataset.prev = el.value;
    }
    saveSession(c.s);
  },
  'set-r'(el, type) {
    const c = ctxOf(el);
    if (!c.set) return;
    c.set.r = parseNum(el.value);
    if (type === 'change') el.value = c.set.r != null ? fmtNum(c.set.r) : '';
    saveSession(c.s);
  },
  'entry-note'(el) {
    const c = ctxOf(el);
    if (!c.e) return;
    c.e.note = el.value;
    saveSession(c.s);
  },
  'session-note'(el) {
    const c = ctxOf(el);
    if (!c.s) return;
    c.s.note = el.value;
    saveSession(c.s);
  },
  'session-date'(el, type) {
    if (type !== 'change' || !el.value) return;
    const c = ctxOf(el);
    if (!c.s) return;
    const old = new Date(c.s.startedAt);
    const d = dateFromISO(el.value);
    d.setHours(old.getHours(), old.getMinutes(), old.getSeconds());
    const delta = d.getTime() - c.s.startedAt;
    c.s.date = el.value;
    c.s.startedAt += delta;
    if (c.s.finishedAt) c.s.finishedAt += delta;
    saveSession(c.s);
    rerender();
  },
  'ex-search'(el) {
    const t = el.value.trim().toLowerCase();
    $view.querySelectorAll('[data-name]').forEach(r => { r.hidden = !!t && !r.dataset.name.includes(t); });
  },
  'picker-search'(el) {
    document.getElementById('picker-list').innerHTML = pickerList(el.value);
  },
  'ex-name'(el, type) {
    if (type !== 'change') return;
    const ex = exOf(el);
    if (!ex) return;
    const v = el.value.trim();
    if (!v) { el.value = ex.name; return; }
    ex.name = v;
    store.put('exercises', ex);
    $title.textContent = v;
  },
  'ex-inc'(el, type) {
    const ex = exOf(el);
    if (!ex) return;
    const v = parseNum(el.value);
    ex.increment = v > 0 ? v : null;
    store.put('exercises', ex);
    if (type === 'change') el.value = fmtNum(ex.increment);
  },
  'ex-rest'(el) {
    const ex = exOf(el);
    if (!ex) return;
    ex.restSeconds = el.value ? Number(el.value) : null;
    store.put('exercises', ex);
  },
  'ex-note'(el) {
    const ex = exOf(el);
    if (!ex) return;
    ex.note = el.value;
    store.put('exercises', ex);
  },
  'day-name'(el, type) {
    const d = dayOf(el);
    if (!d) return;
    d.name = el.value;
    if (type === 'change') {
      if (!d.name.trim()) d.name = 'Trainingstag';
      d.name = d.name.trim();
      el.value = d.name;
      $title.textContent = d.name;
    }
    store.put('days', d);
  },
  'day-weekday'(el) {
    const d = dayOf(el);
    if (!d) return;
    d.weekday = el.value === '' ? null : Number(el.value);
    store.put('days', d);
  },
  'item-group'(el) {
    const { d, it } = itemOf(el);
    if (!it) return;
    it.group = el.value.trim();
    store.put('days', d);
  },
  'item-scheme'(el, type) {
    const { d, it } = itemOf(el);
    if (!it) return;
    const sets = parseScheme(el.value);
    const preview = el.parentElement.querySelector('.scheme-preview');
    if (sets) {
      it.sets = sets;
      store.put('days', d);
      preview.textContent = formatScheme(sets);
      preview.classList.remove('bad');
      el.classList.remove('invalid');
    } else if (type === 'change') {
      el.value = schemeInput(it.sets);
      preview.textContent = formatScheme(it.sets);
      preview.classList.remove('bad');
      el.classList.remove('invalid');
    } else {
      preview.textContent = 'Format z. B. 3x 8-12 oder 2x 5-8 + 1x 8-12';
      preview.classList.add('bad');
      el.classList.add('invalid');
    }
  },
  'item-start'(el, type) {
    const { d, it } = itemOf(el);
    if (!it) return;
    it.startWeight = parseNum(el.value);
    store.put('days', d);
    if (type === 'change') el.value = fmtNum(it.startWeight);
  },
  'set-rest'(el) { store.setSettings({ restSeconds: Number(el.value) }); },
  'set-sound'(el) { store.setSettings({ sound: el.checked }); },
  'set-inc'(el, type) {
    const v = parseNum(el.value);
    if (v > 0) store.setSettings({ increment: v });
    if (type === 'change') el.value = fmtNum(store.settings().increment);
  },
};

// ---------- Start ----------

function init() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  timer.init();

  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) {
      ev.preventDefault();
      fn(el, ev);
    }
  });
  const runBind = type => ev => {
    const el = ev.target.closest?.('[data-bind]');
    if (el && binds[el.dataset.bind]) binds[el.dataset.bind](el, type);
  };
  document.addEventListener('input', runBind('input'));
  document.addEventListener('change', runBind('change'));
  document.addEventListener('change', ev => { if (ev.target.id === 'import-file') importFile(ev.target); });
  document.addEventListener('focusin', ev => {
    const el = ev.target;
    if (el.dataset?.bind === 'set-w') el.dataset.prev = el.value;
    if (el.classList?.contains('num')) setTimeout(() => { try { el.setSelectionRange(0, el.value.length); } catch { /* egal */ } }, 0);
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && ui.sheet) closeSheet();
    if (ev.key === 'Enter' && ev.target.id === 'prompt-input' && ev.target.tagName === 'INPUT') actions['sheet-ok']();
  });
  document.addEventListener('focusout', () => setTimeout(() => {
    if (ui.deferred && !isBusy()) { ui.deferred = false; rerender(); }
  }, 400));

  sync.onStatus(st => {
    renderSyncBtn(st);
    const el = document.getElementById('sync-status');
    if (el) { el.textContent = statusText(); el.className = 'status-line s-' + st.state; }
  });
  sync.refreshStatus();
  store.on('change', () => {
    sync.refreshStatus();
    sync.syncSoon(activeSession() ? 90000 : 8000);
  });
  store.on('remote', () => {
    if (isBusy()) ui.deferred = true;
    else rerender();
  });
  store.on('error', () => toast('Speichern fehlgeschlagen – Speicher voll? Bitte ein Backup exportieren.', 'error'));

  document.addEventListener('visibilitychange', () => {
    if (!sync.configured()) return;
    if (document.hidden) { if (store.getLocal().dirty) sync.syncNow(); }
    else if (Date.now() - (store.getLocal().lastSync || 0) > 30000) sync.syncNow();
  });
  window.addEventListener('online', () => sync.syncNow());

  ui.stack = [location.hash || '#/'];
  window.addEventListener('hashchange', () => {
    const h = location.hash || '#/';
    if (ui.stack.length > 1 && ui.stack[ui.stack.length - 2] === h) ui.stack.pop();
    else ui.stack.push(h);
    if (ui.stack.length > 60) ui.stack.splice(0, ui.stack.length - 60);
    render();
  });

  render();
  if (sync.configured()) sync.syncNow();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.search.includes('sw'))) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();

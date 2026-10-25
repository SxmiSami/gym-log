// Pausentimer: läuft über Zeitstempel, überlebt also Neuladen und gesperrten Bildschirm.

import * as store from './store.js';
import { fmtClock } from './util.js';

const KEY = 'gymlog.rest.v1';
let st = read();
let iv = null;
let ctx = null;
let els = null;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
function save() {
  try { st ? localStorage.setItem(KEY, JSON.stringify(st)) : localStorage.removeItem(KEY); } catch { /* egal */ }
}

export function init() {
  const root = document.getElementById('rest');
  root.innerHTML = `
    <div class="rest-fill"><span></span></div>
    <div class="rest-row">
      <div class="rest-text"><span class="rest-label">Pause</span><span class="rest-time">0:00</span></div>
      <button class="rest-btn" data-action="rest-minus" aria-label="15 Sekunden weniger">−15</button>
      <button class="rest-btn" data-action="rest-plus" aria-label="15 Sekunden mehr">+15</button>
      <button class="rest-btn" data-action="rest-skip" aria-label="Pause beenden">✕</button>
    </div>`;
  els = {
    root,
    fill: root.querySelector('.rest-fill span'),
    label: root.querySelector('.rest-label'),
    time: root.querySelector('.rest-time'),
  };
  // iOS erlaubt Ton erst nach einer Berührung
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  document.addEventListener('visibilitychange', update);
  if (st) loop();
  update();
}

function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 1, 22050);
  src.connect(ctx.destination);
  src.start(0);
}

export function start(seconds) {
  st = { end: Date.now() + seconds * 1000, dur: seconds * 1000, rang: false };
  save();
  loop();
  update();
}

export function add(seconds) {
  if (!st) return;
  st.end += seconds * 1000;
  st.dur = Math.max(1000, st.dur + seconds * 1000);
  if (st.end > Date.now()) st.rang = false;
  save();
  update();
}

export function stop() {
  st = null;
  save();
  update();
}

function loop() {
  clearInterval(iv);
  iv = setInterval(update, 250);
}

function update() {
  if (!els) return;
  if (!st) {
    els.root.hidden = true;
    document.body.classList.remove('rest-on');
    clearInterval(iv);
    iv = null;
    return;
  }
  const left = st.end - Date.now();
  if (left <= 0 && !st.rang) {
    st.rang = true;
    save();
    if (!document.hidden) ring();
  }
  if (left < -5 * 60 * 1000) return stop();
  els.root.hidden = false;
  document.body.classList.add('rest-on');
  els.root.classList.toggle('over', left <= 0);
  els.label.textContent = left > 0 ? 'Pause' : 'Pause vorbei – nächster Satz!';
  els.time.textContent = left > 0 ? fmtClock(Math.ceil(left / 1000) * 1000) : '+' + fmtClock(-left);
  els.fill.style.width = (left > 0 ? (1 - left / st.dur) * 100 : 100) + '%';
}

function ring() {
  navigator.vibrate?.([250, 120, 250]);
  if (store.settings().sound === false || !ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime + 0.02;
  [0, 0.32, 0.64].forEach((d, k) => beep(t + d, k === 2 ? 1175 : 880));
}

function beep(t, freq) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.3);
}

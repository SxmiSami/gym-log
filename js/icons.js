// Inline-SVG-Icons (24er Raster, Strichstärke über CSS)

const cloud = '<path d="M7 19h10a4.5 4.5 0 0 0 .7-8.95A6 6 0 0 0 6.2 9.4 4.8 4.8 0 0 0 7 19z"/>';

const P = {
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3 2"/>',
  chart: '<path d="M4 4v16h16"/><path d="M7.5 15l4-4.5 3 3 5-6"/>',
  plans: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/>',
  more: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  dots: '<g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></g>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  note: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5.5a2.5 2.5 0 0 0 2.6 4M16 6h2.5a2.5 2.5 0 0 1-2.6 4M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z"/>',
  cloud,
  cloudOff: cloud + '<path d="M3 3l18 18"/>',
  cloudCheck: cloud + '<path d="M9.3 14.2l2 2 3.6-3.6"/>',
  cloudUp: cloud + '<path d="M12 16.5v-5M9.8 13.5l2.2-2.2 2.2 2.2"/>',
  refresh: '<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2"/>',
  alert: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 20h14"/>',
  scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.3 9.2a5.3 5.3 0 0 1 7.4 0l-2.3 2.6h-2.8z"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  flame: '<path d="M12 2.5c.6 3.2-1.3 5.1-3 7.1-1.6 1.9-3 3.8-3 6.5a6 6 0 0 0 12 0c0-2.3-1-4.2-2.3-5.7-.35 1.4-1.1 2.4-2.2 2.95.45-3.7-.65-7.8-1.5-10.85z"/>',
};

// Große, gefüllte Flamme für die Streak-Anzeige
export const flameArt = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <defs><linearGradient id="flame-grad" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0" stop-color="#ff4d1a"/><stop offset=".6" stop-color="#ff8a1f"/><stop offset="1" stop-color="#ffc23d"/>
  </linearGradient></defs>
  <path class="f-outer" fill="url(#flame-grad)" d="M24 3c1.4 6.6-2.6 10.5-6.1 14.6C14.6 21.5 11.7 25.4 11.7 31a12.3 12.3 0 0 0 24.6 0c0-4.8-2.1-8.7-4.8-11.8-.7 2.9-2.3 5-4.6 6.1C27.8 17.7 25.6 9.3 24 3z"/>
  <path class="f-inner" fill="#ffe08a" d="M24.2 25.5c.6 2.8-1.1 4.5-2.6 6.2-1.4 1.6-2.6 3.2-2.6 5.6a5.1 5.1 0 0 0 10.2 0c0-2.5-1.4-4.6-2.7-6.2-.3 1.1-.95 1.9-1.8 2.35.35-2.75-.15-5.6-.5-7.95z"/>
</svg>`;

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}

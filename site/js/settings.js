// Player settings, kept in this browser: army symbols, text size, motion, speed,
// sound and music. `openSettings` shows them; `apply` puts them into effect.

import * as sound from './sound.js';

const KEY = 'ot.settings';
const DEFAULTS = { symbols: false, textSize: 1, calm: false };

export function get() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

export function set(patch) {
  const next = { ...get(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  apply();
  for (const f of listeners) f(next);
  return next;
}

const listeners = new Set();
export function onChange(f) { listeners.add(f); return () => listeners.delete(f); }

/** Put the settings into effect on the page. */
export function apply() {
  const s = get();
  document.documentElement.style.setProperty('--ts', String(s.textSize));
  document.documentElement.classList.toggle('calm', !!s.calm);
}

/** Should motion be kept to a minimum? (the device asks, or the player did) */
export function calm() {
  return get().calm || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---- army symbols ---------------------------------------------------------------

/** Draw army `i`'s symbol, centred on (cx, cy) with radius r. */
export function drawSymbol(ctx, i, cx, cy, r, color = '#fff') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, r / 3);
  const poly = pts => { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(cx + x * r, cy + y * r) : ctx.moveTo(cx + x * r, cy + y * r))); ctx.closePath(); ctx.fill(); };
  const ngon = (n, rot = -Math.PI / 2, k = 1) => poly(Array.from({ length: n }, (_, j) => [Math.cos(rot + j * 2 * Math.PI / n) * k, Math.sin(rot + j * 2 * Math.PI / n) * k]));
  switch (i % 16) {
    case 0: ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); break; // circle
    case 1: ctx.fillRect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7); break; // square
    case 2: ngon(3); break; // triangle
    case 3: poly([[0, -1], [1, 0], [0, 1], [-1, 0]]); break; // diamond
    case 4: poly(Array.from({ length: 10 }, (_, j) => { const a = -Math.PI / 2 + j * Math.PI / 5, k = j % 2 ? 0.45 : 1; return [Math.cos(a) * k, Math.sin(a) * k]; })); break; // star
    case 5: ctx.fillRect(cx - r, cy - r * 0.3, r * 2, r * 0.6); ctx.fillRect(cx - r * 0.3, cy - r, r * 0.6, r * 2); break; // plus
    case 6: ctx.beginPath(); ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r); ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r); ctx.lineWidth = r * 0.55; ctx.stroke(); break; // cross
    case 7: ngon(3, Math.PI / 2); break; // triangle down
    case 8: ngon(5); break; // pentagon
    case 9: ngon(6, 0); break; // hexagon
    case 10: ctx.beginPath(); ctx.arc(cx, cy, r * 0.75, 0, Math.PI * 2); ctx.lineWidth = r * 0.5; ctx.stroke(); break; // ring
    case 11: ctx.fillRect(cx - r, cy - r, r * 2, r * 0.55); ctx.fillRect(cx - r, cy + r * 0.45, r * 2, r * 0.55); break; // bars
    case 12: poly([[-1, -1], [1, -1], [0, 0]]); poly([[-1, 1], [1, 1], [0, 0]]); break; // hourglass
    case 13: poly([[-1, -0.2], [0, -1], [1, -0.2], [1, 0.4], [0, -0.4], [-1, 0.4]]); break; // chevron
    case 14: ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI / 2, Math.PI * 1.5); ctx.fill(); ctx.fillRect(cx, cy - r, r * 0.4, r * 2); break; // half moon
    case 15: ctx.fillRect(cx - r, cy - r, r * 0.9, r * 0.9); ctx.fillRect(cx + r * 0.1, cy + r * 0.1, r * 0.9, r * 0.9); break; // checks
  }
  ctx.restore();
}

/** A small symbol icon (a canvas) for lists and chips. */
export function symbolIcon(i, color, size = 12) {
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  c.style.width = c.style.height = `${size}px`;
  c.className = 'symbol';
  const ctx = c.getContext('2d');
  drawSymbol(ctx, i, size, size, size * 0.8, '#1b1a26');
  drawSymbol(ctx, i, size, size, size * 0.6, color);
  return c;
}

// ---- the dialog -------------------------------------------------------------------

/** Build the settings panel. `h` is the page's element helper. */
export function settingsPanel(h, onClose) {
  const s = get();
  const row = (label, hint, control) => h('label', { class: 'opt' }, h('span', {}, label, h('small', {}, hint)), control);
  const check = (key, label, hint) => row(label, hint, h('input', { type: 'checkbox', checked: !!s[key], onchange: e => set({ [key]: e.target.checked }) }));
  const choose = (value, options, onchange) => h('select', { onchange: e => onchange(e.target.value) },
    ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  let speed = 'normal';
  try { speed = localStorage.getItem('ot.speed') || 'normal'; } catch { /* default */ }
  return h('div', { class: 'settings' },
    h('h3', {}, 'Settings'),
    check('symbols', 'Army symbols', 'Each army also gets a shape on its units, buildings and name, for colour-blind players.'),
    row('Text size', 'Bigger text everywhere outside the board.', choose(s.textSize, [[1, 'Normal'], [1.15, 'Large'], [1.3, 'Larger']], v => set({ textSize: +v }))),
    check('calm', 'Reduce motion', 'No screen shake, bobbing, lunges, rain or water glints.'),
    row("Other players' moves", 'How quickly computer and online moves play out.', choose(speed, [['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']], v => { try { localStorage.setItem('ot.speed', v); } catch { /* ignore */ } })),
    row('Sound', 'Interface and battle sounds.', h('input', { type: 'checkbox', checked: !sound.isMuted(), onchange: e => sound.setMuted(!e.target.checked) })),
    row('Music', 'A little chiptune, made in the browser.', h('input', { type: 'checkbox', checked: sound.musicEnabled(), onchange: e => sound.setMusic(e.target.checked) })),
    h('p', { class: 'muted small' }, 'Keyboard: arrow keys move the cursor, Enter or Space acts on that tile, Esc cancels, N picks the next unit, E ends the turn, + and − zoom.'),
    onClose ? h('button', { class: 'primary', onclick: onClose }, 'Done') : null);
}

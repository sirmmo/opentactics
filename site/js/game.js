// The battle screen: drawing, input and animation for one match.
//
// The engine holds the true game. `view` is what the screen shows, which
// trails the engine while events are being animated. Every action, whether it
// comes from this player, the computer or a peer, goes through `commit`, so
// all of them are applied and animated in the same order.

import { T, drawTile, drawUnit, factionColor, terrainLayer, redrawTiles, canvasFont } from './art.js';
import { fingerprint } from './engine.js';
import * as sound from './sound.js';
import { snapshot, statsView } from './stats.js';
import * as settings from './settings.js';
import { tr } from './i18n.js';
import * as share from './share.js';

const $ = (sel, root = document) => root.querySelector(sel);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (x, y) => `${x},${y}`;
const calm = () => settings.calm();

// One background worker for the computer players, shared by every match.
let worker = null, workerRules = null, workerId = 0;
const waiting = new Map();
function aiWorker() {
  if (worker === false) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => { const w = waiting.get(e.data.id); waiting.delete(e.data.id); w?.(e.data); };
      worker.onerror = () => { worker = false; for (const w of waiting.values()) w({ error: 'worker failed' }); waiting.clear(); };
    } catch {
      worker = false;
      return null;
    }
  }
  return worker;
}

/** replaceChildren that skips null and false (the DOM would print them). */
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

export class Match {
  /**
   * engine   the Engine, already holding this game
   * rules    the rule set document
   * state    the game state to show first
   * seats    [{ name, local, ai }] from this device's point of view
   * driver   this device runs the computer players and applies actions first
   * send     (player, action) => void, for a guest to pass its action to the host
   * onApplied(player, action, state, hash) after the engine accepts an action
   * onDesync()  for a guest whose copy of the game no longer matches
   * menu     [{ label, action }] extra items for the in-game menu
   * spectate show everything, play nothing (watchers)
   * replay   { start, actions }: a recorded game to step through
   * onWatch(record)  open the replay of this game
   * chat(text)  send a chat message (online games); shows a chat box
   * undoable  offer Undo (games with nobody online) and keep snapshots for it
   * onMailTurn(player)  it is the turn of a seat played by link (seat.mail)
   * sendMark(mark)  pass a ping or plan to allies online (else it stays here)
   * guide     tutorial steps: [{ text, unit?: tag, tile?: [x, y], button?: 'end', until }]
   *           where until is select, move, attack, capture, build, end_turn or next
   */
  constructor(root, o) {
    Object.assign(this, o);
    this.root = root;
    this.view = o.state;
    this.income = [];
    this.queue = [];
    this.busy = false;
    this.pending = false;
    this.ui = { mode: 'idle' };
    this.hover = null;
    this.anim = { moving: null, blink: null, effects: [] };
    this.scale = 3;
    this.log = [];
    this.alive = true;
    // Seats a person plays on this device; fog of war shows the game through their eyes.
    this.locals = this.seats.map((s, i) => (s?.local && !s.ai ? i : -1)).filter(i => i >= 0);
    this.lastViewer = null;
    this.hidden = new Set();
    if (this.replay) { this.spectate = true; this.rIndex = 0; this.playing = false; }
    // Every action, from this state on: enough to replay the game.
    this.record = { start: structuredClone(o.state), actions: [] };
    this.stats = [snapshot(this.rules, o.state, o.income || [])];
    this.build();
    window.__match = this; // handy in the console
    this.setState(this.seen(o.state));
    this.fit();
    const first = this.seats[this.view.turn]?.local ? this.view.turn : this.seats.findIndex(x => x?.local);
    if (first >= 0) requestAnimationFrame(() => this.focusPlayer(first, false));
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.banner(`Day ${this.view.day}`, this.playerName(this.view.turn), factionColor(this.rules, this.view.turn));
    this.guideStep = 0;
    this.renderGuide();
    this.afterIdle();
  }

  destroy() {
    this.alive = false;
    clearTimeout(this.aiTimer);
    clearInterval(this.timerTick);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
    this.root.replaceChildren();
  }

  // ---- layout ------------------------------------------------------------

  build() {
    const r = this.rules;
    this.canvas = h('canvas', { class: 'board' });
    this.scroller = h('div', { class: 'scroller' }, this.canvas);
    this.players = h('div', { class: 'players' });
    this.dayEl = h('div', { class: 'day' });
    this.endBtn = h('button', { class: 'primary', onclick: () => this.endTurn(), title: 'End turn (E)' }, 'End turn');
    this.weatherEl = h('div', { class: 'weather hidden' });
    this.powerBtn = h('button', { class: 'power hidden', onclick: () => this.openPowers(), title: 'Powers' });
    this.modeEl = h('div', { class: 'mode hidden' });
    this.nextBtn = h('button', { onclick: () => this.nextUnit(), title: 'Next unit that has not moved (N)' }, 'Next unit');
    this.undoStack = [];
    this.marks = [];
    this.markBtn = h('button', { class: 'hidden', onclick: () => this.openMarks(), title: 'Pings and plans for your allies (P)' }, 'Ping');
    this.undoBtn = h('button', { class: 'hidden', onclick: () => this.undo(), title: 'Take back your last action this turn (U)' }, 'Undo');
    this.hintBtn = h('button', { class: 'hidden', onclick: () => this.hint(), title: 'What would the computer do? (H)' }, 'Hint');
    this.minimap = h('canvas', { class: 'minimap hidden', title: 'Map overview: click or drag to look around' });
    this.diploBtn = h('button', { class: 'hidden', onclick: () => this.openDiplomacy(), title: 'Alliances and truces' }, 'Diplomacy');
    this.curtain = h('div', { class: 'curtain hidden' });
    this.clockEl = h('div', { class: 'clock hidden', title: 'Time left for this turn' });
    this.chatEl = null;
    if (this.chat) {
      this.chatLog = h('ol', { class: 'chatlog' });
      const input = h('input', { maxlength: 200, placeholder: 'Say something…', enterkeyhint: 'send' });
      // Everyone, or one player in private.
      this.chatTo = h('select', { class: 'chat-to', title: 'Send to' }, h('option', { value: '' }, 'All'),
        ...this.seats.map((st, i) => (st?.ai ? null : h('option', { value: i }, this.playerName(i)))));
      const send = text => { text = text.trim(); if (text) this.chat(text, this.chatTo.value === '' ? null : +this.chatTo.value); };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { send(input.value); input.value = ''; } });
      this.chatEl = h('div', { class: 'chat' },
        h('h3', {}, 'Chat'), this.chatLog,
        h('div', { class: 'row' }, this.chatTo, input, h('button', { onclick: () => { send(input.value); input.value = ''; } }, 'Send')),
        h('div', { class: 'row emotes' }, ['👍', '😂', '😮', '😡', '🎉', 'GG', 'Nice!', 'Oops'].map(e => h('button', { class: 'quiet', onclick: () => send(e) }, e))));
    }
    this.soundBtn = h('button', { class: 'icon', title: 'Sound', onclick: () => { sound.setMuted(!sound.isMuted()); this.soundBtn.textContent = sound.isMuted() ? '🔇' : '🔊'; } }, sound.isMuted() ? '🔇' : '🔊');
    this.info = h('div', { class: 'info' });
    this.logEl = h('ol', { class: 'log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Battle log' });
    this.netEl = h('div', { class: 'net hidden' });
    this.popup = h('div', { class: 'popup hidden' });
    this.toastEl = h('div', { class: 'toast hidden' });
    this.bannerEl = h('div', { class: 'banner hidden' });
    this.menuEl = h('div', { class: 'popup menu hidden' });
    const menuBtn = h('button', { class: 'icon', title: 'Menu', onclick: () => this.openMenu() }, '☰');
    const zoomIn = h('button', { class: 'icon', title: 'Zoom in', onclick: () => this.zoom(1) }, '+');
    const zoomOut = h('button', { class: 'icon', title: 'Zoom out', onclick: () => this.zoom(-1) }, '−');
    this.root.replaceChildren(
      h('header', { class: 'hud' }, menuBtn, this.dayEl, this.weatherEl, this.modeEl, this.clockEl, this.players, h('div', { class: 'spacer' }), zoomOut, zoomIn, this.soundBtn, this.markBtn, this.undoBtn, this.hintBtn, this.nextBtn, this.diploBtn, this.powerBtn, this.endBtn),
      h('main', { class: 'field' },
        h('div', { class: 'stage' }, this.scroller, this.guideEl = h('div', { class: 'guide hidden', role: 'status' }), this.minimap, this.popup, this.bannerEl, this.toastEl, this.menuEl, this.curtain),
        h('aside', { class: 'side' }, this.netEl, this.extraEl = h('div', { class: 'extra' }), this.info, this.chatEl, h('h3', {}, 'Log'), this.logEl)),
    );
    this.ctx = this.canvas.getContext('2d');

    const tileAt = e => {
      const b = this.canvas.getBoundingClientRect();
      const size = T * this.scale;
      const x = Math.floor((e.clientX - b.left) / size), y = Math.floor((e.clientY - b.top) / size);
      return x >= 0 && y >= 0 && x < this.view.width && y < this.view.height ? { x, y } : null;
    };
    // Dragging with the mouse pans the board; two fingers pinch to zoom.
    const touches = new Map();
    let drag = null, pinch = null;
    let press = null;
    this.canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') {
        // Hold a tile to see what is there without selecting it.
        clearTimeout(press?.timer);
        const t = tileAt(e);
        press = t && touches.size === 0 ? { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
          this.longPressed = true;
          navigator.vibrate?.(15);
          const u = this.unitAt(t.x, t.y);
          if (u) this.inspect(u); else { this.ui = { mode: 'idle' }; this.showInfo(t.x, t.y); }
          this.hover = t;
          this.showInfo(t.x, t.y);
        }, 500) } : null;
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), scale: this.scale };
        }
      } else if (e.button === 0) {
        drag = { x: e.clientX, y: e.clientY, left: this.scroller.scrollLeft, top: this.scroller.scrollTop, moved: false };
      }
    });
    this.canvas.addEventListener('pointermove', e => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.timer); press = null; }
      if (touches.has(e.pointerId)) {
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinch && touches.size === 2) {
          const [a, b] = [...touches.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          const target = Math.max(1, Math.min(6, Math.round(pinch.scale * d / pinch.d)));
          if (target !== this.scale) this.zoomTo(target, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          this.dragged = true;
        }
      }
      if (drag && (e.buttons & 1)) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (drag.moved || Math.hypot(dx, dy) > 6) {
          drag.moved = true;
          this.dragged = true;
          this.scroller.scrollLeft = drag.left - dx;
          this.scroller.scrollTop = drag.top - dy;
        }
      }
      const t = tileAt(e);
      if (key(t?.x, t?.y) !== key(this.hover?.x, this.hover?.y)) { this.hover = t; this.onHover(); }
    });
    const lift = e => {
      clearTimeout(press?.timer);
      press = null;
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      drag = null;
    };
    this.canvas.addEventListener('pointerup', lift);
    this.canvas.addEventListener('pointercancel', lift);
    this.canvas.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') { drag = null; this.hover = null; this.onHover(); } });
    this.canvas.addEventListener('click', e => {
      if (this.dragged) { this.dragged = false; return; }
      if (this.longPressed) { this.longPressed = false; return; }
      const t = tileAt(e);
      if (t) this.onClick(t.x, t.y);
    });
    this.scroller.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.zoomTo(Math.max(1, Math.min(6, this.scale + (e.deltaY < 0 ? 1 : -1))), e.clientX, e.clientY);
    }, { passive: false });
    // The minimap: click or drag to look somewhere else.
    const look = e => {
      const b = this.minimap.getBoundingClientRect();
      const x = (e.clientX - b.left) / b.width * this.view.width, y = (e.clientY - b.top) / b.height * this.view.height;
      this.scrollToTile(x - 0.5, y - 0.5, false);
    };
    this.minimap.addEventListener('pointerdown', e => { this.minimap.setPointerCapture(e.pointerId); look(e); });
    this.minimap.addEventListener('pointermove', e => { if (e.buttons & 1) look(e); });
    this.canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.cancel(); });
    this.onKey = e => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.key === 'Escape') this.cancel();
      if (e.key === 'e' || e.key === 'E') this.endTurn();
      if (e.key === 'n' || e.key === 'N') this.nextUnit();
      if ((e.key === 'u' || e.key === 'U') && this.undoable) this.undo();
      if ((e.key === 'p' || e.key === 'P') && !this.markBtn.classList.contains('hidden')) this.openMarks();
      if ((e.key === 'h' || e.key === 'H') && this.driver) this.hint();
      if (e.key === '+' || e.key === '=') this.zoom(1);
      if (e.key === '-' || e.key === '_') this.zoom(-1);
      // Arrow keys move a cursor over the board; Enter or Space acts on its tile.
      const step = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      if (step && !e.target.closest?.('.popup')) {
        e.preventDefault();
        const c = this.hover || this.ui.dest || this.ui.unit || { x: Math.floor(this.view.width / 2), y: Math.floor(this.view.height / 2) };
        this.hover = { x: Math.max(0, Math.min(this.view.width - 1, c.x + step[0])), y: Math.max(0, Math.min(this.view.height - 1, c.y + step[1])) };
        if (!this.onScreen(this.hover.x, this.hover.y)) this.scrollToTile(this.hover.x, this.hover.y, false);
        this.onHover();
      }
      if ((e.key === 'Enter' || e.key === ' ') && this.hover && !e.target.closest?.('button, .popup')) {
        e.preventDefault();
        this.onClick(this.hover.x, this.hover.y);
      }
    };
    window.addEventListener('keydown', this.onKey);
    this.onResize = () => this.fit();
    window.addEventListener('resize', this.onResize);
    void r;
  }

  fit() {
    const box = this.scroller.getBoundingClientRect();
    const fitScale = Math.floor(Math.min(box.width / (this.view.width * T), box.height / (this.view.height * T)));
    if (!this.zoomed) this.scale = Math.max(2, Math.min(5, fitScale || 2));
    this.resize();
  }

  /** Scroll the board to a player's headquarters (or their first unit) on big maps. */
  focusPlayer(p, smooth = true) {
    const s = this.view;
    let at = null;
    for (let i = 0; i < s.terrain.length && !at; i++) {
      if (s.owner[i] === p && this.rules.terrains[s.terrain[i]].hq) at = { x: i % s.width, y: Math.floor(i / s.width) };
    }
    const u = s.units.find(x => x.player === p);
    at ||= u && { x: u.x, y: u.y };
    if (!at) return;
    this.scrollToTile(at.x, at.y, smooth);
  }

  zoom(d) {
    const sc = this.scroller.getBoundingClientRect();
    this.zoomTo(Math.max(1, Math.min(6, this.scale + d)), sc.left + sc.width / 2, sc.top + sc.height / 2);
  }

  /** Change the zoom keeping the point under (cx, cy) (screen coordinates) still. */
  zoomTo(scale, cx, cy) {
    if (scale === this.scale) return;
    const b = this.canvas.getBoundingClientRect();
    const tx = (cx - b.left) / (T * this.scale), ty = (cy - b.top) / (T * this.scale);
    this.zoomed = true;
    this.scale = scale;
    this.resize();
    const nb = this.canvas.getBoundingClientRect();
    this.scroller.scrollLeft += nb.left + tx * T * scale - cx;
    this.scroller.scrollTop += nb.top + ty * T * scale - cy;
  }

  /** Bring tile (x, y) to the middle of the view. */
  scrollToTile(x, y, smooth = true) {
    const size = T * this.scale, sc = this.scroller;
    const left = this.canvas.offsetLeft + (x + 0.5) * size - sc.clientWidth / 2;
    const top = this.canvas.offsetTop + (y + 0.5) * size - sc.clientHeight / 2;
    sc.scrollTo({ left, top, behavior: smooth ? 'smooth' : 'auto' });
  }

  /** Take back our last action this turn (games with nobody online). */
  undo() {
    if (!this.undoable || this.busy || this.queue.length || !this.undoStack.length) return;
    const snap = this.undoStack.pop();
    this.engine.call({ op: 'load', rules: this.rules, state: snap.state });
    this.record.actions.length = snap.actions;
    this.stats.length = snap.stats;
    this.clearUi();
    this.anim = { moving: null, blink: null, effects: [] };
    this.setState(this.seen(snap.state), snap.income);
    this.say('Undone', this.acting() ?? 0);
    sound.play('select');
    this.onApplied?.(null, null, snap.state);
    this.afterIdle();
  }

  /** Ask the hard computer what it would do in our place, and show it. */
  hint() {
    const me = this.acting();
    if (!this.myTurn() || me == null) return;
    let action;
    try { action = this.engine.call({ op: 'ai', player: me, profile: { level: 'hard', style: 'balanced' } }).action; } catch { return; }
    const r = this.rules, s = this.view;
    const unit = action.unit != null && action.type === 'move' ? s.units.find(u => u.id === action.unit) : null;
    let text;
    if (action.type === 'move' && unit) {
      const then = action.then;
      const target = then?.attack != null ? s.units.find(u => u.id === then.attack) : null;
      const what = target ? `attack the ${this.unitName(target)}` : then === 'capture' ? 'capture there' : then === 'load' ? 'get aboard' : then === 'join' ? 'join the unit there'
        : then?.unload ? 'let its passengers out' : then === 'dive' ? 'dive' : then === 'supply' ? 'resupply its neighbours' : 'wait there';
      text = `Move the ${r.units[unit.kind].name} to the marked tile and ${what}.`;
      this.scrollToTile(action.x, action.y);
      this.select(unit);
      const o = this.engine.call({ op: 'options', unit: unit.id, x: action.x, y: action.y });
      this.ui.path = o.ok ? o.path : null;
    } else if (action.type === 'build') {
      text = `Build: ${r.units.find(u => u.id === action.unit)?.name || action.unit}, at the marked factory.`;
      this.scrollToTile(action.x, action.y);
    } else if (action.type === 'power') {
      text = `Use the power ${r.powers.find(p => p.id === action.power)?.name}.`;
    } else if (action.type === 'end_turn') {
      text = 'Nothing more worth doing: end the turn.';
    } else {
      text = 'Answer the diplomatic offer.';
    }
    this.hintShown = { action, at: action.x != null ? [action.x, action.y] : null };
    fill(this.menuEl,
      h('div', { class: 'title' }, 'Hint'),
      h('p', {}, text),
      h('button', { class: 'primary', onclick: () => { this.menuEl.classList.add('hidden'); this.submit(action); } }, 'Do it'),
      h('button', { class: 'quiet', onclick: () => this.menuEl.classList.add('hidden') }, 'Thanks'));
    this.menuEl.classList.remove('hidden');
  }

  /** Units the acting player has not moved yet. */
  idleUnits() {
    const me = this.acting();
    return me == null ? [] : this.view.units.filter(u => u.player === me && !u.moved);
  }

  /** Select the next unit that has not moved, and bring it into view. */
  nextUnit() {
    if (!this.myTurn()) return;
    const idle = this.idleUnits();
    if (!idle.length) return this.toast('Every unit has moved.');
    this.idleIndex = ((this.idleIndex ?? -1) + 1) % idle.length;
    const u = idle[this.idleIndex];
    this.menuEl.classList.add('hidden');
    this.scrollToTile(u.x, u.y);
    this.select(u);
  }

  resize() {
    this.canvas.width = this.view.width * T * this.scale;
    this.canvas.height = this.view.height * T * this.scale;
    this.ctx.imageSmoothingEnabled = false;
  }

  // ---- state -------------------------------------------------------------

  setState(state, income) {
    this.view = state;
    if (income) this.income = income;
    // Redraw only property that changed hands (a full redraw of a big map is slow).
    const prev = this.ownersDrawn;
    if (!prev || prev.length !== state.owner.length || !this.layer) {
      this.layer = terrainLayer(this.rules, state, this.layer);
    } else {
      const changed = [];
      for (let i = 0; i < prev.length; i++) if (prev[i] !== state.owner[i]) changed.push(i);
      if (changed.length) redrawTiles(this.rules, state, this.layer, changed);
    }
    this.ownersDrawn = state.owner.slice();
    this.updateHud();
  }

  /** Players taking their turn right now (several with simultaneous turns). */
  active(state = this.view) {
    return state?.active?.length ? state.active : state ? [state.turn] : [];
  }

  /** The seat a person on this device is playing right now, if any. */
  acting(state = this.view) {
    const act = this.active(state).filter(p => this.locals.includes(p));
    if (!act.length) return null;
    return act.includes(this.lastViewer) ? this.lastViewer : act[0];
  }

  /** Whose eyes the board is shown through, or null to show everything. */
  viewer(state = this.view) {
    if (this.spectate || !this.locals.length) return null;
    if (this.locals.length === 1) return this.locals[0];
    return this.acting(state) ?? this.lastViewer ?? this.locals[0];
  }

  /** What the viewer knows of the engine's current game (hidden enemies left out). */
  seen(state) {
    const v = this.viewer(state);
    if (v == null) { this.hidden = new Set(); return state; }
    this.lastViewer = v;
    try {
      const r = this.engine.call({ op: 'view', player: v });
      this.hidden = new Set(r.hidden);
      return r.state;
    } catch {
      this.hidden = new Set();
      return state;
    }
  }

  team(p) { return this.view.players[p]?.team ?? 1000 + p; }
  allied(a, b) { return a === b || this.team(a) === this.team(b); }
  seesTile(x, y) { return !this.hidden.has(y * this.view.width + x); }

  playerName(p) {
    return this.seats[p]?.name || this.rules.factions[p].name;
  }

  myTurn() {
    const s = this.view;
    // Other players' moves may still be animating: with simultaneous turns nobody
    // in the group can touch our units, so we can go on. Only our own moves wait.
    return !s.over && !this.pending && !this.ownBusy && !this.queue.some(q => q.meta.local) && this.acting() != null
      && (!this.busy || this.active().length > 1);
  }

  unitAt(x, y) { return this.view.units.find(u => u.x === x && u.y === y); }
  terrainAt(x, y) { return this.rules.terrains[this.view.terrain[y * this.view.width + x]]; }
  ownerAt(x, y) { return this.view.owner[y * this.view.width + x]; }

  updateHud() {
    const s = this.view, r = this.rules, o = s.options || {};
    this.dayEl.textContent = `Day ${s.day}`;
    const teams = o.teams?.length ? [...new Set(o.teams)] : [];
    const act = this.active();
    this.players.classList.toggle('many', s.players.length > 8);
    fill(this.players, ...s.players.map((p, i) => h('div', {
      class: `chip${act.includes(i) && !s.over ? ' active' : ''}${p.alive ? '' : ' out'}`,
      style: `--c:${factionColor(r, i)}`,
      title: `${this.playerName(i)}: ${s.units.filter(u => u.player === i).length} units${p.power != null ? ` · ${r.powers[p.power].name} active` : ''}`,
    }, settings.get().symbols ? settings.symbolIcon(i, factionColor(r, i), 14) : h('span', { class: 'dot' }), h('b', {}, this.playerName(i)), h('span', { class: 'funds' }, `${p.funds}`),
      this.income[i] != null ? h('small', {}, `+${this.income[i]}`) : null,
      teams.length > 1 && p.team != null ? h('small', { class: 'tag team' }, `T${teams.indexOf(p.team) + 1}`) : null,
      p.power != null ? h('small', { class: 'tag pow' }, `⚡${r.powers[p.power].name}`) : null,
      this.seats[i]?.ai ? h('small', { class: 'tag' }, 'CPU') : null)));
    const weatherOn = o.weather && o.weather !== 'off' && r.weather?.length;
    this.weatherEl.classList.toggle('hidden', !weatherOn);
    if (weatherOn) {
      const w = r.weather[s.weather] || r.weather[0];
      this.weatherEl.textContent = w.name;
      this.weatherEl.title = w.description || '';
      this.weatherEl.dataset.w = w.id;
    }
    // Game mode status.
    const mode = o.mode?.type || 'standard';
    this.modeEl.classList.toggle('hidden', mode === 'standard');
    if (mode === 'king_of_the_hill') {
      const hold = s.hold;
      const holder = hold ? s.players.findIndex((_, p) => this.team(p) === hold[0]) : -1;
      this.modeEl.textContent = holder >= 0 ? `Hill: ${this.playerName(holder)} ${hold[1]}/${o.mode.days ?? 3}` : `Hill: free (${o.mode.days ?? 3} days to win)`;
      this.modeEl.style.setProperty('--c', holder >= 0 ? factionColor(r, holder) : '#888');
    } else if (mode === 'battle_royale') {
      this.modeEl.textContent = s.storm == null ? `Storm from day ${o.mode.start ?? 5}` : `Storm: ${s.storm.toFixed(1)} tiles`;
      this.modeEl.style.setProperty('--c', '#b06cff');
    } else if (mode === 'survival') {
      const every = o.mode.every ?? 2;
      const next = every - (s.day % every || every) + (s.day % every === 0 ? every : 0);
      this.modeEl.textContent = `Survive to day ${(o.mode.days ?? 15) + 1} · wave in ${next || every}`;
      this.modeEl.style.setProperty('--c', '#ff7a6b');
    } else if (mode === 'score_race') {
      this.modeEl.textContent = `Score race: day ${s.day}/${o.mode.days ?? 20}`;
      this.modeEl.style.setProperty('--c', '#f3c046');
    }
    const diploMe = this.acting() ?? this.viewer() ?? this.locals[0];
    this.diploBtn.classList.toggle('hidden', !o.diplomacy || diploMe == null || s.over);
    const incoming = (s.offers || []).filter(x => x.to === diploMe).length;
    this.diploBtn.textContent = incoming ? `Diplomacy (${incoming})` : 'Diplomacy';
    this.diploBtn.classList.toggle('ready', incoming > 0);
    const powersOn = o.powers && r.powers?.length;
    const me = this.acting() ?? this.viewer();
    this.powerBtn.classList.toggle('hidden', !powersOn || me == null);
    if (powersOn && me != null) {
      const cheapest = Math.min(...r.powers.map(p => p.charge));
      const charge = s.players[me].charge || 0;
      const ready = charge >= cheapest && s.players[me].power == null;
      this.powerBtn.textContent = `⚡ ${Math.floor(100 * Math.min(1, charge / Math.max(...r.powers.map(p => p.charge))))}%`;
      this.powerBtn.classList.toggle('ready', ready && this.myTurn());
    }
    if (this.onHud) fill(this.extraEl, this.onHud(this.view) || '');
    this.undoBtn.classList.toggle('hidden', !this.undoable || s.over);
    this.undoBtn.disabled = !this.undoStack.length || this.busy;
    this.hintBtn.classList.toggle('hidden', !this.driver || s.over || this.acting() == null);
    const markMe = this.markSeat();
    this.markBtn.classList.toggle('hidden', s.over || markMe == null || !s.players.some((pl, p) => p !== markMe && pl.alive && this.allied(p, markMe)));
    const mine = this.myTurn();
    this.endBtn.disabled = !mine;
    const others = act.filter(p => !this.locals.includes(p));
    this.endBtn.textContent = s.over ? 'Game over' : mine ? 'End turn' : this.acting() != null ? 'Wait…'
      : others.length > 1 ? `${others.length} players…` : `${this.playerName(others[0] ?? s.turn)}…`;
    this.showInfo();
  }

  /** A chat line from someone (seat -1 for a watcher or the host's notices). */
  showChat(name, seat, text, whisper = false) {
    if (!this.chatLog) return;
    const color = seat >= 0 ? factionColor(this.rules, seat) : '#a09fb8';
    this.chatLog.append(h('li', { style: `--c:${color}`, class: whisper ? 'whisper' : '' }, h('b', {}, name), whisper ? ' (private) ' : ' ', text));
    while (this.chatLog.children.length > 80) this.chatLog.firstChild.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    const bubble = h('div', { class: 'bubble', style: `--c:${color}` }, h('b', {}, name), ' ', text);
    this.root.querySelector('.stage')?.append(bubble);
    setTimeout(() => bubble.remove(), 4000);
    sound.play('tick');
  }

  /** Turn clock: `left` ms for `turn`, or null for none. */
  setTimer(turn, left) {
    clearInterval(this.timerTick);
    if (left == null) { this.clockEl.classList.add('hidden'); return; }
    const end = Date.now() + left;
    const tick = () => {
      const ms = Math.max(0, end - Date.now());
      const sec = Math.ceil(ms / 1000);
      this.clockEl.textContent = `⏱ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      this.clockEl.classList.toggle('low', sec <= 15);
      this.clockEl.style.setProperty('--c', factionColor(this.rules, turn));
      if (!ms) clearInterval(this.timerTick);
    };
    this.clockEl.classList.remove('hidden');
    tick();
    this.timerTick = setInterval(tick, 500);
  }

  setNet(text) {
    this.netEl.textContent = text || '';
    this.netEl.classList.toggle('hidden', !text);
  }

  // ---- applying actions --------------------------------------------------

  /** Queue an action for `player`. `meta.hash`, when set, is the state the sender reached. */
  commit(player, action, meta = {}) {
    this.queue.push({ player, action, meta });
    if (!this.busy) this.drain();
  }

  async drain() {
    this.busy = true;
    this.updateHud();
    while (this.queue.length && this.alive) {
      const { player, action, meta } = this.queue.shift();
      this.ownBusy = !!meta.local;
      let res;
      try {
        res = this.engine.call({ op: 'act', player, action });
      } catch (e) {
        if (meta.local) { this.toast(e.message); sound.play('error'); }
        else if (meta.onRefused) meta.onRefused(e.message);
        else if (meta.hash) { this.queue.length = 0; this.onDesync?.(); }
        continue;
      }
      const hash = fingerprint(res.state);
      if (meta.hash && meta.hash !== hash) { this.queue.length = 0; this.onDesync?.(); }
      this.record.actions.push([player, action]);
      if (res.events.some(e => e.e === 'turn' || e.e === 'over')) this.stats.push(snapshot(this.rules, res.state, res.income));
      this.onApplied?.(player, action, res.state, hash);
      if (meta.mine) this.pending = false;
      await this.animate(res.events, this.seats[player]?.ai || !this.seats[player]?.local);
      this.setState(this.seen(res.state), res.income);
    }
    this.busy = false;
    this.ownBusy = false;
    this.instantNow = false;
    this.afterIdle();
  }

  afterIdle() {
    if (!this.alive) return;
    this.updateHud();
    const s = this.view;
    if (s.over && !this.replay) return this.showResult();
    if (s.over && this.replay && this.rIndex >= this.replay.actions.length) this.showResult();
    const me = this.acting();
    if (s.options?.fog && this.locals.length > 1 && me != null && this.curtainFor !== `${s.day}:${me}`) {
      this.curtainFor = `${s.day}:${me}`;
      fill(this.curtain, 
        h('div', { class: 'big', style: `color:${factionColor(this.rules, me)}` }, `${this.playerName(me)}'s turn`),
        h('p', { class: 'muted' }, 'Fog of war is on. Pass the device, then tap to see your side of the battle.'),
        h('button', { class: 'primary', onclick: () => { this.curtain.classList.add('hidden'); this.focusPlayer(me, false); } }, 'Show my side'));
      this.curtain.classList.remove('hidden');
    }
    if (this.replay) {
      if (this.jumpTo != null) { const n = this.jumpTo; this.jumpTo = null; return this.replayJump(n); }
      this.onReplayStep?.();
      if (this.playing) {
        clearTimeout(this.aiTimer);
        this.aiTimer = setTimeout(() => { if (!this.replayForward()) { this.playing = false; this.onReplayStep?.(); } }, 250);
      }
      return;
    }
    // A friend playing by link is up: hand the game over.
    const mailTurn = this.active().find(p => this.seats[p]?.mail);
    if (this.driver && mailTurn != null && !this.busy && !this.active().some(p => this.locals.includes(p) || this.seats[p]?.ai)) {
      const key = `${s.day}:${mailTurn}`;
      if (this.mailShown !== key) { this.mailShown = key; this.onMailTurn?.(mailTurn); }
      return;
    }
    if (this.driver && this.active().some(p => this.seats[p]?.ai) && !this.busy) {
      clearTimeout(this.aiTimer);
      const pause = { normal: 120, fast: 40, instant: 0 }[Match.speed] ?? 120;
      this.aiTimer = setTimeout(() => this.aiStep(), pause);
    }
  }

  // ---- replays -------------------------------------------------------------

  /** Play the next recorded action, animated. False at the end. */
  replayForward() {
    if (!this.replay || this.busy || this.queue.length || this.rIndex >= this.replay.actions.length) return false;
    const [player, action] = this.replay.actions[this.rIndex++];
    this.commit(player, action);
    return true;
  }

  /** Jump to just after action `n`, without animation. */
  replayJump(n) {
    if (!this.replay) return;
    if (this.busy || this.queue.length) { this.jumpTo = n; this.playing = false; return; }
    n = Math.max(0, Math.min(this.replay.actions.length, n));
    let st = this.engine.call({ op: 'load', rules: this.rules, state: this.replay.start });
    for (const [player, action] of this.replay.actions.slice(0, n)) {
      try { st = this.engine.call({ op: 'act', player, action }); } catch { break; }
    }
    this.rIndex = n;
    this.log = [];
    this.logEl.replaceChildren();
    this.clearUi();
    this.anim = { moving: null, blink: null, effects: [] };
    this.resultShown = false;
    this.menuEl.classList.add('hidden');
    this.setState(st.state, st.income);
    this.afterIdle();
  }

  async aiStep() {
    if (!this.alive || this.busy || this.queue.length || this.view.over || this.thinking) return;
    // The engine's truth, not the (possibly fogged) view.
    const truth = this.engine.call({ op: 'state' }).state;
    const p = this.active(truth).find(i => this.seats[i]?.ai);
    if (p == null) return;
    const before = fingerprint(truth);
    this.thinking = true;
    let action;
    try {
      action = await this.think(truth, p);
    } catch {
      action = { type: 'end_turn' };
    }
    this.thinking = false;
    if (!this.alive) return;
    // Someone else moved while we were thinking (simultaneous turns): think again.
    if (fingerprint(this.engine.call({ op: 'state' }).state) !== before) return this.afterIdle();
    this.commit(p, action, { onRefused: () => this.afterIdle() });
  }

  /** The computer's action for `player`: in the background worker when there is one. */
  think(state, player) {
    const profile = this.seats[player]?.profile;
    const w = aiWorker();
    if (!w) return Promise.resolve(this.engine.call({ op: 'ai', player, profile }).action);
    return new Promise((ok, fail) => {
      const id = ++workerId;
      waiting.set(id, r => {
        if (r.action) return ok(r.action);
        // The worker could not do it: think here instead.
        try { ok(this.engine.call({ op: 'ai', player, profile }).action); } catch (e) { fail(e); }
      });
      const msg = { id, state, player, profile };
      if (workerRules !== this.rules) { msg.rules = this.rules; workerRules = this.rules; }
      w.postMessage(msg);
    });
  }

  /** This player chose an action. */
  submit(action) {
    if (!this.myTurn()) return;
    this.clearUi();
    const player = this.acting();
    this.hintShown = null;
    if (action.type === 'move') {
      const then = action.then;
      this.guideEvent(then?.attack != null ? 'attack' : then === 'capture' ? 'capture' : 'move');
      if (then?.attack != null || then === 'capture') this.guideEvent('move');
    } else if (action.type === 'build') this.guideEvent('build');
    else if (action.type === 'end_turn') this.guideEvent('end_turn');
    if (this.undoable) {
      if (action.type === 'end_turn' || action.type === 'resign') this.undoStack = [];
      else {
        const st = this.engine.call({ op: 'state' });
        this.undoStack.push({ state: st.state, income: st.income, actions: this.record.actions.length, stats: this.stats.length });
      }
    }
    if (this.driver) {
      this.commit(player, action, { local: true });
    } else {
      this.pending = true;
      this.updateHud();
      this.send(player, action);
    }
  }

  /** The host turned our action down. */
  refused(message) {
    this.pending = false;
    this.toast(message);
    sound.play('error');
    this.updateHud();
  }

  /** Start over from a state the host sent. */
  resync(state, income) {
    this.queue.length = 0;
    this.pending = false;
    this.clearUi();
    this.anim = { moving: null, blink: null, effects: [] };
    this.locals = this.seats.map((st, i) => (st?.local && !st.ai ? i : -1)).filter(i => i >= 0);
    if (!this.replay) {
      this.record = { start: structuredClone(state), actions: [] };
      this.stats = [snapshot(this.rules, state, income || [])];
    }
    this.resultShown = false;
    this.setState(this.seen(state), income);
    this.afterIdle();
  }

  endTurn() {
    if (!this.myTurn()) return;
    const idle = this.idleUnits().length;
    let ask = true;
    try { ask = localStorage.getItem('ot.warnIdle') !== 'no'; } catch { /* ask */ }
    if (!idle || !ask) return this.submit({ type: 'end_turn' });
    const never = h('input', { type: 'checkbox' });
    const remember = () => { if (never.checked) try { localStorage.setItem('ot.warnIdle', 'no'); } catch { /* ignore */ } };
    fill(this.menuEl,
      h('div', { class: 'title' }, `${idle} unit${idle === 1 ? ' has' : 's have'} not moved`),
      h('button', { class: 'primary', onclick: () => { remember(); this.menuEl.classList.add('hidden'); this.submit({ type: 'end_turn' }); } }, 'End turn anyway'),
      h('button', { onclick: () => { remember(); this.menuEl.classList.add('hidden'); this.nextUnit(); } }, 'Show me'),
      h('label', { class: 'small muted' }, never, " Don't ask again"));
    this.menuEl.classList.remove('hidden');
  }

  // ---- animation ---------------------------------------------------------

  /** How quickly other players' moves play out: 'normal', 'fast' or 'instant'. */
  static get speed() {
    try { return localStorage.getItem('ot.speed') || 'normal'; } catch { return 'normal'; }
  }

  /** Is (x, y) on screen right now? Off-screen moves are not worth waiting for. */
  onScreen(x, y) {
    const size = T * this.scale, sc = this.scroller;
    const px = this.canvas.offsetLeft + (x + 0.5) * size - sc.scrollLeft, py = this.canvas.offsetTop + (y + 0.5) * size - sc.scrollTop;
    return px > -size && py > -size && px < sc.clientWidth + size && py < sc.clientHeight + size;
  }

  nap(ms) {
    return this.instantNow ? Promise.resolve() : sleep(ms);
  }

  async animate(events, fast) {
    const s = structuredClone(this.view);
    this.view = s;
    const setting = Match.speed;
    this.instantNow = fast && setting === 'instant';
    const speed = fast ? (setting === 'fast' ? 30 : 55) : 80;
    for (const ev of events) {
      if (!this.alive) return;
      const unit = id => s.units.find(u => u.id === id);
      switch (ev.e) {
        case 'move': {
          const u = unit(ev.unit);
          if (!u) break;
          const steps = ev.path.length - 1;
          const [sx, sy] = ev.path[0], [ex, ey] = ev.path[steps];
          if (this.instantNow || (!this.onScreen(sx, sy) && !this.onScreen(ex, ey))) {
            u.x = ex; u.y = ey; u.moved = true;
            break;
          }
          sound.sfx(sound.moveVoice(this.rules.units[u.kind]));
          const start = performance.now(), dur = steps * speed;
          await new Promise(done => {
            const step = () => {
              const t = Math.min(1, (performance.now() - start) / dur);
              const f = t * steps, i = Math.min(steps - 1, Math.floor(f)), k = f - i;
              const a = ev.path[i], b = ev.path[i + 1];
              u.x = a[0] + (b[0] - a[0]) * k;
              u.y = a[1] + (b[1] - a[1]) * k;
              if (t < 1 && this.alive) requestAnimationFrame(step); else done();
            };
            step();
          });
          const end = ev.path[steps];
          u.x = end[0]; u.y = end[1]; u.moved = true;
          break;
        }
        case 'attack': {
          const a = unit(ev.attacker), d = unit(ev.defender);
          if (!d) break;
          const ranged = a && (this.rules.units[a.kind].range?.[1] || 1) > 1;
          const flying = a && this.rules.units[a.kind].flying;
          if (a) {
            const dir = [Math.sign(d.x - a.x), Math.sign(d.y - a.y)];
            if (!ranged && !calm() && !this.instantNow) await this.lunge(a, dir, fast ? 140 : 200);
            sound.sfx(sound.voiceOf(this.rules.units[a.kind]));
            this.effect({ kind: 'flash', at: [a.x, a.y], dir, dur: 140 });
            const travel = ranged ? (fast ? 380 : 520) : (fast ? 150 : 200);
            this.effect({ kind: ranged ? 'shell' : flying ? 'missile' : 'shot', from: [a.x, a.y], to: [d.x, d.y], dur: travel, color: factionColor(this.rules, a.player) });
            await this.nap(travel);
          } else {
            sound.play('attack');
            await this.nap(fast ? 120 : 180);
          }
          this.effect({ kind: 'impact', at: [d.x, d.y], dur: 320 });
          if (ev.damage >= 45) this.shake(Math.min(1, ev.damage / 100), 260);
          this.anim.blink = d.id;
          this.effect({ kind: 'text', at: [d.x, d.y], text: `-${ev.damage}%`, color: ev.damage >= 50 ? '#ffd27a' : '#fff2a8', big: ev.damage >= 50, dur: 900 });
          d.hp = ev.hp;
          if (a) a.moved = a.moved || !ev.counter;
          await this.nap(fast ? 280 : 420);
          this.anim.blink = null;
          this.say(`${a ? this.unitName(a) : 'Something unseen'} hits ${this.unitName(d)} for ${ev.damage}%${ev.counter ? ' (counter)' : ''}`, a?.player ?? d.player);
          break;
        }
        case 'trapped': {
          const u = unit(ev.unit);
          sound.play('error');
          this.effect({ kind: 'text', at: [ev.x, ev.y], text: 'Ambush!', color: '#ff9d8a', dur: 1100 });
          if (u) this.say(`${this.unitName(u)} runs into a hidden enemy`, u.player);
          await this.nap(fast ? 300 : 500);
          break;
        }
        case 'load': {
          const u = unit(ev.unit), t = unit(ev.into);
          if (u && t) { t.cargo = [...(t.cargo || []), { ...u }]; this.say(`${this.unitName(u)} boards the ${this.rules.units[t.kind].name}`, u.player); }
          s.units = s.units.filter(x => x.id !== ev.unit);
          sound.play('select');
          break;
        }
        case 'unload': {
          const t = unit(ev.from);
          if (t) t.cargo = (t.cargo || []).filter(c => c.id !== ev.unit.id);
          if (this.allied(ev.unit.player, this.viewer() ?? ev.unit.player) || this.seesTile(ev.unit.x, ev.unit.y)) {
            s.units.push({ ...ev.unit });
            this.effect({ kind: 'ring', at: [ev.unit.x, ev.unit.y], dur: 400, color: factionColor(this.rules, ev.unit.player) });
          }
          sound.play('move');
          await this.nap(fast ? 120 : 200);
          break;
        }
        case 'join': {
          const u = unit(ev.unit), t = unit(ev.into);
          s.units = s.units.filter(x => x.id !== ev.unit);
          if (t) {
            t.hp = ev.hp; t.moved = true;
            this.effect({ kind: 'text', at: [t.x, t.y], text: ev.refund ? `+${ev.refund}` : 'Joined', color: '#9dff9d', dur: 900 });
            this.say(`${this.unitName(t)} units join${ev.refund ? ` (+${ev.refund} funds)` : ''}`, t.player);
            if (ev.refund) { s.players[t.player].funds += ev.refund; this.updateHud(); }
          } else if (u) this.say(`${this.unitName(u)} joins another`, u.player);
          sound.play('capture');
          await this.nap(fast ? 150 : 250);
          break;
        }
        case 'dive': {
          const u = unit(ev.unit);
          if (u) {
            u.dived = ev.dived;
            this.effect({ kind: 'text', at: [u.x, u.y], text: ev.dived ? 'Dive' : 'Surface', color: '#bff0ff', dur: 800 });
            if (ev.dived && !this.allied(u.player, this.viewer() ?? u.player)) s.units = s.units.filter(x => x.id !== u.id);
          }
          break;
        }
        case 'supply': {
          const u = unit(ev.unit);
          for (const id of ev.units) {
            const o = unit(id);
            if (o) this.effect({ kind: 'text', at: [o.x, o.y], text: 'Supplied', color: '#9dff9d', dur: 900 });
          }
          if (u) this.say(`${this.unitName(u)} resupplies ${ev.units.length} unit${ev.units.length === 1 ? '' : 's'}`, u.player);
          sound.play('build');
          break;
        }
        case 'crash': {
          const gone = unit(ev.unit);
          s.units = s.units.filter(u => u.id !== ev.unit);
          if (gone || this.seesTile(ev.x, ev.y)) {
            sound.play('destroy');
            this.effect({ kind: 'boom', at: [ev.x, ev.y], dur: 600 });
          }
          if (gone) this.say(`${this.unitName(gone)} runs out of fuel and is lost`, gone.player);
          await this.nap(fast ? 250 : 400);
          break;
        }
        case 'hill': {
          s.hold = ev.team == null ? null : [ev.team, ev.days];
          this.updateHud();
          if (ev.team != null) {
            const p = s.players.findIndex((_, i) => this.team(i) === ev.team);
            this.say(`${this.playerName(p)} holds the hill (${ev.days})`, p);
            if (s.hill) this.effect({ kind: 'ring', at: s.hill, dur: 700, color: factionColor(this.rules, p) });
          }
          break;
        }
        case 'storm': {
          s.storm = ev.radius;
          this.updateHud();
          this.banner('The storm closes in', `Safe circle: ${ev.radius.toFixed(1)} tiles`, '#c79bff');
          this.say('The storm closes in', s.turn);
          await this.nap(fast ? 500 : 900);
          break;
        }
        case 'storming': {
          const u = unit(ev.unit);
          if (u) {
            u.hp = ev.hp;
            this.effect({ kind: 'text', at: [u.x, u.y], text: `-${ev.damage}%`, color: '#c79bff', dur: 800 });
            this.effect({ kind: 'impact', at: [u.x, u.y], dur: 300 });
          }
          break;
        }
        case 'spawn': {
          if (this.allied(ev.unit.player, this.viewer() ?? ev.unit.player) || this.seesTile(ev.unit.x, ev.unit.y)) {
            s.units.push({ ...ev.unit });
            this.effect({ kind: 'ring', at: [ev.unit.x, ev.unit.y], dur: 500, color: factionColor(this.rules, ev.unit.player) });
          }
          if (!this.waveSaid) {
            this.waveSaid = true;
            this.banner('A wave arrives', 'More invaders are coming', '#ff7a6b');
            setTimeout(() => { this.waveSaid = false; }, 2000);
          }
          break;
        }
        case 'pact': {
          const a = this.playerName(ev.from), b = this.playerName(ev.to);
          const what = ev.pact?.type === 'truce' ? `a ${ev.pact.days}-day truce` : 'an alliance';
          const text = ev.what === 'offer' ? `${a} offers ${b} ${what}`
            : ev.what === 'accept' ? `${b} accepts ${what} with ${a}`
            : ev.what === 'decline' ? `${b} turns down ${a}'s offer`
            : ev.what === 'leave' ? `${a} leaves the alliance`
            : `The truce between ${a} and ${b} ends`;
          this.say(text, ev.from);
          if (this.locals.includes(ev.to) || this.locals.includes(ev.from) || ev.what === 'accept' || ev.what === 'leave') this.toast(text);
          sound.play('tick');
          break;
        }
        case 'weather': {
          s.weather = ev.weather;
          const w = this.rules.weather?.[ev.weather];
          this.updateHud();
          if (w) { this.banner(w.name, w.description || '', '#bfe4ff'); this.say(`The weather turns: ${w.name}`, s.turn); await this.nap(700); }
          break;
        }
        case 'power': {
          const pw = this.rules.powers?.[ev.power];
          s.players[ev.player].power = ev.power;
          s.players[ev.player].charge = Math.max(0, (s.players[ev.player].charge || 0) - (pw?.charge || 0));
          this.updateHud();
          sound.play('win');
          this.effect({ kind: 'screen', color: factionColor(this.rules, ev.player), dur: 700 });
          if (pw) { this.banner(pw.name, `${this.playerName(ev.player)} · ${pw.description || ''}`, factionColor(this.rules, ev.player)); this.say(`${this.playerName(ev.player)} uses ${pw.name}`, ev.player); }
          await this.nap(fast ? 700 : 1100);
          break;
        }
        case 'destroy': {
          sound.sfx('explosion');
          this.effect({ kind: 'boom', at: [ev.x, ev.y], dur: 650 });
          this.effect({ kind: 'smoke', at: [ev.x, ev.y], dur: 1400 });
          this.shake(0.9, 380);
          const gone = unit(ev.unit);
          s.units = s.units.filter(u => u.id !== ev.unit);
          if (gone) this.say(`${this.unitName(gone)} destroyed`, gone.player);
          await this.nap(fast ? 250 : 400);
          break;
        }
        case 'capture': {
          const u = unit(ev.unit);
          sound.play(ev.done ? 'capture' : 'tick');
          this.effect({ kind: 'text', at: [ev.x, ev.y], text: ev.done ? 'Captured!' : `${ev.progress}/${ev.needed}`, color: '#bff0ff', dur: 1000 });
          if (u) u.capture = ev.done ? 0 : ev.progress;
          if (ev.done && u) {
            s.owner[ev.y * s.width + ev.x] = u.player;
            this.setState(s);
            this.say(`${this.playerName(u.player)} captures a ${this.terrainAt(ev.x, ev.y).name.toLowerCase()}`, u.player);
          }
          await this.nap(fast ? 300 : 500);
          break;
        }
        case 'build': {
          sound.play('build');
          const seen = this.allied(ev.unit.player, this.viewer() ?? ev.unit.player) || this.seesTile(ev.unit.x, ev.unit.y);
          if (seen) s.units.push({ ...ev.unit });
          s.players[ev.unit.player].funds -= this.rules.units[ev.unit.kind].cost;
          this.updateHud();
          if (seen) this.effect({ kind: 'ring', at: [ev.unit.x, ev.unit.y], dur: 400, color: factionColor(this.rules, ev.unit.player) });
          this.say(`${this.playerName(ev.unit.player)} builds ${seen ? this.rules.units[ev.unit.kind].name : 'a unit'}`, ev.unit.player);
          await this.nap(fast ? 150 : 250);
          break;
        }
        case 'repair': {
          const u = unit(ev.unit);
          if (u) {
            u.hp = ev.hp;
            this.effect({ kind: 'sparkle', at: [u.x, u.y], dur: 800 });
          }
          break;
        }
        case 'turn': {
          for (const u of s.units) if (u.player === ev.player) u.moved = false;
          const group = events.filter(e => e.e === 'turn' && e.day === ev.day).map(e => e.player);
          s.turn = group[0];
          s.active = group;
          s.day = ev.day;
          this.updateHud();
          // One banner per round: the local player's, or the first of the group.
          const mineNow = group.find(p => this.locals.includes(p));
          if (ev.player === (mineNow ?? group[0])) {
            sound.play('turn');
            if (this.locals.includes(ev.player)) this.focusPlayer(ev.player);
            const who = group.length > 1 && mineNow == null ? `${group.length} players at once` : this.playerName(ev.player);
            this.banner(`Day ${ev.day}`, who, factionColor(this.rules, ev.player));
          }
          this.say(`Day ${ev.day}: ${this.playerName(ev.player)} (+${ev.income})`, ev.player);
          break;
        }
        case 'defeat':
          this.say(`${this.playerName(ev.player)} is defeated`, ev.player);
          this.banner('Defeated', this.playerName(ev.player), factionColor(this.rules, ev.player));
          await this.nap(900);
          break;
        case 'over':
          break;
      }
    }
  }

  /** Veteran rank (0-3) when the game has ranks. */
  rankOf(u) {
    if (!this.view.options?.ranks || !u.xp) return 0;
    return (this.rules.ranks?.thresholds || [100, 250, 450]).filter(t => u.xp >= t).length;
  }

  unitName(u) {
    return `${this.rules.factions[u.player]?.name ?? ''} ${this.rules.units[u.kind].name}`.trim();
  }

  /** A melee attacker jumps at its target and back. */
  async lunge(u, dir, dur) {
    this.anim.lunge = { id: u.id, dir, t0: performance.now(), dur };
    await sleep(dur * 0.55);
  }

  shake(amp, dur) {
    if (calm()) return;
    this.anim.shake = { amp, dur, t0: performance.now() };
  }

  effect(fx) {
    if (this.instantNow) return;
    if (fx.text) fx.text = tr(fx.text);
    fx.t0 = performance.now();
    this.anim.effects.push(fx);
  }

  say(text, player) {
    this.log.unshift({ text, player });
    this.log.length = Math.min(this.log.length, 60);
    this.logEl.replaceChildren(...this.log.map(l => h('li', { style: `--c:${factionColor(this.rules, l.player)}` }, l.text)));
  }

  banner(title, sub, color) {
    const el = this.bannerEl;
    el.replaceChildren(h('div', { class: 'big' }, title), h('div', { style: `color:${color}` }, sub));
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.add('hidden'), 1300);
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), 2600);
  }

  // ---- input -------------------------------------------------------------

  clearUi() {
    this.ui = { mode: 'idle' };
    this.popup.classList.add('hidden');
    this.showInfo();
  }

  cancel() {
    if (!this.menuEl.classList.contains('hidden')) return this.menuEl.classList.add('hidden');
    const ui = this.ui;
    if (ui.mode === 'menu' || ui.mode === 'target' || ui.mode === 'drop') {
      this.popup.classList.add('hidden');
      this.ui = { ...ui, mode: 'select', dest: null, path: null };
      return;
    }
    this.clearUi();
  }

  select(unit) {
    this.guideEvent('select', unit);
    const reach = this.engine.call({ op: 'reach', unit: unit.id });
    const stops = new Set(reach.tiles.filter(t => t[2]).map(t => key(t[0], t[1])));
    const threat = new Set(reach.threat.map(t => key(t[0], t[1])));
    sound.play('select');
    this.ui = { mode: 'select', unit, stops, threat };
    this.showInfo();
  }

  inspect(unit) {
    const reach = this.engine.call({ op: 'reach', unit: unit.id });
    this.ui = {
      mode: 'inspect', unit,
      stops: new Set(reach.tiles.filter(t => t[2]).map(t => key(t[0], t[1]))),
      threat: new Set(reach.threat.map(t => key(t[0], t[1]))),
    };
    this.showInfo();
  }

  onHover() {
    const ui = this.ui, t = this.hover;
    if (ui.mode === 'select' && t && ui.stops.has(key(t.x, t.y))) {
      try {
        const o = this.engine.call({ op: 'options', unit: ui.unit.id, x: t.x, y: t.y });
        ui.path = o.ok ? o.path : null;
      } catch { ui.path = null; }
    } else if (ui.mode === 'select') {
      ui.path = null;
    }
    this.showInfo();
  }

  onClick(x, y) {
    const ui = this.ui;
    this.menuEl.classList.add('hidden');
    if (ui.mode === 'ping') { this.placeMark({ kind: ui.kind, at: [x, y] }); this.clearUi(); return; }
    if (ui.mode === 'plan') {
      if (!ui.from) { this.ui = { ...ui, from: [x, y] }; this.toast('Now tap where the arrow ends.'); return; }
      this.placeMark({ kind: 'plan', at: ui.from, to: [x, y] });
      this.clearUi();
      return;
    }
    if (ui.mode === 'select') {
      if (!ui.stops.has(key(x, y))) return this.clearUi();
      const o = this.engine.call({ op: 'options', unit: ui.unit.id, x, y });
      if (!o.ok) return;
      this.ui = { ...ui, mode: 'menu', dest: { x, y }, path: o.path, options: o };
      return this.openActions(x, y, o);
    }
    if (ui.mode === 'drop') {
      if (!ui.dropTiles.has(key(x, y))) return;
      ui.drops.push({ unit: ui.queue.shift().unit, x, y });
      return this.nextDrop();
    }
    if (ui.mode === 'target') {
      const target = ui.options.targets.find(t => t.x === x && t.y === y);
      if (!target) return this.cancel();
      return this.submit({ type: 'move', unit: ui.unit.id, x: ui.dest.x, y: ui.dest.y, then: { attack: target.unit } });
    }
    if (ui.mode === 'menu') return this.cancel();

    const unit = this.unitAt(x, y);
    const s = this.view;
    const me = this.acting();
    if (unit && this.myTurn() && unit.player === me && !unit.moved) return this.select(unit);
    if (unit) return this.inspect(unit);
    if (this.myTurn() && this.ownerAt(x, y) === me) {
      const { builds } = this.engine.call({ op: 'builds', x, y, player: me });
      if (builds.length) return this.openBuild(x, y, builds);
    }
    this.ui = { mode: 'idle' };
    this.popup.classList.add('hidden');
    this.showInfo(x, y);
  }

  placePopup(x, y) {
    const size = T * this.scale;
    const stage = this.popup.parentElement.getBoundingClientRect();
    const board = this.canvas.getBoundingClientRect();
    let left = board.left - stage.left + (x + 1) * size + 6;
    let top = board.top - stage.top + y * size;
    this.popup.classList.remove('hidden');
    const w = this.popup.offsetWidth, hgt = this.popup.offsetHeight;
    if (left + w > stage.width - 4) left = board.left - stage.left + x * size - w - 6;
    left = Math.max(4, left);
    top = Math.max(4, Math.min(top, stage.height - hgt - 4));
    this.popup.style.left = `${left}px`;
    this.popup.style.top = `${top}px`;
  }

  openActions(x, y, o) {
    const u = this.ui.unit;
    const items = [];
    const act = (label, then) => items.push(h('button', { onclick: () => this.submit({ type: 'move', unit: u.id, x, y, then }) }, label));
    if (o.load) act('Board', 'load');
    if (o.join) act('Join', 'join');
    if (o.targets.length) items.push(h('button', { onclick: () => {
      this.popup.classList.add('hidden');
      this.ui = { ...this.ui, mode: 'target' };
      this.showInfo();
    } }, 'Fire'));
    if (o.capture) act('Capture', 'capture');
    if (o.unload?.length) items.push(h('button', { onclick: () => this.startDrop(x, y, o) }, 'Unload'));
    if (o.supply) act('Resupply', 'supply');
    if (o.dive) act('Dive', 'dive');
    if (o.surface) act('Surface', 'surface');
    if (o.stop !== false) act('Wait', 'wait');
    items.push(h('button', { class: 'quiet', onclick: () => this.cancel() }, 'Cancel'));
    fill(this.popup, ...items);
    this.placePopup(x, y);
    items[0].focus({ preventScroll: true });
  }

  /** Unloading: pick a tile for each carried unit, one after another. */
  startDrop(x, y, o) {
    this.popup.classList.add('hidden');
    this.ui = { ...this.ui, mode: 'drop', drops: [], queue: o.unload.map(c => ({ ...c })) };
    this.nextDrop();
  }

  nextDrop() {
    const ui = this.ui;
    const used = new Set(ui.drops.map(d => key(d.x, d.y)));
    while (ui.queue.length && !ui.queue[0].tiles.some(t => !used.has(key(t[0], t[1])))) ui.queue.shift();
    if (!ui.queue.length) return this.finishDrop();
    const c = ui.queue[0];
    ui.dropTiles = new Set(c.tiles.map(t => key(t[0], t[1])).filter(k => !used.has(k)));
    fill(this.popup, 
      h('div', { class: 'title' }, `Where does the ${this.rules.units[c.kind].name} get out?`),
      ui.queue.length > 1 ? h('button', { onclick: () => { ui.queue.shift(); this.nextDrop(); } }, 'Keep it on board') : null,
      ui.drops.length ? h('button', { class: 'primary', onclick: () => this.finishDrop() }, 'Done') : null,
      h('button', { class: 'quiet', onclick: () => this.cancel() }, 'Cancel'));
    this.placePopup(ui.dest.x, ui.dest.y);
  }

  finishDrop() {
    const ui = this.ui;
    if (!ui.drops.length) return this.cancel();
    this.submit({ type: 'move', unit: ui.unit.id, x: ui.dest.x, y: ui.dest.y, then: { unload: ui.drops } });
  }

  // ---- gamepad ------------------------------------------------------------------

  /**
   * Standard gamepad: d-pad or left stick move the cursor (or the focus in a
   * menu), A acts, B cancels, X next unit, Y hint, Start ends the turn, Back opens
   * the menu, LB/RB zoom.
   */
  pollGamepad(now) {
    const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
    if (!pad) return;
    const prev = this.padPrev || [];
    const down = i => !!pad.buttons[i]?.pressed;
    const pressed = i => down(i) && !prev[i];
    this.padPrev = pad.buttons.map(b => b.pressed);
    // Direction, with key-repeat while held.
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    const dir = down(14) || ax < -0.5 ? [-1, 0] : down(15) || ax > 0.5 ? [1, 0] : down(12) || ay < -0.5 ? [0, -1] : down(13) || ay > 0.5 ? [0, 1] : null;
    let step = null;
    if (dir) {
      const key = dir.join();
      if (this.padDir !== key) { this.padDir = key; this.padNext = now + 260; step = dir; }
      else if (now >= this.padNext) { this.padNext = now + 90; step = dir; }
    } else this.padDir = null;
    // In a menu or popup: move between its buttons.
    const open = [this.menuEl, this.popup, this.curtain].find(el => !el.classList.contains('hidden'));
    if (open) {
      const buttons = [...open.querySelectorAll('button:not([disabled])')];
      if (step && buttons.length) {
        const i = buttons.indexOf(document.activeElement);
        buttons[(i + (step[0] + step[1] > 0 ? 1 : -1) + buttons.length) % buttons.length].focus();
      }
      if (pressed(0)) (buttons.includes(document.activeElement) ? document.activeElement : buttons[0])?.click();
      if (pressed(1)) this.cancel();
      return;
    }
    if (step) {
      const c = this.hover || this.ui.dest || this.ui.unit || { x: Math.floor(this.view.width / 2), y: Math.floor(this.view.height / 2) };
      this.hover = { x: Math.max(0, Math.min(this.view.width - 1, c.x + step[0])), y: Math.max(0, Math.min(this.view.height - 1, c.y + step[1])) };
      if (!this.onScreen(this.hover.x, this.hover.y)) this.scrollToTile(this.hover.x, this.hover.y, false);
      this.onHover();
    }
    if (pressed(0) && this.hover) this.onClick(this.hover.x, this.hover.y);
    if (pressed(1)) this.cancel();
    if (pressed(2)) this.nextUnit();
    if (pressed(3) && this.driver) this.hint();
    if (pressed(9)) this.endTurn();
    if (pressed(8)) this.openMenu();
    if (pressed(4)) this.zoom(-1);
    if (pressed(5)) this.zoom(1);
  }

  // ---- guided tutorial ------------------------------------------------------

  guideNow() {
    return this.guide?.[this.guideStep] || null;
  }

  renderGuide() {
    const step = this.guideNow();
    this.endBtn.classList.toggle('guide-target', step?.button === 'end');
    if (!step) { this.guideEl.classList.add('hidden'); return; }
    fill(this.guideEl,
      h('span', { class: 'guide-count' }, `${this.guideStep + 1}/${this.guide.length}`),
      h('span', {}, step.text),
      step.until === 'next' ? h('button', { class: 'primary', onclick: () => this.guideEvent('next') }, 'Got it') : null,
      h('button', { class: 'quiet', title: 'Hide the guide', onclick: () => { this.guideStep = this.guide.length; this.renderGuide(); } }, '×'));
    this.guideEl.classList.remove('hidden');
    if (step.unit) {
      const u = this.view.units.find(x => x.tag === step.unit);
      if (u) this.scrollToTile(u.x, u.y);
    } else if (step.tile) this.scrollToTile(step.tile[0], step.tile[1]);
  }

  /** Something happened; move the guide on if it is what the step waits for. */
  guideEvent(kind, unit) {
    const step = this.guideNow();
    if (!step || step.until !== kind) return;
    if (kind === 'select' && step.unit && unit?.tag !== step.unit) return;
    this.guideStep++;
    sound.play('capture');
    this.renderGuide();
  }

  drawGuide(ctx, size, now) {
    const step = this.guideNow();
    if (!step) return;
    let at = step.tile;
    if (step.unit) { const u = this.view.units.find(x => x.tag === step.unit); if (u) at = [u.x, u.y]; }
    if (!at) return;
    const pad = (Math.sin(now / 200) + 1) * this.scale;
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = Math.max(2, this.scale * 1.5);
    ctx.strokeRect(at[0] * size - pad, at[1] * size - pad, size + pad * 2, size + pad * 2);
  }

  // ---- pings and plans -----------------------------------------------------

  /** The seat whose pings we send: the one playing now on this device, or ours. */
  markSeat() {
    return this.acting() ?? this.viewer() ?? this.locals[0] ?? null;
  }

  openMarks() {
    const kinds = [['attack', 'Attack here'], ['help', 'Help!'], ['move', 'Going here'], ['danger', 'Watch out']];
    fill(this.menuEl,
      h('div', { class: 'title' }, 'Pings and plans'),
      h('div', { class: 'muted small' }, 'Only your allies see these.'),
      ...kinds.map(([k, label]) => h('button', { onclick: () => { this.menuEl.classList.add('hidden'); this.ui = { mode: 'ping', kind: k }; this.toast('Tap a tile.'); } }, label)),
      h('button', { onclick: () => { this.menuEl.classList.add('hidden'); this.ui = { mode: 'plan' }; this.toast('Tap where the arrow starts.'); } }, 'Draw a plan (arrow)'),
      h('button', { onclick: () => { this.menuEl.classList.add('hidden'); this.placeMark({ kind: 'clear' }); } }, 'Clear my plans'),
      h('button', { class: 'quiet', onclick: () => this.menuEl.classList.add('hidden') }, 'Close'));
    this.menuEl.classList.remove('hidden');
  }

  placeMark(mark) {
    const seat = this.markSeat();
    if (seat == null) return;
    mark = { ...mark, seat, day: this.view.day };
    if (this.sendMark) this.sendMark(mark); else this.addMark(mark);
  }

  /** A ping or plan arrived (ours, or an ally's through the host). */
  addMark(mark) {
    if (!mark || typeof mark.seat !== 'number') return;
    if (mark.kind === 'clear') { this.marks = this.marks.filter(m => m.seat !== mark.seat || m.kind !== 'plan'); return; }
    if (!['attack', 'help', 'move', 'danger', 'plan'].includes(mark.kind)) return;
    mark.t0 = performance.now();
    this.marks.push(mark);
    if (this.marks.length > 40) this.marks.shift();
    if (mark.kind !== 'plan') sound.play('tick');
    const words = { attack: 'wants to attack here', help: 'needs help', move: 'is going here', danger: 'warns of danger', plan: 'drew a plan' };
    this.say(`${this.playerName(mark.seat)} ${words[mark.kind]}`, mark.seat);
  }

  drawMarks(ctx, size, now) {
    const me = this.viewer();
    const icons = { attack: '⚔', help: '!', move: '➜', danger: '⚠' };
    this.marks = this.marks.filter(m => m.kind === 'plan' || now - m.t0 < 20000);
    for (const m of this.marks) {
      if (me != null && !this.allied(m.seat, me)) continue;
      const color = factionColor(this.rules, m.seat);
      const cx = (m.at[0] + 0.5) * size, cy = (m.at[1] + 0.5) * size;
      ctx.save();
      if (m.kind === 'plan' && m.to) {
        const tx = (m.to[0] + 0.5) * size, ty = (m.to[1] + 0.5) * size;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(3, this.scale * 2);
        ctx.setLineDash([size / 3, size / 5]);
        ctx.lineDashOffset = -now / 40;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.setLineDash([]);
        const a = Math.atan2(ty - cy, tx - cx), r = size * 0.4;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - Math.cos(a - 0.5) * r, ty - Math.sin(a - 0.5) * r);
        ctx.lineTo(tx - Math.cos(a + 0.5) * r, ty - Math.sin(a + 0.5) * r);
        ctx.closePath(); ctx.fill();
      } else {
        const age = (now - m.t0) / 20000, pulse = (now / 600) % 1;
        ctx.globalAlpha = Math.max(0.25, 1 - age);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, this.scale);
        ctx.beginPath(); ctx.arc(cx, cy, size * (0.35 + pulse * 0.5), 0, Math.PI * 2); ctx.globalAlpha *= 1 - pulse; ctx.stroke();
        ctx.globalAlpha = Math.max(0.25, 1 - age);
        ctx.fillStyle = '#1b1a26';
        ctx.beginPath(); ctx.arc(cx, cy - size * 0.55, size * 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color;
        ctx.font = `${Math.round(size * 0.36)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(icons[m.kind], cx, cy - size * 0.53);
      }
      ctx.restore();
    }
  }

  /** Alliances and truces: offers out, offers in, and leaving an alliance. */
  openDiplomacy() {
    const s = this.view;
    const me = this.acting() ?? this.viewer() ?? this.locals[0];
    if (me == null) return;
    const send = action => { this.menuEl.classList.add('hidden'); this.diplo(me, action); };
    const truce = (p) => (s.truces || []).find(t => (t.a === me && t.b === p) || (t.a === p && t.b === me));
    const rows = s.players.map((pl, p) => {
      if (p === me || !pl.alive) return null;
      const ally = this.allied(me, p), t = truce(p);
      const sent = (s.offers || []).find(o => o.from === me && o.to === p);
      const got = (s.offers || []).find(o => o.from === p && o.to === me);
      const status = ally ? 'Ally' : t ? `Truce until day ${t.until}` : 'At war';
      return h('div', { class: 'diplo-row', style: `--c:${factionColor(this.rules, p)}` },
        h('span', { class: 'dot' }), h('b', {}, this.playerName(p)), h('small', { class: 'muted' }, status),
        got ? h('span', { class: 'row' },
          h('small', {}, got.pact.type === 'alliance' ? 'offers an alliance' : `offers a ${got.pact.days}-day truce`),
          h('button', { class: 'primary', onclick: () => send({ type: 'accept', from: p }) }, 'Accept'),
          h('button', { onclick: () => send({ type: 'decline', from: p }) }, 'No'))
          : h('span', { class: 'row' },
            !ally && !t ? h('button', { disabled: !!sent, onclick: () => send({ type: 'offer', to: p, pact: { type: 'truce', days: 3 } }) }, 'Offer truce') : null,
            !ally ? h('button', { disabled: !!sent, onclick: () => send({ type: 'offer', to: p, pact: { type: 'alliance' } }) }, sent ? 'Offer sent' : 'Offer alliance') : null));
    });
    const allies = s.players.some((pl, p) => p !== me && pl.alive && this.allied(me, p));
    fill(this.menuEl, 
      h('div', { class: 'title' }, 'Diplomacy'),
      h('div', { class: 'muted small' }, 'Allies share what they see, cannot fight each other, and win together. A truce stops attacks and captures for a few days. You can do this at any time.'),
      h('div', { class: 'diplo' }, rows),
      allies ? h('button', { onclick: () => { if (confirm('Leave your alliance?')) send({ type: 'leave_alliance' }); } }, 'Leave the alliance') : null,
      h('button', { class: 'quiet', onclick: () => this.menuEl.classList.add('hidden') }, 'Close'));
    this.menuEl.classList.remove('hidden');
  }

  /** Diplomatic actions go through even when it is not our turn. */
  diplo(player, action) {
    if (this.driver) this.commit(player, action, { local: true });
    else this.send(player, action);
  }

  openPowers() {
    const r = this.rules, s = this.view;
    const me = this.acting() ?? this.viewer();
    if (me == null) return;
    const p = s.players[me];
    const usable = this.myTurn() && me === this.acting() && p.power == null;
    const items = r.powers.map(pw => h('button', {
      class: 'buy power-row', disabled: !usable || (p.charge || 0) < pw.charge, title: pw.description || '',
      onclick: () => { this.menuEl.classList.add('hidden'); this.submit({ type: 'power', power: pw.id }); },
    }, h('span', {}, h('b', {}, pw.name), h('small', { class: 'muted' }, pw.description || '')), h('b', {}, `${pw.charge}`)));
    fill(this.menuEl, 
      h('div', { class: 'title' }, `Powers · charge ${p.charge || 0}`),
      h('div', { class: 'muted small' }, p.power != null ? `${r.powers[p.power].name} is active until your next turn.` : 'Charge comes from damage you deal (and half of what you take). One power at a time; it lasts until your next turn.'),
      h('div', { class: 'buylist' }, items),
      h('button', { class: 'quiet', onclick: () => this.menuEl.classList.add('hidden') }, 'Close'));
    this.menuEl.classList.remove('hidden');
  }

  openBuild(x, y, builds) {
    const r = this.rules, s = this.view, me = this.acting();
    this.ui = { mode: 'build', at: { x, y } };
    const rows = builds.map(b => {
      const icon = h('canvas', { width: 32, height: 32 });
      const c = icon.getContext('2d');
      c.imageSmoothingEnabled = false;
      drawUnit(c, r, b.kind, me, 0, 0, 32);
      return h('button', {
        class: 'buy', disabled: !b.ok, title: r.units[b.kind].description,
        onclick: () => this.submit({ type: 'build', x, y, unit: r.units[b.kind].id }),
      }, icon, h('span', {}, r.units[b.kind].name), h('b', {}, `${b.cost}`));
    });
    fill(this.popup, h('div', { class: 'title' }, `Build · ${s.players[me].funds} funds`), h('div', { class: 'buylist' }, rows),
      h('button', { class: 'quiet', onclick: () => this.clearUi() }, 'Cancel'));
    this.placePopup(x, y);
  }

  openMenu() {
    const items = (this.menu || []).map(m => h('button', { onclick: () => { this.menuEl.classList.add('hidden'); m.action(); } }, m.label));
    const speeds = [['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']];
    const speedBtn = h('button', { onclick: () => {
      const i = speeds.findIndex(([v]) => v === Match.speed);
      const next = speeds[(i + 1) % speeds.length][0];
      try { localStorage.setItem('ot.speed', next); } catch { /* ignore */ }
      speedBtn.textContent = `Other players' moves: ${speeds.find(([v]) => v === next)[1]}`;
    } }, `Other players' moves: ${speeds.find(([v]) => v === Match.speed)?.[1] || 'Normal'}`);
    items.push(speedBtn);
    const musicBtn = h('button', { onclick: () => {
      sound.setMusic(!sound.musicEnabled());
      musicBtn.textContent = `Music: ${sound.musicEnabled() ? 'on' : 'off'}`;
    } }, `Music: ${sound.musicEnabled() ? 'on' : 'off'}`);
    items.push(musicBtn);
    items.push(h('button', { onclick: () => this.openSettings() }, 'Settings'));
    fill(this.menuEl, ...items, h('button', { class: 'quiet', onclick: () => this.menuEl.classList.add('hidden') }, 'Close'));
    this.menuEl.classList.toggle('hidden');
  }

  showResult() {
    if (this.resultShown) return;
    this.resultShown = true;
    const w = this.view.winner;
    const all = this.view.winners?.length ? this.view.winners : w == null ? [] : [w];
    sound.play('win');
    const m = this.view.mission;
    const text = m ? (all.includes(m.player) ? 'Mission complete' : 'Mission failed')
      : w == null ? 'Draw' : all.length > 1 ? `${all.map(p => this.playerName(p)).join(' & ')} win` : `${this.playerName(w)} wins`;
    this.say(`Game over: ${text}`, w ?? 0);
    fill(this.menuEl, 
      h('div', { class: 'title big', style: `color:${w == null ? '#fff' : factionColor(this.rules, w)}` }, text),
      h('div', { class: 'muted' }, `Day ${this.view.day}`),
      h('button', { onclick: () => this.showStats() }, 'Stats'),
      this.onWatch && !this.replay ? h('button', { onclick: () => this.onWatch(this.replayRecord()) }, 'Watch replay') : null,
      !this.replay ? h('button', { onclick: () => this.downloadReplay() }, 'Save replay') : null,
      !this.replay ? h('button', { onclick: () => this.shareReplay() }, 'Share replay link') : null,
      this.replay ? h('button', { onclick: () => this.menuEl.classList.add('hidden') }, 'Close') : null,
      ...(this.menu || []).map(m => h('button', { onclick: () => m.action() }, m.label)),
    );
    this.menuEl.classList.remove('hidden');
  }

  /** A panel over the board (for example: "send this link"). */
  showOverlay(el) {
    fill(this.menuEl, el);
    this.menuEl.classList.remove('hidden');
  }

  async shareReplay() {
    const url = await share.link('replay', this.replayRecord());
    const r = await share.offer(url, `OpenTactics replay: ${this.view.name}`);
    this.toast(r === 'failed' ? 'Could not copy the link.' : r === 'shared' ? 'Shared.' : 'Replay link copied.');
  }

  /** Everything needed to watch this game again. */
  replayRecord() {
    return {
      format: 'opentactics-replay', version: 1, name: this.view.name, date: new Date().toISOString(),
      rules: this.rules, seats: this.seats.map((st, i) => ({ name: this.playerName(i), ai: !!st?.ai })),
      start: this.record.start, actions: this.record.actions,
    };
  }

  downloadReplay() {
    const rec = this.replayRecord();
    const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${(rec.name || 'game').replace(/\W+/g, '-').toLowerCase()}-replay.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  showStats() {
    const names = this.view.players.map((_, i) => this.playerName(i));
    const snaps = this.replay?.stats || this.stats;
    fill(this.menuEl, 
      h('div', { class: 'title' }, `${this.view.name} · stats`),
      statsView(this.rules, snaps, names),
      h('button', { onclick: () => { this.resultShown = false; this.showResult(); } }, 'Back'));
    this.menuEl.classList.remove('hidden');
  }

  showInfo(tx, ty) {
    const r = this.rules, ui = this.ui;
    const parts = [];
    if (ui.mode === 'target' && this.hover) {
      const t = ui.options.targets.find(t => t.x === this.hover.x && t.y === this.hover.y);
      if (t) parts.push(h('div', { class: 'forecast' },
        h('div', {}, 'Deal ', h('b', {}, `${t.min}–${t.max}%`)),
        h('div', {}, 'Take ', h('b', {}, `${t.counter}%`))));
    }
    const at = this.hover || (tx != null ? { x: tx, y: ty } : null);
    const unit = ui.unit && ui.mode !== 'inspect' && !this.hover ? ui.unit : at && this.unitAt(at.x, at.y);
    if (unit) {
      const d = r.units[unit.kind];
      const icon = h('canvas', { width: 48, height: 48 });
      const c = icon.getContext('2d');
      c.imageSmoothingEnabled = false;
      drawUnit(c, r, unit.kind, unit.player, 0, 0, 48);
      parts.push(h('div', { class: 'card', style: `--c:${factionColor(r, unit.player)}` }, icon,
        h('div', {}, h('b', {}, d.name), h('div', { class: 'muted' }, this.playerName(unit.player)),
          h('div', { class: 'hp' }, h('i', { style: `width:${unit.hp}%` })),
          h('div', { class: 'stats' }, `HP ${Math.ceil(unit.hp / 10)}/10 · Move ${d.moves} · Range ${d.range ? (d.range[0] === d.range[1] ? d.range[0] : d.range.join('–')) : 1}`),
          this.view.options?.supply && (d.fuel || d.ammo) ? h('div', { class: 'stats' },
            [d.fuel ? `Fuel ${unit.fuel}/${d.fuel}` : null, d.ammo ? `Ammo ${unit.ammo}/${d.ammo}` : null].filter(Boolean).join(' · ')) : null,
          unit.cargo?.length ? h('div', { class: 'stats' }, `Carrying ${unit.cargo.map(c => r.units[c.kind].name).join(', ')}`)
            : d.carry?.length ? h('div', { class: 'stats muted' }, `Carries ${d.carry.map(id => r.units.find(x => x.id === id)?.name).join(', ')}`) : null,
          unit.dived ? h('div', { class: 'stats' }, 'Dived: hidden from enemies not next to it') : null,
          this.view.options?.ranks ? h('div', { class: 'stats' }, this.rankOf(unit) ? `Rank ${this.rankOf(unit)} · ${unit.xp} XP` : `${unit.xp || 0} XP`) : null,
          d.description ? h('div', { class: 'muted small' }, d.description) : null)));
    }
    if (at) {
      const t = this.terrainAt(at.x, at.y);
      const owner = this.ownerAt(at.x, at.y);
      const lines = [h('b', {}, t.name), h('span', { class: 'stars' }, '★'.repeat(t.defense) + '☆'.repeat(Math.max(0, 4 - t.defense)))];
      if (t.capturable) lines.push(h('div', { class: 'muted' }, owner >= 0 ? `Held by ${this.playerName(owner)}` : 'Neutral', t.income ? ` · +${t.income}/day` : ''));
      if (t.builds?.length) lines.push(h('div', { class: 'muted small' }, `Builds ${t.builds.join(', ')} units`));
      const here = this.unitAt(at.x, at.y);
      if (here?.capture) lines.push(h('div', { class: 'small' }, `Capture ${here.capture}/${r.capture.points}`));
      parts.push(h('div', { class: 'terrain' }, ...lines));
    }
    if (!parts.length) {
      const s = this.view;
      const tip = s.over ? 'The game is over.'
        : this.myTurn() ? (matchMedia('(pointer: coarse)').matches
          ? 'Your turn. Tap a unit, or a factory you own to build. Tap outside the highlighted tiles to cancel.'
          : 'Your turn. Pick a unit, or a factory you own to build. Right-click or Esc cancels; E ends the turn.')
        : this.pending ? 'Sending…' : `Waiting for ${this.active().filter(p => !this.locals.includes(p)).map(p => this.playerName(p)).join(', ') || this.playerName(s.turn)}.`;
      parts.push(h('p', { class: 'muted' }, tip));
    }
    fill(this.info, ...parts);
  }

  // ---- drawing -----------------------------------------------------------

  loop(now) {
    if (!this.alive) return;
    this.pollGamepad(now);
    this.draw(now);
    if (!this.lastMini || now - this.lastMini > 200) { this.lastMini = now; this.drawMinimap(); }
    requestAnimationFrame(this.loop);
  }

  draw(now) {
    const ctx = this.ctx, s = this.view, r = this.rules, size = T * this.scale, ui = this.ui;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    const sh = this.anim.shake;
    if (sh) {
      const t = (now - sh.t0) / sh.dur;
      if (t >= 1) this.anim.shake = null;
      else {
        const m = sh.amp * this.scale * 2.5 * (1 - t);
        ctx.fillStyle = '#12111b';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.translate(Math.round(Math.sin(now * 0.09) * m), Math.round(Math.cos(now * 0.11) * m));
      }
    }
    ctx.drawImage(this.layer, 0, 0, s.width * size, s.height * size);
    this.drawWater(ctx, s, size, now);

    const shade = (set, fill, stroke) => {
      if (!set) return;
      ctx.fillStyle = fill;
      for (const k of set) {
        const [x, y] = k.split(',').map(Number);
        ctx.fillRect(x * size, y * size, size, size);
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(1, this.scale / 2);
        for (const k of set) {
          const [x, y] = k.split(',').map(Number);
          ctx.strokeRect(x * size + 1, y * size + 1, size - 2, size - 2);
        }
      }
    };
    if (ui.mode === 'select' || ui.mode === 'menu' || ui.mode === 'inspect') {
      const pulse = 0.28 + 0.08 * Math.sin(now / 250);
      const own = ui.mode !== 'inspect';
      const threatOnly = new Set([...ui.threat].filter(k => !ui.stops.has(k)));
      shade(threatOnly, `rgba(232,70,60,${own ? 0.22 : 0.3})`);
      shade(ui.stops, own ? `rgba(255,255,255,${pulse})` : 'rgba(255,255,255,0.18)', own ? 'rgba(255,255,255,0.35)' : null);
    }
    if (ui.mode === 'drop' && ui.dropTiles) shade(ui.dropTiles, `rgba(140,220,255,${0.3 + 0.1 * Math.sin(now / 250)})`, 'rgba(140,220,255,0.6)');
    if (ui.mode === 'target') {
      ctx.globalAlpha = 0.75;
      for (const t of ui.options.targets) drawTile(ctx, 79, t.x * size, t.y * size, size);
      ctx.globalAlpha = 1;
    }
    if (ui.path && ui.path.length > 1 && ui.mode !== 'target' && ui.mode !== 'drop') this.drawPath(ui.path, factionColor(r, ui.unit.player));

    // Battle royale: tint everything outside the safe circle.
    if (s.storm != null) {
      const cx = (s.width - 1) / 2, cy = (s.height - 1) / 2;
      ctx.fillStyle = `rgba(150,70,220,${0.28 + 0.05 * Math.sin(now / 400)})`;
      for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
        if (Math.hypot(x - cx, y - cy) > s.storm) ctx.fillRect(x * size, y * size, size, size);
      }
      ctx.strokeStyle = 'rgba(220,180,255,0.8)';
      ctx.lineWidth = Math.max(2, this.scale);
      ctx.beginPath();
      ctx.arc((cx + 0.5) * size, (cy + 0.5) * size, (s.storm + 0.5) * size, 0, Math.PI * 2);
      ctx.stroke();
    }
    // King of the hill: the hill.
    if (s.hill) {
      const [hx, hy] = s.hill;
      const holder = s.hold ? s.players.findIndex((_, p) => this.team(p) === s.hold[0]) : -1;
      ctx.strokeStyle = holder >= 0 ? factionColor(r, holder) : `rgba(255,255,255,${0.6 + 0.3 * Math.sin(now / 300)})`;
      ctx.lineWidth = Math.max(2, this.scale);
      ctx.strokeRect(hx * size + 1, hy * size + 1, size - 2, size - 2);
      drawTile(ctx, 194, hx * size + size / 2, hy * size, size / 2);
    }

    // Fog of war: darken what this side cannot see.
    if (this.hidden.size) {
      ctx.fillStyle = 'rgba(10,10,24,0.5)';
      for (const i of this.hidden) ctx.fillRect((i % s.width) * size, Math.floor(i / s.width) * size, size, size);
    }

    const supply = s.options?.supply;
    const actNow = this.active();
    const symbols = settings.get().symbols;
    // Army symbols on owned property (top right of the tile).
    if (symbols) {
      for (let i = 0; i < s.owner.length; i++) {
        if (s.owner[i] < 0) continue;
        const x = i % s.width, y = Math.floor(i / s.width);
        settings.drawSymbol(ctx, s.owner[i], x * size + size * 0.8, y * size + size * 0.2, size * 0.2, '#1b1a26');
        settings.drawSymbol(ctx, s.owner[i], x * size + size * 0.8, y * size + size * 0.2, size * 0.14, factionColor(r, s.owner[i]));
      }
    }
    for (const u of s.units) {
      if (this.anim.blink === u.id && Math.floor(now / 70) % 2) continue;
      const ghost = ui.mode === 'menu' || ui.mode === 'target' || ui.mode === 'drop' ? ui.unit?.id === u.id : false;
      let x = ghost ? ui.dest.x : u.x, y = ghost ? ui.dest.y : u.y;
      const lg = this.anim.lunge;
      if (lg?.id === u.id) {
        const t = (now - lg.t0) / lg.dur;
        if (t >= 1) this.anim.lunge = null;
        else { const k = Math.sin(Math.PI * t) * 0.3; x += lg.dir[0] * k; y += lg.dir[1] * k; }
      }
      if (u.dived) ctx.globalAlpha = 0.5;
      // Units that can still act this turn breathe a little.
      const bob = !u.moved && actNow.includes(u.player) && !calm() ? Math.round(Math.sin(now / 380 + u.id) * this.scale * 0.5) : 0;
      drawUnit(ctx, r, u.kind, u.player, x * size, y * size + bob, size, u.moved && actNow.includes(u.player));
      ctx.globalAlpha = 1;
      const hp = Math.ceil(u.hp / 10);
      if (hp < 10) drawTile(ctx, 180 + hp, x * size + size / 2, y * size + size / 2, size / 2);
      if (u.capture > 0) drawTile(ctx, 194, x * size, y * size + size / 2, size / 2);
      else if (symbols) {
        settings.drawSymbol(ctx, u.player, x * size + size * 0.19, y * size + size * 0.81, size * 0.2, '#1b1a26');
        settings.drawSymbol(ctx, u.player, x * size + size * 0.19, y * size + size * 0.81, size * 0.14, factionColor(r, u.player));
      }
      const rank = this.rankOf(u);
      if (rank) {
        ctx.fillStyle = '#1b1a26';
        ctx.fillRect(x * size, y * size + size * 0.36, size * 0.2, size * 0.1 * rank + size * 0.04);
        ctx.fillStyle = '#ffd34d';
        for (let k = 0; k < rank; k++) ctx.fillRect(x * size + size * 0.03, y * size + size * (0.38 + 0.1 * k), size * 0.14, size * 0.06);
      }
      if (u.cargo?.length) {
        ctx.fillStyle = '#1b1a26';
        ctx.fillRect(x * size + size * 0.66, y * size, size * 0.34, size * 0.3);
        ctx.fillStyle = '#fff';
        ctx.font = canvasFont(size * 0.28, 'mono');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(u.cargo.length), x * size + size * 0.83, y * size + size * 0.16);
      }
      if (supply) {
        const d = r.units[u.kind];
        const low = (d.fuel && u.fuel <= Math.max(d.fuel / 4, (d.fuel_per_day || 0) * 2)) || (d.ammo && u.ammo === 0);
        if (low && this.allied(u.player, this.viewer() ?? u.player)) drawTile(ctx, d.ammo && u.ammo === 0 ? 191 : 192, x * size, y * size + size / 2, size / 2);
      }
    }

    // A hint's destination.
    if (this.hintShown?.at) {
      const [hx, hy] = this.hintShown.at;
      ctx.strokeStyle = `rgba(140,220,255,${0.6 + 0.35 * Math.sin(now / 200)})`;
      ctx.lineWidth = Math.max(2, this.scale * 1.5);
      ctx.strokeRect(hx * size + 2, hy * size + 2, size - 4, size - 4);
    }
    // Mission targets.
    for (const g of [...(s.mission?.goals || []), ...(s.mission?.fail || [])]) {
      if (g.x == null) continue;
      const bad = s.mission.fail.includes(g);
      ctx.strokeStyle = bad ? 'rgba(255,122,107,0.9)' : `rgba(243,192,70,${0.6 + 0.3 * Math.sin(now / 300)})`;
      ctx.lineWidth = Math.max(2, this.scale);
      ctx.setLineDash([size / 6, size / 8]);
      ctx.strokeRect(g.x * size + 2, g.y * size + 2, size - 4, size - 4);
      ctx.setLineDash([]);
    }

    if (this.hover && (this.myTurn() || ui.mode === 'inspect' || ui.mode === 'idle')) {
      drawTile(ctx, 61, this.hover.x * size, this.hover.y * size, size);
    }

    this.anim.effects = this.anim.effects.filter(fx => now - fx.t0 < fx.dur);
    for (const fx of this.anim.effects) {
      const t = (now - fx.t0) / fx.dur;
      if (fx.kind === 'text') {
        ctx.font = canvasFont(Math.max(10, (fx.big ? 8 : 6) * this.scale));
        ctx.textAlign = 'center';
        ctx.lineWidth = Math.max(2, this.scale);
        ctx.strokeStyle = '#1b1a26';
        const px = (fx.at[0] + 0.5) * size, py = (fx.at[1] + 0.2) * size - t * size * 0.6;
        ctx.globalAlpha = Math.min(1, 2 - 2 * t);
        ctx.strokeText(fx.text, px, py);
        ctx.fillStyle = fx.color;
        ctx.fillText(fx.text, px, py);
        ctx.globalAlpha = 1;
      } else if (fx.kind === 'boom') {
        const cx = (fx.at[0] + 0.5) * size, cy = (fx.at[1] + 0.5) * size;
        for (let i = 0; i < 7; i++) {
          const a = i * 0.9 + fx.t0, rad = t * size * (0.4 + 0.15 * (i % 3));
          ctx.fillStyle = i % 2 ? `rgba(255,200,80,${1 - t})` : `rgba(240,90,50,${1 - t})`;
          const sz = (1 - t) * size * 0.3;
          ctx.fillRect(cx + Math.cos(a) * rad - sz / 2, cy + Math.sin(a) * rad - sz / 2, sz, sz);
        }
      } else if (fx.kind === 'shot') {
        const [ax, ay] = fx.from, [bx, by] = fx.to;
        const px = (ax + (bx - ax) * t + 0.5) * size, py = (ay + (by - ay) * t + 0.5) * size - Math.sin(t * Math.PI) * size * 0.4 * Math.min(3, Math.abs(bx - ax) + Math.abs(by - ay) - 1);
        ctx.fillStyle = '#fff6c0';
        ctx.fillRect(px - this.scale * 1.5, py - this.scale * 1.5, this.scale * 3, this.scale * 3);
      } else if (fx.kind === 'flash') {
        const cx = (fx.at[0] + 0.5 + fx.dir[0] * 0.45) * size, cy = (fx.at[1] + 0.5 + fx.dir[1] * 0.45) * size;
        ctx.fillStyle = `rgba(255,240,170,${1 - t})`;
        ctx.beginPath();
        ctx.arc(cx, cy, size * (0.12 + 0.18 * (1 - t)), 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === 'shell' || fx.kind === 'missile') {
        const [ax, ay] = fx.from, [bx, by] = fx.to;
        const dist = Math.abs(bx - ax) + Math.abs(by - ay);
        const arc = fx.kind === 'shell' ? size * 0.35 * Math.min(4, dist) : 0;
        for (let k = 0; k < 6; k++) {
          const tt = Math.max(0, t - k * 0.05);
          const px = (ax + (bx - ax) * tt + 0.5) * size, py = (ay + (by - ay) * tt + 0.5) * size - Math.sin(tt * Math.PI) * arc;
          ctx.fillStyle = k === 0 ? '#fff6c0' : `rgba(${fx.kind === 'missile' ? '255,170,90' : '220,220,230'},${0.5 - k * 0.08})`;
          const sz = this.scale * (k === 0 ? 3 : 2.2 - k * 0.25);
          ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
        }
      } else if (fx.kind === 'impact') {
        const cx = (fx.at[0] + 0.5) * size, cy = (fx.at[1] + 0.5) * size;
        ctx.strokeStyle = `rgba(255,230,150,${1 - t})`;
        ctx.lineWidth = Math.max(2, this.scale * 1.5 * (1 - t));
        ctx.beginPath();
        ctx.arc(cx, cy, size * (0.15 + 0.4 * t), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - t) ** 2})`;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.22 * (1 - t), 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === 'smoke') {
        const cx = (fx.at[0] + 0.5) * size, cy = (fx.at[1] + 0.5) * size;
        for (let i = 0; i < 5; i++) {
          const k = Math.min(1, Math.max(0, t * 1.3 - i * 0.08));
          const sz = size * (0.12 + 0.25 * k);
          ctx.fillStyle = `rgba(70,68,80,${0.55 * (1 - k)})`;
          ctx.fillRect(cx + (i - 2) * size * 0.12 - sz / 2, cy - k * size * 0.8 - sz / 2, sz, sz);
        }
      } else if (fx.kind === 'sparkle') {
        for (let i = 0; i < 6; i++) {
          const px = (fx.at[0] + 0.15 + (i % 3) * 0.33) * size, py = (fx.at[1] + 0.85 - t * 0.7 - (i > 2 ? 0.2 : 0)) * size;
          ctx.fillStyle = `rgba(150,255,150,${1 - t})`;
          const sz = this.scale * 1.5;
          ctx.fillRect(px - sz, py - sz / 3, sz * 2, sz * 0.66);
          ctx.fillRect(px - sz / 3, py - sz, sz * 0.66, sz * 2);
        }
      } else if (fx.kind === 'screen') {
        ctx.fillStyle = fx.color;
        ctx.globalAlpha = 0.35 * (1 - t);
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.globalAlpha = 1;
      } else if (fx.kind === 'ring') {
        ctx.strokeStyle = fx.color;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = this.scale;
        const pad = (1 - t) * size * 0.3;
        ctx.strokeRect(fx.at[0] * size - pad, fx.at[1] * size - pad, size + 2 * pad, size + 2 * pad);
        ctx.globalAlpha = 1;
      }
    }
    this.drawMarks(ctx, size, now);
    this.drawGuide(ctx, size, now);
    this.drawWeather(ctx, s, size, now);
    ctx.restore();
  }

  /** Little glints that drift across visible water. */
  drawWater(ctx, s, size, now) {
    if (calm()) return;
    if (!this.waterTiles || this.waterFor !== s.terrain) {
      this.waterFor = s.terrain;
      this.waterTiles = [];
      for (let i = 0; i < s.terrain.length; i++) if (this.rules.terrains[s.terrain[i]].view?.base === 'water') this.waterTiles.push(i);
    }
    const sc = this.scroller, x0 = (sc.scrollLeft - this.canvas.offsetLeft) / size - 1, y0 = (sc.scrollTop - this.canvas.offsetTop) / size - 1;
    const x1 = x0 + sc.clientWidth / size + 2, y1 = y0 + sc.clientHeight / size + 2;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const px = this.scale;
    for (const i of this.waterTiles) {
      const x = i % s.width, y = Math.floor(i / s.width);
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const phase = (now / 1800 + ((x * 7 + y * 13) % 10) / 10) % 1;
      if (phase > 0.5) continue;
      const k = phase * 2;
      ctx.globalAlpha = Math.sin(k * Math.PI) * 0.6;
      ctx.fillRect(x * size + ((x * 5 + y * 3) % 10 + 2) * px + k * 3 * px, y * size + ((x * 3 + y * 7) % 11 + 2) * px, 3 * px, px);
    }
    ctx.globalAlpha = 1;
  }

  /** Rain or snow falling over the board. */
  drawWeather(ctx, s, size, now) {
    const w = this.rules.weather?.[s.weather];
    if (!w || !s.weather || calm()) return;
    const sc = this.scroller;
    const vx = sc.scrollLeft - this.canvas.offsetLeft, vy = sc.scrollTop - this.canvas.offsetTop;
    const W = sc.clientWidth, H = sc.clientHeight;
    const snow = w.id === 'snow';
    const n = Math.round(W * H / (snow ? 2200 : 3000));
    ctx.save();
    ctx.translate(vx, vy);
    ctx.fillStyle = snow ? 'rgba(255,255,255,0.9)' : 'rgba(190,215,255,0.55)';
    ctx.strokeStyle = 'rgba(190,215,255,0.55)';
    ctx.lineWidth = Math.max(1, this.scale / 2);
    for (let i = 0; i < n; i++) {
      const seed = (i * 9301 + 49297) % 233280 / 233280, seed2 = (i * 4093 + 7) % 1000 / 1000;
      if (snow) {
        const t = (now / 9000 + seed) % 1;
        const x = ((seed2 * W + Math.sin(now / 900 + i) * 12) % W + W) % W, y = t * H;
        const r = (1.5 + (i % 3)) * this.scale * 0.7;
        ctx.fillStyle = 'rgba(120,140,170,0.5)';
        ctx.fillRect(x + 1, y + 1, r, r);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillRect(x, y, r, r);
      } else {
        const t = (now / 700 + seed) % 1;
        const x = (seed2 * W + t * 60) % W, y = t * H;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 4 * this.scale, y + 12 * this.scale);
        ctx.stroke();
      }
    }
    ctx.fillStyle = snow ? 'rgba(255,255,255,0.08)' : 'rgba(40,60,110,0.12)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  openSettings() {
    fill(this.menuEl, settings.settingsPanel(h, () => { this.menuEl.classList.add('hidden'); this.updateHud(); }));
    this.menuEl.classList.remove('hidden');
  }

  /** A small overview of the whole map: terrain, property, units, and the view. */
  drawMinimap() {
    const s = this.view, sc = this.scroller, mm = this.minimap;
    const big = this.canvas.width > sc.clientWidth + 4 || this.canvas.height > sc.clientHeight + 4;
    mm.classList.toggle('hidden', !big);
    if (!big) return;
    const px = Math.max(2, Math.floor(150 / Math.max(s.width, s.height)));
    if (mm.width !== s.width * px || mm.height !== s.height * px) { mm.width = s.width * px; mm.height = s.height * px; this.miniBase = null; }
    const ctx = mm.getContext('2d');
    const ownerKey = s.owner.join();
    if (!this.miniBase || this.miniOwners !== ownerKey) {
      this.miniOwners = ownerKey;
      const base = document.createElement('canvas');
      base.width = mm.width; base.height = mm.height;
      const b = base.getContext('2d');
      for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
        const i = y * s.width + x, t = this.rules.terrains[s.terrain[i]], v = t.view || {};
        b.fillStyle = t.capturable ? (s.owner[i] >= 0 ? factionColor(this.rules, s.owner[i]) : '#d6d6de')
          : v.reef ? '#3f93c4' : v.base === 'water' ? '#5cc0ec' : v.base === 'sand' ? '#e7d396'
          : v.auto ? '#8f8fa0' : t.id === 'mountain' ? '#a07c58' : t.id === 'forest' ? '#3f8a45' : '#7fca62';
        b.fillRect(x * px, y * px, px, px);
      }
      this.miniBase = base;
    }
    ctx.drawImage(this.miniBase, 0, 0);
    if (this.hidden.size) {
      ctx.fillStyle = 'rgba(10,10,24,0.45)';
      for (const i of this.hidden) ctx.fillRect((i % s.width) * px, Math.floor(i / s.width) * px, px, px);
    }
    for (const u of s.units) {
      ctx.fillStyle = '#111';
      ctx.fillRect(u.x * px - 1, u.y * px - 1, px + 2, px + 2);
      ctx.fillStyle = factionColor(this.rules, u.player);
      ctx.fillRect(u.x * px, u.y * px, px, px);
    }
    const size = T * this.scale;
    const vx = (sc.scrollLeft - this.canvas.offsetLeft) / size, vy = (sc.scrollTop - this.canvas.offsetTop) / size;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx * px, vy * px, sc.clientWidth / size * px, sc.clientHeight / size * px);
  }

  drawPath(path, color) {
    const ctx = this.ctx, size = T * this.scale;
    const c = p => [(p[0] + 0.5) * size, (p[1] + 0.5) * size];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [w, col] of [[size * 0.34, '#1b1a26'], [size * 0.2, color]]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(...c(path[0]));
      for (const p of path.slice(1)) ctx.lineTo(...c(p));
      ctx.stroke();
    }
    const [ex, ey] = c(path[path.length - 1]);
    const [px, py] = c(path[path.length - 2]);
    const ang = Math.atan2(ey - py, ex - px), r = size * 0.32;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#1b1a26';
    ctx.lineWidth = this.scale;
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(ang) * r, ey + Math.sin(ang) * r);
    ctx.lineTo(ex + Math.cos(ang + 2.4) * r, ey + Math.sin(ang + 2.4) * r);
    ctx.lineTo(ex + Math.cos(ang - 2.4) * r, ey + Math.sin(ang - 2.4) * r);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }
}

export { h, $ };

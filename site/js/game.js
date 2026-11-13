// The battle screen: drawing, input and animation for one match.
//
// The engine holds the true game. `view` is what the screen shows, which
// trails the engine while events are being animated. Every action, whether it
// comes from this player, the computer or a peer, goes through `commit`, so
// all of them are applied and animated in the same order.

import { T, drawTile, drawUnit, factionColor, terrainLayer } from './art.js';
import { fingerprint } from './engine.js';
import * as sound from './sound.js';

const $ = (sel, root = document) => root.querySelector(sel);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (x, y) => `${x},${y}`;

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
    this.build();
    window.__match = this; // handy in the console
    this.setState(o.state);
    this.fit();
    const first = this.seats[this.view.turn]?.local ? this.view.turn : this.seats.findIndex(x => x?.local);
    if (first >= 0) requestAnimationFrame(() => this.focusPlayer(first, false));
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.banner(`Day ${this.view.day}`, this.playerName(this.view.turn), factionColor(this.rules, this.view.turn));
    this.afterIdle();
  }

  destroy() {
    this.alive = false;
    clearTimeout(this.aiTimer);
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
    this.soundBtn = h('button', { class: 'icon', title: 'Sound', onclick: () => { sound.setMuted(!sound.isMuted()); this.soundBtn.textContent = sound.isMuted() ? '🔇' : '🔊'; } }, sound.isMuted() ? '🔇' : '🔊');
    this.info = h('div', { class: 'info' });
    this.logEl = h('ol', { class: 'log' });
    this.netEl = h('div', { class: 'net hidden' });
    this.popup = h('div', { class: 'popup hidden' });
    this.toastEl = h('div', { class: 'toast hidden' });
    this.bannerEl = h('div', { class: 'banner hidden' });
    this.menuEl = h('div', { class: 'popup menu hidden' });
    const menuBtn = h('button', { class: 'icon', title: 'Menu', onclick: () => this.openMenu() }, '☰');
    const zoomIn = h('button', { class: 'icon', title: 'Zoom in', onclick: () => this.zoom(1) }, '+');
    const zoomOut = h('button', { class: 'icon', title: 'Zoom out', onclick: () => this.zoom(-1) }, '−');
    this.root.replaceChildren(
      h('header', { class: 'hud' }, menuBtn, this.dayEl, this.players, h('div', { class: 'spacer' }), zoomOut, zoomIn, this.soundBtn, this.endBtn),
      h('main', { class: 'field' },
        h('div', { class: 'stage' }, this.scroller, this.popup, this.bannerEl, this.toastEl, this.menuEl),
        h('aside', { class: 'side' }, this.netEl, this.info, h('h3', {}, 'Log'), this.logEl)),
    );
    this.ctx = this.canvas.getContext('2d');

    const tileAt = e => {
      const b = this.canvas.getBoundingClientRect();
      const size = T * this.scale;
      const x = Math.floor((e.clientX - b.left) / size), y = Math.floor((e.clientY - b.top) / size);
      return x >= 0 && y >= 0 && x < this.view.width && y < this.view.height ? { x, y } : null;
    };
    this.canvas.addEventListener('pointermove', e => {
      const t = tileAt(e);
      if (key(t?.x, t?.y) !== key(this.hover?.x, this.hover?.y)) { this.hover = t; this.onHover(); }
    });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.onHover(); });
    this.canvas.addEventListener('click', e => { const t = tileAt(e); if (t) this.onClick(t.x, t.y); });
    this.canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.cancel(); });
    this.onKey = e => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.key === 'Escape') this.cancel();
      if (e.key === 'e' || e.key === 'E') this.endTurn();
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
    const size = T * this.scale, sc = this.scroller;
    const left = this.canvas.offsetLeft + (at.x + 0.5) * size - sc.clientWidth / 2;
    const top = this.canvas.offsetTop + (at.y + 0.5) * size - sc.clientHeight / 2;
    sc.scrollTo({ left, top, behavior: smooth ? 'smooth' : 'auto' });
  }

  zoom(d) {
    this.zoomed = true;
    this.scale = Math.max(1, Math.min(6, this.scale + d));
    this.resize();
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
    const owners = state.owner.join(',');
    if (owners !== this.ownersDrawn) {
      this.ownersDrawn = owners;
      this.layer = terrainLayer(this.rules, state, this.layer);
    }
    this.updateHud();
  }

  playerName(p) {
    return this.seats[p]?.name || this.rules.factions[p].name;
  }

  myTurn() {
    const s = this.view;
    return !s.over && !this.busy && !this.pending && this.queue.length === 0 && !!this.seats[s.turn]?.local;
  }

  unitAt(x, y) { return this.view.units.find(u => u.x === x && u.y === y); }
  terrainAt(x, y) { return this.rules.terrains[this.view.terrain[y * this.view.width + x]]; }
  ownerAt(x, y) { return this.view.owner[y * this.view.width + x]; }

  updateHud() {
    const s = this.view, r = this.rules;
    this.dayEl.textContent = `Day ${s.day}`;
    this.players.replaceChildren(...s.players.map((p, i) => h('div', {
      class: `chip${i === s.turn && !s.over ? ' active' : ''}${p.alive ? '' : ' out'}`,
      style: `--c:${factionColor(r, i)}`,
      title: `${this.playerName(i)}: ${s.units.filter(u => u.player === i).length} units`,
    }, h('span', { class: 'dot' }), h('b', {}, this.playerName(i)), h('span', { class: 'funds' }, `${p.funds}`),
      this.income[i] != null ? h('small', {}, `+${this.income[i]}`) : null,
      this.seats[i]?.ai ? h('small', { class: 'tag' }, 'CPU') : null)));
    const mine = this.myTurn();
    this.endBtn.disabled = !mine;
    this.endBtn.textContent = s.over ? 'Game over' : mine ? 'End turn' : this.seats[s.turn]?.local ? 'Wait…' : `${this.playerName(s.turn)}…`;
    this.showInfo();
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
      this.onApplied?.(player, action, res.state, hash);
      if (meta.mine) this.pending = false;
      await this.animate(res.events, this.seats[player]?.ai || !this.seats[player]?.local);
      this.setState(res.state, res.income);
    }
    this.busy = false;
    this.afterIdle();
  }

  afterIdle() {
    if (!this.alive) return;
    this.updateHud();
    const s = this.view;
    if (s.over) return this.showResult();
    if (this.driver && this.seats[s.turn]?.ai && !this.busy) {
      clearTimeout(this.aiTimer);
      this.aiTimer = setTimeout(() => this.aiStep(), 180);
    }
  }

  aiStep() {
    if (!this.alive || this.busy || this.queue.length || this.view.over || !this.seats[this.view.turn]?.ai) return;
    let action;
    try {
      action = this.engine.call({ op: 'ai' }).action;
    } catch (e) {
      action = { type: 'end_turn' };
    }
    this.commit(this.view.turn, action);
  }

  /** This player chose an action. */
  submit(action) {
    if (!this.myTurn()) return;
    this.clearUi();
    const player = this.view.turn;
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
    this.setState(state, income);
    this.afterIdle();
  }

  endTurn() {
    if (this.myTurn()) this.submit({ type: 'end_turn' });
  }

  // ---- animation ---------------------------------------------------------

  async animate(events, fast) {
    const s = structuredClone(this.view);
    this.view = s;
    const speed = fast ? 55 : 80;
    for (const ev of events) {
      if (!this.alive) return;
      const unit = id => s.units.find(u => u.id === id);
      switch (ev.e) {
        case 'move': {
          const u = unit(ev.unit);
          if (!u) break;
          sound.play('move');
          const steps = ev.path.length - 1;
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
          if (!a || !d) break;
          sound.play('attack');
          this.effect({ kind: 'shot', from: [a.x, a.y], to: [d.x, d.y], dur: 220, color: factionColor(this.rules, a.player) });
          await sleep(fast ? 150 : 220);
          this.anim.blink = d.id;
          this.effect({ kind: 'text', at: [d.x, d.y], text: `-${ev.damage}%`, color: '#fff2a8', dur: 900 });
          d.hp = ev.hp;
          a.moved = a.moved || !ev.counter;
          await sleep(fast ? 280 : 420);
          this.anim.blink = null;
          this.say(`${this.unitName(a)} hits ${this.unitName(d)} for ${ev.damage}%${ev.counter ? ' (counter)' : ''}`, a.player);
          break;
        }
        case 'destroy': {
          sound.play('destroy');
          this.effect({ kind: 'boom', at: [ev.x, ev.y], dur: 600 });
          const gone = unit(ev.unit);
          s.units = s.units.filter(u => u.id !== ev.unit);
          if (gone) this.say(`${this.unitName(gone)} destroyed`, gone.player);
          await sleep(fast ? 250 : 400);
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
          await sleep(fast ? 300 : 500);
          break;
        }
        case 'build': {
          sound.play('build');
          s.units.push({ ...ev.unit });
          s.players[ev.unit.player].funds -= this.rules.units[ev.unit.kind].cost;
          this.updateHud();
          this.effect({ kind: 'ring', at: [ev.unit.x, ev.unit.y], dur: 400, color: factionColor(this.rules, ev.unit.player) });
          this.say(`${this.playerName(ev.unit.player)} builds ${this.rules.units[ev.unit.kind].name}`, ev.unit.player);
          await sleep(fast ? 150 : 250);
          break;
        }
        case 'repair': {
          const u = unit(ev.unit);
          if (u) {
            u.hp = ev.hp;
            this.effect({ kind: 'text', at: [u.x, u.y], text: '+', color: '#9dff9d', dur: 700 });
          }
          break;
        }
        case 'turn': {
          for (const u of s.units) u.moved = false;
          s.turn = ev.player;
          s.day = ev.day;
          this.updateHud();
          sound.play('turn');
          if (this.seats[ev.player]?.local) this.focusPlayer(ev.player);
          this.banner(`Day ${ev.day}`, this.playerName(ev.player), factionColor(this.rules, ev.player));
          this.say(`Day ${ev.day}: ${this.playerName(ev.player)} (+${ev.income})`, ev.player);
          break;
        }
        case 'defeat':
          this.say(`${this.playerName(ev.player)} is defeated`, ev.player);
          this.banner('Defeated', this.playerName(ev.player), factionColor(this.rules, ev.player));
          await sleep(900);
          break;
        case 'over':
          break;
      }
    }
  }

  unitName(u) {
    return `${this.rules.factions[u.player]?.name ?? ''} ${this.rules.units[u.kind].name}`.trim();
  }

  effect(fx) {
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
    if (ui.mode === 'menu' || ui.mode === 'target') {
      this.popup.classList.add('hidden');
      this.ui = { ...ui, mode: 'select', dest: null, path: null };
      return;
    }
    this.clearUi();
  }

  select(unit) {
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
    if (ui.mode === 'select') {
      if (!ui.stops.has(key(x, y))) return this.clearUi();
      const o = this.engine.call({ op: 'options', unit: ui.unit.id, x, y });
      if (!o.ok) return;
      this.ui = { ...ui, mode: 'menu', dest: { x, y }, path: o.path, options: o };
      return this.openActions(x, y, o);
    }
    if (ui.mode === 'target') {
      const target = ui.options.targets.find(t => t.x === x && t.y === y);
      if (!target) return this.cancel();
      return this.submit({ type: 'move', unit: ui.unit.id, x: ui.dest.x, y: ui.dest.y, then: { attack: target.unit } });
    }
    if (ui.mode === 'menu') return this.cancel();

    const unit = this.unitAt(x, y);
    const s = this.view;
    if (unit && this.myTurn() && unit.player === s.turn && !unit.moved) return this.select(unit);
    if (unit) return this.inspect(unit);
    if (this.myTurn() && this.ownerAt(x, y) === s.turn) {
      const { builds } = this.engine.call({ op: 'builds', x, y });
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
    if (o.targets.length) items.push(h('button', { onclick: () => {
      this.popup.classList.add('hidden');
      this.ui = { ...this.ui, mode: 'target' };
      this.showInfo();
    } }, 'Fire'));
    if (o.capture) items.push(h('button', { onclick: () => this.submit({ type: 'move', unit: u.id, x, y, then: 'capture' }) }, 'Capture'));
    items.push(h('button', { onclick: () => this.submit({ type: 'move', unit: u.id, x, y, then: 'wait' }) }, 'Wait'));
    items.push(h('button', { class: 'quiet', onclick: () => this.cancel() }, 'Cancel'));
    this.popup.replaceChildren(...items);
    this.placePopup(x, y);
    items[0].focus({ preventScroll: true });
  }

  openBuild(x, y, builds) {
    const r = this.rules, s = this.view;
    this.ui = { mode: 'build', at: { x, y } };
    const rows = builds.map(b => {
      const icon = h('canvas', { width: 32, height: 32 });
      const c = icon.getContext('2d');
      c.imageSmoothingEnabled = false;
      drawUnit(c, r, b.kind, s.turn, 0, 0, 32);
      return h('button', {
        class: 'buy', disabled: !b.ok, title: r.units[b.kind].description,
        onclick: () => this.submit({ type: 'build', x, y, unit: r.units[b.kind].id }),
      }, icon, h('span', {}, r.units[b.kind].name), h('b', {}, `${b.cost}`));
    });
    this.popup.replaceChildren(h('div', { class: 'title' }, `Build · ${s.players[s.turn].funds} funds`), h('div', { class: 'buylist' }, rows),
      h('button', { class: 'quiet', onclick: () => this.clearUi() }, 'Cancel'));
    this.placePopup(x, y);
  }

  openMenu() {
    const items = (this.menu || []).map(m => h('button', { onclick: () => { this.menuEl.classList.add('hidden'); m.action(); } }, m.label));
    this.menuEl.replaceChildren(...items, h('button', { class: 'quiet', onclick: () => this.menuEl.classList.add('hidden') }, 'Close'));
    this.menuEl.classList.toggle('hidden');
  }

  showResult() {
    if (this.resultShown) return;
    this.resultShown = true;
    const w = this.view.winner;
    sound.play('win');
    const text = w == null ? 'Draw' : `${this.playerName(w)} wins`;
    this.say(`Game over: ${text}`, w ?? 0);
    this.menuEl.replaceChildren(
      h('div', { class: 'title big', style: `color:${w == null ? '#fff' : factionColor(this.rules, w)}` }, text),
      h('div', { class: 'muted' }, `Day ${this.view.day}`),
      ...(this.menu || []).map(m => h('button', { onclick: () => m.action() }, m.label)),
    );
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
        : this.pending ? 'Sending…' : `Waiting for ${this.playerName(s.turn)}.`;
      parts.push(h('p', { class: 'muted' }, tip));
    }
    this.info.replaceChildren(...parts);
  }

  // ---- drawing -----------------------------------------------------------

  loop(now) {
    if (!this.alive) return;
    this.draw(now);
    requestAnimationFrame(this.loop);
  }

  draw(now) {
    const ctx = this.ctx, s = this.view, r = this.rules, size = T * this.scale, ui = this.ui;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.layer, 0, 0, s.width * size, s.height * size);

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
    if (ui.mode === 'target') {
      ctx.globalAlpha = 0.75;
      for (const t of ui.options.targets) drawTile(ctx, 79, t.x * size, t.y * size, size);
      ctx.globalAlpha = 1;
    }
    if (ui.path && ui.path.length > 1 && ui.mode !== 'target') this.drawPath(ui.path, factionColor(r, ui.unit.player));

    for (const u of s.units) {
      if (this.anim.blink === u.id && Math.floor(now / 70) % 2) continue;
      const ghost = ui.mode === 'menu' || ui.mode === 'target' ? ui.unit?.id === u.id : false;
      const x = ghost ? ui.dest.x : u.x, y = ghost ? ui.dest.y : u.y;
      drawUnit(ctx, r, u.kind, u.player, x * size, y * size, size, u.moved && u.player === s.turn);
      const hp = Math.ceil(u.hp / 10);
      if (hp < 10) drawTile(ctx, 180 + hp, x * size + size / 2, y * size + size / 2, size / 2);
      if (u.capture > 0) drawTile(ctx, 194, x * size, y * size + size / 2, size / 2);
    }

    if (this.hover && (this.myTurn() || ui.mode === 'inspect' || ui.mode === 'idle')) {
      drawTile(ctx, 61, this.hover.x * size, this.hover.y * size, size);
    }

    this.anim.effects = this.anim.effects.filter(fx => now - fx.t0 < fx.dur);
    for (const fx of this.anim.effects) {
      const t = (now - fx.t0) / fx.dur;
      if (fx.kind === 'text') {
        ctx.font = `${Math.max(10, 6 * this.scale)}px kenney, monospace`;
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
      } else if (fx.kind === 'ring') {
        ctx.strokeStyle = fx.color;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = this.scale;
        const pad = (1 - t) * size * 0.3;
        ctx.strokeRect(fx.at[0] * size - pad, fx.at[1] * size - pad, size + 2 * pad, size + 2 * pad);
        ctx.globalAlpha = 1;
      }
    }
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

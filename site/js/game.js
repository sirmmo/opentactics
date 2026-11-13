// The battle screen: drawing, input and animation for one match.
//
// The engine holds the true game. `view` is what the screen shows, which
// trails the engine while events are being animated. Every action, whether it
// comes from this player, the computer or a peer, goes through `commit`, so
// all of them are applied and animated in the same order.

import { T, drawTile, drawUnit, factionColor, terrainLayer } from './art.js';
import { fingerprint } from './engine.js';
import * as sound from './sound.js';
import { snapshot, statsView } from './stats.js';

const $ = (sel, root = document) => root.querySelector(sel);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (x, y) => `${x},${y}`;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    this.curtain = h('div', { class: 'curtain hidden' });
    this.clockEl = h('div', { class: 'clock hidden', title: 'Time left for this turn' });
    this.chatEl = null;
    if (this.chat) {
      this.chatLog = h('ol', { class: 'chatlog' });
      const input = h('input', { maxlength: 200, placeholder: 'Say something…', enterkeyhint: 'send' });
      const send = text => { text = text.trim(); if (text) this.chat(text); };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { send(input.value); input.value = ''; } });
      this.chatEl = h('div', { class: 'chat' },
        h('h3', {}, 'Chat'), this.chatLog,
        h('div', { class: 'row' }, input, h('button', { onclick: () => { send(input.value); input.value = ''; } }, 'Send')),
        h('div', { class: 'row emotes' }, ['👍', '😂', '😮', '😡', '🎉', 'GG', 'Nice!', 'Oops'].map(e => h('button', { class: 'quiet', onclick: () => send(e) }, e))));
    }
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
      h('header', { class: 'hud' }, menuBtn, this.dayEl, this.weatherEl, this.clockEl, this.players, h('div', { class: 'spacer' }), zoomOut, zoomIn, this.soundBtn, this.powerBtn, this.endBtn),
      h('main', { class: 'field' },
        h('div', { class: 'stage' }, this.scroller, this.popup, this.bannerEl, this.toastEl, this.menuEl, this.curtain),
        h('aside', { class: 'side' }, this.netEl, this.extraEl = h('div', { class: 'extra' }), this.info, this.chatEl, h('h3', {}, 'Log'), this.logEl)),
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

  /** Whose eyes the board is shown through, or null to show everything. */
  viewer(turn = this.view?.turn) {
    if (this.spectate || !this.locals.length) return null;
    if (this.locals.length === 1) return this.locals[0];
    if (this.locals.includes(turn)) return turn;
    return this.lastViewer ?? this.locals[0];
  }

  /** What the viewer knows of the engine's current game (hidden enemies left out). */
  seen(state) {
    const v = this.viewer(state.turn);
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
    return !s.over && !this.busy && !this.pending && this.queue.length === 0 && !!this.seats[s.turn]?.local;
  }

  unitAt(x, y) { return this.view.units.find(u => u.x === x && u.y === y); }
  terrainAt(x, y) { return this.rules.terrains[this.view.terrain[y * this.view.width + x]]; }
  ownerAt(x, y) { return this.view.owner[y * this.view.width + x]; }

  updateHud() {
    const s = this.view, r = this.rules, o = s.options || {};
    this.dayEl.textContent = `Day ${s.day}`;
    const teams = o.teams?.length ? [...new Set(o.teams)] : [];
    this.players.replaceChildren(...s.players.map((p, i) => h('div', {
      class: `chip${i === s.turn && !s.over ? ' active' : ''}${p.alive ? '' : ' out'}`,
      style: `--c:${factionColor(r, i)}`,
      title: `${this.playerName(i)}: ${s.units.filter(u => u.player === i).length} units${p.power != null ? ` · ${r.powers[p.power].name} active` : ''}`,
    }, h('span', { class: 'dot' }), h('b', {}, this.playerName(i)), h('span', { class: 'funds' }, `${p.funds}`),
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
    const powersOn = o.powers && r.powers?.length;
    const me = this.seats[s.turn]?.local && !this.seats[s.turn]?.ai ? s.turn : this.viewer();
    this.powerBtn.classList.toggle('hidden', !powersOn || me == null);
    if (powersOn && me != null) {
      const cheapest = Math.min(...r.powers.map(p => p.charge));
      const charge = s.players[me].charge || 0;
      const ready = charge >= cheapest && s.players[me].power == null;
      this.powerBtn.textContent = `⚡ ${Math.floor(100 * Math.min(1, charge / Math.max(...r.powers.map(p => p.charge))))}%`;
      this.powerBtn.classList.toggle('ready', ready && this.myTurn());
    }
    if (this.onHud) this.extraEl.replaceChildren(this.onHud(this.view) || '');
    const mine = this.myTurn();
    this.endBtn.disabled = !mine;
    this.endBtn.textContent = s.over ? 'Game over' : mine ? 'End turn' : this.seats[s.turn]?.local ? 'Wait…' : `${this.playerName(s.turn)}…`;
    this.showInfo();
  }

  /** A chat line from someone (seat -1 for a watcher or the host's notices). */
  showChat(name, seat, text) {
    if (!this.chatLog) return;
    const color = seat >= 0 ? factionColor(this.rules, seat) : '#a09fb8';
    this.chatLog.append(h('li', { style: `--c:${color}` }, h('b', {}, name), ' ', text));
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
    this.afterIdle();
  }

  afterIdle() {
    if (!this.alive) return;
    this.updateHud();
    const s = this.view;
    if (s.over && !this.replay) return this.showResult();
    if (s.over && this.replay && this.rIndex >= this.replay.actions.length) this.showResult();
    if (s.options?.fog && this.locals.length > 1 && this.locals.includes(s.turn) && this.curtainFor !== s.turn) {
      this.curtainFor = s.turn;
      this.curtain.replaceChildren(
        h('div', { class: 'big', style: `color:${factionColor(this.rules, s.turn)}` }, `${this.playerName(s.turn)}'s turn`),
        h('p', { class: 'muted' }, 'Fog of war is on. Pass the device, then tap to see your side of the battle.'),
        h('button', { class: 'primary', onclick: () => { this.curtain.classList.add('hidden'); this.focusPlayer(s.turn, false); } }, 'Show my side'));
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
    if (this.driver && this.seats[s.turn]?.ai && !this.busy) {
      clearTimeout(this.aiTimer);
      this.aiTimer = setTimeout(() => this.aiStep(), 180);
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

  aiStep() {
    if (!this.alive || this.busy || this.queue.length || this.view.over || !this.seats[this.view.turn]?.ai) return;
    let action;
    try {
      action = this.engine.call({ op: 'ai', profile: this.seats[this.view.turn]?.profile }).action;
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
          if (!d) break;
          const ranged = a && (this.rules.units[a.kind].range?.[1] || 1) > 1;
          const flying = a && this.rules.units[a.kind].flying;
          if (a) {
            const dir = [Math.sign(d.x - a.x), Math.sign(d.y - a.y)];
            if (!ranged && !calm()) await this.lunge(a, dir, fast ? 140 : 200);
            sound.play('attack');
            this.effect({ kind: 'flash', at: [a.x, a.y], dir, dur: 140 });
            const travel = ranged ? (fast ? 380 : 520) : (fast ? 150 : 200);
            this.effect({ kind: ranged ? 'shell' : flying ? 'missile' : 'shot', from: [a.x, a.y], to: [d.x, d.y], dur: travel, color: factionColor(this.rules, a.player) });
            await sleep(travel);
          } else {
            sound.play('attack');
            await sleep(fast ? 120 : 180);
          }
          this.effect({ kind: 'impact', at: [d.x, d.y], dur: 320 });
          if (ev.damage >= 45) this.shake(Math.min(1, ev.damage / 100), 260);
          this.anim.blink = d.id;
          this.effect({ kind: 'text', at: [d.x, d.y], text: `-${ev.damage}%`, color: ev.damage >= 50 ? '#ffd27a' : '#fff2a8', big: ev.damage >= 50, dur: 900 });
          d.hp = ev.hp;
          if (a) a.moved = a.moved || !ev.counter;
          await sleep(fast ? 280 : 420);
          this.anim.blink = null;
          this.say(`${a ? this.unitName(a) : 'Something unseen'} hits ${this.unitName(d)} for ${ev.damage}%${ev.counter ? ' (counter)' : ''}`, a?.player ?? d.player);
          break;
        }
        case 'trapped': {
          const u = unit(ev.unit);
          sound.play('error');
          this.effect({ kind: 'text', at: [ev.x, ev.y], text: 'Ambush!', color: '#ff9d8a', dur: 1100 });
          if (u) this.say(`${this.unitName(u)} runs into a hidden enemy`, u.player);
          await sleep(fast ? 300 : 500);
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
          await sleep(fast ? 120 : 200);
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
          await sleep(fast ? 150 : 250);
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
          await sleep(fast ? 250 : 400);
          break;
        }
        case 'weather': {
          s.weather = ev.weather;
          const w = this.rules.weather?.[ev.weather];
          this.updateHud();
          if (w) { this.banner(w.name, w.description || '', '#bfe4ff'); this.say(`The weather turns: ${w.name}`, s.turn); await sleep(700); }
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
          await sleep(fast ? 700 : 1100);
          break;
        }
        case 'destroy': {
          sound.play('destroy');
          this.effect({ kind: 'boom', at: [ev.x, ev.y], dur: 650 });
          this.effect({ kind: 'smoke', at: [ev.x, ev.y], dur: 1400 });
          this.shake(0.9, 380);
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
          const seen = this.allied(ev.unit.player, this.viewer() ?? ev.unit.player) || this.seesTile(ev.unit.x, ev.unit.y);
          if (seen) s.units.push({ ...ev.unit });
          s.players[ev.unit.player].funds -= this.rules.units[ev.unit.kind].cost;
          this.updateHud();
          if (seen) this.effect({ kind: 'ring', at: [ev.unit.x, ev.unit.y], dur: 400, color: factionColor(this.rules, ev.unit.player) });
          this.say(`${this.playerName(ev.unit.player)} builds ${seen ? this.rules.units[ev.unit.kind].name : 'a unit'}`, ev.unit.player);
          await sleep(fast ? 150 : 250);
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
    this.popup.replaceChildren(...items);
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
    this.popup.replaceChildren(
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

  openPowers() {
    const r = this.rules, s = this.view;
    const me = this.seats[s.turn]?.local && !this.seats[s.turn]?.ai ? s.turn : this.viewer();
    if (me == null) return;
    const p = s.players[me];
    const usable = this.myTurn() && me === s.turn && p.power == null;
    const items = r.powers.map(pw => h('button', {
      class: 'buy power-row', disabled: !usable || (p.charge || 0) < pw.charge, title: pw.description || '',
      onclick: () => { this.menuEl.classList.add('hidden'); this.submit({ type: 'power', power: pw.id }); },
    }, h('span', {}, h('b', {}, pw.name), h('small', { class: 'muted' }, pw.description || '')), h('b', {}, `${pw.charge}`)));
    this.menuEl.replaceChildren(
      h('div', { class: 'title' }, `Powers · charge ${p.charge || 0}`),
      h('div', { class: 'muted small' }, p.power != null ? `${r.powers[p.power].name} is active until your next turn.` : 'Charge comes from damage you deal (and half of what you take). One power at a time; it lasts until your next turn.'),
      h('div', { class: 'buylist' }, items),
      h('button', { class: 'quiet', onclick: () => this.menuEl.classList.add('hidden') }, 'Close'));
    this.menuEl.classList.remove('hidden');
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
    const all = this.view.winners?.length ? this.view.winners : w == null ? [] : [w];
    sound.play('win');
    const m = this.view.mission;
    const text = m ? (all.includes(m.player) ? 'Mission complete' : 'Mission failed')
      : w == null ? 'Draw' : all.length > 1 ? `${all.map(p => this.playerName(p)).join(' & ')} win` : `${this.playerName(w)} wins`;
    this.say(`Game over: ${text}`, w ?? 0);
    this.menuEl.replaceChildren(
      h('div', { class: 'title big', style: `color:${w == null ? '#fff' : factionColor(this.rules, w)}` }, text),
      h('div', { class: 'muted' }, `Day ${this.view.day}`),
      h('button', { onclick: () => this.showStats() }, 'Stats'),
      this.onWatch && !this.replay ? h('button', { onclick: () => this.onWatch(this.replayRecord()) }, 'Watch replay') : null,
      !this.replay ? h('button', { onclick: () => this.downloadReplay() }, 'Save replay') : null,
      this.replay ? h('button', { onclick: () => this.menuEl.classList.add('hidden') }, 'Close') : null,
      ...(this.menu || []).map(m => h('button', { onclick: () => m.action() }, m.label)),
    );
    this.menuEl.classList.remove('hidden');
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
    this.menuEl.replaceChildren(
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

    // Fog of war: darken what this side cannot see.
    if (this.hidden.size) {
      ctx.fillStyle = 'rgba(10,10,24,0.5)';
      for (const i of this.hidden) ctx.fillRect((i % s.width) * size, Math.floor(i / s.width) * size, size, size);
    }

    const supply = s.options?.supply;
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
      drawUnit(ctx, r, u.kind, u.player, x * size, y * size, size, u.moved && u.player === s.turn);
      ctx.globalAlpha = 1;
      const hp = Math.ceil(u.hp / 10);
      if (hp < 10) drawTile(ctx, 180 + hp, x * size + size / 2, y * size + size / 2, size / 2);
      if (u.capture > 0) drawTile(ctx, 194, x * size, y * size + size / 2, size / 2);
      if (u.cargo?.length) {
        ctx.fillStyle = '#1b1a26';
        ctx.fillRect(x * size + size * 0.66, y * size, size * 0.34, size * 0.3);
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.round(size * 0.28)}px kenney-mono, monospace`;
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
        ctx.font = `${Math.max(10, (fx.big ? 8 : 6) * this.scale)}px kenney, monospace`;
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
    ctx.restore();
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

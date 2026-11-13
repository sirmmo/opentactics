// Map editor: paint terrain, owners and units; mirror strokes so both sides
// stay fair; save in the browser, download, publish to the server, or test.

import { T, drawTile, drawUnit, terrainLayer, mapToBoard, factionColor } from './art.js';
import { h } from './game.js';

const STORE = 'ot.maps';

function slug(text) {
  return (text || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'map';
}

export class Editor {
  static savedMaps() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
  }

  constructor(root, { engine, rules, map, onBack, onPlay }) {
    this.root = root;
    this.engine = engine;
    this.rules = rules;
    this.onBack = onBack;
    this.onPlay = onPlay;
    this.map = map ? structuredClone(map) : this.blank(20, 14, 2);
    this.tool = { kind: 'terrain', terrain: rules.terrains.findIndex(t => t.glyph === '.') };
    this.owner = -1;
    this.mirror = 'rot180';
    this.scale = 2;
    this.undo = [];
    this.alive = true;
    this.buildUi();
    this.refresh();
  }

  destroy() {
    this.alive = false;
    window.removeEventListener('keydown', this.onKey);
    this.root.replaceChildren();
  }

  blank(w, hgt, players) {
    const plain = this.rules.terrains.find(t => t.id === 'plain')?.glyph || this.rules.terrains[0].glyph;
    return {
      name: 'Untitled', author: '', description: '', width: w, height: hgt, players,
      tiles: Array.from({ length: hgt }, () => plain.repeat(w)), owned: [], units: [],
    };
  }

  // ---- interface ---------------------------------------------------------

  buildUi() {
    const r = this.rules;
    this.canvas = h('canvas', { class: 'board' });
    this.ctx = this.canvas.getContext('2d');
    this.status = h('div', { class: 'status' });
    this.nameIn = h('input', { placeholder: 'Map name', maxlength: 40, oninput: () => { this.map.name = this.nameIn.value; } });
    this.authorIn = h('input', { placeholder: 'Author', maxlength: 40, oninput: () => { this.map.author = this.authorIn.value; } });
    this.descIn = h('textarea', { placeholder: 'Description', rows: 2, maxlength: 300, oninput: () => { this.map.description = this.descIn.value; } });
    this.wIn = h('input', { type: 'number', min: 4, max: 64 });
    this.hIn = h('input', { type: 'number', min: 4, max: 64 });
    this.pIn = h('select', {}, ...r.factions.slice(1).map((_, i) => h('option', { value: i + 2 }, `${i + 2} players`)));
    const applySize = () => this.resize(+this.wIn.value, +this.hIn.value, +this.pIn.value);
    this.wIn.onchange = this.hIn.onchange = this.pIn.onchange = applySize;
    this.mirrorSel = h('select', { onchange: () => { this.mirror = this.mirrorSel.value; } },
      h('option', { value: 'none' }, 'No mirroring'),
      h('option', { value: 'rot180', selected: true }, 'Rotate 180° (2 players)'),
      h('option', { value: 'flipx' }, 'Mirror left ↔ right'),
      h('option', { value: 'flipy' }, 'Mirror top ↕ bottom'),
      h('option', { value: 'quad' }, 'Four corners (4 players)'));
    this.ownerSel = h('div', { class: 'owners' });
    this.terrainPal = h('div', { class: 'palette' });
    this.unitPal = h('div', { class: 'palette' });

    // Publishing needs the optional map server; on a plain static host the button stays hidden.
    const publishBtn = h('button', { class: 'hidden', onclick: () => this.publish() }, 'Publish');
    fetch('api/maps').then(r => r.ok && r.headers.get('content-type')?.includes('json') && publishBtn.classList.remove('hidden')).catch(() => {});
    const toolbar = h('header', { class: 'bar' },
      h('button', { onclick: () => this.onBack() }, '← Menu'),
      h('h2', {}, 'Map editor'),
      h('div', { class: 'spacer' }),
      h('button', { onclick: () => this.newMap() }, 'New'),
      h('button', { onclick: () => this.openDialog() }, 'Open'),
      h('button', { onclick: () => this.undoStep(), title: 'Undo (Ctrl+Z)' }, 'Undo'),
      h('button', { onclick: () => this.save() }, 'Save'),
      h('button', { onclick: () => this.download() }, 'Download'),
      publishBtn,
      h('button', { class: 'primary', onclick: () => this.test() }, 'Test play'));

    this.root.replaceChildren(toolbar, h('main', { class: 'field' },
      h('div', { class: 'stage' }, h('div', { class: 'scroller' }, this.canvas)),
      h('aside', { class: 'side editor-side' },
        this.status,
        h('h3', {}, 'Map'), this.nameIn, this.authorIn, this.descIn,
        h('div', { class: 'row' }, h('label', {}, 'W', this.wIn), h('label', {}, 'H', this.hIn), this.pIn),
        h('div', { class: 'row' }, this.mirrorSel),
        h('h3', {}, 'Terrain'), this.terrainPal,
        h('h3', {}, 'Owner of buildings'), this.ownerSel,
        h('h3', {}, 'Units'), this.unitPal,
        h('p', { class: 'muted small' }, 'Left button paints, right button erases units. Pick a unit, then click; mirrored copies go to the matching player.'))));

    let painting = false;
    const tileAt = e => {
      const b = this.canvas.getBoundingClientRect(), size = T * this.scale;
      const x = Math.floor((e.clientX - b.left) / size), y = Math.floor((e.clientY - b.top) / size);
      return x >= 0 && y >= 0 && x < this.map.width && y < this.map.height ? [x, y] : null;
    };
    this.canvas.addEventListener('pointerdown', e => {
      const t = tileAt(e);
      if (!t) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.pushUndo();
      painting = e.button === 2 ? 'erase' : 'paint';
      this.apply(t[0], t[1], painting === 'erase');
    });
    this.canvas.addEventListener('pointermove', e => {
      const t = tileAt(e);
      this.hover = t;
      if (painting && t && (this.tool.kind === 'terrain' || painting === 'erase')) this.apply(t[0], t[1], painting === 'erase');
      this.draw();
    });
    this.canvas.addEventListener('pointerup', () => { if (painting) { painting = false; this.refresh(); } });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); this.undoStep(); }
    };
    window.addEventListener('keydown', this.onKey);
  }

  renderPalettes() {
    const r = this.rules, players = this.map.players;
    const icon = (fn) => {
      const c = h('canvas', { width: 32, height: 32 });
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      fn(ctx);
      return c;
    };
    this.terrainPal.replaceChildren(...r.terrains.map((t, i) => {
      const board = { width: 1, height: 1, terrain: [i], owner: [t.capturable ? Math.max(this.owner, -1) : -1] };
      const tile = terrainLayer(r, board);
      return h('button', {
        class: `pal${this.tool.kind === 'terrain' && this.tool.terrain === i ? ' on' : ''}`, title: `${t.name} (${t.glyph})`,
        onclick: () => { this.tool = { kind: 'terrain', terrain: i }; this.renderPalettes(); },
      }, icon(c => c.drawImage(tile, 0, 0, 32, 32)));
    }));
    this.ownerSel.replaceChildren(...[-1, ...Array.from({ length: players }, (_, i) => i)].map(p => h('button', {
      class: `own${this.owner === p ? ' on' : ''}`, style: `--c:${p < 0 ? '#9aa' : factionColor(r, p)}`,
      onclick: () => { this.owner = p; this.renderPalettes(); },
    }, p < 0 ? 'Neutral' : r.factions[p].name)));
    const unitButtons = [];
    for (let p = 0; p < players; p++) {
      for (let k = 0; k < r.units.length; k++) {
        unitButtons.push(h('button', {
          class: `pal${this.tool.kind === 'unit' && this.tool.unit === k && this.tool.player === p ? ' on' : ''}`, title: `${r.factions[p].name} ${r.units[k].name}`,
          onclick: () => { this.tool = { kind: 'unit', unit: k, player: p }; this.renderPalettes(); },
        }, icon(c => drawUnit(c, r, k, p, 0, 0, 32))));
      }
    }
    unitButtons.push(h('button', {
      class: `pal erase${this.tool.kind === 'erase' ? ' on' : ''}`, title: 'Remove units',
      onclick: () => { this.tool = { kind: 'erase' }; this.renderPalettes(); },
    }, '✕'));
    this.unitPal.replaceChildren(...unitButtons);
  }

  // ---- editing -----------------------------------------------------------

  /** The tiles a stroke at (x, y) also touches, with the player each copy belongs to. */
  mirrors(x, y, player) {
    const { width: w, height: hgt, players } = this.map;
    const swap2 = p => (p < 0 || players !== 2 ? p : 1 - p);
    const out = [[x, y, player]];
    if (this.mirror === 'rot180') out.push([w - 1 - x, hgt - 1 - y, swap2(player)]);
    if (this.mirror === 'flipx') out.push([w - 1 - x, y, swap2(player)]);
    if (this.mirror === 'flipy') out.push([x, hgt - 1 - y, swap2(player)]);
    if (this.mirror === 'quad') {
      // Players 0..3 sit top-left, top-right, bottom-left, bottom-right.
      const q = p => (p < 0 || players !== 4 ? p : p);
      const map4 = (p, fx, fy) => (p < 0 || players !== 4 ? p : (p ^ (fx ? 1 : 0)) ^ (fy ? 2 : 0));
      void q;
      out.push([w - 1 - x, y, map4(player, true, false)], [x, hgt - 1 - y, map4(player, false, true)], [w - 1 - x, hgt - 1 - y, map4(player, true, true)]);
    }
    const seen = new Set();
    return out.filter(([a, b]) => !seen.has(`${a},${b}`) && seen.add(`${a},${b}`));
  }

  apply(x, y, erase) {
    const r = this.rules, m = this.map;
    const tool = erase ? { kind: 'erase' } : this.tool;
    for (const [mx, my, p] of this.mirrors(x, y, tool.kind === 'unit' ? tool.player : this.owner)) {
      if (tool.kind === 'terrain') {
        const t = r.terrains[tool.terrain];
        const row = [...m.tiles[my]];
        row[mx] = t.glyph;
        m.tiles[my] = row.join('');
        m.owned = m.owned.filter(o => !(o.x === mx && o.y === my));
        if (t.capturable && p >= 0) m.owned.push({ x: mx, y: my, player: p });
        // Drop units that can no longer stand here.
        m.units = m.units.filter(u => !(u.x === mx && u.y === my) || this.canStand(u.type, t));
      } else if (tool.kind === 'unit') {
        const def = r.units[tool.unit];
        const t = r.terrains.find(t => t.glyph === m.tiles[my][mx]);
        if (!this.canStand(def.id, t)) continue;
        m.units = m.units.filter(u => !(u.x === mx && u.y === my));
        m.units.push({ type: def.id, x: mx, y: my, player: p });
      } else {
        m.units = m.units.filter(u => !(u.x === mx && u.y === my));
      }
    }
    this.layer = null;
    this.draw();
  }

  canStand(unitId, terrain) {
    const def = this.rules.units.find(u => u.id === unitId);
    return !!def && !!terrain && (terrain.move_cost[def.move_type] || 0) > 0;
  }

  resize(w, hgt, players) {
    w = Math.max(4, Math.min(64, w | 0));
    hgt = Math.max(4, Math.min(64, hgt | 0));
    this.pushUndo();
    const m = this.map;
    const fill = this.rules.terrains.find(t => t.id === 'plain')?.glyph || this.rules.terrains[0].glyph;
    m.tiles = Array.from({ length: hgt }, (_, y) => {
      const row = [...(m.tiles[y] || '')].slice(0, w);
      while (row.length < w) row.push(fill);
      return row.join('');
    });
    m.width = w;
    m.height = hgt;
    m.players = players;
    m.owned = m.owned.filter(o => o.x < w && o.y < hgt && o.player < players);
    m.units = m.units.filter(u => u.x < w && u.y < hgt && u.player < players);
    if (this.owner >= players) this.owner = -1;
    if (this.tool.kind === 'unit' && this.tool.player >= players) this.tool = { kind: 'erase' };
    this.refresh();
  }

  pushUndo() {
    this.undo.push(JSON.stringify(this.map));
    if (this.undo.length > 100) this.undo.shift();
  }

  undoStep() {
    const prev = this.undo.pop();
    if (!prev) return;
    this.map = JSON.parse(prev);
    this.refresh();
  }

  newMap() {
    if (!confirm('Start a new, empty map? Unsaved changes are lost.')) return;
    this.pushUndo();
    this.map = this.blank(20, 14, 2);
    this.refresh();
  }

  /** Check the map against the rules; returns the problem, if any. */
  problem() {
    try {
      this.engine.call({ op: 'check', rules: this.rules, map: this.map });
      return null;
    } catch (e) {
      return e.message;
    }
  }

  refresh() {
    const m = this.map;
    this.nameIn.value = m.name || '';
    this.authorIn.value = m.author || '';
    this.descIn.value = m.description || '';
    this.wIn.value = m.width;
    this.hIn.value = m.height;
    this.pIn.value = m.players;
    const box = this.canvas.parentElement.getBoundingClientRect();
    this.scale = Math.max(1, Math.min(4, Math.floor(Math.min(box.width / (m.width * T), box.height / (m.height * T))) || 2));
    this.canvas.width = m.width * T * this.scale;
    this.canvas.height = m.height * T * this.scale;
    this.layer = null;
    this.renderPalettes();
    this.draw();
  }

  draw() {
    if (!this.alive) return;
    const m = this.map, r = this.rules, ctx = this.ctx, size = T * this.scale;
    if (!this.layer) {
      try {
        this.layer = terrainLayer(r, mapToBoard(r, m), this.layerCanvas);
        this.layerCanvas = this.layer;
      } catch (e) {
        this.status.textContent = e.message;
        return;
      }
      const p = this.problem();
      this.status.textContent = p ? `⚠ ${p}` : '✓ Ready to play';
      this.status.className = `status ${p ? 'bad' : 'ok'}`;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.layer, 0, 0, m.width * size, m.height * size);
    for (const u of m.units) {
      const k = r.units.findIndex(d => d.id === u.type);
      if (k >= 0) drawUnit(ctx, r, k, u.player, u.x * size, u.y * size, size);
    }
    // Mirror guides.
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([size / 4, size / 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (this.mirror === 'flipx' || this.mirror === 'quad') { ctx.moveTo(m.width * size / 2, 0); ctx.lineTo(m.width * size / 2, m.height * size); }
    if (this.mirror === 'flipy' || this.mirror === 'quad') { ctx.moveTo(0, m.height * size / 2); ctx.lineTo(m.width * size, m.height * size / 2); }
    ctx.stroke();
    ctx.setLineDash([]);
    if (this.hover) {
      for (const [x, y] of this.mirrors(this.hover[0], this.hover[1], 0)) drawTile(ctx, 61, x * size, y * size, size);
    }
  }

  // ---- files -------------------------------------------------------------

  clean() {
    const m = structuredClone(this.map);
    m.owned.sort((a, b) => a.y - b.y || a.x - b.x);
    m.units.sort((a, b) => a.y - b.y || a.x - b.x);
    return m;
  }

  save() {
    const all = Editor.savedMaps();
    const id = slug(this.map.name);
    all[id] = this.clean();
    try {
      localStorage.setItem(STORE, JSON.stringify(all));
      this.flash(`Saved in this browser as “${id}”.`);
    } catch (e) {
      alert(`Could not save: ${e.message}`);
    }
  }

  download() {
    const blob = new Blob([JSON.stringify(this.clean(), null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${slug(this.map.name)}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async publish() {
    const p = this.problem();
    if (p) return alert(`Fix this first: ${p}`);
    const id = prompt('Publish to this server’s map library under the id:', slug(this.map.name));
    if (!id) return;
    try {
      const res = await fetch(`api/maps/${encodeURIComponent(slug(id))}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.clean()),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
      const link = new URL(body.url, location.href).href;
      prompt('Published. Anyone can play it from the map list, or with this link:', `${location.origin}${location.pathname}?map=${encodeURIComponent(link)}`);
    } catch (e) {
      alert(`Could not publish: ${e.message}. (A plain static host has no map library; use Download instead.)`);
    }
  }

  test() {
    const p = this.problem();
    if (p) return alert(`This map cannot be played yet: ${p}`);
    this.onPlay(this.clean());
  }

  openDialog() {
    const pick = h('div', { class: 'popup menu' });
    const close = () => pick.remove();
    const own = Editor.savedMaps();
    pick.append(h('div', { class: 'title' }, 'Open a map'),
      ...Object.entries(own).map(([id, m]) => h('div', { class: 'row' },
        h('button', { onclick: () => { this.load(m); close(); } }, m.name || id),
        h('button', { class: 'quiet', title: 'Delete', onclick: () => {
          if (!confirm(`Delete “${m.name || id}” from this browser?`)) return;
          delete own[id];
          localStorage.setItem(STORE, JSON.stringify(own));
          close();
          this.openDialog();
        } }, '✕'))),
      h('button', { onclick: async () => {
        const list = await fetch('maps/index.json').then(r => r.json()).catch(() => []);
        const id = prompt(`Bundled maps: ${list.map(m => m.id).join(', ')}\nWhich one?`, list[0]?.id);
        if (id) fetch(`maps/${id}.json`).then(r => r.json()).then(m => { this.load(m); close(); }).catch(e => alert(e.message));
      } }, 'A bundled map…'),
      h('button', { onclick: () => {
        const url = prompt('URL of a map (JSON):');
        if (url) fetch(url).then(r => r.json()).then(m => { this.load(m); close(); }).catch(e => alert(e.message));
      } }, 'From a URL…'),
      h('button', { onclick: () => {
        const input = h('input', { type: 'file', accept: '.json,application/json' });
        input.onchange = () => input.files[0]?.text().then(t => { this.load(JSON.parse(t)); close(); }).catch(e => alert(e.message));
        input.click();
      } }, 'From a file…'),
      h('button', { class: 'quiet', onclick: close }, 'Cancel'));
    this.root.querySelector('.stage').append(pick);
  }

  load(m) {
    if (!m || !Array.isArray(m.tiles) || !m.width || !m.height) return alert('That is not a map.');
    this.pushUndo();
    this.map = { name: '', author: '', description: '', owned: [], units: [], ...structuredClone(m) };
    this.refresh();
  }

  flash(text) {
    const old = this.status.textContent;
    this.status.textContent = text;
    setTimeout(() => { if (this.alive) this.layer = null, this.draw(); void old; }, 1600);
  }
}

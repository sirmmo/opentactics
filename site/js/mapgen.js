// Random fair maps, in the browser. The same method as tools/mapgen.py: the map
// is cut into one wedge per player around its centre; terrain comes from noise in
// "wedge coordinates", and each player's base, roads and property are laid out once
// and turned into every wedge. 2, 4 and 8 players are exactly symmetric; other
// counts are as near as a square grid allows, then topped up with extra cities.

const PROPS = new Set(['H', 'F', 'A', 'P', 'c', 'T']);

// ---- noise ----------------------------------------------------------------------

function hash(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519 | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 0xffff) / 0xffff;
}
const smooth = t => t * t * (3 - 2 * t);
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), tx = smooth(x - xi), ty = smooth(y - yi);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}
function fbm(x, y, seed, scale) {
  x /= scale; y /= scale;
  return (vnoise(x, y, seed) * 2 + vnoise(x * 2.1, y * 2.1, seed + 7)) / 3;
}

// ---- symmetry ---------------------------------------------------------------------

function exactGroup(w, h, k) {
  const id = p => p, r180 = p => [w - 1 - p[0], h - 1 - p[1]], fx = p => [w - 1 - p[0], p[1]], fy = p => [p[0], h - 1 - p[1]];
  if (k === 2) return [id, r180];
  if (k === 4 && w === h) { const r90 = p => [w - 1 - p[1], p[0]]; return [id, r90, r180, p => r90(r180(p))]; }
  if (k === 4) return [id, fx, r180, fy];
  if (k === 8 && w === h) {
    const r90 = p => [w - 1 - p[1], p[0]];
    const rots = [id, r90, r180, p => r90(r180(p))];
    return [...rots, ...rots.map(r => p => r(fx(p)))];
  }
  return null;
}

class Layout {
  constructor(w, h, k, baseAngle, baseR) {
    Object.assign(this, { w, h, k });
    this.cx = (w - 1) / 2; this.cy = (h - 1) / 2; this.hw = w / 2; this.hh = h / 2;
    this.wedge = 2 * Math.PI / k;
    this.theta0 = baseAngle - this.wedge / 2;
    this.group = exactGroup(w, h, k);
    this.base0 = this.toTile(baseR, 0);
    if (this.group) {
      const byWedge = new Map();
      for (const g of this.group) { const j = this.wedgeOf(...g(this.base0)); if (!byWedge.has(j)) byWedge.set(j, g); }
      if (byWedge.size !== k) this.group = null;
      else this.turn = Array.from({ length: k }, (_, j) => byWedge.get(j));
    }
    if (!this.group) this.turn = Array.from({ length: k }, (_, j) => this.rotation(j));
  }
  rotation(j) {
    const a = this.wedge * j, ca = Math.cos(a), sa = Math.sin(a);
    return p => {
      const u = (p[0] - this.cx) / this.hw, v = (p[1] - this.cy) / this.hh;
      return [Math.round(this.cx + (u * ca - v * sa) * this.hw), Math.round(this.cy + (u * sa + v * ca) * this.hh)];
    };
  }
  polar(x, y) { const u = (x - this.cx) / this.hw, v = (y - this.cy) / this.hh; return [Math.hypot(u, v), Math.atan2(v, u)]; }
  wedgeOf(x, y) { const t = this.polar(x, y)[1]; return Math.floor((((t - this.theta0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / this.wedge) % this.k; }
  canon(x, y) { const [r, t] = this.polar(x, y); const phi = (((t - this.theta0) % this.wedge) + this.wedge) % this.wedge; return [r, Math.min(phi, this.wedge - phi)]; }
  toTile(r, frac) { const a = this.theta0 + this.wedge / 2 + frac * this.wedge / 2; return [Math.round(this.cx + r * Math.cos(a) * this.hw), Math.round(this.cy + r * Math.sin(a) * this.hh)]; }
  inside(p) { return p[0] >= 0 && p[1] >= 0 && p[0] < this.w && p[1] < this.h; }
}

function line4(a, b) {
  const [x0, y0] = a, [x1, y1] = b, n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const out = [[x0, y0]];
  for (let i = 1; i <= n; i++) {
    const p = [Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n)], last = out[out.length - 1];
    if (p[0] !== last[0] && p[1] !== last[1]) out.push([p[0], last[1]]);
    out.push(p);
  }
  return out;
}

// ---- the generator -------------------------------------------------------------------

/**
 * o: { name, players, width, height, seed, water: [...'island'|'lake'|'rivers'],
 *      mountains (0..1 amount), forests (0..1), cities (per player), factories,
 *      airports, ports, towers (booleans/counts), beaches, reefs, ring (bool) }
 */
export function generate(o) {
  const k = o.players, w = o.width, h = o.height, seed = o.seed | 0;
  const baseAngle = k === 2 ? (w >= h ? Math.PI : -Math.PI / 2) : k === 4 ? -3 * Math.PI / 4 : k === 8 ? -Math.PI / 2 + Math.PI / 8 : -Math.PI / 2;
  const water = new Set(o.water || []);
  const island = water.has('island');
  const baseR = island ? 0.7 : 0.8;
  const L = new Layout(w, h, k, baseAngle, baseR);
  const grid = Array.from({ length: h }, () => Array(w).fill('.'));
  const owner = new Map();
  const mountainT = 0.82 - 0.24 * (o.mountains ?? 0.4), forestT = 0.72 - 0.25 * (o.forests ?? 0.5);

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, phi] = L.canon(x, y);
    const px = r * Math.cos(phi) * L.hw, py = r * Math.sin(phi) * L.hw;
    let g = '.';
    if (fbm(px, py, seed + 1, 3.2) > forestT) g = 'f';
    if (fbm(px, py, seed + 2, 2.7) > mountainT) g = '^';
    let wet = false;
    if (island && r > 0.92 + 0.16 * (fbm(px, py, seed + 3, 2.5) - 0.5)) wet = true;
    if (water.has('lake') && r < 0.2 + 0.1 * (fbm(px, py, seed + 4, 2) - 0.5)) wet = true;
    if (water.has('rivers') && r > 0.3 && r * L.hw * Math.sin(phi) < 1.1) wet = true;
    grid[y][x] = wet ? '~' : g;
  }
  const near = (x, y, set) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy]?.[x + dx] != null && set.includes(grid[y + dy][x + dx]));
  if (o.beaches || o.reefs) {
    const marks = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [r, phi] = L.canon(x, y);
      const n = fbm(r * Math.cos(phi) * L.hw, r * Math.sin(phi) * L.hw, seed + 5, 2.2);
      if (o.beaches && '.f'.includes(grid[y][x]) && near(x, y, '~') && n > 0.5) marks.push([x, y, 's']);
      if (o.reefs && grid[y][x] === '~' && !near(x, y, '.f^s') && n > 0.62) marks.push([x, y, 'r']);
    }
    for (const [x, y, g] of marks) grid[y][x] = g;
  }

  const everywhere = p => L.turn.map(t => t(p));
  const put = (p, glyph, player) => {
    if (!L.inside(p)) return;
    grid[p[1]][p[0]] = glyph;
    if (player != null) owner.set(`${p[0]},${p[1]}`, player); else owner.delete(`${p[0]},${p[1]}`);
  };
  const [bx, by] = L.base0;
  let ix = L.cx - bx, iy = L.cy - by;
  const n0 = Math.hypot(ix, iy) || 1; ix /= n0; iy /= n0;
  const sx = -iy, sy = ix;
  const local = (a, b) => [Math.round(bx + a * ix + b * sx), Math.round(by + a * iy + b * sy)];
  const own = [[L.base0, 'H'], [local(2, -1), 'F'], [local(1, 2), 'c']];
  const free = [[local(3, -3), 'c'], [local(4, 1), 'c']];
  for (const [p] of [...own, ...free]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    for (const q of everywhere([p[0] + dx, p[1] + dy])) if (L.inside(q)) grid[q[1]][q[0]] = '.';
  }
  // Roads: from each base toward the middle, and a ring.
  const paths = [[L.base0, local(1, 0), o.ring ? L.toTile(0.38, 0) : [Math.round(L.cx), Math.round(L.cy)]]];
  if (o.ring) paths.push(Array.from({ length: 11 }, (_, i) => L.toTile(0.38, -1 + i / 5)));
  for (const path of paths) for (let i = 1; i < path.length; i++) for (const p of line4(path[i - 1], path[i])) {
    for (const q of everywhere(p)) if (L.inside(q)) grid[q[1]][q[0]] = '~r'.includes(grid[q[1]][q[0]]) ? '#' : '=';
  }
  L.turn.forEach((t, j) => { for (const [p, g] of own) put(t(p), g, j); for (const [p, g] of free) put(t(p), g); });
  const spots = (n, r0, r1) => Array.from({ length: n }, (_, i) => [r0 + (r1 - r0) * (n === 1 ? 0.5 : i / (n - 1)), n === 1 ? 0 : (i % 2 ? 0.55 : -0.55) * (k > 6 ? 0.4 : 1)]);
  const place = (glyph, pts) => { for (const [r, f] of pts) for (const fr of f ? [f, -f] : [0]) for (const q of everywhere(L.toTile(r, fr))) put(q, glyph); };
  place('c', spots(o.cities ?? 2, 0.3, 0.65).map(([r, f]) => [r, f / 2]));
  if (o.factories) place('F', [[0.45, 0]]);
  if (o.airports) place('A', [[0.25, 0]]);
  if (o.towers) place('T', [[0.15, 0]]);
  if (o.ports && (island || water.size)) {
    // A port on the nearest shore of each wedge.
    let best = null;
    const target = L.toTile(0.6, 0.5);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ('~#r'.includes(grid[y][x]) || PROPS.has(grid[y][x]) || L.wedgeOf(x, y) !== 0 || !near(x, y, '~')) continue;
      const d = (x - target[0]) ** 2 + (y - target[1]) ** 2;
      if (!best || d < best[0]) best = [d, [x, y]];
    }
    if (best) for (const q of everywhere(best[1])) put(q, 'P');
  }
  if (L.group) symmetrize(grid, owner, L);
  return {
    name: o.name || 'Generated map', author: '', description: o.description || `A generated map for ${k} players.`,
    width: w, height: h, players: k, tiles: grid.map(r => r.join('')),
    owned: [...owner].map(([key, player]) => { const [x, y] = key.split(',').map(Number); return { x, y, player }; }).sort((a, b) => a.y - b.y || a.x - b.x),
    units: [],
  };
}

function symmetrize(grid, owner, L) {
  const bases = L.turn.map(g => g(L.base0));
  const perms = L.group.map(g => bases.map(b => { const q = g(b); return bases.findIndex(c => c[0] === q[0] && c[1] === q[1]); }));
  const done = new Set();
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    if (done.has(`${x},${y}`)) continue;
    const g0 = grid[y][x], o0 = owner.get(`${x},${y}`);
    L.group.forEach((g, gi) => {
      const [qx, qy] = g([x, y]);
      done.add(`${qx},${qy}`);
      grid[qy][qx] = g0;
      if (o0 == null) owner.delete(`${qx},${qy}`); else owner.set(`${qx},${qy}`, perms[gi][o0]);
    });
  }
  for (const key of [...owner.keys()]) { const [x, y] = key.split(',').map(Number); if (!PROPS.has(grid[y][x])) owner.delete(key); }
}

// ---- checking and balancing --------------------------------------------------------

function distances(m, rules, src, moveType) {
  const cost = Object.fromEntries(rules.terrains.map(t => [t.glyph, t.move_cost]));
  const { width: w, height: h, tiles } = m;
  const d = new Map([[src.join(), 0]]);
  const queue = [[0, src]];
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [c, [x, y]] = queue.shift();
    if (c > d.get(`${x},${y}`)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const step = cost[tiles[ny][nx]]?.[moveType];
      if (!step) continue;
      const k = `${nx},${ny}`;
      if (c + step < (d.get(k) ?? Infinity)) { d.set(k, c + step); queue.push([c + step, [nx, ny]]); }
    }
  }
  return d;
}

/** Can every headquarters reach every other over land with tanks? */
export function playable(m, rules) {
  const hqs = m.owned.filter(o => m.tiles[o.y][o.x] === 'H');
  if (hqs.length !== m.players) return false;
  const d = distances(m, rules, [hqs[0].x, hqs[0].y], 'treads');
  return hqs.every(h => d.has(`${h.x},${h.y}`));
}

/** Generate with `o`, trying a few seeds until the map is playable. */
export function generatePlayable(o, rules) {
  for (let i = 0; i < 12; i++) {
    const m = generate({ ...o, seed: (o.seed | 0) + i });
    if (playable(m, rules)) return { map: m, seed: (o.seed | 0) + i };
  }
  return null;
}

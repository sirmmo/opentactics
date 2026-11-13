// Drawing with Kenney's Tiny Battle tiles (16x16, 18 per row).
// What each terrain and unit looks like comes from the `view` fields of the rule set.

export const T = 16;
const COLS = 18;
let sheet, dim;
// Recoloured copies of the sheet for armies whose `view.recolor` shifts a hue
// (the tile set has five colours; this is how we get more), keyed "from>to".
const tinted = new Map();

export async function loadArt() {
  sheet = new Image();
  sheet.src = 'assets/tiles.png';
  await sheet.decode();
  // A darkened copy for units that have already acted.
  dim = document.createElement('canvas');
  dim.width = sheet.width;
  dim.height = sheet.height;
  const c = dim.getContext('2d');
  c.drawImage(sheet, 0, 0);
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = 'rgba(16,16,28,0.5)';
  c.fillRect(0, 0, dim.width, dim.height);
  tinted.clear();
}

function darken(canvas) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const c = out.getContext('2d');
  c.drawImage(canvas, 0, 0);
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = 'rgba(16,16,28,0.5)';
  c.fillRect(0, 0, out.width, out.height);
  return out;
}

/**
 * The sheet with every strongly coloured pixel whose hue is near `from` turned to
 * hue `to` (degrees), keeping saturation and lightness (`light` nudges it, -1..1). Grey outlines, skin and the
 * other team colours are left alone. Returns { normal, dim } canvases, cached.
 */
function recolored({ from, to, range = 40, light = 0 }) {
  const key = `${from}>${to}>${range}>${light}`;
  if (tinted.has(key)) return tinted.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  c.drawImage(sheet, 0, 0);
  const img = c.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const [hue, sat, lum] = toHsl(px[i], px[i + 1], px[i + 2]);
    const off = ((hue - from + 540) % 360) - 180;
    if (sat < 0.25 || Math.abs(off) > range) continue;
    [px[i], px[i + 1], px[i + 2]] = toRgb((to + off + 360) % 360, sat, Math.max(0, Math.min(1, lum + light)));
  }
  c.putImageData(img, 0, 0);
  const pair = { normal: canvas, dim: darken(canvas) };
  tinted.set(key, pair);
  return pair;
}

function toHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function toRgb(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
}

/** Which sheet an army's tiles come from (undefined means the plain sheet). */
function paintFor(rules, player) {
  const re = player >= 0 ? rules.factions[player]?.view?.recolor : null;
  return re && typeof re.from === 'number' && typeof re.to === 'number' ? recolored(re) : undefined;
}

export function drawTile(ctx, id, dx, dy, size = T, { flip = false, dark = false, paint } = {}) {
  const src = paint ? (dark ? paint.dim : paint.normal) : dark ? dim : sheet;
  const sx = (id % COLS) * T, sy = Math.floor(id / COLS) * T;
  if (flip) {
    ctx.save();
    ctx.translate(dx + size, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(src, sx, sy, T, T, 0, 0, size, size);
    ctx.restore();
  } else {
    ctx.drawImage(src, sx, sy, T, T, dx, dy, size, size);
  }
}

function quarter(ctx, id, qx, qy, dx, dy) {
  ctx.drawImage(sheet, (id % COLS) * T + qx * 8, Math.floor(id / COLS) * T + qy * 8, 8, 8, dx + qx * 8, dy + qy * 8, 8, 8);
}

export function factionRow(rules, player) {
  return player >= 0 && rules.factions[player] ? (rules.factions[player].view?.row ?? 0) : 0;
}

export function factionColor(rules, player) {
  return rules.factions[player]?.view?.color || '#c8c8d0';
}

export function unitTile(rules, kind, player) {
  return (rules.units[kind].view?.tile ?? 106) + COLS * factionRow(rules, player);
}

export function drawUnit(ctx, rules, kind, player, dx, dy, size, dark = false) {
  const flip = !!rules.factions[player]?.view?.flip;
  drawTile(ctx, unitTile(rules, kind, player), dx, dy, size, { flip, dark, paint: paintFor(rules, player) });
  // Units that share a picture with another carry a letter (view.mark).
  const mark = rules.units[kind].view?.mark;
  if (mark) {
    const s = Math.max(6, Math.round(size * 0.36));
    ctx.save();
    ctx.fillStyle = '#1b1a26';
    ctx.fillRect(dx, dy, s, s);
    ctx.fillStyle = factionColor(rules, player);
    ctx.font = `${Math.round(s * 0.95)}px kenney-mono, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mark, dx + s / 2, dy + s / 2 + 1);
    ctx.restore();
  }
}

/** Turn a map document into the board the drawing code uses. Throws on unknown glyphs. */
export function mapToBoard(rules, map) {
  const glyphs = new Map(rules.terrains.map((t, i) => [t.glyph, i]));
  const terrain = [];
  for (const row of map.tiles) for (const ch of row) {
    if (!glyphs.has(ch)) throw new Error(`Unknown terrain '${ch}'`);
    terrain.push(glyphs.get(ch));
  }
  const owner = new Array(map.width * map.height).fill(-1);
  for (const o of map.owned || []) owner[o.y * map.width + o.x] = o.player;
  return { width: map.width, height: map.height, terrain, owner };
}

// Shoreline pieces: [outer corner, edge along x, edge along y, inner corner, open water]
// for each quarter of a water tile (top-left, top-right, bottom-left, bottom-right).
const SHORE = [
  [18, 19, 36, 91, 37],
  [20, 19, 38, 90, 37],
  [54, 55, 36, 93, 37],
  [56, 55, 38, 92, 37],
];

// Road piece for each neighbour mask (north 1, east 2, south 4, west 8).
const ROAD = [108, 162, 109, 163, 126, 144, 127, 145, 111, 165, 110, 164, 129, 147, 128, 146];

/** Draw the whole battlefield once at 1:1 scale; the game scales it up. */
export function terrainLayer(rules, board, canvas = document.createElement('canvas')) {
  const { width: w, height: h } = board;
  canvas.width = w * T;
  canvas.height = h * T;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) drawCell(ctx, rules, board, x, y);
  return canvas;
}

/** Redraw just some tiles (say, property that changed hands) on an existing layer. */
export function redrawTiles(rules, board, canvas, indices) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (const i of indices) {
    const x = i % board.width, y = Math.floor(i / board.width);
    ctx.clearRect(x * T, y * T, T, T);
    drawCell(ctx, rules, board, x, y);
  }
}

function drawCell(ctx, rules, board, x, y) {
  const { width: w, height: h } = board;
  const view = (x, y) => rules.terrains[board.terrain[y * w + x]].view || {};
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const water = (x, y) => !inside(x, y) || view(x, y).base === 'water';
  const road = (x, y) => inside(x, y) && !!view(x, y).auto;
  {
    const v = view(x, y);
    const dx = x * T, dy = y * T;
    if (v.base === 'water') {
      SHORE.forEach((piece, q) => {
        const sx = q & 1 ? 1 : -1, sy = q & 2 ? 1 : -1;
        const side = water(x + sx, y), vert = water(x, y + sy), diag = water(x + sx, y + sy);
        const id = !side && !vert ? piece[0] : side && !vert ? piece[1] : !side && vert ? piece[2] : !diag ? piece[3] : piece[4];
        quarter(ctx, id, q & 1, q >> 1, dx, dy);
      });
    } else if (v.base === 'sand') {
      // Sand: grass underneath, then a sandy patch with a few darker grains.
      drawTile(ctx, 0, dx, dy);
      ctx.fillStyle = '#ecd7a0';
      ctx.fillRect(dx, dy, T, T);
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      ctx.fillStyle = '#d4b878';
      for (let k = 0; k < 5; k++) ctx.fillRect(dx + ((n >> (k * 3)) % 14) + 1, dy + ((n >> (k * 3 + 7)) % 14) + 1, 1, 1);
    } else {
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      drawTile(ctx, n % 11 === 0 ? 1 : n % 13 === 0 ? 2 : 0, dx, dy);
    }
    if (v.reef) {
      // Rocks breaking the water, with a little foam.
      const n = ((x * 2654435761) ^ (y * 40503)) >>> 0;
      for (const [rx, ry, r] of [[4 + (n % 3), 5, 3], [10, 9 + (n % 3), 2.5], [6, 11, 2]]) {
        ctx.fillStyle = '#ffffffb0';
        ctx.fillRect(dx + rx - r, dy + ry + r - 1, r * 2 + 1, 1);
        ctx.fillStyle = '#5c6b78';
        ctx.fillRect(dx + rx - r + 1, dy + ry - r + 1, r * 2 - 1, r * 2 - 1);
        ctx.fillStyle = '#8796a3';
        ctx.fillRect(dx + rx - r + 1, dy + ry - r + 1, r, 1);
      }
    }
    if (v.auto === 'road') {
      const mask = (road(x, y - 1) ? 1 : 0) | (road(x + 1, y) ? 2 : 0) | (road(x, y + 1) ? 4 : 0) | (road(x - 1, y) ? 8 : 0);
      drawTile(ctx, ROAD[mask], dx, dy);
    } else if (v.auto === 'bridge') {
      const across = road(x - 1, y) || road(x + 1, y) || !(road(x, y - 1) || road(x, y + 1));
      drawTile(ctx, across ? 130 : 166, dx, dy);
    }
    if (v.tile != null) drawTile(ctx, v.tile, dx, dy);
    if (v.building != null) {
      const owner = board.owner[y * w + x];
      drawTile(ctx, v.building + COLS * factionRow(rules, owner), dx, dy, T, { paint: paintFor(rules, owner) });
    }
  }
}

/** A small picture of a map, for lists. */
export function preview(rules, map, maxSide = 160) {
  const layer = terrainLayer(rules, mapToBoard(rules, map));
  const units = document.createElement('canvas');
  const scale = Math.min(1, maxSide / Math.max(layer.width, layer.height));
  units.width = Math.round(layer.width * scale);
  units.height = Math.round(layer.height * scale);
  const ctx = units.getContext('2d');
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(layer, 0, 0, units.width, units.height);
  for (const u of map.units || []) {
    const kind = rules.units.findIndex(d => d.id === u.type);
    if (kind >= 0) drawUnit(ctx, rules, kind, u.player, u.x * T * scale, u.y * T * scale, T * scale);
  }
  return units;
}

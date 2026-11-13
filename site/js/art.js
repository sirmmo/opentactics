// Drawing with Kenney's Tiny Battle tiles (16x16, 18 per row).
// What each terrain and unit looks like comes from the `view` fields of the rule set.

export const T = 16;
const COLS = 18;
let sheet, dim;

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
}

export function drawTile(ctx, id, dx, dy, size = T, { flip = false, dark = false } = {}) {
  const src = dark ? dim : sheet;
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
  drawTile(ctx, unitTile(rules, kind, player), dx, dy, size, { flip, dark });
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
  const view = (x, y) => rules.terrains[board.terrain[y * w + x]].view || {};
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const water = (x, y) => !inside(x, y) || view(x, y).base === 'water';
  const road = (x, y) => inside(x, y) && !!view(x, y).auto;

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = view(x, y);
    const dx = x * T, dy = y * T;
    if (v.base === 'water') {
      SHORE.forEach((piece, q) => {
        const sx = q & 1 ? 1 : -1, sy = q & 2 ? 1 : -1;
        const side = water(x + sx, y), vert = water(x, y + sy), diag = water(x + sx, y + sy);
        const id = !side && !vert ? piece[0] : side && !vert ? piece[1] : !side && vert ? piece[2] : !diag ? piece[3] : piece[4];
        quarter(ctx, id, q & 1, q >> 1, dx, dy);
      });
    } else {
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      drawTile(ctx, n % 11 === 0 ? 1 : n % 13 === 0 ? 2 : 0, dx, dy);
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
      drawTile(ctx, v.building + COLS * factionRow(rules, board.owner[y * w + x]), dx, dy);
    }
  }
  return canvas;
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

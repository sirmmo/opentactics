// Linked holdings: a city or factory handed to a friend who runs it in another game
// (citysim, OpenFactor). Two links carry everything; see HOLDINGS.md.

import * as share from './share.js';

const KEY = 'ot-holding-reports';

/** Letters for the 5x5 neighbourhood in a holding link (fixed, whatever the rule set's glyphs). */
function letter(t) {
  if (!t) return '#';
  if (t.hq) return 'H';
  if (t.holding?.kind === 'city' || t.id === 'city') return 'c';
  if (t.builds?.length || t.holding?.kind === 'factory') return 'F';
  const id = t.id;
  if (id === 'sea' || id === 'reef' || id === 'river' || id === 'lake') return '~';
  if (id === 'forest' || id === 'woods') return 'f';
  if (id === 'mountain' || id === 'hill') return '^';
  if (id === 'road' || id === 'bridge') return '=';
  return '.';
}

/** The holding link for tile (x, y) of the game in `state`, owned by `player`. */
export async function holdingLink(rules, state, x, y, player) {
  const t = rules.terrains[state.terrain[y * state.width + x]];
  const def = t.holding;
  const around = [];
  for (let dy = -2; dy <= 2; dy++) {
    let row = '';
    for (let dx = -2; dx <= 2; dx++) {
      const ax = x + dx, ay = y + dy;
      row += ax < 0 || ay < 0 || ax >= state.width || ay >= state.height ? '#' : letter(rules.terrains[state.terrain[ay * state.width + ax]]);
    }
    around.push(row);
  }
  const old = (state.holdings || []).find(hd => hd.x === x && hd.y === y && hd.player === player);
  const faction = rules.factions[player];
  const doc = {
    v: 1,
    kind: def.kind,
    terrain: t.id,
    builds: t.builds || [],
    game: state.id,
    map: state.name,
    tile: [x, y],
    name: old?.name || `${state.name} ${x},${y}`,
    owner: player,
    army: faction?.name || '',
    color: faction?.view?.color || '',
    day: state.day,
    pace: def.pace || (def.kind === 'city' ? 3 : 10),
    around,
    return: new URL(location.pathname, location.href).href,
  };
  const base = def.url || (def.kind === 'city' ? 'https://ingmmo.com/citysim/play/' : 'https://ingmmo.com/openfactor/play/');
  const url = new URL(base, location.href);
  url.hash = await share.pack('holding', doc);
  return url.href;
}

/** A report from a pasted link or fragment, or null. */
export async function parseReport(text) {
  const m = /#report(json)?=[A-Za-z0-9_-]+/.exec(String(text).trim());
  if (!m) return null;
  const r = await share.unpack('report', m[0]);
  if (!r || r.v !== 1 || !r.game || !Array.isArray(r.tile)) throw new Error('This is not a report from a holding.');
  return r;
}

/** The engine action for a report. */
export const reportAction = r => ({
  type: 'report', x: r.tile[0], y: r.tile[1], day: r.day | 0,
  income_pct: Math.max(0, r.income_pct | 0), discount_pct: Math.max(0, r.discount_pct | 0),
  name: String(r.name || '').slice(0, 40), summary: String(r.summary || '').slice(0, 120),
});

// Reports opened while their game was not on screen wait here until it is.
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const store = list => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-50))); } catch { /* full or blocked */ } };

export function keepReport(r) {
  const list = load().filter(o => !(o.game === r.game && o.tile[0] === r.tile[0] && o.tile[1] === r.tile[1] && o.owner === r.owner && (o.day | 0) <= (r.day | 0)));
  list.push(r);
  store(list);
}

/** Take out the waiting reports for game `id` that `accept(report)` agrees to. */
export function takeReports(id, accept) {
  if (!id) return [];
  const list = load(), taken = [], kept = [];
  for (const r of list) (r.game === id && accept(r) ? taken : kept).push(r);
  if (taken.length) store(kept);
  return taken;
}

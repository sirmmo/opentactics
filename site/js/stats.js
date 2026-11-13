// End-of-game numbers: a snapshot per turn, drawn as small line charts.

import { factionColor } from './art.js';

/** What each player has right now. `state` is the full engine state. */
export function snapshot(rules, state, income = []) {
  const players = state.players.map((p, i) => {
    const mine = state.units.filter(u => u.player === i).flatMap(u => [u, ...(u.cargo || [])]);
    return {
      units: mine.length,
      value: mine.reduce((sum, u) => sum + Math.round(rules.units[u.kind].cost * u.hp / 100), 0),
      props: state.owner.filter(o => o === i).length,
      income: income[i] ?? 0,
      alive: p.alive,
    };
  });
  return { day: state.day, turn: state.turn, players };
}

/** Replay a recorded game in the engine and collect a snapshot after every turn change. */
export function statsFor(engine, rules, start, actions) {
  let st = engine.call({ op: 'load', rules, state: start });
  const out = [snapshot(rules, st.state, st.income)];
  for (const [player, action] of actions) {
    let res;
    try { res = engine.call({ op: 'act', player, action }); } catch { break; }
    if (res.events.some(e => e.e === 'turn' || e.e === 'over')) out.push(snapshot(rules, res.state, res.income));
    st = res;
  }
  return out;
}

const CHARTS = [
  ['value', 'Army value'],
  ['props', 'Properties'],
  ['units', 'Units'],
  ['income', 'Income per day'],
];

function svg(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** One chart per measure; one line per player. */
export function statsView(rules, snaps, names) {
  const wrap = document.createElement('div');
  wrap.className = 'stats-grid';
  if (snaps.length < 2) {
    wrap.textContent = 'Not enough turns were played to draw anything.';
    return wrap;
  }
  const n = snaps[0].players.length;
  for (const [key, title] of CHARTS) {
    const W = 300, H = 120, pad = 4;
    const max = Math.max(1, ...snaps.flatMap(s => s.players.map(p => p[key])));
    const box = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.textContent = `${title} · peak ${max}`;
    const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });
    for (let g = 1; g < 4; g++) chart.append(svg('line', { x1: 0, x2: W, y1: (H * g) / 4, y2: (H * g) / 4, class: 'grid' }));
    for (let p = 0; p < n; p++) {
      const pts = snaps.map((s, i) => {
        const x = pad + (i / (snaps.length - 1)) * (W - 2 * pad);
        const y = H - pad - (s.players[p][key] / max) * (H - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      chart.append(svg('polyline', { points: pts.join(' '), fill: 'none', stroke: factionColor(rules, p), 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    }
    box.append(cap, chart);
    wrap.append(box);
  }
  const legend = document.createElement('div');
  legend.className = 'stats-legend';
  for (let p = 0; p < n; p++) {
    const item = document.createElement('span');
    item.style.setProperty('--c', factionColor(rules, p));
    item.textContent = names[p];
    legend.append(item);
  }
  const days = document.createElement('div');
  days.className = 'muted small';
  days.textContent = `Day ${snaps[0].day} to day ${snaps[snaps.length - 1].day}`;
  wrap.append(legend, days);
  return wrap;
}

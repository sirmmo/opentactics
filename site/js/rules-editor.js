// The rules editor: change numbers in a rule set (money, combat, units, the damage
// table), check it with the engine, keep it in this browser, download it, or share
// it as a link. Every army still plays by the same rules: there is nothing per army.

import { link, unpack } from './share.js';

const STORE = 'ot.rules';

/** Rule sets kept in this browser, by id. */
export function customRules() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
}

function saveCustom(doc) {
  const all = customRules();
  const id = (doc.name || 'rules').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'rules';
  all[id] = doc;
  localStorage.setItem(STORE, JSON.stringify(all));
  return id;
}

// ---- links: the rule set, compressed, in the URL fragment ----

export const rulesLink = doc => link('rules', doc);
export const rulesFromHash = (hash = location.hash) => unpack('rules', hash);

// ---- the screen ----

export function rulesEditor(root, { h, engine, start, bundled, onBack, onPlay }) {
  let doc = structuredClone(start);
  const status = h('div', { class: 'status' });
  const body = h('div', { class: 'rules-body' });
  let tab = 'general';

  const check = async () => {
    try {
      const map = await fetch('maps/first-contact.json').then(r => r.json());
      engine.call({ op: 'check', rules: doc, map });
      status.textContent = '✓ The engine accepts these rules';
      status.className = 'status ok';
      return true;
    } catch (e) {
      status.textContent = `⚠ ${e.message}`;
      status.className = 'status bad';
      return false;
    }
  };

  const numIn = (get, set, { min = 0, max = 1e6, step = 1 } = {}) => h('input', {
    type: 'number', min, max, step, value: get() ?? '', class: 'tiny',
    onchange: e => { const v = e.target.value === '' ? undefined : Math.max(min, Math.min(max, +e.target.value)); set(v); check(); },
  });
  const boolIn = (get, set) => h('input', { type: 'checkbox', checked: !!get(), onchange: e => { set(e.target.checked); check(); } });
  const field = (label, control, hint = '') => h('label', { class: 'rfield' }, h('span', {}, label, hint ? h('small', {}, hint) : null), control);

  const tabs = {
    general: () => [
      field('Name', h('input', { value: doc.name || '', maxlength: 40, oninput: e => { doc.name = e.target.value; } })),
      field('Description', h('input', { value: doc.description || '', maxlength: 200, oninput: e => { doc.description = e.target.value; } })),
      h('h3', {}, 'Money'),
      field('Starting funds', numIn(() => doc.economy.start_funds, v => { doc.economy.start_funds = v ?? 0; })),
      field('Unit limit', numIn(() => doc.economy.unit_cap, v => { doc.economy.unit_cap = v ?? 0; }), '0 = no limit'),
      h('h3', {}, 'Combat'),
      field('Luck', numIn(() => doc.combat.luck, v => { doc.combat.luck = v ?? 0; }, { max: 50 }), 'random extra damage, 0 to this'),
      field('Cover per star', numIn(() => doc.combat.defense_per_star, v => { doc.combat.defense_per_star = v ?? 0; }, { max: 25 }), '% less damage per terrain star'),
      field('Counterattacks', boolIn(() => doc.combat.counterattack, v => { doc.combat.counterattack = v; })),
      h('h3', {}, 'Capture and repair'),
      field('Capture points', numIn(() => doc.capture.points, v => { doc.capture.points = v || 1; }, { min: 1, max: 100 }), 'a unit adds its health (1-10) a turn'),
      field('Repair per turn', numIn(() => doc.repair.hp, v => { doc.repair.hp = v ?? 0; }, { max: 10 }), 'health out of 10'),
      field('Repairs cost money', boolIn(() => doc.repair.costs, v => { doc.repair.costs = v; })),
      h('h3', {}, 'Victory'),
      field('Taking an HQ defeats its owner', boolIn(() => doc.victory.hq_capture, v => { doc.victory.hq_capture = v; })),
      field('Losing every unit defeats a player', boolIn(() => doc.victory.rout, v => { doc.victory.rout = v; })),
      field('Day limit', numIn(() => doc.victory.day_limit, v => { doc.victory.day_limit = v ?? 0; }, { max: 999 }), '0 = none; then most property wins'),
    ],
    units: () => {
      const cols = [['name', 'Name', 'text'], ['cost', 'Cost'], ['moves', 'Moves', 'n', 40], ['vision', 'Sight', 'n', 20], ['range0', 'Min range', 'n', 10], ['range1', 'Max range', 'n', 10],
        ['fuel', 'Fuel', 'n', 999], ['fuel_per_day', 'Fuel/day', 'n', 99], ['ammo', 'Ammo', 'n', 99], ['can_capture', 'Captures', 'b']];
      const cell = (u, [k, , kind, max]) => {
        if (kind === 'text') return h('input', { value: u.name, maxlength: 24, oninput: e => { u.name = e.target.value; } });
        if (kind === 'b') return boolIn(() => u[k], v => { u[k] = v; });
        if (k === 'range0' || k === 'range1') {
          const i = k === 'range0' ? 0 : 1;
          return numIn(() => (u.range || [1, 1])[i], v => { u.range = [...(u.range || [1, 1])]; u.range[i] = v || 1; }, { min: 1, max });
        }
        return numIn(() => u[k], v => { if (v == null) delete u[k]; else u[k] = v; }, { max: max ?? 1e6 });
      };
      return [h('p', { class: 'muted small' }, 'Every army gets the same units. Fuel and ammo only matter in games with fuel and ammo on (0 = unlimited).'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'rtable' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Unit'), ...cols.map(c => h('th', {}, c[1])))),
          h('tbody', {}, ...doc.units.map(u => h('tr', {}, h('td', { class: 'muted small' }, u.id), ...cols.map(c => h('td', {}, cell(u, c)))))))) ];
    },
    damage: () => [
      h('p', { class: 'muted small' }, 'Base damage, in percent, that each unit (row) deals to each other unit (column). Empty means it cannot attack it.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'rtable dmg' },
        h('thead', {}, h('tr', {}, h('th', {}, '↓ hits →'), ...doc.units.map(d => h('th', { title: d.name }, d.name.slice(0, 6))))),
        h('tbody', {}, ...doc.units.map(a => h('tr', {}, h('th', {}, a.name),
          ...doc.units.map(d => h('td', {}, numIn(() => a.damage?.[d.id], v => { a.damage ||= {}; if (v == null || v === 0) delete a.damage[d.id]; else a.damage[d.id] = v; }, { max: 200 }))))))))],
    advanced: () => {
      const area = h('textarea', { class: 'json', spellcheck: false }, JSON.stringify(doc, null, 1));
      return [h('p', { class: 'muted small' }, 'The whole rule set as JSON: terrain, powers, weather, armies (name and colours only). Apply to use it.'), area,
        h('button', { onclick: () => { try { doc = JSON.parse(area.value); render(); check(); } catch (e) { status.textContent = `⚠ ${e.message}`; status.className = 'status bad'; } } }, 'Apply JSON')];
    },
  };

  const tabBar = h('div', { class: 'row tabs' });
  const render = () => {
    tabBar.replaceChildren(...[['general', 'General'], ['units', 'Units'], ['damage', 'Damage'], ['advanced', 'Everything (JSON)']].map(([k, l]) =>
      h('button', { class: tab === k ? 'primary' : '', onclick: () => { tab = k; render(); } }, l)));
    body.replaceChildren(...tabs[tab]());
  };

  const loadSel = h('select', { onchange: async e => {
    const v = e.target.value;
    if (v.startsWith('custom:')) doc = structuredClone(customRules()[v.slice(7)]);
    else doc = await fetch(v).then(r => r.json());
    render(); check();
  } }, ...bundled.map(b => h('option', { value: b.url }, b.name)),
  ...Object.entries(customRules()).map(([id, d]) => h('option', { value: `custom:${id}` }, `Custom: ${d.name || id}`)));

  root.replaceChildren(h('div', { class: 'setup-screen rules-editor' },
    h('header', { class: 'bar' }, h('button', { onclick: onBack }, '← Menu'), h('h2', {}, 'Rules editor'), h('div', { class: 'spacer' }),
      h('span', { class: 'muted small' }, 'Start from'), loadSel,
      h('button', { onclick: async () => { if (await check()) { saveCustom(doc); status.textContent = '✓ Saved in this browser: pick it on the setup screen'; } } }, 'Save'),
      h('button', { onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' })), download: `${(doc.name || 'rules').replace(/\W+/g, '-').toLowerCase()}.json` }); a.click(); } }, 'Download'),
      h('button', { onclick: async () => {
        const link = await rulesLink(doc);
        try { await navigator.clipboard.writeText(link); status.textContent = '✓ Link copied: whoever opens it gets these rules on the setup screen'; } catch { prompt('Share this link:', link); }
      } }, 'Share link'),
      h('button', { class: 'primary', onclick: async () => { if (await check()) onPlay(doc); } }, 'Play with these')),
    h('div', { class: 'rules-main' }, status, tabBar, body)));
  render();
  check();
}

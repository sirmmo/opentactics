// Menus, setup, online rooms and the hand-off to the battle screen and editor.

import { Engine } from './engine.js';
import { loadArt, preview, factionColor, drawUnit } from './art.js';
import { Match, h, $ } from './game.js';
import { Editor } from './editor.js';
import * as net from './net.js';
import { statsFor } from './stats.js';
import * as settings from './settings.js';
import { rulesEditor, customRules, rulesFromHash } from './rules-editor.js';
import * as i18n from './i18n.js';
import * as share from './share.js';
import * as cloud from './cloud.js';

i18n.start();

const app = $('#app');
const HOSTED = 'ot.hosted';
const AUTOSAVE = 'ot.autosave';

/** Keep a local game in the browser after every action, for "Continue". */
function autosaver(rules, resume) {
  let last = 0, timer = null;
  return (player, action, state) => {
    const write = () => {
      last = Date.now();
      try {
        if (state.over) return localStorage.removeItem(AUTOSAVE);
        localStorage.setItem(AUTOSAVE, JSON.stringify({
          format: 'opentactics-save', at: Date.now(), rules, seats: match.seats.map(st => ({ name: st.name, ai: !!st.ai, profile: st.profile })),
          state: engine.call({ op: 'state' }).state, record: match.record, resume,
        }));
      } catch {
        // Too big for storage with the full record: keep the game without it.
        try { localStorage.setItem(AUTOSAVE, JSON.stringify({ format: 'opentactics-save', at: Date.now(), rules, seats: match.seats, state: engine.call({ op: 'state' }).state, resume })); } catch { /* give up */ }
      }
    };
    clearTimeout(timer);
    if (state.over || Date.now() - last > 2000) write(); else timer = setTimeout(write, 2000);
  };
}

function autosaved() {
  try {
    const s = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null');
    return s && !s.state.over ? s : null;
  } catch { return null; }
}
let hostTimers = [];

// ---- installing as an app ------------------------------------------------

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('No offline support:', e));
}
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// iPhones and iPads have no install prompt; Safari's Share menu does it instead.
const appleDevice = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  $('.install-slot')?.replaceChildren(installButton());
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('.install-slot')?.replaceChildren();
});

function installButton() {
  if (installed()) return '';
  if (installPrompt) {
    return h('button', {
      class: 'install', onclick: async () => {
        const p = installPrompt;
        installPrompt = null;
        await p.prompt();
        await p.userChoice.catch(() => {});
        $('.install-slot')?.replaceChildren(installButton());
      },
    }, '⤓ Install the app', h('small', {}, 'Full screen, home-screen icon, plays offline against the computer'));
  }
  if (appleDevice) {
    return h('p', { class: 'install-hint' }, 'To install: tap ', h('b', {}, 'Share'), ' then ', h('b', {}, 'Add to Home Screen'), '.');
  }
  return '';
}
let engine;
let match = null;
let editor = null;
let room = null;      // when hosting: { peer, code, guests: Map(token -> guest) }
let guestLink = null; // when joining: { peer, conn, you }

const BUNDLED_RULES = [
  { id: 'default', name: 'Standard', url: 'rules/default.json' },
  { id: 'blitz', name: 'Blitz', url: 'rules/blitz.json' },
];

// ---- loading -------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

/** Every map we know of: the server's library (or the bundled list) and the player's own. */
async function mapLibrary() {
  let list;
  try {
    list = await fetchJson('api/maps');
  } catch {
    list = (await fetchJson('maps/index.json')).map(m => ({ ...m, url: `maps/${m.id}.json` }));
  }
  // Community maps from the online service, if there is one.
  try {
    const base = await cloud.api();
    if (base) for (const m of await cloud.maps()) list.push({ ...m, id: `community:${m.id}`, url: `${base}/maps/${encodeURIComponent(m.id)}`, community: true });
  } catch { /* offline, or no service */ }
  for (const m of urlMaps()) {
    if (!list.some(e => e.url && absUrl(e.url) === m.url)) list.push({ ...m, remote: true });
  }
  const own = Editor.savedMaps();
  for (const [id, map] of Object.entries(own)) {
    list.push({ id: `local:${id}`, name: map.name, description: map.description, players: map.players, width: map.width, height: map.height, local: true, map });
  }
  return list;
}

// Maps added by URL are remembered in this browser so they stay in the map list.
const URL_MAPS = 'ot.mapUrls';
const absUrl = url => new URL(url, location.href).href;
function urlMaps() {
  try { return JSON.parse(localStorage.getItem(URL_MAPS) || '[]'); } catch { return []; }
}
function rememberUrlMap(url, map) {
  const entry = { id: `url:${url}`, url, name: map.name, description: map.description, players: map.players, width: map.width, height: map.height };
  const list = [entry, ...urlMaps().filter(m => m.url !== url)].slice(0, 50);
  try { localStorage.setItem(URL_MAPS, JSON.stringify(list)); } catch { /* private mode */ }
}
function forgetUrlMap(url) {
  try { localStorage.setItem(URL_MAPS, JSON.stringify(urlMaps().filter(m => m.url !== url))); } catch { /* private mode */ }
}

async function loadMapEntry(entry) {
  if (entry.map) return entry.map;
  return fetchJson(entry.url);
}

function readFile(accept) {
  return new Promise((ok, fail) => {
    const input = h('input', { type: 'file', accept });
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return fail(new Error('No file chosen.'));
      f.text().then(t => { try { ok(JSON.parse(t)); } catch (e) { fail(new Error(`${f.name}: ${e.message}`)); } }, fail);
    };
    input.click();
  });
}

// ---- screens -------------------------------------------------------------

// ---- campaign ----

const CAMPAIGN = 'ot.campaign';
function campaignProgress() {
  try { return { done: [], roster: [], ...JSON.parse(localStorage.getItem(CAMPAIGN) || '{}') }; } catch { return { done: [], roster: [] }; }
}
function saveCampaign(progress) {
  try { localStorage.setItem(CAMPAIGN, JSON.stringify(progress)); } catch { /* storage blocked */ }
}

async function campaignScreen() {
  leaveEverything();
  history.replaceState(null, '', location.pathname);
  document.body.dataset.screen = 'setup';
  app.replaceChildren(h('p', { class: 'loading' }, 'Loading…'));
  let camp, rules;
  try { [camp, rules] = await Promise.all([fetchJson('campaign/index.json'), fetchJson(BUNDLED_RULES[0].url)]); } catch (e) { return app.replaceChildren(h('div', { class: 'error' }, e.message)); }
  const prog = campaignProgress();
  const open = camp.chapters.findIndex(c => !prog.done.includes(c.id));
  const roster = h('div', { class: 'roster' }, prog.roster.length
    ? prog.roster.map(v => {
      const k = rules.units.findIndex(u => u.id === v.type);
      const icon = h('canvas', { width: 32, height: 32 });
      const c = icon.getContext('2d');
      c.imageSmoothingEnabled = false;
      if (k >= 0) drawUnit(c, rules, k, 0, 0, 0, 32);
      const rank = (rules.ranks?.thresholds || [100, 250, 450]).filter(t => v.xp >= t).length;
      return h('div', { class: 'vet' }, icon, h('span', {}, rules.units[k]?.name || v.type), h('small', { class: 'chev' }, '▲'.repeat(rank) || '—'), h('small', { class: 'muted' }, `${v.xp} XP`));
    })
    : h('p', { class: 'muted small' }, 'No veterans yet. Win a chapter and your best surviving units join you.'));
  app.replaceChildren(h('div', { class: 'setup-screen' },
    h('header', { class: 'bar' }, h('button', { onclick: menu }, '← Back'), h('h2', {}, camp.name), h('div', { class: 'spacer' }),
      h('button', { class: 'quiet', onclick: () => { if (confirm('Start the campaign over? Progress and veterans are lost.')) { saveCampaign({ done: [], roster: [] }); campaignScreen(); } } }, 'Start over')),
    h('div', { class: 'missions' },
      h('h3', {}, 'Chapters'),
      h('div', { class: 'mission-list' }, camp.chapters.map((ch, i) => {
        const done = prog.done.includes(ch.id), locked = open >= 0 && i > open;
        return h('button', { class: `mission${done ? ' done' : ''}`, disabled: locked, onclick: () => chapterIntro(ch, rules) },
          h('b', {}, ch.name), h('small', {}, locked ? 'Win the chapter before to unlock it.' : ch.description),
          done ? h('span', { class: 'tick', title: 'Completed' }, '✓') : locked ? h('span', { class: 'tick' }, '🔒') : null);
      })),
      h('h3', {}, 'Veterans'), roster,
      open < 0 ? h('p', { class: 'good' }, 'The long winter is over: every chapter won.') : null)));
}

/** The chapter's story and briefing, then play it. */
async function chapterIntro(ch, rules) {
  let map;
  try { map = await fetchJson(`campaign/${ch.id}.json`); } catch (e) { return alert(e.message); }
  const box = h('div', { class: 'popup menu briefing' },
    h('div', { class: 'title big' }, ch.name),
    h('p', { class: 'story' }, ch.intro),
    h('p', {}, map.mission.briefing),
    h('ul', { class: 'goals' }, goalLines(map, rules).map(([bad, text]) => h('li', { class: bad ? 'bad' : '' }, text))),
    h('button', { class: 'primary', onclick: () => playChapter(ch, map, rules) }, 'Start'),
    h('button', { class: 'quiet', onclick: () => box.remove() }, 'Back'));
  app.querySelector('.setup-screen').append(box);
}

/** Play a chapter: veterans from the roster take the carry tiles. */
async function playChapter(ch, map, rules, resumeFrom = null) {
  const prog = campaignProgress();
  const full = structuredClone(map);
  if (!resumeFrom) {
    const glyph = (x, y) => full.tiles[y][x];
    const spots = (full.campaign?.carry || []).filter(c => !full.units.some(u => u.x === c.x && u.y === c.y));
    for (const v of prog.roster) {
      const def = rules.units.find(u => u.id === v.type);
      const at = spots.findIndex(c => (rules.terrains.find(t => t.glyph === glyph(c.x, c.y))?.move_cost[def?.move_type] || 0) > 0);
      if (!def || at < 0) continue;
      const [c] = spots.splice(at, 1);
      full.units.push({ type: v.type, x: c.x, y: c.y, player: full.mission.player, xp: v.xp });
    }
  }
  const camp = await fetchJson('campaign/index.json');
  const next = camp.chapters[camp.chapters.findIndex(c => c.id === ch.id) + 1];
  playMission(`campaign:${ch.id}`, full, rules, [], resumeFrom, {
    resume: { chapter: ch, map: full },
    menu: [
      { label: 'Restart chapter', action: () => playChapter(ch, map, rules) },
      { label: 'Campaign', action: campaignScreen },
      { label: 'Leave to menu', action: () => { if (match.view.over || confirm('Leave this chapter?')) menu(); } },
    ],
    onWin: state => {
      // The best survivors (by experience) carry on, four at most.
      const me = full.mission.player;
      const mine = state.units.filter(u => u.player === me).flatMap(u => [u, ...(u.cargo || [])]);
      const vets = mine.map(u => ({ type: rules.units[u.kind].id, xp: u.xp || 0 }))
        .sort((a, b) => b.xp - a.xp).slice(0, 4).filter(v => v.xp > 0);
      const p = campaignProgress();
      if (!p.done.includes(ch.id)) p.done.push(ch.id);
      p.roster = vets;
      saveCampaign(p);
      setTimeout(() => {
        const box = h('div', { class: 'popup menu briefing' },
          h('div', { class: 'title big' }, ch.name),
          h('p', { class: 'story' }, ch.outro),
          vets.length ? h('p', { class: 'muted small' }, `${vets.length} veteran${vets.length === 1 ? '' : 's'} will join you in the next chapter.`) : null,
          next ? h('button', { class: 'primary', onclick: () => { box.remove(); campaignScreen().then(() => chapterIntro(next, rules)); } }, `Next: ${next.name}`) : null,
          h('button', { onclick: () => { box.remove(); campaignScreen(); } }, 'Campaign'));
        app.append(box);
      }, 1500);
    },
  });
}

// ---- missions ----

const DONE_KEY = 'ot.missions';
function missionsDone() {
  try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); } catch { return {}; }
}
function markMissionDone(id) {
  const done = missionsDone();
  done[id] = true;
  try { localStorage.setItem(DONE_KEY, JSON.stringify(done)); } catch { /* private mode */ }
}

async function missionsScreen() {
  leaveEverything();
  history.replaceState(null, '', location.pathname);
  document.body.dataset.screen = 'setup';
  app.replaceChildren(h('p', { class: 'loading' }, 'Loading…'));
  let list;
  try { list = await fetchJson('missions/index.json'); } catch (e) { return app.replaceChildren(h('div', { class: 'error' }, e.message)); }
  const done = missionsDone();
  const card = m => h('button', { class: `mission${done[m.id] ? ' done' : ''}`, onclick: () => briefing(m.id, list) },
    h('b', {}, m.name), h('small', {}, m.description), done[m.id] ? h('span', { class: 'tick', title: 'Completed' }, '✓') : null);
  app.replaceChildren(h('div', { class: 'setup-screen' },
    h('header', { class: 'bar' }, h('button', { onclick: menu }, '← Back'), h('h2', {}, 'Missions')),
    h('div', { class: 'missions' },
      h('h3', {}, 'Tutorial'), h('div', { class: 'mission-list' }, list.filter(m => m.tutorial).map(card)),
      h('h3', {}, 'Challenges'), h('div', { class: 'mission-list' }, list.filter(m => !m.tutorial).map(card)))));
}

/** Show a mission's briefing, then play it. */
async function briefing(id, list) {
  let map, rules;
  try {
    map = await fetchJson(`missions/${id}.json`);
    rules = await fetchJson(map.rules ? new URL(map.rules, new URL(`missions/${id}.json`, location.href)).href : BUNDLED_RULES[0].url);
  } catch (e) { return alert(e.message); }
  const m = map.mission;
  const opts = m.options || {};
  const extras = [opts.fog && 'fog of war', opts.supply && 'fuel and ammo', opts.powers && 'powers', opts.weather && opts.weather !== 'off' && 'weather'].filter(Boolean);
  const box = h('div', { class: 'popup menu briefing' },
    h('div', { class: 'title big' }, map.name),
    h('p', {}, m.briefing),
    h('ul', { class: 'goals' }, goalLines(map, rules).map(([bad, text]) => h('li', { class: bad ? 'bad' : '' }, text))),
    extras.length ? h('p', { class: 'muted small' }, `Played with ${extras.join(', ')}.`) : null,
    h('button', { class: 'primary', onclick: () => playMission(id, map, rules, list) }, 'Start'),
    h('button', { class: 'quiet', onclick: () => box.remove() }, 'Back'));
  app.querySelector('.setup-screen').append(box);
}

function goalLines(map, rules) {
  const m = map.mission, lines = [];
  const tile = (x, y) => {
    const glyph = map.tiles?.[y]?.[x];
    return (rules.terrains.find(t => t.glyph === glyph)?.name || 'tile').toLowerCase();
  };
  const say = (g, bad) => {
    switch (g.type) {
      case 'capture': return bad ? `Do not let the enemy take the marked ${tile(g.x, g.y)}` : `Capture the marked ${tile(g.x, g.y)}`;
      case 'lose_tile': return bad ? `Do not lose the marked ${tile(g.x, g.y)}` : `Make the enemy take the marked ${tile(g.x, g.y)}`;
      case 'day': return bad ? `Finish before day ${g.day}` : `Hold out until day ${g.day}`;
      case 'no_enemy_units': return bad ? 'Do not wipe out the enemy' : 'Destroy every enemy unit';
      case 'no_units': return bad ? 'Keep at least one unit alive' : 'Lose all your units';
      case 'unit_gone': return bad ? `Keep the ${g.tag} alive` : `Destroy the ${g.tag}`;
      case 'unit_at': return bad ? `Keep the ${g.tag} away from the marked tile` : `Bring the ${g.tag} to the marked tile`;
      default: return g.type;
    }
  };
  for (const g of m.goals || []) lines.push([false, say(g, false)]);
  for (const g of m.fail || []) lines.push([true, say(g, true)]);
  return lines;
}

function playMission(id, map, rules, list, resumeFrom = null, hooks = {}) {
  leaveEverything();
  const m = map.mission;
  let res;
  try {
    res = resumeFrom ? engine.call({ op: 'load', rules, state: resumeFrom.state }) : engine.call({ op: 'new', rules, map, seed: Math.floor(Math.random() * 2 ** 31) });
  } catch (e) { return alert(e.message); }
  const profile = m.ai?.profile || { level: 'normal', style: 'balanced' };
  const seats = Array.from({ length: map.players }, (_, i) => i === m.player
    ? { name: myName(), local: true, ai: false }
    : { name: 'Enemy', local: false, ai: true, profile });
  document.body.dataset.screen = 'play';
  const root = h('div', { class: 'play-screen' });
  app.replaceChildren(root);
  const next = list[list.findIndex(x => x.id === id) + 1];
  const goals = goalLines(map, rules);
  let saved = false;
  match = new Match(root, {
    engine, rules, state: res.state, income: res.income, seats, driver: true, onWatch: watchReplay,
    guide: resumeFrom ? null : m.guide,
    undoable: true, onApplied: id === 'editor' ? undefined : autosaver(rules, hooks.resume || { mission: { id, map } }),
    menu: hooks.menu || [
      { label: 'Restart mission', action: () => playMission(id, map, rules, list) },
      ...(next ? [{ label: `Next: ${next.name}`, action: () => missionsScreen().then(() => briefing(next.id, list)) }] : []),
      { label: 'All missions', action: missionsScreen },
      { label: 'Leave to menu', action: () => { if (match.view.over || confirm('Leave this mission?')) menu(); } },
    ],
    onHud: view => {
      if (view.over && !saved && view.winners?.includes(m.player)) {
        saved = true;
        if (hooks.onWin) hooks.onWin(engine.call({ op: 'state' }).state); else markMissionDone(id);
      }
      const tips = (m.hints || []).filter(t => (t.day ?? 1) <= view.day).slice(-3).reverse();
      return h('div', { class: 'objectives' },
        h('h3', {}, 'Objectives'),
        h('ul', { class: 'goals' }, goals.map(([bad, text]) => h('li', { class: bad ? 'bad' : '' }, text))),
        tips.length ? h('div', { class: 'tips' }, tips.map(t => h('p', {}, t.text))) : null);
    },
  });
  match.income = res.income;
  if (resumeFrom?.record?.start) match.record = resumeFrom.record;
  match.updateHud();
}

/** A replay or a saved game, from a file the player picks. */
async function openFile() {
  let doc;
  try { doc = await readFile('.json,application/json'); } catch (e) { return void (e.message !== 'No file chosen.' && alert(e.message)); }
  openDocument(doc);
}

function openDocument(doc) {
  if (doc?.format === 'opentactics-pbl') return openLinkedGame(doc);
  if (doc?.format === 'opentactics-replay') return watchReplay(doc);
  if (doc?.format === 'opentactics-save') return continueSave(doc);
  alert('That file is not an OpenTactics replay or saved game.');
}

function downloadSave(rules, seats) {
  const st = engine.call({ op: 'state' });
  const blob = new Blob([JSON.stringify({ format: 'opentactics-save', rules, seats, state: st.state })], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${st.state.name.replace(/\W+/g, '-').toLowerCase()}-day${st.state.day}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- playing by link ----

/** The bundled rule set this is, if any (links then carry its name, not all of it). */
async function bundledRulesId(rules) {
  for (const b of BUNDLED_RULES) {
    try { if (JSON.stringify(await fetchJson(b.url)) === JSON.stringify(rules)) return b.url; } catch { /* skip */ }
  }
  return null;
}

/** It is a friend's turn: hand over the game as a link (or a file). */
async function sendTurn(m, rules, player) {
  const rulesUrl = await bundledRulesId(rules);
  const doc = {
    format: 'opentactics-pbl', version: 1, rules: rulesUrl ? undefined : rules, rulesUrl,
    seats: m.seats.map(st => ({ name: st.name, ai: !!st.ai, profile: st.profile })),
    start: m.record.start, actions: m.record.actions,
  };
  const url = await share.link('game', doc);
  const name = m.playerName(player);
  const status = h('p', { class: 'muted small' });
  const box = h('div', { class: 'send' },
    h('div', { class: 'title big' }, `${name}'s turn`),
    h('p', {}, `Send this link to whoever plays ${name}. They open it, play their turn, and send a link on.`),
    h('input', { value: url, readonly: true, onfocus: e => e.target.select() }),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: async () => { const r = await share.offer(url, `OpenTactics: ${name}'s turn`); status.textContent = r === 'copied' ? 'Copied.' : r === 'shared' ? 'Shared.' : 'Select the link and copy it.'; } }, 'Copy or share the link'),
      h('button', { onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: 'application/json' })), download: `opentactics-${name.toLowerCase().replace(/\W+/g, '-')}-turn.json` }); a.click(); } }, 'Save as a file')),
    url.length > 30000 ? h('p', { class: 'muted small' }, 'This link is long: if a chat app cuts it, send the file instead (Load replay or save opens it).') : null,
    status,
    h('button', { class: 'quiet', onclick: () => menu() }, 'Back to the menu'));
  m.showOverlay(box);
}

/** Open a game someone sent by link (or file): play the turn of whoever is up. */
async function openLinkedGame(doc) {
  leaveEverything();
  let rules;
  try {
    rules = doc.rulesUrl ? await fetchJson(doc.rulesUrl) : doc.rules;
    engine.call({ op: 'load', rules, state: doc.start });
    for (const [player, action] of doc.actions) engine.call({ op: 'act', player, action });
  } catch (e) { return alert(`Could not open the game: ${e.message}`); }
  const st = engine.call({ op: 'state' });
  const turn = st.state.turn;
  const seats = doc.seats.map((s, i) => (s.ai ? { name: s.name, ai: true, local: false, profile: s.profile }
    : i === turn ? { name: s.name, local: true, ai: false } : { name: s.name, local: false, ai: false, mail: true }));
  history.replaceState(null, '', location.pathname);
  document.body.dataset.screen = 'play';
  const root = h('div', { class: 'play-screen' });
  app.replaceChildren(root);
  match = new Match(root, {
    engine, rules, state: st.state, income: st.income, seats, driver: true, onWatch: watchReplay, undoable: true,
    onMailTurn: p => sendTurn(match, rules, p),
    menu: [{ label: 'Leave to menu', action: () => { if (match.view.over || confirm('Leave this game? Opening the link again brings you back.')) menu(); } }],
  });
  match.income = st.income;
  match.record = { start: doc.start, actions: doc.actions.slice() };
  match.setNet(st.state.over ? 'This game is over.' : `Your turn as ${match.playerName(turn)}. When you end it, you get a link for the next player.`);
}

/** Carry on a saved game on this device. Online seats become seats for people here. */
function continueSave(save) {
  if (save.resume?.chapter) return playChapter(save.resume.chapter, save.resume.map, save.rules, save);
  if (save.resume?.mission) return playMission(save.resume.mission.id, save.resume.mission.map, save.rules, [], save);
  leaveEverything();
  let res;
  try { res = engine.call({ op: 'load', rules: save.rules, state: save.state }); } catch (e) { return alert(`Could not load the game: ${e.message}`); }
  const seats = save.seats.map((st, i) => ({ name: st.ai ? save.rules.factions[i]?.name || 'Computer' : st.name || 'Player', ai: !!st.ai, local: !st.ai, profile: st.profile }));
  document.body.dataset.screen = 'play';
  const root = h('div', { class: 'play-screen' });
  app.replaceChildren(root);
  match = new Match(root, {
    engine, rules: save.rules, state: res.state, income: res.income, seats, driver: true, onWatch: watchReplay,
    undoable: true, onApplied: autosaver(save.rules),
    menu: [
      { label: 'Save game', action: () => downloadSave(save.rules, match.seats) },
      { label: 'Leave to menu', action: () => { if (match.view.over || confirm('Leave this game?')) menu(); } },
    ],
  });
  match.income = res.income;
  if (save.record?.start && Array.isArray(save.record.actions)) match.record = save.record;
}

/** Step through a recorded game. */
function watchReplay(rec) {
  leaveEverything();
  let stats;
  try {
    stats = statsFor(engine, rec.rules, rec.start, rec.actions);
    engine.call({ op: 'load', rules: rec.rules, state: rec.start });
  } catch (e) { return alert(`Could not play the replay: ${e.message}`); }
  document.body.dataset.screen = 'play';
  const root = h('div', { class: 'play-screen' });
  app.replaceChildren(root);
  const seats = rec.seats.map(st => ({ name: st.name, ai: false, local: false }));
  match = new Match(root, {
    engine, rules: rec.rules, state: rec.start, seats, driver: false,
    replay: { start: rec.start, actions: rec.actions, stats },
    menu: [
      { label: 'Download replay', action: () => { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(rec)], { type: 'application/json' })), download: `${(rec.name || 'game').replace(/\W+/g, '-').toLowerCase()}-replay.json` }); a.click(); } },
      { label: 'Leave to menu', action: menu },
    ],
  });
  const total = rec.actions.length;
  const slider = h('input', { type: 'range', min: 0, max: total, value: 0, oninput: () => match.replayJump(+slider.value) });
  const label = h('span', { class: 'muted small' });
  const play = h('button', { class: 'primary', onclick: () => { match.playing = !match.playing; if (match.playing && !match.replayForward()) match.playing = false; update(); } });
  const update = () => {
    slider.value = match.rIndex;
    label.textContent = `Move ${match.rIndex} of ${total} · day ${match.view.day}`;
    play.textContent = match.playing ? 'Pause' : '▶ Play';
  };
  match.onReplayStep = update;
  const controls = h('div', { class: 'replay-bar' },
    h('div', { class: 'row' },
      h('button', { title: 'Start', onclick: () => { match.playing = false; match.replayJump(0); } }, '«'),
      h('button', { title: 'Back one', onclick: () => { match.playing = false; match.replayJump(match.rIndex - 1); } }, '◀'),
      play,
      h('button', { title: 'Forward one', onclick: () => { match.playing = false; match.replayForward(); } }, '▶'),
      h('button', { title: 'End', onclick: () => { match.playing = false; match.replayJump(total); } }, '»')),
    slider, label);
  $('.side', root).prepend(h('h3', {}, `Replay · ${rec.name || ''}`), controls);
  match.setNet('Watching a replay: everything is visible.');
  update();
}

function leaveEverything() {
  if (room) cloud.unlistRoom(room.code);
  for (const t of hostTimers) clearInterval(t);
  hostTimers = [];
  match?.destroy();
  match = null;
  editor?.destroy();
  editor = null;
  room?.peer.destroy();
  room = null;
  guestLink?.peer.destroy();
  guestLink = null;
  document.body.dataset.screen = 'menu';
}

/** The game this browser was hosting, if the page was closed or reloaded mid-game. */
function hostedGame() {
  try {
    const saved = JSON.parse(localStorage.getItem(HOSTED) || 'null');
    if (saved && !saved.state.over && Date.now() - saved.at < 24 * 3600e3) return saved;
  } catch { /* nothing usable */ }
  return null;
}

function resumeButton() {
  const saved = hostedGame();
  if (!saved) return '';
  return h('div', { class: 'row resume' },
    h('button', { class: 'primary', onclick: () => setup('host', { resume: saved }) }, `Resume hosting room ${saved.code}`),
    h('span', { class: 'muted small' }, `${saved.state.name}, day ${saved.state.day}. Your guests reconnect on their own.`),
    h('button', { class: 'quiet', onclick: e => { try { localStorage.removeItem(HOSTED); } catch { /* ignore */ } e.target.closest('.resume').remove(); } }, 'Forget it'));
}

async function openRulesEditor() {
  leaveEverything();
  document.body.dataset.screen = 'setup';
  const start = await fetchJson(BUNDLED_RULES[0].url);
  rulesEditor(app, {
    h, engine, start, bundled: BUNDLED_RULES, onBack: menu,
    onPlay: doc => setup('local', { rules: { doc, name: doc.name, shared: true } }),
  });
}

function showSettings() {
  const box = h('div', { class: 'popup menu settings-box' });
  box.append(settings.settingsPanel(h, () => box.remove()));
  app.append(box);
}

function menu() {
  leaveEverything();
  history.replaceState(null, '', location.pathname);
  app.replaceChildren(h('div', { class: 'menu-screen' },
    h('div', { class: 'logo' }, h('h1', {}, 'OPEN', h('span', {}, 'TACTICS')), h('p', {}, 'Turn-based skirmish on a grid. Same army for everyone.')),
    h('div', { class: 'choices' },
      ...(autosaved() ? [h('button', { class: 'primary big', onclick: () => continueSave(autosaved()) }, 'Continue',
        h('small', {}, `${autosaved().state.name}, day ${autosaved().state.day}`))] : []),
      h('button', { class: `${autosaved() ? '' : 'primary '}big`, onclick: () => setup('local') }, 'Play', h('small', {}, 'Against the computer, or take turns on one screen')),
      h('button', { class: 'big', onclick: () => campaignScreen() }, 'Campaign', h('small', {}, 'The Long Winter: five battles, and veterans who carry on')),
      h('button', { class: 'big', onclick: () => missionsScreen() }, 'Missions', h('small', {}, 'Tutorial and challenges, one step at a time')),
      h('button', { class: 'big', onclick: () => setup('host') }, 'Host online', h('small', {}, 'Open a room and share its code')),
      h('button', { class: 'big', onclick: () => joinScreen() }, 'Join online', h('small', {}, 'Enter a friend’s room code')),
      h('button', { class: 'big', onclick: () => openEditor() }, 'Map editor', h('small', {}, 'Draw or generate maps, and make missions')),
      h('button', { class: 'big', onclick: () => openRulesEditor() }, 'Rules editor', h('small', {}, 'Change units, damage and money, and share your rules')),
      h('button', { class: 'big', onclick: () => openFile() }, 'Load replay or save', h('small', {}, 'Watch a recorded game, or carry on a saved one')),
      h('button', { class: 'big', onclick: () => showSettings() }, 'Settings', h('small', {}, 'Army symbols, text size, motion, sound and music')),
    ),
    resumeButton(),
    h('div', { class: 'install-slot' }, installButton()),
    h('footer', {}, 'Art and sounds by Kenney (CC0). Online play goes browser to browser over WebRTC.'),
  ));
}

// ---- setup (offline or hosting) ------------------------------------------

async function setup(mode, preset = {}) {
  leaveEverything();
  document.body.dataset.screen = 'setup';
  const cfg = { mode, rules: null, rulesName: '', map: null, seats: [], options: { fog: false, supply: false, weather: 'off', powers: false }, timer: preset.resume?.timer || 0 };
  const err = h('div', { class: 'error hidden' });
  const showError = e => { err.textContent = e.message || String(e); err.classList.remove('hidden'); };
  const clearError = () => err.classList.add('hidden');

  const mapList = h('div', { class: 'maplist' }, h('p', { class: 'muted' }, 'Loading maps…'));
  const rulesSel = h('select', {}, ...BUNDLED_RULES.map(r => h('option', { value: r.url }, r.name)),
    ...Object.entries(customRules()).map(([id, d]) => h('option', { value: `custom:${id}` }, `Custom: ${d.name || id}`)),
    ...(preset.rules?.shared ? [h('option', { value: '?shared', selected: true }, `Shared: ${preset.rules.doc.name}`)] : []),
    h('option', { value: '?url' }, 'From a URL…'), h('option', { value: '?file' }, 'From a file…'));
  const rulesInfo = h('div', { class: 'muted small' });
  const seatsEl = h('div', { class: 'seats' });
  const roomEl = h('div', { class: 'room hidden' });
  const optsEl = h('div', { class: 'opts' });
  const linkEl = h('div', {});
  const startBtn = h('button', { class: 'primary', disabled: true, onclick: () => start() }, mode === 'host' ? 'Start the match' : 'Start');

  app.replaceChildren(h('div', { class: 'setup-screen' },
    h('header', { class: 'bar' }, h('button', { onclick: menu }, '← Back'), h('h2', {}, mode === 'host' ? 'Host an online match' : 'New match'), h('div', { class: 'spacer' }), startBtn),
    err,
    h('div', { class: 'cols' },
      h('section', { class: 'maps' }, h('h3', {}, 'Map'),
        h('div', { class: 'row' },
          h('button', { onclick: () => loadUrl() }, 'Add map from URL'),
          h('button', { onclick: () => readFile('.json,application/json').then(m => chooseMap(m)).catch(showError) }, 'Load file')),
        mapList),
      h('section', { class: 'config' },
        h('h3', {}, 'Rules'), h('div', { class: 'row' }, rulesSel), rulesInfo, optsEl,
        h('h3', {}, 'Players'), seatsEl, roomEl, linkEl)),
  ));

  async function setRules(doc, name) {
    try {
      engine.call({ op: 'check', rules: doc, map: { name: 'probe', width: 4, height: 4, players: 2, tiles: [], units: [] } });
    } catch (e) {
      if (/^rules:/.test(e.message)) throw e;
    }
    cfg.rules = doc;
    cfg.rulesName = name || doc.name;
    rulesInfo.textContent = `${doc.name}: ${doc.description || ''} ${doc.units.length} units, ${doc.terrains.length} terrains, ${doc.factions.length} armies.`;
    renderOptions();
    await renderMaps();
    if (cfg.map) await chooseMap(cfg.map, true);
  }

  rulesSel.onchange = async () => {
    clearError();
    try {
      if (rulesSel.value === '?url') {
        const url = prompt('URL of a rule set (JSON):');
        if (!url) return;
        await setRules(await fetchJson(url), url);
      } else if (rulesSel.value === '?file') {
        await setRules(await readFile('.json,application/json'));
      } else if (rulesSel.value === '?shared') {
        await setRules(preset.rules.doc, preset.rules.name);
      } else if (rulesSel.value.startsWith('custom:')) {
        const doc = customRules()[rulesSel.value.slice(7)];
        await setRules(doc, doc.name);
      } else {
        await setRules(await fetchJson(rulesSel.value));
      }
    } catch (e) { showError(e); }
  };

  /** Load a map by URL (and the rule set it names, if any). New URLs join the map list. */
  async function loadUrl(url, known) {
    url ||= prompt('URL of a map (JSON):')?.trim();
    if (!url) return;
    clearError();
    try {
      url = absUrl(url);
      const map = await fetchJson(url);
      if (map.rules) {
        const rulesUrl = absUrl(new URL(map.rules, url));
        await setRules(await fetchJson(rulesUrl), rulesUrl);
      }
      await chooseMap(map, false, url);
      // Only maps that load and pass the rules check join the list.
      if (!known && !library.some(e => e.url && absUrl(e.url) === url)) {
        rememberUrlMap(url, map);
        await renderMaps();
      }
    } catch (e) { showError(e); }
  }

  let library = [];
  async function renderMaps() {
    try { library = await mapLibrary(); } catch (e) { showError(e); library = []; }
    mapList.replaceChildren(...library.map(entry => {
      const tag = entry.local ? ' · yours' : entry.remote ? ' · from URL' : entry.community ? ` · by ${entry.author || 'someone'}` : entry.shared ? ' · shared' : '';
      const card = h('button', { class: 'mapcard', 'data-name': entry.name, title: entry.remote ? `${entry.description || ''}\n${entry.url}`.trim() : entry.description || '' },
        h('div', { class: 'thumb' }), h('b', {}, entry.name), h('small', {}, `${entry.width}×${entry.height} · ${entry.players} players${tag}`));
      if (entry.remote) {
        const forget = h('span', { class: 'forget', title: 'Remove from this list' }, '×');
        forget.onclick = async ev => { ev.stopPropagation(); forgetUrlMap(entry.url); await renderMaps(); };
        card.append(forget);
      }
      card.onclick = async () => {
        if (entry.url) return loadUrl(entry.url, true);
        clearError();
        try { await chooseMap(await loadMapEntry(entry)); } catch (e) { showError(e); }
      };
      loadMapEntry(entry).then(m => {
        try { $('.thumb', card).append(preview(cfg.rules, m, 120)); } catch { /* drawn with other rules */ }
      }).catch(() => {});
      entry.card = card;
      return card;
    }));
    markChosen();
  }

  function markChosen() {
    for (const c of mapList.children) c.classList.toggle('chosen', !!cfg.map && c.dataset.name === cfg.map.name);
  }

  async function chooseMap(map, keepSeats, url) {
    engine.call({ op: 'check', rules: cfg.rules, map });
    cfg.map = map;
    if (!keepSeats) {
      cfg.mapUrl = url || null;
      // Big games are much quicker when far-apart players move together.
      cfg.options.simultaneous = map.players > 8;
    }
    renderLink();
    markChosen();
    if (!keepSeats || cfg.seats.length !== map.players) {
      cfg.seats = Array.from({ length: map.players }, (_, i) => ({
        kind: i === 0 ? 'local' : mode === 'host' ? 'open' : 'ai',
        name: i === 0 ? myName() : '',
      }));
    }
    renderSeats();
    renderOptions();
    startBtn.disabled = false;
  }

  /** Optional rules for this game. They apply to every player alike. */
  function renderOptions() {
    const r = cfg.rules, o = cfg.options;
    if (!r) return optsEl.replaceChildren();
    if (cfg.map?.mission) return optsEl.replaceChildren(h('p', { class: 'muted small' }, 'This mission sets its own rules.'));
    const box = (k, label, hint) => h('label', { class: 'opt', title: hint },
      h('input', { type: 'checkbox', checked: o[k], onchange: e => { o[k] = e.target.checked; sendLobby(); } }), h('span', {}, label, h('small', {}, hint)));
    const items = [];
    const players = cfg.map?.players || 0;
    o.mode ||= 'standard';
    const modeSel = h('select', { onchange: e => { o.mode = e.target.value; sendLobby(); renderOptions(); } },
      ...[['standard', 'Standard'], ['king_of_the_hill', 'King of the hill'], ['battle_royale', 'Battle royale'], ['survival', 'Survival (co-op)'], ['score_race', 'Score race']]
        .map(([v, l]) => h('option', { value: v, selected: o.mode === v }, l)));
    const modeHelp = {
      standard: 'Take the enemy headquarters or wipe out their army.',
      king_of_the_hill: 'Also: hold the marked middle tile at the start of 3 days in a row.',
      battle_royale: 'From day 5 a storm closes in on the middle and hurts units outside it.',
      survival: 'Everyone not played by the computer is one team. The computer gets free waves of units; last until day 15.',
      score_race: 'After 20 days the side with the most property wins.',
    }[o.mode];
    items.push(h('label', { class: 'opt' }, h('span', {}, 'Game mode', h('small', {}, modeHelp)), modeSel));
    if (players >= 3) items.push(box('diplomacy', 'Diplomacy', 'Offer alliances (shared vision, win together) and truces during the game.'));
    if (players >= 3) items.push(box('simultaneous', 'Far players move at once', 'Players who cannot reach each other this round take their turns at the same time (teammates too). Everyone still plays once a day.'));
    items.push(
      box('fog', 'Fog of war', 'You only see what your units and property see.'),
      box('supply', 'Fuel and ammo', 'Units run out; aircraft and ships are lost with empty tanks. Refill at your property or next to a carrier.'));
    items.push(box('ranks', 'Veteran ranks', 'Units that fight gain experience and up to three ranks, each worth 5% attack and defence.'));
    if (r.powers?.length) items.push(box('powers', 'Powers', `Charge up by fighting, then use one of ${r.powers.length} powers. Everyone picks from the same list.`));
    if (r.weather?.length > 1) {
      if (o.weather !== 'off' && o.weather !== 'random' && !r.weather.some(w => w.id === o.weather)) o.weather = 'off';
      const sel = h('select', { onchange: e => { o.weather = e.target.value; sendLobby(); } },
        h('option', { value: 'off', selected: o.weather === 'off' }, 'Off'),
        h('option', { value: 'random', selected: o.weather === 'random' }, 'Changes each day'),
        ...r.weather.map(w => h('option', { value: w.id, selected: o.weather === w.id }, `Always ${w.name.toLowerCase()}`)));
      items.push(h('label', { class: 'opt' }, h('span', {}, 'Weather', h('small', {}, 'Rain and snow slow units down.')), sel));
    }
    optsEl.replaceChildren(h('h3', {}, 'Optional rules'), ...items);
  }

  /** A link that opens this setup screen with the chosen map (only for maps that live at a URL). */
  function renderLink() {
    if (!cfg.mapUrl) return linkEl.replaceChildren();
    const link = new URL(location.pathname, location.href);
    link.searchParams.set('map', cfg.mapUrl);
    if (mode === 'host') link.searchParams.set('host', '');
    const input = h('input', { value: link.href, readonly: true, onfocus: e => e.target.select() });
    const copy = h('button', { onclick: () => navigator.clipboard?.writeText(link.href).then(() => { copy.textContent = 'Copied'; }, () => input.select()) }, 'Copy');
    linkEl.replaceChildren(h('h3', {}, 'Link to this map'), h('div', { class: 'row room' }, input, copy));
  }

  function renderSeats() {
    if (!cfg.map) return seatsEl.replaceChildren(h('p', { class: 'muted' }, 'Choose a map first.'));
    const kinds = mode === 'host'
      ? [['local', 'This browser'], ['open', 'Online player'], ['ai', 'Computer']]
      : [['local', 'Human'], ['ai', 'Computer'], ['mail', 'Friend, by link']];
    seatsEl.replaceChildren(...cfg.seats.map((seat, i) => {
      const sel = h('select', {}, ...kinds.map(([v, label]) => h('option', { value: v, selected: seat.kind === v || (seat.kind === 'peer' && v === 'open') }, label)));
      sel.onchange = () => {
        if (seat.kind === 'peer') kick(seat);
        seat.kind = sel.value;
        seat.name = seat.kind === 'local' ? myName() : '';
        renderSeats();
        sendLobby();
      };
      const who = seat.kind === 'peer' ? `${seat.name}${seat.conn?.open ? '' : ' (gone)'}` : seat.kind === 'open' ? 'waiting…' : seat.kind === 'ai' ? 'Computer'
        : seat.kind === 'mail' ? 'Plays when you send a link' : seat.name || 'You';
      // How the computer plays this seat.
      seat.profile ||= { level: 'normal', style: 'balanced' };
      const brain = seat.kind === 'ai' ? h('span', { class: 'brain' },
        h('select', { title: 'Skill', onchange: e => { seat.profile.level = e.target.value; } },
          ...[['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']].map(([v, l]) => h('option', { value: v, selected: seat.profile.level === v }, l))),
        h('select', { title: 'Style', onchange: e => { seat.profile.style = e.target.value; } },
          ...[['balanced', 'Balanced'], ['rusher', 'Rusher'], ['turtle', 'Turtle'], ['economist', 'Economist']].map(([v, l]) => h('option', { value: v, selected: seat.profile.style === v }, l)))) : null;
      // Teams only make sense with three or more seats.
      const team = cfg.seats.length > 2 && !cfg.map.mission ? h('select', { class: 'team', title: 'Team', onchange: e => { seat.team = e.target.value === '' ? null : +e.target.value; sendLobby(); } },
        h('option', { value: '', selected: seat.team == null }, 'No team'),
        ...Array.from({ length: Math.min(8, Math.ceil(cfg.seats.length / 2)) }, (_, k) => k + 1).map(t => h('option', { value: t, selected: seat.team === t }, `Team ${t}`))) : null;
      return h('div', { class: 'seat', style: `--c:${factionColor(cfg.rules, i)}` },
        h('span', { class: 'dot' }), h('b', {}, cfg.rules.factions[i].name), sel, h('span', { class: 'who' }, brain || who, team));
    }));
  }

  // ---- hosting ----
  if (mode === 'host') {
    roomEl.classList.remove('hidden');
    roomEl.replaceChildren(h('p', { class: 'muted' }, 'Opening a room…'));
    const code = preset.resume?.code || net.newCode();
    // A resumed room may still be held by the broker for a little while: retry.
    const open = (tries = 0) => net.host(code, { onGuest, onError: e => console.warn('peer', e) }).catch(e => {
      if (tries < 20 && preset.resume) return new Promise(r => setTimeout(r, 3000)).then(() => open(tries + 1));
      throw e;
    });
    // List the room on the online service, so strangers can find it.
    const publicBox = h('label', { class: 'opt hidden' },
      h('input', { type: 'checkbox', onchange: e => { cfg.listed = e.target.checked; advertise(); } }),
      h('span', {}, 'List this room publicly', h('small', {}, 'Anyone can see it on the Join screen and take an open seat or watch.')));
    cloud.api().then(base => { if (base) publicBox.classList.remove('hidden'); });
    open().then(peer => {
      room = { peer, code, guests: new Map() };
      hostTimers.push(setInterval(advertise, 45000));
      if (match) { match.setNet(`Room ${code} is open again.`); hostNetStatus(); }
      const link = `${location.origin}${location.pathname}?join=${code}`;
      const timerSel = h('select', { onchange: e => { cfg.timer = +e.target.value; } },
        ...[[0, 'No time limit'], [60, '1 minute a turn'], [120, '2 minutes a turn'], [300, '5 minutes a turn']].map(([v, l]) => h('option', { value: v, selected: cfg.timer === v }, l)));
      roomEl.replaceChildren(
        h('h3', {}, 'Room'),
        h('div', { class: 'code' }, code),
        h('div', { class: 'row' }, h('input', { value: link, readonly: true, onfocus: e => e.target.select() }),
          h('button', { onclick: () => navigator.clipboard?.writeText(link) }, 'Copy link')),
        h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Turn timer'), timerSel),
        publicBox,
        h('p', { class: 'muted small' }, 'Friends open the link, or choose Join online and type the code. Seats set to “Online player” fill in the order people arrive; anyone else can watch. When a turn runs out of time it ends by itself.'),
      );
    }).catch(e => { (match ? match.setNet(`Could not reopen room ${code}: ${e.message}`) : roomEl.replaceChildren(h('p', { class: 'error' }, `Could not open a room: ${e.message}`))); });
  }

  /** Tell the online service about this room (or take it off the list). */
  function advertise() {
    if (!room) return;
    if (!cfg.listed) { if (cfg.wasListed) cloud.unlistRoom(room.code); cfg.wasListed = false; return; }
    const st = match ? engine.call({ op: 'state' }).state : null;
    cfg.wasListed = true;
    cloud.listRoom(room.code, {
      host: myName(), map: cfg.map?.name || '', rules: cfg.rulesName || '', options: optionsText(),
      players: cfg.seats.length || cfg.map?.players || 2, open: cfg.seats.filter(s => s.kind === 'open').length,
      started: !!match, day: st?.day || 0,
    }).catch(e => console.warn('could not list the room', e));
    if (st?.over) { cfg.listed = false; cloud.unlistRoom(room.code); }
  }

  function lobbyFor(token) {
    return {
      t: 'lobby',
      map: cfg.map ? { name: cfg.map.name, players: cfg.map.players } : null,
      rules: cfg.rulesName,
      options: optionsText(),
      seats: cfg.seats.map((s, i) => ({ name: s.kind === 'ai' ? 'Computer' : s.kind === 'open' ? '' : s.name, kind: s.kind, color: cfg.rules && factionColor(cfg.rules, i), faction: cfg.rules?.factions[i]?.name, team: s.team ?? null })),
      you: cfg.seats.findIndex(s => s.token === token),
    };
  }

  function optionsText() {
    const o = cfg.options, list = [];
    if (o.mode && o.mode !== 'standard') list.push(o.mode.replace(/_/g, ' '));
    if (o.diplomacy) list.push('diplomacy');
    if (o.ranks) list.push('veteran ranks');
    if (o.simultaneous) list.push('far players moving at once');
    if (o.fog) list.push('fog of war');
    if (o.supply) list.push('fuel and ammo');
    if (o.powers) list.push('powers');
    if (o.weather === 'random') list.push('changing weather');
    else if (o.weather !== 'off') list.push(`${o.weather} all game`);
    return list.join(', ');
  }

  function sendLobby() {
    if (cfg.listed) advertise();
    if (!room || match) return;
    for (const g of room.guests.values()) if (g.conn.open) g.conn.send(lobbyFor(g.token));
  }

  function kick(seat) {
    const g = room?.guests.get(seat.token);
    if (g) { g.conn.send({ t: 'kicked' }); room.guests.delete(seat.token); setTimeout(() => g.conn.close(), 200); }
    delete seat.token;
    delete seat.conn;
  }

  function onGuest(conn) {
    conn.on('data', msg => onGuestMessage(conn, msg));
    conn.on('close', () => {
      for (const g of room?.guests.values() || []) if (g.conn === conn) {
        if (!match) { const seat = cfg.seats.find(s => s.token === g.token); if (seat) { seat.kind = 'open'; delete seat.token; delete seat.conn; } room.guests.delete(g.token); renderSeats(); sendLobby(); }
        else match.toast(`${g.name} lost connection`);
        hostNetStatus();
      }
    });
  }

  function onGuestMessage(conn, msg) {
    if (!room || typeof msg !== 'object' || !msg) return;
    if (msg.t === 'hello') {
      const token = String(msg.token || '').slice(0, 64), name = String(msg.name || 'Guest').slice(0, 20);
      let seat = cfg.seats.find(s => s.token === token);
      if (!seat && !match && !msg.watch) seat = cfg.seats.find(s => s.kind === 'open');
      room.guests.set(token, { conn, token, name, lastChat: 0 });
      if (seat) {
        seat.kind = 'peer'; seat.token = token; seat.name = name; seat.conn = conn;
        if (match) { match.seats[cfg.seats.indexOf(seat)].name = name; match.toast(`${name} is back`); }
      }
      if (match) sendSync(conn, token); else { renderSeats(); sendLobby(); }
      hostNetStatus();
      return;
    }
    const guest = [...room.guests.values()].find(g => g.conn === conn);
    if (!guest) return;
    if (msg.t === 'act' && match) {
      const seatIndex = cfg.seats.findIndex(s => s.token === guest.token && s.kind === 'peer');
      if (seatIndex < 0) return conn.send({ t: 'refused', error: 'You are watching this game.' });
      match.commit(seatIndex, msg.action, { onRefused: error => conn.send({ t: 'refused', error }) });
    } else if (msg.t === 'resync' && match) {
      sendSync(conn, guest.token);
    } else if (msg.t === 'mark' && match) {
      const seat = cfg.seats.findIndex(st => st.token === guest.token && st.kind === 'peer');
      if (seat >= 0 && msg.mark && typeof msg.mark === 'object') relayMark({ ...msg.mark, seat });
    } else if (msg.t === 'chat') {
      const now = Date.now();
      if (now - guest.lastChat < 700) return;
      guest.lastChat = now;
      broadcastChat(guest.name, cfg.seats.findIndex(s => s.token === guest.token), String(msg.text || '').slice(0, 200), Number.isInteger(msg.to) ? msg.to : null);
    }
  }

  /** Send a chat line to everyone, or privately to the seat `to` (and back to its sender). */
  function broadcastChat(name, seat, text, to = null) {
    text = text.trim();
    if (!text || !room) return;
    const whisper = to != null;
    for (const g of room.guests.values()) {
      if (!g.conn.open) continue;
      const gseat = cfg.seats.findIndex(st => st.token === g.token);
      if (whisper && gseat !== to && gseat !== seat) continue;
      g.conn.send({ t: 'chat', name, seat, text, whisper });
    }
    const hostSeat = cfg.seats.findIndex(st => st.kind === 'local');
    if (!whisper || to === hostSeat || seat === hostSeat) match?.showChat(name, seat, text, whisper);
  }

  /** Pings and plans go to the sender's allies only (and to the host if allied). */
  function relayMark(mark) {
    if (!match) return;
    const clean = { kind: String(mark.kind).slice(0, 10), seat: mark.seat, day: mark.day,
      at: Array.isArray(mark.at) ? mark.at.slice(0, 2).map(n => n | 0) : [0, 0], to: Array.isArray(mark.to) ? mark.to.slice(0, 2).map(n => n | 0) : undefined };
    for (const g of room?.guests.values() || []) {
      const gseat = cfg.seats.findIndex(st => st.token === g.token);
      if (g.conn.open && gseat >= 0 && match.allied(gseat, clean.seat)) g.conn.send({ t: 'mark', mark: clean });
    }
    const hostSeat = cfg.seats.findIndex(st => st.kind === 'local');
    if (hostSeat >= 0 && match.allied(hostSeat, clean.seat)) match.addMark(clean);
  }

  // ---- turn timer (host) ----
  // One clock per round: it starts when a new group of players starts their turns.
  let deadline = null, timedGroup = [];
  function armTimer(state) {
    if (!cfg.timer || !match) return;
    if (state.over) { deadline = null; broadcastTimer(state.turn, null); return; }
    const group = state.active?.length ? state.active : [state.turn];
    if (group.some(p => timedGroup.includes(p))) return;
    timedGroup = group;
    const human = group.some(p => cfg.seats[p]?.kind !== 'ai');
    deadline = human ? Date.now() + cfg.timer * 1000 : null;
    broadcastTimer(state.turn, human ? cfg.timer * 1000 : null);
  }
  function broadcastTimer(turn, left) {
    match?.setTimer(turn, left);
    for (const g of room?.guests.values() || []) if (g.conn.open) g.conn.send({ t: 'timer', turn, left });
  }
  function checkTimer() {
    if (!deadline || !match || match.busy || match.queue.length || match.view.over || Date.now() < deadline) return;
    deadline = null;
    const st = engine.call({ op: 'state' }).state;
    const late = (st.active?.length ? st.active : [st.turn]).filter(p => cfg.seats[p]?.kind !== 'ai');
    if (!late.length) return;
    match.showChat('Host', -1, `Time is up for ${late.map(p => match.playerName(p)).join(', ')}.`);
    for (const p of late) match.commit(p, { type: 'end_turn' });
  }

  // ---- keeping the hosted game, so a reload can pick it up ----
  let lastSaved = 0, saveTimer = null;
  function persist(state) {
    const write = () => {
      lastSaved = Date.now();
      try {
        if (state.over) return localStorage.removeItem(HOSTED);
        localStorage.setItem(HOSTED, JSON.stringify({
          code: room?.code, at: Date.now(), timer: cfg.timer, rules: cfg.rules, rulesName: cfg.rulesName,
          seats: cfg.seats.map(st => ({ kind: st.kind === 'open' ? 'ai' : st.kind, token: st.token, name: st.name, profile: st.profile, team: st.team })),
          state: engine.call({ op: 'state' }).state, record: match.record,
        }));
      } catch { /* storage full or blocked */ }
    };
    clearTimeout(saveTimer);
    if (state.over || Date.now() - lastSaved > 3000) write(); else saveTimer = setTimeout(write, 3000);
  }

  function seatsForGuests() {
    return cfg.seats.map((s, i) => ({ name: s.kind === 'ai' ? cfg.rules.factions[i].name : s.name || 'Player', ai: s.kind === 'ai' }));
  }

  function sendSync(conn, token) {
    const st = engine.call({ op: 'state' });
    const left = deadline ? Math.max(0, deadline - Date.now()) : null;
    conn.send({ t: 'sync', rules: cfg.rules, state: st.state, income: st.income, seats: seatsForGuests(), you: cfg.seats.findIndex(s => s.token === token),
      record: match?.record, timer: cfg.timer ? { turn: st.state.turn, left } : null });
  }

  function hostNetStatus() {
    if (!match || !room) return;
    const peers = cfg.seats.filter(s => s.kind === 'peer');
    const watching = [...room.guests.values()].filter(g => g.conn.open && !cfg.seats.some(s => s.token === g.token)).length;
    match.setNet(`Room ${room.code} · ${peers.map(p => `${p.name} ${p.conn?.open ? '●' : '○'}`).join(' · ') || 'no guests'}${watching ? ` · ${watching} watching` : ''}`);
  }

  // ---- start ----
  function start(resume) {
    clearError();
    if (!resume && mode === 'host' && cfg.seats.some(s => s.kind === 'open')) {
      if (!confirm('Some online seats are still empty. Let the computer play them?')) return;
      for (const s of cfg.seats) if (s.kind === 'open') s.kind = 'ai';
    }
    const teamed = cfg.seats.some(st => st.team != null);
    const teams = teamed ? cfg.seats.map((st, i) => st.team ?? 100 + i) : [];
    if (teamed && new Set(teams).size < 2) return showError(new Error('Everyone is on one team: there would be nobody to fight.'));
    // (`mode` is the setup screen's "local" or "host"; the game mode is `gameMode`.)
    const { mode: modeName, ...rest } = cfg.options;
    const gameMode = { type: modeName || 'standard' };
    if (modeName === 'survival') {
      const invaders = cfg.seats.map((st, i) => (st.kind === 'ai' ? i : -1)).filter(i => i >= 0);
      if (!invaders.length || invaders.length === cfg.seats.length) return showError(new Error('Survival needs at least one computer seat (the invaders) and one person.'));
      gameMode.invaders = invaders;
    }
    if (modeName === 'survival' && teamed) return showError(new Error('Survival makes its own teams: clear the team choices.'));
    const options = { ...rest, mode: gameMode, teams };
    // Games by link take turns one at a time.
    const byLink = cfg.seats.some(st => st.kind === 'mail');
    if (byLink) options.simultaneous = false;
    let res;
    try {
      res = resume
        ? engine.call({ op: 'load', rules: cfg.rules, state: resume.state })
        : engine.call({ op: 'new', rules: cfg.rules, map: cfg.map, seed: Math.floor(Math.random() * 2 ** 31), setup: { options } });
    } catch (e) { return showError(e); }
    document.body.dataset.screen = 'play';
    // Computers go by their army's name, so a big game's log stays readable.
    const seats = cfg.seats.map((s, i) => ({ name: s.kind === 'ai' || s.kind === 'mail' ? cfg.rules.factions[i].name : s.name || 'Player', local: s.kind === 'local', ai: s.kind === 'ai', mail: s.kind === 'mail', profile: s.kind === 'ai' ? s.profile : undefined }));
    // In a local game with several humans, name them after their armies.
    seats.forEach((s, i) => { if (s.local && mode === 'local' && cfg.seats.filter(x => x.kind === 'local').length > 1) s.name = cfg.rules.factions[i].name; });
    const menuItems = [
      { label: 'Save game', action: () => saveGame() },
      { label: 'Resign', action: () => { if (confirm('Resign this game?')) resign(); } },
      { label: 'Leave to menu', action: () => {
        if (!match.view.over && !confirm(mode === 'host' ? 'Leave this game? You can resume hosting it from the main menu.' : 'Leave this game?')) return;
        menu();
      } },
    ];
    if (mode === 'host') menuItems.splice(1, 0, { label: 'Computer takes empty seats', action: () => {
      cfg.seats.forEach((s, i) => { if (s.kind === 'peer' && !s.conn?.open) { s.kind = 'ai'; match.seats[i].ai = true; match.seats[i].name = cfg.rules.factions[i].name; } });
      for (const g of room.guests.values()) if (g.conn.open) sendSync(g.conn, g.token);
      match.afterIdle();
    } });
    const root = h('div', { class: 'play-screen' });
    app.replaceChildren(root);
    const localSave = autosaver(cfg.rules);
    match = new Match(root, {
      engine, rules: cfg.rules, state: res.state, income: res.income, seats, driver: true, menu: menuItems, onWatch: watchReplay,
      chat: mode === 'host' ? (text, to) => broadcastChat(myName(), cfg.seats.findIndex(st => st.kind === 'local'), text, to) : undefined,
      undoable: mode !== 'host',
      sendMark: mode === 'host' ? relayMark : undefined,
      onMailTurn: p => sendTurn(match, cfg.rules, p),
      onApplied: (player, action, state, hash) => {
        if (mode !== 'host') return localSave(player, action, state);
        for (const g of room?.guests.values() || []) if (g.conn.open) g.conn.send({ t: 'act', player, action, h: hash });
        armTimer(state);
        persist(state);
      },
    });
    match.income = res.income;
    if (resume?.record) match.record = resume.record;
    if (mode === 'host') {
      for (const g of room?.guests.values() || []) if (g.conn.open) sendSync(g.conn, g.token);
      hostNetStatus();
      hostTimers.push(setInterval(hostNetStatus, 3000), setInterval(checkTimer, 500));
      armTimer(res.state);
      persist(res.state);
    }
  }

  function resign() {
    const mine = cfg.seats.map((s, i) => s.kind === 'local' ? i : -1).filter(i => i >= 0);
    const p = mine.includes(match.view.turn) ? match.view.turn : mine[0];
    if (p != null) match.commit(p, { type: 'resign' }, { local: true });
  }

  function saveGame() {
    downloadSave(cfg.rules, match.seats);
  }

  // Picking up a hosted game after a reload: same room, same seats, same game.
  if (preset.resume) {
    const r = preset.resume;
    cfg.rules = r.rules;
    cfg.rulesName = r.rulesName;
    cfg.map = { name: r.state.name, players: r.state.players.length };
    cfg.seats = r.seats.map(st => ({ ...st }));
    renderOptions();
    return start(r);
  }

  // Initial rules and map.
  try {
    if (preset.rules) await setRules(preset.rules.doc, preset.rules.name);
    else await setRules(await fetchJson(BUNDLED_RULES[0].url));
    if (preset.map) await chooseMap(preset.map);
    else if (preset.mapUrl) await loadUrl(preset.mapUrl);
    else renderSeats();
  } catch (e) { showError(e); }
}

function myName() {
  try { return localStorage.getItem('ot.name') || 'Player'; } catch { return 'Player'; }
}

// ---- joining -------------------------------------------------------------

function joinScreen(code = '') {
  leaveEverything();
  document.body.dataset.screen = 'join';
  const codeIn = h('input', { value: code, placeholder: 'ROOM CODE', maxlength: 8, class: 'codein', autocomplete: 'off' });
  const nameIn = h('input', { value: myName(), maxlength: 20, placeholder: 'Your name' });
  const status = h('div', { class: 'muted' });
  const lobby = h('div', { class: 'seats' });
  const go = h('button', { class: 'primary', onclick: () => connect() }, 'Join');
  const watchIn = h('input', { type: 'checkbox' });
  const openRooms = h('div', { class: 'open-rooms' });
  app.replaceChildren(h('div', { class: 'join-screen' },
    h('header', { class: 'bar' }, h('button', { onclick: menu }, '← Back'), h('h2', {}, 'Join an online match')),
    h('div', { class: 'joinbox' }, h('label', {}, 'Room code', codeIn), h('label', {}, 'Your name', nameIn),
      h('label', { class: 'opt' }, watchIn, h('span', {}, 'Just watch', h('small', {}, 'Follow the game without taking a seat.'))), go, status, lobby, openRooms)));
  // Rooms listed on the online service.
  const showRooms = async () => {
    if (!document.body.contains(openRooms) || guestLink) return;
    if (!await cloud.api()) return;
    let list = [];
    try { list = await cloud.rooms(); } catch { return; }
    openRooms.replaceChildren(h('h3', {}, 'Open rooms'), ...(list.length ? list.map(r => h('div', { class: 'room-row' },
      h('span', {}, h('b', {}, r.map || '?'), h('small', { class: 'muted' }, ` · ${r.host || '?'} · ${r.players} players${r.options ? ` · ${r.options}` : ''}`)),
      h('small', { class: 'muted' }, r.started ? `playing, day ${r.day}` : `${r.open} open seat${r.open === 1 ? '' : 's'}`),
      h('button', { class: r.open && !r.started ? 'primary' : '', onclick: () => { codeIn.value = r.code; watchIn.checked = !r.open || !!r.started; connect(); } }, r.open && !r.started ? 'Join' : 'Watch')))
      : [h('p', { class: 'muted small' }, 'No public rooms right now. Host one, or ask a friend for a code.')]));
    setTimeout(showRooms, 10000);
  };
  showRooms();
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });

  async function connect() {
    const c = net.cleanCode(codeIn.value);
    if (c.length < 4) return (status.textContent = 'Type the code the host shared.');
    try { localStorage.setItem('ot.name', nameIn.value.trim() || 'Player'); } catch { /* ignore */ }
    go.disabled = true;
    status.textContent = 'Connecting…';
    try {
      guestLink = await net.join(c);
    } catch (e) {
      go.disabled = false;
      status.textContent = e.message;
      return;
    }
    const { conn } = guestLink;
    history.replaceState(null, '', `?join=${c}`);
    status.textContent = 'Connected. Waiting for the host to start…';
    conn.send({ t: 'hello', name: nameIn.value.trim() || 'Player', token: net.guestToken(), watch: watchIn.checked });
    conn.on('data', msg => onHostMessage(msg, lobby, status));
    conn.on('close', () => {
      if (match) {
        match.setNet('Lost the host. Trying to reconnect…');
        reconnect(c);
      } else status.textContent = 'The host closed the room.';
    });
  }
}

async function reconnect(code, tries = 0) {
  if (!match) return;
  // Keep trying for about ten minutes: the host may be reloading and reopening the room.
  if (tries > 200) { match.setNet('Disconnected from the host.'); return; }
  if (tries) match.setNet(`Lost the host. Reconnecting (attempt ${tries + 1})…`);
  try {
    guestLink?.peer.destroy();
    guestLink = await net.join(code);
    guestLink.conn.on('data', msg => onHostMessage(msg));
    guestLink.conn.on('close', () => { match?.setNet('Lost the host. Trying to reconnect…'); reconnect(code); });
    guestLink.conn.send({ t: 'hello', name: myName(), token: net.guestToken() });
  } catch {
    setTimeout(() => reconnect(code, tries + 1), Math.min(5000, 1500 + tries * 500));
  }
}

function onHostMessage(msg, lobbyEl, statusEl) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'lobby' && lobbyEl) {
    statusEl.textContent = msg.map ? `Map: ${msg.map.name} · Rules: ${msg.rules}${msg.options ? ` with ${msg.options}` : ''}. Waiting for the host to start…` : 'The host is choosing a map…';
    lobbyEl.replaceChildren(...msg.seats.map((s, i) => h('div', { class: `seat${i === msg.you ? ' me' : ''}`, style: `--c:${s.color}` },
      h('span', { class: 'dot' }), h('b', {}, s.faction), h('span', { class: 'who' }, i === msg.you ? `${s.name} (you)` : s.kind === 'open' ? 'open seat' : s.name, s.team ? ` · Team ${s.team}` : ''))));
    if (msg.you < 0) statusEl.textContent += ' All seats are taken; you will watch.';
  } else if (msg.t === 'kicked') {
    if (statusEl) statusEl.textContent = 'The host gave your seat to someone else.';
  } else if (msg.t === 'sync') {
    let res;
    try {
      res = engine.call({ op: 'load', rules: msg.rules, state: msg.state });
    } catch (e) {
      alert(`Could not load the host's game: ${e.message}`);
      return;
    }
    const seats = msg.seats.map((s, i) => ({ name: s.name, ai: s.ai, local: i === msg.you }));
    if (match) {
      match.seats = seats;
      match.resync(res.state, res.income);
      match.setNet(msg.you >= 0 ? 'Back in the game.' : 'Watching');
    } else {
      document.body.dataset.screen = 'play';
      const root = h('div', { class: 'play-screen' });
      app.replaceChildren(root);
      match = new Match(root, {
        engine, rules: msg.rules, state: res.state, income: res.income, seats, driver: false, onWatch: watchReplay,
        menu: [
          { label: 'Resign', action: () => { if (msg.you >= 0 && confirm('Resign this game?')) guestLink.conn.send({ t: 'act', action: { type: 'resign' } }); } },
          { label: 'Leave to menu', action: () => { if (match.view.over || confirm('Leave this game?')) menu(); } },
        ],
        send: (player, action) => guestLink.conn.send({ t: 'act', action }),
        chat: (text, to) => guestLink?.conn.open && guestLink.conn.send({ t: 'chat', text, to }),
        sendMark: mark => guestLink?.conn.open && guestLink.conn.send({ t: 'mark', mark }),
        onDesync: () => { match.setNet('Out of step with the host; fetching the game again…'); guestLink.conn.send({ t: 'resync' }); },
      });
      match.income = res.income;
    }
    // The whole game so far, so stats and the replay include what happened before we joined.
    if (msg.record?.start && Array.isArray(msg.record.actions)) match.record = msg.record;
    match.setTimer(msg.timer?.turn ?? 0, msg.timer?.left ?? null);
    match.setNet(msg.you >= 0 ? `Playing online as ${msg.rules.factions[msg.you].name}` : 'Watching: everything is visible to you.');
  } else if (msg.t === 'act' && match) {
    match.commit(msg.player, msg.action, { hash: msg.h, mine: match.seats[msg.player]?.local });
  } else if (msg.t === 'chat' && match) {
    match.showChat(String(msg.name || '?').slice(0, 20), Number.isInteger(msg.seat) ? msg.seat : -1, String(msg.text || '').slice(0, 200), !!msg.whisper);
  } else if (msg.t === 'mark' && match) {
    match.addMark(msg.mark);
  } else if (msg.t === 'timer' && match) {
    match.setTimer(msg.turn, msg.left);
  } else if (msg.t === 'refused' && match) {
    match.refused(msg.error);
  }
}

// ---- editor --------------------------------------------------------------

async function openEditor(map) {
  leaveEverything();
  document.body.dataset.screen = 'editor';
  const rules = await fetchJson(BUNDLED_RULES[0].url);
  const root = h('div', { class: 'editor-screen' });
  app.replaceChildren(root);
  editor = new Editor(root, {
    engine, rules, map,
    onBack: menu,
    // A mission is tried out as a mission; any other map goes to the setup screen.
    onPlay: m => (m.mission ? playMission('editor', m, rules, []) : setup('local', { map: m })),
  });
}

// ---- start up ------------------------------------------------------------

async function boot() {
  app.replaceChildren(h('p', { class: 'loading' }, 'Loading…'));
  try {
    [engine] = await Promise.all([Engine.load(), loadArt(), document.fonts?.load('16px kenney').catch(() => {})]);
  } catch (e) {
    app.replaceChildren(h('div', { class: 'error' }, e.message));
    return;
  }
  settings.apply();
  window.__ot = { engine, openDocument }; // handy in the console
  const q = new URLSearchParams(location.search);
  if (q.get('join')) return joinScreen(net.cleanCode(q.get('join')));
  // A rule set shared as a link (#rules=…): open the setup screen with it.
  const openShared = async () => {
    try {
      const shared = await rulesFromHash();
      if (!shared) return false;
      engine.call({ op: 'check', rules: shared, map: await fetchJson('maps/first-contact.json') });
      setup('local', { rules: { doc: shared, name: shared.name, shared: true } });
      return true;
    } catch (e) { alert(`Could not use the shared rules: ${e.message}`); return false; }
  };
  window.addEventListener('hashchange', openShared);
  if (await openShared()) return;
  // A game sent by link (#game=…) or a replay (#replay=…).
  const openLinks = async () => {
    try {
      const game = await share.unpack('game');
      if (game) { openLinkedGame(game); return true; }
      const replay = await share.unpack('replay');
      if (replay) { history.replaceState(null, '', location.pathname); watchReplay(replay); return true; }
    } catch (e) { alert(`Could not open the link: ${e.message}`); }
    return false;
  };
  window.addEventListener('hashchange', openLinks);
  if (await openLinks()) return;
  if (q.get('map') || q.get('rules')) {
    let rules;
    if (q.get('rules')) {
      try { rules = { doc: await fetchJson(q.get('rules')), name: q.get('rules') }; } catch (e) { alert(e.message); }
    }
    return setup(q.has('host') ? 'host' : 'local', { mapUrl: q.get('map'), rules });
  }
  if (q.get('edit') != null) return openEditor();
  if (q.get('demo') != null) return demo(q.get('demo') || 'river-line');
  if (q.get('replay')) {
    try { return openDocument(await fetchJson(q.get('replay'))); } catch (e) { alert(`Could not load the replay: ${e.message}`); }
  }
  menu();
}

/** Computer against computer, for a quick look (?demo=map-id). */
async function demo(id) {
  const rules = await fetchJson('rules/default.json');
  const map = await fetchJson(`maps/${id}.json`);
  const res = engine.call({ op: 'new', rules, map, seed: 42 });
  document.body.dataset.screen = 'play';
  const root = h('div', { class: 'play-screen' });
  app.replaceChildren(root);
  match = new Match(root, {
    engine, rules, state: res.state, driver: true,
    seats: rules.factions.slice(0, map.players).map(f => ({ name: f.name, ai: true, local: false })),
    menu: [{ label: 'Leave to menu', action: menu }],
  });
  match.income = res.income;
}

boot();

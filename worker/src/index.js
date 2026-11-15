// OpenTactics online service (a Cloudflare Worker). Optional: the game works
// without it. It keeps three things:
//
//   GET  /rooms              public rooms (hosts list theirs and refresh them)
//   PUT  /rooms/:code        list or refresh a room (expires 2 minutes after the last refresh)
//   DELETE /rooms/:code      take it off the list
//   GET  /maps               the community map gallery
//   GET  /maps/:id           one map
//   POST /maps               share a map
//   GET  /turn               short-lived TURN relay credentials, for strict networks
//
// Storage is one KV namespace (binding OT). Games themselves never pass through
// here: players still connect browser to browser.

const ROOM_TTL = 120;
const MAX_MAP_BYTES = 200_000;
const MAX_MAPS = 5000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env, url);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      return json({ error: e.message || 'Something went wrong.' }, e.status || 500, cors);
    }
  },
};

function corsHeaders(req, env) {
  const origin = req.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'access-control-allow-origin': ok ? origin || '*' : allowed[0],
    'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  throw e;
}

async function route(req, env, url) {
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  const [head, id] = parts;
  if (head === '' || head === undefined) return json({ service: 'opentactics', endpoints: ['rooms', 'maps', 'turn'] });
  if (head === 'rooms' && !id && req.method === 'GET') return listRooms(env);
  if (head === 'rooms' && id && req.method === 'PUT') return putRoom(env, id, req);
  if (head === 'rooms' && id && req.method === 'DELETE') return deleteRoom(env, id);
  if (head === 'maps' && !id && req.method === 'GET') return listMaps(env);
  if (head === 'maps' && !id && req.method === 'POST') return postMap(env, req);
  if (head === 'maps' && id && req.method === 'GET') return getMap(env, id);
  if (head === 'turn' && req.method === 'GET') return turn(env);
  fail(404, 'No such endpoint.');
}

// ---- rooms ----

const CODE = /^[A-Z0-9]{4,8}$/;
const clip = (v, n) => String(v ?? '').slice(0, n);
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.parseInt(v, 10) || 0));

async function listRooms(env) {
  const list = await env.OT.list({ prefix: 'room:', limit: 200 });
  const rooms = list.keys.filter(k => k.metadata).map(k => ({ code: k.name.slice(5), ...k.metadata }));
  rooms.sort((a, b) => (a.started - b.started) || (b.open - a.open) || (b.at - a.at));
  return json({ rooms });
}

async function putRoom(env, code, req) {
  if (!CODE.test(code)) fail(400, 'Bad room code.');
  const body = await readJson(req, 4000);
  // Metadata must stay under KV's 1 KB limit.
  const meta = {
    host: clip(body.host, 20), map: clip(body.map, 40), rules: clip(body.rules, 30), options: clip(body.options, 160),
    players: int(body.players, 2, 16), open: int(body.open, 0, 16), started: body.started ? 1 : 0, day: int(body.day, 0, 9999),
    at: Date.now(),
  };
  await env.OT.put(`room:${code}`, '', { expirationTtl: ROOM_TTL, metadata: meta });
  return json({ ok: true, ttl: ROOM_TTL });
}

async function deleteRoom(env, code) {
  if (!CODE.test(code)) fail(400, 'Bad room code.');
  await env.OT.delete(`room:${code}`);
  return json({ ok: true });
}

// ---- community maps ----

const GLYPH_ROW = /^[^\s"\\]{1,64}$/u;

async function listMaps(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.OT.list({ prefix: 'map:', limit: 1000, cursor });
    for (const k of page.keys) if (k.metadata) out.push({ id: k.name.slice(4), ...k.metadata });
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.length < MAX_MAPS);
  out.sort((a, b) => b.at - a.at);
  return json({ maps: out });
}

async function getMap(env, id) {
  if (!/^[a-z0-9-]{1,60}$/.test(id)) fail(400, 'Bad map id.');
  const text = await env.OT.get(`map:${id}`);
  if (!text) fail(404, 'No such map.');
  return new Response(text, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

/** A map has the right shape: sizes, rows, owners and units within bounds. */
function checkMap(m) {
  const bad = msg => fail(400, `map: ${msg}`);
  if (!m || typeof m !== 'object') bad('not a map');
  const w = m.width, h = m.height, players = m.players;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 4 || h < 4 || w > 64 || h > 64) bad('each side must be 4 to 64 tiles');
  if (!Number.isInteger(players) || players < 2 || players > 16) bad('2 to 16 players');
  if (!Array.isArray(m.tiles) || m.tiles.length !== h) bad('wrong number of rows');
  for (const row of m.tiles) if (typeof row !== 'string' || [...row].length !== w || !GLYPH_ROW.test(row)) bad('a row has the wrong width');
  for (const o of m.owned || []) if (!(o.x >= 0 && o.x < w && o.y >= 0 && o.y < h && o.player >= 0 && o.player < players)) bad('bad owner');
  for (const u of m.units || []) if (!(u.x >= 0 && u.x < w && u.y >= 0 && u.y < h && u.player >= 0 && u.player < players && typeof u.type === 'string')) bad('bad unit');
  if (!clip(m.name, 40).trim()) bad('give it a name');
}

async function postMap(env, req) {
  // A light brake on floods: 10 maps a minute from one address.
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const slot = `rate:${ip}:${Math.floor(Date.now() / 60000)}`;
  const count = Number(await env.OT.get(slot)) || 0;
  if (count >= 10) fail(429, 'Too many maps at once: try again in a minute.');
  await env.OT.put(slot, String(count + 1), { expirationTtl: 120 });

  const map = await readJson(req, MAX_MAP_BYTES);
  checkMap(map);
  const clean = {
    name: clip(map.name, 40), author: clip(map.author, 40), description: clip(map.description, 300),
    width: map.width, height: map.height, players: map.players, tiles: map.tiles,
    owned: map.owned || [], units: map.units || [],
    ...(map.mission ? { mission: map.mission } : {}),
    ...(Number.isInteger(map.start_funds) ? { start_funds: map.start_funds } : {}),
  };
  const slug = clean.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'map';
  const id = `${slug}-${crypto.randomUUID().slice(0, 6)}`;
  const meta = { name: clean.name, author: clean.author, description: clean.description.slice(0, 120),
    players: clean.players, width: clean.width, height: clean.height, mission: !!clean.mission, at: Date.now() };
  await env.OT.put(`map:${id}`, JSON.stringify(clean), { metadata: meta });
  return json({ id, url: `/maps/${id}` }, 201);
}

// ---- TURN relay ----

async function turn(env) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return json({ iceServers: [] });
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ttl: 6 * 3600 }),
  });
  if (!res.ok) return json({ iceServers: [] });
  const body = await res.json();
  return json({ iceServers: body.iceServers || [] }, 200, { 'cache-control': 'private, max-age=3600' });
}

async function readJson(req, limit) {
  const text = await req.text();
  if (text.length > limit) fail(413, 'Too big.');
  try { return JSON.parse(text); } catch { fail(400, 'Not JSON.'); }
}

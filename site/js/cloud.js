// The optional online service (worker/): public rooms, community maps, TURN.
// Its address comes from cloud.json; with none, these features stay hidden.

let config = null;

export async function api() {
  if (config) return config.api;
  try { config = await (await fetch('cloud.json', { cache: 'no-cache' })).json(); } catch { config = { api: '' }; }
  config.api = (config.api || '').replace(/\/+$/, '');
  return config.api;
}

async function call(path, opts = {}) {
  const base = await api();
  if (!base) throw new Error('The online service is not set up.');
  const res = await fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

export const rooms = () => call('/rooms').then(b => b.rooms || []);
export const listRoom = (code, info) => call(`/rooms/${code}`, { method: 'PUT', body: JSON.stringify(info) });
export const unlistRoom = code => call(`/rooms/${code}`, { method: 'DELETE' }).catch(() => {});
export const maps = () => call('/maps').then(b => b.maps || []);
export const shareMap = map => call('/maps', { method: 'POST', body: JSON.stringify(map) });
export const mapUrl = async id => `${await api()}/maps/${encodeURIComponent(id)}`;

/** Extra ICE servers (a TURN relay) for strict networks, if the service has them. */
export async function iceServers() {
  try { return (await call('/turn')).iceServers || []; } catch { return []; }
}

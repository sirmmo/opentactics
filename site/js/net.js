import { iceServers } from './cloud.js';
// Browser-to-browser play over WebRTC. PeerJS only introduces the browsers;
// after that, messages go straight from one to the other.
//
// The host's browser is the referee. It orders the actions, runs the
// computer players and forwards every accepted action to the guests. Every
// browser runs the same deterministic engine and checks that its game matches
// the host's after each action; if not, it asks for a fresh copy.

/* global Peer */

const PREFIX = 'opentactics-v1-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCode() {
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) s += LETTERS[b % LETTERS.length];
  return s;
}

export function cleanCode(text) {
  return (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

let peerScript;
function loadPeerJs() {
  if (window.Peer) return Promise.resolve();
  return (peerScript ||= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'vendor/peerjs.min.js';
    s.onload = ok;
    s.onerror = () => fail(new Error('Could not load PeerJS.'));
    document.head.append(s);
  }));
}

// A TURN relay from the optional online service helps browsers on strict networks.
let ice = null;
async function peerOptions() {
  ice ||= iceServers().catch(() => []);
  const extra = await ice;
  return extra.length
    ? { debug: 1, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...extra] } }
    : { debug: 1 };
}

async function openPeer(id) {
  const opts = await peerOptions();
  return new Promise((ok, fail) => {
    const peer = id ? new Peer(id, opts) : new Peer(opts);
    const timer = setTimeout(() => fail(new Error('The introduction server did not answer.')), 15000);
    peer.on('open', () => { clearTimeout(timer); ok(peer); });
    peer.on('error', e => {
      clearTimeout(timer);
      fail(new Error(e.type === 'unavailable-id' ? 'That room code is taken.' : e.message || String(e)));
    });
  });
}

/** Host a room. `onGuest(conn)` is called for each guest that connects. */
export async function host(code, { onGuest, onError }) {
  await loadPeerJs();
  const peer = await openPeer(PREFIX + code);
  peer.on('connection', conn => conn.on('open', () => onGuest(conn)));
  peer.on('error', e => onError?.(e));
  // Keep the room listed with the introduction server if it drops us.
  peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
  return peer;
}

/** Join a room by its code. Resolves with an open connection to the host. */
export async function join(code) {
  await loadPeerJs();
  const peer = await openPeer();
  // 'binary' splits big messages into chunks; 'json' fails on anything over ~16 KB,
  // and a game state on a large map (with its rules and move record) is bigger.
  const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'binary' });
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('No room with that code answered.')), 15000);
    conn.on('open', () => { clearTimeout(timer); ok(); });
    peer.on('error', e => {
      clearTimeout(timer);
      fail(new Error(e.type === 'peer-unavailable' ? 'No room with that code is open.' : e.message || String(e)));
    });
  });
  return { peer, conn };
}

/** A token that lets a guest take back its seat after a dropped connection. */
export function guestToken() {
  try {
    let t = sessionStorage.getItem('ot.token');
    if (!t) {
      t = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem('ot.token', t);
    }
    return t;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

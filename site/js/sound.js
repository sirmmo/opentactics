// Sounds: Kenney's interface sounds (CC0) for the interface, and battle sounds
// and music made on the fly with Web Audio (no files needed).

const FILES = {
  select: 'select_003', move: 'click_002', attack: 'scratch_002', destroy: 'glitch_002',
  capture: 'confirmation_001', build: 'drop_002', turn: 'maximize_006', error: 'error_004',
  tick: 'tick_001', win: 'bong_001',
};
const cache = {};
let muted = false, musicOn = false;
try {
  muted = localStorage.getItem('ot.muted') === '1';
  musicOn = localStorage.getItem('ot.music') === '1';
} catch { /* storage may be blocked */ }

export function play(name) {
  if (muted || !FILES[name]) return;
  const a = (cache[name] ||= new Audio(`assets/${FILES[name]}.ogg`));
  const voice = a.cloneNode();
  voice.volume = 0.5;
  voice.play().catch(() => {});
}

export function isMuted() { return muted; }
export function setMuted(on) {
  muted = on;
  try { localStorage.setItem('ot.muted', on ? '1' : '0'); } catch { /* ignore */ }
  if (on) stopMusic(); else if (musicOn) startMusic();
}

// ---- synthesized battle sounds ----------------------------------------------

let ctx = null, noiseBuf = null, master = null;
function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

// Browsers only allow sound after the player has touched the page.
['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => {
  audio()?.resume?.();
  if (musicOn && !muted && !music) startMusic();
}, { once: false, passive: true }));

function noise(t, dur, { freq = 1200, q = 0.8, gain = 0.6, type = 'lowpass', to } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(t, dur, { freq = 110, to, type = 'sine', gain = 0.5 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** What a unit sounds like when it fires, from its rule-set entry. */
export function voiceOf(def) {
  if (def?.view?.sound) return def.view.sound;
  if (!def || !Object.keys(def.damage || {}).length) return 'none';
  if (def.flying) return 'missile';
  if ((def.range?.[1] || 1) > 1) return 'artillery';
  if (def.move_type === 'foot' || def.move_type === 'boots') return 'rifle';
  return 'cannon';
}

/** A battle sound: rifle, cannon, artillery, missile, explosion, engine, steps. */
export function sfx(kind) {
  if (muted || !audio() || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.01;
  switch (kind) {
    case 'rifle':
      for (let i = 0; i < 3; i++) noise(t + i * 0.09, 0.07, { freq: 2600, q: 1.2, gain: 0.5, type: 'bandpass' });
      break;
    case 'cannon':
      tone(t, 0.35, { freq: 140, to: 40, gain: 0.7 });
      noise(t, 0.3, { freq: 900, to: 120, gain: 0.6 });
      break;
    case 'artillery':
      noise(t, 0.12, { freq: 1500, gain: 0.3 });
      tone(t + 0.35, 0.6, { freq: 90, to: 30, gain: 0.8 });
      noise(t + 0.35, 0.6, { freq: 500, to: 80, gain: 0.7 });
      break;
    case 'missile':
      noise(t, 0.45, { freq: 400, to: 3000, q: 2, gain: 0.35, type: 'bandpass' });
      tone(t + 0.4, 0.3, { freq: 120, to: 50, gain: 0.5 });
      break;
    case 'explosion':
      tone(t, 0.7, { freq: 80, to: 25, gain: 0.9 });
      noise(t, 0.9, { freq: 1200, to: 60, gain: 0.8 });
      break;
    case 'engine':
      tone(t, 0.35, { freq: 55, to: 70, type: 'sawtooth', gain: 0.12 });
      noise(t, 0.35, { freq: 300, gain: 0.12 });
      break;
    case 'steps':
      for (let i = 0; i < 3; i++) noise(t + i * 0.12, 0.05, { freq: 500, gain: 0.18 });
      break;
    case 'jet':
      noise(t, 0.6, { freq: 600, to: 2000, q: 0.7, gain: 0.25, type: 'bandpass' });
      break;
  }
}

/** The sound of a unit moving. */
export function moveVoice(def) {
  if (!def) return 'steps';
  if (def.flying) return 'jet';
  if (def.move_type === 'foot' || def.move_type === 'boots') return 'steps';
  return 'engine';
}

// ---- music --------------------------------------------------------------------

// A small chiptune: a minor progression with bass, arpeggio and drums, in a loop.
let music = null;
const PROG = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]]; // Am F G Em (MIDI)
const hz = n => 440 * 2 ** ((n - 69) / 12);

export function musicEnabled() { return musicOn; }
export function setMusic(on) {
  musicOn = on;
  try { localStorage.setItem('ot.music', on ? '1' : '0'); } catch { /* ignore */ }
  if (on && !muted) startMusic(); else stopMusic();
}

function startMusic() {
  if (music || !audio() || ctx.state !== 'running') return;
  const bus = ctx.createGain();
  bus.gain.value = 0.18;
  bus.connect(master);
  const beat = 60 / 96 / 2; // eighth notes at 96 bpm
  let step = 0, next = ctx.currentTime + 0.1;
  const note = (t, f, dur, type, gain) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  };
  const tick = () => {
    while (next < ctx.currentTime + 0.3) {
      const bar = Math.floor(step / 8) % PROG.length, i = step % 8, chord = PROG[bar];
      if (i % 2 === 0) note(next, hz(chord[0] - 24), beat * 1.8, 'triangle', 0.5);
      note(next, hz(chord[i % 3] + (i >= 4 ? 12 : 0)), beat * 0.9, 'square', 0.12);
      if (i === 0 || i === 4) { const s = ctx.createBufferSource(); s.buffer = noiseBuf; const g = ctx.createGain(); g.gain.setValueAtTime(0.25, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.08); s.connect(g).connect(bus); s.start(next, 0, 0.1); }
      if (i === 2 || i === 6) note(next, 70, 0.15, 'sine', 0.6);
      next += beat;
      step++;
    }
  };
  music = { bus, timer: setInterval(tick, 100) };
  tick();
}

function stopMusic() {
  if (!music) return;
  clearInterval(music.timer);
  music.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
  const old = music.bus;
  setTimeout(() => old.disconnect(), 1000);
  music = null;
}

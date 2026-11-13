// Interface sounds by Kenney (CC0).
const FILES = {
  select: 'select_003', move: 'click_002', attack: 'scratch_002', destroy: 'glitch_002',
  capture: 'confirmation_001', build: 'drop_002', turn: 'maximize_006', error: 'error_004',
  tick: 'tick_001', win: 'bong_001',
};
const cache = {};
let muted = false;
try { muted = localStorage.getItem('ot.muted') === '1'; } catch { /* storage may be blocked */ }

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
}

// The computer player, thinking in the background so the page never freezes.
// It holds its own copy of the engine: each request brings the game state.

import { Engine } from './engine.js';

const ready = Engine.load(new URL('../opentactics.wasm', import.meta.url).href);
let rules = null;

onmessage = async e => {
  const { id, state, player, profile } = e.data;
  if (e.data.rules) rules = e.data.rules;
  try {
    const engine = await ready;
    engine.call({ op: 'load', rules, state });
    const { action } = engine.call({ op: 'ai', player, profile });
    postMessage({ id, action });
  } catch (err) {
    postMessage({ id, error: err.message });
  }
};

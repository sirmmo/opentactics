// The rules engine, compiled from Rust to WebAssembly. It speaks JSON.

export class Engine {
  static async load(url = 'opentactics.wasm') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Cannot load the engine (${res.status}). Run ./build.sh first.`);
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
    return new Engine(instance.exports);
  }

  constructor(exports) {
    this.x = exports;
    this.enc = new TextEncoder();
    this.dec = new TextDecoder();
  }

  /** Run one request; throws with the engine's message if it refuses. */
  call(request) {
    const x = this.x;
    const bytes = this.enc.encode(JSON.stringify(request));
    const ptr = x.ot_alloc(bytes.length);
    new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
    const out = x.ot_call(ptr, bytes.length);
    x.ot_free(ptr, bytes.length);
    const len = new DataView(x.memory.buffer).getUint32(out, true);
    const text = this.dec.decode(new Uint8Array(x.memory.buffer, out + 4, len).slice());
    x.ot_free(out, len + 4);
    const reply = JSON.parse(text);
    if (reply.error) throw new Error(reply.error);
    return reply;
  }
}

/** A short fingerprint of a game state, to spot peers drifting apart. */
export function fingerprint(state) {
  const text = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

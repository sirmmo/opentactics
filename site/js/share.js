// Packing things into links: JSON, compressed, in the URL fragment (after #), so
// no server ever sees it. Used for shared rule sets, games played by link, and
// replays.

const b64url = bytes => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** `key=…` for a link's fragment: compressed when the browser can, plain otherwise. */
export async function pack(key, obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') return `${key}=${b64url(await pipe(json, new CompressionStream('deflate-raw')))}`;
  return `${key}json=${b64url(json)}`;
}

/** A full link to this page with `key` packed into the fragment. */
export async function link(key, obj) {
  const url = new URL(location.pathname, location.href);
  url.hash = await pack(key, obj);
  return url.href;
}

/** What a fragment like `#key=…` holds, or null. */
export async function unpack(key, hash = location.hash) {
  const m = new RegExp(`^#${key}(json)?=([A-Za-z0-9_-]+)$`).exec(hash);
  if (!m) return null;
  let bytes = unb64url(m[2]);
  if (!m[1]) bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Copy a link, or offer the system share sheet on phones. */
export async function offer(url, title) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title, url }); return 'shared'; } catch { /* fall back to copying */ }
  }
  try { await navigator.clipboard.writeText(url); return 'copied'; } catch { return 'failed'; }
}

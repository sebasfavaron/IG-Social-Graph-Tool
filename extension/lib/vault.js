// Full shares: the graph plus real names and photos, too big for a link (~3 MB for 460
// people), so they go to a secret GitHub gist instead. Everything is encrypted in the
// browser first and the key travels only after the "#" of the link, which browsers never
// send anywhere: GitHub stores bytes it cannot read. A secret gist is unlisted, not
// private, so the encryption is what keeps it to people who have the link.
//
// The link:  #s=<github user>/<gist id>&k=<key>  (plus the usual p, c, v, n, m)
//
// Gist file content: base64 of  iv (12 bytes) + AES-GCM-256 ciphertext  of
//   "IGS1"  u32 header length  header (deflate-raw JSON)  photo bytes, one after another
//   header: { g: <graph as in a #g= link>, profiles: { user: [name, flags] },
//             photos: [[user, byte length, mime], ...] }   flags: 1 private | 2 verified
// Photos stay binary (base64 inside JSON, then base64 again, would add 77%).

const MAGIC = [73, 71, 83, 49]; // "IGS1"
const FILE = 'graph.igsg';

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const toBase64Url = (bytes) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text) => fromBase64(text.replace(/-/g, '+').replace(/_/g, '/'));

function dataUrlParts(url) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(url);
  return m ? { mime: m[1], bytes: fromBase64(m[2]) } : null;
}

// profiles: { user: { name, private, verified } }, photos: Map user -> data URL
export async function packShare({ g, profiles = {}, photos = new Map() }) {
  const header = { g, profiles: {}, photos: [] };
  for (const [user, p] of Object.entries(profiles)) {
    const flags = (p.private ? 1 : 0) | (p.verified ? 2 : 0);
    if (p.name || flags) header.profiles[user] = [p.name || '', flags];
  }
  const blobs = [];
  for (const [user, url] of photos) {
    const part = dataUrlParts(url);
    if (!part) continue;
    header.photos.push([user, part.bytes.length, part.mime]);
    blobs.push(part.bytes);
  }
  const head = await pipe(new TextEncoder().encode(JSON.stringify(header)), new CompressionStream('deflate-raw'));
  const total = 8 + head.length + blobs.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, head.length);
  out.set(head, 8);
  let at = 8 + head.length;
  for (const b of blobs) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

export async function unpackShare(bytes) {
  if (bytes.length < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('not a shared graph');
  const headLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4);
  const head = await pipe(bytes.subarray(8, 8 + headLength), new DecompressionStream('deflate-raw'));
  const header = JSON.parse(new TextDecoder().decode(head));
  const profiles = {};
  for (const [user, [name, flags]] of Object.entries(header.profiles || {})) {
    profiles[user] = { name, private: !!(flags & 1), verified: !!(flags & 2) };
  }
  const photos = new Map();
  let at = 8 + headLength;
  for (const [user, length, mime] of header.photos || []) {
    if (at + length > bytes.length) throw new Error('shared graph ends early');
    photos.set(user, `data:${mime};base64,${toBase64(bytes.subarray(at, at + length))}`);
    at += length;
  }
  return { g: header.g, profiles, photos };
}

// -> { key: base64url, content: base64 text for the gist }
export async function seal(bytes) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + sealed.length);
  out.set(iv, 0);
  out.set(sealed, 12);
  return { key: toBase64Url(raw), content: toBase64(out) };
}

export async function unseal(content, keyText) {
  const all = fromBase64(content.trim());
  let key;
  try {
    key = await crypto.subtle.importKey('raw', fromBase64Url(keyText || ''), 'AES-GCM', false, ['decrypt']);
  } catch (_) {
    throw new Error('the key in the link is broken');
  }
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12)));
  } catch (_) {
    throw new Error('the key in the link does not open this graph');
  }
}

// -> "user/gistId"
export async function uploadGist(token, content, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: 'IG Social Graph share (encrypted; the key is only in the link)',
      public: false,
      files: { [FILE]: { content } },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw Object.assign(new Error('GitHub did not accept the token'), { badToken: true });
  if (res.status === 403 || res.status === 404) {
    throw Object.assign(new Error('the token is not allowed to create gists (it needs "Gists: read and write")'), {
      badToken: true,
    });
  }
  if (!res.ok || !json.id) throw new Error(`GitHub answered ${res.status} ${json.message || ''}`.trim());
  return `${json.owner?.login}/${json.id}`;
}

// The raw file, not the API: no rate limit for whoever opens the link, and the API cuts
// files over 1 MB short anyway. Both answer browsers on any site.
export async function downloadGist(ref, { fetchImpl = fetch } = {}) {
  if (!/^[A-Za-z0-9-]+\/[0-9a-f]+$/.test(ref || '')) throw new Error('the link points at no gist');
  const res = await fetchImpl(`https://gist.githubusercontent.com/${ref}/raw/${FILE}`);
  if (res.status === 404) throw new Error('the shared graph was deleted');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return res.text();
}

// Full shares: the graph plus real names and photos, too big for a link (~3 MB for 460
// people), so they are stored in a small database instead. Everything is encrypted in the
// browser first and the key travels only after the "#" of the link, which browsers never
// send anywhere: the database holds bytes it cannot read, and the link is what gives
// access.
//
// The link:  #s=<share id>&k=<key>  (plus the usual p, c, v, n, m)
//
// Stored content: base64 of  iv (12 bytes) + AES-GCM-256 ciphertext  of
//   "IGS1"  u32 header length  header (deflate-raw JSON)  photo bytes, one after another
//   header: { g: <graph as in a #g= link>, profiles: { user: [name, flags] },
//             photos: [[user, byte length, mime], ...] }   flags: 1 private | 2 verified
// Photos stay binary (base64 inside JSON, then base64 again, would add 77%).

const MAGIC = [73, 71, 83, 49]; // "IGS1"

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

// -> { key: base64url, content: base64 text to store }
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

// ---- storage: a Neon Postgres database (db/shares.sql) ------------------------------
// Browsers talk to it over Neon's HTTP SQL endpoint as share_client. That password is
// public on purpose: the role can only call create_share and get_share, which save one
// share or read one by its random id, within size and rate caps. It cannot list, change
// or delete anything.
const SHARES_HOST = 'ep-empty-sun-b68xcfin-pooler.c-2.sa-east-1.aws.neon.tech';
const SHARES_DB = `postgresql://share_client:a6ecb5e19602ba40f6e83f7696a701f80f5de12015404400@${SHARES_HOST}/neondb?sslmode=require`;

async function sharesQuery(query, params, fetchImpl) {
  const res = await fetchImpl(`https://${SHARES_HOST}/sql`, {
    method: 'POST',
    headers: {
      'Neon-Connection-String': SHARES_DB,
      'Neon-Array-Mode': 'true',
      // text/plain: Neon's CORS answer does not list Content-Type, and a JSON body sent as
      // text/plain is read the same
      'Content-Type': 'text/plain;charset=UTF-8',
    },
    body: JSON.stringify({ query, params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `the share storage answered ${res.status}`);
  return json.rows;
}

// content: base64 from seal() -> the share's id (32 hex characters)
export async function uploadShare(content, { fetchImpl = fetch } = {}) {
  const [[id]] = await sharesQuery('select create_share($1)', [content], fetchImpl);
  return id;
}

// The whole share step: keeps only the people in the graph, packs, encrypts, stores.
// ids: Set of usernames in the graph (profiles and photos of anyone else stay behind).
// -> { s: share id, k: key }, ready for buildHash
export async function createShare({ g, ids, profiles = {}, photos = new Map() }, options) {
  const packed = await packShare({
    g,
    profiles: Object.fromEntries(Object.entries(profiles).filter(([u]) => ids.has(u))),
    photos: new Map([...photos].filter(([u]) => ids.has(u))),
  });
  const { key, content } = await seal(packed);
  return { s: await uploadShare(content, options), k: key };
}

// The extension's saved photos ({ username: { src, data } }) as username -> data URL.
export const photosFromThumbs = (thumbs = {}) =>
  new Map(Object.entries(thumbs).flatMap(([username, t]) => (t?.data ? [[username, t.data]] : [])));

// ref: a share id, or "user/gistId" for links made while shares went to GitHub gists
export async function downloadShare(ref, { fetchImpl = fetch } = {}) {
  if (/^[0-9a-f]{32}$/.test(ref || '')) {
    const [[content]] = await sharesQuery('select get_share($1)', [ref], fetchImpl);
    if (!content) throw new Error('the shared graph was deleted, or the link is cut off');
    return content;
  }
  if (/^[A-Za-z0-9-]+\/[0-9a-f]+$/.test(ref || '')) return downloadGist(ref, fetchImpl);
  throw new Error('the link points at no shared graph');
}

// The raw file, not the API: no rate limit, and the API cuts files over 1 MB short.
async function downloadGist(ref, fetchImpl) {
  const res = await fetchImpl(`https://gist.githubusercontent.com/${ref}/raw/graph.igsg`);
  if (res.status === 404) throw new Error('the shared graph was deleted');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return res.text();
}

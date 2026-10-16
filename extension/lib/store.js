// Shared storage: a Neon Postgres database (db/graphs.sql), unencrypted. Each shared crawl
// is one row in `graphs`, keyed by its owner; each account seen in any of them is one row
// in `people`, so someone in two friends' graphs is stored once.
//
// Browsers talk to it over Neon's HTTP SQL endpoint as share_client. That password is
// public on purpose: the role can only call the functions in graphs.sql (and the old
// shares.sql), within size and rate caps.

const SHARES_HOST = 'ep-empty-sun-b68xcfin-pooler.c-2.sa-east-1.aws.neon.tech';
const SHARES_DB = `postgresql://share_client:a6ecb5e19602ba40f6e83f7696a701f80f5de12015404400@${SHARES_HOST}/neondb?sslmode=require`;
const PEOPLE_BATCH_BYTES = 1.5 * 1024 * 1024; // per save_people call, under its 4 MB cap
const PEOPLE_READ_BATCH = 300; // usernames per get_people call
// Photos are ~98% of the bytes (~6 KB each as base64): smaller batches, a few at a time, so
// on a slow connection they land one batch after another instead of all at the very end.
const PHOTO_READ_BATCH = 100;
const PHOTO_READS_AT_ONCE = 6;

export async function sharesQuery(query, params, fetchImpl = fetch) {
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

const dataUrlParts = (url) => /^data:([^;,]+);base64,(.*)$/.exec(url || '');

// profiles: { user: { name, private, verified } }, photos: Map user -> data URL
function peopleRows(ids, profiles, photos) {
  const rows = [];
  for (const u of ids) {
    const p = profiles[u] || {};
    const photo = dataUrlParts(photos.get(u));
    const flags = (p.private ? 1 : 0) | (p.verified ? 2 : 0);
    if (!p.name && !flags && !photo) continue;
    rows.push({ u, n: p.name || '', f: flags, p: photo?.[2] || '', t: photo?.[1] || '' });
  }
  return rows;
}

// What was last saved from this browser per owner, so sharing the same crawl twice
// uploads nothing the second time.
async function fingerprint(g, rows) {
  const bytes = new TextEncoder().encode(g + JSON.stringify(rows));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash.subarray(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}
// (v2: saves from before owner keys must go up once more, to claim the graph with one)
const savedKey = (owner) => `savedGraph2:${owner}`;
function readSaved(owner) {
  try {
    return globalThis.localStorage?.getItem(savedKey(owner)) ?? null;
  } catch (_) {
    return null;
  }
}
function writeSaved(owner, print) {
  try {
    if (print === null) globalThis.localStorage?.removeItem(savedKey(owner));
    else globalThis.localStorage?.setItem(savedKey(owner), print);
  } catch (_) {}
}

// The owner key: a random secret made by the browser that first publishes a graph, kept
// only there (the database stores its hash). With it that browser can replace or
// unpublish the graph; nobody else can. Clearing this site's data loses it, and then only
// whoever runs the database can free the graph.
const ownerKeyName = (owner) => `ownerKey:${owner}`;
function readOwnerKey(owner) {
  try {
    return globalThis.localStorage?.getItem(ownerKeyName(owner)) ?? null;
  } catch (_) {
    return null;
  }
}
function ownerKey(owner) {
  let key = readOwnerKey(owner);
  if (key) return key;
  key = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    globalThis.localStorage?.setItem(ownerKeyName(owner), key);
  } catch (_) {}
  return key;
}
// whether this browser published the owner's graph (and so may unpublish it)
export const publishedHere = (owner) => !!readOwnerKey(owner);

// Who is looking: the graph this browser published last, and its key. Reading graphs and
// names takes it (db/graphs.sql: publishers see their network). null: nothing published here.
function store(name, value) {
  try {
    if (value === null) globalThis.localStorage?.removeItem(name);
    else globalThis.localStorage?.setItem(name, value);
  } catch (_) {}
}
function read(name) {
  try {
    return globalThis.localStorage?.getItem(name) ?? null;
  } catch (_) {
    return null;
  }
}
export function me() {
  const owner = read('me');
  const key = owner && readOwnerKey(owner);
  return key ? { owner, key } : null;
}
// The extension keeps the key; links from it to the site carry it once (after the "#",
// never sent anywhere), and the site keeps it from then on.
export function adoptIdentity(owner, key) {
  if (!/^[A-Za-z0-9._]{1,30}$/.test(owner || '') || !/^[0-9a-f]{48}$/.test(key || '')) return false;
  store(ownerKeyName(owner), key);
  store('me', owner);
  return true;
}
// A link from the extension that carries its identity: &me=<owner>&mk=<key> in the hash.
// Adopts it, and -> the hash without it (for the address bar), or null if there was none.
export function takeIdentity(hash) {
  const m = /[#&]me=([A-Za-z0-9._]{1,30})&mk=([0-9a-f]{48})/.exec(hash || '');
  if (!m || !adoptIdentity(m[1], m[2])) return null;
  const rest = hash.replace(m[0].slice(1), '').replace('#&', '#').replace(/&&/g, '&').replace(/&$/, '');
  return rest === '#' ? '' : rest;
}
// the same, to add to a link to the site
export function identityParams() {
  const who = me();
  return who ? `&me=${who.owner}&mk=${who.key}` : '';
}
const viewerParams = () => {
  const who = me();
  return [who?.owner ?? null, who?.key ?? null];
};

// Takes the owner's graph off the shared list, with the names and photos only it had.
export async function unpublishGraph(owner, { fetchImpl = fetch } = {}) {
  const key = readOwnerKey(owner);
  if (!key) throw new Error('only the browser that published this graph can unpublish it');
  await sharesQuery('select unpublish($1, $2)', [owner, key], fetchImpl);
  writeSaved(owner, null);
  if (read('me') === owner) store('me', null); // it no longer opens the network
}

// Saves an owner's crawl and the people in it (only those in ids). onlyIfMissing: for
// copying an old link over; a graph already stored stays unless fromShare (the old
// link's share id) was made after it, and people only gain what they lack.
// -> whether the graph was saved (false: a newer one was there already).
export async function saveGraph(
  { owner, g, ids, profiles = {}, photos = new Map(), onlyIfMissing = false, fromShare = null },
  { fetchImpl = fetch } = {}
) {
  const rows = peopleRows(ids, profiles, photos);
  const print = await fingerprint(g, rows);
  if (!onlyIfMissing && readSaved(owner) === print) return true;
  // copying an old link over is not publishing: it carries no key, and claims nothing
  const key = onlyIfMissing ? null : ownerKey(owner);
  const [[saved]] = await sharesQuery(
    'select save_graph($1, $2, $3, $4, $5, $6, $7::jsonb)',
    [owner, g, onlyIfMissing, fromShare, ids.size, key, JSON.stringify([...ids])],
    fetchImpl
  );
  if (key) store('me', owner); // publishing is what lets this browser see the network
  if (!saved && onlyIfMissing) return false;
  let batch = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    await sharesQuery('select save_people($1::jsonb, $2, $3, $4)', [JSON.stringify(batch), onlyIfMissing, owner, key], fetchImpl);
    batch = [];
    size = 0;
  };
  for (const row of rows) {
    const rowSize = row.p.length + row.n.length + 60;
    if (size + rowSize > PEOPLE_BATCH_BYTES) await flush();
    batch.push(row);
    size += rowSize;
  }
  await flush();
  if (!onlyIfMissing) writeSaved(owner, print);
  return true;
}

// The graphs in this browser's network (its own and every one linked to it), newest first;
// none before it publishes:
// -> [{ owner, updatedAt: Date, people (count, or null), name, photo (data URL or null) }]
export async function listGraphs({ fetchImpl = fetch } = {}) {
  const rows = await sharesQuery(
    'select owner, updated_at, people, name, photo, photo_type from list_graphs($1, $2)',
    viewerParams(),
    fetchImpl
  );
  return rows.map(([owner, updatedAt, people, name, photo, type]) => ({
    owner,
    updatedAt: new Date(updatedAt),
    people,
    name: name || '',
    photo: photo && type ? `data:${type};base64,${photo}` : null,
  }));
}

// -> the owner's graph packed as in a #g= link, or null when it is not in this browser's
// network (or was never shared: teaser() tells the two apart)
export async function loadGraph(owner, { fetchImpl = fetch } = {}) {
  const rows = await sharesQuery('select data from get_graph($1, $2, $3)', [owner, ...viewerParams()], fetchImpl);
  return rows[0]?.[0] ?? null;
}

// What anyone may see of a published graph, to be invited in:
// -> { owner, people, name, photo, graphs (published in all) } or null if never published
export async function teaser(owner, { fetchImpl = fetch } = {}) {
  const rows = await sharesQuery('select owner, people, name, photo, photo_type, graphs from graph_teaser($1)', [owner], fetchImpl);
  if (!rows.length) return null;
  const [[o, people, name, photo, type, graphs]] = rows;
  return { owner: o, people, name: name || '', photo: photo && type ? `data:${type};base64,${photo}` : null, graphs };
}

// -> { profiles: { user: { name, private, verified } }, photos: Map user -> data URL }
// withPhotos false leaves the photos (most of the bytes) in the database.
export async function loadPeople(ids, { fetchImpl = fetch, withPhotos = true } = {}) {
  const all = [...ids];
  const batches = [];
  for (let i = 0; i < all.length; i += PEOPLE_READ_BATCH) batches.push(all.slice(i, i + PEOPLE_READ_BATCH));
  const results = await Promise.all(
    batches.map((names) =>
      sharesQuery(
        withPhotos
          ? 'select username, name, flags, photo, photo_type from get_people($1, $2, $3)'
          : 'select username, name, flags from get_people($1, $2, $3)',
        [names, ...viewerParams()],
        fetchImpl
      )
    )
  );
  const profiles = {};
  const photos = new Map();
  for (const [username, name, flags, photo, type] of results.flat()) {
    profiles[username] = { name: name || '', private: !!(flags & 1), verified: !!(flags & 2) };
    if (photo && type) photos.set(username, `data:${type};base64,${photo}`);
  }
  return { profiles, photos };
}

// Photos only, for ids in the order given (most wanted first). onBatch(Map user -> data URL)
// once per batch as it lands. -> every photo found, once all are in.
export async function loadPhotos(ids, { onBatch, fetchImpl = fetch } = {}) {
  const all = [...ids];
  const photos = new Map();
  let next = 0;
  const worker = async () => {
    while (next < all.length) {
      const names = all.slice(next, (next += PHOTO_READ_BATCH));
      const rows = await sharesQuery('select username, photo, photo_type from get_people($1, $2, $3)', [names, ...viewerParams()], fetchImpl);
      const batch = new Map();
      for (const [username, photo, type] of rows) if (photo && type) batch.set(username, `data:${type};base64,${photo}`);
      for (const [u, url] of batch) photos.set(u, url);
      if (batch.size) onBatch?.(batch);
    }
  };
  await Promise.all(Array.from({ length: PHOTO_READS_AT_ONCE }, worker));
  return photos;
}

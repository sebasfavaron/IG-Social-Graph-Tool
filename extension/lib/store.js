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
const savedKey = (owner) => `savedGraph:${owner}`;
function readSaved(owner) {
  try {
    return globalThis.localStorage?.getItem(savedKey(owner)) ?? null;
  } catch (_) {
    return null;
  }
}
function writeSaved(owner, print) {
  try {
    globalThis.localStorage?.setItem(savedKey(owner), print);
  } catch (_) {}
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
  const [[saved]] = await sharesQuery('select save_graph($1, $2, $3, $4)', [owner, g, onlyIfMissing, fromShare], fetchImpl);
  if (!saved && onlyIfMissing) return false;
  let batch = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    await sharesQuery('select save_people($1::jsonb, $2)', [JSON.stringify(batch), onlyIfMissing], fetchImpl);
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

// -> the owner's graph packed as in a #g= link, or null when they never shared one
export async function loadGraph(owner, { fetchImpl = fetch } = {}) {
  const rows = await sharesQuery('select data from get_graph($1)', [owner], fetchImpl);
  return rows[0]?.[0] ?? null;
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
          ? 'select username, name, flags, photo, photo_type from get_people($1)'
          : 'select username, name, flags from get_people($1)',
        [names],
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
      const rows = await sharesQuery('select username, photo, photo_type from get_people($1)', [names], fetchImpl);
      const batch = new Map();
      for (const [username, photo, type] of rows) if (photo && type) batch.set(username, `data:${type};base64,${photo}`);
      for (const [u, url] of batch) photos.set(u, url);
      if (batch.size) onBatch?.(batch);
    }
  };
  await Promise.all(Array.from({ length: PHOTO_READS_AT_ONCE }, worker));
  return photos;
}

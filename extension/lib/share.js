import { friendGroups } from './groups.js';

// Packs a graph into the part of a link after "#", which browsers never send to the
// server, so a shared graph needs no storage. Built for these graphs rather than general
// ones (462 people / 10 062 links: 15 384 characters in version 1, 9 802 here):
//
// - most follows go both ways, so each pair is stored once with a 2-bit direction;
// - the owner follows/is followed by nearly everyone, so their links are 2 bits per person
//   instead of an edge list;
// - people are numbered friend group by friend group, breadth-first, so the people a
//   person is connected to get nearby numbers and the gaps between them stay small.
//
// Version 2, as bytes before deflate-raw + base64url:
//   2                                     version
//   varint  owner index + 1 (0 = none)
//   names   '\n'-separated in numbering order, then a 0 byte
//   bits    2 per person: follows the owner (1) | the owner follows them (2)
//   per person i, links to people j > i other than the owner:
//           varint count, then varint gaps (j - previous - 1, previous starts at i)
//   bits    2 per pair, in the same order: i follows j (1) | j follows i (2)
// Breaking changes are fine for now: version 1 links no longer open.

export const SHARE_PREFIX = '#g=';
export const FULL_SHARE_PREFIX = '#s='; // old: names and photos too, encrypted (vault.js)
export const OWNER_PREFIX = '#o='; // a graph in the shared storage, by its owner (store.js)
// Where share links point, also when made from inside the extension.
export const SHARE_BASE_URL = 'https://sebasfavaron.github.io/IG-Social-Graph-Tool/';
const VERSION = 2;

async function pipe(bytes, stream) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const idOf = (end) => (typeof end === 'object' ? end.id : end);

class Writer {
  bytes = [];
  varint(v) {
    while (v >= 128) {
      this.bytes.push((v & 127) | 128);
      v >>>= 7;
    }
    this.bytes.push(v);
  }
  twoBits(values) {
    for (let i = 0; i < values.length; i += 4) {
      let b = 0;
      for (let k = 0; k < 4 && i + k < values.length; k++) b |= (values[i + k] & 3) << (2 * k);
      this.bytes.push(b);
    }
  }
}

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.at = 0;
  }
  byte() {
    if (this.at >= this.bytes.length) throw new Error('link data ends early');
    return this.bytes[this.at++];
  }
  varint() {
    let v = 0;
    for (let shift = 0; ; shift += 7) {
      const b = this.byte();
      v += (b & 127) * 2 ** shift;
      if (b < 128) return v;
      if (shift > 28) throw new Error('broken number in link data');
    }
  }
  twoBits(count) {
    const out = new Array(count);
    for (let i = 0; i < count; i += 4) {
      const b = this.byte();
      for (let k = 0; k < 4 && i + k < count; k++) out[i + k] = (b >> (2 * k)) & 3;
    }
    return out;
  }
}

// Friend group by friend group (largest first), breadth-first inside each, the most
// connected first at every step; the owner goes last. Deterministic.
function numbering(ids, neighbours, owner) {
  const { groupOf } = friendGroups(
    { nodes: ids.map((id) => ({ id })), links: [...neighbours].flatMap(([s, set]) => [...set].map((t) => ({ source: s, target: t }))) },
    { exclude: owner }
  );
  const group = (id) => (id === owner ? Infinity : groupOf.has(id) ? groupOf.get(id) : 1000);
  const degree = (id) => neighbours.get(id).size;
  const byPriority = (a, b) => group(a) - group(b) || degree(b) - degree(a) || (a < b ? -1 : a > b ? 1 : 0);
  const seen = new Set();
  const order = [];
  for (const start of [...ids].sort(byPriority)) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q];
      order.push(v);
      const next = [...neighbours.get(v)].filter((w) => !seen.has(w) && group(w) === group(v)).sort(byPriority);
      for (const w of next) {
        seen.add(w);
        queue.push(w);
      }
    }
  }
  return order;
}

export async function encodeGraph({ nodes, links, username = '' }) {
  const ids = [...new Set(nodes.map((n) => n.id))];
  const present = new Set(ids);
  const owner = present.has(username) ? username : null;
  const follows = new Set(); // "s\0t"
  const neighbours = new Map(ids.map((id) => [id, new Set()])); // undirected, owner left out
  for (const link of links) {
    const s = idOf(link.source);
    const t = idOf(link.target);
    if (s === t || !present.has(s) || !present.has(t)) continue;
    follows.add(`${s}\0${t}`);
    if (s !== owner && t !== owner) {
      neighbours.get(s).add(t);
      neighbours.get(t).add(s);
    }
  }
  const order = numbering(ids, neighbours, owner);
  const index = new Map(order.map((id, i) => [id, i]));

  const w = new Writer();
  w.bytes.push(VERSION);
  w.varint(owner === null ? 0 : index.get(owner) + 1);
  for (const b of new TextEncoder().encode(order.join('\n'))) w.bytes.push(b);
  w.bytes.push(0);
  if (owner !== null) {
    w.twoBits(order.map((id) => (follows.has(`${id}\0${owner}`) ? 1 : 0) | (follows.has(`${owner}\0${id}`) ? 2 : 0)));
  }
  const directions = [];
  order.forEach((id, i) => {
    const later = [...neighbours.get(id)].map((other) => index.get(other)).filter((j) => j > i).sort((a, b) => a - b);
    w.varint(later.length);
    let previous = i;
    for (const j of later) {
      w.varint(j - previous - 1);
      previous = j;
      directions.push((follows.has(`${id}\0${order[j]}`) ? 1 : 0) | (follows.has(`${order[j]}\0${id}`) ? 2 : 0));
    }
  });
  w.twoBits(directions);
  const packed = await pipe(new Uint8Array(w.bytes), new CompressionStream('deflate-raw'));
  return toBase64Url(packed);
}

export async function decodeGraph(encoded) {
  const r = new Reader(await pipe(fromBase64Url(encoded), new DecompressionStream('deflate-raw')));
  const version = r.byte();
  if (version !== VERSION) throw new Error(`made by a different version of the viewer (format ${version})`);
  const ownerPlusOne = r.varint();
  const nameBytes = [];
  for (let b = r.byte(); b !== 0; b = r.byte()) nameBytes.push(b);
  const text = new TextDecoder().decode(new Uint8Array(nameBytes));
  const ids = text ? text.split('\n') : [];
  if (ownerPlusOne > ids.length) throw new Error('broken link data');
  const owner = ownerPlusOne ? ids[ownerPlusOne - 1] : null;
  const links = [];
  const add = (source, target) => links.push({ source, target, value: 1 });
  if (owner !== null) {
    r.twoBits(ids.length).forEach((bits, i) => {
      if (ids[i] === owner) return;
      if (bits & 1) add(ids[i], owner);
      if (bits & 2) add(owner, ids[i]);
    });
  }
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    const count = r.varint();
    let previous = i;
    for (let c = 0; c < count; c++) {
      const j = previous + 1 + r.varint();
      if (j >= ids.length) throw new Error('broken link data');
      pairs.push([i, j]);
      previous = j;
    }
  }
  r.twoBits(pairs.length).forEach((bits, p) => {
    const [i, j] = pairs[p];
    if (bits & 1) add(ids[i], ids[j]);
    if (bits & 2) add(ids[j], ids[i]);
  });
  return {
    username: owner ?? undefined,
    metadata: { loggedUsername: owner ?? undefined, generatedBy: 'share-link' },
    nodes: ids.map((id) => ({ id, group: 1 })),
    links,
  };
}

// The rest of the view rides along after the graph:
//   #g=<graph>&p=<selected username>&c=<follower|following|mutual>&v=<x>,<y>,<zoom>
//   &n=<name of group 1>,<name of group 2>,…   (empty = unnamed; groups are numbered by size)
//   &m=<owner>,<owner>   graphs merged (merge.js); the first owner is in g or o
// A stored graph starts  #o=<owner>  instead of g=, same rest; with m= every owner's
// graph is read from the storage and merged. Older full shares start
// #s=<share id>&k=<key>.
//
// Every character here is one RFC 3986 allows in a fragment. iOS (share sheet, Messages,
// links opened from other apps) percent-escapes anything else: names used to be joined with
// "|", which arrived as %7C and read as one long name. "," is allowed, and inside a name
// encodeURIComponent always escapes it, so a raw "," is only ever the separator.
// v is the view centre relative to the layout's centroid; it is left out until the
// viewer moves the view by hand, so a fresh link fits whatever screen opens it.
export const MAX_GROUP_NAME = 30;
const MAX_FILTER = 50;

export function buildHash({ o, g, s, k, p, c, f, v, n, m }) {
  const parts = o ? [`o=${encodeURIComponent(o)}`] : s ? [`s=${s}`, `k=${k}`] : [`g=${g}`];
  const more = [m].flat().filter(Boolean);
  if (more.length) parts.push(`m=${more.map(encodeURIComponent).join(',')}`);
  if (p) parts.push(`p=${encodeURIComponent(p)}`);
  if (p && c) parts.push(`c=${c}`);
  if (p && f) parts.push(`f=${encodeURIComponent(f.slice(0, MAX_FILTER))}`); // the panel's filter
  if (v) parts.push(`v=${Math.round(v.x)},${Math.round(v.y)},${+v.k.toFixed(2)}`);
  if (n?.some(Boolean)) {
    const names = n.map((name) => encodeURIComponent((name || '').slice(0, MAX_GROUP_NAME)));
    while (names.length && !names[names.length - 1]) names.pop();
    parts.push(`n=${names.join(',')}`);
  }
  return `#${parts.join('&')}`;
}

export function parseHash(hash) {
  if (![SHARE_PREFIX, FULL_SHARE_PREFIX, OWNER_PREFIX].some((prefix) => hash.startsWith(prefix))) return null;
  const params = new URLSearchParams(hash.slice(1));
  const [x, y, k] = (params.get('v') || '').split(',').map(Number);
  const category = params.get('c');
  return {
    o: params.get('o'),
    g: params.get('g'),
    s: params.get('s'),
    k: params.get('k'),
    p: params.get('p') || null,
    c: ['follower', 'following', 'mutual'].includes(category) ? category : null,
    f: params.get('f')?.slice(0, MAX_FILTER) || null,
    v: [x, y, k].every(Number.isFinite) && k > 0 ? { x, y, k } : null,
    n: groupNames(hash),
    // m=b,c (or m=b&m=c, as someone might type it): the other owners, in order
    m: params.getAll('m').flatMap((m) => m.split(',')).filter(Boolean),
  };
}

// Read raw, not through URLSearchParams: it would decode an escaped "," inside a name
// before the split.
function groupNames(hash) {
  const raw = hash.slice(1).split('&').find((part) => part.startsWith('n='));
  return raw ? raw.slice(2).split(',').map((name) => safeDecode(name).slice(0, MAX_GROUP_NAME)) : null;
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch (_) {
    return '';
  }
}

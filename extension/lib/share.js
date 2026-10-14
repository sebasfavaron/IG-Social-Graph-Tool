// Packs a graph into the part of a link after "#", which browsers never send to the
// server, so a shared graph needs no storage. Format (version 1), before compression:
//
//   1                      version
//   <username>             whose circle it is (may be empty)
//   <id 0> ... <id n-1>    one username per line, sorted
//   (empty line)
//   <adjacency>            per source id, in order: ";"-separated lists of who it follows,
//                          as base36 gaps between sorted target indexes ("," separated)
//
// then deflate-raw and base64url. ~15k characters for 462 people / 9 661 links.

export const SHARE_PREFIX = '#g=';

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

export async function encodeGraph({ nodes, links, username = '' }) {
  const ids = [...new Set(nodes.map((n) => n.id))].sort();
  const index = new Map(ids.map((id, i) => [id, i]));
  const follows = ids.map(() => []);
  for (const link of links) {
    const s = index.get(idOf(link.source));
    const t = index.get(idOf(link.target));
    if (s !== undefined && t !== undefined) follows[s].push(t);
  }
  const adjacency = follows
    .map((targets) => {
      let prev = -1;
      return [...new Set(targets)]
        .sort((a, b) => a - b)
        .map((t) => {
          const gap = t - prev;
          prev = t;
          return gap.toString(36);
        })
        .join(',');
    })
    .join(';');
  const text = ['1', username || '', ...ids, '', adjacency].join('\n');
  const packed = await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw'));
  return toBase64Url(packed);
}

export async function decodeGraph(encoded) {
  const bytes = await pipe(fromBase64Url(encoded), new DecompressionStream('deflate-raw'));
  const lines = new TextDecoder().decode(bytes).split('\n');
  if (lines[0] !== '1') throw new Error(`unknown share format "${lines[0]}"`);
  const username = lines[1] || undefined;
  const blank = lines.indexOf('', 2);
  const ids = lines.slice(2, blank);
  const adjacency = lines.slice(blank + 1).join('\n');
  const links = [];
  adjacency.split(';').forEach((row, s) => {
    let t = -1;
    for (const gap of row ? row.split(',') : []) {
      t += parseInt(gap, 36);
      if (ids[s] === undefined || ids[t] === undefined) throw new Error('broken link data');
      links.push({ source: ids[s], target: ids[t], value: 1 });
    }
  });
  return {
    username,
    metadata: { loggedUsername: username, generatedBy: 'share-link' },
    nodes: ids.map((id) => ({ id, group: 1 })),
    links,
  };
}

// The rest of the view rides along after the graph:
//   #g=<graph>&p=<selected username>&c=<follower|following|mutual>&v=<x>,<y>,<zoom>
// v is the view centre relative to the layout's centroid; it is left out until the
// viewer moves the view by hand, so a fresh link fits whatever screen opens it.
export function buildHash({ g, p, c, v }) {
  const parts = [`g=${g}`];
  if (p) parts.push(`p=${encodeURIComponent(p)}`);
  if (p && c) parts.push(`c=${c}`);
  if (v) parts.push(`v=${Math.round(v.x)},${Math.round(v.y)},${+v.k.toFixed(2)}`);
  return `#${parts.join('&')}`;
}

export function parseHash(hash) {
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  const params = new URLSearchParams(hash.slice(1));
  const [x, y, k] = (params.get('v') || '').split(',').map(Number);
  const category = params.get('c');
  return {
    g: params.get('g'),
    p: params.get('p') || null,
    c: ['follower', 'following', 'mutual'].includes(category) ? category : null,
    v: [x, y, k].every(Number.isFinite) && k > 0 ? { x, y, k } : null,
  };
}

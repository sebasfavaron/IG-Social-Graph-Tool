import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGraph, decodeGraph } from '../extension/lib/share.js';
import { EXAMPLE_GRAPH } from './exampleGraph.js';

const edges = (g) => g.links.map((l) => `${l.source}>${l.target}`).sort();

test('example graph survives a round trip', async () => {
  const decoded = await decodeGraph(await encodeGraph(EXAMPLE_GRAPH));
  assert.equal(decoded.username, 'you');
  assert.deepEqual(decoded.nodes.map((n) => n.id).sort(), EXAMPLE_GRAPH.nodes.map((n) => n.id).sort());
  assert.deepEqual(edges(decoded), edges(EXAMPLE_GRAPH));
});

// Same size as a real crawl (462 people, 9 661 links): four friend groups plus "me",
// seeded so the encoded length is stable.
function clusteredGraph() {
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const ids = Array.from({ length: 461 }, (_, i) => `user_${((i * 7919) % 9973).toString(36)}.${i % 4}`);
  const links = ids.map((id) => ({ source: id, target: 'me' }));
  while (links.length < 9661) {
    const a = Math.floor(rand() * 461);
    const b = Math.floor(rand() * 461);
    if (a !== b && (a % 4 === b % 4 || rand() < 0.05)) links.push({ source: ids[a], target: ids[b] });
  }
  return { username: 'me', nodes: [{ id: 'me' }, ...ids.map((id) => ({ id }))], links };
}

test('real-sized graph stays a usable link, duplicates collapse, d3-mutated links work', async () => {
  const graph = clusteredGraph();
  const unique = new Set(graph.links.map((l) => `${l.source}>${l.target}`));
  // d3 replaces link endpoints with node objects once a graph is drawn
  const drawn = { ...graph, links: graph.links.map((l) => ({ source: { id: l.source }, target: { id: l.target } })) };
  const encoded = await encodeGraph(drawn);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.ok(encoded.length < 25_000, `link is ${encoded.length} chars`);
  const decoded = await decodeGraph(encoded);
  assert.deepEqual(new Set(edges(decoded)), unique);
});

test('garbage is rejected, not drawn', async () => {
  await assert.rejects(decodeGraph('not-a-graph'));
});

test('view state round-trips through the hash and junk values are dropped', async () => {
  const { buildHash, parseHash } = await import('../extension/lib/share.js');
  const hash = buildHash({ g: 'abc_-', s: null, k: null, p: 'jose.favaron', c: 'mutual', v: { x: -12.4, y: 30.6, k: 2.456 } });
  assert.equal(hash, '#g=abc_-&p=jose.favaron&c=mutual&v=-12,31,2.46');
  assert.deepEqual(parseHash(hash), { o: null, g: 'abc_-', s: null, k: null, p: 'jose.favaron', c: 'mutual', f: null, v: { x: -12, y: 31, k: 2.46 }, n: null, m: [] });
  assert.deepEqual(parseHash('#g=abc&c=evil&v=1,2'), { o: null, g: 'abc', s: null, k: null, p: null, c: null, f: null, v: null, n: null, m: [] });
  assert.equal(parseHash('#other'), null);
  // the panel's filter, only with someone selected
  assert.equal(parseHash(buildHash({ o: 'me', p: 'ana', f: 'José & co' })).f, 'José & co');
  assert.equal(buildHash({ o: 'me', f: 'x' }), '#o=me');
  // old links carried only the graph
  assert.deepEqual(parseHash('#g=abc'), { o: null, g: 'abc', s: null, k: null, p: null, c: null, f: null, v: null, n: null, m: [] });
});

test('group names survive the link, including separators and odd characters', async () => {
  const { buildHash, parseHash } = await import('../extension/lib/share.js');
  const names = ['School | 2010', '', 'Work & co, Ñandú 🎉', '', ''];
  const hash = buildHash({ g: 'abc', n: names });
  assert.equal(hash.split('&').length, 2); // trailing empty names dropped
  assert.deepEqual(parseHash(hash).n, ['School | 2010', '', 'Work & co, Ñandú 🎉']);
  assert.equal(buildHash({ g: 'abc', n: ['', ''] }), '#g=abc'); // nothing named: no n=
  assert.equal(parseHash(buildHash({ g: 'a', n: ['x'.repeat(80)] })).n[0].length, 30);
  assert.deepEqual(parseHash('#g=a&n=%E0%A4%A').n, ['']); // broken escape: empty, not a crash
});

test('a follow back costs bits, not a second link', async () => {
  // the same 60 pairs, once one-way and once both ways
  const ids = Array.from({ length: 40 }, (_, i) => `p${i}`);
  const pairs = [];
  for (let i = 0; i < 40; i++) for (let j = i + 1; j < 40; j += 7) pairs.push([ids[i], ids[j]]);
  const oneWay = { nodes: ids.map((id) => ({ id })), links: pairs.map(([s, t]) => ({ source: s, target: t })) };
  const both = { ...oneWay, links: pairs.flatMap(([s, t]) => [{ source: s, target: t }, { source: t, target: s }]) };
  const a = (await encodeGraph(oneWay)).length;
  const b = (await encodeGraph(both)).length;
  assert.ok(b <= a * 1.1, `both ways ${b} vs one way ${a}`);
  const decoded = await decodeGraph(await encodeGraph(both));
  assert.equal(decoded.links.length, pairs.length * 2);
});

test('the owner is restored and their links come back from the per-person bits', async () => {
  const graph = {
    username: 'me',
    nodes: ['me', 'a', 'b', 'c'].map((id) => ({ id })),
    links: [['a', 'me'], ['b', 'me'], ['me', 'a'], ['me', 'c'], ['a', 'b']].map(([source, target]) => ({ source, target })),
  };
  const decoded = await decodeGraph(await encodeGraph(graph));
  assert.equal(decoded.username, 'me');
  assert.deepEqual(edges(decoded), edges(graph));
});

// What iOS does to a link on its way through the share sheet or Messages: escape every
// character RFC 3986 does not allow in a fragment.
const iosEscape = (hash) => '#' + hash.slice(1).replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@/?%]/gu, (c) => encodeURIComponent(c));

test('group names survive iOS escaping the link', async () => {
  const { buildHash, parseHash } = await import('../extension/lib/share.js');
  const names = ['School | 2010', 'Work, co & más', '', 'Família 🎉'];
  const hash = buildHash({ g: 'abc_-', s: null, k: null, p: 'jose.favaron', c: 'mutual', v: { x: -12, y: 31, k: 2.46 }, n: names });
  assert.equal(iosEscape(hash), hash, 'the link has a character iOS would rewrite');
  assert.deepEqual(parseHash(iosEscape(hash)).n, names);
});

test('every viewer string exists in Spanish and in English', async () => {
  const { _strings } = await import('../extension/lib/i18n.js');
  const es = Object.keys(_strings.es).sort();
  const en = Object.keys(_strings.en).sort();
  assert.deepEqual(es.filter((k) => !en.includes(k)), []);
  assert.deepEqual(en.filter((k) => !es.includes(k)), []);
});

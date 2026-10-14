import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGraph, decodeGraph } from '../extension/lib/share.js';
import { EXAMPLE_GRAPH } from '../extension/lib/example.js';

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
  const hash = buildHash({ g: 'abc_-', p: 'jose.favaron', c: 'mutual', v: { x: -12.4, y: 30.6, k: 2.456 } });
  assert.equal(hash, '#g=abc_-&p=jose.favaron&c=mutual&v=-12,31,2.46');
  assert.deepEqual(parseHash(hash), { g: 'abc_-', p: 'jose.favaron', c: 'mutual', v: { x: -12, y: 31, k: 2.46 } });
  assert.deepEqual(parseHash('#g=abc&c=evil&v=1,2'), { g: 'abc', p: null, c: null, v: null });
  assert.equal(parseHash('#other'), null);
  // old links carried only the graph
  assert.deepEqual(parseHash('#g=abc'), { g: 'abc', p: null, c: null, v: null });
});

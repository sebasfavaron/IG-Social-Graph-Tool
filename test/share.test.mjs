import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeGraph, decodeGraph } from '../extension/lib/share.js';
import { EXAMPLE_GRAPH } from '../extension/lib/example.js';

const edges = (g) => g.links.map((l) => `${l.source}>${l.target}`).sort();

test('example graph survives a round trip', async () => {
  const decoded = await decodeGraph(await encodeGraph(EXAMPLE_GRAPH));
  assert.equal(decoded.username, 'you');
  assert.deepEqual(decoded.nodes.map((n) => n.id).sort(), EXAMPLE_GRAPH.nodes.map((n) => n.id).sort());
  assert.deepEqual(edges(decoded), edges(EXAMPLE_GRAPH));
});

test('real-sized graph stays a usable link, duplicates collapse, d3-mutated links work', async () => {
  const graph = JSON.parse(readFileSync(new URL('../public/ig-social-data-sebas.json', import.meta.url)));
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

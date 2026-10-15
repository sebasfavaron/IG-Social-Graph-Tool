import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIRCLE, circles, mergeGraphs } from '../extension/lib/merge.js';
import { decodeGraph, encodeGraph, buildHash, parseHash } from '../extension/lib/share.js';

const graph = (username, pairs) => ({
  username,
  nodes: [...new Set(pairs.flat())].map((id) => ({ id })),
  links: pairs.map(([source, target]) => ({ source, target })),
});

// ana's circle: bo, cy, dee. bea's circle: cy, dee, eve. cy and dee are in both.
const ana = graph('ana', [['bo', 'ana'], ['cy', 'ana'], ['ana', 'cy'], ['dee', 'ana'], ['bo', 'cy'], ['cy', 'dee']]);
const bea = graph('bea', [['cy', 'bea'], ['dee', 'bea'], ['bea', 'dee'], ['eve', 'bea'], ['cy', 'dee'], ['eve', 'dee']]);

test('merging keeps everyone and every follow once', () => {
  const m = mergeGraphs(ana, bea);
  assert.equal(m.username, 'ana');
  assert.equal(m.partner, 'bea');
  assert.deepEqual(m.nodes.map((n) => n.id).sort(), ['ana', 'bea', 'bo', 'cy', 'dee', 'eve']);
  assert.equal(m.links.length, ana.links.length + bea.links.length - 1); // cy>dee is in both
});

test('circles: in both, only the first, only the second; owners get none', () => {
  const { circleOf, sizes } = circles(mergeGraphs(ana, bea));
  assert.equal(circleOf.get('cy'), CIRCLE.BOTH);
  assert.equal(circleOf.get('dee'), CIRCLE.BOTH);
  assert.equal(circleOf.get('bo'), CIRCLE.FIRST);
  assert.equal(circleOf.get('eve'), CIRCLE.SECOND);
  assert.equal(circleOf.has('ana'), false);
  assert.deepEqual(sizes, [2, 1, 1]);
});

test('the same person twice, or a graph without an owner, is refused', () => {
  assert.throws(() => mergeGraphs(ana, ana), /both graphs are @ana's/);
  assert.throws(() => mergeGraphs(ana, { ...bea, username: undefined }), /whose graph/);
});

test('a merged graph survives a share link, the second owner riding in m=', async () => {
  const m = mergeGraphs(ana, bea);
  const hash = buildHash({ g: await encodeGraph(m), m: m.partner });
  const state = parseHash(hash);
  assert.equal(state.m, 'bea');
  const decoded = await decodeGraph(state.g);
  const edges = (g) => g.links.map((l) => `${l.source}>${l.target}`).sort();
  assert.equal(decoded.username, 'ana');
  assert.deepEqual(edges(decoded), edges(m));
});

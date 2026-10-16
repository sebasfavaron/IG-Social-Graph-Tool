import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_OWNERS, circles, mergeGraphs } from '../extension/lib/merge.js';
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
  assert.deepEqual(m.partners, ['bea']);
  assert.deepEqual(m.nodes.map((n) => n.id).sort(), ['ana', 'bea', 'bo', 'cy', 'dee', 'eve']);
  assert.equal(m.links.length, ana.links.length + bea.links.length - 1); // cy>dee is in both
});

test('circles: only the first, only the second, in both; owners get none', () => {
  const { circleOf, sizes } = circles(mergeGraphs(ana, bea));
  assert.equal(circleOf.get('bo'), 0);
  assert.equal(circleOf.get('eve'), 1);
  assert.equal(circleOf.get('cy'), 2);
  assert.equal(circleOf.get('dee'), 2);
  assert.equal(circleOf.has('ana'), false);
  assert.deepEqual(sizes, [1, 1, 2]);
});

// cal's circle: eve, fay. eve is now in bea's and cal's.
const cal = graph('cal', [['eve', 'cal'], ['cal', 'fay'], ['fay', 'eve']]);

test('three people: one circle each, and one for anyone in more than one', () => {
  const m = mergeGraphs(ana, bea, cal);
  assert.equal(m.username, 'ana');
  assert.deepEqual(m.partners, ['bea', 'cal']);
  const { circleOf, sizes } = circles(m);
  assert.equal(circleOf.get('bo'), 0); // only ana's
  assert.equal(circleOf.get('fay'), 2); // only cal's
  assert.equal(circleOf.get('eve'), 3); // bea's and cal's
  assert.equal(circleOf.get('cy'), 3);
  assert.deepEqual(sizes, [1, 0, 1, 3]);
});

test('combining caps at the colours there are', () => {
  const many = Array.from({ length: MAX_OWNERS + 1 }, (_, i) => graph(`o${i}`, [[`x${i}`, `o${i}`]]));
  assert.equal(mergeGraphs(...many.slice(0, MAX_OWNERS)).partners.length, MAX_OWNERS - 1);
  assert.throws(() => mergeGraphs(...many), /at most/);
});

test('the same person twice, or a graph without an owner, is refused', () => {
  assert.throws(() => mergeGraphs(ana, ana), /@ana's graph is in already/);
  assert.throws(() => mergeGraphs(ana, { ...bea, username: undefined }), /whose graph/);
});

test('a merged graph survives a share link, the second owner riding in m=', async () => {
  const m = mergeGraphs(ana, bea);
  const hash = buildHash({ g: await encodeGraph(m), m: m.partners });
  const state = parseHash(hash);
  assert.deepEqual(state.m, ['bea']);
  const decoded = await decodeGraph(state.g);
  const edges = (g) => g.links.map((l) => `${l.source}>${l.target}`).sort();
  assert.equal(decoded.username, 'ana');
  assert.deepEqual(edges(decoded), edges(m));
});

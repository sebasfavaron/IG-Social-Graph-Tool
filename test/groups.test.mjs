import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendGroups } from '../extension/lib/groups.js';
import { EXAMPLE_GRAPH } from '../extension/lib/example.js';

// three dense groups of 8, a few links between them, and "me" following everyone
function planted() {
  let seed = 3;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const groups = ['a', 'b', 'c'].map((g) => Array.from({ length: 8 }, (_, i) => `${g}${i}`));
  const links = [];
  for (const g of groups) for (const x of g) for (const y of g) if (x !== y && rand() < 0.6) links.push({ source: x, target: y });
  links.push({ source: 'a0', target: 'b0' }, { source: 'b1', target: 'c1' }, { source: 'c2', target: 'a2' });
  for (const g of groups) for (const x of g) links.push({ source: 'me', target: x }, { source: x, target: 'me' });
  return { groups, graph: { nodes: [{ id: 'me' }, ...groups.flat().map((id) => ({ id }))], links } };
}

test('finds planted groups when the logged user is left out', () => {
  const { groups, graph } = planted();
  const { groupOf, sizes } = friendGroups(graph, { exclude: 'me' });
  assert.deepEqual(sizes, [8, 8, 8]);
  for (const g of groups) assert.equal(new Set(g.map((id) => groupOf.get(id))).size, 1, `${g[0]}… split`);
  assert.equal(new Set(groups.map((g) => groupOf.get(g[0]))).size, 3, 'groups merged');
  assert.equal(groupOf.has('me'), false);
});

test('the example graph splits into its three planted groups, bridges and all', () => {
  const { groupOf, sizes } = friendGroups(EXAMPLE_GRAPH, { exclude: 'you', hidden: new Set(['tomi']) });
  assert.equal(sizes.length, 3);
  const same = (...ids) => new Set(ids.map((id) => groupOf.get(id))).size === 1;
  assert.ok(same('ana', 'bruno', 'caro', 'dani', 'emi', 'feli', 'gael'), 'school split');
  assert.ok(same('iara', 'joaco', 'kari', 'lu', 'maite'), 'work split');
  assert.ok(same('nora', 'oto', 'pia', 'quique', 'rami'), 'family split');
  assert.ok(!same('ana', 'kari') && !same('ana', 'nora') && !same('kari', 'nora'), 'groups merged');
});

test('small groups get no colour, hidden loners are ignored, same input same output', () => {
  const a = friendGroups(EXAMPLE_GRAPH, { exclude: 'you', hidden: new Set(['juli']) });
  const b = friendGroups(EXAMPLE_GRAPH, { exclude: 'you', hidden: new Set(['juli']) });
  assert.deepEqual([...a.groupOf], [...b.groupOf]);
  assert.equal(a.groupOf.has('juli'), false);
  for (const n of a.sizes) assert.ok(n >= 5);
});

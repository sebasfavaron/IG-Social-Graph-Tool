import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromPositional, groupAnchors, namesFor, rename } from '../extension/lib/groupNames.js';

const links = (pairs) => pairs.map(([source, target]) => ({ source, target }));

test('a name follows its group when a later crawl renumbers the groups', () => {
  // first crawl: school (3 people) is group 0, work (2) is group 1
  const before = new Map([['ana', 0], ['bo', 0], ['cy', 0], ['hugo', 1], ['iara', 1]]);
  const l1 = links([['ana', 'bo'], ['ana', 'cy'], ['hugo', 'iara']]);
  const a1 = groupAnchors(before, l1, 2);
  assert.deepEqual(a1, ['ana', 'hugo']);
  let saved = rename({}, before, a1, 0, 'School');
  saved = rename(saved, before, a1, 1, 'Work');

  // later crawl: work grew past school, so it is group 0 now
  const after = new Map([['hugo', 0], ['iara', 0], ['joaco', 0], ['kari', 0], ['ana', 1], ['bo', 1], ['cy', 1]]);
  const l2 = links([['hugo', 'iara'], ['hugo', 'joaco'], ['hugo', 'kari'], ['ana', 'bo'], ['ana', 'cy']]);
  assert.deepEqual(namesFor(saved, after, groupAnchors(after, l2, 2)), ['Work', 'School']);
});

test('renaming replaces the old name even when the anchor changed', () => {
  const groupOf = new Map([['ana', 0], ['bo', 0]]);
  const saved = { bo: 'Old' }; // saved when bo was the anchor
  const anchors = groupAnchors(groupOf, links([['ana', 'bo'], ['ana', 'x']]), 1);
  assert.deepEqual(anchors, ['ana']);
  assert.deepEqual(namesFor(saved, groupOf, anchors), ['Old']);
  assert.deepEqual(rename(saved, groupOf, anchors, 0, 'New'), { ana: 'New' });
  assert.deepEqual(rename(saved, groupOf, anchors, 0, ''), {});
});

test('names saved by number are carried over to anchors', () => {
  assert.deepEqual(fromPositional(['School', '', 'Family'], ['ana', 'hugo', 'nora']), { ana: 'School', nora: 'Family' });
});

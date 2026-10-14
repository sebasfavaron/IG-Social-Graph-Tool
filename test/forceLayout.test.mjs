import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.self = globalThis; // the file is a classic worker script that sets self.forceLayout
await import('../extension/lib/forceLayout.js');
const { forceLayout } = globalThis;

// four friend groups of 115 plus a hub everyone links to, ~10k links: the real-crawl shape
function clustered() {
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const pairs = [];
  for (let i = 1; i < 462; i++) pairs.push(i, 0);
  while (pairs.length < 20000) {
    const a = 1 + Math.floor(rand() * 461);
    const b = 1 + Math.floor(rand() * 461);
    if (a !== b && (a % 4 === b % 4 || rand() < 0.05)) pairs.push(a, b);
  }
  return { n: 462, links: new Int32Array(pairs) };
}

test('same graph, same layout', () => {
  const { n, links } = clustered();
  const a = forceLayout(n, links);
  const b = forceLayout(n, links);
  assert.deepEqual(Array.from(a.x), Array.from(b.x));
  assert.deepEqual(Array.from(a.y), Array.from(b.y));
});

test('dots keep apart and friend groups come out as separate clusters', () => {
  const { n, links } = clustered();
  const { x, y } = forceLayout(n, links);
  let overlaps = 0;
  for (let i = 1; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.hypot(x[i] - x[j], y[i] - y[j]) < 15) overlaps++;
  assert.equal(overlaps, 0);
  const groups = [0, 1, 2, 3].map((k) => {
    const idx = [];
    for (let i = 1; i < n; i++) if (i % 4 === k) idx.push(i);
    const cx = idx.reduce((s, i) => s + x[i], 0) / idx.length;
    const cy = idx.reduce((s, i) => s + y[i], 0) / idx.length;
    return { cx, cy, spread: idx.reduce((s, i) => s + Math.hypot(x[i] - cx, y[i] - cy), 0) / idx.length };
  });
  let between = 0;
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) between += Math.hypot(groups[a].cx - groups[b].cx, groups[a].cy - groups[b].cy) / 6;
  const spread = groups.reduce((s, g) => s + g.spread, 0) / 4;
  assert.ok(between / spread > 3, `groups not apart: ${(between / spread).toFixed(2)}`);
  // centred on the origin
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(Math.abs(mean(x)) < 1e-6 && Math.abs(mean(y)) < 1e-6);
});

test('tiny and odd inputs', () => {
  assert.deepEqual(Array.from(forceLayout(0, new Int32Array()).x), []);
  const one = forceLayout(1, new Int32Array());
  assert.ok(Number.isFinite(one.x[0]) && Number.isFinite(one.y[0]));
  const loose = forceLayout(30, new Int32Array()); // nobody linked: still finite, still apart
  for (let i = 0; i < 30; i++) assert.ok(Number.isFinite(loose.x[i]) && Number.isFinite(loose.y[i]));
  let progressCalls = 0;
  forceLayout(5, new Int32Array([0, 1, 1, 2, 2, 3, 3, 4]), () => progressCalls++);
  assert.equal(progressCalls, 10);
});

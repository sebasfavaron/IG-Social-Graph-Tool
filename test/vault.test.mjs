import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadShare, packShare, seal, unpackShare, unseal, uploadShare } from '../extension/lib/vault.js';
import { buildHash, parseHash } from '../extension/lib/share.js';

const jpeg = (fill, n) => `data:image/jpeg;base64,${Buffer.alloc(n, fill).toString('base64')}`;
const share = {
  g: 'abc_-',
  profiles: {
    ana: { name: 'Ana Belén', private: false, verified: true },
    bo: { name: '', private: true, verified: false },
    cy: { name: '', private: false, verified: false }, // nothing to carry: left out
  },
  photos: new Map([['ana', jpeg(1, 6000)], ['bo', jpeg(2, 4100)]]),
};

test('names, flags and photos survive packing, photos as raw bytes', async () => {
  const packed = await packShare(share);
  assert.ok(packed.length < 6000 + 4100 + 200, `${packed.length} bytes`);
  const back = await unpackShare(packed);
  assert.equal(back.g, 'abc_-');
  assert.deepEqual(back.profiles, {
    ana: { name: 'Ana Belén', private: false, verified: true },
    bo: { name: '', private: true, verified: false },
  });
  assert.deepEqual([...back.photos], [...share.photos]);
});

test('sealed with a fresh key; the wrong key or a broken one is refused', async () => {
  const packed = await packShare(share);
  const a = await seal(packed);
  const b = await seal(packed);
  assert.notEqual(a.key, b.key);
  assert.match(a.key, /^[A-Za-z0-9_-]{43}$/); // 32 bytes, link-safe
  assert.deepEqual(await unseal(a.content, a.key), packed);
  await assert.rejects(unseal(a.content, b.key), /does not open/);
  await assert.rejects(unseal(a.content, 'nope'), /broken|does not open/);
});

// Neon's HTTP SQL endpoint, as far as the two functions go
function fakeNeon() {
  const rows = new Map();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const { query, params } = JSON.parse(init.body);
    if (query === 'select create_share($1)') {
      const id = 'ab'.repeat(16);
      rows.set(id, params[0]);
      return new Response(JSON.stringify({ rows: [[id]] }));
    }
    if (query === 'select get_share($1)') return new Response(JSON.stringify({ rows: [[rows.get(params[0]) ?? null]] }));
    return new Response(JSON.stringify({ message: 'permission denied for table shares' }), { status: 400 });
  };
  return { fetchImpl, calls };
}

test('a share is stored through create_share and read back through get_share', async () => {
  const neon = fakeNeon();
  const { key, content } = await seal(await packShare(share));
  const id = await uploadShare(content, neon);
  assert.match(id, /^[0-9a-f]{32}$/);
  const call = neon.calls[0];
  assert.match(call.url, /^https:\/\/[a-z0-9.-]+\.neon\.tech\/sql$/);
  assert.match(call.init.headers['Neon-Connection-String'], /^postgresql:\/\/share_client:/); // only ever the limited role
  assert.match(call.init.headers['Content-Type'], /^text\/plain/); // no CORS preflight trouble
  const back = await unpackShare(await unseal(await downloadShare(id, neon), key));
  assert.equal(back.profiles.ana.name, 'Ana Belén');
  await assert.rejects(downloadShare('cd'.repeat(16), neon), /deleted/);
  await assert.rejects(downloadShare('../evil', neon), /no shared graph/);
});

test("the database's refusals come through as messages", async () => {
  const refuse = async () => new Response(JSON.stringify({ message: 'share storage is full' }), { status: 400 });
  await assert.rejects(uploadShare('x', { fetchImpl: refuse }), /storage is full/);
});

test('links made while shares went to GitHub gists still open', async () => {
  const fetchImpl = async (url) =>
    url === 'https://gist.githubusercontent.com/sebasfavaron/f00d/raw/graph.igsg' ? new Response('c2VhbGVk') : new Response('', { status: 404 });
  assert.equal(await downloadShare('sebasfavaron/f00d', { fetchImpl }), 'c2VhbGVk');
});

test('a full-share link is short and keeps the view state', () => {
  const key = 'A'.repeat(43);
  const hash = buildHash({ s: 'ab'.repeat(16), k: key, p: 'ana', m: 'bea' });
  assert.ok(hash.length < 110, hash);
  const state = parseHash(hash);
  assert.equal(state.s, 'ab'.repeat(16));
  assert.equal(state.k, key);
  assert.equal(state.p, 'ana');
  assert.equal(state.m, 'bea');
  assert.equal(state.g, null);
});

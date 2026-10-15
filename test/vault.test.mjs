import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadGist, packShare, seal, unpackShare, unseal, uploadGist } from '../extension/lib/vault.js';
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

test('upload posts a secret gist; download reads its raw file', async () => {
  const stored = {};
  const fakeGitHub = async (url, init = {}) => {
    if (url === 'https://api.github.com/gists') {
      assert.equal(init.headers.Authorization, 'Bearer tok');
      const body = JSON.parse(init.body);
      assert.equal(body.public, false);
      stored.content = body.files['graph.igsg'].content;
      return new Response(JSON.stringify({ id: 'f00d', owner: { login: 'sebasfavaron' } }), { status: 201 });
    }
    if (url === 'https://gist.githubusercontent.com/sebasfavaron/f00d/raw/graph.igsg') return new Response(stored.content);
    return new Response('', { status: 404 });
  };
  const { key, content } = await seal(await packShare(share));
  const ref = await uploadGist('tok', content, { fetchImpl: fakeGitHub });
  assert.equal(ref, 'sebasfavaron/f00d');
  const back = await unpackShare(await unseal(await downloadGist(ref, { fetchImpl: fakeGitHub }), key));
  assert.equal(back.profiles.ana.name, 'Ana Belén');
  await assert.rejects(downloadGist('sebasfavaron/beef', { fetchImpl: fakeGitHub }), /deleted/);
  await assert.rejects(downloadGist('../evil', { fetchImpl: fakeGitHub }), /no gist/);
});

test('a token GitHub refuses is reported as a token problem', async () => {
  const refuse = (status) => async () => new Response('{"message":"Bad credentials"}', { status });
  await assert.rejects(uploadGist('x', 'y', { fetchImpl: refuse(401) }), (e) => e.badToken && /token/.test(e.message));
  await assert.rejects(uploadGist('x', 'y', { fetchImpl: refuse(403) }), (e) => e.badToken && /Gists/.test(e.message));
});

test('a full-share link is short and keeps the view state', () => {
  const key = 'A'.repeat(43);
  const hash = buildHash({ s: 'sebasfavaron/472f69cd179246d451a144f8707bb029', k: key, p: 'ana', m: 'bea' });
  assert.ok(hash.length < 130, hash);
  const state = parseHash(hash);
  assert.equal(state.s, 'sebasfavaron/472f69cd179246d451a144f8707bb029');
  assert.equal(state.k, key);
  assert.equal(state.p, 'ana');
  assert.equal(state.m, 'bea');
  assert.equal(state.g, null);
});

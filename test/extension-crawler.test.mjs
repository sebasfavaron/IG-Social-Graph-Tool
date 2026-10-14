import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, step, toGraphJson, classify } from '../extension/lib/crawler.js';
import { pruneLoneNodes } from '../extension/lib/prune.js';

// Fake Instagram: me(1) followed by a(2), b(3), c(4), shop(5). Followers paginate 2 per page.
// "followed by" lists: a <- b,c ; b <- a ; c <- a,b (paginated) ; shop <- nobody
const users = { 2: 'a', 3: 'b', 4: 'c', 5: 'shop' };
const mutuals = { 2: [['b', 'c']], 3: [['a']], 4: [['a'], ['b']], 5: [[]] };

function fakeApi({ failOn = () => null } = {}) {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      const forced = failOn(path, calls.length);
      if (forced) return forced;
      const url = new URL(path, 'https://www.instagram.com');
      const maxId = url.searchParams.get('max_id');
      let m;
      if ((m = url.pathname.match(/friendships\/1\/followers/))) {
        const pks = Object.keys(users);
        const start = Number(maxId || 0);
        const page = pks.slice(start, start + 2);
        const next = start + 2 < pks.length ? String(start + 2) : undefined;
        return { status: 200, json: { users: page.map((pk) => ({ pk, username: users[pk] })), next_max_id: next, status: 'ok' } };
      }
      if ((m = url.pathname.match(/friendships\/(\d+)\/mutual_followers/))) {
        const pages = mutuals[m[1]];
        const i = Number(maxId || 0);
        const next = i + 1 < pages.length ? String(i + 1) : undefined;
        return { status: 200, json: { users: pages[i].map((username) => ({ username })), next_max_id: next, status: 'ok' } };
      }
      return { status: 404, json: { status: 'fail' } };
    },
  };
}

async function runToEnd(state, api, max = 100) {
  for (let i = 0; i < max; i++) {
    const r = await step(state, api);
    if (!r.wait) return r;
  }
  throw new Error('did not finish');
}

const me = { pk: '1', username: 'me' };

test('crawls followers with pagination and builds follower->me and mutual->follower links', async () => {
  const state = initialState(me);
  const api = fakeApi();
  assert.deepEqual(await runToEnd(state, api), { done: true });
  const g = toGraphJson(state);
  const edges = g.links.map((l) => `${l.source}>${l.target}`).sort();
  assert.deepEqual(edges, ['a>b', 'a>c', 'a>me', 'b>a', 'b>c', 'b>me', 'c>a', 'c>me', 'shop>me'].sort());
  assert.equal(g.nodes.length, 5);
  assert.equal(g.metadata.complete, true);
  // 2 follower pages + a, b, c(2 pages), shop
  assert.equal(api.calls.length, 2 + 5);
});

test('pruning hides accounts that only follow me', () => {
  const state = initialState(me);
  state.links = [['a', 'me'], ['b', 'me'], ['a', 'b'], ['shop', 'me']];
  state.nodes = { me: true, a: true, b: true, shop: true };
  const pruned = pruneLoneNodes(toGraphJson(state));
  assert.deepEqual(pruned.nodes.map((n) => n.id).sort(), ['a', 'b', 'me']);
});

test('rate limit returns cooldown and does not lose the cursor', async () => {
  const state = initialState(me);
  const api = fakeApi({ failOn: (_p, n) => (n === 2 ? { status: 429, json: { message: 'Please wait a few minutes before you try again.' } } : null) });
  await step(state, api);
  const cursor = state.followersCursor;
  assert.deepEqual(await step(state, api), { cooldown: true });
  assert.equal(state.followersCursor, cursor);
  assert.deepEqual(await runToEnd(state, api), { done: true });
  assert.equal(toGraphJson(state).links.length, 9);
});

test('logged out and checkpoint are fatal', () => {
  assert.deepEqual(classify({ status: 200, url: 'https://www.instagram.com/accounts/login/?next=x', json: null }), { kind: 'fatal', reason: 'logged_out' });
  assert.deepEqual(classify({ status: 400, json: { message: 'checkpoint_required', checkpoint_url: '/challenge/' } }), { kind: 'fatal', reason: 'checkpoint' });
  assert.equal(classify({ status: 400, json: { message: 'feedback_required' } }).kind, 'cooldown');
});

test('a follower that keeps failing is skipped after 3 tries, not retried forever', async () => {
  const state = initialState(me);
  const api = fakeApi({ failOn: (p) => (p.includes('/2/mutual_followers') ? { status: 500, json: null } : null) });
  assert.deepEqual(await runToEnd(state, api), { done: true });
  assert.equal(api.calls.filter((p) => p.includes('/2/mutual_followers')).length, 3);
  assert.ok(!toGraphJson(state).links.some((l) => l.target === 'a' && l.source !== 'a'));
});

test('maxFollowers limits the mutuals phase', async () => {
  const state = initialState(me, { maxFollowers: 2 });
  const api = fakeApi();
  await runToEnd(state, api);
  const checked = Object.values(state.followers).filter((f) => f.done).map((f) => f.username);
  assert.deepEqual(checked, ['a', 'b']);
});

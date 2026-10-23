import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, step, toGraph, classify, startUpdate, updateProgress } from '../extension/lib/crawler.js';
import { pruneLoneNodes } from '../extension/lib/prune.js';
import { diffGraphs, graphAt } from '../extension/lib/history.js';

// Fake Instagram: me(1) followed by a(2), b(3), c(4), shop(5). Followers paginate 2 per page.
// "followed by" lists: a <- b,c ; b <- a ; c <- a,b (paginated) ; shop <- nobody
const USERS = { 2: 'a', 3: 'b', 4: 'c', 5: 'shop' };
const MUTUALS = { 2: [['b', 'c']], 3: [['a']], 4: [['a'], ['b']], 5: [[]] };

function fakeApi({ failOn = () => null, users = USERS, mutuals = MUTUALS } = {}) {
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
        const user = (pk) => ({
          pk,
          username: users[pk],
          full_name: `${users[pk].toUpperCase()} Person`,
          profile_pic_url: `https://scontent.cdninstagram.com/${users[pk]}.jpg`,
          is_private: pk === '3',
          is_verified: pk === '5',
        });
        return { status: 200, json: { users: page.map(user), next_max_id: next, status: 'ok' } };
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
  const g = toGraph(state);
  const edges = g.links.map((l) => `${l.source}>${l.target}`).sort();
  assert.deepEqual(
    edges,
    // followers -> me, mutuals -> follower, and me -> everyone seen in a "followed by" list
    ['a>b', 'a>c', 'a>me', 'b>a', 'b>c', 'b>me', 'c>a', 'c>me', 'shop>me', 'me>a', 'me>b', 'me>c'].sort()
  );
  assert.equal(g.nodes.length, 5);
  assert.equal(g.metadata.complete, true);
  // 2 follower pages + a, b, c(2 pages), shop
  assert.equal(api.calls.length, 2 + 5);
});

test('pruning hides accounts that only follow me', () => {
  const state = initialState(me);
  state.links = [['a', 'me'], ['b', 'me'], ['a', 'b'], ['shop', 'me']];
  state.nodes = { me: true, a: true, b: true, shop: true };
  const pruned = pruneLoneNodes(toGraph(state));
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
  assert.equal(toGraph(state).links.length, 12);
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
  // no "followed by" links for a (me -> a comes from a showing up in others' lists)
  assert.ok(!toGraph(state).links.some((l) => l.target === 'a' && l.source !== 'me'));
});

test('maxFollowers limits the mutuals phase', async () => {
  const state = initialState(me, { maxFollowers: 2 });
  const api = fakeApi();
  await runToEnd(state, api);
  const checked = Object.values(state.followers).filter((f) => f.done).map((f) => f.username);
  assert.deepEqual(checked, ['a', 'b']);
});

test('time left counts Instagram cooldowns but not user pauses', async () => {
  const { tickClock, estimateRemaining, STATUS } = await import('../extension/lib/crawler.js');
  const state = initialState(me, { delaySec: 6 });
  state.phase = 'mutuals';
  state.order = Array.from({ length: 100 }, (_, i) => String(i));
  state.followers = Object.fromEntries(state.order.map((pk) => [pk, { username: pk, done: false }]));
  const finish = (n) => state.order.slice(0, n).forEach((pk) => (state.followers[pk].done = true));
  let now = 0;
  state.status = STATUS.RUNNING;
  tickClock(state, now);
  assert.equal(estimateRemaining(state).measured, false); // nothing measured yet: floor
  assert.equal(estimateRemaining(state).ms, 100 * 6000);

  // 10 followers in 60 s, then a 15 min cooldown, then 10 more in 60 s
  now += 60_000; finish(10); tickClock(state, now);
  state.status = STATUS.COOLDOWN; tickClock(state, now);
  now += 15 * 60_000; state.status = STATUS.RUNNING; tickClock(state, now);
  now += 60_000; finish(20); tickClock(state, now);
  // a 2 h user pause does not count
  state.status = STATUS.PAUSED; tickClock(state, now);
  now += 2 * 3600_000; state.status = STATUS.RUNNING; tickClock(state, now);

  const est = estimateRemaining(state);
  assert.equal(est.measured, true);
  // 17 min for 20 followers = 51 s each, 80 left
  assert.equal(Math.round(est.ms / 1000), 80 * 51);
});

test('names, photos and flags come along with the lists at no extra request', async () => {
  const state = initialState(me);
  await runToEnd(state, fakeApi());
  assert.deepEqual(state.profiles.b, {
    name: 'B Person',
    pic: 'https://scontent.cdninstagram.com/b.jpg',
    private: true,
    verified: false,
  });
  assert.equal(state.profiles.shop.verified, true);
});

const edges = (state) => toGraph(state).links.map((l) => `${l.source}>${l.target}`).sort();

// A month later: shop unfollowed, d(6) followed, a stopped following c, and b now follows d.
const LATER_USERS = { 6: 'd', 2: 'a', 3: 'b', 4: 'c' };
const LATER_MUTUALS = { 6: [['b']], 2: [['b', 'c']], 3: [['a']], 4: [['b']] };

test('an update brings the graph to what a fresh crawl would find', async () => {
  const state = initialState(me);
  await runToEnd(state, fakeApi());
  const later = { users: LATER_USERS, mutuals: LATER_MUTUALS };
  const api = fakeApi(later);
  startUpdate(state);
  assert.deepEqual(await runToEnd(state, api), { done: true });

  const fresh = initialState(me);
  await runToEnd(fresh, fakeApi(later));
  assert.deepEqual(edges(state), edges(fresh));
  assert.deepEqual(Object.keys(state.nodes).sort(), Object.keys(fresh.nodes).sort());
  assert.equal(state.update, null);
  assert.deepEqual({ added: state.updates[0].added, removed: state.updates[0].removed }, { added: 1, removed: 1 });
  // the new follower is checked first
  assert.ok(api.calls[2].includes('/6/mutual_followers'));
  // names and photos come fresh with the list
  assert.equal(state.profiles.d.name, 'D Person');
});

test('an update stopped half way leaves a whole graph: checked followers new, the rest as before', async () => {
  const state = initialState(me);
  await runToEnd(state, fakeApi());
  const before = new Set(edges(state));
  const api = fakeApi({ users: LATER_USERS, mutuals: LATER_MUTUALS });
  startUpdate(state);
  // 2 list pages, then d (new) and the first old one
  for (let i = 0; i < 4; i++) await step(state, api);
  assert.equal(updateProgress(state).done, 2);
  const now = edges(state);
  assert.ok(now.includes('d>me') && now.includes('b>d')); // d is in, with its connections
  assert.ok(!now.some((e) => e.startsWith('shop>'))); // shop is out
  // c has not been checked again: a > c from the old crawl is still there
  assert.ok(before.has('a>c') && now.includes('a>c'));
});

test('a follower whose check fails during an update keeps the links it had', async () => {
  const state = initialState(me);
  await runToEnd(state, fakeApi());
  const api = fakeApi({ failOn: (p) => (p.includes('/2/mutual_followers') ? { status: 500, json: null } : null) });
  startUpdate(state);
  assert.deepEqual(await runToEnd(state, api), { done: true });
  assert.ok(edges(state).includes('b>a'));
});

test('a followers list cut short by Instagram removes nobody', async () => {
  const state = initialState(me);
  await runToEnd(state, fakeApi());
  const api = fakeApi({ users: { 2: 'a' }, mutuals: MUTUALS });
  startUpdate(state);
  assert.deepEqual(await runToEnd(state, api), { done: true });
  assert.equal(state.updates[0].removed, 0);
  assert.ok(edges(state).includes('shop>me'));
  assert.equal(Object.keys(state.followers).length, 4);
});

test('a follower who changed username keeps their place under the new name', async () => {
  const state = initialState(me);
  await runToEnd(state, fakeApi());
  const api = fakeApi({ users: { ...USERS, 2: 'a2' }, mutuals: { ...MUTUALS, 3: [['a2']], 4: [['a2'], ['b']] } });
  startUpdate(state);
  await runToEnd(state, api);
  const now = edges(state);
  assert.ok(now.includes('a2>me') && now.includes('a2>b') && now.includes('b>a2'));
  assert.ok(!now.some((e) => e.split('>').includes('a')));
});

test('an update writes down only what changed, and those times date the published changes', async () => {
  const state = initialState(me);
  await runToEnd(state, fakeApi());
  const before = toGraph(state);
  const crawledAt = Date.now();
  await new Promise((r) => setTimeout(r, 2));
  startUpdate(state);
  await runToEnd(state, fakeApi({ users: LATER_USERS, mutuals: LATER_MUTUALS }));
  // only what changed is written: shop's link out, d's link and b > d in, a > c out
  assert.deepEqual(state.history.map(([, op, a, b]) => `${op}${a}>${b}`).sort(), ['+b>d', '+d>me', '-a>c', '-shop>me'].sort());
  // what a republish would store: the published graphs' difference, at the crawl's times
  const after = toGraph(state);
  const publishedAt = Date.now() + 1000;
  const changes = diffGraphs(before, after, { history: state.history, since: crawledAt, now: publishedAt });
  const noticed = Object.fromEntries(state.history.map(([t, op, a, b]) => [`${op}${a}>${b}`, t]));
  for (const [t, op, s, d] of changes) {
    if (s === 'me') assert.equal(t, state.history.find(([, o, a]) => o === op && a === d)[0]); // me > d comes with d's first change
    else assert.equal(t, noticed[`${op}${s}>${d}`]);
  }
  const versions = [{ at: publishedAt, changes }];
  const linksOf = (g) => g.links.map((l) => `${l.source}>${l.target}`).sort();
  assert.deepEqual(linksOf(graphAt(after, versions, crawledAt)), linksOf(before));
  assert.deepEqual(linksOf(graphAt(after, versions, publishedAt)), linksOf(after));
});

test('an update that finds nothing new writes nothing', async () => {
  const state = initialState(me);
  await runToEnd(state, fakeApi());
  startUpdate(state);
  await runToEnd(state, fakeApi());
  assert.deepEqual(state.history || [], []);
});

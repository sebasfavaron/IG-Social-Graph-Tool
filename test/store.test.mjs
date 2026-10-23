import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptIdentity, takeIdentity, listGraphs, loadGraph, loadHistory, loadGroupNames, loadPeople, me, publishedHere, saveGraph, saveGroupNames, teaser, unpublishGraph } from '../extension/lib/store.js';
import { buildHash, decodeGraph, encodeGraph, parseHash } from '../extension/lib/share.js';
import { graphAt } from '../extension/lib/history.js';
import { mergeGraphs, ownGraph } from '../extension/lib/merge.js';

const jpeg = (fill, n) => `data:image/jpeg;base64,${Buffer.alloc(n, fill).toString('base64')}`;

// Neon's HTTP SQL endpoint, as far as graphs.sql goes, with its upsert rules
function fakeNeon() {
  const graphs = new Map();
  const dates = new Map(); // owner -> when the stored graph was shared
  const counts = new Map(); // owner -> people in it
  const keys = new Map(); // owner -> the key that published it
  const shareDates = new Map([['old', 1], ['newer', 50]]); // old share id -> when it was made
  let clock = 10;
  const people = new Map();
  const groupNames = new Map(); // owner -> { anchor: name }
  const history = []; // { owner, at, changes }
  const calls = [];
  const fetchImpl = async (url, init) => {
    const { query, params } = JSON.parse(init.body);
    calls.push(query);
    const ok = (rows) => new Response(JSON.stringify({ rows }));
    if (query === 'select save_graph($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)') {
      const [owner, data, onlyIfMissing, fromShare, count, key, members, changes] = params;
      calls.members = JSON.parse(members);
      if (keys.has(owner) && (onlyIfMissing || keys.get(owner) !== key)) {
        if (onlyIfMissing) return ok([[false]]);
        return new Response(JSON.stringify({ message: 'this graph was published from another browser' }), { status: 400 });
      }
      if (key) keys.set(owner, key);
      counts.set(owner, count);
      const made = shareDates.get(fromShare);
      if (onlyIfMissing && graphs.has(owner) && !(made && made > dates.get(owner))) return ok([[false]]);
      const old = graphs.get(owner);
      graphs.set(owner, data);
      dates.set(owner, onlyIfMissing && made ? made : ++clock);
      if (old !== undefined && old !== data) history.push({ owner, at: dates.get(owner) * 1000, changes: changes && !onlyIfMissing ? JSON.parse(changes) : null });
      return ok([[true]]);
    }
    if (query === 'select unpublish($1, $2)') {
      const [owner, key] = params;
      if (keys.get(owner) !== key) return new Response(JSON.stringify({ message: 'only the browser that published' }), { status: 400 });
      graphs.delete(owner);
      return ok([[true]]);
    }
    if (query === 'select save_people($1::jsonb, $2, $3, $4)') {
      const [rows, onlyIfMissing] = params;
      for (const r of JSON.parse(rows)) {
        const old = people.get(r.u);
        const pick = (mine, theirs) => (onlyIfMissing ? theirs || mine : mine || theirs);
        people.set(r.u, old ? { ...r, n: pick(r.n, old.n), p: pick(r.p, old.p), t: pick(r.t, old.t) } : r);
      }
      return ok([[1]]);
    }
    // (who may read what is the database's job, tested against it: db/graphs.sql)
    if (query === 'select count(*) from list_graphs($1, $2)') return ok([[keys.has(params[0]) && keys.get(params[0]) === params[1] ? 1 : 0]]);
    if (query.includes('from list_graphs($1, $2)')) {
      const owners = [...graphs.keys()].sort((x, y) => dates.get(y) - dates.get(x));
      return ok(owners.map((o) => {
        const p = people.get(o);
        return [o, new Date(dates.get(o) * 1000).toISOString(), counts.get(o), p?.n || null, p?.p || null, p?.t || null];
      }));
    }
    if (query === 'select set_group_names($1, $2, $3::jsonb)') {
      const [owner, key, names] = params;
      if (!keys.has(owner) || keys.get(owner) !== key)
        return new Response(JSON.stringify({ message: 'only the browser that published this graph can name its groups' }), { status: 400 });
      groupNames.set(owner, JSON.parse(names));
      return ok([[null]]);
    }
    if (query === 'select get_group_names($1, $2, $3)') return ok([[graphs.has(params[0]) ? groupNames.get(params[0]) || {} : null]]);
    if (query === 'select data from get_graph($1, $2, $3)') return ok(graphs.has(params[0]) ? [[graphs.get(params[0])]] : []);
    if (query === 'select data, updated_at from get_graph($1, $2, $3)')
      return ok(graphs.has(params[0]) ? [[graphs.get(params[0]), new Date(dates.get(params[0]) * 1000).toISOString()]] : []);
    if (query === 'select at, changes from get_graph_history($1, $2, $3)')
      return ok(history.filter((h) => h.owner === params[0]).map((h) => [new Date(h.at).toISOString(), h.changes]));
    if (query.includes('from graph_teaser($1)')) {
      const o = params[0];
      return ok(graphs.has(o) ? [[o, counts.get(o), people.get(o)?.n || null, null, null, graphs.size]] : []);
    }
    if (query.includes('from get_people($1, $2, $3)')) {
      return ok(params[0].filter((u) => people.has(u)).map((u) => {
        const p = people.get(u);
        return [u, p.n || null, p.f, p.p || null, p.t || null];
      }));
    }
    return new Response(JSON.stringify({ message: 'permission denied' }), { status: 400 });
  };
  return { fetchImpl, calls, graphs, people, history };
}

const profiles = {
  ana: { name: 'Ana Belén', private: false, verified: true },
  bo: { name: '', private: true, verified: false },
  cy: { name: 'Cy', private: false, verified: false },
};
const photos = new Map([['ana', jpeg(1, 600)], ['cy', jpeg(3, 400)]]);

test('a crawl is stored by its owner, with only its own people, and read back', async () => {
  const neon = fakeNeon();
  await saveGraph({ owner: 'me', g: 'GRAPH', ids: new Set(['me', 'ana', 'bo']), profiles, photos }, neon);
  assert.equal(await loadGraph('me', neon), 'GRAPH');
  assert.equal(await loadGraph('nobody', neon), null);
  const back = await loadPeople(['ana', 'bo', 'cy', 'me'], neon);
  assert.deepEqual(Object.keys(back.profiles).sort(), ['ana', 'bo']); // cy is not in the graph
  assert.deepEqual(back.profiles.ana, { name: 'Ana Belén', private: false, verified: true });
  assert.equal(back.profiles.bo.private, true);
  assert.equal(back.photos.get('ana'), photos.get('ana'));
});

test('someone in two graphs is one row, and a new share does not erase what it lacks', async () => {
  const neon = fakeNeon();
  await saveGraph({ owner: 'me', g: 'A', ids: new Set(['ana']), profiles, photos }, neon);
  await saveGraph({ owner: 'friend', g: 'B', ids: new Set(['ana']), profiles: { ana: { name: '' } } }, neon);
  assert.equal(neon.people.size, 0 + 1);
  const back = await loadPeople(['ana'], neon);
  assert.equal(back.profiles.ana.name, 'Ana Belén');
  assert.equal(back.photos.get('ana'), photos.get('ana'));
});

test('copying an old link over never replaces what is already stored', async () => {
  const neon = fakeNeon();
  await saveGraph({ owner: 'me', g: 'NEW', ids: new Set(['ana']), profiles: { ana: { name: 'Ana' } } }, neon);
  const saved = await saveGraph({ owner: 'me', g: 'OLD', ids: new Set(['ana']), profiles, photos, onlyIfMissing: true }, neon);
  assert.equal(saved, false);
  assert.equal(await loadGraph('me', neon), 'NEW');
  assert.equal(await saveGraph({ owner: 'other', g: 'OLD', ids: new Set(['cy']), profiles, photos, onlyIfMissing: true }, neon), true);
  assert.equal((await loadPeople(['cy'], neon)).profiles.cy.name, 'Cy');
});

test('an old link made after the stored graph replaces it, in whatever order they are opened', async () => {
  const neon = fakeNeon();
  // a graph that came from an old link (no key): newer old links replace it
  assert.equal(await saveGraph({ owner: 'me', g: 'OLD LINK', ids: new Set(), onlyIfMissing: true, fromShare: 'old' }, neon), true);
  assert.equal(await saveGraph({ owner: 'me', g: 'NEWER LINK', ids: new Set(), onlyIfMissing: true, fromShare: 'newer' }, neon), true);
  assert.equal(await loadGraph('me', neon), 'NEWER LINK');
  // the older one opened afterwards leaves the newer alone
  assert.equal(await saveGraph({ owner: 'me', g: 'OLD LINK', ids: new Set(), onlyIfMissing: true, fromShare: 'old' }, neon), false);
  assert.equal(await loadGraph('me', neon), 'NEWER LINK');
  // once published with a key, no old link replaces it
  await saveGraph({ owner: 'me', g: 'PUBLISHED', ids: new Set() }, neon);
  assert.equal(await saveGraph({ owner: 'me', g: 'NEWER LINK', ids: new Set(), onlyIfMissing: true, fromShare: 'newer' }, neon), false);
  assert.equal(await loadGraph('me', neon), 'PUBLISHED');
});

test('people go up in batches small enough for the database', async () => {
  const neon = fakeNeon();
  const many = new Map(Array.from({ length: 400 }, (_, i) => [`p${i}`, jpeg(i % 250, 6000)]));
  await saveGraph({ owner: 'me', g: 'G', ids: new Set(many.keys()), photos: many }, neon);
  const batches = neon.calls.filter((q) => q.startsWith('select save_people')).length;
  assert.ok(batches >= 2, `${batches} batch(es)`);
  assert.equal(neon.people.size, 400);
});

test('the list of shared graphs: newest first, with size, name and photo', async () => {
  const neon = fakeNeon();
  await saveGraph({ owner: 'ana', g: 'A', ids: new Set(['ana', 'bo', 'cy']), profiles, photos }, neon);
  await saveGraph({ owner: 'cy', g: 'C', ids: new Set(['cy', 'bo']), profiles, photos }, neon);
  const list = await listGraphs(neon);
  assert.deepEqual(list.map((g) => g.owner), ['cy', 'ana']);
  assert.deepEqual(list.map((g) => g.people), [2, 3]);
  assert.equal(list[1].name, 'Ana Belén');
  assert.equal(list[1].photo, photos.get('ana'));
  assert.ok(list[0].updatedAt instanceof Date);
});

test('a stored link is just the usernames plus the view', () => {
  const hash = buildHash({ o: 'sebas.favaron', m: 'nacho_1', p: 'ana', n: ['cuba', 'itba'] });
  assert.equal(hash, '#o=sebas.favaron&m=nacho_1&p=ana&n=cuba,itba');
  const state = parseHash(hash);
  assert.equal(state.o, 'sebas.favaron');
  assert.deepEqual(state.m, ['nacho_1']);
  assert.deepEqual(state.n, ['cuba', 'itba']);
  // several owners: written with commas, also read when typed as repeated m=
  assert.equal(buildHash({ o: 'a', m: ['b', 'c.d'] }), '#o=a&m=b,c.d');
  assert.deepEqual(parseHash('#o=a&m=b&m=c.d').m, ['b', 'c.d']);
  assert.deepEqual(parseHash('#o=a').m, []);
});

test("each owner's crawl comes back out of a merged graph", () => {
  const a = { username: 'a', nodes: ['a', 'x', 'y'].map((id) => ({ id })), links: [
    { source: 'x', target: 'a' }, { source: 'a', target: 'y' }, { source: 'x', target: 'y' },
  ] };
  const b = { username: 'b', nodes: ['b', 'y', 'z'].map((id) => ({ id })), links: [
    { source: 'b', target: 'y' }, { source: 'z', target: 'b' }, { source: 'y', target: 'z' },
  ] };
  const merged = mergeGraphs(a, b);
  const back = ownGraph(merged, 'a');
  assert.equal(back.username, 'a');
  assert.deepEqual(back.nodes.map((n) => n.id).sort(), ['a', 'x', 'y']);
  assert.equal(back.links.length, 3);
  assert.deepEqual(ownGraph(merged, 'b').nodes.map((n) => n.id).sort(), ['b', 'y', 'z']);
});

test('only the browser that published a graph replaces or unpublishes it', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    const neon = fakeNeon();
    assert.equal(publishedHere('me'), false);
    await saveGraph({ owner: 'me', g: 'MINE', ids: new Set(['me']) }, neon);
    assert.equal(publishedHere('me'), true);
    // another browser: no key of its own for @me
    const mine = new Map(store);
    store.clear();
    await assert.rejects(saveGraph({ owner: 'me', g: 'NOT MINE', ids: new Set(['me']) }, neon), /another browser/);
    await assert.rejects(unpublishGraph('me', neon), /only the browser/);
    assert.equal(await loadGraph('me', neon), 'MINE');
    // back in the publishing browser
    for (const [k, v] of mine) store.set(k, v);
    await unpublishGraph('me', neon);
    assert.equal(await loadGraph('me', neon), null);
  } finally {
    delete globalThis.localStorage;
  }
});

test('publishing makes this browser a viewer; the site adopts that from a link', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    const neon = fakeNeon();
    assert.equal(me(), null);
    await saveGraph({ owner: 'me', g: 'MINE', ids: new Set(['me', 'ana', 'bo']) }, neon);
    assert.equal(me().owner, 'me');
    assert.match(me().key, /^[0-9a-f]{48}$/);
    assert.deepEqual(neon.calls.members, ['me', 'ana', 'bo']); // everyone, for the network links
    const { key } = me();
    // another browser (the site), handed the identity by a link from the extension
    store.clear();
    assert.equal(await adoptIdentity('me', 'not a key', neon), false);
    assert.equal(await adoptIdentity('me', key, neon), true);
    assert.deepEqual(me(), { owner: 'me', key });
    // a stale key (an old extension's, a failed publish's) never replaces the working one,
    // and a working one replaces a stale one
    const stale = 'ab'.repeat(24);
    assert.equal(await adoptIdentity('me', stale, neon), true);
    assert.deepEqual(me(), { owner: 'me', key });
    store.set('ownerKey:me', stale);
    await adoptIdentity('me', key, neon);
    assert.deepEqual(me(), { owner: 'me', key });
    // the private link: out of the address, the key sorted out by the time adopted settles
    store.clear();
    const taken = takeIdentity(`#o=me&me=me&mk=${key}`, neon);
    assert.equal(taken.rest, '#o=me');
    await taken.adopted;
    assert.deepEqual(me(), { owner: 'me', key });
    assert.equal(takeIdentity('#o=me'), null);
    assert.deepEqual(await teaser('me', neon), { owner: 'me', people: 3, name: '', photo: null, graphs: 1 });
    assert.equal(await teaser('nobody', neon), null);
    // unpublishing ends it
    await unpublishGraph('me', neon);
    assert.equal(me(), null);
  } finally {
    delete globalThis.localStorage;
  }
});

test('group names live with the graph: its publisher names them, the network reads them', async () => {
  const kept = new Map();
  globalThis.localStorage = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };
  try {
    const neon = fakeNeon();
    const opts = { fetchImpl: neon.fetchImpl };
    await saveGraph({ owner: 'namer', g: 'G', ids: new Set(['namer', 'ana']) }, opts);
    assert.deepEqual(await loadGroupNames('namer', opts), {});
    await saveGroupNames('namer', { ana: 'Escuela' }, opts);
    assert.deepEqual(await loadGroupNames('namer', opts), { ana: 'Escuela' });
    // a browser without its key cannot
    await assert.rejects(saveGroupNames('someone_else', { ana: 'x' }, opts), /only the browser that published/);
    assert.equal(await loadGroupNames('never_published', opts), null);
  } finally {
    delete globalThis.localStorage;
  }
});

// ---- history: what each republish changed, played back -----------------------------------

const graphOf = (owner, links) => ({ username: owner, nodes: [...new Set(links.flat())].map((id) => ({ id })), links: links.map(([source, target]) => ({ source, target })) });
const pairs = (graph) => graph.links.map((l) => `${l.source}>${l.target}`).sort();

test('each republish stores what it changed, and the published graph plays back to any earlier one', async (t) => {
  const OWNER = 'hist.one';
  const kept = new Map();
  globalThis.localStorage = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };
  t.after(() => delete globalThis.localStorage);
  const neon = fakeNeon();
  const v1 = graphOf(OWNER, [['ana', OWNER], ['bo', OWNER], ['ana', 'bo'], [OWNER, 'ana']]);
  const v2 = graphOf(OWNER, [['ana', OWNER], ['cy', OWNER], ['ana', 'cy'], [OWNER, 'ana']]);
  const v3 = graphOf(OWNER, [['ana', OWNER], ['cy', OWNER], ['ana', 'cy'], ['cy', 'ana'], [OWNER, 'ana'], [OWNER, 'cy']]);
  const ids = (g) => new Set(g.nodes.map((n) => n.id));
  await saveGraph({ owner: OWNER, g: await encodeGraph(v1), ids: ids(v1) }, neon);
  const t1 = Date.now();
  await saveGraph({ owner: OWNER, g: await encodeGraph(v2), ids: ids(v2) }, neon);
  // the crawl noticed cy following ana between the two publishes
  const tick = () => new Promise((r) => setTimeout(r, 5));
  await tick();
  const noticed = Date.now();
  await tick();
  await saveGraph({ owner: OWNER, g: await encodeGraph(v3), ids: ids(v3), history: [[noticed, '+', 'cy', 'ana']] }, neon);
  assert.equal(neon.history.length, 2); // the first publish starts the history

  const versions = await loadHistory(OWNER, neon);
  const today = await decodeGraph(neon.graphs.get(OWNER));
  assert.deepEqual(pairs(graphAt(today, versions, Date.now())), pairs(v3));
  assert.deepEqual(pairs(graphAt(today, versions, t1 - 1)), pairs(v1));
  assert.deepEqual(graphAt(today, versions, t1 - 1).nodes.map((n) => n.id).sort(), ['ana', 'bo', OWNER].sort());
  // cy > ana carries the moment the crawl saw it, not the publish
  const third = versions[1].changes;
  assert.ok(third.some(([t, op, s, d]) => t === noticed && op === '+' && s === 'cy' && d === 'ana'));
  assert.deepEqual(pairs(graphAt(today, versions, noticed)).includes('cy>ana'), true);
  assert.deepEqual(pairs(graphAt(today, versions, noticed - 1)).includes('cy>ana'), false);
});

test('the same graph again stores no change, and a save that cannot say what changed stops playback there', async (t) => {
  const OWNER = 'hist.two';
  const kept = new Map();
  globalThis.localStorage = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };
  t.after(() => delete globalThis.localStorage);
  const neon = fakeNeon();
  const v1 = graphOf(OWNER, [['ana', OWNER]]);
  const v2 = graphOf(OWNER, [['ana', OWNER], ['bo', OWNER]]);
  await saveGraph({ owner: OWNER, g: await encodeGraph(v1), ids: new Set([OWNER, 'ana']) }, neon);
  await saveGraph({ owner: OWNER, g: await encodeGraph(v1), ids: new Set([OWNER, 'ana']), profiles: { ana: { name: 'Ana' } } }, neon);
  assert.equal(neon.history.length, 0);
  neon.graphs.set(OWNER, 'not a graph this client can read');
  await saveGraph({ owner: OWNER, g: await encodeGraph(v2), ids: new Set([OWNER, 'ana', 'bo']) }, neon);
  const versions = await loadHistory(OWNER, neon);
  assert.equal(versions[0].changes, null);
  assert.equal(graphAt(v2, versions, 0), null);
});

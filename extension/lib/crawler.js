// Crawl logic, kept free of chrome.* so it can be tested with a fake API.
//
// Graph semantics (same as the old bookmarklet):
//   - every account that follows the logged user gets a link  follower -> me
//   - for every such follower F, Instagram's "followed by" list (accounts *I* follow
//     that also follow F) gives links  M -> F
// One request per page; the caller sleeps between steps.
//
// Both lists also carry each account's real name, photo URL, private and verified flags;
// they are kept in state.profiles at no extra request.
//
// A finished crawl is brought up to date in place (startUpdate): the followers list
// again, then every follower's "followed by" list again. The graph stays whole the
// whole time, so the update can stop anywhere and what is on screen is still a graph.
// Every link an update adds or takes away is written to state.history, so the graph
// on any earlier day can be rebuilt from today's (lib/history.js) without a copy of it.

export const IG_APP_ID = '936619743392459';

export const STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COOLDOWN: 'cooldown',
  DONE: 'done',
  ERROR: 'error',
};

const MAX_RETRIES = 3;

export function initialState(viewer, settings = {}) {
  return {
    version: 2,
    status: STATUS.IDLE,
    viewer, // { pk, username }
    settings: { delaySec: 6, maxFollowers: 0, ...settings },
    phase: 'followers', // followers -> mutuals -> done
    followersCursor: null,
    followers: {}, // pk -> { username, done }
    profiles: {}, // username -> { name, pic, private, verified }
    order: [], // follower pks, in the order they were found
    current: null, // { pk, cursor, retries }
    nodes: { [viewer.username]: true },
    links: [], // [source, target]
    requests: 0,
    cooldowns: 0,
    error: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function progress(state) {
  const total = state.order.length;
  const done = state.order.filter((pk) => state.followers[pk].done).length;
  return { total, done, links: state.links.length, nodes: Object.keys(state.nodes).length };
}

// Classifies a raw response from api.get into ok / cooldown / fatal / skip / retry.
export function classify(res) {
  const msg = (res.json && (res.json.message || res.json.error_type)) || '';
  if (res.url && res.url.includes('/accounts/login')) return { kind: 'fatal', reason: 'logged_out' };
  if (msg === 'login_required' || res.json?.require_login || res.status === 401) {
    return { kind: 'fatal', reason: 'logged_out' };
  }
  if (msg.includes('checkpoint') || res.json?.checkpoint_url) {
    return { kind: 'fatal', reason: 'checkpoint' };
  }
  if (res.status === 429 || /wait a few minutes|feedback_required|rate limit/i.test(msg)) {
    return { kind: 'cooldown' };
  }
  if (res.status === 404) return { kind: 'skip' };
  if (res.status >= 200 && res.status < 300 && res.json && res.json.status !== 'fail') {
    return { kind: 'ok' };
  }
  return { kind: 'retry', reason: `HTTP ${res.status} ${msg}`.trim() };
}

function keepProfile(state, user) {
  if (!user?.username) return;
  state.profiles ??= {};
  // the same person shows up in many lists; a field one list leaves out keeps its value
  const known = state.profiles[user.username] || { name: '', pic: '', private: false, verified: false };
  state.profiles[user.username] = {
    name: user.full_name ?? known.name,
    pic: user.profile_pic_url ?? known.pic,
    private: user.is_private ?? known.private,
    verified: user.is_verified ?? known.verified,
  };
}

function addLink(state, source, target) {
  state.nodes[source] = true;
  state.nodes[target] = true;
  state.links.push([source, target]);
}

// state.history: [time, op, a, b], oldest first. '+' and '-' are the link a -> b coming
// and going, '~' is account a renamed to b. Only updates write it: the first crawl is
// the starting point, and what it found is the graph with every entry undone.
function record(state, op, a, b, at = Date.now()) {
  (state.history ??= []).push([at, op, a, b]);
}

const pairKey = (s, t) => `${s}\u0000${t}`;

// Nodes are whoever is in a link, plus the logged user: after links are taken away,
// someone who is in none of them anymore leaves the graph.
function rebuildNodes(state) {
  state.nodes = { [state.viewer.username]: true };
  for (const [source, target] of state.links) {
    state.nodes[source] = true;
    state.nodes[target] = true;
  }
}

// ---- Update ----------------------------------------------------------------------
// Two stages, both resumable after a pause or a reload:
//   followers  the list again. New followers join with their  follower -> me  link; the
//              ones missing from it leave, with every link that points at them. Names
//              and photos come fresh with it.
//   mutuals    each follower's "followed by" list again: new followers first, then the
//              ones checked longest ago. Their incoming links are swapped for the new
//              list only once it is read to the end; a follower that fails keeps the old.
// If the list comes back with less than half the followers known, nobody is removed:
// that is Instagram cutting the list short, not half the followers leaving.

export function startUpdate(state) {
  state.update = {
    stage: 'followers',
    cursor: null,
    retries: 0,
    seen: [], // follower pks in the order the list gave them (newest first)
    added: [],
    removed: 0,
    queue: [], // pks to check again
    pos: 0,
    current: null, // { pk, cursor, retries, found: [usernames] }
    startedAt: Date.now(),
    paceBase: null, // set when the checks start
    priorPace: crawlPace(state), // ms per follower of the crawl being updated
  };
  state.error = null;
}

// The pace the crawl measured, to estimate an update before it has measured its own.
function crawlPace(state) {
  const base = state.paceBase;
  if (!base) return null;
  const sampled = progress(state).done - base.done;
  return sampled >= MIN_SAMPLE ? ((state.activeMs || 0) - base.activeMs) / sampled : null;
}

export function updateProgress(state) {
  const u = state.update;
  if (!u) return null;
  return {
    stage: u.stage,
    listed: u.seen.length,
    done: u.pos,
    total: u.queue.length,
    added: u.added.length,
    removed: u.removed,
  };
}

async function updateStep(state, api, delay) {
  const u = state.update;
  const me = state.viewer.username;

  if (u.stage === 'followers') {
    const res = await api.get(followersPath(state, u.cursor));
    state.requests++;
    const verdict = classify(res);
    if (verdict.kind === 'fatal') return { fatal: verdict.reason };
    if (verdict.kind === 'cooldown') return { cooldown: true };
    if (verdict.kind !== 'ok') {
      state.error = verdict.reason || 'HTTP error';
      if (++u.retries >= MAX_RETRIES) return { fatal: state.error };
      return { wait: delay * 2 };
    }
    const seen = new Set(u.seen);
    for (const user of res.json.users || []) {
      const pk = String(user.pk || user.id);
      if (seen.has(pk)) continue;
      seen.add(pk);
      u.seen.push(pk);
      keepProfile(state, user);
      if (!state.followers[pk]) {
        state.followers[pk] = { username: user.username, done: false };
        u.added.push(pk);
        addLink(state, user.username, me);
        record(state, '+', user.username, me);
      } else if (state.followers[pk].username !== user.username) {
        renameAccount(state, state.followers[pk].username, user.username);
        state.followers[pk].username = user.username;
      }
    }
    u.retries = 0;
    state.error = null;
    u.cursor = res.json.next_max_id || null;
    if (!u.cursor) finishListing(state);
    return { wait: delay };
  }

  if (!u.current) {
    if (u.pos >= u.queue.length) {
      state.update = null;
      (state.updates ??= []).push({ startedAt: u.startedAt, at: Date.now(), added: u.added.length, removed: u.removed });
      return { done: true };
    }
    u.current = { pk: u.queue[u.pos], cursor: null, retries: 0, found: [] };
  }
  const c = u.current;
  const next = () => {
    u.pos++;
    u.current = null;
  };
  const res = await api.get(mutualsPath(c.pk, c.cursor));
  state.requests++;
  const verdict = classify(res);
  if (verdict.kind === 'fatal') return { fatal: verdict.reason };
  if (verdict.kind === 'cooldown') return { cooldown: true };
  if (verdict.kind !== 'ok') {
    // the old links stay: an update never loses what the crawl had over one failure
    if (verdict.kind === 'skip' || ++c.retries >= MAX_RETRIES) next();
    return { wait: verdict.kind === 'skip' ? delay : delay * 2 };
  }
  for (const user of res.json.users || []) {
    keepProfile(state, user);
    if (user.username) c.found.push(user.username);
  }
  const more = res.json.next_max_id;
  if (more && more !== c.cursor) {
    c.cursor = more;
    return { wait: delay };
  }
  const follower = state.followers[c.pk];
  if (follower) {
    const target = follower.username;
    const before = new Set(state.links.filter(([, t]) => t === target).map(([source]) => source));
    const after = new Set(c.found);
    for (const source of before) if (!after.has(source)) record(state, '-', source, target);
    for (const source of after) if (!before.has(source)) record(state, '+', source, target);
    state.links = state.links.filter(([, t]) => t !== target);
    for (const source of after) state.links.push([source, target]);
    rebuildNodes(state);
    follower.done = true;
    follower.checkedAt = Date.now();
  }
  next();
  return { wait: delay };
}

function finishListing(state) {
  const u = state.update;
  const me = state.viewer.username;
  const seen = new Set(u.seen);
  const known = Object.keys(state.followers);
  const gone = known.filter((pk) => !seen.has(pk));
  if (gone.length && seen.size >= known.length / 2) {
    const names = new Set(gone.map((pk) => state.followers[pk].username));
    // their  follower -> me  link and the "followed by" links into them; as someone the
    // logged user follows they can still be in others' lists, and those links stay
    const leaving = ([s, t]) => names.has(t) || (t === me && names.has(s));
    const logged = new Set();
    for (const [source, target] of state.links.filter(leaving)) {
      if (logged.has(pairKey(source, target))) continue; // the first crawl can hold a link twice
      logged.add(pairKey(source, target));
      record(state, '-', source, target);
    }
    state.links = state.links.filter((link) => !leaving(link));
    for (const pk of gone) delete state.followers[pk];
    u.removed = gone.length;
    rebuildNodes(state);
  }
  // order is the list as it is today; anyone kept above because the list came short goes last
  state.order = [...u.seen, ...known.filter((pk) => !seen.has(pk) && state.followers[pk])];
  const limit = state.settings.maxFollowers || Infinity;
  const added = new Set(u.added);
  const checkedAt = (pk) => state.followers[pk].checkedAt || 0;
  const old = state.order.filter((pk) => !added.has(pk)).sort((a, b) => checkedAt(a) - checkedAt(b));
  u.queue = [...u.added, ...old].slice(0, limit);
  u.stage = 'mutuals';
  u.paceBase = { activeMs: state.activeMs || 0, pos: 0 }; // the listing is not in the pace
}

// Instagram usernames change; the pk does not. Links and profile follow the new name.
function renameAccount(state, from, to) {
  if (from === to) return;
  record(state, '~', from, to);
  state.links = state.links.map(([s, t]) => [s === from ? to : s, t === from ? to : t]);
  if (state.profiles?.[from] && !state.profiles[to]) state.profiles[to] = state.profiles[from];
  rebuildNodes(state);
}

function nextPendingFollower(state) {
  const limit = state.settings.maxFollowers || Infinity;
  return state.order.slice(0, limit).find((pk) => !state.followers[pk].done);
}

// Performs exactly one request and mutates `state`. Returns
//   { wait: ms }        -> caller should sleep that long before the next step
//   { cooldown: true }  -> Instagram is throttling; caller pauses for a while
//   { fatal: reason }   -> stop; user has to do something (log in, solve checkpoint)
//   { done: true }
export async function step(state, api) {
  const delay = state.settings.delaySec * 1000;

  if (state.update) return updateStep(state, api, delay);

  if (state.phase === 'followers') {
    const res = await api.get(followersPath(state, state.followersCursor));
    state.requests++;
    const verdict = classify(res);
    if (verdict.kind !== 'ok') return handleNotOk(state, verdict, () => {});

    for (const user of res.json.users || []) {
      const pk = String(user.pk || user.id);
      if (!state.followers[pk]) {
        state.followers[pk] = { username: user.username, done: false };
        state.order.push(pk);
      }
      keepProfile(state, user);
      addLink(state, user.username, state.viewer.username);
    }
    state.followersRetries = 0;
    state.followersCursor = res.json.next_max_id || null;
    if (!state.followersCursor) state.phase = 'mutuals';
    return { wait: delay };
  }

  if (state.phase === 'mutuals') {
    if (!state.current) {
      const pk = nextPendingFollower(state);
      if (!pk) {
        state.phase = 'done';
        return { done: true };
      }
      state.current = { pk, cursor: null, retries: 0 };
    }
    const { pk, cursor } = state.current;
    const target = state.followers[pk].username;
    const res = await api.get(mutualsPath(pk, cursor));
    state.requests++;
    const verdict = classify(res);
    if (verdict.kind !== 'ok') {
      return handleNotOk(state, verdict, () => {
        state.followers[pk].done = true;
        state.current = null;
      });
    }

    for (const user of res.json.users || []) {
      keepProfile(state, user);
      addLink(state, user.username, target);
    }
    const next = res.json.next_max_id;
    if (next && next !== cursor) {
      state.current.cursor = next;
    } else {
      state.followers[pk].done = true;
      state.current = null;
    }
    return { wait: delay };
  }

  return { done: true };
}

function followersPath(state, cursor) {
  const params = new URLSearchParams({ count: '50', search_surface: 'follow_list_page' });
  if (cursor) params.set('max_id', cursor);
  return `/api/v1/friendships/${state.viewer.pk}/followers/?${params}`;
}

function mutualsPath(pk, cursor) {
  return `/api/v1/friendships/${pk}/mutual_followers/${cursor ? `?max_id=${encodeURIComponent(cursor)}` : ''}`;
}

function handleNotOk(state, verdict, skipCurrent) {
  if (verdict.kind === 'fatal') return { fatal: verdict.reason };
  if (verdict.kind === 'cooldown') return { cooldown: true };
  if (verdict.kind === 'skip') {
    skipCurrent();
    return { wait: state.settings.delaySec * 1000 };
  }
  // retry: a follower is skipped after MAX_RETRIES; the followers list itself is required
  state.error = verdict.reason;
  if (state.current) {
    state.current.retries = (state.current.retries || 0) + 1;
    if (state.current.retries >= MAX_RETRIES) skipCurrent();
  } else {
    state.followersRetries = (state.followersRetries || 0) + 1;
    if (state.followersRetries >= MAX_RETRIES) return { fatal: verdict.reason };
  }
  return { wait: state.settings.delaySec * 1000 * 2 };
}

// The graph the viewer draws and the share link packs: { username, nodes, links }.
// Profiles travel next to it (state.profiles), not inside: share links carry usernames only.
export function toGraph(state) {
  const me = state.viewer.username;
  const seen = new Set();
  const links = [];
  const add = (source, target) => {
    const key = `${source}\u0000${target}`;
    if (seen.has(key) || source === target) return;
    seen.add(key);
    links.push({ source, target, value: 1 });
  };
  for (const [source, target] of state.links) {
    add(source, target);
    // Everyone in a "followed by" list is someone the logged user follows (that is what
    // the list is), so they also get  me -> them. Only follower -> me links point at me.
    if (target !== me) add(me, source);
  }
  return {
    metadata: {
      loggedUsername: state.viewer.username,
      generatedBy: 'ig-social-graph-extension',
      lastRun: new Date(state.updatedAt).toISOString(),
      complete: state.phase === 'done',
      ...progress(state),
    },
    username: state.viewer.username,
    nodes: Object.keys(state.nodes).map((id) => ({ id, group: 1 })),
    links,
  };
}

// ---- Time left -------------------------------------------------------------------
// The estimate comes from the pace measured so far: crawl time (running or waiting out
// Instagram's slowdowns, not user pauses) per follower checked. That way cooldowns and
// followers that need several pages are in it. Until enough followers are checked, it
// falls back to the floor: remaining followers x delay.

const MIN_SAMPLE = 5;

// Call on every save. Counts time while running or cooling down.
export function tickClock(state, now = Date.now()) {
  const counting = state.status === STATUS.RUNNING || state.status === STATUS.COOLDOWN;
  if (state.clock?.counting) state.activeMs = (state.activeMs || 0) + (now - state.clock.last);
  state.clock = { last: now, counting };
  // Pace is measured from the first moment of the mutuals phase this clock saw (crawls
  // started before this existed begin measuring mid-way).
  if (state.phase === 'mutuals' && !state.paceBase) {
    state.paceBase = { activeMs: state.activeMs || 0, done: progress(state).done };
  }
}

export function estimateRemaining(state) {
  if (state.update) return estimateUpdate(state);
  const { done, total } = progress(state);
  const target = state.settings.maxFollowers ? Math.min(state.settings.maxFollowers, total) : total;
  const remaining = Math.max(0, target - done);
  const floorMs = remaining * state.settings.delaySec * 1000;
  const base = state.paceBase;
  const sampled = base ? done - base.done : 0;
  if (sampled < MIN_SAMPLE) return { ms: floorMs, measured: false };
  const perFollower = ((state.activeMs || 0) - base.activeMs) / sampled;
  return { ms: Math.max(floorMs, remaining * perFollower), measured: true };
}

// Same idea for an update: its own pace once it has one, the crawl's before that, and
// the floor when neither exists. The listing stage counts as one request per 50.
function estimateUpdate(state) {
  const u = state.update;
  const delayMs = state.settings.delaySec * 1000;
  const known = Object.keys(state.followers).length;
  const listing = u.stage === 'followers';
  const toList = listing ? Math.max(0, known - u.seen.length) : 0;
  const remaining = listing ? Math.min(known, state.settings.maxFollowers || Infinity) : u.queue.length - u.pos;
  const listMs = Math.ceil(toList / 50) * delayMs;
  const floorMs = listMs + remaining * delayMs;
  const sampled = u.paceBase ? u.pos - u.paceBase.pos : 0;
  const pace = sampled >= MIN_SAMPLE ? ((state.activeMs || 0) - u.paceBase.activeMs) / sampled : u.priorPace;
  if (!pace) return { ms: floorMs, measured: false };
  return { ms: Math.max(floorMs, listMs + remaining * pace), measured: true };
}

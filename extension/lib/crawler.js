// Crawl logic, kept free of chrome.* so it can be tested with a fake API.
//
// Graph semantics (same as the old bookmarklet):
//   - every account that follows the logged user gets a link  follower -> me
//   - for every such follower F, Instagram's "followed by" list (accounts *I* follow
//     that also follow F) gives links  M -> F
// One request per page; the caller sleeps between steps.

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

function addLink(state, source, target) {
  state.nodes[source] = true;
  state.nodes[target] = true;
  state.links.push([source, target]);
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

  if (state.phase === 'followers') {
    const params = new URLSearchParams({ count: '50', search_surface: 'follow_list_page' });
    if (state.followersCursor) params.set('max_id', state.followersCursor);
    const res = await api.get(`/api/v1/friendships/${state.viewer.pk}/followers/?${params}`);
    state.requests++;
    const verdict = classify(res);
    if (verdict.kind !== 'ok') return handleNotOk(state, verdict, () => {});

    for (const user of res.json.users || []) {
      const pk = String(user.pk || user.id);
      if (!state.followers[pk]) {
        state.followers[pk] = { username: user.username, done: false };
        state.order.push(pk);
      }
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
    const params = new URLSearchParams();
    if (cursor) params.set('max_id', cursor);
    const qs = params.toString();
    const res = await api.get(`/api/v1/friendships/${pk}/mutual_followers/${qs ? `?${qs}` : ''}`);
    state.requests++;
    const verdict = classify(res);
    if (verdict.kind !== 'ok') {
      return handleNotOk(state, verdict, () => {
        state.followers[pk].done = true;
        state.current = null;
      });
    }

    for (const user of res.json.users || []) addLink(state, user.username, target);
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

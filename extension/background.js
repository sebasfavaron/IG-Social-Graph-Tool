import { IG_APP_ID, STATUS, estimateRemaining, initialState, progress, startProfileRefresh, step, tickClock } from './lib/crawler.js';

// The service worker owns the crawl state; popup and viewer only send messages.
// Requests are made from inside an instagram.com tab (chrome.scripting) so they carry
// the user's session exactly like the site's own requests. Pacing lives here, not in
// the tab, because Chrome throttles timers in hidden tabs to one per minute.

const STORAGE_KEY = 'crawl';
const THUMBS_KEY = 'thumbs'; // username -> { src, data }: small copies of profile photos
const IG_ORIGIN = 'https://www.instagram.com';
const COOLDOWN_BASE_MIN = 15;
const COOLDOWN_MAX_MIN = 120;

let state = null;
let loaded = null;
let looping = false;
let wakeSleep = null;
let igTabId = null;

function load() {
  loaded ??= chrome.storage.local.get(STORAGE_KEY).then((r) => {
    state = r[STORAGE_KEY] || null;
  });
  return loaded;
}

async function save() {
  if (state) {
    state.updatedAt = Date.now();
    tickClock(state, state.updatedAt);
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  await updateBadge();
}

async function updateBadge() {
  if (!state) return chrome.action.setBadgeText({ text: '' });
  const { total, done } = progress(state);
  const text =
    state.status === STATUS.RUNNING
      ? state.phase === 'followers'
        ? '…'
        : `${total ? Math.floor((100 * done) / total) : 0}%`
      : { cooldown: 'zz', error: '!', done: '✓', paused: '❚❚' }[state.status] || '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({
    color: state.status === STATUS.ERROR ? '#c62828' : '#555',
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    wakeSleep = () => {
      clearTimeout(t);
      resolve();
    };
  });
}

// ---- Instagram tab + requests -------------------------------------------------

// Runs inside the instagram.com tab (isolated world, same origin as the page).
async function igGet(path, appId) {
  const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1];
  const headers = { 'x-ig-app-id': appId, 'x-requested-with': 'XMLHttpRequest' };
  if (csrf) headers['x-csrftoken'] = csrf;
  try {
    const claim = sessionStorage.getItem('www-claim-v2');
    if (claim) headers['x-ig-www-claim'] = claim;
  } catch (_) {}
  const res = await fetch(path, { headers, credentials: 'include' });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  return { status: res.status, url: res.url, json, snippet: json ? null : text.slice(0, 200) };
}

async function getIgTab() {
  if (igTabId !== null) {
    try {
      const tab = await chrome.tabs.get(igTabId);
      if (tab.url?.startsWith(IG_ORIGIN) && !tab.discarded) return igTabId;
    } catch (_) {}
  }
  const tabs = await chrome.tabs.query({ url: `${IG_ORIGIN}/*` });
  let tab = tabs.find((t) => !t.discarded && t.status === 'complete') || tabs[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url: `${IG_ORIGIN}/`, active: false });
    await new Promise((resolve) => {
      const listener = (id, info) => {
        if (id === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  // Keep Memory Saver from discarding the tab mid-crawl.
  await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  igTabId = tab.id;
  return igTabId;
}

const api = {
  async get(path) {
    const tabId = await getIgTab();
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: igGet,
      args: [path, IG_APP_ID],
    });
    if (!result || result.result === undefined) throw new Error('Script injection returned nothing');
    return result.result;
  },
};

async function detectViewer() {
  const cookie = await chrome.cookies.get({ url: IG_ORIGIN, name: 'ds_user_id' });
  if (!cookie?.value) throw new Error('Not logged in to instagram.com in this browser.');
  const pk = cookie.value;

  // The page already knows who is logged in; reading it costs no request.
  const [fromPage] = await chrome.scripting.executeScript({
    target: { tabId: await getIgTab() },
    func: readUsernameFromPage,
    args: [pk],
  });
  if (fromPage?.result) return { pk, username: fromPage.result };

  // The app endpoints below answer "useragent mismatch" to some browsers, hence several.
  const tried = ['page'];
  for (const [path, pick] of [
    ['/api/v1/accounts/edit/web_form_data/', (j) => j?.form_data?.username],
    [`/api/v1/users/${pk}/info/`, (j) => j?.user?.username],
    ['/api/v1/accounts/current_user/?edit=true', (j) => j?.user?.username],
  ]) {
    const res = await api.get(path);
    const username = pick(res.json);
    if (username) return { pk, username };
    const why = res.json?.message || res.snippet?.replace(/\s+/g, ' ').slice(0, 60) || '';
    tried.push(`${path.split('?')[0]} → ${res.status} ${why}`.trim());
  }
  throw new Error(`Logged in, but could not read your username. Tried: ${tried.join('; ')}`);
}

// Runs inside the instagram.com tab. The page's inline JSON carries the viewer as
// {"pk":"<id>",...,"username":"<name>"} (key order varies); the sidebar's profile
// link, the only nav link with an avatar, is the fallback.
function readUsernameFromPage(pk) {
  const html = document.documentElement.innerHTML;
  const id = `"(?:pk|id|pk_id|viewerId)":"?${pk}"?`;
  const name = '"username":"([A-Za-z0-9._]{1,30})"';
  const match =
    html.match(new RegExp(`${id}[^{}]{0,500}?${name}`)) ||
    html.match(new RegExp(`${name}[^{}]{0,500}?${id}`));
  if (match) return match[1];
  const avatarLink = [...document.querySelectorAll('nav a[href], [role="navigation"] a[href]')].find(
    (a) => a.querySelector('img') && /^\/[A-Za-z0-9._]{1,30}\/$/.test(a.getAttribute('href'))
  );
  return avatarLink ? avatarLink.getAttribute('href').slice(1, -1) : null;
}

// ---- Profile photos ---------------------------------------------------------------
// Instagram's photo URLs are signed and expire within days, so the viewer gets a copy:
// the 150 px photo the lists link to, as a data URL (~6 KB each), in its own storage key,
// away from the crawl state that is rewritten after every request. (Copies were 64 px at
// first; those are fetched again at full size, keeping the small one if that fails.) They come from Instagram's CDN, not its API, so
// they do not count against the crawl's pacing; a few at a time is still polite.
const THUMB_PX = 150;
const THUMB_CONCURRENCY = 3;
let thumbing = false;
let thumbs = null; // kept in memory: the crawl loop asks for missing photos after every step

async function makeThumb(src) {
  const res = await fetch(src, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  // already small and square (the lists' usual 150 px): kept as Instagram made it
  if (bitmap.width === bitmap.height && bitmap.width <= THUMB_PX * 1.1 && /jpeg|webp/.test(blob.type)) {
    bitmap.close();
    return toDataUrl(blob);
  }
  const canvas = new OffscreenCanvas(THUMB_PX, THUMB_PX);
  const ctx = canvas.getContext('2d');
  // centre square crop (photos are square already, but not guaranteed)
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, THUMB_PX, THUMB_PX);
  bitmap.close();
  return toDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 }));
}

async function toDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

// One person's photo at full size, for the viewer's enlarged photo. The lists only carry a
// 150 px version, so this asks Instagram for the profile (one request, only when someone
// taps a photo) and falls back to the list's URL if that does not answer.
async function largePhoto(username) {
  const candidates = [];
  try {
    const res = await api.get(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`);
    const user = res.json?.data?.user;
    if (user?.profile_pic_url_hd) candidates.push(user.profile_pic_url_hd);
    if (user?.profile_pic_url) candidates.push(user.profile_pic_url);
  } catch (_) {}
  if (state?.profiles?.[username]?.pic) candidates.push(state.profiles[username].pic);
  for (const src of candidates) {
    try {
      const res = await fetch(src, { credentials: 'omit' });
      if (res.ok) return toDataUrl(await res.blob());
    } catch (_) {}
  }
  throw new Error('no larger photo available');
}

// Downloads the photos still missing or smaller than THUMB_PX. A URL that failed once is
// not retried until a profile refresh brings a new one.
async function downloadThumbs() {
  await load();
  if (thumbing || !state?.profiles) return;
  thumbing = true;
  try {
    thumbs ??= (await chrome.storage.local.get(THUMBS_KEY))[THUMBS_KEY] || {};
    const todo = Object.entries(state.profiles).filter(([username, p]) => {
      const t = thumbs[username];
      return p.pic && t?.failed !== p.pic && (!t?.data || (t.px || 64) < THUMB_PX);
    });
    let sinceSave = 0;
    const worker = async () => {
      for (let item; (item = todo.shift()); ) {
        const [username, { pic }] = item;
        try {
          thumbs[username] = { src: pic, data: await makeThumb(pic), px: THUMB_PX };
        } catch (_) {
          // keep a smaller copy if there is one; remember the URL that failed
          thumbs[username] = { ...thumbs[username], src: pic, failed: pic };
        }
        if (++sinceSave >= 25) {
          sinceSave = 0;
          await chrome.storage.local.set({ [THUMBS_KEY]: thumbs });
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    };
    if (!todo.length) return;
    await Promise.all(Array.from({ length: THUMB_CONCURRENCY }, worker));
    await chrome.storage.local.set({ [THUMBS_KEY]: thumbs });
  } finally {
    thumbing = false;
  }
}

// ---- Crawl loop -----------------------------------------------------------------

const FATAL_MESSAGES = {
  logged_out: 'Instagram says you are logged out. Log in on instagram.com, then Resume.',
  checkpoint: 'Instagram wants you to confirm it is you. Open instagram.com, complete the check, then Resume.',
};

async function runLoop() {
  await load();
  if (looping) return;
  looping = true;
  try {
    while (state?.status === STATUS.RUNNING) {
      const crawl = state;
      let result;
      try {
        result = await step(crawl, api);
      } catch (err) {
        igTabId = null; // tab closed or navigated away; find/open another one next time
        crawl.error = String(err?.message || err);
        result = { wait: crawl.settings.delaySec * 2000 };
      }
      if (state !== crawl) break; // reset while the request was in flight
      if (state.status !== STATUS.RUNNING) {
        await save(); // paused mid-request: keep what the request brought in
        break;
      }

      if (result.done) {
        state.status = STATUS.DONE;
        state.error = null;
        downloadThumbs();
      } else if (result.fatal) {
        state.status = STATUS.ERROR;
        state.error = FATAL_MESSAGES[result.fatal] || result.fatal;
      } else if (result.cooldown) {
        const minutes = Math.min(COOLDOWN_BASE_MIN * 2 ** state.cooldowns, COOLDOWN_MAX_MIN);
        state.cooldowns++;
        state.status = STATUS.COOLDOWN;
        state.cooldownUntil = Date.now() + minutes * 60_000;
        state.error = `Instagram asked us to slow down. Resuming automatically in ${minutes} min.`;
        chrome.alarms.create('cooldown', { when: state.cooldownUntil });
      } else if (result.wait) {
        // jitter so the requests do not tick like a metronome
        await save();
        // the followers list is in: their photos can come down while the crawl goes on
        if (state.phase !== 'followers' && !state.refresh) downloadThumbs();
        await sleep(result.wait * (0.75 + Math.random() * 0.5));
        continue;
      }
      await save();
    }
  } finally {
    looping = false;
  }
}

async function setStatus(status) {
  if (!state) return;
  state.status = status;
  if (status !== STATUS.COOLDOWN) chrome.alarms.clear('cooldown');
  await save();
  wakeSleep?.();
  if (status === STATUS.RUNNING) runLoop();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await load();
  if (!state) return;
  // The watchdog also ends an expired cooldown: Chrome can drop the 'cooldown' alarm when
  // the extension is reloaded or updated, which left the crawl waiting forever.
  const cooldownOver = state.status === STATUS.COOLDOWN && Date.now() >= (state.cooldownUntil || 0);
  if (state.status === STATUS.COOLDOWN && (alarm.name === 'cooldown' || cooldownOver)) {
    state.error = null;
    await setStatus(STATUS.RUNNING);
  }
  // The worker can be stopped between steps; the watchdog picks the crawl back up.
  if (alarm.name === 'watchdog' && state.status === STATUS.RUNNING && !looping) runLoop();
  // ...and the photo downloads, which a stopped worker leaves half done
  if (alarm.name === 'watchdog' && state.phase !== 'followers') downloadThumbs();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('watchdog', { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('watchdog', { periodInMinutes: 0.5 });
  load().then(() => state?.status === STATUS.RUNNING && runLoop());
});

// ---- Messages from popup / viewer ----------------------------------------------

function summary() {
  if (!state) return null;
  return {
    status: state.status,
    viewer: state.viewer,
    phase: state.phase,
    settings: state.settings,
    error: state.error,
    cooldownUntil: state.cooldownUntil,
    requests: state.requests,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    remaining: estimateRemaining(state),
    refreshing: !!state.refresh,
    profiles: Object.keys(state.profiles || {}).length,
    ...progress(state),
  };
}

const handlers = {
  async getState() {
    return summary();
  },
  async start({ settings }) {
    const viewer = await detectViewer();
    state = initialState(viewer, settings);
    await setStatus(STATUS.RUNNING);
    return summary();
  },
  async resume({ settings }) {
    if (!state) throw new Error('Nothing to resume.');
    if (settings) state.settings = { ...state.settings, ...settings };
    state.error = null;
    if (state.phase === 'done' && state.settings.maxFollowers) state.phase = 'mutuals'; // limit was raised
    await setStatus(STATUS.RUNNING);
    return summary();
  },
  // Real names and photos for a crawl made before they were kept: the followers list
  // again (one request per 50), then the photos.
  async refreshProfiles() {
    if (!state) throw new Error('Nothing to refresh.');
    startProfileRefresh(state);
    state.error = null;
    await setStatus(STATUS.RUNNING);
    return summary();
  },
  async profilePhoto({ username }) {
    return largePhoto(username);
  },
  async pause() {
    await setStatus(STATUS.PAUSED);
    return summary();
  },
  async reset() {
    if (state) state.status = STATUS.IDLE;
    wakeSleep?.();
    state = null;
    thumbs = {};
    chrome.alarms.clear('cooldown');
    await chrome.storage.local.remove([STORAGE_KEY, THUMBS_KEY]);
    await updateBadge();
    return null;
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  load()
    .then(() => handler(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

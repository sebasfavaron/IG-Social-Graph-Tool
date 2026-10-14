import { IG_APP_ID, STATUS, initialState, progress, step } from './lib/crawler.js';

// The service worker owns the crawl state; popup and viewer only send messages.
// Requests are made from inside an instagram.com tab (chrome.scripting) so they carry
// the user's session exactly like the site's own requests. Pacing lives here, not in
// the tab, because Chrome throttles timers in hidden tabs to one per minute.

const STORAGE_KEY = 'crawl';
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
  if (state) state.updatedAt = Date.now();
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
  for (const path of [`/api/v1/users/${pk}/info/`, '/api/v1/accounts/current_user/?edit=true']) {
    const res = await api.get(path);
    const username = res.json?.user?.username;
    if (username) return { pk, username };
  }
  throw new Error('Logged in, but could not read your username from Instagram.');
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
  if (alarm.name === 'cooldown' && state.status === STATUS.COOLDOWN) {
    state.error = null;
    await setStatus(STATUS.RUNNING);
  }
  // The worker can be stopped between steps; the watchdog picks the crawl back up.
  if (alarm.name === 'watchdog' && state.status === STATUS.RUNNING && !looping) runLoop();
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
  async pause() {
    await setStatus(STATUS.PAUSED);
    return summary();
  },
  async reset() {
    if (state) state.status = STATUS.IDLE;
    wakeSleep?.();
    state = null;
    chrome.alarms.clear('cooldown');
    await chrome.storage.local.remove(STORAGE_KEY);
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

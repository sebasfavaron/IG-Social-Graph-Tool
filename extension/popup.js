import { SHARE_BASE_URL } from './lib/share.js';
import { lang, langButton, t, translateStatic } from './lib/i18n.js';
import { formatDuration } from './lib/format.js';

const $ = (id) => document.getElementById(id);

async function send(type, extra = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...extra });
  if (!res?.ok) throw new Error(res?.error || 'No response from the extension.');
  return res.data;
}

function settings() {
  return {
    delaySec: Math.max(2, Number($('delay').value) || 6),
    maxFollowers: Math.max(0, Number($('max').value) || 0),
  };
}

const STATUS_TEXT = {
  running: (s) => t(s.refreshing ? 'p.fetchingProfiles' : s.phase === 'followers' ? 'p.listing' : 'p.checking'),
  paused: () => t('p.paused'),
  cooldown: (s) => t('p.cooldown', new Date(s.cooldownUntil).toLocaleTimeString(lang)),
  done: () => t('p.done'),
  error: () => t('p.stopped'),
};

let settingsTouched = false;
let loggedIn = true; // until the cookie says otherwise

async function checkLogin() {
  const cookie = await chrome.cookies.get({ url: 'https://www.instagram.com', name: 'ds_user_id' });
  loggedIn = !!cookie?.value;
}

let last = null; // the state as last drawn, to draw again in another language
function render(s) {
  last = s;
  const has = !!s;
  $('status').textContent = has
    ? STATUS_TEXT[s.status]?.(s) || s.status
    : loggedIn
      ? t('p.pitch')
      : t('p.logInFirst');
  $('login').hidden = has || loggedIn;
  $('intro').hidden = has;
  $('stats').hidden = !has;
  $('start').hidden = (has && s.status !== 'done') || (!has && !loggedIn);
  $('start').textContent = has ? t('p.startOver') : t('p.start');
  $('resume').hidden = !has || !['paused', 'error', 'cooldown'].includes(s.status);
  $('pause').hidden = !has || !['running', 'cooldown'].includes(s.status);
  // crawls made before names and photos were kept have none; a worker older than this
  // popup sends no count at all, so the button stays hidden for it
  $('profiles').hidden = !has || s.status !== 'done' || s.profiles === undefined;
  $('profiles').textContent = s?.profiles ? t('p.refreshProfiles') : t('p.getProfiles');
  $('view').disabled = !has || s.links === 0;
  $('error').hidden = !s?.error || s.status === 'running';
  $('error').textContent = s?.error || '';
  $('error').style.color = s?.status === 'cooldown' ? 'var(--muted)' : '';
  if (!has) {
    $('bar').style.width = '0';
    return;
  }

  const target = s.settings.maxFollowers ? Math.min(s.settings.maxFollowers, s.total) : s.total;
  $('viewer').textContent = `@${s.viewer.username}`;
  $('checked').textContent = s.phase === 'followers' ? t('p.listingCount', s.total) : `${s.done} / ${target}`;
  $('links').textContent = s.links.toLocaleString();
  $('requests').textContent = s.requests.toLocaleString();
  // measured: from the pace so far, Instagram's slowdowns included; otherwise only a floor
  // A worker started before the update sends no estimate (Chrome keeps the old worker
  // running until the extension is reloaded, while the popup is read fresh each time).
  const { ms, measured } = s.remaining || {
    ms: Math.max(0, target - s.done) * s.settings.delaySec * 1000,
    measured: false,
  };
  $('eta').textContent =
    s.status === 'done' ? '—' : s.phase === 'followers' ? '…' : measured ? `~${formatDuration(ms)}` : t('p.atLeast', formatDuration(ms));
  $('eta').title = measured ? t('p.measuredTitle') : t('p.floorTitle');
  $('bar').style.width = s.phase === 'followers' ? '3%' : `${target ? (100 * s.done) / target : 0}%`;

  if (!settingsTouched) {
    $('delay').value = s.settings.delaySec;
    $('max').value = s.settings.maxFollowers;
  }
}

async function act(fn) {
  try {
    render(await fn());
  } catch (err) {
    $('error').hidden = false;
    $('error').textContent = err.message;
  }
}

$('delay').oninput = $('max').oninput = () => (settingsTouched = true);
$('start').onclick = () => {
  if (last && !confirm(t('p.confirmRestart'))) return;
  act(() => send('start', { settings: settings() }));
};
$('resume').onclick = () => act(() => send('resume', { settings: settings() }));
$('pause').onclick = () => act(() => send('pause'));
$('profiles').onclick = () => act(() => send('refreshProfiles'));
$('reset').onclick = () => {
  if (confirm(t('p.confirmReset'))) act(() => send('reset'));
};
$('login').onclick = () => chrome.tabs.create({ url: 'https://www.instagram.com/' });
$('guide').onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
};
// Viewing, publishing and the network all live on the site, which reads this crawl
// through the extension's bridge (bridge.js): new features ship with the site, and the
// extension only needs updating when the crawler itself changes.
$('view').onclick = () => chrome.tabs.create({ url: SHARE_BASE_URL });

chrome.storage.onChanged.addListener(() => act(() => send('getState')));
chrome.cookies.onChanged.addListener(({ cookie }) => {
  if (cookie.name === 'ds_user_id') checkLogin().then(() => act(() => send('getState')));
});
// Spanish by default; the EN/ES button switches it, shared with the extension's viewer
document.documentElement.lang = lang;
translateStatic();
langButton($('lang'), () => {
  translateStatic();
  render(last);
});
checkLogin().then(() => act(() => send('getState')));

// A folder-loaded extension never updates itself. The site publishes the version its zip
// holds (pages.yml); when that is newer, a download button appears next to EN/ES.
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
fetch(SHARE_BASE_URL + 'version.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .then((site) => {
    if (site?.version && newer(site.version, chrome.runtime.getManifest().version)) $('update').hidden = false;
  })
  .catch(() => {}); // offline, or the site is down: no button
$('update').onclick = () => chrome.tabs.create({ url: SHARE_BASE_URL + 'ig-social-graph.zip' });

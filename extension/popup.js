import { SHARE_BASE_URL } from './lib/share.js';
import { me } from './lib/store.js';
import { lang, langButton, t, translateStatic, why } from './lib/i18n.js';
import { barWidth, checkedText, errorText, statusText } from './lib/crawlStatus.js';

// The popup only says how the crawl is going and opens the site, where it is started,
// paused and looked at (lib/crawlPanel.js, through bridge.js): what changes there ships
// with the site, without updating the extension. Deleting the data stays here, out of
// any web page's reach.

const $ = (id) => document.getElementById(id);

async function send(type, extra = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...extra });
  if (!res?.ok) throw new Error(res?.error || 'No response from the extension.');
  return res.data;
}

let last = null; // the state as last drawn, to draw again in another language
function render(s) {
  last = s;
  // one line: "Revisando quién sigue a quién… · 359 / 524"
  $('status').textContent = s ? (s.status === 'done' ? statusText(s) : `${statusText(s)} · ${checkedText(s)}`) : t('p.startOnSite');
  $('bar').style.width = s ? barWidth(s) : '0';
  const error = s ? errorText(s) : '';
  $('error').hidden = !error;
  $('error').textContent = error;
}

async function act(fn) {
  try {
    render(await fn());
  } catch (err) {
    $('error').hidden = false;
    $('error').textContent = why(err.message);
  }
}

$('reset').onclick = () => {
  if (confirm(t('p.confirmReset'))) act(() => send('reset'));
};
// Graphs published before 2.3.0 were published from the extension's own page, whose key
// is kept here (this origin's localStorage). It is left where the bridge can hand it to the
// site (bridge.js legacyKey), never in a link: links end up in the browser's history. The
// site only takes it over a key of its own when the database says the old one is stale.
function legacyKey() {
  try {
    const who = me();
    if (who) return who;
    // published before the browser remembered whose it was: the one key there is
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('ownerKey:'));
    if (keys.length === 1) return { owner: keys[0].slice('ownerKey:'.length), key: localStorage.getItem(keys[0]) };
  } catch (_) {}
  return null;
}
const legacy = legacyKey();
if (legacy) chrome.storage.local.set({ legacyKey: legacy });
$('view').onclick = () => chrome.tabs.create({ url: SHARE_BASE_URL });

chrome.storage.onChanged.addListener(() => act(() => send('getState')));
// Spanish by default; the EN/ES button switches it, shared with the site
document.documentElement.lang = lang;
translateStatic();
langButton($('lang'), () => {
  translateStatic();
  render(last);
});
act(() => send('getState'));

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

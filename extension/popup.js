import { toGraph } from './lib/crawler.js';
import { SHARE_BASE_URL, buildHash, encodeGraph } from './lib/share.js';
import { photosFromThumbs } from './lib/vault.js';
import { saveGraph } from './lib/store.js';
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
  running: (s) =>
    s.refreshing ? 'Fetching names and photos…' : s.phase === 'followers' ? 'Listing your followers…' : 'Checking who follows whom…',
  paused: () => 'Paused.',
  cooldown: (s) => `Waiting for Instagram — resumes at ${new Date(s.cooldownUntil).toLocaleTimeString()}.`,
  done: () => 'Done.',
  error: () => 'Stopped.',
};

let settingsTouched = false;
let loggedIn = true; // until the cookie says otherwise

async function checkLogin() {
  const cookie = await chrome.cookies.get({ url: 'https://www.instagram.com', name: 'ds_user_id' });
  loggedIn = !!cookie?.value;
}

function render(s) {
  const has = !!s;
  $('status').textContent = has
    ? STATUS_TEXT[s.status]?.(s) || s.status
    : loggedIn
      ? 'Maps who among your followers know each other. It takes about an hour per 500 followers, and runs on its own.'
      : 'Log in to Instagram in this browser first. It uses your own session.';
  $('login').hidden = has || loggedIn;
  $('intro').hidden = has;
  $('stats').hidden = !has;
  $('start').hidden = (has && s.status !== 'done') || (!has && !loggedIn);
  $('start').textContent = has ? 'Start over' : 'Start';
  $('resume').hidden = !has || !['paused', 'error', 'cooldown'].includes(s.status);
  $('pause').hidden = !has || !['running', 'cooldown'].includes(s.status);
  // crawls made before names and photos were kept have none; a worker older than this
  // popup sends no count at all, so the button stays hidden for it
  $('profiles').hidden = !has || s.status !== 'done' || s.profiles === undefined;
  $('profiles').textContent = s?.profiles ? 'Refresh names & photos' : 'Get names & photos';
  $('view').disabled = $('share').disabled = !has || s.links === 0;
  $('error').hidden = !s?.error || s.status === 'running';
  $('error').textContent = s?.error || '';
  $('error').style.color = s?.status === 'cooldown' ? 'var(--muted)' : '';
  if (!has) {
    $('bar').style.width = '0';
    return;
  }

  const target = s.settings.maxFollowers ? Math.min(s.settings.maxFollowers, s.total) : s.total;
  $('viewer').textContent = `@${s.viewer.username}`;
  $('checked').textContent = s.phase === 'followers' ? `listing… ${s.total}` : `${s.done} / ${target}`;
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
    s.status === 'done' ? '—' : s.phase === 'followers' ? '…' : `${measured ? '~' : 'at least '}${formatDuration(ms)}`;
  $('eta').title = measured
    ? 'From the pace so far, including the times Instagram made the crawl wait.'
    : 'Not enough followers checked yet to measure the pace; this is the minimum at the current delay.';
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
  if ($('start').textContent === 'Start over' && !confirm('Discard the current graph and crawl again?')) return;
  act(() => send('start', { settings: settings() }));
};
$('resume').onclick = () => act(() => send('resume', { settings: settings() }));
$('pause').onclick = () => act(() => send('pause'));
$('profiles').onclick = () => act(() => send('refreshProfiles'));
$('reset').onclick = () => {
  if (confirm('Delete everything collected so far?')) act(() => send('reset'));
};
$('login').onclick = () => chrome.tabs.create({ url: 'https://www.instagram.com/' });
$('guide').onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
};
$('view').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
// Same kind of link the viewer's button makes: the crawl and its people's names and
// photos go to the shared storage (store.js), and the link is just the username,
// opening on the public page (loners included; the viewer hides them).
$('share').onclick = async () => {
  const label = $('share').textContent;
  let url;
  try {
    $('share').disabled = true;
    $('share').textContent = 'Uploading…';
    const { crawl, thumbs } = await chrome.storage.local.get(['crawl', 'thumbs']);
    const graph = toGraph(crawl);
    const owner = graph.username || graph.metadata?.loggedUsername;
    if (!owner) throw new Error('the crawl does not say whose graph it is');
    await saveGraph({
      owner,
      g: await encodeGraph(graph),
      ids: new Set(graph.nodes.map((n) => n.id)),
      profiles: crawl.profiles,
      photos: photosFromThumbs(thumbs),
    });
    url = SHARE_BASE_URL + buildHash({ o: owner });
  } catch (err) {
    $('error').hidden = false;
    $('error').textContent = `Could not share: ${err.message}.`;
    $('share').textContent = label;
    return;
  } finally {
    $('share').disabled = false;
  }
  try {
    await navigator.clipboard.writeText(url);
    $('share').textContent = 'Link copied';
  } catch (_) {
    prompt('Copy this link:', url);
  }
  setTimeout(() => ($('share').textContent = label), 2500);
};

chrome.storage.onChanged.addListener(() => act(() => send('getState')));
chrome.cookies.onChanged.addListener(({ cookie }) => {
  if (cookie.name === 'ds_user_id') checkLogin().then(() => act(() => send('getState')));
});
checkLogin().then(() => act(() => send('getState')));

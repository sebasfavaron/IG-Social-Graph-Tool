import { formatDuration } from './lib/format.js';

// Opened once, right after the extension is installed (background.js). Walks someone
// who has never seen the popup through pinning the icon, logging in and starting.

const $ = (id) => document.getElementById(id);
const IG_ORIGIN = 'https://www.instagram.com';

async function send(type, extra = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...extra });
  if (!res?.ok) throw new Error(res?.error || 'No response from the extension.');
  return res.data;
}

// Chrome has no event for pinning, so this asks every second while the step is open.
async function checkPinned() {
  const settings = await chrome.action.getUserSettings?.().catch(() => null);
  const pinned = !!settings?.isOnToolbar;
  $('pin-step').classList.toggle('done', pinned);
  if (!pinned) setTimeout(checkPinned, 1000);
}

let loggedIn = false;
async function checkLogin() {
  const cookie = await chrome.cookies.get({ url: IG_ORIGIN, name: 'ds_user_id' });
  loggedIn = !!cookie?.value;
  $('login-step').classList.toggle('done', loggedIn);
  $('start').disabled = !loggedIn;
  $('start-hint').hidden = loggedIn;
}

const STATUS_TEXT = {
  running: (s) => (s.phase === 'followers' ? 'Listing your followers…' : 'Checking who follows whom…'),
  paused: () => 'Paused. Press Resume in the extension icon to carry on.',
  cooldown: (s) => `Instagram asked for a break. It carries on by itself at ${new Date(s.cooldownUntil).toLocaleTimeString()}.`,
  done: () => 'Done! Your graph is ready.',
  error: () => 'It stopped.',
};

function render(s) {
  $('before').hidden = !!s;
  $('during').hidden = !s;
  $('start-step').classList.toggle('done', s?.status === 'done');
  if (!s) return;
  const target = s.settings.maxFollowers ? Math.min(s.settings.maxFollowers, s.total) : s.total;
  $('status').textContent = STATUS_TEXT[s.status]?.(s) || s.status;
  $('bar').style.width = s.phase === 'followers' ? '3%' : `${target ? (100 * s.done) / target : 0}%`;
  $('eta').textContent =
    s.status === 'done'
      ? `${target} followers checked.`
      : s.phase === 'followers'
        ? `${s.total} followers found so far.`
        : `${s.done} of ${target} followers checked` +
          (s.remaining?.measured ? `, about ${formatDuration(s.remaining.ms)} left.` : '.');
  $('error').hidden = !s.error || s.status === 'running' || s.status === 'cooldown';
  $('error').textContent = s.error || '';
  $('close-hint').hidden = s.status === 'done';
  $('view').hidden = !s.links;
  $('view').textContent = s.status === 'done' ? 'See your graph' : 'See your graph so far';
}

async function refresh() {
  try {
    render(await send('getState'));
  } catch (err) {
    $('error').hidden = false;
    $('error').textContent = err.message;
  }
}

$('open-ig').onclick = () => chrome.tabs.create({ url: IG_ORIGIN + '/' });
$('start').onclick = async () => {
  $('start').disabled = true;
  try {
    render(await send('start', { settings: {} }));
  } catch (err) {
    $('start').disabled = false;
    $('start-hint').hidden = false;
    $('start-hint').textContent = err.message;
  }
};
$('view').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });

chrome.cookies.onChanged.addListener(({ cookie }) => {
  if (cookie.name === 'ds_user_id' && cookie.domain.endsWith('instagram.com')) checkLogin();
});
chrome.storage.onChanged.addListener((changes) => changes.crawl && refresh());

checkPinned();
checkLogin();
refresh();

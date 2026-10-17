import { formatDuration } from './lib/format.js';
import { lang, langButton, t, translateStatic, why } from './lib/i18n.js';
import { ask, hasBridge, onLocalChange } from './lib/bridge.js';
import { target } from './lib/crawlStatus.js';

// Opened once, right after the extension is installed (background.js). Walks someone
// who has never seen the extension through pinning the icon, logging in and starting.
// It is the site's page, talking to the extension through its bridge (bridge.js), so it
// can change without an update.

const $ = (id) => document.getElementById(id);
const IG_ORIGIN = 'https://www.instagram.com';

// Chrome has no event for pinning or logging in, so this asks every second and a half
// until both are done.
async function checkEnv() {
  const env = await ask('env').catch(() => null);
  const pinned = env?.pinned ?? true; // unknown: skip the step rather than stick on it
  const loggedIn = env?.loggedIn ?? false;
  $('pin-step').classList.toggle('done', pinned);
  $('login-step').classList.toggle('done', loggedIn);
  $('start').disabled = !loggedIn;
  $('start-hint').hidden = loggedIn;
  if (!pinned || !loggedIn) setTimeout(checkEnv, 1500);
}

const STATUS_TEXT = {
  running: (s) => t(s.phase === 'followers' ? 'w.listing' : 'w.checking'),
  paused: () => t('w.paused'),
  cooldown: (s) => t('w.cooldown', new Date(s.cooldownUntil).toLocaleTimeString(lang)),
  done: () => t('w.done'),
  error: () => t('w.stopped'),
};

let last = null; // the state as last drawn, to draw again in another language
function render(s) {
  last = s;
  $('before').hidden = !!s;
  $('during').hidden = !s;
  $('start-step').classList.toggle('done', s?.status === 'done');
  if (!s) return;
  const all = target(s);
  $('status').textContent = STATUS_TEXT[s.status]?.(s) || s.status;
  $('bar').style.width = s.phase === 'followers' ? '3%' : `${all ? (100 * s.done) / all : 0}%`;
  $('eta').textContent =
    s.status === 'done'
      ? t('w.checkedAll', all)
      : s.phase === 'followers'
        ? t('w.found', s.total)
        : t('w.progress', s.done, all) + (s.remaining?.measured ? t('w.left', formatDuration(s.remaining.ms)) : '.');
  $('error').hidden = !s.error || s.status === 'running' || s.status === 'cooldown';
  $('error').textContent = why(s.error || '');
  $('close-hint').hidden = s.status === 'done';
  $('view').hidden = !s.links;
  $('view').textContent = t(s.status === 'done' ? 'w.see' : 'w.seeSoFar');
}

async function refresh() {
  try {
    render(await ask('getState'));
  } catch (err) {
    $('error').hidden = false;
    $('error').textContent = why(err.message);
  }
}

$('open-ig').onclick = () => window.open(`${IG_ORIGIN}/`, '_blank', 'noopener');
$('start').onclick = async () => {
  $('start').disabled = true;
  try {
    render(await ask('start', { settings: {} }));
  } catch (err) {
    $('start').disabled = false;
    $('start-hint').hidden = false;
    $('start-hint').textContent = why(err.message);
  }
};
// the site's graph page: it reads the crawl through the bridge too
$('view').onclick = () => (location.href = './');

function paint() {
  translateStatic();
  document.title = t('w.pageTitle');
}
document.documentElement.lang = lang;
paint();
langButton($('lang'), () => {
  paint();
  render(last);
});

if (hasBridge()) {
  onLocalChange(refresh);
  checkEnv();
  refresh();
} else {
  // opened without the extension (or before it finished loading): the way to get it
  $('no-extension').hidden = false;
  for (const step of document.querySelectorAll('.step')) step.hidden = true;
}

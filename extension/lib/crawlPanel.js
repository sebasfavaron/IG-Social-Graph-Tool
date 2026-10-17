import { ask, bridgeVersion, extensionVersion, onLocalChange } from './bridge.js';
import { barWidth, checkedText, errorText, etaText, statusText } from './crawlStatus.js';
import { SHARE_BASE_URL } from './share.js';
import { t, why } from './i18n.js';

// The crawl's controls on the site (#crawl in viewer.html), through the extension's
// bridge: start, pause, resume, its progress and settings. They used to be the popup's,
// where every change to them meant updating the extension. The crawl itself runs in the
// extension either way; closing this page does not stop it.

const $ = (id) => document.getElementById(id);
let last = null; // the crawler's summary as last drawn
let env = null; // { loggedIn, pinned, version } from the extension; null: an old one that does not say
let settingsTouched = false;
let onDone = () => {};
let drawn = false;
let endedHere = false; // the crawl ended while this page was open: what is on screen is part of it
let newerVersion = null; // the site's extension version, when newer than the installed one

function settings() {
  return {
    delaySec: Math.max(2, Number($('crawl-delay').value) || 6),
    maxFollowers: Math.max(0, Number($('crawl-max').value) || 0),
  };
}

export function paint() {
  const s = last;
  const has = !!s;
  const loggedIn = env?.loggedIn ?? true; // an old extension does not say: assume so
  $('crawl-line').textContent = has ? statusText(s) : loggedIn ? t('p.pitch') : t('p.logInFirst');
  $('crawl-bar-box').hidden = !has;
  $('crawl-bar').style.width = has ? barWidth(s) : '0';
  $('crawl-stats').hidden = !has;
  if (has) {
    $('crawl-viewer').textContent = `@${s.viewer.username}`;
    $('crawl-checked').textContent = checkedText(s);
    $('crawl-links').textContent = s.links.toLocaleString();
    $('crawl-requests').textContent = s.requests.toLocaleString();
    const [eta, title] = etaText(s);
    $('crawl-eta').textContent = eta;
    $('crawl-eta').title = title;
    if (!settingsTouched) {
      $('crawl-delay').value = s.settings.delaySec;
      $('crawl-max').value = s.settings.maxFollowers;
    }
  }
  const error = has ? errorText(s) : '';
  $('crawl-error').hidden = !error;
  $('crawl-error').textContent = error;
  $('crawl-login').hidden = has || loggedIn;
  $('crawl-start').hidden = (has && s.status !== 'done') || (!has && !loggedIn);
  $('crawl-start').textContent = has ? t('p.startOver') : t('p.start');
  $('crawl-start').classList.toggle('primary', !has);
  $('crawl-resume').hidden = !has || !['paused', 'error', 'cooldown'].includes(s.status);
  $('crawl-pause').hidden = !has || !['running', 'cooldown'].includes(s.status);
  // crawls made before names and photos were kept have none
  $('crawl-profiles').hidden = !has || s.status !== 'done' || s.profiles === undefined;
  $('crawl-profiles').textContent = s?.profiles ? t('p.refreshProfiles') : t('p.getProfiles');
  $('crawl-see').hidden = !(endedHere && s?.status === 'done');
  $('crawl-update').hidden = !newerVersion;
}

function draw(s) {
  const done = s?.status === 'done';
  if (drawn && last?.status !== 'done' && last && done) {
    endedHere = true;
    onDone();
  }
  // on opening, a finished crawl folds away to its first line; one going (or none) shows everything
  if (!drawn) setOpen(!done);
  drawn = true;
  last = s;
  paint();
}

function setOpen(open) {
  $('crawl-more').hidden = !open;
  $('crawl-toggle').setAttribute('aria-expanded', String(open));
}

async function act(request) {
  try {
    draw(await request());
  } catch (err) {
    $('crawl-error').hidden = false;
    $('crawl-error').textContent = why(err.message);
  }
}
const send = (type, args) => () => ask(type, args);
const refresh = () => act(send('getState'));
const readEnv = () =>
  bridgeVersion() >= 2
    ? ask('env')
        .then((e) => (env = e))
        .catch(() => {})
    : Promise.resolve();

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// done(): the crawl just ended (the page can show the whole graph now)
export async function startCrawlPanel({ done } = {}) {
  onDone = done || onDone;
  $('crawl').hidden = false;
  $('crawl-toggle').onclick = () => setOpen($('crawl-more').hidden);
  $('crawl-delay').oninput = $('crawl-max').oninput = () => (settingsTouched = true);
  $('crawl-start').onclick = () => {
    if (last && !confirm(t('p.confirmRestart'))) return;
    act(send('start', { settings: settings() }));
  };
  $('crawl-resume').onclick = () => act(send('resume', { settings: settings() }));
  $('crawl-pause').onclick = () => act(send('pause'));
  $('crawl-profiles').onclick = () => act(send('refreshProfiles'));
  $('crawl-login').href = 'https://www.instagram.com/';
  $('crawl-see').onclick = () => location.reload();
  $('crawl-update').href = `${SHARE_BASE_URL}install.html`;

  onLocalChange(refresh);
  // logging in to Instagram changes no crawl: look again now and then until it happens
  const watchLogin = () => readEnv().then(() => (env && !env.loggedIn ? (paint(), setTimeout(watchLogin, 3000)) : paint()));
  await readEnv();
  await refresh();
  if (env && !env.loggedIn) setTimeout(watchLogin, 3000);
  // the times in the status line and the estimate move on their own
  setInterval(() => last && last.status !== 'done' && refresh(), 30_000);

  const installed = extensionVersion();
  fetch(`${SHARE_BASE_URL}version.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((site) => {
      // a bridge before version 2 does not say its version: it is older than the site's
      if (site?.version && (!installed || newer(site.version, installed))) newerVersion = site.version;
      paint();
    })
    .catch(() => {});
}

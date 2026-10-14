import { toGraphJson } from './lib/crawler.js';

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

function formatDuration(ms) {
  const min = Math.round(ms / 60_000);
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

const STATUS_TEXT = {
  running: (s) => (s.phase === 'followers' ? 'Listing your followers…' : 'Checking who follows whom…'),
  paused: () => 'Paused.',
  cooldown: (s) => `Waiting for Instagram — resumes at ${new Date(s.cooldownUntil).toLocaleTimeString()}.`,
  done: () => 'Done.',
  error: () => 'Stopped.',
};

let settingsTouched = false;

function render(s) {
  const has = !!s;
  $('status').textContent = has ? STATUS_TEXT[s.status]?.(s) || s.status : 'Open the popup while logged in to Instagram and press Start.';
  $('stats').hidden = !has;
  $('start').hidden = has && s.status !== 'done';
  $('start').textContent = has ? 'Start over' : 'Start';
  $('resume').hidden = !has || !['paused', 'error', 'cooldown'].includes(s.status);
  $('pause').hidden = !has || !['running', 'cooldown'].includes(s.status);
  $('view').disabled = $('download').disabled = !has || s.links === 0;
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
  const remaining = Math.max(0, target - s.done);
  $('eta').textContent =
    s.status === 'done' ? '—' : s.phase === 'followers' ? '…' : `~${formatDuration(remaining * s.settings.delaySec * 1000)}`;
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
$('reset').onclick = () => {
  if (confirm('Delete everything collected so far?')) act(() => send('reset'));
};
$('view').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
$('download').onclick = async () => {
  const { crawl } = await chrome.storage.local.get('crawl');
  const graph = toGraphJson(crawl);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' }));
  a.download = `ig-social-data-${crawl.viewer.username}.json`;
  a.click();
};

chrome.storage.onChanged.addListener(() => act(() => send('getState')));
act(() => send('getState'));

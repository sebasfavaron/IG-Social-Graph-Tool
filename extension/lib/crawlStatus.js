import { formatDuration } from './format.js';
import { lang, t, why } from './i18n.js';

// How a crawl is going, in words, from the crawler's summary (background.js getState):
// the site's crawl panel, its welcome page and the popup's one line all read it here.

const STATUS_TEXT = {
  running: (s) => t(s.refreshing ? 'p.fetchingProfiles' : s.phase === 'followers' ? 'p.listing' : 'p.checking'),
  paused: () => t('p.paused'),
  cooldown: (s) => t('p.cooldown', new Date(s.cooldownUntil).toLocaleTimeString(lang)),
  done: () => t('p.done'),
  error: () => t('p.stopped'),
};
export const statusText = (s) => STATUS_TEXT[s.status]?.(s) || s.status;

// followers it will check: all of them, or the limit in the settings
export const target = (s) => (s.settings.maxFollowers ? Math.min(s.settings.maxFollowers, s.total) : s.total);

export const barWidth = (s) => (s.phase === 'followers' ? '3%' : `${target(s) ? (100 * s.done) / target(s) : 0}%`);

// "359 / 524", or while the followers are still being listed, how many so far
export const checkedText = (s) => (s.phase === 'followers' ? t('p.listingCount', s.total) : `${s.done} / ${target(s)}`);

// -> [text, title]. measured: from the pace so far, Instagram's slowdowns included;
// otherwise only a floor at the current delay
export function etaText(s) {
  const { ms, measured } = s.remaining || { ms: Math.max(0, target(s) - s.done) * s.settings.delaySec * 1000, measured: false };
  const text = s.status === 'done' ? '—' : s.phase === 'followers' ? '…' : measured ? `~${formatDuration(ms)}` : t('p.atLeast', formatDuration(ms));
  return [text, t(measured ? 'p.measuredTitle' : 'p.floorTitle')];
}

// the crawler's own message, when it stopped on one (otherwise the status line says it all,
// and a message from before a pause is stale)
export const errorText = (s) => (s.error && s.status === 'error' ? why(s.error) : '');

// Runs on the project's website only (manifest content_scripts): the page asks, and this
// answers with what only the extension has, the crawl and its photos, or passes a request
// on to the crawler (background.js). Everything else lives in the page, so new features
// ship with the site and nobody has to update the extension for them.
//
// Page -> here:  window.postMessage({ source: 'igsg-page', id, type, ...args })
// here -> page:  { source: 'igsg-extension', id, ok, data | error }
//                { source: 'igsg-extension', type: 'changed' } when the crawl or photos change
//
// Version 2 passes every request on (the crawler decides what exists) except deleting
// the data, which stays in the popup; version 1 passed a fixed list.
(() => {
  const VERSION = 2;
  const root = document.documentElement;
  // two copies of the extension installed: the first one answers, the other stays out
  if (root.dataset.igsgBridge) return;
  root.dataset.igsgBridge = String(VERSION); // read by the page at once
  root.dataset.igsgVersion = chrome.runtime.getManifest().version;

  const post = (message) => window.postMessage({ source: 'igsg-extension', ...message }, location.origin);
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'igsg-page') return;
    const { id, type, ...args } = event.data;
    try {
      if (type === 'crawl') {
        const { crawl, thumbs } = await chrome.storage.local.get(['crawl', 'thumbs']);
        return post({ id, ok: true, data: { crawl: crawl || null, thumbs: thumbs || {} } });
      }
      if (type === 'reset') return post({ id, ok: false, error: 'not from a page' });
      const res = await chrome.runtime.sendMessage({ type, ...args });
      post({ id, ok: !!res?.ok, data: res?.data, error: res?.error ?? (res ? undefined : `unknown request: ${type}`) });
    } catch (err) {
      post({ id, ok: false, error: String(err?.message || err) });
    }
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.crawl || changes.thumbs) post({ type: 'changed' });
  });
})();

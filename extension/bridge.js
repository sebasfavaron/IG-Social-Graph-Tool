// Runs on the project's website only (manifest content_scripts): the page asks, and this
// answers with what only the extension has, the crawl and its photos, or passes a request
// on to the crawler (background.js). Everything else lives in the page, so new features
// ship with the site and nobody has to update the extension for them.
//
// Page -> here:  window.postMessage({ source: 'igsg-page', id, type, ...args })
// here -> page:  { source: 'igsg-extension', id, ok, data | error }
//                { source: 'igsg-extension', type: 'changed', keys } when the crawl or photos change
//
// Only the requests below pass; deleting the data stays in the popup. A new kind of
// request needs the crawler (background.js) updated anyway, so it is added here then too.
// Version 2 added env and the changed keys; version 3 the list, thumbs and legacyKey.
(() => {
  const VERSION = 3;
  const CRAWLER = new Set(['getState', 'env', 'start', 'resume', 'pause', 'refreshProfiles', 'profilePhoto']);
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
      // only the photos: they change often during a crawl, and the crawl is the bigger part
      if (type === 'thumbs') {
        const { thumbs } = await chrome.storage.local.get('thumbs');
        return post({ id, ok: true, data: thumbs || {} });
      }
      // the key of a graph published from the extension's own page, left here by the popup
      if (type === 'legacyKey') {
        const { legacyKey } = await chrome.storage.local.get('legacyKey');
        return post({ id, ok: true, data: legacyKey || null });
      }
      if (!CRAWLER.has(type)) return post({ id, ok: false, error: `unknown request: ${type}` });
      const res = await chrome.runtime.sendMessage({ type, ...args });
      post({ id, ok: !!res?.ok, data: res?.data, error: res?.error });
    } catch (err) {
      post({ id, ok: false, error: String(err?.message || err) });
    }
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.crawl || changes.thumbs) post({ type: 'changed', keys: Object.keys(changes) });
  });
})();

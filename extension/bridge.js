// Runs on the project's website only (manifest content_scripts): the page asks, and this
// answers with what only the extension has, the crawl and its photos, or passes a request
// on to the crawler (background.js). Everything else lives in the page, so new features
// ship with the site and nobody has to update the extension for them.
//
// Page -> here:  window.postMessage({ source: 'igsg-page', id, type, ...args })
// here -> page:  { source: 'igsg-extension', id, ok, data | error }
//                { source: 'igsg-extension', type: 'changed' } when the crawl or photos change
(() => {
  const VERSION = 1;
  // what the page may ask the crawler for; deleting the data stays in the popup
  const CRAWLER = new Set(['getState', 'start', 'resume', 'pause', 'refreshProfiles', 'profilePhoto']);
  document.documentElement.dataset.igsgBridge = String(VERSION); // read by the page at once

  const post = (message) => window.postMessage({ source: 'igsg-extension', ...message }, location.origin);
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'igsg-page') return;
    const { id, type, ...args } = event.data;
    try {
      if (type === 'crawl') {
        const { crawl, thumbs } = await chrome.storage.local.get(['crawl', 'thumbs']);
        return post({ id, ok: true, data: { crawl: crawl || null, thumbs: thumbs || {} } });
      }
      if (CRAWLER.has(type)) {
        const res = await chrome.runtime.sendMessage({ type, ...args });
        return post({ id, ok: !!res?.ok, data: res?.data, error: res?.error });
      }
      post({ id, ok: false, error: `unknown request: ${type}` });
    } catch (err) {
      post({ id, ok: false, error: String(err?.message || err) });
    }
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.crawl || changes.thumbs) post({ type: 'changed' });
  });
})();

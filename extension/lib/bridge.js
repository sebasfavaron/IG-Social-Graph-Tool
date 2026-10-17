// The page's side of extension/bridge.js: on the website, with the extension installed,
// the page can read the local crawl and photos and ask the crawler for things.

export const hasBridge = () => !!globalThis.document?.documentElement.dataset.igsgBridge;
// 1: the first bridges (extension 2.3.x), which pass on a fixed list of requests
export const bridgeVersion = () => Number(globalThis.document?.documentElement.dataset.igsgBridge) || 0;
// the extension's version (bridge 2 on), or null
export const extensionVersion = () => globalThis.document?.documentElement.dataset.igsgVersion || null;

let next = 0;
// -> the answer's data; rejects with the extension's error, or after 15 s without one
export function ask(type, args = {}) {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${++next}`;
    const done = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
    const onMessage = (event) => {
      if (event.source !== window || event.data?.source !== 'igsg-extension' || event.data.id !== id) return;
      done();
      if (event.data.ok) resolve(event.data.data);
      else reject(new Error(event.data.error || 'the extension said no'));
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('the extension did not answer'));
    }, 15_000);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'igsg-page', id, type, ...args }, location.origin);
  });
}

// cb() whenever the crawl or its photos change in the extension
export function onLocalChange(cb) {
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.source === 'igsg-extension' && event.data.type === 'changed') cb();
  });
}

// Positions for a graph: from a cache when this exact graph was laid out before, otherwise
// from the layout worker. Same input order -> same positions, which share links rely on.

const CACHE_PREFIX = 'layout:';
const CACHE_INDEX = 'layout:index';
const CACHE_KEEP = 8;

// FNV-1a over the node ids and link indexes; collisions only cost a re-layout check below.
function graphKey(ids, linkIndexes) {
  let h = 0x811c9dc5;
  const mix = (n) => {
    h ^= n;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) mix(id.charCodeAt(i));
    mix(10);
  }
  for (const n of linkIndexes) mix(n + 1);
  return `${CACHE_PREFIX}${self.LAYOUT_VERSION}:${ids.length}:${linkIndexes.length}:${h.toString(36)}`;
}

function readCache(key, count) {
  try {
    const raw = localStorage.getItem(key);
    const positions = raw && JSON.parse(raw);
    return Array.isArray(positions) && positions.length === count * 2 ? positions : null;
  } catch (_) {
    return null;
  }
}

function writeCache(key, positions) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(positions, (v) => Math.round(v * 100) / 100)));
    const index = (JSON.parse(localStorage.getItem(CACHE_INDEX) || '[]') || []).filter((k) => k !== key);
    index.unshift(key);
    for (const old of index.splice(CACHE_KEEP)) localStorage.removeItem(old);
    localStorage.setItem(CACHE_INDEX, JSON.stringify(index));
  } catch (_) {
    // storage full or blocked: the next visit lays out again, nothing else breaks
  }
}

// ids: string[]; linkIndexes: Int32Array [s0, t0, ...]; returns { positions, cached, cancel }
export function computeLayout(ids, linkIndexes, onProgress) {
  const key = graphKey(ids, linkIndexes);
  const cached = readCache(key, ids.length);
  if (cached) return { positions: Promise.resolve(cached), cached: true, cancel() {} };

  const worker = new Worker(new URL('./layoutWorker.js', import.meta.url));
  const positions = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) return onProgress?.(data.progress);
      worker.terminate();
      writeCache(key, data.positions);
      resolve(data.positions);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'layout failed'));
    };
  });
  const copy = new Int32Array(linkIndexes); // the original stays usable after transfer
  worker.postMessage({ count: ids.length, links: copy }, [copy.buffer]);
  return { positions, cached: false, cancel: () => worker.terminate() };
}

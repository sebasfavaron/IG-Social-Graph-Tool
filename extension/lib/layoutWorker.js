// Runs the force layout off the main thread, so the page stays responsive while ~10k
// links settle.
// in:  { count, links: Int32Array [s0, t0, s1, t1, ...] }
// out: { progress: 0..1, partial: Float32Array } now and then (where people are so far, so
// the page can draw the graph settling), then { positions: Float32Array [x0, y0, ...] }
importScripts('forceLayout.js');

function pack(count, x, y) {
  const positions = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    positions[2 * i] = x[i];
    positions[2 * i + 1] = y[i];
  }
  return positions;
}

self.onmessage = ({ data }) => {
  const { x, y } = self.forceLayout(data.count, data.links, (progress, px, py) => {
    const partial = pack(data.count, px, py);
    self.postMessage({ progress, partial }, [partial.buffer]);
  });
  const positions = pack(data.count, x, y);
  self.postMessage({ positions }, [positions.buffer]);
};

// Runs the force layout off the main thread, so the page stays responsive while ~10k
// links settle.
// in:  { count, links: Int32Array [s0, t0, s1, t1, ...] }
// out: { progress: 0..1 } now and then, then { positions: Float32Array [x0, y0, ...] }
importScripts('forceLayout.js');

self.onmessage = ({ data }) => {
  const { x, y } = self.forceLayout(data.count, data.links, (progress) => self.postMessage({ progress }));
  const positions = new Float32Array(data.count * 2);
  for (let i = 0; i < data.count; i++) {
    positions[2 * i] = x[i];
    positions[2 * i + 1] = y[i];
  }
  self.postMessage({ positions }, [positions.buffer]);
};

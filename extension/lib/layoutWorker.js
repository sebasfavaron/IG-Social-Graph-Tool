// Runs the force layout off the main thread, so the page stays responsive while ~10k
// links settle (about half a second of solid computation for a 500-person graph).
// in:  { count, links: Int32Array [s0, t0, s1, t1, ...] }
// out: { progress: 0..1 } now and then, then { positions: Float32Array [x0, y0, ...] }
importScripts('../vendor/d3.v4.min.js', 'forces.js');

self.onmessage = ({ data }) => {
  const nodes = Array.from({ length: data.count }, (_, index) => ({ index }));
  const links = [];
  for (let i = 0; i < data.links.length; i += 2) links.push({ source: data.links[i], target: data.links[i + 1] });
  const simulation = self.buildSimulation(self.d3, nodes, links).stop();
  const ticks = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));
  for (let i = 0; i < ticks; i++) {
    simulation.tick();
    if (i % 30 === 0) self.postMessage({ progress: i / ticks });
  }
  const positions = new Float32Array(nodes.length * 2);
  nodes.forEach((d, i) => {
    positions[2 * i] = d.x;
    positions[2 * i + 1] = d.y;
  });
  self.postMessage({ positions }, [positions.buffer]);
};

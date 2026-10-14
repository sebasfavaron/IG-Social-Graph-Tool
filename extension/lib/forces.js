// Classic script (no import/export): loaded by the layout worker with importScripts, and by
// viewer.html with a plain <script> for LAYOUT_VERSION (the layout cache key).
// nodes: [{ id }], links: [{ source: index, target: index }]
self.buildSimulation = function buildSimulation(d3, nodes, links) {
  return d3
    .forceSimulation(nodes)
    .force('center', d3.forceCenter(0, 0))
    .force('link', d3.forceLink(links).distance(0).strength(0.1))
    .force('charge', d3.forceManyBody().strength(-100))
    .force('collision', d3.forceCollide(10));
};

// Bump when the forces change, so cached layouts from the old forces are not reused.
self.LAYOUT_VERSION = 1;

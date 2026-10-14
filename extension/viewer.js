import { toGraphJson } from './lib/crawler.js';
import { drawGraph } from './lib/graphVisualizer.js';
import { pruneLoneNodes } from './lib/prune.js';

const $ = (id) => document.getElementById(id);

// Old exports sometimes miss nodes that only appear in links; d3's link force throws on those.
function withAllNodes(graph) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const missing = [];
  for (const { source, target } of graph.links) {
    for (const id of [source, target]) {
      if (!ids.has(id)) {
        ids.add(id);
        missing.push({ id, group: 1 });
      }
    }
  }
  return { ...graph, nodes: [...graph.nodes, ...missing] };
}

function show(graph) {
  const username = graph.username || graph.metadata?.loggedUsername;
  const total = graph.nodes.length;
  const pruned = pruneLoneNodes(withAllNodes(graph));
  document.title = username ? `@${username}'s circle` : 'IG Social Graph';
  $('title').textContent = username ? `@${username}` : 'IG Social Graph';
  $('counts').textContent =
    `${pruned.nodes.length} people · ${pruned.links.length} connections` +
    (total > pruned.nodes.length ? ` · ${total - pruned.nodes.length} loners hidden` : '') +
    (graph.metadata?.complete === false ? ' · partial' : '');
  $('empty').hidden = pruned.nodes.length > 0;
  d3.select('svg').selectAll('*').remove();
  if (pruned.nodes.length) drawGraph(pruned);
}

$('file').onchange = async () => {
  const file = $('file').files[0];
  if (file) show(JSON.parse(await file.text()));
};

const { crawl } = await chrome.storage.local.get('crawl');
if (crawl) show(toGraphJson(crawl));
else $('empty').hidden = false;

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
  graphControl = pruned.nodes.length ? drawGraph(pruned) : null;
  pinned = null;
  updateLegend();
}

// Legend: hover a category to see only those links of the selected person; click to keep it.
let graphControl = null;
let pinned = null;
const legendItems = [...document.querySelectorAll('[data-cat]')];
const LABELS = { follower: 'follower', following: 'following', mutual: 'mutual' };

function updateLegend() {
  const counts = graphControl?.hasSelection() ? graphControl.counts() : null;
  $('legend').classList.toggle('active', !!counts);
  $('hint').textContent = counts ? 'show only:' : 'click a name:';
  if (!counts) pinned = null;
  for (const item of legendItems) {
    const cat = item.dataset.cat;
    item.textContent = counts ? `${LABELS[cat]} ${counts[cat]}` : LABELS[cat];
    item.classList.toggle('pinned', pinned === cat);
  }
}

for (const item of legendItems) {
  item.onmouseenter = () => graphControl?.hasSelection() && graphControl.showOnly(item.dataset.cat);
  item.onmouseleave = () => graphControl?.hasSelection() && graphControl.showOnly(pinned);
  item.onclick = () => {
    if (!graphControl?.hasSelection()) return;
    pinned = pinned === item.dataset.cat ? null : item.dataset.cat;
    graphControl.showOnly(pinned);
    updateLegend();
  };
}
// Header clicks must not reach the body handler that clears the selection.
document.querySelector('header').addEventListener('click', (e) => e.stopPropagation());
// Any click on the graph selects or clears a person (the node handler stops propagation,
// hence capture); drop the pin and refresh the counts once the graph has handled it.
document.querySelector('svg').addEventListener(
  'click',
  () => {
    pinned = null;
    setTimeout(updateLegend);
  },
  true
);

$('file').onchange = async () => {
  const file = $('file').files[0];
  if (file) show(JSON.parse(await file.text()));
};

const { crawl } = await chrome.storage.local.get('crawl');
if (crawl) show(toGraphJson(crawl));
else $('empty').hidden = false;

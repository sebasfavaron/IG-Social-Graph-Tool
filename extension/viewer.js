import { toGraphJson } from './lib/crawler.js';
import { drawGraph } from './lib/graphVisualizer.js';
import { EXAMPLE_GRAPH } from './lib/example.js';
import { pruneLoneNodes } from './lib/prune.js';

const $ = (id) => document.getElementById(id);

// Old exports sometimes miss nodes that only appear in links (d3's link force throws on
// those) and repeat links (drawn twice, and they double the counts).
function withAllNodes(graph) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const missing = [];
  const seen = new Set();
  const links = graph.links.filter(({ source, target }) => {
    const key = `${source}\u0000${target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  for (const { source, target } of links) {
    for (const id of [source, target]) {
      if (!ids.has(id)) {
        ids.add(id);
        missing.push({ id, group: 1 });
      }
    }
  }
  return { ...graph, nodes: [...graph.nodes, ...missing], links };
}

function show(graph) {
  const username = graph.username || graph.metadata?.loggedUsername;
  const total = graph.nodes.length;
  const pruned = pruneLoneNodes(withAllNodes(graph));
  document.title = username ? `@${username}'s circle` : 'IG Social Graph';
  $('title').textContent = username ? `@${username}` : 'IG Social Graph';
  $('counts').textContent =
    `${pruned.nodes.length} people · ${pruned.links.length} connections` +
    (total > pruned.nodes.length
      ? ` · ${total - pruned.nodes.length} ${total - pruned.nodes.length === 1 ? 'loner' : 'loners'} hidden`
      : '') +
    (graph.metadata?.complete === false ? ' · partial' : '');
  $('empty').hidden = pruned.nodes.length > 0;
  d3.select('svg').selectAll('*').remove();
  graphControl = pruned.nodes.length ? drawGraph(pruned) : null;
  pinned = null;
  updateLegend();
  closeSearch();
}

// Legend: hover a category to see only those links of the selected person; click to keep it.
let graphControl = null;
let pinned = null;
const legendItems = [...document.querySelectorAll('[data-cat]')];
// Labels name the selected person and put the count where a sentence would, so the
// direction of each group reads naturally: "9 follow @x", "@x follows 5".
const LABELS = {
  follower: (name, n) => `${n} ${n === 1 ? 'follows' : 'follow'} @${name}`,
  following: (name, n) => `@${name} follows ${n}`,
  mutual: (name, n) => (n ? `@${name} and ${n} follow each other` : 'no mutual follows'),
};
const shorten = (name) => (name.length > 16 ? `${name.slice(0, 15)}…` : name);

function updateLegend() {
  const selected = graphControl?.selected();
  const counts = selected ? graphControl.counts() : null;
  $('legend').classList.toggle('active', !!counts);
  $('hint').textContent = counts ? 'show only:' : 'click a name to see who follows them';
  if (!counts) pinned = null;
  for (const item of legendItems) {
    const cat = item.dataset.cat;
    item.hidden = !counts;
    if (!counts) continue;
    item.textContent = LABELS[cat](shorten(selected), counts[cat]);
    item.title = LABELS[cat](selected, counts[cat]);
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

async function openFile(file) {
  if (!file) return;
  try {
    const graph = JSON.parse(await file.text());
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) throw new Error('no nodes/links in it');
    show(graph);
  } catch (err) {
    alert(`Could not open ${file.name}: ${err.message}`);
  }
}
$('file').onchange = () => openFile($('file').files[0]);
// structuredClone: d3 replaces link endpoints with node objects, so each run needs fresh data
$('example').onclick = () => show(structuredClone(EXAMPLE_GRAPH));


// Search: type part of a username; the highlighted match is selected in the graph as you
// type, arrow or hover. Enter or a click keeps it and closes the list; "/" focuses it.
const search = $('search');
const results = $('results');
let matches = [];
let active = 0;

function closeSearch() {
  clearTimeout(previewTimer);
  results.hidden = true;
  matches = [];
}

function renderResults() {
  results.replaceChildren(
    ...matches.map((id, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      const q = search.value.trim().toLowerCase();
      const at = id.toLowerCase().indexOf(q);
      const mark = document.createElement('mark');
      mark.textContent = id.slice(at, at + q.length);
      li.append(id.slice(0, at), mark, id.slice(at + q.length));
      li.onmouseenter = () => setActive(i);
      // keep focus so blur does not close the list first
      li.onmousedown = (e) => e.preventDefault();
      // pick on click, not mousedown: closing the list on mousedown let the mouseup land
      // on the page behind it, and that click cleared the selection again
      li.onclick = () => choose(id);
      return li;
    })
  );
  results.hidden = matches.length === 0;
  preview();
}

function setActive(i) {
  if (i === active) return;
  active = i;
  [...results.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === active)));
  preview();
}

// Debounced so fast typing or arrowing does not queue a pan per keystroke.
let previewTimer = null;
function preview() {
  clearTimeout(previewTimer);
  const id = matches[active];
  if (!id) return;
  previewTimer = setTimeout(() => {
    if (graphControl?.focus(id)) {
      pinned = null;
      updateLegend();
    }
  }, 150);
}

function choose(id) {
  if (!graphControl?.focus(id)) return;
  pinned = null;
  updateLegend();
  search.value = id;
  closeSearch();
  search.blur();
}

search.oninput = () => {
  const q = search.value.trim().toLowerCase();
  if (!q || !graphControl) return closeSearch();
  const ids = graphControl.ids().filter((id) => id.toLowerCase().includes(q));
  ids.sort((a, b) => a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q) || a.length - b.length);
  matches = ids.slice(0, 8);
  active = 0;
  renderResults();
};
search.onkeydown = (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!matches.length) return;
    setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
  } else if (e.key === 'Enter' && matches.length) {
    choose(matches[active]);
  } else if (e.key === 'Escape') {
    search.value = '';
    closeSearch();
    search.blur();
  }
};
search.onblur = closeSearch;
search.onfocus = () => search.value && search.oninput();
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== search) {
    e.preventDefault();
    search.focus();
    search.select();
  }
});

// Dropping a JSON export anywhere on the page opens it, same as "Open JSON…".
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  openFile(e.dataTransfer.files[0]);
});

// Inside the extension the graph comes from the crawl; as a plain web page (GitHub
// Pages) there is no chrome.storage and the page waits for a file.
const inExtension = typeof chrome !== 'undefined' && !!chrome.storage?.local;
if (!inExtension) {
  $('empty-text').textContent =
    'Drop an IG Social Graph JSON export here, or use "Open JSON…". The file stays in your browser.';
}
const { crawl } = inExtension ? await chrome.storage.local.get('crawl') : {};
if (crawl) show(toGraphJson(crawl));
else $('empty').hidden = false;

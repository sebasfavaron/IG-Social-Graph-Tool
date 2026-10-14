import { toGraph } from './lib/crawler.js';
import { drawGraph } from './lib/graphVisualizer.js';
import { EXAMPLE_GRAPH } from './lib/example.js';
import { pruneLoneNodes } from './lib/prune.js';
import { SHARE_BASE_URL, buildHash, decodeGraph, encodeGraph, parseHash } from './lib/share.js';

const INSTALL_URL = 'https://github.com/sebasfavaron/IG-Social-Graph-Tool#use-it-chrome-extension';

const $ = (id) => document.getElementById(id);
// Inside the extension the graph comes from the crawl; as a plain web page (GitHub
// Pages) there is no chrome.storage and the graph comes from a share link.
const inExtension = typeof chrome !== 'undefined' && !!chrome.storage?.local;


let shown = null; // what is on screen, for the share link
let encoded = null; // `shown` packed for the link; filled in the background
let viewTouched = false; // the view goes in the link only once someone zoomed or panned

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// encodedGraph: the packed form when the graph came from a link, so it is not redone.
function show(graph, { encodedGraph = null } = {}) {
  const username = graph.username || graph.metadata?.loggedUsername;
  const total = graph.nodes.length;
  const pruned = pruneLoneNodes(graph);
  document.title = username ? `@${username}'s circle` : 'IG Social Graph';
  $('title').textContent = username ? `@${username}` : 'IG Social Graph';
  $('counts').textContent =
    `${pruned.nodes.length} people · ${pruned.links.length} connections` +
    (total > pruned.nodes.length
      ? ` · ${total - pruned.nodes.length} ${total - pruned.nodes.length === 1 ? 'loner' : 'loners'} hidden`
      : '') +
    (graph.metadata?.complete === false ? ' · partial' : '');
  $('empty').hidden = pruned.nodes.length > 0;
  // Same order whatever the source (crawl, link, example), so the layout comes out the same
  // and a view saved in a link lands on the same people.
  pruned.nodes.sort((a, b) => byId(a.id, b.id));
  pruned.links.sort((a, b) => byId(a.source, b.source) || byId(a.target, b.target));
  d3.select('svg').selectAll('*').remove();
  graphControl = pruned.nodes.length ? drawGraph(pruned, { onViewChange }) : null;
  shown = graphControl ? { ...pruned, username } : null;
  $('share').hidden = !shown;
  pinned = null;
  viewTouched = false;
  encoded = encodedGraph;
  if (!inExtension && !encodedGraph) {
    history.replaceState(null, '', location.pathname + location.search); // drop a stale link
    const packing = shown;
    if (packing) {
      encodeGraph(packing).then((g) => {
        if (shown === packing) {
          encoded = g;
          syncUrl();
        }
      });
    }
  }
  updateLegend();
  closeSearch();
}

// The address bar always holds a link to what is on screen (on the public page; an
// extension page's address is no use to anyone else).
function currentHash(g) {
  return buildHash({
    g,
    p: graphControl?.selected(),
    c: pinned,
    v: viewTouched && graphControl ? graphControl.view() : null,
  });
}
let syncTimer = null;
function syncUrl() {
  if (inExtension || !encoded) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    history.replaceState(null, '', location.pathname + location.search + currentHash(encoded));
  }, 250);
}
function onViewChange(byUser) {
  if (byUser) viewTouched = true;
  syncUrl();
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
  syncUrl();
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

// structuredClone: d3 replaces link endpoints with node objects, so each run needs fresh data
$('example').onclick = () => show(structuredClone(EXAMPLE_GRAPH));

// Share: the graph on screen and how it is being looked at travel inside the link (after
// "#", never sent to a server). From the extension the link points at the public page.
async function openShareHash() {
  const state = parseHash(location.hash);
  if (!state?.g) return false;
  try {
    if (state.g !== encoded) show(await decodeGraph(state.g), { encodedGraph: state.g });
  } catch (err) {
    alert(`This share link looks cut off or broken (${err.message}). Ask for it again.`);
    return false;
  }
  if (!graphControl) return true;
  if (state.p) {
    // with a saved view, select in place; without one, pan to the person like search does
    if (state.v) graphControl.select(state.p);
    else graphControl.focus(state.p);
    pinned = state.c;
    if (pinned) graphControl.showOnly(pinned);
  }
  if (state.v) {
    graphControl.setView(state.v);
    viewTouched = true;
  }
  updateLegend();
  return true;
}
window.addEventListener('hashchange', openShareHash); // someone pasted or edited a link

$('share').onclick = async () => {
  if (!shown) return;
  const base = inExtension ? SHARE_BASE_URL : location.origin + location.pathname;
  const url = base + currentHash(encoded || (await encodeGraph(shown)));
  const label = $('share').textContent;
  try {
    await navigator.clipboard.writeText(url);
    $('share').textContent = `Copied · ${Math.round(url.length / 1000)}k characters`;
  } catch (_) {
    prompt('Copy this link:', url);
  }
  setTimeout(() => ($('share').textContent = label), 2500);
};


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

if (!inExtension) {
  const link = Object.assign(document.createElement('a'), {
    href: INSTALL_URL,
    target: '_blank',
    rel: 'noopener',
    textContent: 'IG Social Graph extension',
  });
  $('empty-text').replaceChildren(
    'Open a share link from the ',
    link,
    ' to see a graph here.'
  );
}
if (!(await openShareHash())) {
  const { crawl } = inExtension ? await chrome.storage.local.get('crawl') : {};
  if (crawl) show(toGraph(crawl));
  else $('empty').hidden = false;
}

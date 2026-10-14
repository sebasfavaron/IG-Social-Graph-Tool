import { toGraph } from './lib/crawler.js';
import { drawGraph } from './lib/graphCanvas.js';
import { EXAMPLE_GRAPH } from './lib/example.js';
import { pruneLoneNodes } from './lib/prune.js';
import { friendGroups } from './lib/groups.js';
import { MAX_GROUP_NAME, SHARE_BASE_URL, buildHash, decodeGraph, encodeGraph, parseHash } from './lib/share.js';

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
// Resolves once the layout is in, so callers can select and move the view.
async function show(graph, { encodedGraph = null } = {}) {
  const username = graph.username || graph.metadata?.loggedUsername;
  const total = graph.nodes.length;
  const pruned = pruneLoneNodes(graph);
  document.title = username ? `@${username}'s circle` : 'IG Social Graph';
  $('title').textContent = username ? `@${username}` : 'IG Social Graph';
  const loners = total - pruned.nodes.length;
  const extra = document.createElement('span');
  extra.className = 'wide-only';
  extra.textContent = loners ? ` · ${loners} ${loners === 1 ? 'loner' : 'loners'} hidden until selected` : '';
  $('counts').replaceChildren(
    `${pruned.nodes.length} people · ${pruned.links.length} connections`,
    extra,
    graph.metadata?.complete === false ? ' · partial' : ''
  );
  $('empty').hidden = pruned.nodes.length > 0;
  // Same order whatever the source (crawl, link, example), so the layout comes out the same
  // and a view saved in a link lands on the same people.
  // Loners are drawn too but stay hidden until a selection reaches them, so a group in the
  // panel shows everyone its count includes.
  const full = { nodes: [...graph.nodes], links: [...graph.links] };
  full.nodes.sort((a, b) => byId(a.id, b.id));
  full.links.sort((a, b) => byId(a.source, b.source) || byId(a.target, b.target));
  const kept = new Set(pruned.nodes.map((n) => n.id));
  const hidden = new Set(full.nodes.map((n) => n.id).filter((id) => !kept.has(id)));
  groups = friendGroups(full, { exclude: username, hidden });
  graphControl?.destroy();
  graphControl = pruned.nodes.length
    ? drawGraph($('graph'), full, {
        hidden,
        groupOf: groups.groupOf,
        theme: themeFromCss(),
        insets: panelInsets,
        onViewChange,
        onSelectionChange,
      })
    : null;
  shown = graphControl ? { ...full, username } : null;
  groupNames = loadGroupNames();
  renderGroups();
  $('graph').setAttribute(
    'aria-label',
    `Follower graph of ${pruned.nodes.length} people` +
      (groups.sizes.length > 1 ? ` in ${groups.sizes.length} friend groups` : '') +
      '. Use search to pick someone; their connections are listed in a panel.'
  );
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
  updatePanel();
  closeSearch();
  await graphControl?.ready;
}

// a click on the graph selected or cleared someone
function onSelectionChange() {
  pinned = null;
  updatePanel();
}

// The address bar always holds a link to what is on screen (on the public page; an
// extension page's address is no use to anyone else).
function currentHash(g) {
  return buildHash({
    g,
    p: graphControl?.selected(),
    c: pinned,
    v: viewTouched && graphControl ? graphControl.view() : null,
    n: groupNames,
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

// ---- person panel: the selected person's people, as real buttons -----------------
let graphControl = null;
let pinned = null; // the group kept on (follower | following | mutual), also in the link
const sections = [...document.querySelectorAll('#panel section')];
const expanded = new Set(); // groups showing all their names, reset per selection
const LIST_LIMIT = 30;
// Headings name the selected person and put the count where a sentence would, so the
// direction of each group reads naturally: "9 follow @x", "@x follows 5".
const LABELS = {
  follower: (name, n) => `${n} ${n === 1 ? 'follows' : 'follow'} @${name}`,
  following: (name, n) => `@${name} follows ${n}`,
  mutual: (name, n) => (n ? `@${name} and ${n} follow each other` : 'no mutual follows'),
};
const shorten = (name, max = 22) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);
let lastSelected = null;
const narrow = matchMedia('(max-width: 700px)');
// phones show one group at a time, as tabs; picking a tab also shows only its lines
let sheetTab = null;
const TAB_LABELS = {
  mutual: (name, n) => `Each other · ${n}`,
  follower: (name, n) => `Follow them · ${n}`,
  following: (name, n) => `They follow · ${n}`,
};

function personButton(id) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.textContent = `@${id}`;
  b.onclick = () => choosePerson(id);
  li.append(b);
  return li;
}

function updatePanel() {
  const selected = graphControl?.selected() ?? null;
  const people = selected ? graphControl.people() : null;
  if (!people) pinned = null;
  if (selected !== lastSelected) {
    expanded.clear();
    sheetTab = null;
  }
  $('panel').hidden = !people;
  document.body.classList.toggle('selected', !!people);
  $('hint').hidden = !!people;
  if (people) {
    $('panel-name').textContent = `@${selected}`;
    $('avatar').textContent = (selected.match(/[a-z0-9]/i)?.[0] || '@').toUpperCase();
    $('profile').href = `https://www.instagram.com/${encodeURIComponent(selected)}/`;
    $('profile').setAttribute('aria-label', `Open @${selected} on Instagram (new tab)`);
    for (const section of sections) {
      const cat = section.dataset.cat;
      const ids = [...people[cat]].sort((a, b) => a.localeCompare(b));
      const toggle = section.querySelector('.group-toggle');
      toggle.querySelector('.label').textContent = LABELS[cat](shorten(selected), ids.length);
      toggle.title = pinned === cat ? 'Show all groups again' : 'Show only this group (hover to preview)';
      toggle.setAttribute('aria-pressed', String(pinned === cat));
      toggle.disabled = ids.length === 0;
      if (selected !== lastSelected || section.dataset.rendered !== String(expanded.has(cat))) {
        const list = section.querySelector('ul');
        const shownIds = expanded.has(cat) ? ids : ids.slice(0, LIST_LIMIT);
        list.replaceChildren(...shownIds.map(personButton));
        if (ids.length > shownIds.length) {
          const li = document.createElement('li');
          const more = document.createElement('button');
          more.className = 'more';
          more.textContent = `Show all ${ids.length}`;
          more.onclick = () => {
            expanded.add(cat);
            updatePanel();
            list.children[LIST_LIMIT]?.querySelector('button')?.focus();
          };
          li.append(more);
          list.append(li);
        }
        section.dataset.rendered = String(expanded.has(cat));
      }
    }
    // tabs (phones): default to the first group with anyone in it
    if (!sheetTab || !people[sheetTab].length) {
      sheetTab = pinned || ['mutual', 'follower', 'following'].find((c) => people[c].length) || 'mutual';
    }
    for (const tab of document.querySelectorAll('[data-tab]')) {
      const cat = tab.dataset.tab;
      tab.querySelector('.label').textContent = TAB_LABELS[cat](selected, people[cat].length);
      tab.setAttribute('aria-selected', String(cat === sheetTab));
      tab.classList.toggle('only', pinned === cat);
      tab.disabled = people[cat].length === 0;
    }
    for (const section of sections) section.classList.toggle('active', section.dataset.cat === sheetTab);
    if (selected !== lastSelected) {
      const c = graphControl.counts();
      $('announce').textContent =
        `Selected @${selected}. ${LABELS.follower(selected, c.follower)}. ` +
        `${LABELS.following(selected, c.following)}. ${LABELS.mutual(selected, c.mutual)}.`;
    }
  } else if (lastSelected) {
    $('announce').textContent = 'Selection cleared.';
  }
  lastSelected = selected;
  syncUrl();
}

for (const section of sections) {
  const cat = section.dataset.cat;
  // hover (or keyboard focus inside) previews one group; clicking the heading keeps it
  const preview = () => graphControl?.hasSelection() && graphControl.showOnly(cat);
  const restore = () => graphControl?.hasSelection() && graphControl.showOnly(pinned);
  section.addEventListener('mouseenter', preview);
  section.addEventListener('mouseleave', restore);
  section.querySelector('.group-toggle').onclick = () => {
    pinned = pinned === cat ? null : cat;
    graphControl?.showOnly(pinned);
    updatePanel();
  };
}

for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.onclick = () => {
    const cat = tab.dataset.tab;
    // first tap on a tab: show its list and only its lines; tapping it again: all lines
    pinned = sheetTab === cat && pinned === cat ? null : cat;
    sheetTab = cat;
    graphControl?.showOnly(pinned);
    updatePanel();
  };
}
$('sheet-handle').onclick = () => {
  const folded = document.body.classList.toggle('sheet-folded');
  $('sheet-handle').setAttribute('aria-expanded', String(!folded));
  $('sheet-handle').setAttribute('aria-label', folded ? 'Unfold panel' : 'Fold panel');
};

// Select someone and pan to them. The panel is filled first, so the pan centres the
// person in the space its real size leaves free (on phones it is sized to its content).
function focusPerson(id) {
  if (!graphControl?.select(id)) return false;
  pinned = null;
  updatePanel();
  return graphControl.focus(id);
}

function choosePerson(id) {
  focusPerson(id);
}

function clearSelection() {
  graphControl?.clear();
  pinned = null;
  updatePanel();
}
$('panel-close').onclick = () => {
  clearSelection();
  $('search').focus();
};

// where the panel covers the graph, so focusing someone centres them in what is left
// (it may not be on screen yet when this is asked, hence the estimate)
function panelInsets() {
  if (!narrow.matches) return { right: 340, bottom: 0 }; // 300 wide + padding, border, 10px gap
  const shown = !$('panel').hidden && $('panel').offsetHeight;
  return { right: 0, bottom: shown || (document.body.classList.contains('sheet-folded') ? 90 : Math.round(innerHeight * 0.4)) };
}

// ---- friend groups key: renameable, names saved in the link ------------------------
let groups = { groupOf: new Map(), sizes: [] };
let groupNames = [];
const namesKey = () => `groupNames:${shown?.username || ''}`;

function loadGroupNames() {
  try {
    return JSON.parse(localStorage.getItem(namesKey()) || '[]');
  } catch (_) {
    return [];
  }
}
function saveGroupNames() {
  try {
    localStorage.setItem(namesKey(), JSON.stringify(groupNames));
  } catch (_) {}
  syncUrl();
}

let groupsKeyShown = false;
function renderGroups() {
  $('groups').hidden = groups.sizes.length < 2;
  $('groups-count').textContent = `(${groups.sizes.length})`;
  // open on desktop, folded on phones the first time; after that it stays as the user left it
  if (!groupsKeyShown && !$('groups').hidden) {
    $('groups').open = !narrow.matches;
    groupsKeyShown = true;
  }
  $('groups-list').replaceChildren(
    ...groups.sizes.map((n, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--c', `var(--g${i + 1})`);
      const dot = document.createElement('span');
      dot.className = 'dot';
      const input = document.createElement('input');
      input.value = groupNames[i] || '';
      input.placeholder = `Group ${i + 1}`;
      input.maxLength = MAX_GROUP_NAME;
      input.setAttribute('aria-label', `Name for group ${i + 1} (${n} people)`);
      input.title = 'Click to name this group; the name is saved in the share link';
      input.oninput = () => {
        groupNames[i] = input.value.trim();
        saveGroupNames();
      };
      // block body on purpose: a DOM0 handler returning false cancels the key, so a
      // one-liner `e.key === 'Enter' && …` swallowed every letter typed
      input.onkeydown = (e) => {
        if (e.key === 'Enter') input.blur();
      };
      const count = document.createElement('span');
      count.className = 'n';
      count.textContent = n;
      li.append(dot, input, count);
      // pointing at a group (or editing its name) highlights its people in the graph
      const on = () => graphControl?.highlightGroup(i);
      const off = () => graphControl?.highlightGroup(null);
      li.addEventListener('mouseenter', on);
      li.addEventListener('mouseleave', () => document.activeElement !== input && off());
      input.addEventListener('focus', on);
      input.addEventListener('blur', off);
      return li;
    })
  );
}

// ---- theme: light, dark, or the system's, with a toggle ------------------------------
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function isDark() {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === 'dark' : darkQuery.matches;
}
function themeFromCss() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    bg: v('--bg'),
    link: v('--link'),
    node: v('--node'),
    text: v('--fg'),
    muted: v('--muted'),
    follower: v('--follower'),
    following: v('--following'),
    mutual: v('--mutual'),
    groups: [1, 2, 3, 4, 5, 6].map((i) => v(`--g${i}`)),
    glow: v('--glow') === '1',
  };
}
function updateThemeButton() {
  const dark = isDark();
  $('theme').textContent = dark ? '☀' : '☾';
  $('theme').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}
$('theme').onclick = () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('theme', next);
  } catch (_) {}
  updateThemeButton();
  graphControl?.setTheme(themeFromCss());
};
darkQuery.addEventListener('change', () => {
  updateThemeButton();
  graphControl?.setTheme(themeFromCss());
});
updateThemeButton();

// Esc clears the selection (search handles its own Esc)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.activeElement !== $('search') && graphControl?.hasSelection()) {
    clearSelection();
  }
});

$('example').onclick = () => show(EXAMPLE_GRAPH);

// Share: the graph on screen and how it is being looked at travel inside the link (after
// "#", never sent to a server). From the extension the link points at the public page.
async function openShareHash() {
  const state = parseHash(location.hash);
  if (!state?.g) return false;
  try {
    if (state.g !== encoded) await show(await decodeGraph(state.g), { encodedGraph: state.g });
  } catch (err) {
    alert(`This share link looks cut off or broken (${err.message}). Ask for it again.`);
    return false;
  }
  if (!graphControl) return true;
  if (state.p) {
    // with a saved view, select in place; without one, pan to the person like search does
    if (state.v) graphControl.select(state.p);
    else focusPerson(state.p);
    pinned = state.c;
    if (pinned) graphControl.showOnly(pinned);
  }
  if (state.v) {
    graphControl.setView(state.v);
    viewTouched = true;
  }
  if (state.n) {
    groupNames = state.n;
    renderGroups();
  }
  updatePanel();
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
  search.setAttribute('aria-expanded', 'false');
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
  search.setAttribute('aria-expanded', String(!results.hidden));
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
    focusPerson(id);
  }, 150);
}

function choose(id) {
  if (!focusPerson(id)) return;
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
  if (crawl) await show(toGraph(crawl));
  else $('empty').hidden = false;
}

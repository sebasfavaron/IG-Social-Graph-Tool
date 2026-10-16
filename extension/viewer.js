import { toGraph } from './lib/crawler.js';
import { drawGraph } from './lib/graphCanvas.js';
import { EXAMPLE_GRAPH } from './lib/example.js';
import { pruneLoneNodes } from './lib/prune.js';
import { friendGroups } from './lib/groups.js';
import { MAX_GROUP_NAME, SHARE_BASE_URL, buildHash, decodeGraph, encodeGraph, parseHash } from './lib/share.js';
import { downloadShare, photosFromThumbs, unpackShare, unseal } from './lib/vault.js';
import { loadGraph, loadPeople, loadPhotos, saveGraph } from './lib/store.js';
import { fromPositional, groupAnchors, namesFor, rename } from './lib/groupNames.js';
import { lang, setLang, t, translateStatic } from './lib/i18n.js';
import { MAX_OWNERS, circles, mergeGraphs, ownGraph } from './lib/merge.js';

const INSTALL_URL = 'https://sebasfavaron.github.io/IG-Social-Graph-Tool/install.html';

const $ = (id) => document.getElementById(id);
// Inside the extension the graph comes from the crawl; as a plain web page (GitHub
// Pages) there is no chrome.storage and the graph comes from a share link.
const inExtension = typeof chrome !== 'undefined' && !!chrome.storage?.local;


let shown = null; // what is on screen, for the share link
let encoded = null; // `shown` packed for the link; filled in the background
let viewTouched = false; // the view goes in the link only once someone zoomed or panned
// Names, photos and flags from the crawl (extension only: share links carry usernames).
let profiles = {}; // username -> { name, pic, private, verified }
let photos = new Map(); // username -> data URL
let ownProfiles = {}; // the crawl's, to go back to after looking at someone's full share
let ownPhotos = new Map();
// The graph on screen as one crawl per owner (two when combined), and which of those
// owners' crawls are in the shared storage exactly as shown: when all are, the link is
// just their usernames (#o=).
let parts = new Map(); // owner -> graph
let storedOwners = new Set();
const nameOf = (id) => profiles[id]?.name || '';
// lower case without accents, so "jose" finds "José"
const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// encodedGraph: the packed form when the graph came from a link, so it is not redone.
// crawls: the one-owner graphs a combined graph was made of; stored: owners whose crawl
// on screen is the one in the shared storage.
// Resolves once the layout is in, so callers can select and move the view.
async function show(graph, { encodedGraph = null, crawls = null, stored = [] } = {}) {
  const username = graph.username || graph.metadata?.loggedUsername;
  // the example is nobody's: it never goes to the storage, and shares as a #g= link
  const example = graph.metadata?.generatedBy === 'example';
  // combined: the other owners, drawn by circle instead of friend group
  const partners = (graph.partners || []).filter((p) => graph.nodes.some((n) => n.id === p));
  const owners = [username, ...partners];
  const combined = partners.length > 0;
  parts = crawls
    ? new Map(crawls.map((c) => [c.username, c]))
    : combined
      ? new Map(owners.map((o) => [o, ownGraph(graph, o)])) // a merged graph from an old link
      : new Map(username && !example ? [[username, graph]] : []);
  storedOwners = new Set(stored);
  peopleLoad++; // names and photos still coming for the previous graph stop landing
  const total = graph.nodes.length;
  const pruned = pruneLoneNodes(graph);
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
  groups = combined ? circleKey(full, owners, hidden) : friendGroups(full, { exclude: username, hidden });
  heading = {
    owners,
    combined,
    people: pruned.nodes.length,
    links: pruned.links.length,
    loners: total - pruned.nodes.length,
    partial: graph.metadata?.complete === false,
    shared: combined ? groups.sizes[0] : 0,
  };
  renderHeading();
  graphControl?.destroy();
  graphControl = pruned.nodes.length
    ? drawGraph($('graph'), full, {
        hidden,
        groupOf: groups.groupOf,
        photos,
        names: new Map(Object.entries(profiles).flatMap(([id, p]) => (p?.name ? [[id, p.name]] : []))),
        theme: themeFromCss(),
        insets: panelInsets,
        onViewChange,
        onSelectionChange,
      })
    : null;
  shown = graphControl ? { ...full, username, partners } : null;
  groupAnchorIds = combined ? [] : groupAnchors(groups.groupOf, full.links, groups.sizes.length);
  groupNames = combined ? [] : loadGroupNames();
  heldGroup = null;
  renderGroups();
  $('share').hidden = !shown;
  updateExplore();
  // someone looking at a shared graph: how to make their own (the extension has it already)
  $('invite').hidden = inExtension || !shown;
  $('combine').hidden = !shown || !username || owners.length >= MAX_OWNERS;
  $('uncombine').hidden = !shown || !combined;
  pinned = null;
  viewTouched = false;
  encoded = encodedGraph;
  if (!inExtension && !encodedGraph) {
    // drop a stale link; a stored graph's short one is rebuilt right away
    if (isStored()) syncUrl();
    else history.replaceState(null, '', location.pathname + location.search);
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

// The title, counts and labels that describe the graph on screen, in the current language.
let heading = null;
function renderHeading() {
  if (!heading) return;
  const { owners, combined, people, links, loners, partial, shared } = heading;
  const [username] = owners;
  const names = owners.map((o) => `@${o}`).join(' + ');
  document.title = combined ? names : username ? t('circleOf', username) : 'IG Social Graph';
  $('title').textContent = combined ? names : username ? `@${username}` : 'IG Social Graph';
  const extra = document.createElement('span');
  extra.className = 'wide-only';
  extra.textContent = loners ? t('loners', loners) : '';
  $('counts').replaceChildren(
    t('counts', people, links),
    extra,
    combined ? t(owners.length === 2 ? 'inBoth' : 'inMoreThanOne', shared) : '',
    partial ? t('partial') : ''
  );
  $('graph').setAttribute('aria-label', t('graphLabel', people, combined ? 0 : groups.sizes.length));
  $('uncombine').querySelector('.label').textContent = t('onlyOwner', username);
}

// a click on the graph selected or cleared someone
function onSelectionChange() {
  pinned = null;
  if (!graphControl?.hasSelection()) search.value = '';
  updatePanel();
}

// The address bar always holds a link to what is on screen (on the public page; an
// extension page's address is no use to anyone else).
function viewState() {
  return {
    p: graphControl?.selected(),
    c: pinned,
    v: viewTouched && graphControl ? graphControl.view() : null,
    n: shown?.partners.length ? null : groupNames,
    m: shown?.partners,
  };
}
// #o= when every crawl on screen is in the shared storage; the graph itself otherwise
const isStored = () => parts.size > 0 && [...parts.keys()].every((o) => storedOwners.has(o));
function currentHash(g) {
  return buildHash({ ...(isStored() ? { o: shown.username } : { g }), ...viewState() });
}
// Explore (explore.html, on the site) reads graphs from the shared storage, so it is
// offered once everything on screen is stored.
function updateExplore() {
  const on = !!shown && isStored();
  $('explore').hidden = !on;
  if (on) $('explore').href = `${SHARE_BASE_URL}explore.html${buildHash({ o: shown.username, m: shown.partners })}`;
}
let syncTimer = null;
function syncUrl() {
  updateExplore();
  if (inExtension || (!encoded && !isStored())) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const hash = currentHash(encoded);
    // Another graph on screen (combined, back to one person, someone else's link) is a new
    // history entry, so Back returns to the previous graph; zoom, selection and names only
    // rewrite the current one. Replacing every time left Back on whatever link was opened
    // before this page.
    const before = graphOf(parseHash(location.hash));
    const url = location.pathname + location.search + hash;
    if (before && before !== graphOf(parseHash(hash))) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  }, 250);
}
// which graph a link shows, regardless of how it is being looked at
function graphOf(state) {
  if (!state) return null;
  if (state.o) return `o:${[state.o, ...state.m].join(',')}`;
  return state.s ? `s:${state.s}` : `g:${state.g}`;
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
const FILTER_FROM = 15; // people in the panel before it offers a filter box
// Headings name the selected person and put the count where a sentence would, so the
// direction of each group reads naturally: "9 follow @x", "@x follows 5".
const LABELS = {
  follower: (name, n) => t('follower', name, n),
  following: (name, n) => t('following', name, n),
  mutual: (name, n) => t('mutual', name, n),
};
const shorten = (name, max = 22) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);
let lastSelected = null;
const narrow = matchMedia('(max-width: 700px)');
// phones show one group at a time, as tabs; picking a tab also shows only its lines
let sheetTab = null;
const TAB_LABELS = {
  mutual: (name, n) => t('tabMutual', n),
  follower: (name, n) => t('tabFollower', n),
  following: (name, n) => t('tabFollowing', n),
};

function personButton(id) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.textContent = `@${id}`;
  if (nameOf(id)) b.title = nameOf(id);
  b.onclick = () => choosePerson(id);
  li.append(b);
  return li;
}

// the panel's top: photo (or initial), username, real name and flags
function paintWho(selected) {
  $('panel-name').textContent = `@${selected}`;
  const profile = profiles[selected];
  $('panel-meta').textContent = [profile?.name, profile?.private && t('private'), profile?.verified && t('verified')]
    .filter(Boolean)
    .join(' · ');
  $('panel-meta').hidden = !$('panel-meta').textContent;
  const hasPhoto = photos.has(selected);
  if (hasPhoto) {
    const img = new Image();
    img.src = photos.get(selected);
    img.alt = '';
    $('avatar').replaceChildren(img);
  } else {
    $('avatar').textContent = (selected.match(/[a-z0-9]/i)?.[0] || '@').toUpperCase();
  }
  $('avatar').disabled = !hasPhoto;
  if (hasPhoto) $('avatar').setAttribute('aria-label', t('showPhotoOf', selected));
  else $('avatar').removeAttribute('aria-label');
  $('avatar').title = hasPhoto ? t('showLarger') : '';
}

// ---- enlarged photo ------------------------------------------------------------------
// The panel's round photo grows into a big one (the motion starts from the avatar's own
// place and size, and goes back there on close). It shows the saved 64 px copy at once,
// blurred, and swaps in the full-size photo when the extension has fetched it (one
// Instagram request per person, kept for the session).
const largePhotos = new Map(); // username -> Promise<data URL>
function largePhoto(username) {
  if (!inExtension || !chrome.runtime?.sendMessage) return Promise.reject(new Error('needs the extension'));
  if (!largePhotos.has(username)) {
    const p = chrome.runtime.sendMessage({ type: 'profilePhoto', username }).then((res) => {
      if (!res?.ok) throw new Error(res?.error || 'no answer');
      return res.data;
    });
    p.catch(() => largePhotos.delete(username));
    largePhotos.set(username, p);
  }
  return largePhotos.get(username);
}

const photoDialog = $('photo-dialog');
const big = $('photo-big');
let photoFor = null;
const motion = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1);

// where the avatar is, as a transform of the big photo's final box
function fromAvatar(box) {
  const a = $('avatar').getBoundingClientRect();
  return `translate(${a.left - box.left}px, ${a.top - box.top}px) scale(${a.width / box.width})`;
}

function openPhoto() {
  const username = graphControl?.selected();
  if (!username || !photos.has(username)) return;
  photoFor = username;
  const side = Math.min(innerWidth - 32, innerHeight - 120, 520);
  const box = { left: (innerWidth - side) / 2, top: (innerHeight - side) / 2 - 16, width: side };
  Object.assign(big.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${side}px`, height: `${side}px` });
  big.src = photos.get(username);
  big.classList.add('low');
  const name = nameOf(username);
  const caption = $('photo-caption');
  caption.style.top = `${box.top + side + 14}px`;
  caption.replaceChildren(`@${username}`);
  if (name) {
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = ` · ${name}`;
    caption.append(span);
  }
  photoDialog.showModal();
  const ms = 380 * motion();
  const ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  big.animate(
    [{ transform: fromAvatar(box), borderRadius: '50%' }, { transform: 'none', borderRadius: '16px' }],
    { duration: ms, easing: ease }
  );
  photoDialog.animate({ opacity: [0, 1] }, { duration: ms * 0.8, pseudoElement: '::backdrop' });
  caption.animate({ opacity: [0, 1], transform: ['translateY(6px)', 'none'] }, { duration: ms, delay: ms * 0.4, fill: 'backwards' });
  largePhoto(username)
    .then((src) => {
      if (photoFor !== username) return;
      const sharp = new Image();
      sharp.onload = () => {
        if (photoFor !== username) return;
        big.src = src;
        big.classList.remove('low');
      };
      sharp.src = src;
    })
    .catch(() => photoFor === username && big.classList.remove('low'));
}

let closing = false;
function closePhoto() {
  if (!photoDialog.open || closing) return;
  closing = true;
  photoFor = null;
  // the final box from its style, not its current rect: a close during the opening
  // motion would otherwise measure a half-grown photo
  const box = { left: parseFloat(big.style.left), top: parseFloat(big.style.top), width: parseFloat(big.style.width) };
  const ms = 280 * motion();
  const ease = 'cubic-bezier(0.4, 0, 0.6, 1)';
  big.getAnimations().forEach((a) => a.cancel());
  const held = [
    $('photo-caption').animate({ opacity: [1, 0] }, { duration: ms * 0.5, fill: 'forwards' }),
    photoDialog.animate({ opacity: [1, 0] }, { duration: ms, pseudoElement: '::backdrop', fill: 'forwards' }),
    big.animate([{ transform: 'none', borderRadius: '16px' }, { transform: fromAvatar(box), borderRadius: '50%' }], {
      duration: ms,
      easing: ease,
      fill: 'forwards',
    }),
  ];
  const done = () => {
    photoDialog.close();
    held.forEach((a) => a.cancel());
    closing = false;
    $('avatar').focus();
  };
  held[2].finished.then(done, done);
}

$('avatar').onclick = openPhoto;
photoDialog.onclick = closePhoto; // the photo, the caption or the dark around it
photoDialog.addEventListener('cancel', (e) => {
  e.preventDefault(); // Esc: close with the same motion
  closePhoto();
});

function updatePanel() {
  const selected = graphControl?.selected() ?? null;
  const people = selected ? graphControl.people() : null;
  if (!people) pinned = null;
  if (selected !== lastSelected) {
    expanded.clear();
    sheetTab = null;
    $('panel-filter').value = '';
  }
  const query = fold($('panel-filter').value.trim());
  const matches = (id) => !query || fold(id).includes(query) || fold(nameOf(id)).includes(query);
  $('panel').hidden = !people;
  document.body.classList.toggle('selected', !!people);
  $('hint').hidden = !!people;
  if (people) {
    if (selected !== lastSelected) paintWho(selected);
    const everyone = people.follower.length + people.following.length + people.mutual.length;
    $('panel-filter').hidden = everyone < FILTER_FROM;
    $('profile').href = `https://www.instagram.com/${encodeURIComponent(selected)}/`;
    $('profile').setAttribute('aria-label', t('openOnInstagramOf', selected));
    for (const section of sections) {
      const cat = section.dataset.cat;
      const ids = [...people[cat]].sort((a, b) => a.localeCompare(b));
      const toggle = section.querySelector('.group-toggle');
      toggle.querySelector('.label').textContent = LABELS[cat](shorten(selected), ids.length);
      toggle.title = pinned === cat ? t('showAllGroups') : t('showOnlyGroup');
      toggle.setAttribute('aria-pressed', String(pinned === cat));
      toggle.disabled = ids.length === 0;
      const renderKey = `${expanded.has(cat)}|${query}`;
      if (selected !== lastSelected || section.dataset.rendered !== renderKey) {
        const list = section.querySelector('ul');
        // a filter shows every match; without one, the first LIST_LIMIT and "Show all"
        const found = ids.filter(matches);
        const shownIds = expanded.has(cat) || query ? found : ids.slice(0, LIST_LIMIT);
        list.replaceChildren(...shownIds.map(personButton));
        if (query && ids.length && !found.length) {
          const li = document.createElement('li');
          li.className = 'none';
          li.textContent = t('noMatch');
          list.append(li);
        }
        if (!query && ids.length > shownIds.length) {
          const li = document.createElement('li');
          const more = document.createElement('button');
          more.className = 'more';
          more.textContent = t('showAll', ids.length);
          more.onclick = () => {
            expanded.add(cat);
            updatePanel();
            list.children[LIST_LIMIT]?.querySelector('button')?.focus();
          };
          li.append(more);
          list.append(li);
        }
        section.dataset.rendered = renderKey;
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
    $('announce').textContent = t('selectionCleared');
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
$('panel-filter').oninput = () => updatePanel();
$('panel-filter').onkeydown = (e) => {
  if (e.key === 'Escape' && $('panel-filter').value) {
    e.stopPropagation(); // clear the filter first, the selection on the next Esc
    $('panel-filter').value = '';
    updatePanel();
  }
};
$('sheet-handle').onclick = () => {
  const folded = document.body.classList.toggle('sheet-folded');
  $('sheet-handle').setAttribute('aria-expanded', String(!folded));
  $('sheet-handle').setAttribute('aria-label', folded ? t('unfoldPanel') : t('foldPanel'));
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
  // a chosen name left in the box came back on focus: the list reopened and selected them again
  search.value = '';
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
let groupNames = []; // per group index, as shown and as put in the link
let groupAnchorIds = []; // each group's most connected person, see groupNames.js
// Saved per account as { anchor username: name }, so a later crawl that renumbers the
// groups keeps each name on its group. Before that they were saved by number.
const namesKey = () => `groupNamesByAnchor:${shown?.username || ''}`;
const oldNamesKey = () => `groupNames:${shown?.username || ''}`;

function readSavedNames() {
  try {
    const saved = localStorage.getItem(namesKey());
    if (saved) return JSON.parse(saved);
    const old = JSON.parse(localStorage.getItem(oldNamesKey()) || '[]');
    const carried = fromPositional(old, groupAnchorIds);
    if (old.length) {
      localStorage.setItem(namesKey(), JSON.stringify(carried));
      localStorage.removeItem(oldNamesKey());
    }
    return carried;
  } catch (_) {
    return {};
  }
}
function loadGroupNames() {
  return namesFor(readSavedNames(), groups.groupOf, groupAnchorIds);
}
function saveGroupName(i, name) {
  groupNames[i] = name;
  try {
    localStorage.setItem(namesKey(), JSON.stringify(rename(readSavedNames(), groups.groupOf, groupAnchorIds, i, name)));
  } catch (_) {}
  syncUrl();
}

// People combined: the key shows circles instead of friend groups, the people in more
// than one circle first, then each owner's own. groupOf holds colour indices: --g5 for
// more than one, and --g2, --g4, --g1, --g3, --g6 per owner in order (two owners keep the
// colours they always had), which the key highlights by.
const OWNER_COLOURS = [1, 3, 0, 2, 5];
const SHARED_COLOUR = 4;
function circleKey(graph, owners, hidden) {
  const { circleOf } = circles({ links: graph.links, username: owners[0], partners: owners.slice(1) });
  const shared = owners.length;
  const colourOf = (c) => (c === shared ? SHARED_COLOUR : OWNER_COLOURS[c]);
  const order = [shared, ...owners.keys()];
  const groupOf = new Map();
  const sizes = order.map(() => 0);
  for (const [id, c] of circleOf) {
    groupOf.set(id, colourOf(c));
    if (!hidden.has(id)) sizes[order.indexOf(c)]++;
  }
  // functions, so the key follows a language change
  const labels = order.map((c) => () =>
    c === shared ? t(owners.length === 2 ? 'circleBoth' : 'circleMany') : t('circleOnly', owners[c])
  );
  return { groupOf, sizes, labels, colours: order.map(colourOf) };
}

let groupsKeyShown = false;
let heldGroup = null; // index into the key's rows, kept on until let go
// pointing leaves the key showing the held group again, or nothing
const pointAt = (index) => graphControl?.highlightGroup(index);
function holdGroup(index) {
  heldGroup = heldGroup === index ? null : index;
  showHeld();
}
function showHeld() {
  graphControl?.holdGroup(heldGroup === null ? null : groups.labels ? groups.colours[heldGroup] : heldGroup);
  for (const [i, li] of [...$('groups-list').children].entries()) {
    li.classList.toggle('held', i === heldGroup);
    li.querySelector('.pick').setAttribute('aria-pressed', String(i === heldGroup));
  }
}
const PEN_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M11.5 1.5a1.8 1.8 0 0 1 2.5 2.5l-8.6 8.6-3.4.9.9-3.4zM10.4 4 4.2 10.2l-.4 1.5 1.5-.4L11.5 5z"/></svg>';

// One row of the key: clicking anywhere on it (but the pencil) keeps that group
// highlighted while the graph is panned and its people clicked; again lets go.
// Pointing at it previews the group.
function groupRow(i, n, colour, text) {
  const li = document.createElement('li');
  li.style.setProperty('--c', `var(--g${colour + 1})`);
  const dot = document.createElement('span');
  dot.className = 'dot';
  // a button, so holding is reachable from the keyboard too
  const pick = document.createElement('button');
  pick.className = 'pick';
  pick.title = t('holdGroup');
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = text;
  const count = document.createElement('span');
  count.className = 'n';
  count.textContent = n;
  pick.append(label, count);
  li.append(dot, pick);
  li.onclick = (e) => !e.target.closest('.rename, input') && holdGroup(i);
  li.addEventListener('mouseenter', () => pointAt(colour));
  li.addEventListener('mouseleave', () => !li.classList.contains('editing') && pointAt(null));
  pick.addEventListener('focus', () => pointAt(colour));
  pick.addEventListener('blur', () => pointAt(null));
  return { li, pick, label };
}

function renderGroups() {
  $('groups').hidden = groups.sizes.length < 2;
  $('groups-count').textContent = groups.labels ? '' : `(${groups.sizes.length})`;
  $('groups-title').firstChild.textContent = groups.labels ? t('circles') : t('friendGroups');
  // open on desktop, folded on phones the first time; after that it stays as the user left it
  if (!groupsKeyShown && !$('groups').hidden) {
    $('groups').open = !narrow.matches;
    groupsKeyShown = true;
  }
  if (groups.labels) {
    $('groups-list').replaceChildren(
      ...groups.sizes.map((n, i) => groupRow(i, n, groups.colours[i], shorten(groups.labels[i](), 26)).li)
    );
    showHeld();
    return;
  }
  $('groups-list').replaceChildren(
    ...groups.sizes.map((n, i) => {
      const { li, pick, label } = groupRow(i, n, i, groupNames[i] || t('groupN', i + 1));
      pick.setAttribute('aria-label', t('groupPeople', label.textContent, n));
      // renaming swaps the row's text for a box, only from the pencil
      const input = document.createElement('input');
      input.hidden = true;
      input.placeholder = t('groupN', i + 1);
      input.maxLength = MAX_GROUP_NAME;
      input.setAttribute('aria-label', t('groupNameLabel', i + 1, n));
      input.oninput = () => saveGroupName(i, input.value.trim());
      let before = '';
      const finish = () => {
        label.textContent = groupNames[i] || t('groupN', i + 1);
        pick.setAttribute('aria-label', t('groupPeople', label.textContent, n));
        li.classList.remove('editing');
        input.hidden = true;
        pick.hidden = false;
        if (!li.matches(':hover')) pointAt(null);
      };
      // block body on purpose: a DOM0 handler returning false cancels the key, so a
      // one-liner `e.key === 'Enter' && …` swallowed every letter typed
      input.onkeydown = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          input.value = before;
          saveGroupName(i, before);
        }
        // back to the pencil: focusing the row would highlight its group over a held one
        if (e.key === 'Enter' || e.key === 'Escape') rename.focus();
      };
      input.addEventListener('blur', finish);
      const rename = document.createElement('button');
      rename.className = 'rename';
      rename.innerHTML = PEN_ICON;
      rename.setAttribute('aria-label', t('renameGroup', i + 1));
      rename.title = t('renameTitle');
      rename.onclick = () => {
        before = groupNames[i] || '';
        input.value = before;
        li.classList.add('editing');
        pick.hidden = true;
        input.hidden = false;
        input.focus();
        input.select();
        pointAt(i);
      };
      li.append(input, rename);
      return li;
    })
  );
  showHeld();
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
  $('theme').setAttribute('aria-label', dark ? t('toLight') : t('toDark'));
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

// ---- language: Spanish by default, English from the toggle next to the theme one ----
function updateLangButton() {
  $('lang').textContent = t('langButton');
  $('lang').setAttribute('aria-label', t('langLabel'));
  $('lang').title = t('langLabel');
}
// the empty screen: run a crawl (extension), or get a link from someone who did (site)
function renderEmptyText() {
  if (inExtension) return void ($('empty-text').textContent = t('emptyExtension'));
  const link = Object.assign(document.createElement('a'), {
    href: INSTALL_URL,
    target: '_blank',
    rel: 'noopener',
    textContent: t('emptySiteLink'),
  });
  $('empty-text').replaceChildren(t('emptySiteBefore'), link, t('emptySiteAfter'));
}
function applyLanguage() {
  document.documentElement.lang = lang;
  translateStatic();
  renderEmptyText();
  updateLangButton();
  updateThemeButton();
  renderHeading();
  renderGroups();
  lastSelected = null; // repaint the person at the top of the panel too
  updatePanel();
}
$('lang').onclick = () => {
  setLang(lang === 'es' ? 'en' : 'es');
  applyLanguage();
};
if (lang !== 'es') applyLanguage();
else updateLangButton();

// Esc clears the selection (search handles its own Esc)
document.addEventListener('keydown', (e) => {
  if (photoDialog.open) return; // Esc closes the photo first, the selection after
  if (e.key === 'Escape' && document.activeElement !== $('search') && graphControl?.hasSelection()) {
    clearSelection();
  }
});

$('example').onclick = () => show(EXAMPLE_GRAPH);

// ---- shared storage (store.js): a crawl per owner, people once ----------------------
// -> { graph, crawls } for #o=owner (and m=partners: every crawl, merged). Names and
// photos come after, with fillPeople, so the graph is drawn without waiting for them.
async function openStored(owner, partners = []) {
  const owners = [owner, ...partners];
  const crawls = await Promise.all(
    owners.map(async (o) => {
      const g = await loadGraph(o);
      if (!g) throw new Error(t('notShared', o));
      return decodeGraph(g);
    })
  );
  const graph = partners.length ? mergeGraphs(...crawls) : crawls[0];
  return { graph, crawls };
}

// Names, then photos, from the shared storage for the people of the graph just shown that
// have none yet; each lands on screen as it arrives. Photos are ~98% of the bytes (12 MB
// for three combined graphs), so they come last, most connected people first. Call right
// after show(): another show() stops what is still coming.
let peopleLoad = 0;
async function fillPeople(graph) {
  const run = peopleLoad;
  const current = () => run === peopleLoad;
  const degree = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const l of graph.links) {
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  }
  const ids = [...degree.keys()].sort((a, b) => degree.get(b) - degree.get(a));
  try {
    const missing = ids.filter((id) => !profiles[id]);
    if (missing.length) {
      const people = await loadPeople(missing, { withPhotos: false });
      if (!current()) return;
      profiles = { ...people.profiles, ...profiles };
      graphControl?.setNames(new Map(Object.entries(profiles).flatMap(([id, p]) => (p?.name ? [[id, p.name]] : []))));
      updatePanel();
      const selected = graphControl?.selected();
      if (selected) paintWho(selected);
      if (document.activeElement === search && search.value) search.oninput();
    }
    photos = new Map(photos); // never add to the crawl's own map
    const mine = photos;
    await loadPhotos(
      ids.filter((id) => !photos.has(id)),
      {
        onBatch: (batch) => {
          if (!current() || photos !== mine) return;
          for (const [u, url] of batch) photos.set(u, url);
          graphControl?.setPhotos(photos);
          const selected = graphControl?.selected();
          if (selected && batch.has(selected)) paintWho(selected);
        },
      }
    );
  } catch (err) {
    console.warn('names or photos did not load', err); // the graph works without them
  }
}

// Links from before the shared storage: names and photos, encrypted (vault.js). Opening
// one copies its crawls over (a combined one is split back into each owner's), replacing
// only graphs stored before that link was made. -> the owners now stored, or null when it
// could not.
async function openFullShare(ref, key) {
  return unpackShare(await unseal(await downloadShare(ref), key));
}
async function copyOver(full, partners, ref) {
  const graph = await decodeGraph(full.g);
  const owner = graph.username;
  if (!owner) return null;
  const owners = [owner, ...partners];
  const combined = partners.length > 0;
  for (const o of owners) {
    const crawl = combined ? ownGraph(graph, o) : graph;
    await saveGraph({
      owner: o,
      g: combined ? await encodeGraph(crawl) : full.g,
      ids: new Set(crawl.nodes.map((n) => n.id)),
      profiles: full.profiles,
      photos: full.photos,
      onlyIfMissing: true,
      fromShare: ref,
    });
  }
  return owners;
}

// ---- combine: a friend's share link drawn together with this graph -----------------
const dialog = $('combine-dialog');
$('combine').onclick = () => {
  $('combine-error').hidden = true;
  $('combine-link').value = '';
  dialog.showModal();
};
$('combine-cancel').onclick = () => dialog.close();
$('combine-form').onsubmit = async (e) => {
  e.preventDefault();
  const fail = (text) => {
    $('combine-error').textContent = text;
    $('combine-error').hidden = false;
  };
  const text = $('combine-link').value.trim();
  const at = text.search(/#[gso]=/);
  const state = at >= 0 ? parseHash(text.slice(at)) : null;
  if (!state?.g && !state?.s && !state?.o) return fail(t('notALink'));
  if (state.m.length) return fail(t('alreadyCombined'));
  if (!shown) return;
  $('combine-go').disabled = true;
  try {
    let friend;
    let friendStored = false;
    if (state.s) {
      // an old link: copied over first, then read like any stored one
      const owners = await copyOver(await openFullShare(state.s, state.k), [], state.s);
      if (!owners) throw new Error(t('noOwner'));
      state.o = owners[0];
    }
    if (state.o) {
      // their names and photos come after the graph is drawn (fillPeople); ours win
      friend = (await openStored(state.o)).graph;
      friendStored = true;
    } else {
      friend = await decodeGraph(state.g);
    }
    // each crawl on screen plus theirs (the example has no crawl of its own)
    const crawls = [...(parts.size ? parts.values() : [shown]), friend];
    const merged = mergeGraphs(...crawls);
    const stored = [...storedOwners].filter((o) => parts.has(o));
    if (friendStored) stored.push(friend.username);
    dialog.close();
    const showing = show(merged, { crawls, stored });
    if (friendStored) fillPeople(merged);
    await showing;
    syncUrl();
  } catch (err) {
    fail(t('couldNotCombine', err.message));
  } finally {
    $('combine-go').disabled = false;
  }
};
$('uncombine').onclick = () => {
  const owner = shown?.username;
  if (!parts.has(owner)) return;
  show(parts.get(owner), { stored: storedOwners.has(owner) ? [owner] : [] }).then(syncUrl);
};

// Share: the graph on screen and how it is being looked at travel inside the link (after
// "#", never sent to a server). From the extension the link points at the public page.
async function openShareHash() {
  const state = parseHash(location.hash);
  if (!state?.g && !state?.s && !state?.o) return false;
  try {
    if (state.s) {
      $('counts').textContent = t('opening');
      const full = await openFullShare(state.s, state.k);
      const owners = await copyOver(full, state.m, state.s).catch(() => null);
      if (owners) {
        // from now on the address is the short one, read from the shared storage
        const hash = buildHash({ ...state, s: null, o: owners[0] });
        history.replaceState(null, '', location.pathname + location.search + hash);
        return openShareHash();
      }
      profiles = full.profiles;
      photos = full.photos;
      const graph = await decodeGraph(full.g);
      graph.partners = state.m;
      await show(graph, { encodedGraph: full.g });
    } else if (state.o) {
      const sameOnScreen = isStored() && shown?.username === state.o && shown.partners.join() === state.m.join();
      if (!sameOnScreen) {
        $('counts').textContent = t('opening');
        const opened = await openStored(state.o, state.m);
        profiles = {};
        photos = new Map();
        const showing = show(opened.graph, { crawls: opened.crawls, stored: opened.crawls.map((c) => c.username) });
        fillPeople(opened.graph);
        await showing;
      }
    } else if (state.g && (state.g !== encoded || isStored())) {
      profiles = ownProfiles;
      photos = ownPhotos;
      const graph = await decodeGraph(state.g);
      graph.partners = state.m;
      await show(graph, { encodedGraph: state.g });
    }
  } catch (err) {
    alert(t('didNotOpen', err.message));
    if (state.s || state.o) $('counts').textContent = '';
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
  if (state.n && !shown?.partners.length) {
    groupNames = state.n;
    renderGroups();
  }
  updatePanel();
  syncUrl(); // the layout can outlast the address's first rewrite, which had no view yet
  return true;
}
// Someone pasted or edited a link (hashchange), or went Back/Forward between graphs this
// page put in the history (popstate; pushState entries do not always fire hashchange).
// Both can fire for one step, so a step is handled once.
let navigating = false;
function onNavigate() {
  if (navigating) return;
  navigating = true;
  setTimeout(() => (navigating = false));
  openShareHash();
}
window.addEventListener('hashchange', onNavigate);
window.addEventListener('popstate', onNavigate);

// Share: each crawl on screen goes to the shared storage with its people's names and
// photos (store.js), and the link carries only the owners' usernames, plus how it is
// being looked at. A crawl already stored as shown is not sent again.
const shareLabel = $('share').innerHTML; // read once: a click mid-"Link copied" would keep that
// back to the button's own words, in the current language
function restoreShare() {
  $('share').innerHTML = shareLabel;
  translateStatic($('share'));
}
let shareFlash = null;
$('share').onclick = async () => {
  if (!shown) return;
  const button = $('share');
  clearTimeout(shareFlash);
  const flash = (text) => {
    button.textContent = text;
    shareFlash = setTimeout(restoreShare, 2500);
  };
  try {
    const missing = [...parts].filter(([o]) => !storedOwners.has(o));
    if (missing.length) {
      button.disabled = true;
      button.textContent = t('uploading');
      for (const [owner, crawl] of missing) {
        await saveGraph({
          owner,
          g: crawl === shown && encoded ? encoded : await encodeGraph(crawl),
          ids: new Set(crawl.nodes.map((n) => n.id)),
          profiles,
          photos,
        });
        storedOwners.add(owner);
      }
      syncUrl(); // on the site the address bar becomes the short link too
    }
    if (!isStored() && !encoded) encoded = await encodeGraph(shown);
  } catch (err) {
    restoreShare();
    alert(t('couldNotShare', err.message));
    return;
  } finally {
    button.disabled = false;
  }
  const url = SHARE_BASE_URL + currentHash(encoded);
  try {
    await navigator.clipboard.writeText(url);
    flash(t('linkCopied'));
  } catch (_) {
    // the upload took long enough for the browser to stop treating this as a click
    restoreShare();
    prompt(t('copyThisLink'), url);
  }
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
      const q = fold(search.value.trim());
      li.append(...highlighted(id, q));
      if (nameOf(id)) {
        const name = document.createElement('span');
        name.className = 'muted';
        name.append(' ', ...highlighted(nameOf(id), q));
        li.append(name);
      }
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

// text with the part matching q in <mark>; folding keeps the length of precomposed text,
// and anything else is shown unmarked
function highlighted(text, q) {
  const folded = fold(text);
  const at = folded.length === text.length ? folded.indexOf(q) : -1;
  if (at < 0 || !q) return [text];
  const mark = document.createElement('mark');
  mark.textContent = text.slice(at, at + q.length);
  return [text.slice(0, at), mark, text.slice(at + q.length)];
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
  const q = fold(search.value.trim());
  if (!q || !graphControl) return closeSearch();
  // usernames first (earliest match first), then real names
  const rank = (id) => {
    const inId = fold(id).indexOf(q);
    if (inId >= 0) return inId;
    const inName = fold(nameOf(id)).indexOf(q);
    return inName >= 0 ? 1000 + inName : -1;
  };
  const ids = graphControl.ids().filter((id) => rank(id) >= 0);
  ids.sort((a, b) => rank(a) - rank(b) || a.length - b.length);
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

$('invite').href = INSTALL_URL;
renderEmptyText();
if (inExtension) {
  const { crawl, thumbs } = await chrome.storage.local.get(['crawl', 'thumbs']);
  profiles = ownProfiles = crawl?.profiles || {};
  photos = ownPhotos = photosFromThumbs(thumbs);
  // photos keep arriving while the crawl runs
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.thumbs) return;
    const fresh = photosFromThumbs(changes.thumbs.newValue);
    if (photos === ownPhotos) photos = fresh;
    ownPhotos = fresh;
    if (photos !== fresh) return; // looking at someone else's full share
    graphControl?.setPhotos(photos);
    const selected = graphControl?.selected();
    if (selected) paintWho(selected);
  });
}
if (!(await openShareHash())) {
  const { crawl } = inExtension ? await chrome.storage.local.get('crawl') : {};
  if (crawl) await show(toGraph(crawl));
  else $('empty').hidden = false;
}

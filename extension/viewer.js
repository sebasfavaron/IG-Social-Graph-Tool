import { toGraph } from './lib/crawler.js';
import { drawGraph } from './lib/graphCanvas.js';
import { EXAMPLE_GRAPH } from './lib/example.js';
import { pruneLoneNodes } from './lib/prune.js';
import { friendGroups } from './lib/groups.js';
import { MAX_GROUP_NAME, SHARE_BASE_URL, buildHash, decodeGraph, encodeGraph, parseHash } from './lib/share.js';
import { createShare, downloadShare, photosFromThumbs, unpackShare, unseal } from './lib/vault.js';
import { fromPositional, groupAnchors, namesFor, rename } from './lib/groupNames.js';
import { CIRCLE, circles, mergeGraphs } from './lib/merge.js';

const INSTALL_URL = 'https://github.com/sebasfavaron/IG-Social-Graph-Tool#map-your-own-followers-chrome-extension';

const $ = (id) => document.getElementById(id);
// Inside the extension the graph comes from the crawl; as a plain web page (GitHub
// Pages) there is no chrome.storage and the graph comes from a share link.
const inExtension = typeof chrome !== 'undefined' && !!chrome.storage?.local;


let shown = null; // what is on screen, for the share link
let encoded = null; // `shown` packed for the link; filled in the background
let viewTouched = false; // the view goes in the link only once someone zoomed or panned
let beforeMerge = null; // the graph shown before combining, to go back to
// Names, photos and flags from the crawl (extension only: share links carry usernames).
let profiles = {}; // username -> { name, pic, private, verified }
let photos = new Map(); // username -> data URL
let ownProfiles = {}; // the crawl's, to go back to after looking at someone's full share
let ownPhotos = new Map();
let shareRef = null; // { s, k } when the graph on screen came from a full-share link
const nameOf = (id) => profiles[id]?.name || '';
// lower case without accents, so "jose" finds "José"
const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// encodedGraph: the packed form when the graph came from a link, so it is not redone.
// Resolves once the layout is in, so callers can select and move the view.
async function show(graph, { encodedGraph = null, fullShare = null } = {}) {
  shareRef = fullShare;
  const username = graph.username || graph.metadata?.loggedUsername;
  const partner = graph.partner && graph.nodes.some((n) => n.id === graph.partner) ? graph.partner : null;
  const total = graph.nodes.length;
  const pruned = pruneLoneNodes(graph);
  document.title = partner ? `@${username} + @${partner}` : username ? `@${username}'s circle` : 'IG Social Graph';
  $('title').textContent = partner ? `@${username} + @${partner}` : username ? `@${username}` : 'IG Social Graph';
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
  groups = partner ? circleKey(full, username, partner, hidden) : friendGroups(full, { exclude: username, hidden });
  if (partner) extra.after(` · ${groups.sizes[0]} in both circles`);
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
  shown = graphControl ? { ...full, username, partner } : null;
  if (!partner) beforeMerge = null;
  groupAnchorIds = partner ? [] : groupAnchors(groups.groupOf, full.links, groups.sizes.length);
  groupNames = partner ? [] : loadGroupNames();
  renderGroups();
  $('graph').setAttribute(
    'aria-label',
    `Follower graph of ${pruned.nodes.length} people` +
      (groups.sizes.length > 1 ? ` in ${groups.sizes.length} friend groups` : '') +
      '. Use search to pick someone; their connections are listed in a panel.'
  );
  $('share').hidden = !shown;
  // someone looking at a shared graph: how to make their own (the extension has it already)
  $('invite').hidden = inExtension || !shown;
  $('combine').hidden = !shown || !username || !!partner;
  $('uncombine').hidden = !beforeMerge;
  if (beforeMerge) $('uncombine').querySelector('.label').textContent = `@${beforeMerge.username} only`;
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
function viewState() {
  return {
    p: graphControl?.selected(),
    c: pinned,
    v: viewTouched && graphControl ? graphControl.view() : null,
    n: shown?.partner ? null : groupNames,
    m: shown?.partner,
  };
}
function currentHash(g) {
  return buildHash({ g, ...(shareRef || {}), ...viewState() });
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
const FILTER_FROM = 15; // people in the panel before it offers a filter box
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
  if (nameOf(id)) b.title = nameOf(id);
  b.onclick = () => choosePerson(id);
  li.append(b);
  return li;
}

// the panel's top: photo (or initial), username, real name and flags
function paintWho(selected) {
  $('panel-name').textContent = `@${selected}`;
  const profile = profiles[selected];
  $('panel-meta').textContent = [profile?.name, profile?.private && 'private', profile?.verified && 'verified']
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
  if (hasPhoto) $('avatar').setAttribute('aria-label', `Show @${selected}'s photo larger`);
  else $('avatar').removeAttribute('aria-label');
  $('avatar').title = hasPhoto ? 'Show larger' : '';
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
    $('profile').setAttribute('aria-label', `Open @${selected} on Instagram (new tab)`);
    for (const section of sections) {
      const cat = section.dataset.cat;
      const ids = [...people[cat]].sort((a, b) => a.localeCompare(b));
      const toggle = section.querySelector('.group-toggle');
      toggle.querySelector('.label').textContent = LABELS[cat](shorten(selected), ids.length);
      toggle.title = pinned === cat ? 'Show all groups again' : 'Show only this group (hover to preview)';
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
          li.textContent = 'No match';
          list.append(li);
        }
        if (!query && ids.length > shownIds.length) {
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

// Two people combined: the key shows circles instead of friend groups. groupOf holds
// colour indices (--g5 both, --g2 first, --g4 second), which the key highlights by.
const CIRCLE_COLOUR = { [CIRCLE.BOTH]: 4, [CIRCLE.FIRST]: 1, [CIRCLE.SECOND]: 3 };
function circleKey(graph, first, second, hidden) {
  const { circleOf } = circles({ links: graph.links, username: first, partner: second });
  const groupOf = new Map();
  const sizes = [0, 0, 0];
  for (const [id, c] of circleOf) {
    groupOf.set(id, CIRCLE_COLOUR[c]);
    if (!hidden.has(id)) sizes[c]++;
  }
  const labels = ['In both circles', `Only @${first}'s`, `Only @${second}'s`];
  return { groupOf, sizes, labels, colours: [CIRCLE.BOTH, CIRCLE.FIRST, CIRCLE.SECOND].map((c) => CIRCLE_COLOUR[c]) };
}

let groupsKeyShown = false;
function renderGroups() {
  $('groups').hidden = groups.sizes.length < 2;
  $('groups-count').textContent = groups.labels ? '' : `(${groups.sizes.length})`;
  $('groups-title').firstChild.textContent = groups.labels ? 'Circles ' : 'Friend groups ';
  // open on desktop, folded on phones the first time; after that it stays as the user left it
  if (!groupsKeyShown && !$('groups').hidden) {
    $('groups').open = !narrow.matches;
    groupsKeyShown = true;
  }
  if (groups.labels) {
    $('groups-list').replaceChildren(
      ...groups.sizes.map((n, i) => {
        const li = document.createElement('li');
        li.style.setProperty('--c', `var(--g${groups.colours[i] + 1})`);
        const dot = document.createElement('span');
        dot.className = 'dot';
        // a button, so the highlight is reachable from the keyboard too
        const label = document.createElement('button');
        label.className = 'circle';
        label.textContent = shorten(groups.labels[i], 26);
        label.title = 'Point at this to highlight its people';
        const count = document.createElement('span');
        count.className = 'n';
        count.textContent = n;
        li.append(dot, label, count);
        const on = () => graphControl?.highlightGroup(groups.colours[i]);
        const off = () => graphControl?.highlightGroup(null);
        li.addEventListener('mouseenter', on);
        li.addEventListener('mouseleave', off);
        label.addEventListener('focus', on);
        label.addEventListener('blur', off);
        return li;
      })
    );
    return;
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
      input.oninput = () => saveGroupName(i, input.value.trim());
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
  if (photoDialog.open) return; // Esc closes the photo first, the selection after
  if (e.key === 'Escape' && document.activeElement !== $('search') && graphControl?.hasSelection()) {
    clearSelection();
  }
});

$('example').onclick = () => show(EXAMPLE_GRAPH);

// ---- full share: names and photos too, encrypted, in the share storage (vault.js) ---
async function openFullShare(ref, key) {
  return unpackShare(await unseal(await downloadShare(ref), key));
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
  const at = text.search(/#[gs]=/);
  const state = at >= 0 ? parseHash(text.slice(at)) : null;
  if (!state?.g && !state?.s) return fail('That is not a share link: they contain "#g=" or "#s=" after the address.');
  if (state.m) return fail('That link already combines two people. Ask for one with only theirs.');
  if (!shown) return;
  $('combine-go').disabled = true;
  try {
    let friend;
    if (state.s) {
      // a full share brings their names and photos; ours win where both have someone
      const full = await openFullShare(state.s, state.k);
      friend = await decodeGraph(full.g);
      profiles = { ...full.profiles, ...profiles };
      photos = new Map([...full.photos, ...photos]);
    } else {
      friend = await decodeGraph(state.g);
    }
    const merged = mergeGraphs(shown, friend);
    const original = shown;
    dialog.close();
    await show(merged);
    beforeMerge = original;
    $('uncombine').hidden = false;
    $('uncombine').querySelector('.label').textContent = `@${original.username} only`;
  } catch (err) {
    fail(`Could not combine: ${err.message}.`);
  } finally {
    $('combine-go').disabled = false;
  }
};
$('uncombine').onclick = () => beforeMerge && show(beforeMerge);

// Share: the graph on screen and how it is being looked at travel inside the link (after
// "#", never sent to a server). From the extension the link points at the public page.
async function openShareHash() {
  const state = parseHash(location.hash);
  if (!state?.g && !state?.s) return false;
  try {
    if (state.s && state.s !== shareRef?.s) {
      $('counts').textContent = 'Opening the shared graph…';
      const full = await openFullShare(state.s, state.k);
      profiles = full.profiles;
      photos = full.photos;
      const graph = await decodeGraph(full.g);
      if (state.m) graph.partner = state.m;
      await show(graph, { encodedGraph: full.g, fullShare: { s: state.s, k: state.k } });
    } else if (state.g && (state.g !== encoded || shareRef)) {
      profiles = ownProfiles;
      photos = ownPhotos;
      const graph = await decodeGraph(state.g);
      if (state.m) graph.partner = state.m;
      await show(graph, { encodedGraph: state.g });
    }
  } catch (err) {
    alert(`This share link did not open: ${err.message}. Ask for it again.`);
    if (state.s) $('counts').textContent = '';
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
  if (state.n && !shown?.partner) {
    groupNames = state.n;
    renderGroups();
  }
  updatePanel();
  return true;
}
window.addEventListener('hashchange', openShareHash); // someone pasted or edited a link

// Share: the graph with names and photos, encrypted and stored (vault.js); the link
// carries its id and key, plus how it is being looked at. Sharing the same graph again,
// or one that came from a share link, reuses that upload.
const shareLabel = $('share').innerHTML; // read once: a click mid-"Link copied" would keep that
let shareFlash = null;
$('share').onclick = async () => {
  if (!shown) return;
  const button = $('share');
  const label = shareLabel;
  clearTimeout(shareFlash);
  const flash = (text) => {
    button.textContent = text;
    shareFlash = setTimeout(() => (button.innerHTML = label), 2500);
  };
  try {
    if (!shareRef) {
      button.disabled = true;
      button.textContent = 'Uploading…';
      shareRef = await createShare({
        g: encoded || (await encodeGraph(shown)),
        ids: new Set(shown.nodes.map((n) => n.id)),
        profiles,
        photos,
      });
      syncUrl(); // on the site the address bar becomes the short link too
    }
  } catch (err) {
    button.innerHTML = label;
    alert(`Could not share: ${err.message}.`);
    return;
  } finally {
    button.disabled = false;
  }
  const url = SHARE_BASE_URL + buildHash({ ...shareRef, ...viewState() });
  try {
    await navigator.clipboard.writeText(url);
    flash('Link copied');
  } catch (_) {
    // the upload took long enough for the browser to stop treating this as a click
    button.innerHTML = label;
    prompt('Copy this link:', url);
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

// Friend-group names that stay on the right group across crawls. Groups are numbered by
// size, so a later crawl that changes the sizes renumbers them; a name saved by number
// would land on another group. Each name is saved with the group's anchor instead (its
// most connected person) and goes back to whichever group that person is in now.
//
// saved: { [anchorUsername]: name }

// The most connected person of each group; ties go to the lower username, so it is stable.
export function groupAnchors(groupOf, links, groupCount) {
  const degree = new Map();
  for (const { source, target } of links) {
    for (const id of [source, target]) if (groupOf.has(id)) degree.set(id, (degree.get(id) || 0) + 1);
  }
  const anchors = new Array(groupCount).fill(null);
  for (const [id, g] of groupOf) {
    const best = anchors[g];
    const d = degree.get(id) || 0;
    if (best === null || d > degree.get(best) || (d === degree.get(best) && id < best)) anchors[g] = id;
  }
  return anchors;
}

// Names per group index. When two saved anchors are now in the same group (two groups
// merged), the group's own anchor wins, then the first one saved.
export function namesFor(saved, groupOf, anchors) {
  const names = anchors.map((anchor) => saved[anchor] || '');
  for (const [id, name] of Object.entries(saved)) {
    const g = groupOf.get(id);
    if (g !== undefined && !names[g] && name) names[g] = name;
  }
  return names;
}

// Renames group i: drops whatever was saved for anyone now in it, saves under its anchor.
export function rename(saved, groupOf, anchors, i, name) {
  const next = Object.fromEntries(Object.entries(saved).filter(([id]) => groupOf.get(id) !== i));
  if (name && anchors[i]) next[anchors[i]] = name;
  return next;
}

// Names saved by group number (before anchors): attached to today's anchors, once.
export function fromPositional(names, anchors) {
  const saved = {};
  names.forEach((name, i) => name && anchors[i] && (saved[anchors[i]] = name));
  return saved;
}

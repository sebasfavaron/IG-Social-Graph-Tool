// Friend groups, found from who-follows-whom alone (label propagation): everyone starts in
// a group of their own, then repeatedly joins the group most common among the people
// they're connected to, until nothing changes. Follow direction is ignored.
//
// The logged user is left out (they connect to everyone, which would merge every group
// into one), and so are hidden loners. Groups smaller than MIN_SIZE get no colour.
// Deterministic: same graph, same groups.

const MIN_SIZE = 5;
const MAX_GROUPS = 6;
const MAX_ROUNDS = 30;

// returns { groupOf: Map<id, groupIndex>, sizes: number[] } with groups sorted by size
export function friendGroups({ nodes, links }, { exclude = null, hidden = new Set() } = {}) {
  const ids = nodes.map((n) => n.id).filter((id) => id !== exclude && !hidden.has(id));
  const neighbours = new Map(ids.map((id) => [id, []]));
  for (const { source, target } of links) {
    const s = typeof source === 'object' ? source.id : source;
    const t = typeof target === 'object' ? target.id : target;
    if (s === t || !neighbours.has(s) || !neighbours.has(t)) continue;
    neighbours.get(s).push(t);
    neighbours.get(t).push(s);
  }

  const label = new Map(ids.map((id, i) => [id, i]));
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    for (const id of ids) {
      const votes = new Map();
      for (const m of neighbours.get(id)) votes.set(label.get(m), (votes.get(label.get(m)) || 0) + 1);
      let best = label.get(id);
      let bestVotes = votes.get(best) || 0;
      for (const [l, v] of votes) {
        if (v > bestVotes || (v === bestVotes && l < best)) {
          best = l;
          bestVotes = v;
        }
      }
      if (best !== label.get(id)) {
        label.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const size = new Map();
  for (const l of label.values()) size.set(l, (size.get(l) || 0) + 1);
  const kept = [...size]
    .filter(([, n]) => n >= MIN_SIZE)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, MAX_GROUPS);
  const index = new Map(kept.map(([l], i) => [l, i]));
  const groupOf = new Map();
  for (const [id, l] of label) if (index.has(l)) groupOf.set(id, index.get(l));
  return { groupOf, sizes: kept.map(([, n]) => n) };
}

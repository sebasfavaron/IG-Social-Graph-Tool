// Friend groups, found from who-follows-whom alone, by modularity (the Louvain method):
// everyone starts alone, then each person moves to the neighbouring group that most
// increases "more links inside groups than chance would give", until no move helps; then
// each group becomes one node and the same runs again on that smaller graph. Follow
// direction is ignored; a mutual follow weighs 2.
//
// (Label propagation was tried first: with ties broken by lowest label, a couple of
// bridges between friend groups were enough for one label to flood the whole graph.)
//
// The logged user is left out (they connect to everyone, which would pull every group
// together), and so are hidden loners. Groups smaller than MIN_SIZE get no colour.
// Deterministic: same graph, same groups, so a group's name stays on it.

const MIN_SIZE = 5;
const MAX_GROUPS = 6;
const MAX_PASSES = 30;

// returns { groupOf: Map<id, groupIndex>, sizes: number[] } with groups sorted by size
export function friendGroups({ nodes, links }, { exclude = null, hidden = new Set() } = {}) {
  const ids = nodes.map((n) => n.id).filter((id) => id !== exclude && !hidden.has(id));
  const index = new Map(ids.map((id, i) => [id, i]));
  const weights = ids.map(() => new Map()); // i -> (j -> weight)
  for (const { source, target } of links) {
    const s = index.get(typeof source === 'object' ? source.id : source);
    const t = index.get(typeof target === 'object' ? target.id : target);
    if (s === undefined || t === undefined || s === t) continue;
    weights[s].set(t, (weights[s].get(t) || 0) + 1);
    weights[t].set(s, (weights[t].get(s) || 0) + 1);
  }
  // Louvain: local moving, then merge each group into one node and repeat on the smaller
  // graph, until no merge happens. Local moving alone leaves groups split into fragments.
  let adj = weights; // node -> (neighbour -> weight), symmetric, no self entries
  let self = ids.map(() => 0); // weight inside a merged node
  let degree = adj.map((w, i) => [...w.values()].reduce((a, b) => a + b, 0) + 2 * self[i]);
  const twoM = degree.reduce((a, b) => a + b, 0) || 1;
  let member = ids.map((_, i) => i); // original person -> current node
  for (let level = 0; level < 10; level++) {
    const n = adj.length;
    const group = adj.map((_, i) => i);
    const total = [...degree];
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        if (!degree[i]) continue;
        const own = group[i];
        total[own] -= degree[i];
        const into = new Map(); // links from i into each neighbouring group
        for (const [j, w] of adj[i]) into.set(group[j], (into.get(group[j]) || 0) + w);
        // gain of putting i in group c: links into c minus what chance would give
        const gain = (c) => (into.get(c) || 0) - (total[c] * degree[i]) / twoM;
        let best = own;
        let bestGain = gain(own);
        for (const c of into.keys()) {
          const g = gain(c);
          if (g > bestGain + 1e-12 || (Math.abs(g - bestGain) <= 1e-12 && c < best && best !== own)) {
            best = c;
            bestGain = g;
          }
        }
        group[i] = best;
        total[best] += degree[i];
        if (best !== own) moved = true;
      }
      if (!moved) break;
    }
    // renumber groups 0..k-1 in order of first appearance
    const renumber = new Map();
    for (const g of group) if (!renumber.has(g)) renumber.set(g, renumber.size);
    const k = renumber.size;
    member = member.map((m) => renumber.get(group[m]));
    if (k === n) break; // nothing merged: done
    const nextAdj = Array.from({ length: k }, () => new Map());
    const nextSelf = Array.from({ length: k }, () => 0);
    for (let i = 0; i < n; i++) {
      const gi = renumber.get(group[i]);
      nextSelf[gi] += self[i];
      for (const [j, w] of adj[i]) {
        const gj = renumber.get(group[j]);
        if (gi === gj) nextSelf[gi] += w / 2; // each inside link is seen from both ends
        else nextAdj[gi].set(gj, (nextAdj[gi].get(gj) || 0) + w);
      }
    }
    adj = nextAdj;
    self = nextSelf;
    degree = adj.map((w, i) => [...w.values()].reduce((a, b) => a + b, 0) + 2 * self[i]);
  }
  const group = member;

  const size = new Map();
  for (const g of group) size.set(g, (size.get(g) || 0) + 1);
  const kept = [...size]
    .filter(([, n]) => n >= MIN_SIZE)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, MAX_GROUPS);
  const order = new Map(kept.map(([g], i) => [g, i]));
  const groupOf = new Map();
  ids.forEach((id, i) => order.has(group[i]) && groupOf.set(id, order.get(group[i])));
  return { groupOf, sizes: kept.map(([, n]) => n) };
}

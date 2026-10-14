// Drops accounts with at most one connection (usually just "follows me": shops, meme
// pages, people outside the friend circle). Repeats until stable, because removing a
// node can leave a neighbour with a single connection.
export function pruneLoneNodes({ nodes, links, ...rest }) {
  let keptNodes = nodes;
  let keptLinks = links;
  for (;;) {
    const degree = new Map();
    for (const { source, target } of keptLinks) {
      degree.set(source, (degree.get(source) || 0) + 1);
      degree.set(target, (degree.get(target) || 0) + 1);
    }
    const next = keptNodes.filter((n) => (degree.get(n.id) || 0) > 1);
    if (next.length === keptNodes.length) break;
    const ids = new Set(next.map((n) => n.id));
    keptNodes = next;
    keptLinks = keptLinks.filter((l) => ids.has(l.source) && ids.has(l.target));
  }
  return { ...rest, nodes: keptNodes, links: keptLinks };
}

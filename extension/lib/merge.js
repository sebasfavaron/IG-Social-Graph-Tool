// Several people's graphs drawn as one: everyone any of them knows, every follow any
// crawl saw, and each person marked by whose circles they are in. A share link names the
// owners (o= the first, m= the rest), which is how the viewer knows to colour by circle.
//
// Circles are read from the merged links: every person in a crawl is linked to its owner
// (they follow the owner, or the owner follows them), so "in @b's circle" means "linked
// to @b". One crawl can also see a follow of another owner's (when @b follows one of
// @a's followers); that person then counts as in both circles, which they are.

export const MAX_OWNERS = 5; // one colour each, plus one for people in more than one circle

const idOf = (end) => (typeof end === 'object' ? end.id : end);

export function mergeGraphs(...graphs) {
  const owners = graphs.map((g) => g.username);
  if (owners.some((o) => !o)) throw new Error('every link needs to say whose graph it is');
  const twice = owners.find((o, i) => owners.indexOf(o) !== i);
  if (twice) throw new Error(`@${twice}'s graph is in already`);
  if (owners.length > MAX_OWNERS) throw new Error(`at most ${MAX_OWNERS} people can be combined`);
  const nodes = new Map();
  for (const g of graphs) for (const n of g.nodes) if (!nodes.has(n.id)) nodes.set(n.id, { id: n.id, group: 1 });
  const seen = new Set();
  const links = [];
  for (const g of graphs) {
    for (const l of g.links) {
      const source = idOf(l.source);
      const target = idOf(l.target);
      const key = `${source}\0${target}`;
      if (source === target || seen.has(key)) continue;
      seen.add(key);
      links.push({ source, target, value: 1 });
    }
  }
  const [first, ...partners] = owners;
  return {
    username: first,
    partners,
    metadata: { loggedUsername: first, partners, generatedBy: 'merge', complete: graphs.every((g) => g.metadata?.complete !== false) },
    nodes: [...nodes.values()],
    links,
  };
}

// { circleOf: Map<id, circle>, sizes } with owners = [username, ...partners]: circle i
// (< owners.length) is "only in owners[i]'s", and owners.length is "in more than one".
// The owners themselves get no circle (each is linked to everyone in their own).
export function circles({ links, username, partners }) {
  const owners = [username, ...partners];
  const index = new Map(owners.map((o, i) => [o, i]));
  const circlesOf = new Map(); // id -> Set of owner indexes
  const add = (id, owner) => {
    if (index.has(id)) return;
    if (!circlesOf.has(id)) circlesOf.set(id, new Set());
    circlesOf.get(id).add(index.get(owner));
  };
  for (const l of links) {
    const s = idOf(l.source);
    const t = idOf(l.target);
    if (index.has(s)) add(t, s);
    if (index.has(t)) add(s, t);
  }
  const shared = owners.length;
  const circleOf = new Map();
  const sizes = new Array(owners.length + 1).fill(0);
  for (const [id, set] of circlesOf) {
    const c = set.size > 1 ? shared : [...set][0];
    circleOf.set(id, c);
    sizes[c]++;
  }
  return { circleOf, sizes };
}

// One owner's graph back out of a merged one: them, everyone linked to them, and every
// follow among those people. Old merged share links carried no other copy of each crawl.
// A follow among those people that only the other crawl saw comes along; it is real too.
export function ownGraph({ links }, owner) {
  const ids = new Set([owner]);
  for (const l of links) {
    const s = idOf(l.source);
    const t = idOf(l.target);
    if (s === owner) ids.add(t);
    else if (t === owner) ids.add(s);
  }
  return {
    username: owner,
    metadata: { loggedUsername: owner, generatedBy: 'split' },
    nodes: [...ids].map((id) => ({ id, group: 1 })),
    links: links
      .filter((l) => ids.has(idOf(l.source)) && ids.has(idOf(l.target)))
      .map((l) => ({ source: idOf(l.source), target: idOf(l.target), value: 1 })),
  };
}

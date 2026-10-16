// Two people's graphs drawn as one: everyone either of them knows, every follow either
// crawl saw, and each person marked by whose circle they are in. A share link carries the
// merged graph like any other, plus the second owner's username (m=), which is how the
// viewer knows to colour by circle.
//
// Circles are read from the merged links: every person in a crawl is linked to its owner
// (they follow the owner, or the owner follows them), so "in @b's circle" means "linked
// to @b". One crawl can also see a follow of the other owner's (when @b follows one of
// @a's followers); that person then counts as in both circles, which they are.

export const CIRCLE = { BOTH: 0, FIRST: 1, SECOND: 2 };

const idOf = (end) => (typeof end === 'object' ? end.id : end);

export function mergeGraphs(a, b) {
  const first = a.username;
  const second = b.username;
  if (!first || !second) throw new Error('both links need to say whose graph they are');
  if (first === second) throw new Error(`both graphs are @${first}'s`);
  const nodes = new Map();
  for (const n of [...a.nodes, ...b.nodes]) if (!nodes.has(n.id)) nodes.set(n.id, { id: n.id, group: 1 });
  const seen = new Set();
  const links = [];
  for (const l of [...a.links, ...b.links]) {
    const source = idOf(l.source);
    const target = idOf(l.target);
    const key = `${source}\0${target}`;
    if (source === target || seen.has(key)) continue;
    seen.add(key);
    links.push({ source, target, value: 1 });
  }
  return {
    username: first,
    partner: second,
    metadata: { loggedUsername: first, partner: second, generatedBy: 'merge', complete: a.metadata?.complete !== false && b.metadata?.complete !== false },
    nodes: [...nodes.values()],
    links,
  };
}

// { circleOf: Map<id, CIRCLE>, sizes: [both, first only, second only] }; the two owners
// get no circle (each is linked to everyone in their own).
export function circles({ links, username, partner }) {
  const linked = (owner) => {
    const out = new Set();
    for (const l of links) {
      const s = idOf(l.source);
      const t = idOf(l.target);
      if (s === owner) out.add(t);
      else if (t === owner) out.add(s);
    }
    return out;
  };
  const first = linked(username);
  const second = linked(partner);
  const circleOf = new Map();
  const sizes = [0, 0, 0];
  for (const id of new Set([...first, ...second])) {
    if (id === username || id === partner) continue;
    const c = first.has(id) && second.has(id) ? CIRCLE.BOTH : first.has(id) ? CIRCLE.FIRST : CIRCLE.SECOND;
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

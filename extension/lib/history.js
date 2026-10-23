// A published graph over time. Each republish stores what it changed (db/graphs.sql,
// graph_changes): the follows added and removed, [time in ms, '+' or '-', source, target].
// The graph at an earlier moment is today's with every change after it undone, so the
// database keeps one graph per owner and a short list of changes, not a copy per publish.

const key = (s, t) => `${s}\u0000${t}`;
const idOf = (end) => (end && typeof end === 'object' ? end.id : end); // d3 swaps ids for nodes

function follows(graph) {
  const map = new Map();
  for (const link of graph.links) {
    const s = idOf(link.source);
    const t = idOf(link.target);
    if (s !== t) map.set(key(s, t), [s, t]);
  }
  return map;
}

// What turns the graph `before` into `after`, oldest first. Each change takes the moment
// the crawl noticed it (crawler.js state.history, entries newer than `since`) when there is
// one, otherwise `now`. The follows from the owner (owner -> X) are not in the crawl's
// list; they come with X's first follow the crawl saw come or go.
export function diffGraphs(before, after, { history = [], since = 0, now = Date.now() } = {}) {
  const owner = after.username ?? before.username;
  const seen = new Map(); // op + link -> time
  const bySource = new Map(); // op + source -> earliest time
  for (const [time, op, a, b] of history) {
    if (time <= since || time > now || (op !== '+' && op !== '-')) continue;
    seen.set(op + key(a, b), time);
    if (!bySource.has(op + a)) bySource.set(op + a, time);
  }
  const timeOf = (op, s, t) => seen.get(op + key(s, t)) ?? (s === owner ? bySource.get(op + t) : undefined) ?? now;
  const old = follows(before);
  const fresh = follows(after);
  const changes = [];
  for (const [k, [s, t]] of old) if (!fresh.has(k)) changes.push([timeOf('-', s, t), '-', s, t]);
  for (const [k, [s, t]] of fresh) if (!old.has(k)) changes.push([timeOf('+', s, t), '+', s, t]);
  return changes.sort((x, y) => x[0] - y[0]);
}

// The graph as it was at `time`, from today's and its versions ([{ at: ms, changes }],
// oldest first, as get_graph_history gives them). null when a version that wrote nothing
// down (changes null) lies after `time`: what came before it is unknown. Each change's own
// time decides, not the version's: the database's clock and the browser's differ.
export function graphAt(graph, versions, time) {
  const links = follows(graph);
  const touched = new Set();
  for (let v = versions.length - 1; v >= 0; v--) {
    const { at, changes } = versions[v];
    if (!changes) {
      if (at > time) return null;
      break; // nothing before it can be undone, and nothing needs to be
    }
    for (let i = changes.length - 1; i >= 0; i--) {
      const [when, op, s, t] = changes[i];
      if (when <= time) break;
      if (op === '+') links.delete(key(s, t));
      else if (op === '-') links.set(key(s, t), [s, t]);
      touched.add(s).add(t);
    }
  }
  // someone a change touched is in the graph if a follow still holds them; the rest stay
  const ids = new Set(graph.nodes.map((n) => n.id).filter((id) => !touched.has(id)));
  for (const [s, t] of links.values()) ids.add(s).add(t);
  if (graph.username) ids.add(graph.username);
  return {
    ...graph,
    nodes: [...ids].map((id) => ({ id, group: 1 })),
    links: [...links.values()].map(([source, target]) => ({ source, target, value: 1 })),
  };
}

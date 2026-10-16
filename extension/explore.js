import { decodeGraph, parseHash, buildHash } from './lib/share.js';
import { loadGraph, loadPeople } from './lib/store.js';
import { mergeGraphs, MAX_OWNERS } from './lib/merge.js';

// SQL over the shared graphs, in the page: the graphs (and names, no photos) come from the
// shared storage like in the viewer, and go into an in-memory SQLite (sql.js, ~290 KB
// over the wire) as four small tables. Nothing is written anywhere.

const $ = (id) => document.getElementById(id);
const ROW_LIMIT = 1000; // rows drawn; the count says how many there were

// The graph page: index.html on the site, viewer.html when serving extension/ locally.
const viewerUrl = new URL(location.hostname.endsWith('github.io') ? './' : 'viewer.html', location.href);

// Example questions. {0} is the first owner; {a} and {b} the last two (with two owners,
// {0} and {1}). needs: how many owners the question makes sense with.
const EXAMPLES = [
  {
    title: 'Most followed people in these graphs',
    needs: 1,
    sql: `select f.target as username, p.name, count(*) as followers_here
from follows f left join people p on p.username = f.target
group by f.target
order by followers_here desc
limit 30;`,
  },
  {
    title: 'Who {0} follows that does not follow back',
    needs: 1,
    sql: `select f.target as username, p.name
from follows f left join people p on p.username = f.target
where f.source = '{0}'
  and not exists (select 1 from follows back where back.source = f.target and back.target = '{0}')
order by username;`,
  },
  {
    title: 'Most connected people inside each circle',
    needs: 1,
    sql: `-- follows each person has with others in the same circle, top 5 per circle
with inside as (
  select c.owner, c.username, count(*) as links
  from circles c
  join edges e on e.a = c.username
  join circles other on other.owner = c.owner and other.username = e.b
  group by c.owner, c.username
)
select owner, username, links from (
  select *, row_number() over (partition by owner order by links desc) as rank from inside
)
where rank <= 5
order by owner, links desc;`,
  },
  {
    title: 'People in more than one circle',
    needs: 2,
    sql: `select c.username, p.name, group_concat(c.owner, ', ') as circles, count(*) as how_many
from circles c left join people p on p.username = c.username
where c.username not in (select username from owners)
group by c.username
having count(*) > 1
order by how_many desc, c.username;`,
  },
  {
    title: 'Do {a} and {b} follow each other?',
    needs: 2,
    sql: `select source, target from follows
where (source = '{a}' and target = '{b}')
   or (source = '{b}' and target = '{a}');`,
  },
  {
    title: "In both {a}'s and {b}'s circles, and whether {0} knows them",
    needs: 3,
    sql: `select x.username, p.name,
  exists (select 1 from circles c where c.owner = '{0}' and c.username = x.username) as known_by_{0x}
from circles x
join circles y on y.username = x.username and y.owner = '{b}'
left join people p on p.username = x.username
where x.owner = '{a}' and x.username not in (select username from owners)
order by known_by_{0x}, x.username;`,
  },
  {
    title: 'Paths from {a} to {b} that avoid {0} (up to 3 steps)',
    needs: 3,
    sql: `-- every route of up to 3 follows (either direction), never through {0}
with recursive reach(node, steps, path) as (
  select '{a}', 0, '>{a}>'
  union all
  select e.b, r.steps + 1, r.path || e.b || '>'
  from reach r join edges e on e.a = r.node
  where r.steps < 3 and r.node <> '{b}' and e.b <> '{0}'
    and instr(r.path, '>' || e.b || '>') = 0
)
select steps, trim(replace(path, '>', ' → '), ' →') as path
from reach where node = '{b}'
order by steps, path
limit 50;`,
  },
];

let SQL = null; // the sql.js module
let db = null;
let owners = [];

const sqlReady = window
  .initSqlJs({ locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}` })
  .then((module) => (SQL = module));

function ownersFromHash() {
  const state = parseHash(location.hash);
  return state?.o ? [state.o, ...state.m] : [];
}

async function load(list) {
  owners = list;
  $('owners').value = owners.join(', ');
  $('back').href = new URL(buildHash({ o: owners[0], m: owners.slice(1) }), viewerUrl).href;
  history.replaceState(null, '', location.pathname + buildHash({ o: owners[0], m: owners.slice(1) }));
  $('load').disabled = $('run').disabled = true;
  $('status').textContent = 'Loading…';
  const started = performance.now();
  try {
    const crawls = await Promise.all(
      owners.map(async (o) => {
        const g = await loadGraph(o);
        if (!g) throw new Error(`@${o} has not shared a graph yet`);
        return decodeGraph(g);
      })
    );
    const graph = owners.length > 1 ? mergeGraphs(...crawls) : crawls[0];
    const ids = graph.nodes.map((n) => n.id);
    const [{ profiles }] = await Promise.all([loadPeople(ids, { withPhotos: false }), sqlReady]);
    db?.close();
    db = new SQL.Database();
    fill(db, graph, profiles);
    $('status').textContent = `${ids.length} people · ${graph.links.length} follows · ${Math.round(performance.now() - started)} ms`;
    renderExamples();
    $('run').disabled = false;
  } catch (err) {
    $('status').textContent = '';
    showError(`Could not load: ${err.message}`);
  } finally {
    $('load').disabled = false;
  }
}

function fill(database, graph, profiles) {
  database.run(`
    create table owners (username text primary key, position integer);
    create table people (username text primary key, name text, private integer, verified integer);
    create table follows (source text, target text, primary key (source, target));
    create table circles (owner text, username text, primary key (owner, username));
    create index follows_target on follows (target);
    create index circles_username on circles (username);
    create view edges as select source as a, target as b from follows union select target, source from follows;
  `);
  database.run('begin');
  const insert = (sql, rows) => {
    const statement = database.prepare(sql);
    for (const row of rows) statement.run(row);
    statement.free();
  };
  insert('insert into owners values (?, ?)', owners.map((o, i) => [o, i]));
  insert(
    'insert into people values (?, ?, ?, ?)',
    graph.nodes.map(({ id }) => {
      const p = profiles[id];
      return [id, p?.name || null, p ? +p.private : null, p ? +p.verified : null];
    })
  );
  insert('insert or ignore into follows values (?, ?)', graph.links.map((l) => [l.source, l.target]));
  // a circle: everyone linked to its owner, either way (see merge.js)
  const circleRows = new Set();
  for (const { source, target } of graph.links) {
    if (owners.includes(source)) circleRows.add(`${source}\0${target}`);
    if (owners.includes(target)) circleRows.add(`${target}\0${source}`);
  }
  insert('insert into circles values (?, ?)', [...circleRows].map((key) => key.split('\0')));
  database.run('commit');
}

// ---- examples -------------------------------------------------------------------
function fillIn(text) {
  const [a, b] = owners.length >= 3 ? owners.slice(-2) : owners;
  return text
    .replaceAll('{0x}', (owners[0] || '').replace(/[^A-Za-z0-9_]/g, '_'))
    .replaceAll('{0}', owners[0])
    .replaceAll('{1}', owners[1])
    .replaceAll('{a}', a)
    .replaceAll('{b}', b);
}

function renderExamples() {
  const usable = EXAMPLES.filter((e) => owners.length >= e.needs);
  $('examples').replaceChildren(
    new Option('Example questions…', ''),
    ...usable.map((e) => new Option(fillIn(e.title), EXAMPLES.indexOf(e)))
  );
  // start on the most telling question these owners allow
  if (!$('sql').value.trim()) pick([5, 3, 0].map((i) => EXAMPLES[i]).find((e) => usable.includes(e)));
}

function pick(example) {
  if (!example) return;
  $('sql').value = fillIn(example.sql);
  run();
}

$('examples').onchange = () => {
  const example = EXAMPLES[$('examples').value];
  $('examples').value = '';
  pick(example);
};

// ---- running ----------------------------------------------------------------------
function showError(text) {
  $('error').textContent = text;
  $('error').hidden = !text;
}

function run() {
  if (!db) return;
  showError('');
  const started = performance.now();
  let results;
  try {
    results = db.exec($('sql').value);
  } catch (err) {
    $('results').hidden = true;
    $('summary').textContent = '';
    return showError(err.message);
  }
  const ms = Math.round(performance.now() - started);
  const last = results[results.length - 1];
  if (!last) {
    $('results').hidden = true;
    $('summary').textContent = `No rows · ${ms} ms`;
    return;
  }
  const { columns, values } = last;
  $('summary').textContent =
    `${values.length} ${values.length === 1 ? 'row' : 'rows'}` +
    (values.length > ROW_LIMIT ? ` (first ${ROW_LIMIT} shown)` : '') +
    ` · ${ms} ms`;
  renderTable(columns, values.slice(0, ROW_LIMIT));
}

let known = new Set(); // usernames, so cells holding one become links
function renderTable(columns, rows) {
  if (db) known = new Set(db.exec('select username from people')[0]?.values.flat() || []);
  const head = document.createElement('tr');
  head.append(...columns.map((c) => Object.assign(document.createElement('th'), { textContent: c })));
  const body = rows.map((row) => {
    const tr = document.createElement('tr');
    tr.append(
      ...row.map((value) => {
        const td = document.createElement('td');
        if (typeof value === 'number') td.className = 'num';
        if (typeof value === 'string' && known.has(value)) {
          const hash = buildHash({ o: owners[0], m: owners.slice(1), p: value });
          td.append(Object.assign(document.createElement('a'), { href: new URL(hash, viewerUrl).href, textContent: value }));
        } else {
          td.textContent = value ?? '';
        }
        return td;
      })
    );
    return tr;
  });
  $('table').replaceChildren(head, ...body);
  $('results').hidden = false;
}

$('run').onclick = run;
$('sql').onkeydown = (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    run();
  }
};

$('load-form').onsubmit = (e) => {
  e.preventDefault();
  const list = $('owners')
    .value.split(/[\s,]+/)
    .map((o) => o.replace(/^@/, ''))
    .filter(Boolean);
  if (!list.length) return;
  if (list.length > MAX_OWNERS) return showError(`At most ${MAX_OWNERS} graphs at once.`);
  showError('');
  load([...new Set(list)]);
};

const first = ownersFromHash();
if (first.length) load(first);
else $('status').textContent = 'Type one or more usernames whose graphs were shared.';

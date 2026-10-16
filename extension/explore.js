import { decodeGraph, parseHash, buildHash } from './lib/share.js';
import { loadGraph, loadPeople } from './lib/store.js';
import { mergeGraphs, MAX_OWNERS } from './lib/merge.js';
import { lang, langButton, t, translateStatic } from './lib/i18n.js';

// SQL over the shared graphs, in the page: the graphs (and names, no photos) come from the
// shared storage like in the viewer, and go into an in-memory SQLite (sql.js, ~290 KB
// over the wire) as four small tables. Nothing is written anywhere.

const $ = (id) => document.getElementById(id);
const ROW_LIMIT = 1000; // rows drawn; the count says how many there were

// The graph page: index.html on the site, viewer.html when serving extension/ locally.
const viewerUrl = new URL(location.hostname.endsWith('github.io') ? './' : 'viewer.html', location.href);

// Example questions (title: a key in i18n.js). {0} is the first owner; {a} and {b} the last two (with two owners,
// {0} and {1}). needs: how many owners the question makes sense with.
const EXAMPLES = [
  {
    title: 'x.q.mostFollowed',
    needs: 1,
    sql: `select f.target as username, p.name, count(*) as followers_here
from follows f left join people p on p.username = f.target
group by f.target
order by followers_here desc
limit 30;`,
  },
  {
    title: 'x.q.noFollowBack',
    needs: 1,
    sql: `select f.target as username, p.name
from follows f left join people p on p.username = f.target
where f.source = '{0}'
  and not exists (select 1 from follows back where back.source = f.target and back.target = '{0}')
order by username;`,
  },
  {
    title: 'x.q.mostConnected',
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
    title: 'x.q.moreThanOne',
    needs: 2,
    sql: `select c.username, p.name, group_concat(c.owner, ', ') as circles, count(*) as how_many
from circles c left join people p on p.username = c.username
where c.username not in (select username from owners)
group by c.username
having count(*) > 1
order by how_many desc, c.username;`,
  },
  {
    title: 'x.q.eachOther',
    needs: 2,
    sql: `select source, target from follows
where (source = '{a}' and target = '{b}')
   or (source = '{b}' and target = '{a}');`,
  },
  {
    title: 'x.q.inBoth',
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
    title: 'x.q.paths',
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
let loaded = null; // [people, follows, ms] of the last load, for the status line

// SQLite loads alongside the graphs instead of before them: the page and the data come
// first, the engine is only needed once both are in.
const SQL_JS = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
const sqlReady = new Promise((resolve, reject) => {
  const script = Object.assign(document.createElement('script'), { src: `${SQL_JS}sql-wasm.js`, async: true });
  script.onload = resolve;
  script.onerror = () => reject(new Error(t('x.sqlFailed')));
  document.head.append(script);
})
  .then(() => window.initSqlJs({ locateFile: (file) => SQL_JS + file }))
  .then((module) => (SQL = module));
sqlReady.catch(() => {}); // reported by load(), which waits for it

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
  $('status').textContent = t('x.loading');
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
    loaded = [ids.length, graph.links.length, Math.round(performance.now() - started)];
    $('status').textContent = t('x.loaded', ...loaded);
    renderExamples();
    $('run').disabled = false;
  } catch (err) {
    $('status').textContent = '';
    showError(t('x.couldNotLoad', err.message));
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

// The questions, with these owners' names in; "Your own SQL" shows up once the SQL is
// edited by hand. Loading other graphs starts again on the most telling question.
const OWN = 'own';
function renderExamples() {
  const usable = EXAMPLES.filter((e) => owners.length >= e.needs);
  $('examples').replaceChildren(...usable.map((e) => new Option(fillIn(t(e.title)), EXAMPLES.indexOf(e))));
  pick([5, 3, 0].map((i) => EXAMPLES[i]).find((e) => usable.includes(e)));
}

function pick(example) {
  if (!example) return;
  $('examples').querySelector(`option[value="${OWN}"]`)?.remove();
  $('examples').value = EXAMPLES.indexOf(example);
  $('sql').value = fillIn(example.sql);
  run();
}

$('examples').onchange = () => {
  const example = EXAMPLES[$('examples').value];
  if (example) pick(example);
};
$('sql').oninput = () => {
  if (!$('examples').querySelector(`option[value="${OWN}"]`)) $('examples').append(new Option(t('x.ownSql'), OWN));
  $('examples').value = OWN;
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
    $('summary').textContent = `${t('x.noRows')} · ${ms} ms`;
    return;
  }
  const { columns, values } = last;
  $('summary').textContent =
    t('x.rows', values.length) +
    (values.length > ROW_LIMIT ? t('x.firstShown', ROW_LIMIT) : '') +
    ` · ${ms} ms`;
  renderTable(columns, values.slice(0, ROW_LIMIT));
}

const IG_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="11.8" cy="4.2" r="0.9" fill="currentColor"/></svg>';
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
          // the name opens them in the graph; the icon after it, on Instagram
          const hash = buildHash({ o: owners[0], m: owners.slice(1), p: value });
          const ig = Object.assign(document.createElement('a'), {
            className: 'ig',
            href: `https://www.instagram.com/${encodeURIComponent(value)}/`,
            target: '_blank',
            rel: 'noopener',
            title: t('x.openIg', value),
            innerHTML: IG_ICON,
          });
          ig.setAttribute('aria-label', t('openOnInstagramOf', value));
          td.append(Object.assign(document.createElement('a'), { href: new URL(hash, viewerUrl).href, textContent: value }), ig);
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
  if (list.length > MAX_OWNERS) return showError(t('x.tooMany', MAX_OWNERS));
  showError('');
  load([...new Set(list)]);
};

const first = ownersFromHash();
if (first.length) load(first);
else $('status').textContent = t('x.typeOwners');

// Spanish by default; the EN/ES button switches it (same choice as the graph page)
document.documentElement.lang = lang;
translateStatic();
document.title = t('x.title');
langButton($('lang'), () => {
  translateStatic();
  document.title = t('x.title');
  if (loaded) $('status').textContent = t('x.loaded', ...loaded);
  else if (!owners.length) $('status').textContent = t('x.typeOwners');
  for (const option of $('examples').options) {
    option.text = option.value === OWN ? t('x.ownSql') : fillIn(t(EXAMPLES[option.value].title));
  }
  if (db) run(); // the row count line, in the new language
});

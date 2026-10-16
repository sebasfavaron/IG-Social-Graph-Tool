-- Shared storage, unencrypted: each crawl once, each Instagram account once.
--
--   graphs   one row per person who shared a crawl: the graph packed as in a #g= link
--   people   one row per account seen in any shared crawl: real name, flags, photo
--
-- A link is #o=<owner> (plus m=<other owners> to draw them together).
--
-- Reading is for publishers only, and only within their network: two graphs are linked
-- when each owner is in the other's crawl (they follow each other, one way or both), and a
-- network is every graph reachable through such links. Each side vouches with its own
-- crawl, so a made-up account links to nobody and sees only itself. A viewer proves who
-- they are with their owner key (see save_graph). The client password is public (store.js):
-- these functions are the only way in.
--
-- Browsers connect as share_client, which can only call the functions below. The caps
-- keep strangers from filling the free tier (0.5 GB). The older encrypted `shares`
-- table (shares.sql) stays readable for links made before this.
--
-- Run as the owner, once (idempotent), after shares.sql:
--   psql "$DATABASE_URL_UNPOOLED" -f db/graphs.sql

create table if not exists graphs (
  owner text primary key,
  data text not null,
  updated_at timestamptz not null default now()
);
-- how many people the graph holds, for the list of shared graphs (null: shared before it)
alter table graphs add column if not exists people integer;
-- sha256 (hex) of the owner key: a random secret the publishing browser keeps (store.js).
-- Once set, only that key replaces or unpublishes the graph. Null: published before keys,
-- and the next publish with a key claims it.
alter table graphs add column if not exists key_hash text;
-- everyone in each graph (save_graph's members): what links graphs into a network, and
-- what unpublishing checks before dropping someone's name and photo
create table if not exists graph_people (
  owner text not null,
  username text not null,
  primary key (owner, username)
);
create index if not exists graph_people_username on graph_people (username);
revoke all on table graph_people from public;
create table if not exists people (
  username text primary key,
  name text,
  flags smallint not null default 0, -- 1 private | 2 verified
  photo bytea,
  photo_type text,
  updated_at timestamptz not null default now()
);
revoke all on table graphs from public;
revoke all on table people from public;

create or replace function storage_left() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select 400 * 1024 * 1024 - pg_total_relation_size('graphs') - pg_total_relation_size('people')
    - pg_total_relation_size('shares')
$$;

-- members: JSON array of every username in the graph (null: leave what is there)
create or replace function set_members(owner_name text, members jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if members is null or jsonb_typeof(members) <> 'array' then
    return;
  end if;
  if jsonb_array_length(members) > 20000 then
    raise exception 'too many people in one graph';
  end if;
  delete from graph_people where owner = owner_name;
  insert into graph_people (owner, username)
  select owner_name, u from jsonb_array_elements_text(members) u
  where u ~ '^[A-Za-z0-9._]{1,30}$'
  on conflict do nothing;
end $$;

create or replace function key_hash(owner_key text) returns text
language sql immutable as $$
  select case when owner_key is null or owner_key = '' then null
              else encode(sha256(convert_to(owner_key, 'UTF8')), 'hex') end
$$;

-- Saves an owner's graph. Returns whether it was saved.
-- owner_key: the publishing browser's secret. A graph that has one is replaced only with it
-- (and an old link copied over never replaces it); one that has none takes this one.
-- only_if_missing: copying an old link over, which must not replace a newer share. With
-- from_share (the old link's id in `shares`) it does replace a graph stored before that
-- share was made, and the graph keeps the share's date, so old links opened in any order
-- leave the newest one; without it (links to gists carry no date) only a missing graph
-- is filled.
drop function if exists save_graph(text, text, boolean);
drop function if exists save_graph(text, text, boolean, text);
drop function if exists save_graph(text, text, boolean, text, integer);
drop function if exists save_graph(text, text, boolean, text, integer, text);
create or replace function save_graph(owner_name text, graph_data text, only_if_missing boolean default false,
                                      from_share text default null, people_count integer default null,
                                      owner_key text default null, members jsonb default null)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  made timestamptz;
  stored_hash text := (select g.key_hash from graphs g where g.owner = owner_name);
begin
  if owner_name !~ '^[A-Za-z0-9._]{1,30}$' then
    raise exception 'not an Instagram username: %', owner_name;
  end if;
  if graph_data is null or length(graph_data) > 2 * 1024 * 1024 then
    raise exception 'graph too big (2 MB at most)';
  end if;
  if storage_left() < length(graph_data) then
    raise exception 'share storage is full';
  end if;
  if (select count(*) from graphs where updated_at > now() - interval '1 hour') >= 60 then
    raise exception 'too many shares in the last hour, try again later';
  end if;
  if only_if_missing then
    if stored_hash is not null then
      return false; -- its owner publishes with a key now; old links are older than that
    end if;
    made := (select created_at from shares where id = from_share);
    if made is null then
      insert into graphs (owner, data, people) values (owner_name, graph_data, people_count)
        on conflict (owner) do nothing;
    else
      insert into graphs as g (owner, data, updated_at, people) values (owner_name, graph_data, made, people_count)
        on conflict (owner) do update set data = excluded.data, updated_at = excluded.updated_at, people = excluded.people
        where g.updated_at < excluded.updated_at;
    end if;
    if found then
      perform set_members(owner_name, members);
    end if;
    return found;
  end if;
  if stored_hash is not null and stored_hash is distinct from key_hash(owner_key) then
    raise exception 'this graph was published from another browser; only that one can replace it';
  end if;
  insert into graphs (owner, data, people, key_hash) values (owner_name, graph_data, people_count, key_hash(owner_key))
    on conflict (owner) do update set data = excluded.data, updated_at = now(), people = excluded.people,
      key_hash = coalesce(graphs.key_hash, excluded.key_hash);
  perform set_members(owner_name, members);
  return true;
end $$;

-- rows: [{ "u": username, "n": name, "f": flags, "p": photo base64, "t": photo type }]
-- Returns how many people were added or changed.
-- A missing or empty name or photo keeps the one already stored. only_if_missing: fills
-- gaps only, for copying old links over.
-- A person also in a graph outside the writer's network (owner_name with its key) only gets
-- gaps filled: made-up accounts listing real people cannot rename them.
drop function if exists save_people(jsonb, boolean);
drop function if exists save_people(jsonb, boolean, text);
create or replace function save_people(rows jsonb, only_if_missing boolean default false,
                                       owner_name text default null, owner_key text default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  saved integer := 0;
  changed integer;
  mine text[] := array(select owner from network(owner_name, owner_key));
  gap boolean;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' or length(rows::text) > 4 * 1024 * 1024 then
    raise exception 'people batch too big (4 MB at most)';
  end if;
  if storage_left() < length(rows::text) then
    raise exception 'share storage is full';
  end if;
  for pass in 1..2 loop
    gap := only_if_missing or pass = 2;
    insert into people as p (username, name, flags, photo, photo_type)
    select r->>'u', nullif(r->>'n', ''), coalesce((r->>'f')::smallint, 0),
           decode(nullif(r->>'p', ''), 'base64'), nullif(r->>'t', '')
    from jsonb_array_elements(rows) r
    where r->>'u' ~ '^[A-Za-z0-9._]{1,30}$'
      -- pass 1: people no graph outside the writer's network has; pass 2 (gaps only): the
      -- others, so a network of made-up accounts cannot rename real people
      and (not exists (select from graph_people gp where gp.username = r->>'u'
                       and not (gp.owner = any (mine)))) = (pass = 1)
    on conflict (username) do update set
      name = case when gap then coalesce(p.name, excluded.name) else coalesce(excluded.name, p.name) end,
      flags = case when gap then p.flags else excluded.flags end,
      photo = case when gap then coalesce(p.photo, excluded.photo) else coalesce(excluded.photo, p.photo) end,
      photo_type = case when gap then coalesce(p.photo_type, excluded.photo_type)
                        else coalesce(excluded.photo_type, p.photo_type) end,
      updated_at = now()
    -- an unchanged person is left alone: rewriting the row would leave the old copy (photo
    -- and all) behind as dead space until vacuum, on every share
    where (case when gap then coalesce(p.name, excluded.name) else coalesce(excluded.name, p.name) end,
           case when gap then p.flags else excluded.flags end,
           case when gap then coalesce(p.photo, excluded.photo) else coalesce(excluded.photo, p.photo) end,
           case when gap then coalesce(p.photo_type, excluded.photo_type)
                else coalesce(excluded.photo_type, p.photo_type) end)
          is distinct from (p.name, p.flags, p.photo, p.photo_type);
    get diagnostics changed = row_count;
    saved := saved + changed;
  end loop;
  return saved;
end $$;

-- Takes a graph off the list, with the key of the browser that published it. The names
-- and photos only that graph had go too; people in someone else's graph stay for theirs.
create or replace function unpublish(owner_name text, owner_key text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  stored_hash text := (select g.key_hash from graphs g where g.owner = owner_name);
begin
  if not exists (select from graphs where owner = owner_name) then
    return false;
  end if;
  if stored_hash is null or stored_hash is distinct from key_hash(owner_key) then
    raise exception 'only the browser that published this graph can unpublish it';
  end if;
  delete from people p
  where exists (select from graph_people gp where gp.owner = owner_name and gp.username = p.username)
    and not exists (select from graph_people gp where gp.owner <> owner_name and gp.username = p.username)
    and not exists (select from graphs g where g.owner <> owner_name and g.owner = p.username);
  delete from graph_people where owner = owner_name;
  delete from graphs where owner = owner_name;
  return true;
end $$;




-- The owners whose graphs the viewer can see: their own, and every graph linked to it,
-- however far (see the top of this file). Nothing without a published graph and its key.
create or replace function network(viewer text, viewer_key text)
returns table (owner text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if viewer is null or not exists (
    select from graphs g where g.owner = viewer and g.key_hash is not null and g.key_hash = key_hash(viewer_key)
  ) then
    return;
  end if;
  return query
  with recursive linked (a, b) as (
    select g1.owner, g2.owner
    from graphs g1
    join graph_people in_2 on in_2.username = g1.owner
    join graphs g2 on g2.owner = in_2.owner and g2.owner <> g1.owner
    where exists (select from graph_people in_1 where in_1.owner = g1.owner and in_1.username = g2.owner)
  ), reach (owner) as (
    select viewer
    union
    select l.b from reach r join linked l on l.a = r.owner
  )
  select reach.owner from reach;
end $$;

-- The graphs in the viewer's network, newest first, with each owner's name and photo.
drop function if exists list_graphs();
create or replace function list_graphs(viewer text, viewer_key text)
returns table (owner text, updated_at timestamptz, people integer, name text, photo text, photo_type text)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.owner, g.updated_at, g.people, p.name, replace(encode(p.photo, 'base64'), E'\n', ''), p.photo_type
  from graphs g
  join network(viewer, viewer_key) n on n.owner = g.owner
  left join people p on p.username = g.owner
  order by g.updated_at desc
  limit 500
$$;

-- An owner's graph, when it is in the viewer's network; otherwise no row.
drop function if exists get_graph(text);
create or replace function get_graph(owner_name text, viewer text, viewer_key text)
returns table (data text, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.data, g.updated_at from graphs g
  join network(viewer, viewer_key) n on n.owner = g.owner
  where g.owner = owner_name
$$;

-- Names, flags and photos (base64) of up to 1000 accounts, for those in a graph of the
-- viewer's network (see the conditions below).
drop function if exists get_people(text[]);
create or replace function get_people(usernames text[], viewer text, viewer_key text)
returns table (username text, name text, flags smallint, photo text, photo_type text)
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (select owner from network(viewer, viewer_key))
  select p.username, p.name, p.flags, replace(encode(p.photo, 'base64'), E'\n', ''), p.photo_type
  from people p
  where p.username = any (usernames[1:1000])
    -- in a graph of the network. Made-up accounts listing real usernames can read those
    -- names and photos, which Instagram shows anyone anyway; who follows whom stays theirs.
    -- (Hiding names also listed outside the network let any fake blank everyone's.)
    and exists (select from graph_people gp join mine on mine.owner = gp.owner where gp.username = p.username)
$$;

-- What anyone may know, to be invited in: whether this owner published, how many people
-- their graph has, their own name and photo, and how many graphs there are in all.
create or replace function graph_teaser(owner_name text)
returns table (owner text, people integer, name text, photo text, photo_type text, graphs integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.owner, g.people, p.name, replace(encode(p.photo, 'base64'), E'\n', ''), p.photo_type,
         (select count(*)::integer from graphs)
  from graphs g left join people p on p.username = g.owner
  where g.owner = owner_name
$$;

revoke all on function storage_left() from public;
revoke all on function set_members(text, jsonb) from public;
revoke all on function network(text, text) from public;
revoke all on function graph_teaser(text) from public;
revoke all on function save_graph(text, text, boolean, text, integer, text, jsonb) from public;
revoke all on function unpublish(text, text) from public;
revoke all on function list_graphs(text, text) from public;
revoke all on function save_people(jsonb, boolean, text, text) from public;
revoke all on function get_graph(text, text, text) from public;
revoke all on function get_people(text[], text, text) from public;
grant execute on function save_graph(text, text, boolean, text, integer, text, jsonb) to share_client;
grant execute on function unpublish(text, text) to share_client;
grant execute on function list_graphs(text, text) to share_client;
grant execute on function graph_teaser(text) to share_client;
grant execute on function save_people(jsonb, boolean, text, text) to share_client;
grant execute on function get_graph(text, text, text) to share_client;
grant execute on function get_people(text[], text, text) to share_client;

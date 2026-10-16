-- Shared storage, unencrypted: each crawl once, each Instagram account once.
--
--   graphs   one row per person who shared a crawl: the graph packed as in a #g= link
--   people   one row per account seen in any shared crawl: real name, flags, photo
--
-- A link is #o=<owner> (plus m=<second owner> to draw two together). Anyone with the
-- client password (public, in vault.js) can read everything and overwrite any graph:
-- fine for friends playing with it, not for anything private.
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

-- Saves an owner's graph. Returns whether it was saved.
-- only_if_missing: copying an old link over, which must not replace a newer share. With
-- from_share (the old link's id in `shares`) it does replace a graph stored before that
-- share was made, and the graph keeps the share's date, so old links opened in any order
-- leave the newest one; without it (links to gists carry no date) only a missing graph
-- is filled.
drop function if exists save_graph(text, text, boolean);
create or replace function save_graph(owner_name text, graph_data text, only_if_missing boolean default false,
                                      from_share text default null)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  made timestamptz;
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
    made := (select created_at from shares where id = from_share);
    if made is null then
      insert into graphs (owner, data) values (owner_name, graph_data) on conflict (owner) do nothing;
    else
      insert into graphs as g (owner, data, updated_at) values (owner_name, graph_data, made)
        on conflict (owner) do update set data = excluded.data, updated_at = excluded.updated_at
        where g.updated_at < excluded.updated_at;
    end if;
    return found;
  end if;
  insert into graphs (owner, data) values (owner_name, graph_data)
    on conflict (owner) do update set data = excluded.data, updated_at = now();
  return true;
end $$;

-- rows: [{ "u": username, "n": name, "f": flags, "p": photo base64, "t": photo type }]
-- Returns how many people were added or changed.
-- A missing or empty name or photo keeps the one already stored. only_if_missing: fills
-- gaps only, for copying old links over.
create or replace function save_people(rows jsonb, only_if_missing boolean default false)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  saved integer;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' or length(rows::text) > 4 * 1024 * 1024 then
    raise exception 'people batch too big (4 MB at most)';
  end if;
  if storage_left() < length(rows::text) then
    raise exception 'share storage is full';
  end if;
  insert into people as p (username, name, flags, photo, photo_type)
  select r->>'u', nullif(r->>'n', ''), coalesce((r->>'f')::smallint, 0),
         decode(nullif(r->>'p', ''), 'base64'), nullif(r->>'t', '')
  from jsonb_array_elements(rows) r
  where r->>'u' ~ '^[A-Za-z0-9._]{1,30}$'
  on conflict (username) do update set
    name = case when only_if_missing then coalesce(p.name, excluded.name) else coalesce(excluded.name, p.name) end,
    flags = case when only_if_missing then p.flags else excluded.flags end,
    photo = case when only_if_missing then coalesce(p.photo, excluded.photo) else coalesce(excluded.photo, p.photo) end,
    photo_type = case when only_if_missing then coalesce(p.photo_type, excluded.photo_type)
                      else coalesce(excluded.photo_type, p.photo_type) end,
    updated_at = now()
  -- an unchanged person is left alone: rewriting the row would leave the old copy (photo
  -- and all) behind as dead space until vacuum, on every share
  where (case when only_if_missing then coalesce(p.name, excluded.name) else coalesce(excluded.name, p.name) end,
         case when only_if_missing then p.flags else excluded.flags end,
         case when only_if_missing then coalesce(p.photo, excluded.photo) else coalesce(excluded.photo, p.photo) end,
         case when only_if_missing then coalesce(p.photo_type, excluded.photo_type)
              else coalesce(excluded.photo_type, p.photo_type) end)
        is distinct from (p.name, p.flags, p.photo, p.photo_type);
  get diagnostics saved = row_count;
  return saved;
end $$;

-- The owner's graph and when it was shared, or no row.
create or replace function get_graph(owner_name text)
returns table (data text, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select data, updated_at from graphs where owner = owner_name
$$;

-- Names, flags and photos (base64) of up to 1000 accounts.
create or replace function get_people(usernames text[])
returns table (username text, name text, flags smallint, photo text, photo_type text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.username, p.name, p.flags, replace(encode(p.photo, 'base64'), E'\n', ''), p.photo_type
  from people p
  where p.username = any (usernames[1:1000])
$$;

revoke all on function storage_left() from public;
revoke all on function save_graph(text, text, boolean, text) from public;
revoke all on function save_people(jsonb, boolean) from public;
revoke all on function get_graph(text) from public;
revoke all on function get_people(text[]) from public;
grant execute on function save_graph(text, text, boolean, text) to share_client;
grant execute on function save_people(jsonb, boolean) to share_client;
grant execute on function get_graph(text) to share_client;
grant execute on function get_people(text[]) to share_client;

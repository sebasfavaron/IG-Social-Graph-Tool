-- Storage for full shares (graph + names + photos), encrypted in the browser before they
-- get here: the key travels only in the link, after the "#", so this database holds bytes
-- it cannot read. See extension/lib/vault.js.
--
-- Browsers connect as share_client, whose password is in the viewer's code and therefore
-- public. All that role can do is call the two functions below: save one share and get its
-- id back, or read one share by its id. It cannot list, change or delete anything.
-- The caps keep strangers with that password from filling the free tier (0.5 GB).
--
-- Run as the owner, once (idempotent):
--   psql "$DATABASE_URL_UNPOOLED" -v client_password="$PASSWORD" -f db/shares.sql

create table if not exists shares (
  id text primary key,
  data bytea not null,
  created_at timestamptz not null default now()
);
revoke all on table shares from public;

-- payload: base64 of the encrypted share. Returns the new share's id (32 hex characters,
-- random, so ids cannot be guessed or walked).
create or replace function create_share(payload text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  raw bytea;
  new_id text := replace(gen_random_uuid()::text, '-', '');
begin
  if payload is null or length(payload) > 8 * 1024 * 1024 then
    raise exception 'share too big (8 MB of base64 at most)';
  end if;
  raw := decode(payload, 'base64');
  if pg_total_relation_size('shares') + octet_length(raw) > 400 * 1024 * 1024 then
    raise exception 'share storage is full';
  end if;
  if (select count(*) from shares where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'too many shares in the last hour, try again later';
  end if;
  insert into shares (id, data) values (new_id, raw);
  return new_id;
end $$;

-- Base64 of the encrypted share, or null when there is no share with that id.
create or replace function get_share(share_id text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select replace(encode(data, 'base64'), E'\n', '') from shares where id = share_id
$$;

revoke all on function create_share(text) from public;
revoke all on function get_share(text) from public;

do $$
begin
  if not exists (select from pg_roles where rolname = 'share_client') then
    create role share_client login;
  end if;
end $$;
alter role share_client with login password :'client_password' connection limit 10;
alter role share_client set statement_timeout = '15s';
grant execute on function create_share(text) to share_client;
grant execute on function get_share(text) to share_client;

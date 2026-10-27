-- =====================================================================================
-- SUPABASE-SETUP.sql  (Gimis Charms v2.25.0)   - endesha MARA MOJA tu.
-- Supabase Dashboard > SQL Editor > New query > bandika faili hii yote > Run.
-- Ni salama kuiendesha tena (inatumia "if not exists" / "create or replace").
-- HATUA YA MWISHO (lazima): ongeza barua pepe ya OWNER chini kabisa ya faili (sehemu ya "OWNER").
-- =====================================================================================

-- ---------- Jedwali ----------
-- Kila rekodi nzima inakaa kwenye safu `data` (jsonb), kama ilivyokuwa kwenye Firestore.
create table if not exists public.gpsa_queue (
  token      text primary key,
  data       jsonb  not null,
  updated_at bigint not null default 0
);
create table if not exists public.gpsa_ai                (id text primary key, data jsonb not null default '{}'::jsonb);
create table if not exists public.gpsa_devices           (id text primary key, data jsonb not null default '{}'::jsonb);
create table if not exists public.gpsa_config            (id text primary key, data jsonb not null default '{}'::jsonb);   -- 'access' (contact/message) na 'wipe' (alama ya "futa token zote")
create table if not exists public.gpsa_release           (id text primary key, data jsonb not null default '{}'::jsonb);   -- 'meta' + faili za update
create table if not exists public.gpsa_blocked_accounts  (id text primary key, data jsonb not null default '{}'::jsonb);
create table if not exists public.gpsa_owners            (user_id uuid primary key references auth.users(id) on delete cascade);

-- ---------- Kazi (functions) ----------
create or replace function public.gpsa_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gpsa_owners where user_id = auth.uid())
$$;

-- Je, akaunti hii imezuiwa? (inarudisha rekodi ya block au null) - inatumika wakati wa usajili wa kompyuta
create or replace function public.gpsa_blocked_info(k text) returns jsonb
language sql stable security definer set search_path = public as $$
  select data from public.gpsa_blocked_accounts where id = k limit 1
$$;

create or replace function public.gpsa_start_status(k text) returns text
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.gpsa_blocked_accounts where id = k) then 'blocked' else 'active' end
$$;

-- ADMIN: futa token ZOTE kwenye cloud + weka alama ili kila kompyuta ifute nakala yake ya ndani wakati wa sync inayofuata.
-- Inafanya kazi KWA OWNER TU (akaunti iliyo kwenye gpsa_owners).
create or replace function public.gpsa_wipe_tokens() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n int;
  t bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not public.gpsa_is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  delete from public.gpsa_queue where true;
  get diagnostics n = row_count;
  insert into public.gpsa_config (id, data)
    values ('wipe', jsonb_build_object('at', t, 'by', coalesce(auth.jwt() ->> 'email', ''), 'count', n))
    on conflict (id) do update set data = excluded.data;
  return jsonb_build_object('count', n, 'at', t);
end $$;

-- Kompyuta (mtumiaji wa kawaida) inaruhusiwa kubadilisha funguo hizi tu kwenye rekodi yake (sawa na rules za zamani)
create or replace function public.gpsa_devices_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare allowed text[] := array['lastSeen','version','cloudEmail','browser','os','ip','gimisUser'];
begin
  if public.gpsa_is_owner() then return new; end if;
  if new.id is distinct from old.id or (new.data - allowed) is distinct from (old.data - allowed) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists gpsa_devices_guard on public.gpsa_devices;
create trigger gpsa_devices_guard before update on public.gpsa_devices
  for each row execute function public.gpsa_devices_guard();

-- ---------- Ruhusa (Row Level Security) ----------
alter table public.gpsa_queue            enable row level security;
alter table public.gpsa_ai               enable row level security;
alter table public.gpsa_devices          enable row level security;
alter table public.gpsa_config           enable row level security;
alter table public.gpsa_release          enable row level security;
alter table public.gpsa_blocked_accounts enable row level security;
alter table public.gpsa_owners           enable row level security;   -- hakuna policy: hakuna anayeweza kuisoma/kuiandika kupitia API (hariri kwenye SQL Editor tu)

-- token + kumbukumbu ya AI: kila mtu aliyeingia (signed in)
drop policy if exists gpsa_queue_all on public.gpsa_queue;
create policy gpsa_queue_all on public.gpsa_queue for all to authenticated using (true) with check (true);
drop policy if exists gpsa_ai_all on public.gpsa_ai;
create policy gpsa_ai_all on public.gpsa_ai for all to authenticated using (true) with check (true);

-- config na release: kila mtu anasoma, owner anaandika
drop policy if exists gpsa_config_read on public.gpsa_config;
create policy gpsa_config_read on public.gpsa_config for select to authenticated using (true);
drop policy if exists gpsa_config_write on public.gpsa_config;
create policy gpsa_config_write on public.gpsa_config for all to authenticated using (public.gpsa_is_owner()) with check (public.gpsa_is_owner());
drop policy if exists gpsa_release_read on public.gpsa_release;
create policy gpsa_release_read on public.gpsa_release for select to authenticated using (true);
drop policy if exists gpsa_release_write on public.gpsa_release;
create policy gpsa_release_write on public.gpsa_release for all to authenticated using (public.gpsa_is_owner()) with check (public.gpsa_is_owner());

-- orodha ya akaunti zilizozuiwa: owner tu (usajili unatumia gpsa_blocked_info / gpsa_start_status)
drop policy if exists gpsa_blocked_owner on public.gpsa_blocked_accounts;
create policy gpsa_blocked_owner on public.gpsa_blocked_accounts for all to authenticated using (public.gpsa_is_owner()) with check (public.gpsa_is_owner());

-- kompyuta: kila akaunti inaona/inaandika rekodi zake tu; owner anaona zote, anabadilisha status, anafuta
drop policy if exists gpsa_devices_select on public.gpsa_devices;
create policy gpsa_devices_select on public.gpsa_devices for select to authenticated
  using (public.gpsa_is_owner() or lower(data ->> 'cloudEmail') = lower(coalesce(auth.jwt() ->> 'email', '')));
drop policy if exists gpsa_devices_insert on public.gpsa_devices;
create policy gpsa_devices_insert on public.gpsa_devices for insert to authenticated
  with check (public.gpsa_is_owner() or (
    lower(data ->> 'cloudEmail') = lower(coalesce(auth.jwt() ->> 'email', ''))
    and data ->> 'status' = public.gpsa_start_status(data ->> 'accountKey')));
drop policy if exists gpsa_devices_update on public.gpsa_devices;
create policy gpsa_devices_update on public.gpsa_devices for update to authenticated
  using (public.gpsa_is_owner() or lower(data ->> 'cloudEmail') = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (public.gpsa_is_owner() or lower(data ->> 'cloudEmail') = lower(coalesce(auth.jwt() ->> 'email', '')));
drop policy if exists gpsa_devices_delete on public.gpsa_devices;
create policy gpsa_devices_delete on public.gpsa_devices for delete to authenticated using (public.gpsa_is_owner());

-- ---------- Grants ----------
revoke all on public.gpsa_queue, public.gpsa_ai, public.gpsa_devices, public.gpsa_config, public.gpsa_release, public.gpsa_blocked_accounts, public.gpsa_owners from anon;
revoke all on public.gpsa_owners from authenticated;
grant select, insert, update, delete on public.gpsa_queue, public.gpsa_ai, public.gpsa_devices, public.gpsa_config, public.gpsa_release, public.gpsa_blocked_accounts to authenticated;

revoke execute on function public.gpsa_is_owner(), public.gpsa_blocked_info(text), public.gpsa_start_status(text), public.gpsa_wipe_tokens() from public, anon;
grant  execute on function public.gpsa_is_owner(), public.gpsa_blocked_info(text), public.gpsa_start_status(text), public.gpsa_wipe_tokens() to authenticated;

-- =====================================================================================
-- OWNER (HATUA YA LAZIMA)
-- 1) Tengeneza akaunti ya owner: Supabase > Authentication > Users > Add user (email + password; weka tiki "Auto Confirm User").
--    Tumia akaunti TOFAUTI na ile ya kawaida ya ofisi.
-- 2) Badilisha barua pepe hapa chini kuwa ya owner, kisha endesha mstari huu (Run):
--
--    insert into public.gpsa_owners (user_id) select id from auth.users where email = 'BADILISHA@EMAIL.COM' on conflict do nothing;
--
-- Kuongeza owner mwingine: rudia mstari huo na barua pepe yake. Kuondoa: delete from public.gpsa_owners where user_id = (select id from auth.users where email = '...');
-- =====================================================================================

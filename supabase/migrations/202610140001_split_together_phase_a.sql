create schema if not exists private;

create table public.split_sessions (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id),
  source_local_bill_id text not null,
  title text not null check (length(title) between 1 and 80),
  state text not null default 'draft' check (state in ('draft','claiming','finalized','closed')),
  subtotal_amount bigint not null check (subtotal_amount >= 0),
  discount_amount bigint not null check (discount_amount >= 0),
  service_amount bigint not null check (service_amount >= 0),
  tax_amount bigint not null check (tax_amount >= 0),
  tip_amount bigint not null check (tip_amount >= 0),
  rounding_amount bigint not null,
  grand_total_amount bigint not null check (grand_total_amount >= 0),
  max_participants integer not null default 12 check (max_participants between 2 and 12),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  unique (host_user_id, source_local_bill_id),
  check (grand_total_amount = subtotal_amount - discount_amount + service_amount + tax_amount + tip_amount + rounding_amount)
);
create table public.split_session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.split_sessions(id) on delete cascade,
  source_item_id text not null,
  name text not null check (length(name) between 1 and 80),
  quantity integer not null check (quantity between 1 and 1000),
  total_amount bigint not null check (total_amount >= 0),
  allocation_mode text not null default 'exclusive' check (allocation_mode in ('exclusive','shared')),
  sort_order integer not null,
  unique (session_id, source_item_id)
);
create table public.split_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.split_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null check (length(display_name) between 1 and 40),
  role text not null check (role in ('host','guest')),
  joined_at timestamptz not null default now(),
  unique (session_id, user_id)
);
create unique index split_one_host on public.split_participants(session_id) where role = 'host';
create table public.split_invites (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.split_sessions(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create table public.split_item_claims (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.split_sessions(id) on delete cascade,
  item_id uuid not null references public.split_session_items(id) on delete cascade,
  participant_id uuid not null references public.split_participants(id) on delete cascade,
  claimed_units integer not null default 0 check (claimed_units >= 0),
  is_shared_member boolean not null default false,
  unique (item_id, participant_id),
  check ((claimed_units > 0 and not is_shared_member) or (claimed_units = 0 and is_shared_member))
);
create index split_items_session on public.split_session_items(session_id);
create index split_members_session on public.split_participants(session_id);
create index split_claims_session on public.split_item_claims(session_id);
create index split_invites_session on public.split_invites(session_id);
create table public.split_rate_limits (
  key_hash text primary key,
  attempts integer not null,
  reset_at timestamptz not null
);
-- shortcut: one row per anonymous identity and action remains after expiry; add periodic cleanup when traffic grows.
alter table public.split_rate_limits enable row level security;
revoke all on public.split_rate_limits from anon, authenticated;

create function private.split_is_member(p_session uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.split_participants where session_id = p_session and user_id = auth.uid());
$$;
revoke all on function private.split_is_member(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.split_is_member(uuid) to authenticated;

alter table public.split_sessions enable row level security;
alter table public.split_session_items enable row level security;
alter table public.split_participants enable row level security;
alter table public.split_invites enable row level security;
alter table public.split_item_claims enable row level security;
create policy split_session_read on public.split_sessions for select to authenticated using (private.split_is_member(id));
create policy split_item_read on public.split_session_items for select to authenticated using (private.split_is_member(session_id));
create policy split_participant_read on public.split_participants for select to authenticated using (private.split_is_member(session_id));
create policy split_claim_read on public.split_item_claims for select to authenticated using (private.split_is_member(session_id));
grant select on public.split_sessions, public.split_session_items, public.split_participants, public.split_item_claims to authenticated;
revoke all on public.split_invites from anon, authenticated;

create function public.split_create(p_user uuid, p_bill jsonb, p_host_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  if p_user is null or length(trim(p_host_name)) not between 1 and 40 or jsonb_array_length(p_bill->'items') not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
  insert into public.split_sessions(host_user_id, source_local_bill_id, title, subtotal_amount, discount_amount, service_amount, tax_amount, tip_amount, rounding_amount, grand_total_amount)
  values (p_user, p_bill->>'source_local_bill_id', p_bill->>'title', (p_bill->>'subtotal_amount')::bigint, (p_bill->>'discount_amount')::bigint, (p_bill->>'service_amount')::bigint, (p_bill->>'tax_amount')::bigint, (p_bill->>'tip_amount')::bigint, (p_bill->>'rounding_amount')::bigint, (p_bill->>'grand_total_amount')::bigint)
  on conflict (host_user_id, source_local_bill_id) do nothing returning id into s;
  if s is null then select id into s from public.split_sessions where host_user_id = p_user and source_local_bill_id = p_bill->>'source_local_bill_id'; return s; end if;
  insert into public.split_participants(session_id, user_id, display_name, role) values (s, p_user, trim(p_host_name), 'host');
  insert into public.split_session_items(session_id, source_item_id, name, quantity, total_amount, sort_order)
  select s, x.source_item_id, x.name, x.quantity, x.total_amount, x.sort_order from jsonb_to_recordset(p_bill->'items') as x(source_item_id text, name text, quantity integer, total_amount bigint, sort_order integer);
  return s;
end; $$;

create function public.split_invite(p_user uuid, p_session uuid, p_hash text) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare expiry timestamptz;
begin
  select expires_at into expiry from public.split_sessions where id = p_session and host_user_id = p_user and expires_at > now() and state in ('draft','claiming');
  if expiry is null then raise exception 'FORBIDDEN_OR_EXPIRED'; end if;
  insert into public.split_invites(session_id, token_hash, expires_at) values (p_session, p_hash, expiry);
  return expiry;
end; $$;

create function public.split_invite_preview(p_hash text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object('title', s.title, 'state', s.state, 'expires_at', s.expires_at, 'full', (select count(*) >= s.max_participants from public.split_participants p where p.session_id = s.id)) into result
  from public.split_invites i join public.split_sessions s on s.id = i.session_id
  where i.token_hash = p_hash and i.revoked_at is null and i.expires_at > now() and s.expires_at > now();
  return result;
end; $$;

create function public.split_join(p_user uuid, p_hash text, p_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.split_sessions%rowtype; existing uuid;
begin
  if p_user is null or length(trim(p_name)) not between 1 and 40 then raise exception 'INVALID_INPUT'; end if;
  select room.* into s from public.split_invites i join public.split_sessions room on room.id = i.session_id where i.token_hash = p_hash and i.revoked_at is null and i.expires_at > now() for update of room;
  if s.id is null or s.expires_at <= now() then raise exception 'INVITE_EXPIRED'; end if;
  select id into existing from public.split_participants where session_id = s.id and user_id = p_user;
  if existing is not null then return s.id; end if;
  if s.state not in ('draft','claiming') then raise exception 'ROOM_CLOSED'; end if;
  if (select count(*) from public.split_participants where session_id = s.id) >= s.max_participants then raise exception 'ROOM_FULL'; end if;
  insert into public.split_participants(session_id, user_id, display_name, role) values (s.id, p_user, trim(p_name), 'guest');
  update public.split_sessions set version = version + 1 where id = s.id;
  return s.id;
end; $$;

create function public.split_open(p_user uuid, p_session uuid) returns void language plpgsql security definer set search_path = '' as $$
declare s public.split_sessions%rowtype;
begin
  select * into s from public.split_sessions where id = p_session for update;
  if s.id is null or s.host_user_id <> p_user then raise exception 'FORBIDDEN'; end if;
  if s.expires_at <= now() then raise exception 'ROOM_EXPIRED'; end if;
  if s.state = 'claiming' then return; end if;
  if s.state <> 'draft' then raise exception 'ROOM_CLOSED'; end if;
  update public.split_sessions set state = 'claiming', version = version + 1 where id = p_session;
end; $$;

create function public.split_mode(p_user uuid, p_session uuid, p_item uuid, p_mode text) returns void language plpgsql security definer set search_path = '' as $$
declare s public.split_sessions%rowtype;
begin
  select * into s from public.split_sessions where id = p_session for update;
  if s.id is null or s.host_user_id <> p_user then raise exception 'FORBIDDEN'; end if;
  if s.expires_at <= now() then raise exception 'ROOM_EXPIRED'; end if;
  if s.state <> 'draft' then raise exception 'ROOM_NOT_DRAFT'; end if;
  if p_mode not in ('exclusive','shared') then raise exception 'INVALID_MODE'; end if;
  if exists(select 1 from public.split_item_claims where item_id = p_item) then raise exception 'ITEM_HAS_CLAIMS'; end if;
  update public.split_session_items set allocation_mode = p_mode where id = p_item and session_id = p_session;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  update public.split_sessions set version = version + 1 where id = p_session;
end; $$;

create function public.split_claim(p_user uuid, p_session uuid, p_item uuid, p_units integer, p_shared boolean) returns void language plpgsql security definer set search_path = '' as $$
declare s public.split_sessions%rowtype; i public.split_session_items%rowtype; p uuid; claimed integer;
begin
  select * into s from public.split_sessions where id = p_session for update;
  if s.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if s.expires_at <= now() then raise exception 'ROOM_EXPIRED'; end if;
  if s.state <> 'claiming' then raise exception 'ROOM_NOT_CLAIMING'; end if;
  select id into p from public.split_participants where session_id = p_session and user_id = p_user;
  if p is null then raise exception 'FORBIDDEN'; end if;
  select * into i from public.split_session_items where id = p_item and session_id = p_session;
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if i.allocation_mode = 'exclusive' then
    if p_shared is not null or p_units is null or p_units < 0 or p_units > i.quantity then raise exception 'INVALID_CLAIM'; end if;
    select coalesce(sum(claimed_units), 0) into claimed from public.split_item_claims where item_id = p_item and participant_id <> p;
    if claimed + p_units > i.quantity then raise exception 'CLAIM_CONFLICT'; end if;
    if p_units = 0 then delete from public.split_item_claims where item_id = p_item and participant_id = p;
    else insert into public.split_item_claims(session_id, item_id, participant_id, claimed_units) values (p_session, p_item, p, p_units)
      on conflict (item_id, participant_id) do update set claimed_units = excluded.claimed_units, is_shared_member = false; end if;
  else
    if p_units is not null or p_shared is null then raise exception 'INVALID_CLAIM'; end if;
    if not p_shared then delete from public.split_item_claims where item_id = p_item and participant_id = p;
    else insert into public.split_item_claims(session_id, item_id, participant_id, is_shared_member) values (p_session, p_item, p, true)
      on conflict (item_id, participant_id) do update set claimed_units = 0, is_shared_member = true; end if;
  end if;
  update public.split_sessions set version = version + 1 where id = p_session;
end; $$;

create function public.split_host_claim(p_host uuid, p_session uuid, p_item uuid, p_participant uuid, p_units integer, p_shared boolean) returns void language plpgsql security definer set search_path = '' as $$
declare target_user uuid;
begin
  if not exists(select 1 from public.split_sessions where id = p_session and host_user_id = p_host) then raise exception 'FORBIDDEN'; end if;
  select user_id into target_user from public.split_participants where id = p_participant and session_id = p_session;
  if target_user is null then raise exception 'FORBIDDEN'; end if;
  perform public.split_claim(target_user, p_session, p_item, p_units, p_shared);
end; $$;

create function public.split_throttle(p_hash text, p_limit integer) returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.split_rate_limits(key_hash, attempts, reset_at) values (p_hash, 1, now() + interval '1 minute')
  on conflict (key_hash) do update set attempts = case when public.split_rate_limits.reset_at <= now() then 1 else public.split_rate_limits.attempts + 1 end,
    reset_at = case when public.split_rate_limits.reset_at <= now() then now() + interval '1 minute' else public.split_rate_limits.reset_at end
  returning attempts into n;
  return n <= p_limit;
end; $$;

revoke all on function public.split_create(uuid,jsonb,text), public.split_invite(uuid,uuid,text), public.split_invite_preview(text), public.split_join(uuid,text,text), public.split_open(uuid,uuid), public.split_mode(uuid,uuid,uuid,text), public.split_claim(uuid,uuid,uuid,integer,boolean), public.split_host_claim(uuid,uuid,uuid,uuid,integer,boolean), public.split_throttle(text,integer) from public, anon, authenticated;
grant execute on function public.split_create(uuid,jsonb,text), public.split_invite(uuid,uuid,text), public.split_invite_preview(text), public.split_join(uuid,text,text), public.split_open(uuid,uuid), public.split_mode(uuid,uuid,uuid,text), public.split_claim(uuid,uuid,uuid,integer,boolean), public.split_host_claim(uuid,uuid,uuid,uuid,integer,boolean), public.split_throttle(text,integer) to service_role;
alter publication supabase_realtime add table public.split_sessions;

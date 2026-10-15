-- Apply after 202610140001 and 202610150001. Back up the project before applying.
-- Existing finalized summaries and split_settlements are deliberately left unchanged.
create table if not exists public.friend_groups (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 80),
  archived_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists friend_groups_owner on public.friend_groups(owner_user_id, archived_at);
create table if not exists public.friend_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.friend_groups(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 40),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id, sort_order)
);
create index if not exists friend_group_members_group on public.friend_group_members(group_id);
alter table public.friend_groups enable row level security;
alter table public.friend_group_members enable row level security;
drop policy if exists friend_groups_owner_read on public.friend_groups;
create policy friend_groups_owner_read on public.friend_groups for select to authenticated using (owner_user_id = (select auth.uid()));
drop policy if exists friend_group_members_owner_read on public.friend_group_members;
create policy friend_group_members_owner_read on public.friend_group_members for select to authenticated using (
  exists(select 1 from public.friend_groups g where g.id = group_id and g.owner_user_id = (select auth.uid()))
);
grant select on public.friend_groups, public.friend_group_members to authenticated;
revoke insert, update, delete on public.friend_groups, public.friend_group_members from anon, authenticated;
alter table public.split_sessions add column if not exists group_id uuid references public.friend_groups(id) on delete set null;
create index if not exists split_sessions_group on public.split_sessions(group_id);

create or replace function public.split_group_save(p_group uuid, p_name text, p_members jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); target_id uuid; n integer;
begin
  if owner_id is null or p_name is null or length(trim(p_name)) not between 1 and 80 or p_members is null or jsonb_typeof(p_members) <> 'array' then raise exception 'INVALID_INPUT'; end if;
  n := jsonb_array_length(p_members);
  if n > 30 or (select count(distinct x.id) from jsonb_to_recordset(p_members) as x(id uuid)) <> n or
    exists(select 1 from jsonb_to_recordset(p_members) as x(id uuid, display_name text) where x.id is null or x.display_name is null or length(trim(x.display_name)) not between 1 and 40)
  then raise exception 'INVALID_INPUT'; end if;
  if p_group is null then
    insert into public.friend_groups(owner_user_id, name) values(owner_id, trim(p_name)) returning id into target_id;
  else
    select id into target_id from public.friend_groups where id = p_group and owner_user_id = owner_id and archived_at is null for update;
    if target_id is null then raise exception 'FORBIDDEN'; end if;
    update public.friend_groups set name = trim(p_name), updated_at = now() where id = target_id;
  end if;
  if exists(select 1 from jsonb_to_recordset(p_members) as x(id uuid) join public.friend_group_members m on m.id = x.id where m.group_id <> target_id) then raise exception 'FORBIDDEN'; end if;
  -- Replace the roster within one transaction. Supplied UUIDs keep stable template identity.
  delete from public.friend_group_members where group_id = target_id;
  insert into public.friend_group_members(id, group_id, display_name, sort_order)
  select (x.member->>'id')::uuid, target_id, trim(x.member->>'display_name'), (x.ordinality - 1)::integer
  from jsonb_array_elements(p_members) with ordinality as x(member, ordinality);
  return target_id;
end; $$;
create or replace function public.split_group_archive(p_group uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.friend_groups set archived_at = coalesce(archived_at, now()), updated_at = now()
  where id = p_group and owner_user_id = auth.uid();
  if not found then raise exception 'FORBIDDEN'; end if;
end; $$;
revoke all on function public.split_group_save(uuid,text,jsonb), public.split_group_archive(uuid) from public, anon;
grant execute on function public.split_group_save(uuid,text,jsonb), public.split_group_archive(uuid) to authenticated;

create or replace function public.split_create_group(p_user uuid, p_bill jsonb, p_host_name text, p_group uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if p_group is null or not exists(select 1 from public.friend_groups where id = p_group and owner_user_id = p_user and archived_at is null) then raise exception 'FORBIDDEN'; end if;
  result := public.split_create(p_user, p_bill, p_host_name);
  update public.split_sessions set group_id = p_group where id = result and host_user_id = p_user and (group_id = p_group or (group_id is null and state = 'draft'));
  if not found then raise exception 'GROUP_CONFLICT'; end if;
  update public.friend_groups set last_used_at = now(), updated_at = now() where id = p_group;
  return result;
end; $$;
revoke all on function public.split_create_group(uuid,jsonb,text,uuid) from public, anon, authenticated;
grant execute on function public.split_create_group(uuid,jsonb,text,uuid) to service_role;

create table if not exists public.split_upfront_contributions (
  session_id uuid not null references public.split_sessions(id) on delete cascade,
  participant_id uuid not null references public.split_participants(id) on delete cascade,
  amount_idr bigint not null check (amount_idr >= 0),
  updated_at timestamptz not null default now(),
  primary key(session_id, participant_id)
);
create index if not exists split_contributions_participant on public.split_upfront_contributions(participant_id);
create table if not exists public.split_transfers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.split_sessions(id) on delete cascade,
  from_participant_id uuid not null references public.split_participants(id),
  to_participant_id uuid not null references public.split_participants(id),
  amount_idr bigint not null check (amount_idr > 0),
  status text not null default 'unpaid' check (status in ('paid','unpaid')),
  paid_at timestamptz,
  confirmed_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, from_participant_id, to_participant_id),
  check(from_participant_id <> to_participant_id),
  check((status = 'paid') = (paid_at is not null))
);
create index if not exists split_transfers_session on public.split_transfers(session_id);
create table if not exists public.split_transfer_events (
  id bigint generated always as identity primary key,
  transfer_id uuid not null references public.split_transfers(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  old_status text not null check(old_status in ('paid','unpaid')),
  new_status text not null check(new_status in ('paid','unpaid')),
  created_at timestamptz not null default now(),
  check(old_status <> new_status)
);
create index if not exists split_transfer_events_transfer on public.split_transfer_events(transfer_id);
alter table public.split_upfront_contributions enable row level security;
alter table public.split_transfers enable row level security;
alter table public.split_transfer_events enable row level security;
drop policy if exists split_contributions_member_read on public.split_upfront_contributions;
create policy split_contributions_member_read on public.split_upfront_contributions for select to authenticated using (private.split_is_member(session_id));
drop policy if exists split_transfers_member_read on public.split_transfers;
create policy split_transfers_member_read on public.split_transfers for select to authenticated using (private.split_is_member(session_id));
drop policy if exists split_transfer_events_host_read on public.split_transfer_events;
create policy split_transfer_events_host_read on public.split_transfer_events for select to authenticated using (
  exists(select 1 from public.split_transfers t join public.split_sessions s on s.id = t.session_id where t.id = transfer_id and s.host_user_id = auth.uid())
);
grant select on public.split_upfront_contributions, public.split_transfers, public.split_transfer_events to authenticated;
revoke insert, update, delete on public.split_upfront_contributions, public.split_transfers, public.split_transfer_events from anon, authenticated;

create or replace function public.split_set_contributions(p_user uuid, p_session uuid, p_expected_version integer, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.split_sessions%rowtype; n integer;
begin
  select * into s from public.split_sessions where id = p_session for update;
  if s.id is null or s.host_user_id <> p_user then raise exception 'FORBIDDEN'; end if;
  if s.state <> 'claiming' or s.expires_at <= now() then raise exception 'ROOM_NOT_CLAIMING'; end if;
  if s.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID_INPUT'; end if;
  n := jsonb_array_length(p_rows);
  if n <> (select count(*) from public.split_participants where session_id = p_session) or
    (select count(distinct x.participant_id) from jsonb_to_recordset(p_rows) as x(participant_id uuid)) <> n or
    exists(select 1 from jsonb_to_recordset(p_rows) as x(participant_id uuid, amount_idr bigint) where x.amount_idr is null or x.amount_idr < 0 or x.amount_idr > s.grand_total_amount or not exists(select 1 from public.split_participants p where p.id = x.participant_id and p.session_id = p_session))
  then raise exception 'INVALID_INPUT'; end if;
  delete from public.split_upfront_contributions where session_id = p_session;
  insert into public.split_upfront_contributions(session_id, participant_id, amount_idr)
  select p_session, x.participant_id, x.amount_idr from jsonb_to_recordset(p_rows) as x(participant_id uuid, amount_idr bigint);
  update public.split_sessions set version = version + 1 where id = p_session;
end; $$;

create or replace function public.split_finalize_smart(p_user uuid, p_session uuid, p_expected_version integer, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.split_sessions%rowtype; contribution_count integer; contribution_total bigint;
begin
  select * into s from public.split_sessions where id = p_session for update;
  if s.id is null or s.host_user_id <> p_user then raise exception 'FORBIDDEN'; end if;
  if s.state = 'finalized' then return; end if;
  if s.state <> 'claiming' or s.expires_at <= now() then raise exception 'ROOM_NOT_CLAIMING'; end if;
  if s.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  select count(*), coalesce(sum(amount_idr),0) into contribution_count, contribution_total from public.split_upfront_contributions where session_id = p_session;
  if contribution_count = 0 then
    insert into public.split_upfront_contributions(session_id, participant_id, amount_idr)
    select p_session, id, case when role = 'host' then s.grand_total_amount else 0 end from public.split_participants where session_id = p_session;
    contribution_total := s.grand_total_amount;
  elsif contribution_count <> (select count(*) from public.split_participants where session_id = p_session) then raise exception 'CONTRIBUTION_CONFLICT'; end if;
  if contribution_total <> s.grand_total_amount then raise exception 'CONTRIBUTION_MISMATCH'; end if;
  if exists(select 1 from public.split_upfront_contributions c where c.session_id = p_session and not exists(select 1 from public.split_participants p where p.id = c.participant_id and p.session_id = p_session)) then raise exception 'CONTRIBUTION_CONFLICT'; end if;
  perform public.split_finalize(p_user, p_session, p_expected_version, p_rows);
  -- Interval overlap is deterministic largest-balance-first greedy matching.
  with balances as (
    select f.participant_id, f.final_amount - c.amount_idr as debt
    from public.split_finalized_summaries f join public.split_upfront_contributions c on c.session_id = f.session_id and c.participant_id = f.participant_id
    where f.session_id = p_session
  ), debtors as (
    select participant_id, coalesce(sum(debt) over (order by debt desc, participant_id rows between unbounded preceding and 1 preceding),0) as first,
      sum(debt) over (order by debt desc, participant_id) as last from balances where debt > 0
  ), creditors as (
    select participant_id, coalesce(sum(-debt) over (order by debt, participant_id rows between unbounded preceding and 1 preceding),0) as first,
      sum(-debt) over (order by debt, participant_id) as last from balances where debt < 0
  )
  insert into public.split_transfers(session_id, from_participant_id, to_participant_id, amount_idr)
  select p_session, d.participant_id, c.participant_id, least(d.last,c.last) - greatest(d.first,c.first)
  from debtors d cross join creditors c where least(d.last,c.last) > greatest(d.first,c.first)
  on conflict (session_id, from_participant_id, to_participant_id) do nothing;
  if (select coalesce(sum(amount_idr),0) from public.split_transfers where session_id = p_session) <>
    (select coalesce(sum(greatest(f.final_amount - c.amount_idr,0)),0) from public.split_finalized_summaries f join public.split_upfront_contributions c on c.session_id=f.session_id and c.participant_id=f.participant_id where f.session_id=p_session)
  then raise exception 'TOTAL_MISMATCH'; end if;
end; $$;

create or replace function public.split_set_transfer(p_user uuid, p_session uuid, p_transfer uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.split_sessions%rowtype; previous_status text;
begin
  select * into s from public.split_sessions where id = p_session for update;
  if s.id is null or s.host_user_id <> p_user then raise exception 'FORBIDDEN'; end if;
  if s.state <> 'finalized' then raise exception 'ROOM_NOT_FINALIZED'; end if;
  if p_status not in ('paid','unpaid') then raise exception 'INVALID_INPUT'; end if;
  select status into previous_status from public.split_transfers where id = p_transfer and session_id = p_session;
  if previous_status is null then raise exception 'TRANSFER_NOT_FOUND'; end if;
  if previous_status = p_status then return; end if;
  update public.split_transfers set status = p_status, paid_at = case when p_status = 'paid' then now() else null end,
    confirmed_by_user_id = p_user, updated_at = now() where id = p_transfer and session_id = p_session;
  insert into public.split_transfer_events(transfer_id, actor_user_id, old_status, new_status) values(p_transfer,p_user,previous_status,p_status);
  update public.split_sessions set version = version + 1 where id = p_session;
end; $$;
revoke all on function public.split_set_contributions(uuid,uuid,integer,jsonb), public.split_finalize_smart(uuid,uuid,integer,jsonb), public.split_set_transfer(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.split_set_contributions(uuid,uuid,integer,jsonb), public.split_finalize_smart(uuid,uuid,integer,jsonb), public.split_set_transfer(uuid,uuid,uuid,text) to service_role;

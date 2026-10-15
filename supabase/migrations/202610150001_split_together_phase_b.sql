-- Apply after Phase A. Only the server-side service role may mutate these records.
create or replace function public.split_invite_preview(p_hash text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object('title', s.title, 'state', s.state, 'expires_at', s.expires_at, 'full', (select count(*) >= s.max_participants from public.split_participants p where p.session_id = s.id)) into result
  from public.split_invites i join public.split_sessions s on s.id = i.session_id
  where i.token_hash = p_hash and i.revoked_at is null and i.expires_at > now() and s.expires_at > now() and s.state in ('draft','claiming');
  return result;
end; $$;

create table public.split_finalized_summaries (
  session_id uuid not null references public.split_sessions(id) on delete cascade,
  participant_id uuid not null references public.split_participants(id) on delete cascade,
  item_amount bigint not null check (item_amount >= 0),
  discount_share bigint not null check (discount_share <= 0),
  service_share bigint not null check (service_share >= 0),
  tax_share bigint not null check (tax_share >= 0),
  tip_share bigint not null check (tip_share >= 0),
  rounding_share bigint not null,
  final_amount bigint not null check (final_amount >= 0),
  finalized_at timestamptz not null default now(),
  primary key (session_id, participant_id),
  check (final_amount = item_amount + discount_share + service_share + tax_share + tip_share + rounding_share)
);
create table public.split_settlements (
  session_id uuid not null references public.split_sessions(id) on delete cascade,
  participant_id uuid not null references public.split_participants(id) on delete cascade,
  amount_due bigint not null check (amount_due >= 0),
  status text not null check (status in ('paid', 'unpaid')),
  paid_at timestamptz,
  marked_by_user_id uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (session_id, participant_id),
  check ((status = 'paid') = (paid_at is not null))
);
alter table public.split_finalized_summaries enable row level security;
alter table public.split_settlements enable row level security;
create policy split_summary_read on public.split_finalized_summaries for select to authenticated using (private.split_is_member(session_id));
create policy split_settlement_read on public.split_settlements for select to authenticated using (private.split_is_member(session_id));
grant select on public.split_finalized_summaries, public.split_settlements to authenticated;
revoke insert, update, delete on public.split_finalized_summaries, public.split_settlements from anon, authenticated;

create function public.split_finalize(p_user uuid, p_session uuid, p_expected_version integer, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.split_sessions%rowtype; row_count integer; participant_count integer;
begin
  select * into s from public.split_sessions where id = p_session for update;
  if s.id is null or s.host_user_id <> p_user then raise exception 'FORBIDDEN'; end if;
  if s.state = 'finalized' then return; end if;
  if s.expires_at <= now() then raise exception 'ROOM_EXPIRED'; end if;
  if s.state <> 'claiming' then raise exception 'ROOM_NOT_CLAIMING'; end if;
  if s.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID_INPUT'; end if;
  select count(*) into participant_count from public.split_participants where session_id = p_session;
  row_count := jsonb_array_length(p_rows);
  if row_count <> participant_count or row_count = 0 or
    (select count(distinct x.participant_id) from jsonb_to_recordset(p_rows) as x(participant_id uuid)) <> row_count or
    exists(select 1 from jsonb_to_recordset(p_rows) as x(participant_id uuid) where not exists
      (select 1 from public.split_participants p where p.id = x.participant_id and p.session_id = p_session))
  then raise exception 'INVALID_INPUT'; end if;

  if exists(
    select 1 from public.split_session_items i
    left join lateral (
      select coalesce(sum(c.claimed_units), 0) as units, count(*) filter (where c.is_shared_member) as members
      from public.split_item_claims c where c.item_id = i.id and c.session_id = p_session
    ) claimed on true
    where i.session_id = p_session and
      ((i.allocation_mode = 'exclusive' and claimed.units <> i.quantity) or
       (i.allocation_mode = 'shared' and claimed.members = 0))
  ) then raise exception 'INCOMPLETE_ALLOCATION'; end if;

  if (select coalesce(sum(i.total_amount), 0) from public.split_session_items i where i.session_id = p_session) <> s.subtotal_amount or
    (select coalesce(sum(x.item_amount), 0) from jsonb_to_recordset(p_rows) as x(item_amount bigint)) <> s.subtotal_amount or
    (select coalesce(sum(x.discount_share), 0) from jsonb_to_recordset(p_rows) as x(discount_share bigint)) <> -s.discount_amount or
    (select coalesce(sum(x.service_share), 0) from jsonb_to_recordset(p_rows) as x(service_share bigint)) <> s.service_amount or
    (select coalesce(sum(x.tax_share), 0) from jsonb_to_recordset(p_rows) as x(tax_share bigint)) <> s.tax_amount or
    (select coalesce(sum(x.tip_share), 0) from jsonb_to_recordset(p_rows) as x(tip_share bigint)) <> s.tip_amount or
    (select coalesce(sum(x.rounding_share), 0) from jsonb_to_recordset(p_rows) as x(rounding_share bigint)) <> s.rounding_amount or
    (select coalesce(sum(x.final_amount), 0) from jsonb_to_recordset(p_rows) as x(final_amount bigint)) <> s.grand_total_amount
  then raise exception 'TOTAL_MISMATCH'; end if;

  insert into public.split_finalized_summaries(session_id, participant_id, item_amount, discount_share, service_share, tax_share, tip_share, rounding_share, final_amount)
  select p_session, x.participant_id, x.item_amount, x.discount_share, x.service_share, x.tax_share, x.tip_share, x.rounding_share, x.final_amount
  from jsonb_to_recordset(p_rows) as x(participant_id uuid, item_amount bigint, discount_share bigint, service_share bigint, tax_share bigint, tip_share bigint, rounding_share bigint, final_amount bigint);
  insert into public.split_settlements(session_id, participant_id, amount_due, status, paid_at, marked_by_user_id)
  select p_session, f.participant_id, f.final_amount, case when p.role = 'host' then 'paid' else 'unpaid' end,
    case when p.role = 'host' then now() else null end, case when p.role = 'host' then p_user else null end
  from public.split_finalized_summaries f join public.split_participants p on p.id = f.participant_id
  where f.session_id = p_session;
  update public.split_sessions set state = 'finalized', version = version + 1 where id = p_session;
end; $$;

create function public.split_set_payment(p_user uuid, p_session uuid, p_participant uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.split_sessions%rowtype; current_status text;
begin
  select * into s from public.split_sessions where id = p_session for update;
  if s.id is null or s.host_user_id <> p_user then raise exception 'FORBIDDEN'; end if;
  if s.state <> 'finalized' then raise exception 'ROOM_NOT_FINALIZED'; end if;
  if p_status not in ('paid', 'unpaid') then raise exception 'INVALID_INPUT'; end if;
  if not exists(select 1 from public.split_participants where id = p_participant and session_id = p_session and role = 'guest') then raise exception 'FORBIDDEN'; end if;
  select status into current_status from public.split_settlements where session_id = p_session and participant_id = p_participant;
  if current_status is null then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if current_status = p_status then return; end if;
  update public.split_settlements set status = p_status, paid_at = case when p_status = 'paid' then now() else null end,
    marked_by_user_id = p_user, updated_at = now() where session_id = p_session and participant_id = p_participant;
  update public.split_sessions set version = version + 1 where id = p_session;
end; $$;

revoke all on function public.split_finalize(uuid,uuid,integer,jsonb), public.split_set_payment(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.split_finalize(uuid,uuid,integer,jsonb), public.split_set_payment(uuid,uuid,uuid,text) to service_role;

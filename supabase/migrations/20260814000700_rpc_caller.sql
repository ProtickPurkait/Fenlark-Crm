-- ============================================================================
-- Fenlark CRM · 0700 — Telecaller RPCs & Queue View
-- ============================================================================


-- ---------------------------------------------------------------------------
-- log_call_interaction — the single write path for the disposition drawer
-- ---------------------------------------------------------------------------
-- Status change, remark and reschedule are one atomic operation, which is what
-- guarantees a remark can never be orphaned from the status it explains.
--
-- SECURITY DEFINER (it writes the audit row directly), and therefore it
-- re-verifies ownership itself. RLS does not protect the body of a SECURITY
-- DEFINER function — this check is the only thing standing in for it.
create or replace function public.log_call_interaction(
  p_lead_id      uuid,
  p_status       public.lead_status,
  p_remark       text,
  p_scheduled_at timestamptz default null
)
returns public.leads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_lead       public.leads;
  v_old_status public.lead_status;
  v_remark     text := nullif(btrim(p_remark), '');
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- FOR UPDATE: two devices logging the same lead simultaneously serialise
  -- here rather than racing and losing one of the two remarks.
  select * into v_lead
  from public.leads
  where id = p_lead_id and deleted_at is null
  for update;

  if not found then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;

  if not (public.is_admin() or v_lead.assigned_to = v_actor) then
    raise exception 'forbidden: this lead is not assigned to you'
      using errcode = '42501';
  end if;

  if v_remark is null then
    raise exception 'a remark is required when logging a call';
  end if;

  -- A "Rescheduled" lead with no future date is the main way follow-ups get
  -- silently lost, so it is rejected at the database rather than trusted to
  -- client-side form validation.
  if p_status = 'rescheduled'
     and (p_scheduled_at is null or p_scheduled_at <= now()) then
    raise exception 'Rescheduled leads require a follow-up date/time in the future';
  end if;

  v_old_status := v_lead.status;

  update public.leads
     set status            = p_status,
         last_remark       = v_remark,
         last_contacted_at = now(),
         scheduled_at      = case
                               -- Closing a lead clears any pending follow-up.
                               when p_status in ('converted', 'dead') then null
                               else coalesce(p_scheduled_at, scheduled_at)
                             end
   where id = p_lead_id
  returning * into v_lead;

  -- The status_changed / reschedule_set entries come from the trigger in 0400.
  -- This adds the remark itself, carrying the status transition it explains so
  -- the timeline reads as one coherent event.
  insert into public.lead_history_logs (
    lead_id, actor_id, actor_kind, event_type, from_status, to_status, remark, scheduled_at
  )
  values (
    p_lead_id, v_actor, 'user', 'remark_added',
    v_old_status, p_status, v_remark, v_lead.scheduled_at
  );

  return v_lead;
end $$;

comment on function public.log_call_interaction(uuid, public.lead_status, text, timestamptz) is
  'Sole telecaller write path. Clients should never UPDATE public.leads '
  'directly — doing so bypasses the remark requirement and the reschedule '
  'validation, though not the audit trail.';


-- ---------------------------------------------------------------------------
-- my_dashboard_stats
-- ---------------------------------------------------------------------------
-- One round trip for the telecaller's personal dashboard.
--
-- "Today" is evaluated in system_settings.report_timezone, not UTC. On a UTC
-- boundary the Calls Made Today counter would reset at 05:30 IST — mid-shift,
-- with half the morning's calls already logged.
create or replace function public.my_dashboard_stats()
returns table (
  calls_made_today   integer,
  followups_pending  integer,
  followups_overdue  integer,
  assigned_total     integer,
  untouched_new      integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tz    text;
  v_start timestamptz;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select report_timezone into v_tz from public.system_settings where id = true;
  v_tz := coalesce(v_tz, 'Asia/Kolkata');

  -- Computed as a constant so the comparison stays sargable against
  -- lead_history_actor_idx.
  v_start := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  return query
  select
    (select count(*) from public.lead_history_logs h
      where h.actor_id = v_actor
        and h.event_type = 'remark_added'
        and h.created_at >= v_start)::integer,

    (select count(*) from public.leads l
      where l.assigned_to = v_actor
        and l.deleted_at is null
        and l.scheduled_at is not null
        and l.scheduled_at >= now()
        and l.status not in ('converted', 'dead'))::integer,

    (select count(*) from public.leads l
      where l.assigned_to = v_actor
        and l.deleted_at is null
        and l.scheduled_at is not null
        and l.scheduled_at < now()
        and l.status not in ('converted', 'dead'))::integer,

    (select count(*) from public.leads l
      where l.assigned_to = v_actor
        and l.deleted_at is null)::integer,

    -- Surfaced deliberately: these are the leads the recycling engine will
    -- reclaim if the caller does not touch them before the SLA expires.
    (select count(*) from public.leads l
      where l.assigned_to = v_actor
        and l.deleted_at is null
        and l.status = 'new')::integer;
end $$;


-- ---------------------------------------------------------------------------
-- lead_queue — priority-ordered working view
-- ---------------------------------------------------------------------------
-- security_invoker = true, so the leads RLS policy applies with the *querying*
-- user's rights. A telecaller selecting from this view sees only their own
-- leads; an admin sees everything. One view, no duplicated filtering.
create or replace view public.lead_queue
with (security_invoker = true) as
select
  l.*,
  case
    when l.status in ('converted', 'dead')            then 'closed'
    when l.scheduled_at is null                       then 'unscheduled'
    when l.scheduled_at <  now()                      then 'overdue'
    when l.scheduled_at <  now() + interval '2 hours' then 'due_soon'
    when l.scheduled_at <  now() + interval '24 hours' then 'due_today'
    else 'scheduled'
  end as follow_up_bucket,
  -- Sort key for the caller's queue: overdue first, then imminent, then
  -- untouched new leads (which are burning SLA), then everything else.
  case
    when l.status in ('converted', 'dead')            then 90
    when l.scheduled_at <  now()                      then 10
    when l.scheduled_at <  now() + interval '2 hours' then 20
    when l.scheduled_at <  now() + interval '24 hours' then 30
    when l.status = 'new'                             then 40
    when l.scheduled_at is not null                   then 50
    else 60
  end as queue_rank,
  -- Hours remaining before the recycling engine reclaims this lead. Null when
  -- not applicable. Lets the UI warn "returns to pool in 4h".
  case
    when l.status = 'new' and l.assigned_at is not null then
      greatest(
        0,
        (select s.stale_sla_hours from public.system_settings s where s.id = true)
        - (extract(epoch from (now() - l.assigned_at)) / 3600)
      )
    else null
  end as sla_hours_remaining
from public.leads l
where l.deleted_at is null;

revoke all on public.lead_queue from anon, authenticated;
grant select on public.lead_queue to authenticated;

comment on view public.lead_queue is
  'Order by queue_rank, scheduled_at nulls last. Overdue and Due Soon rise to '
  'the top of the telecaller queue automatically.';


-- ---------------------------------------------------------------------------
-- Execution grants
-- ---------------------------------------------------------------------------
revoke execute on function public.log_call_interaction(uuid, public.lead_status, text, timestamptz) from public;
revoke execute on function public.my_dashboard_stats()                                              from public;

grant execute on function public.log_call_interaction(uuid, public.lead_status, text, timestamptz)  to authenticated;
grant execute on function public.my_dashboard_stats()                                               to authenticated;

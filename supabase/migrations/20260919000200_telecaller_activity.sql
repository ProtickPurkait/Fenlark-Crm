-- ============================================================================
-- Trace · 2300 — Telecaller activity (Tier 1 productivity signals)
-- ============================================================================
-- Answers "is this telecaller actually working?" from data the app already
-- holds, with no new capture and no new vendor.
--
-- WHAT THIS CAN AND CANNOT SHOW, stated plainly so nobody reads more into a
-- number than it carries:
--
--   * clocked_seconds comes from attendance, which is self-reported.
--   * talk_seconds comes from call_sessions, whose durations are app
--     estimates a telecaller can hand-edit before saving (migration 1100).
--     Talk time is therefore the single most gameable figure here and must
--     never be read on its own. manual_duration_count is reported alongside
--     it for exactly that reason: it counts how many of the day's durations
--     were typed rather than measured.
--   * longest_gap_seconds is the most trustworthy column. It is derived from
--     lead_history_logs, which is append-only and enforced three separate
--     ways, so a caller cannot delete the evidence of a quiet afternoon —
--     they can only produce activity or not.
--
-- The honest summary: nothing here proves work. Together these make faking
-- effortful and inconsistency visible, which is a different and achievable
-- goal. Carrier-verified duration needs duration_source = 'provider'.
-- ============================================================================

create or replace function public.admin_telecaller_activity(p_date date)
returns table (
  telecaller_id         uuid,
  full_name             text,
  clock_in_at           timestamptz,
  clock_out_at          timestamptz,
  clocked_seconds       integer,
  first_action_at       timestamptz,
  last_action_at        timestamptz,
  -- Longest stretch inside the clocked shift with no audit event and no call.
  -- Null when the telecaller never clocked in: there is no shift to measure
  -- silence against, and reporting zero would read as "no idle time".
  longest_gap_seconds   integer,
  calls                 integer,
  talk_seconds          integer,
  median_call_seconds   integer,
  short_calls           integer,
  manual_duration_count integer,
  dispositions          integer,
  warm_count            integer,
  converted_count       integer,
  dead_count            integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz    text;
  v_start timestamptz;
  v_end   timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  select coalesce(report_timezone, 'Asia/Kolkata') into v_tz
  from public.system_settings where id = true;
  v_start := p_date::timestamp at time zone v_tz;
  v_end   := (p_date + 1)::timestamp at time zone v_tz;

  return query
  with callers as (
    select u.id, u.full_name
    from public.users u
    where u.role = 'telecaller' and u.is_active
  ),
  att as (
    select a.telecaller_id, a.clock_in_at, a.clock_out_at
    from public.attendance a
    where a.work_date = p_date
  ),
  -- Everything that counts as evidence of work, from both tables that record
  -- it. A call starting and a call ending are separate marks on the timeline:
  -- a 40-minute call is working time, not a 40-minute gap.
  marks as (
    select h.actor_id as caller_id, h.created_at as at
      from public.lead_history_logs h
     where h.actor_id is not null
       and h.actor_kind = 'user'
       and h.created_at >= v_start and h.created_at < v_end
    union all
    select cs.caller_id, cs.started_at
      from public.call_sessions cs
     where cs.started_at >= v_start and cs.started_at < v_end
    union all
    select cs.caller_id, cs.ended_at
      from public.call_sessions cs
     where cs.ended_at is not null
       and cs.ended_at >= v_start and cs.ended_at < v_end
  ),
  -- The shift's own boundaries join the timeline, so a caller who clocks in
  -- at 09:00 and does nothing until 11:40 shows a 2h40m gap rather than no
  -- gap at all. The closing bound is the clock-out, or now() for a shift
  -- still running, so an ongoing silence is visible while it is happening.
  bounded as (
    select
      a.telecaller_id as caller_id,
      m.at
    from att a
    join marks m
      on m.caller_id = a.telecaller_id
     and m.at >= a.clock_in_at
     and m.at <= coalesce(a.clock_out_at, least(now(), v_end))
    union all
    select a.telecaller_id, a.clock_in_at from att a
    union all
    select a.telecaller_id, coalesce(a.clock_out_at, least(now(), v_end)) from att a
  ),
  gaps as (
    select
      b.caller_id,
      max(extract(epoch from (b.at - b.prev)))::integer as longest_gap
    from (
      select
        caller_id,
        at,
        lag(at) over (partition by caller_id order by at) as prev
      from bounded
    ) b
    where b.prev is not null
    group by b.caller_id
  ),
  calls as (
    select
      cs.caller_id,
      count(*)::integer as calls,
      coalesce(sum(cs.duration_seconds), 0)::integer as talk_seconds,
      -- Swept sessions carry a null duration by design; they are excluded
      -- here rather than counted as zero-length calls, which would drag the
      -- median toward zero and invent a dial-and-drop pattern.
      coalesce(
        percentile_cont(0.5) within group (order by cs.duration_seconds)
          filter (where cs.duration_seconds is not null),
        0
      )::integer as median_seconds,
      count(*) filter (where cs.duration_seconds is not null
                         and cs.duration_seconds < 20)::integer as short_calls,
      count(*) filter (where cs.duration_source = 'manual')::integer as manual_count
    from public.call_sessions cs
    where cs.started_at >= v_start and cs.started_at < v_end
    group by cs.caller_id
  ),
  work as (
    select
      h.actor_id as caller_id,
      count(*) filter (where h.event_type = 'remark_added')::integer as dispositions,
      min(h.created_at) as first_at,
      max(h.created_at) as last_at,
      count(*) filter (where h.event_type = 'status_changed'
                         and h.to_status = 'warm')::integer as warm,
      count(*) filter (where h.event_type = 'status_changed'
                         and h.to_status = 'converted')::integer as converted,
      count(*) filter (where h.event_type = 'status_changed'
                         and h.to_status = 'dead')::integer as dead
    from public.lead_history_logs h
    where h.actor_id is not null
      and h.actor_kind = 'user'
      and h.created_at >= v_start and h.created_at < v_end
    group by h.actor_id
  )
  select
    c.id,
    c.full_name,
    a.clock_in_at,
    a.clock_out_at,
    case
      when a.clock_in_at is null then 0
      else extract(epoch from (
        coalesce(a.clock_out_at, least(now(), v_end)) - a.clock_in_at
      ))::integer
    end,
    w.first_at,
    w.last_at,
    g.longest_gap,
    coalesce(cl.calls, 0),
    coalesce(cl.talk_seconds, 0),
    coalesce(cl.median_seconds, 0),
    coalesce(cl.short_calls, 0),
    coalesce(cl.manual_count, 0),
    coalesce(w.dispositions, 0),
    coalesce(w.warm, 0),
    coalesce(w.converted, 0),
    coalesce(w.dead, 0)
  from callers c
  left join att  a  on a.telecaller_id = c.id
  left join gaps g  on g.caller_id     = c.id
  left join calls cl on cl.caller_id   = c.id
  left join work w  on w.caller_id     = c.id
  -- Quietest first: the row an admin opened this screen to find should not
  -- need hunting for.
  order by coalesce(w.dispositions, 0) asc, c.full_name asc;
end $$;

revoke execute on function public.admin_telecaller_activity(date) from public, anon;
grant execute on function public.admin_telecaller_activity(date) to authenticated;

comment on function public.admin_telecaller_activity(date) is
  'Per-telecaller activity for one day. longest_gap_seconds is the most '
  'reliable column (append-only audit trail); talk_seconds is the least '
  '(caller-editable app estimate) — read it with manual_duration_count.';

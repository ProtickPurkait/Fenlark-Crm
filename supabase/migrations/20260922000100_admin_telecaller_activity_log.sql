-- ============================================================================
-- Trace · 2400 — Per-telecaller activity log for a single day
-- ============================================================================
-- admin_telecaller_activity() (migration 2300) answers "how much happened" —
-- counts and durations. Admins asked the follow-up question it cannot answer:
-- "what actually happened", i.e. the individual audit entries and calls
-- themselves, for one telecaller on one day. This is that drill-down.
--
-- Same day-boundary computation as 2300 (report_timezone, not server UTC) so
-- "today" means the same thing on both screens.
-- ============================================================================

create or replace function public.admin_telecaller_activity_log(
  p_date          date,
  p_telecaller_id uuid
)
returns table (
  logs  jsonb,
  calls jsonb
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
  select
    -- The audit trail: assignments, status changes, remarks, reschedules.
    -- Newest first, matching the lead-level timeline (AuditTimeline).
    (select coalesce(jsonb_agg(jsonb_build_object(
              'id', h.id,
              'created_at', h.created_at,
              'event_type', h.event_type,
              'lead_id', h.lead_id,
              'lead_full_name', l.full_name,
              'from_status', h.from_status,
              'to_status', h.to_status,
              'from_assignee_name', fa.full_name,
              'to_assignee_name', ta.full_name,
              'remark', h.remark,
              'note', h.note,
              'scheduled_at', h.scheduled_at
            ) order by h.created_at desc), '[]'::jsonb)
       from public.lead_history_logs h
       join public.leads l on l.id = h.lead_id
       left join public.users fa on fa.id = h.from_assignee
       left join public.users ta on ta.id = h.to_assignee
      where h.actor_id = p_telecaller_id
        and h.actor_kind = 'user'
        and h.created_at >= v_start and h.created_at < v_end),

    -- Calls placed, newest first. duration_seconds/duration_source carry the
    -- same reliability caveat as everywhere else this data is shown (2300):
    -- an app estimate the telecaller can hand-edit, not a measurement.
    (select coalesce(jsonb_agg(jsonb_build_object(
              'id', cs.id,
              'started_at', cs.started_at,
              'ended_at', cs.ended_at,
              'duration_seconds', cs.duration_seconds,
              'duration_source', cs.duration_source,
              'ended_reason', cs.ended_reason,
              'lead_id', cs.lead_id,
              'lead_full_name', l.full_name
            ) order by cs.started_at desc), '[]'::jsonb)
       from public.call_sessions cs
       join public.leads l on l.id = cs.lead_id
      where cs.caller_id = p_telecaller_id
        and cs.started_at >= v_start and cs.started_at < v_end);
end $$;

revoke execute on function public.admin_telecaller_activity_log(date, uuid) from public, anon;
grant execute on function public.admin_telecaller_activity_log(date, uuid) to authenticated;

comment on function public.admin_telecaller_activity_log(date, uuid) is
  'Drill-down for admin_telecaller_activity(): the individual audit-trail '
  'entries and calls behind one telecaller''s numbers for one day.';

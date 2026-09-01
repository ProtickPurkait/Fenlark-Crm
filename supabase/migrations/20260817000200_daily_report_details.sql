-- ============================================================================
-- Trace · 2000 — Daily Report Detail Lines
-- ============================================================================
-- my_daily_report_summary() (1900) returned bare counts. A count alone isn't
-- useful on a WhatsApp report an admin has to act on — "2 warm leads" still
-- means opening the CRM to find out which two. This widens each of the four
-- numbers into the list of leads behind it (name, phone, and a date where one
-- applies), so the report is self-contained.
-- ============================================================================

drop function if exists public.my_daily_report_summary(date);

create or replace function public.my_daily_report_summary(p_date date)
returns table (
  warm_leads   jsonb,
  converted    jsonb,
  schedules    jsonb,
  appointments jsonb
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
  v_end   timestamptz;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select coalesce(report_timezone, 'Asia/Kolkata') into v_tz
  from public.system_settings where id = true;
  v_start := p_date::timestamp at time zone v_tz;
  v_end   := (p_date + 1)::timestamp at time zone v_tz;

  return query
  select
    -- Warm leads today, oldest first — the order a telecaller actually
    -- worked them in.
    (select coalesce(jsonb_agg(jsonb_build_object(
              'full_name', l.full_name, 'phone', l.phone
            ) order by h.created_at), '[]'::jsonb)
       from public.lead_history_logs h
       join public.leads l on l.id = h.lead_id
      where h.actor_id = v_actor
        and h.event_type = 'status_changed'
        and h.to_status = 'warm'
        and h.created_at >= v_start and h.created_at < v_end),

    -- Sales submitted today.
    (select coalesce(jsonb_agg(jsonb_build_object(
              'full_name', l.full_name, 'phone', l.phone
            ) order by s.submitted_at), '[]'::jsonb)
       from public.sales s
       join public.leads l on l.id = s.lead_id
      where s.telecaller_id = v_actor
        and s.submitted_at >= v_start and s.submitted_at < v_end),

    -- Follow-ups set today, with the date they were set FOR (not today's
    -- date — h.scheduled_at is the new appointment/callback time itself).
    (select coalesce(jsonb_agg(jsonb_build_object(
              'full_name', l.full_name, 'phone', l.phone,
              'scheduled_at', h.scheduled_at
            ) order by h.created_at), '[]'::jsonb)
       from public.lead_history_logs h
       join public.leads l on l.id = h.lead_id
      where h.actor_id = v_actor
        and h.event_type = 'reschedule_set'
        and h.created_at >= v_start and h.created_at < v_end),

    -- Live backlog as of now, soonest first — not scoped to p_date, same
    -- reasoning as the original count in migration 1900.
    (select coalesce(jsonb_agg(jsonb_build_object(
              'full_name', l.full_name, 'phone', l.phone,
              'scheduled_at', l.scheduled_at
            ) order by l.scheduled_at), '[]'::jsonb)
       from public.leads l
      where l.assigned_to = v_actor
        and l.deleted_at is null
        and l.scheduled_at is not null
        and l.scheduled_at >= now());
end $$;

revoke execute on function public.my_daily_report_summary(date) from public, anon;
grant execute on function public.my_daily_report_summary(date) to authenticated;


-- ---------------------------------------------------------------------------
-- Default report template — widened to list the leads, not just count them
-- ---------------------------------------------------------------------------
-- Only applied where the template still matches the exact 1900 default: an
-- admin who has already customised their message keeps it untouched.
update public.system_settings
   set daily_report_template =
    'Daily Report — {{date}}' || chr(10) ||
    'Telecaller: {{agent}}' || chr(10) || chr(10) ||
    'Warm leads ({{warm_count}}):' || chr(10) || '{{warm}}' || chr(10) || chr(10) ||
    'Converted ({{converted_count}}):' || chr(10) || '{{converted}}' || chr(10) || chr(10) ||
    'Schedules ({{schedules_count}}):' || chr(10) || '{{schedules}}' || chr(10) || chr(10) ||
    'Appointments ({{appointments_count}}):' || chr(10) || '{{appointments}}'
 where id = true
   and daily_report_template =
    'Daily Report — {{date}}' || chr(10) ||
    'Telecaller: {{agent}}' || chr(10) ||
    'Warm leads: {{warm}}' || chr(10) ||
    'Converted: {{converted}}' || chr(10) ||
    'Schedules: {{schedules}}' || chr(10) ||
    'Appointments: {{appointments}}';

alter table public.system_settings
  alter column daily_report_template set default
    'Daily Report — {{date}}' || chr(10) ||
    'Telecaller: {{agent}}' || chr(10) || chr(10) ||
    'Warm leads ({{warm_count}}):' || chr(10) || '{{warm}}' || chr(10) || chr(10) ||
    'Converted ({{converted_count}}):' || chr(10) || '{{converted}}' || chr(10) || chr(10) ||
    'Schedules ({{schedules_count}}):' || chr(10) || '{{schedules}}' || chr(10) || chr(10) ||
    'Appointments ({{appointments_count}}):' || chr(10) || '{{appointments}}';

-- ============================================================================
-- Trace · 1900 — Attendance & WhatsApp Daily Report
-- ============================================================================
-- Replaces the earlier standalone daily-report form. A telecaller clocks in
-- at the start of their shift and clocks out at the end; clocking out reveals
-- "Generate Report", which computes that day's numbers from data the app
-- already has (no manual entry) and opens a pre-filled WhatsApp chat to the
-- admin's number so the telecaller just taps Send.
--
-- Two of the four numbers share one underlying signal in this schema
-- (leads.scheduled_at / the reschedule_set audit event is used for both "a
-- follow-up call" and "a client appointment") so they are deliberately
-- computed differently rather than duplicating the same count under two
-- names:
--   * schedules_count    — follow-ups this telecaller SET today (activity).
--   * appointments_count — this telecaller's leads with a still-FUTURE date,
--                          as of right now (current backlog, not "today").
-- ============================================================================


-- ---------------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
  id             uuid primary key default gen_random_uuid(),

  -- Matches leads.assigned_to / sales.telecaller_id: a departed telecaller's
  -- past attendance stays on the books after their account is deleted.
  telecaller_id  uuid references public.users (id) on delete set null,
  work_date      date not null,

  clock_in_at    timestamptz not null,
  clock_out_at   timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One shift per telecaller per day — see caller_clock_in()'s "already clocked
-- in today" guard, which is what this constraint backs.
create unique index if not exists attendance_telecaller_date_unique
  on public.attendance (telecaller_id, work_date);

-- The admin-facing "who clocked in today" query.
create index if not exists attendance_date_idx
  on public.attendance (work_date);

comment on table public.attendance is
  'One row per telecaller per calendar day, written only through '
  'caller_clock_in() / caller_clock_out().';

drop trigger if exists trg_attendance_touch on public.attendance;
create trigger trg_attendance_touch
  before update on public.attendance
  for each row execute function public.touch_updated_at();

alter table public.attendance enable row level security;

grant select on public.attendance to authenticated;
revoke insert, update, delete on public.attendance from authenticated, anon;

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated
  using (public.is_admin() or telecaller_id = auth.uid());


-- ---------------------------------------------------------------------------
-- caller_clock_in / caller_clock_out
-- ---------------------------------------------------------------------------
-- "Today" is evaluated in system_settings.report_timezone, same reasoning as
-- my_dashboard_stats() (0700): a UTC boundary would roll a shift over at
-- 05:30 IST, mid-shift.
create or replace function public.caller_clock_in()
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tz    text;
  v_today date;
  v_row   public.attendance;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select coalesce(report_timezone, 'Asia/Kolkata') into v_tz
  from public.system_settings where id = true;
  v_today := (now() at time zone v_tz)::date;

  if exists (
    select 1 from public.attendance
    where telecaller_id = v_actor and work_date = v_today
  ) then
    raise exception 'already clocked in today' using errcode = '23505';
  end if;

  insert into public.attendance (telecaller_id, work_date, clock_in_at)
  values (v_actor, v_today, now())
  returning * into v_row;

  return v_row;
end $$;

create or replace function public.caller_clock_out()
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tz    text;
  v_today date;
  v_row   public.attendance;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select coalesce(report_timezone, 'Asia/Kolkata') into v_tz
  from public.system_settings where id = true;
  v_today := (now() at time zone v_tz)::date;

  update public.attendance
     set clock_out_at = now()
   where telecaller_id = v_actor
     and work_date = v_today
     and clock_out_at is null
  returning * into v_row;

  if not found then
    raise exception 'no active clock-in found for today' using errcode = 'P0002';
  end if;

  return v_row;
end $$;

revoke execute on function public.caller_clock_in()  from public, anon;
revoke execute on function public.caller_clock_out() from public, anon;
grant execute on function public.caller_clock_in()  to authenticated;
grant execute on function public.caller_clock_out() to authenticated;


-- ---------------------------------------------------------------------------
-- system_settings — WhatsApp report destination + message template
-- ---------------------------------------------------------------------------
alter table public.system_settings
  add column if not exists admin_whatsapp_number text,
  add column if not exists daily_report_template text not null default
    'Daily Report — {{date}}' || chr(10) ||
    'Telecaller: {{agent}}' || chr(10) ||
    'Warm leads: {{warm}}' || chr(10) ||
    'Converted: {{converted}}' || chr(10) ||
    'Schedules: {{schedules}}' || chr(10) ||
    'Appointments: {{appointments}}';

comment on column public.system_settings.admin_whatsapp_number is
  'Destination number for a telecaller''s Generate Report button. Null until '
  'an admin sets it in Settings; the button stays disabled until then.';

-- Telecallers need both to build their own WhatsApp link client-side — same
-- reasoning as whatsapp_template in the original view (0500).
create or replace view public.app_settings
with (security_invoker = false) as
  select whatsapp_template, report_timezone, admin_whatsapp_number, daily_report_template
  from public.system_settings
  where id = true;


-- ---------------------------------------------------------------------------
-- admin_update_settings — widened to cover the two new fields
-- ---------------------------------------------------------------------------
-- Adding trailing parameters to a plpgsql function does not replace the old
-- signature in Postgres (it would coexist as a second overload), so the old
-- 3-arg version is dropped explicitly before recreating it with 5.
drop function if exists public.admin_update_settings(boolean, integer, text);

create or replace function public.admin_update_settings(
  p_enabled               boolean default null,
  p_sla_hours             integer default null,
  p_whatsapp_template     text    default null,
  p_admin_whatsapp_number text    default null,
  p_daily_report_template text    default null
)
returns public.system_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.system_settings;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if p_sla_hours is not null and p_sla_hours not between 1 and 720 then
    raise exception 'SLA hours must be between 1 and 720 (30 days)';
  end if;

  update public.system_settings
     set stale_recycling_enabled = coalesce(p_enabled, stale_recycling_enabled),
         stale_sla_hours         = coalesce(p_sla_hours, stale_sla_hours),
         whatsapp_template       = coalesce(
                                     nullif(btrim(p_whatsapp_template), ''),
                                     whatsapp_template
                                   ),
         -- Explicit column reference (not `excluded`/positional) on both
         -- sides: unlike the text fields above, an admin clearing this back
         -- to empty is a valid, intentional action (it disables the caller
         -- button), so nullif-to-null must be allowed through rather than
         -- falling back to the old value.
         admin_whatsapp_number   = case
                                     when p_admin_whatsapp_number is null then admin_whatsapp_number
                                     else nullif(btrim(p_admin_whatsapp_number), '')
                                   end,
         daily_report_template   = coalesce(
                                     nullif(btrim(p_daily_report_template), ''),
                                     daily_report_template
                                   ),
         updated_by              = auth.uid()
   where id = true
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function public.admin_update_settings(boolean, integer, text, text, text) from public, anon;
grant execute on function public.admin_update_settings(boolean, integer, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- my_daily_report_summary
-- ---------------------------------------------------------------------------
create or replace function public.my_daily_report_summary(p_date date)
returns table (
  warm_leads_count   integer,
  converted_count    integer,
  schedules_count    integer,
  appointments_count integer
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
    (select count(*) from public.lead_history_logs h
      where h.actor_id = v_actor
        and h.event_type = 'status_changed'
        and h.to_status = 'warm'
        and h.created_at >= v_start and h.created_at < v_end)::integer,

    (select count(*) from public.sales s
      where s.telecaller_id = v_actor
        and s.submitted_at >= v_start and s.submitted_at < v_end)::integer,

    (select count(*) from public.lead_history_logs h
      where h.actor_id = v_actor
        and h.event_type = 'reschedule_set'
        and h.created_at >= v_start and h.created_at < v_end)::integer,

    -- Deliberately not scoped to [v_start, v_end) — this is "how many
    -- appointments are still ahead of me", evaluated as of now, not "how many
    -- did I set on p_date". See the header note.
    (select count(*) from public.leads l
      where l.assigned_to = v_actor
        and l.deleted_at is null
        and l.scheduled_at is not null
        and l.scheduled_at >= now())::integer;
end $$;

revoke execute on function public.my_daily_report_summary(date) from public, anon;
grant execute on function public.my_daily_report_summary(date) to authenticated;

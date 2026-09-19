-- ============================================================================
-- Trace · 2100 — Overnight shifts & orphaned attendance recovery
-- ============================================================================
-- caller_clock_out() (1900) updated only the row whose work_date matched
-- *today* in report_timezone. A shift left open across midnight — a telecaller
-- working late, or one who simply forgot to tap Clock Out — could therefore
-- never be closed by anyone: the caller got "no active clock-in found for
-- today", and attendance (the entire point of the feature) silently
-- accumulated rows with a clock_in_at and no clock_out_at.
--
-- Three changes:
--   * caller_clock_out() falls back to the most recent still-open shift when
--     today has none, bounded to 18 hours so a forgotten shift from days ago
--     is never silently closed with an invented duration.
--   * my_current_attendance() puts the "which row is the UI acting on"
--     decision in the database, next to report_timezone. The caller page was
--     picking the row with the *server's UTC* date, which disagrees with
--     clock_in/clock_out's IST date every day between 00:00 and 05:29 IST.
--   * admin_close_attendance() is the recovery path for rows already orphaned
--     before this migration. Nothing else can close them.
-- ============================================================================

-- How far back caller_clock_out() will reach for an unclosed shift. Comfortably
-- covers a night shift plus overtime; well short of "yesterday's forgotten
-- shift", which needs a human to say when it actually ended.
--   18h chosen over 24h deliberately: at 24h a telecaller who forgot to clock
--   out yesterday and taps Clock Out today would close yesterday's row with
--   today's timestamp, booking a ~24 hour shift and corrupting the very number
--   this feature exists to produce.


-- ---------------------------------------------------------------------------
-- caller_clock_out — close today's shift, else the most recent open one
-- ---------------------------------------------------------------------------
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
  v_id    uuid;
  v_row   public.attendance;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select coalesce(report_timezone, 'Asia/Kolkata') into v_tz
  from public.system_settings where id = true;
  v_today := (now() at time zone v_tz)::date;

  -- Prefer today's open shift; otherwise the most recently opened one still
  -- running, which is what an overnight shift looks like after midnight.
  -- Ordering by (work_date = v_today) first rather than filtering keeps both
  -- cases in one index-friendly pass.
  select id into v_id
    from public.attendance
   where telecaller_id = v_actor
     and clock_out_at is null
     and (work_date = v_today or clock_in_at > now() - interval '18 hours')
   order by (work_date = v_today) desc, clock_in_at desc
   limit 1;

  if v_id is null then
    raise exception 'no active clock-in found for today' using errcode = 'P0002';
  end if;

  update public.attendance
     set clock_out_at = now()
   where id = v_id
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function public.caller_clock_out() from public, anon;
grant execute on function public.caller_clock_out() to authenticated;


-- ---------------------------------------------------------------------------
-- my_current_attendance — the row the caller's UI should be acting on
-- ---------------------------------------------------------------------------
-- setof, not a bare composite: a plpgsql function declared `returns
-- public.attendance` yields a row of all-nulls when it has nothing to return,
-- which reaches PostgREST as an object rather than null and would make the
-- card render "clocked in at null". Returning zero rows lets .maybeSingle()
-- give the client a clean null.
create or replace function public.my_current_attendance()
returns setof public.attendance
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tz    text;
  v_today date;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select coalesce(report_timezone, 'Asia/Kolkata') into v_tz
  from public.system_settings where id = true;
  v_today := (now() at time zone v_tz)::date;

  -- Today's row, or a shift opened within the clock-out window. The second
  -- arm is what keeps "Generate Report" on screen for a night shift that was
  -- clocked out after midnight — its work_date is already yesterday by then.
  return query
  select *
    from public.attendance a
   where a.telecaller_id = v_actor
     and (a.work_date = v_today or a.clock_in_at > now() - interval '18 hours')
   order by (a.work_date = v_today) desc, a.clock_in_at desc
   limit 1;
end $$;

revoke execute on function public.my_current_attendance() from public, anon;
grant execute on function public.my_current_attendance() to authenticated;


-- ---------------------------------------------------------------------------
-- admin_close_attendance — recovery for an already-orphaned shift
-- ---------------------------------------------------------------------------
-- Writes to attendance are revoked from `authenticated`, so before this there
-- was no way to correct an open row short of the SQL editor. An admin must
-- supply the time the shift actually ended; the function refuses to guess.
create or replace function public.admin_close_attendance(
  p_attendance_id uuid,
  p_clock_out_at  timestamptz
)
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.attendance;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if p_clock_out_at is null then
    raise exception 'a clock-out time is required';
  end if;

  select * into v_row from public.attendance where id = p_attendance_id;

  if v_row.id is null then
    raise exception 'attendance row not found';
  end if;
  if v_row.clock_out_at is not null then
    raise exception 'that shift is already closed';
  end if;
  if p_clock_out_at <= v_row.clock_in_at then
    raise exception 'clock-out must be after clock-in';
  end if;
  if p_clock_out_at > now() then
    raise exception 'clock-out cannot be in the future';
  end if;

  update public.attendance
     set clock_out_at = p_clock_out_at
   where id = p_attendance_id
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function public.admin_close_attendance(uuid, timestamptz) from public, anon;
grant execute on function public.admin_close_attendance(uuid, timestamptz) to authenticated;

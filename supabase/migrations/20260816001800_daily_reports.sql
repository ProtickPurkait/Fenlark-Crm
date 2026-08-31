-- ============================================================================
-- Trace · 1800 — Telecaller Daily Reports
-- ============================================================================
-- One row per telecaller per calendar day: how many warm leads, conversions,
-- follow-up schedules and dated appointments they logged that day. This is a
-- manual roll-up telecallers file themselves — deliberately not derived from
-- leads/sales, because "schedule" vs "appointment with a confirmed date" is a
-- distinction the telecaller makes on the ground that the schema doesn't
-- capture (leads.scheduled_at is a single next-follow-up timestamp, used for
-- both today).
--
-- RPC-only write path from day one, same lesson as sales (1500): a client
-- upserting its own row directly could file a report for another telecaller
-- or backdate one at will, so ownership + the future-date check live in
-- caller_submit_daily_report() instead of trusting RLS plus a raw upsert.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.daily_reports (
  id                    uuid primary key default gen_random_uuid(),

  -- Matches leads.assigned_to / sales.telecaller_id: a departed telecaller's
  -- past reports stay on the books after their account is deleted.
  telecaller_id         uuid references public.users (id) on delete set null,
  report_date           date not null,

  warm_leads_count      integer not null default 0 check (warm_leads_count >= 0),
  converted_count       integer not null default 0 check (converted_count >= 0),
  schedules_count       integer not null default 0 check (schedules_count >= 0),
  appointments_count    integer not null default 0 check (appointments_count >= 0),
  notes                 text,

  submitted_at          timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One report per telecaller per day; caller_submit_daily_report() upserts on
-- this so re-submitting the same day edits it instead of stacking duplicates.
create unique index if not exists daily_reports_telecaller_date_unique
  on public.daily_reports (telecaller_id, report_date);

-- The admin Reports screen's default query: everyone's report for one day.
create index if not exists daily_reports_date_idx
  on public.daily_reports (report_date);

comment on table public.daily_reports is
  'One row per telecaller per calendar day, upserted only through '
  'caller_submit_daily_report(). Feeds the admin Reports screen.';

drop trigger if exists trg_daily_reports_touch on public.daily_reports;
create trigger trg_daily_reports_touch
  before update on public.daily_reports
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.daily_reports enable row level security;

grant select on public.daily_reports to authenticated;
revoke insert, update, delete on public.daily_reports from authenticated, anon;

drop policy if exists daily_reports_select on public.daily_reports;
create policy daily_reports_select on public.daily_reports
  for select to authenticated
  using (public.is_admin() or telecaller_id = auth.uid());


-- ---------------------------------------------------------------------------
-- caller_submit_daily_report
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can upsert past RLS's select-only grant. Re-verifies
-- everything itself, same rule as caller_log_sale (1500): RLS does not
-- protect the body of a SECURITY DEFINER function.
create or replace function public.caller_submit_daily_report(
  p_report_date        date,
  p_warm_leads_count   integer,
  p_converted_count    integer,
  p_schedules_count    integer,
  p_appointments_count integer,
  p_notes              text default null
)
returns public.daily_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_report public.daily_reports;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- A telecaller can file a late report for a past day, but never a future
  -- one — that would just be a guess wearing the shape of data.
  if p_report_date > current_date then
    raise exception 'cannot file a report for a future date'
      using errcode = '22007';
  end if;

  insert into public.daily_reports (
    telecaller_id, report_date, warm_leads_count, converted_count,
    schedules_count, appointments_count, notes
  )
  values (
    v_actor, p_report_date, p_warm_leads_count, p_converted_count,
    p_schedules_count, p_appointments_count, nullif(btrim(p_notes), '')
  )
  on conflict (telecaller_id, report_date) do update
    set warm_leads_count   = excluded.warm_leads_count,
        converted_count    = excluded.converted_count,
        schedules_count    = excluded.schedules_count,
        appointments_count = excluded.appointments_count,
        notes              = excluded.notes
  returning * into v_report;

  return v_report;
end $$;

revoke execute on function public.caller_submit_daily_report(date, integer, integer, integer, integer, text)
  from public, anon;
grant execute on function public.caller_submit_daily_report(date, integer, integer, integer, integer, text)
  to authenticated;

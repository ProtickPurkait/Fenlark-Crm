-- ============================================================================
-- Trace · 1300 — Collapse the two admin call-reporting RPCs into one
-- ============================================================================
-- PERF FIX. The admin dashboard's initial load runs five Supabase requests in
-- one Promise.all (summary, settings, recent activity, admin_active_calls,
-- admin_call_stats_today), and LiveCallsPanel repeats the last two on every
-- Realtime event. Measured directly against the live project: concurrent
-- requests on this backend do not parallelize for free — going from a 3-way
-- to a 5-way Promise.all added ~250ms of close-to-serial time, not the ~0ms
-- you'd expect from true concurrency. Raw fetch() concurrency to the same
-- project scaled fine at up to 8 in parallel, which rules out a Node/network
-- limit and points at constrained backend/connection-pool capacity instead.
--
-- The fix is fewer round trips, not more concurrency. admin_active_calls()
-- and admin_call_stats_today() are folded into one function returning both
-- result sets as jsonb in a single row, so every call site that needed both
-- now pays for one round trip instead of two.

drop function if exists public.admin_active_calls();
drop function if exists public.admin_call_stats_today();

create function public.admin_call_activity()
returns table (active jsonb, stats jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz    text;
  v_start timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  select report_timezone into v_tz from public.system_settings where id = true;
  v_tz := coalesce(v_tz, 'Asia/Kolkata');
  v_start := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  return query
  select
    -- Who is on a call right now, oldest first — same query as the old
    -- admin_active_calls().
    (select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb)
       from (
         select
           cs.id as session_id, cs.caller_id, u.full_name as caller_name,
           cs.lead_id, l.full_name as lead_name, l.phone as lead_phone,
           cs.started_at
         from public.call_sessions cs
         left join public.users u on u.id = cs.caller_id
         join public.leads l on l.id = cs.lead_id
         where cs.ended_at is null
         order by cs.started_at asc
       ) a),
    -- Per-caller totals for the current day in the report timezone — same
    -- query as the old admin_call_stats_today(). Swept sessions carry a null
    -- duration and are excluded by coalesce/sum rather than counted as
    -- zero-length calls.
    (select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb)
       from (
         select
           u.id as caller_id, u.full_name as caller_name,
           count(cs.id)::integer as calls_today,
           coalesce(sum(cs.duration_seconds), 0)::integer as talk_seconds,
           coalesce(max(cs.duration_seconds), 0)::integer as longest_call
         from public.users u
         join public.call_sessions cs
           on cs.caller_id = u.id and cs.started_at >= v_start
         group by u.id, u.full_name
         order by coalesce(sum(cs.duration_seconds), 0) desc
       ) s);
end $$;

comment on function public.admin_call_activity() is
  'Combines the old admin_active_calls()/admin_call_stats_today() into one '
  'round trip. Returns exactly one row: active is the live-call list, stats '
  'is today''s per-caller totals, both jsonb arrays.';

revoke execute on function public.admin_call_activity() from public, anon;
grant execute on function public.admin_call_activity() to authenticated;

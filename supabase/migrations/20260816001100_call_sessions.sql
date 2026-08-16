-- ============================================================================
-- Trace · 1100 — Call Sessions (live call tracking)
-- ============================================================================
-- Records when a telecaller starts a call and how long it lasted, so the admin
-- dashboard can show who is on a call right now and how much talk time each
-- caller logged.
--
-- WHY A SEPARATE TABLE, not lead_history_logs: a call session is *mutable* —
-- it is created when the call starts and updated when it ends. The audit trail
-- is append-only and its prevent_log_mutation() trigger raises on any UPDATE,
-- so a session row physically cannot live there. The audit trail keeps
-- recording dispositions; this table records call activity.
--
-- ACCURACY, stated plainly: the app cannot observe the native dialer. There is
-- no browser API for call state (the W3C Telephony spec was never implemented).
-- The client measures how long the app was backgrounded while the dialer was in
-- front, which includes ringing time, so durations run slightly long and are
-- confirmable by the telecaller before saving. `duration_source` records where
-- a number came from, so if calls are ever routed through a cloud telephony
-- provider its exact webhook values can be written into this same table
-- alongside the estimates, without a schema change.


-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.call_sessions (
  id            uuid primary key default gen_random_uuid(),

  lead_id       uuid not null references public.leads (id),
  -- Matches lead_history_logs.actor_id: a departed telecaller's account can be
  -- deleted without erasing the fact that the call happened.
  caller_id     uuid references public.users (id) on delete set null,

  started_at    timestamptz not null default now(),
  ended_at      timestamptz,

  -- Null while in progress, and deliberately left null for swept sessions —
  -- an abandoned session's duration is unknown, and writing a fabricated one
  -- would quietly corrupt talk-time reporting.
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),

  duration_source  text not null default 'app_estimate'
                     check (duration_source in ('app_estimate', 'manual', 'provider')),

  -- How the session was closed. 'sweep' means the app never reported back
  -- (browser closed mid-call, phone died), so the row is closed for hygiene
  -- but excluded from duration statistics.
  ended_reason  text check (ended_reason in ('user', 'superseded', 'sweep')),

  created_at    timestamptz not null default now()
);

-- The live panel's query: every session still in progress.
create index if not exists call_sessions_active_idx
  on public.call_sessions (started_at desc)
  where ended_at is null;

-- Per-caller reporting and the "today" rollups.
create index if not exists call_sessions_caller_idx
  on public.call_sessions (caller_id, started_at desc);

create index if not exists call_sessions_lead_idx
  on public.call_sessions (lead_id, started_at desc);

-- A caller can only be on one call at a time. start_call_session() already
-- closes any previous open session, so this is a backstop against a race
-- between two devices rather than something the UI should ever hit.
create unique index if not exists call_sessions_one_active_per_caller
  on public.call_sessions (caller_id)
  where ended_at is null;

comment on table public.call_sessions is
  'Call activity per telecaller. Durations are app-measured estimates unless '
  'duration_source = ''provider''. Rows with ended_reason = ''sweep'' have a '
  'null duration and must be excluded from talk-time totals.';


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.call_sessions enable row level security;

grant select on public.call_sessions to authenticated;
-- No INSERT/UPDATE/DELETE grant, on purpose. This is the C-1 lesson from
-- migration 1000: owning a row is not permission to write it however you like.
-- The SECURITY DEFINER RPCs below are the only write path, so the ownership
-- and duration rules cannot be bypassed by a direct PostgREST call.
revoke insert, update, delete on public.call_sessions from authenticated, anon;

drop policy if exists call_sessions_select on public.call_sessions;
create policy call_sessions_select on public.call_sessions
  for select to authenticated
  using (public.is_admin() or caller_id = auth.uid());


-- ---------------------------------------------------------------------------
-- start_call_session
-- ---------------------------------------------------------------------------
create or replace function public.start_call_session(p_lead_id uuid)
returns public.call_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_lead    public.leads;
  v_session public.call_sessions;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and deleted_at is null;

  if not found then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;

  -- Same ownership rule as log_call_interaction. SECURITY DEFINER bypasses
  -- RLS, so this check is the only thing standing in for it.
  if not (public.is_admin() or v_lead.assigned_to = v_actor) then
    raise exception 'forbidden: this lead is not assigned to you'
      using errcode = '42501';
  end if;

  -- Close any session this caller left open — tapping Call on a second lead
  -- without dispositioning the first is normal behaviour, not an error, so it
  -- resolves silently instead of blocking the new call on the unique index.
  update public.call_sessions
     set ended_at     = now(),
         ended_reason = 'superseded'
   where caller_id = v_actor and ended_at is null;

  insert into public.call_sessions (lead_id, caller_id)
  values (p_lead_id, v_actor)
  returning * into v_session;

  return v_session;
end $$;


-- ---------------------------------------------------------------------------
-- end_call_session
-- ---------------------------------------------------------------------------
-- p_duration_seconds is what the client measured (time the app spent
-- backgrounded, or a value the telecaller corrected by hand). When omitted the
-- wall-clock elapsed time is used instead.
--
-- Idempotent: the client can fire this from both a visibilitychange handler
-- and an explicit "End call" tap, and a page reload can retry it. Ending an
-- already-ended session returns the existing row rather than raising, so those
-- races cannot surface as an error to a telecaller mid-call.
create or replace function public.end_call_session(
  p_session_id       uuid,
  p_duration_seconds integer default null,
  p_source           text    default 'app_estimate'
)
returns public.call_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_session  public.call_sessions;
  v_duration integer;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_source not in ('app_estimate', 'manual', 'provider') then
    raise exception 'invalid duration source: %', p_source;
  end if;

  select * into v_session
  from public.call_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'call session not found' using errcode = 'P0002';
  end if;

  if not (public.is_admin() or v_session.caller_id = v_actor) then
    raise exception 'forbidden: this call session is not yours'
      using errcode = '42501';
  end if;

  -- Already closed. Two different situations:
  --   * the auto path firing twice (visibilitychange + an explicit tap, or a
  --     retry after a reload) — must be a no-op, never an overwrite
  --   * an explicit correction, where the telecaller edited the duration in
  --     the disposition form before saving — p_source = 'manual' is the signal
  --
  -- Worth being clear about the trust model: in this design the duration is
  -- always client-reported, so a telecaller can influence their own talk-time
  -- figure whether or not this correction path exists. Treat it as a work
  -- record, not an audited metric. Routing calls through a telephony provider
  -- (duration_source = 'provider') is what would make it tamper-proof.
  if v_session.ended_at is not null then
    if p_source = 'manual' and p_duration_seconds is not null then
      update public.call_sessions
         set duration_seconds = least(greatest(p_duration_seconds, 0), 4 * 60 * 60),
             duration_source  = 'manual'
       where id = p_session_id
      returning * into v_session;
    end if;
    return v_session;
  end if;

  v_duration := coalesce(
    p_duration_seconds,
    greatest(0, extract(epoch from (now() - v_session.started_at))::integer)
  );

  -- A sanity ceiling. A "14 hour call" is always the app having been
  -- backgrounded overnight, and letting it through would wreck the averages.
  if v_duration > 4 * 60 * 60 then
    v_duration := null;
  end if;

  update public.call_sessions
     set ended_at         = now(),
         duration_seconds = v_duration,
         duration_source  = p_source,
         ended_reason     = 'user'
   where id = p_session_id
  returning * into v_session;

  return v_session;
end $$;


-- ---------------------------------------------------------------------------
-- sweep_abandoned_calls — pg_cron housekeeping
-- ---------------------------------------------------------------------------
-- Sessions the app never closed (browser killed mid-call, phone died) would
-- otherwise sit "in progress" forever and show as a permanent live call on the
-- admin dashboard. Duration is left null: it is genuinely unknown.
create or replace function public.sweep_abandoned_calls(p_max_minutes integer default 120)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.call_sessions
     set ended_at     = now(),
         ended_reason = 'sweep'
   where ended_at is null
     and started_at < now() - make_interval(mins => p_max_minutes);

  get diagnostics v_count = row_count;
  return v_count;
end $$;

do $$
begin
  perform cron.unschedule('sweep-abandoned-calls');
exception when others then
  null; -- not scheduled yet
end $$;

do $$
begin
  perform cron.schedule(
    'sweep-abandoned-calls',
    '*/5 * * * *',
    $cron$select public.sweep_abandoned_calls();$cron$
  );
exception when others then
  raise notice 'pg_cron unavailable; sweep-abandoned-calls not scheduled';
end $$;


-- ---------------------------------------------------------------------------
-- Admin reporting RPCs
-- ---------------------------------------------------------------------------
-- Who is on a call right now. Joined server-side so the dashboard gets names
-- in one round trip rather than resolving ids client-side.
create or replace function public.admin_active_calls()
returns table (
  session_id  uuid,
  caller_id   uuid,
  caller_name text,
  lead_id     uuid,
  lead_name   text,
  lead_phone  text,
  started_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  return query
  select cs.id, cs.caller_id, u.full_name, cs.lead_id, l.full_name, l.phone, cs.started_at
  from public.call_sessions cs
  left join public.users u on u.id = cs.caller_id
  join public.leads l on l.id = cs.lead_id
  where cs.ended_at is null
  order by cs.started_at asc;
end $$;

-- Per-caller totals for the current day, in the configured report timezone —
-- same reasoning as my_dashboard_stats: a UTC day boundary would reset the
-- counter at 05:30 IST, mid-shift.
create or replace function public.admin_call_stats_today()
returns table (
  caller_id     uuid,
  caller_name   text,
  calls_today   integer,
  talk_seconds  integer,
  longest_call  integer
)
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
    u.id,
    u.full_name,
    count(cs.id)::integer,
    -- Swept sessions carry a null duration and are excluded by coalesce/sum
    -- rather than counted as zero-length calls.
    coalesce(sum(cs.duration_seconds), 0)::integer,
    coalesce(max(cs.duration_seconds), 0)::integer
  from public.users u
  join public.call_sessions cs
    on cs.caller_id = u.id and cs.started_at >= v_start
  group by u.id, u.full_name
  order by coalesce(sum(cs.duration_seconds), 0) desc;
end $$;


-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.start_call_session(uuid)                     from public, anon;
revoke execute on function public.end_call_session(uuid, integer, text)        from public, anon;
revoke execute on function public.sweep_abandoned_calls(integer)              from public, anon, authenticated;
revoke execute on function public.admin_active_calls()                         from public, anon;
revoke execute on function public.admin_call_stats_today()                     from public, anon;

grant execute on function public.start_call_session(uuid)               to authenticated;
grant execute on function public.end_call_session(uuid, integer, text)  to authenticated;
grant execute on function public.admin_active_calls()                   to authenticated;
grant execute on function public.admin_call_stats_today()               to authenticated;


-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- Lets the admin dashboard subscribe to call activity instead of polling.
-- Delivery still respects the RLS policy above, so a telecaller subscribing to
-- this table would only ever receive their own rows.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_sessions'
  ) then
    alter publication supabase_realtime add table public.call_sessions;
  end if;
exception when undefined_object then
  raise notice 'supabase_realtime publication not present; skipping';
end $$;

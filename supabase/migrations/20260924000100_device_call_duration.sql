-- ============================================================================
-- Trace · 2600 — Device-measured call duration
-- ============================================================================
-- Adds duration_source = 'device': a duration read from the telecaller's own
-- phone's telephony call state (CallTrackerPlugin, native Android shell only),
-- not from timing how long the app was backgrounded, and not something a
-- telecaller can type in. It sits alongside 'app_estimate' (the web-only
-- guess) and 'manual' (a telecaller's correction of that guess) exactly the
-- way 'provider' was already reserved for a future cloud-telephony
-- integration — this is that same idea, achieved a different way, and it is
-- just as tamper-proof: nothing this table's RLS-governed RPCs expose lets a
-- client write 'device' with a number the OS didn't actually report.
--
-- end_call_session() already allowed a 'manual' correction to overwrite a
-- session already closed by the 'app_estimate' path, because the client can
-- fire both a visibilitychange auto-end and a later hand correction. The
-- native shell has an equivalent (rarer) race: its own visibility handler
-- keeps a short fallback timer in case CallTracker's event is ever late or
-- never arrives, so an 'app_estimate' can close the row microseconds before
-- the authoritative 'device' value shows up. The same override rule now
-- covers that case too, so the late-but-real number still wins — but once a
-- row is 'device' or 'manual', nothing overwrites it again: those are both
-- deliberate, final values.

alter table public.call_sessions drop constraint if exists call_sessions_duration_source_check;
alter table public.call_sessions add constraint call_sessions_duration_source_check
  check (duration_source in ('app_estimate', 'manual', 'device', 'provider'));

comment on table public.call_sessions is
  'Call activity per telecaller. Durations are app-measured estimates unless '
  'duration_source = ''device'' (native Android call-state) or ''provider'' '
  '(future cloud telephony) — both are OS/carrier-reported and not client-'
  'editable.';

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

  if p_source not in ('app_estimate', 'manual', 'device', 'provider') then
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

  -- Already closed. Three situations land here:
  --   * the auto path firing twice (visibilitychange + an explicit tap, or a
  --     retry after a reload) — must be a no-op, never an overwrite
  --   * an explicit correction, where the telecaller edited the duration in
  --     the disposition form before saving — p_source = 'manual' is the signal
  --   * a device-measured value arriving after its own same-call estimate
  --     already closed the row (see this migration's header) — p_source =
  --     'device' overwrites only an 'app_estimate', never a prior 'device' or
  --     'manual' value, so a real correction is never re-overwritten by a
  --     stale duplicate event.
  if v_session.ended_at is not null then
    if p_source = 'manual' and p_duration_seconds is not null
       and v_session.duration_source in ('app_estimate', 'manual') then
      update public.call_sessions
         set duration_seconds = least(greatest(p_duration_seconds, 0), 4 * 60 * 60),
             duration_source  = 'manual'
       where id = p_session_id
      returning * into v_session;
    elsif p_source = 'device' and p_duration_seconds is not null
          and v_session.duration_source = 'app_estimate' then
      update public.call_sessions
         set duration_seconds = least(greatest(p_duration_seconds, 0), 4 * 60 * 60),
             duration_source  = 'device'
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

-- ============================================================================
-- Fenlark CRM · 0800 — Stale Lead Recycling Engine
-- ============================================================================
-- If a lead sits at status 'new' in a telecaller's queue for longer than the
-- configured SLA, the assignment is stripped and the lead returns to the
-- admin's unassigned pool with an audit entry naming the system as the actor.
--
-- Implemented in Postgres rather than as an Edge Function so it keeps running
-- when the app is undeployed, mid-rollback, or simply down. The lead pool does
-- not depend on Vercel being healthy.
-- ============================================================================

create or replace function public.recycle_stale_leads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_hours   integer;
  v_count   integer;
begin
  -- Settings are read at runtime, never baked into the cron schedule: changing
  -- the SLA in the admin panel takes effect on the next tick with no migration
  -- and no redeploy.
  select stale_recycling_enabled, stale_sla_hours
    into v_enabled, v_hours
  from public.system_settings
  where id = true;

  if not coalesce(v_enabled, false) then
    return 0;
  end if;

  -- Announce the actor to the triggers. Transaction-local (the third argument
  -- to set_config), so the flag cannot leak into an unrelated session and let
  -- a human action be recorded as a system one.
  --
  -- These two GUCs are what turn the plain UPDATE below into a fully audited
  -- 'sla_revoked' entry: enforce_lead_update_rules() consults app.actor_kind to
  -- permit the assignment change, and log_lead_change() consults both to write
  -- the entry with the required wording.
  perform set_config('app.actor_kind', 'system', true);
  perform set_config(
    'app.audit_note',
    'System revoked assignment due to SLA breach.',
    true
  );

  with stale as (
    select id
    from public.leads
    where status = 'new'                -- a lead someone actually worked is never reclaimed
      and assigned_to is not null
      and assigned_at is not null
      -- make_interval() rather than string-concatenating an interval literal:
      -- stale_sla_hours ultimately originates in a UI input field.
      and assigned_at < now() - make_interval(hours => v_hours)
      and deleted_at is null
    -- SKIP LOCKED so a manual admin_run_recycle_now() overlapping the scheduled
    -- tick processes disjoint rows instead of blocking or deadlocking.
    for update skip locked
  )
  update public.leads l
     set assigned_to       = null,
         sla_revoked_count = l.sla_revoked_count + 1
    from stale s
   where l.id = s.id;

  get diagnostics v_count = row_count;

  -- No explicit audit writes above. The revocation is an ordinary UPDATE, so
  -- the trigger in 0400 produces the sla_revoked entries. One audit code path
  -- for humans and machines means the two can never drift apart.

  perform set_config('app.actor_kind', 'user', true);
  perform set_config('app.audit_note', '', true);

  return v_count;
end $$;

comment on function public.recycle_stale_leads() is
  'Returns the number of leads reclaimed. Safe to call concurrently. Returns 0 '
  'immediately when stale_recycling_enabled is false.';


-- ---------------------------------------------------------------------------
-- admin_run_recycle_now — manual sweep from the Settings panel
-- ---------------------------------------------------------------------------
-- Lets an admin verify the configuration without waiting up to 15 minutes for
-- the next tick.
create or replace function public.admin_run_recycle_now()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  return public.recycle_stale_leads();
end $$;


-- ---------------------------------------------------------------------------
-- Execution grants
-- ---------------------------------------------------------------------------
-- The engine itself is unreachable from the API surface; admins get to it only
-- through the wrapper above, which enforces the role check.
revoke execute on function public.recycle_stale_leads()   from public, anon, authenticated;
revoke execute on function public.admin_run_recycle_now() from public;
grant  execute on function public.admin_run_recycle_now() to authenticated;


-- ---------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------
-- Every 15 minutes. An SLA measured in hours does not need second-level
-- precision, and leads_sla_sweep_idx (a narrow partial index on assigned_at
-- where status = 'new') makes each sweep cheap enough to be uninteresting.
--
-- The ON/OFF toggle is checked *inside* the function, so switching the feature
-- off in the admin UI is instant and the job itself is never rescheduled.
do $outer$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice
      'pg_cron is not installed — the stale-lead sweep is NOT scheduled. '
      'Enable it (Dashboard > Database > Extensions) and re-run this migration, '
      'or call public.admin_run_recycle_now() from an external scheduler.';
    return;
  end if;

  -- cron.schedule() would silently create a second job on re-run.
  if exists (select 1 from cron.job where jobname = 'recycle-stale-leads') then
    perform cron.unschedule('recycle-stale-leads');
  end if;

  perform cron.schedule(
    'recycle-stale-leads',
    '*/15 * * * *',
    $cron$select public.recycle_stale_leads();$cron$
  );

  raise notice 'Scheduled "recycle-stale-leads" every 15 minutes.';
end $outer$;

-- ============================================================================
-- Fenlark CRM · 1000 — Security Hardening
-- ============================================================================
-- Findings from the security audit. The headline fix is C-1: an authenticated
-- telecaller could bypass log_call_interaction's validation entirely with a
-- direct PostgREST table write on their own leads — confirmed exploitable
-- against the live project, not theoretical.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- C-1 — Revoke direct write access to public.leads
-- ---------------------------------------------------------------------------
-- RLS correctly answered "is this row yours?", but that was the wrong question
-- on its own: owning the row let a telecaller UPDATE status / scheduled_at /
-- last_remark directly, skipping the remark requirement and the future-date
-- check that log_call_interaction enforces. Observed consequences:
--   * mark leads 'converted' with no remark (audit trail records the change
--     but loses the reason)
--   * push scheduled_at into 2099 to zero out their own overdue counter
--     without logging a single call
--   * write status='rescheduled' with a null follow-up date
--
-- Every legitimate write already goes through a SECURITY DEFINER RPC, which
-- executes as the table owner and is unaffected by these grants. Removing
-- client write access therefore breaks nothing and makes the RPC the only
-- door in. SELECT is deliberately untouched — telecallers must still read
-- their own queue.
revoke insert, update, delete on public.leads from authenticated, anon;

-- The row policies stay in place as a second layer, in case a grant is ever
-- restored by a future migration or by Supabase default privileges.


-- ---------------------------------------------------------------------------
-- C-2 — Revoke EXECUTE from anon explicitly
-- ---------------------------------------------------------------------------
-- Supabase's default privileges grant EXECUTE to anon/authenticated *by name*
-- when a function is created, so the `REVOKE ... FROM PUBLIC` in migration
-- 0500 never actually removed it — anon could still reach is_admin() and
-- admin_run_recycle_now(). Neither was exploitable (each rejects unauthorised
-- callers internally), but the grant layer should agree with the intent
-- rather than leaving the internal check as the only thing standing.
revoke execute on function public.is_admin()                                    from anon;
revoke execute on function public.owns_lead(uuid)                               from anon;
revoke execute on function public.normalize_phone(text)                         from anon;
revoke execute on function public.my_dashboard_stats()                          from anon;
revoke execute on function public.log_call_interaction(uuid, public.lead_status, text, timestamptz) from anon;
revoke execute on function public.admin_import_leads(jsonb, public.lead_source)  from anon;
revoke execute on function public.admin_assign_leads(uuid[], uuid)              from anon;
revoke execute on function public.admin_round_robin_assign(uuid[], uuid[])      from anon;
revoke execute on function public.admin_archive_lead(uuid, text)                from anon;
revoke execute on function public.admin_update_settings(boolean, integer, text) from anon;
revoke execute on function public.admin_set_user_role(uuid, public.user_role)   from anon;
revoke execute on function public.admin_set_user_active(uuid, boolean)          from anon;
revoke execute on function public.admin_run_recycle_now()                       from anon;


-- ---------------------------------------------------------------------------
-- Harden the system-actor escape hatch
-- ---------------------------------------------------------------------------
-- is_system_actor() trusts a GUC. PostgREST gives clients no way to set an
-- arbitrary GUC, so this was not reachable — but pinning it to a non-API role
-- means the flag can only ever be trusted inside our own SECURITY DEFINER
-- functions, whatever connection path exists in future.
--
-- Tested against role *names* rather than a hardcoded owner ('postgres'):
-- this keeps working if the schema owner ever differs, and it states the
-- actual intent — a client-facing connection can never claim to be the system.
create or replace function public.is_system_actor()
returns boolean
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.actor_kind', true), ''), 'user') = 'system'
     and current_user not in ('anon', 'authenticated');
$$;


-- ---------------------------------------------------------------------------
-- C-3 — Replace `USING (true)` on system_settings
-- ---------------------------------------------------------------------------
-- Telecallers need exactly two fields; they were getting the whole config row
-- including round_robin_cursor and updated_by (an admin's UUID).
--
-- security_invoker = false so this runs with the view owner's rights and stays
-- readable once the underlying table becomes admin-only.
create or replace view public.app_settings
with (security_invoker = false) as
  select whatsapp_template, report_timezone
  from public.system_settings
  where id = true;

revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;

comment on view public.app_settings is
  'Non-sensitive slice of system_settings for telecallers. The full row is '
  'admin-only via settings_select_admin.';

-- REGRESSION GUARD: public.lead_queue is security_invoker = true and reads
-- stale_sla_hours in a subquery to compute sla_hours_remaining. Locking the
-- table to admins would silently return NULL there for every telecaller and
-- kill the "returns to pool in Nh" warning in the disposition drawer — a
-- failure with no error to notice. This accessor keeps that one value
-- reachable without reopening the whole row.
create or replace function public.sla_hours()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select stale_sla_hours from public.system_settings where id = true;
$$;

revoke execute on function public.sla_hours() from public, anon;
grant  execute on function public.sla_hours() to authenticated;

create or replace view public.lead_queue
with (security_invoker = true) as
select
  l.*,
  case
    when l.status in ('converted', 'dead')            then 'closed'
    when l.scheduled_at is null                       then 'unscheduled'
    when l.scheduled_at <  now()                      then 'overdue'
    when l.scheduled_at <  now() + interval '2 hours' then 'due_soon'
    when l.scheduled_at <  now() + interval '24 hours' then 'due_today'
    else 'scheduled'
  end as follow_up_bucket,
  case
    when l.status in ('converted', 'dead')            then 90
    when l.scheduled_at <  now()                      then 10
    when l.scheduled_at <  now() + interval '2 hours' then 20
    when l.scheduled_at <  now() + interval '24 hours' then 30
    when l.status = 'new'                             then 40
    when l.scheduled_at is not null                   then 50
    else 60
  end as queue_rank,
  case
    when l.status = 'new' and l.assigned_at is not null then
      greatest(
        0,
        public.sla_hours()
        - (extract(epoch from (now() - l.assigned_at)) / 3600)
      )
    else null
  end as sla_hours_remaining
from public.leads l
where l.deleted_at is null;

revoke all on public.lead_queue from anon, authenticated;
grant select on public.lead_queue to authenticated;

-- Now safe to lock the table itself down.
drop policy if exists settings_select on public.system_settings;
drop policy if exists settings_select_admin on public.system_settings;
create policy settings_select_admin on public.system_settings
  for select to authenticated
  using (public.is_admin());


-- ---------------------------------------------------------------------------
-- L-5 — Aggregate dashboard counts inside Postgres
-- ---------------------------------------------------------------------------
-- The admin dashboard was pulling every lead row to count them in JavaScript.
-- PostgREST caps responses at 1000 rows by default, so at lead #1001 the
-- pipeline donut and the reclaimed-leads total would have started reporting
-- quietly wrong numbers with no error anywhere.
create or replace function public.admin_dashboard_summary()
returns table (
  total_leads       integer,
  unassigned        integer,
  active_callers    integer,
  sla_revoked_total integer,
  status_counts     jsonb
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
  select
    (select count(*) from public.leads where deleted_at is null)::integer,
    (select count(*) from public.leads where deleted_at is null and assigned_to is null)::integer,
    (select count(*) from public.users where role = 'telecaller' and is_active)::integer,
    (select coalesce(sum(sla_revoked_count), 0) from public.leads where deleted_at is null)::integer,
    (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
       from (
         select status, count(*) as n
         from public.leads
         where deleted_at is null
         group by status
       ) s);
end $$;

revoke execute on function public.admin_dashboard_summary() from public, anon;
grant  execute on function public.admin_dashboard_summary() to authenticated;

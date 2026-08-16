-- ============================================================================
-- Fenlark CRM · 0400 — Immutable Audit Trail
-- ============================================================================
-- Two guarantees, enforced structurally rather than by convention:
--
--   1. Every meaningful change to a lead writes a log row. There is no write
--      path to public.leads that skips this trigger.
--   2. No log row can ever be altered or removed.
--
-- Together these mean the timeline is a faithful record even when a status is
-- reversed months later.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------
-- Applies to everyone, including the table owner and superusers. That is the
-- point: "immutable" that an admin can quietly edit is not immutable.
create or replace function public.prevent_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'lead_history_logs is append-only; % is not permitted on the audit trail', tg_op
    using errcode = '42501',
          hint = 'Corrections are made by adding a new log entry, never by editing one.';
end $$;

drop trigger if exists trg_logs_no_update on public.lead_history_logs;
create trigger trg_logs_no_update
  before update on public.lead_history_logs
  for each row execute function public.prevent_log_mutation();

drop trigger if exists trg_logs_no_delete on public.lead_history_logs;
create trigger trg_logs_no_delete
  before delete on public.lead_history_logs
  for each row execute function public.prevent_log_mutation();

-- A row trigger cannot see TRUNCATE, so block it separately — otherwise the
-- entire trail could be erased in one statement.
create or replace function public.prevent_log_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'lead_history_logs is append-only; TRUNCATE is not permitted'
    using errcode = '42501';
end $$;

drop trigger if exists trg_logs_no_truncate on public.lead_history_logs;
create trigger trg_logs_no_truncate
  before truncate on public.lead_history_logs
  for each statement execute function public.prevent_log_truncate();


-- ---------------------------------------------------------------------------
-- log_lead_change() — the single audit writer
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, so it writes as the table owner and bypasses RLS. That is
-- why lead_history_logs needs no INSERT policy for `authenticated` at all:
-- clients cannot forge log rows, and the only way a row appears is that a real
-- change occurred.
--
-- Actor resolution: auth.uid() when a JWT is present. The recycling engine runs
-- under pg_cron with no JWT, so it announces itself via two transaction-local
-- GUCs (app.actor_kind, app.audit_note) which this function reads below.
create or replace function public.log_lead_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_kind  text := coalesce(nullif(current_setting('app.actor_kind', true), ''), 'user');
  v_note  text := nullif(current_setting('app.audit_note', true), '');
begin
  -- A system action is attributed to the system, never to whoever happened to
  -- be logged in. admin_run_recycle_now() runs under an admin's JWT, so without
  -- this the same SLA revocation would read "Aditi revoked this lead" when
  -- triggered from the settings panel and "system" when triggered by cron —
  -- for a decision neither of them made. The SLA did.
  if v_kind = 'system' then
    v_actor := null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.lead_history_logs (
      lead_id, actor_id, actor_kind, event_type, to_status, to_assignee, note
    )
    values (new.id, v_actor, v_kind, 'lead_created', new.status, new.assigned_to, v_note);

    -- A lead created already-assigned produces two entries, so the assignment
    -- has its own timestamped record rather than being implied by creation.
    if new.assigned_to is not null then
      insert into public.lead_history_logs (
        lead_id, actor_id, actor_kind, event_type, to_assignee
      )
      values (new.id, v_actor, v_kind, 'assigned', new.assigned_to);
    end if;

    return null;
  end if;

  -- ---- UPDATE ----

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_history_logs (
      lead_id, actor_id, actor_kind, event_type, from_assignee, to_assignee, note
    )
    values (
      new.id, v_actor, v_kind,
      case
        when old.assigned_to is null                     then 'assigned'
        when new.assigned_to is null and v_kind = 'system' then 'sla_revoked'
        when new.assigned_to is null                     then 'unassigned'
        else 'reassigned'
      end::public.audit_event,
      old.assigned_to, new.assigned_to, v_note
    );
  end if;

  if new.status is distinct from old.status then
    insert into public.lead_history_logs (
      lead_id, actor_id, actor_kind, event_type, from_status, to_status, note
    )
    values (new.id, v_actor, v_kind, 'status_changed', old.status, new.status, v_note);
  end if;

  -- Only forward-looking reschedules are logged; clearing the date on a
  -- converted/dead lead is bookkeeping, not a follow-up commitment.
  if new.scheduled_at is distinct from old.scheduled_at
     and new.scheduled_at is not null then
    insert into public.lead_history_logs (
      lead_id, actor_id, actor_kind, event_type, scheduled_at
    )
    values (new.id, v_actor, v_kind, 'reschedule_set', new.scheduled_at);
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    insert into public.lead_history_logs (
      lead_id, actor_id, actor_kind, event_type, note
    )
    values (new.id, v_actor, v_kind, 'lead_archived', v_note);
  end if;

  -- NOTE: changes to last_remark are deliberately not logged here.
  -- public.log_call_interaction() writes the authoritative 'remark_added'
  -- entry with its own before/after status; logging it here as well would
  -- double every remark on the timeline.

  return null;
end $$;

drop trigger if exists trg_leads_audit on public.leads;
create trigger trg_leads_audit
  after insert or update on public.leads
  for each row execute function public.log_lead_change();

comment on function public.log_lead_change() is
  'Sole writer of the audit trail. SECURITY DEFINER so it bypasses RLS — '
  'clients therefore need (and have) no INSERT privilege on lead_history_logs.';

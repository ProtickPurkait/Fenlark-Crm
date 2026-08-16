-- ============================================================================
-- Trace · 1200 — Let user deletion null the audit trail's person references
-- ============================================================================
-- BUG THIS FIXES: deleting a telecaller failed with "Database error deleting
-- user" for any account that had ever been assigned a lead — i.e. every real
-- telecaller. The admin Telecallers screen's Delete button simply did not work.
--
-- The mechanism: lead_history_logs.actor_id / from_assignee / to_assignee are
-- all `on delete set null`, precisely so a departed telecaller's account can be
-- removed without erasing the fact that something happened. But nulling them is
-- an UPDATE on lead_history_logs, and prevent_log_mutation() rejected *every*
-- UPDATE unconditionally. So the FK action and the immutability guard were in
-- direct conflict, and the guard won — taking the delete down with it.
--
-- The fix keeps the trail immutable where it matters. An UPDATE is permitted
-- only when every column describing *what happened* is byte-identical and the
-- sole change is a person reference going from set to null. Anything else —
-- editing a remark, changing a status, re-pointing a log at a different user,
-- or restoring a nulled reference — still raises, and DELETE/TRUNCATE remain
-- blocked outright.
--
-- Note this is the inner of two defences: `authenticated` has no UPDATE grant
-- on lead_history_logs at all, so no client can reach this path regardless.
-- The only caller is the FK action itself, running as the table owner.

create or replace function public.prevent_log_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if  new.id           is not distinct from old.id
    and new.lead_id      is not distinct from old.lead_id
    and new.actor_kind   is not distinct from old.actor_kind
    and new.event_type   is not distinct from old.event_type
    and new.from_status  is not distinct from old.from_status
    and new.to_status    is not distinct from old.to_status
    and new.remark       is not distinct from old.remark
    and new.scheduled_at is not distinct from old.scheduled_at
    and new.note         is not distinct from old.note
    and new.created_at   is not distinct from old.created_at
    -- Each person reference may either stay exactly as it was, or become null.
    -- It may never change to a *different* user, and a nulled one may never be
    -- repopulated — that would let history be re-attributed after the fact.
    and (new.actor_id      is not distinct from old.actor_id      or new.actor_id      is null)
    and (new.from_assignee is not distinct from old.from_assignee or new.from_assignee is null)
    and (new.to_assignee   is not distinct from old.to_assignee   or new.to_assignee   is null)
    then
      return new;
    end if;
  end if;

  raise exception
    'lead_history_logs is append-only; % is not permitted on the audit trail', tg_op
    using errcode = '42501',
          hint = 'Corrections are made by adding a new log entry, never by editing one.';
end $$;

comment on function public.prevent_log_mutation() is
  'Append-only guard. The single exception is a user deletion nulling '
  'actor_id/from_assignee/to_assignee via their on-delete-set-null foreign '
  'keys; the narrative of every entry stays immutable.';


-- ---------------------------------------------------------------------------
-- Second half of the same bug
-- ---------------------------------------------------------------------------
-- With the guard above relaxed, deleting a telecaller got one step further and
-- then failed differently: the delete nulls leads.assigned_to (also
-- on delete set null), which fires log_lead_change, which tries to INSERT an
-- 'unassigned' entry carrying from_assignee = the user currently being
-- deleted. Their public.users row is already gone by that point in the cascade,
-- so the new row's own foreign key fails.
--
-- Fix: resolve assignee references through an existence check before writing
-- them. A vanished user is recorded as null, which is exactly what the
-- on-delete-set-null design says a departed telecaller looks like — the event
-- is still recorded, it just no longer points at a row that does not exist.
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
  v_from  uuid;
  v_to    uuid;
begin
  -- A system action is attributed to the system, never to whoever happened to
  -- be logged in. admin_run_recycle_now() runs under an admin's JWT, so without
  -- this the same SLA revocation would read "Aditi revoked this lead" when
  -- triggered from the settings panel and "system" when triggered by cron —
  -- for a decision neither of them made. The SLA did.
  if v_kind = 'system' then
    v_actor := null;
  end if;

  -- The actor can vanish mid-cascade for the same reason an assignee can.
  if v_actor is not null
     and not exists (select 1 from public.users where id = v_actor) then
    v_actor := null;
  end if;

  if tg_op = 'INSERT' then
    select new.assigned_to into v_to
    where exists (select 1 from public.users where id = new.assigned_to);

    insert into public.lead_history_logs (
      lead_id, actor_id, actor_kind, event_type, to_status, to_assignee, note
    )
    values (new.id, v_actor, v_kind, 'lead_created', new.status, v_to, v_note);

    -- A lead created already-assigned produces two entries, so the assignment
    -- has its own timestamped record rather than being implied by creation.
    if new.assigned_to is not null then
      insert into public.lead_history_logs (
        lead_id, actor_id, actor_kind, event_type, to_assignee
      )
      values (new.id, v_actor, v_kind, 'assigned', v_to);
    end if;

    return null;
  end if;

  -- ---- UPDATE ----

  if new.assigned_to is distinct from old.assigned_to then
    v_from := null;
    v_to   := null;
    select old.assigned_to into v_from
      where exists (select 1 from public.users where id = old.assigned_to);
    select new.assigned_to into v_to
      where exists (select 1 from public.users where id = new.assigned_to);

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
      v_from, v_to, v_note
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

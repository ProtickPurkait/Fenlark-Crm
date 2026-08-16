-- ============================================================================
-- Trace · 1600 — Permanent lead delete + pre-import duplicate check
-- ============================================================================
-- Two gaps reported directly against the Leads screen: Archive is the only
-- bulk action (soft delete — leaves the row, hides it), and admin_import_leads
-- silently skips duplicate phone numbers after the fact instead of asking
-- first. This adds a real "gone forever" action and a "you're about to add a
-- duplicate, what do you want to do?" check, without touching either existing
-- RPC's behaviour for anyone who doesn't use the new paths.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1a. Narrow DELETE escape hatch in prevent_log_mutation()
-- ---------------------------------------------------------------------------
-- lead_history_logs is append-only by design (migration 0400), with one
-- existing UPDATE exception carved out by migration 1200 (letting a user
-- deletion null actor_id/from_assignee/to_assignee via their on-delete-set-
-- null FKs, preserved byte-for-byte below). DELETE has had no exception at
-- all until now — but a genuine permanent delete of a lead needs to take
-- that lead's log rows with it, or they become orphaned rows pointing at a
-- lead_id that no longer exists.
--
-- The UPDATE branch is unchanged from 1200. Only DELETE gets a new
-- conditional, gated on a transaction-local GUC in the `app.` namespace.
-- That namespace is only ever writable via set_config(), which is not a
-- PostgREST-exposed RPC — a client has no interface to set it. The only
-- place this codebase ever sets it to 'true' is inside admin_delete_leads()
-- below, itself gated by is_admin(). This is the exact same trust boundary
-- already used for app.actor_kind and app.audit_note (see
-- log_lead_change()/admin_archive_lead()) — nothing new is introduced, just
-- one more narrowly-scoped flag in the same namespace.
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
    and (new.actor_id      is not distinct from old.actor_id      or new.actor_id      is null)
    and (new.from_assignee is not distinct from old.from_assignee or new.from_assignee is null)
    and (new.to_assignee   is not distinct from old.to_assignee   or new.to_assignee   is null)
    then
      return new;
    end if;
  end if;

  if tg_op = 'DELETE' and current_setting('app.allow_log_purge', true) = 'true' then
    return old;
  end if;

  raise exception
    'lead_history_logs is append-only; % is not permitted on the audit trail', tg_op
    using errcode = '42501',
          hint = 'Corrections are made by adding a new log entry, never by editing one.';
end $$;

comment on function public.prevent_log_mutation() is
  'Append-only guard. Two narrow exceptions: migration 1200''s UPDATE case '
  '(a user deletion nulling person-reference columns via on-delete-set-null '
  'FKs) and this migration''s DELETE case (admin_delete_leads purging a '
  'fully-deleted lead''s own log rows). Neither is reachable by a client.';


-- ---------------------------------------------------------------------------
-- 1b. admin_delete_leads — permanent delete, with a commission-safe fallback
-- ---------------------------------------------------------------------------
-- Any lead with a sale attached (pending, approved, or rejected) is archived
-- instead of destroyed — an approved sale locks a ₹500 commission to a
-- telecaller's wallet forever, and that guarantee breaks if the lead record
-- it points back to can just disappear. Leads with no sale history are
-- purged completely: their audit trail, their call sessions, and the lead
-- row itself.
create or replace function public.admin_delete_leads(p_lead_ids uuid[])
returns table (deleted integer, archived_instead integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hard_ids uuid[];
  v_soft_ids uuid[];
  v_deleted  integer := 0;
  v_archived integer := 0;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if p_lead_ids is null or array_length(p_lead_ids, 1) is null then
    raise exception 'no leads selected';
  end if;

  select
    array_agg(l.id) filter (where not exists (select 1 from public.sales s where s.lead_id = l.id)),
    array_agg(l.id) filter (where     exists (select 1 from public.sales s where s.lead_id = l.id))
  into v_hard_ids, v_soft_ids
  from public.leads l
  where l.id = any(p_lead_ids);

  if v_soft_ids is not null then
    perform set_config(
      'app.audit_note',
      'Archived instead of deleted: has sale/commission history.',
      true
    );
    update public.leads
       set deleted_at = now()
     where id = any(v_soft_ids)
       and deleted_at is null;
    get diagnostics v_archived = row_count;
  end if;

  if v_hard_ids is not null then
    -- Reset immediately after use, not left to fall out of scope at the end
    -- of the transaction: set_config(..., true) is local to the *whole*
    -- transaction, not just this statement, and this function's caller
    -- (PostgREST) does not guarantee this is the only statement that will
    -- ever run in it. Closing the window explicitly, right after the one
    -- DELETE that needs it, is what actually keeps the exception narrow.
    perform set_config('app.allow_log_purge', 'true', true);
    delete from public.lead_history_logs where lead_id = any(v_hard_ids);
    perform set_config('app.allow_log_purge', 'false', true);

    -- No ON DELETE clause on call_sessions.lead_id (defaults to RESTRICT), so
    -- these have to go before the leads delete below or that statement fails.
    delete from public.call_sessions where lead_id = any(v_hard_ids);

    -- sales.lead_id needs no handling here: v_hard_ids is exactly the set of
    -- leads with no sales row, by construction above. sales' own FK (also
    -- RESTRICT) is a backstop against a same-transaction race — if a sale
    -- were somehow inserted between the check and here, this DELETE fails
    -- loudly with a constraint violation instead of silently losing data.
    delete from public.leads where id = any(v_hard_ids);
    get diagnostics v_deleted = row_count;
  end if;

  return query select v_deleted, v_archived;
end $$;

comment on function public.admin_delete_leads(uuid[]) is
  'Permanent delete for leads with no sale/commission history (purges the '
  'lead row, its audit trail, and its call sessions). Leads with any sale '
  'history are archived instead, never destroyed.';


-- ---------------------------------------------------------------------------
-- 1c. admin_check_duplicate_phones — pre-import dry run
-- ---------------------------------------------------------------------------
-- Read-only: given a batch of phone numbers about to be imported, reports
-- which already match a live lead. The import UI calls this before committing
-- so the admin can choose to keep the existing lead (skip the new one — the
-- existing ON CONFLICT DO NOTHING behaviour, just surfaced up front) or
-- delete/archive the existing one and add the new one in its place, instead
-- of only finding out after the fact via the skipped_duplicate count.
create or replace function public.admin_check_duplicate_phones(p_phones text[])
returns table (
  phone_normalized   text,
  existing_lead_id   uuid,
  existing_full_name text
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
  select l.phone_normalized, l.id, l.full_name
  from public.leads l
  where l.deleted_at is null
    and l.phone_normalized = any(
      select public.normalize_phone(p) from unnest(p_phones) as p
    );
end $$;


-- ---------------------------------------------------------------------------
-- 1d. Execution grants
-- ---------------------------------------------------------------------------
revoke execute on function public.admin_delete_leads(uuid[])          from public;
revoke execute on function public.admin_check_duplicate_phones(text[]) from public;

grant execute on function public.admin_delete_leads(uuid[])           to authenticated;
grant execute on function public.admin_check_duplicate_phones(text[]) to authenticated;

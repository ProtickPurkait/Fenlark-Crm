-- ============================================================================
-- Fenlark CRM · 0300 — Authorisation Helpers & Write Guards
-- ============================================================================
-- These functions are the load-bearing pieces of the security model. The RLS
-- policies in 0500 are thin wrappers around them.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- is_admin() — used by nearly every policy and RPC
-- ---------------------------------------------------------------------------
-- MUST be SECURITY DEFINER.
--
-- The RLS policy on public.users needs to know the caller's role, which means
-- reading public.users. If this lookup ran as the caller it would re-trigger
-- that same policy, which would call this function again, and Postgres errors
-- out with "infinite recursion detected in policy for relation users". Running
-- as the function owner bypasses RLS for this one lookup and breaks the cycle.
--
-- `set search_path = public` prevents a caller from shadowing `users` with a
-- temp table — a real privilege-escalation vector in SECURITY DEFINER code.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
      and u.is_active
  );
$$;

-- Ownership check for the audit-log read policy. Also SECURITY DEFINER so the
-- policy on lead_history_logs does not have to re-enter the policy on leads.
create or replace function public.owns_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and l.assigned_to = auth.uid()
      and l.deleted_at is null
  );
$$;

-- True when the current statement originates from the automated recycler
-- rather than a human. Set transaction-locally by recycle_stale_leads().
create or replace function public.is_system_actor()
returns boolean
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.actor_kind', true), ''), 'user') = 'system';
$$;

comment on function public.is_admin() is
  'SECURITY DEFINER by necessity — a SECURITY INVOKER version causes infinite '
  'recursion in the public.users RLS policy.';


-- ---------------------------------------------------------------------------
-- Auth provisioning
-- ---------------------------------------------------------------------------
-- Mirrors every new auth.users row into public.users so signup can never leave
-- an authenticated user with no profile (which would make is_admin() false and
-- every lead invisible, presenting as a mysterious empty dashboard).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(new.email, '@', 1)
    ),
    -- Role is never taken from user-supplied signup metadata; that would let
    -- anyone self-register as an admin. Promotion is an explicit admin action.
    'telecaller'
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- Generic updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_users_touch on public.users;
create trigger trg_users_touch
  before update on public.users
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_settings_touch on public.system_settings;
create trigger trg_settings_touch
  before update on public.system_settings
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- enforce_lead_update_rules() — field-level restriction
-- ---------------------------------------------------------------------------
-- RLS decides *which rows* you may touch. This decides *which columns*.
--
-- Why a trigger rather than column grants: GRANT UPDATE (col) ON leads TO
-- authenticated is the textbook answer, but admins and telecallers are both
-- the `authenticated` Postgres role. Column privileges are role-wide, so
-- locking telecallers out of `phone` would lock admins out too. A trigger can
-- branch on is_admin() at runtime; a GRANT cannot.
create or replace function public.enforce_lead_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin  boolean;
  v_is_system boolean := public.is_system_actor();
begin
  -- Keep updated_at honest regardless of who is writing.
  new.updated_at := now();

  -- The SLA clock is owned by this trigger alone. Whatever the caller supplied
  -- for assigned_at is discarded and recomputed from the assignment change,
  -- so no client, RPC or manual UPDATE can backdate it to dodge recycling.
  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is null then null else now() end;
  else
    new.assigned_at := old.assigned_at;
  end if;

  -- The recycling engine runs under pg_cron with no JWT, so auth.uid() is null
  -- and is_admin() is false. Without this branch the engine's own UPDATE would
  -- be rejected by the assignment lock below.
  if v_is_system then
    return new;
  end if;

  v_is_admin := public.is_admin();

  if not v_is_admin then
    -- Identity and provenance are admin-owned. A telecaller correcting a wrong
    -- number would silently break the dedupe key and the audit chain.
    if new.phone is distinct from old.phone
       or new.full_name is distinct from old.full_name
       or new.email is distinct from old.email
       or new.source is distinct from old.source
       or new.source_meta is distinct from old.source_meta
       or new.created_by is distinct from old.created_by
       or new.sla_revoked_count is distinct from old.sla_revoked_count
       or new.deleted_at is distinct from old.deleted_at
    then
      raise exception
        'Telecallers may not modify lead identity, provenance or archival fields'
        using errcode = '42501';
    end if;

    -- A telecaller may never move a lead — not to someone else, and not to
    -- themselves. This is the second lock on assignment; the WITH CHECK clause
    -- in 0500 is the first.
    if new.assigned_to is distinct from old.assigned_to then
      raise exception
        'Telecallers may not reassign leads. Ask an admin to transfer this lead.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_leads_enforce_update on public.leads;
create trigger trg_leads_enforce_update
  before update on public.leads
  for each row execute function public.enforce_lead_update_rules();


-- Keep assigned_at consistent on INSERT too (admin creating a pre-assigned lead).
--
-- Unlike UPDATE, INSERT honours an explicitly supplied assigned_at. That is
-- what makes migrating an existing spreadsheet with historical assignment
-- dates possible. It is not a hole in the SLA guarantee: a backdated insert
-- only makes the lead *more* eligible for recycling, and INSERT is admin-only.
-- Once the row exists the clock is sealed — no UPDATE can move it.
create or replace function public.enforce_lead_insert_rules()
returns trigger
language plpgsql
as $$
begin
  new.assigned_at := case
    when new.assigned_to is null then null
    else coalesce(new.assigned_at, now())
  end;
  return new;
end $$;

drop trigger if exists trg_leads_enforce_insert on public.leads;
create trigger trg_leads_enforce_insert
  before insert on public.leads
  for each row execute function public.enforce_lead_insert_rules();


-- ---------------------------------------------------------------------------
-- enforce_user_update_rules() — privilege-escalation lock
-- ---------------------------------------------------------------------------
-- The users UPDATE policy in 0500 lets a user edit their own row so they can
-- fix their name or phone. Without this guard that same policy would let a
-- telecaller run `update users set role = 'admin' where id = auth.uid()`.
create or replace function public.enforce_user_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_system_actor() or public.is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.email is distinct from old.email
     or new.id is distinct from old.id
  then
    raise exception 'Only an admin may change role, activation status or email'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists trg_users_enforce_update on public.users;
create trigger trg_users_enforce_update
  before update on public.users
  for each row execute function public.enforce_user_update_rules();

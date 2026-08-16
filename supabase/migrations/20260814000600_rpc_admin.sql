-- ============================================================================
-- Fenlark CRM · 0600 — Admin RPCs
-- ============================================================================
-- Admin mutations go through these functions rather than direct table writes,
-- which keeps validation, authorisation and audit in one place.
--
-- Every function here is SECURITY DEFINER and therefore bypasses RLS — so
-- every one of them re-checks is_admin() as its first statement. A SECURITY
-- DEFINER function that skips its own authorisation check is an open door
-- straight past every policy in 0500.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- admin_import_leads — CSV / manual / webhook ingestion
-- ---------------------------------------------------------------------------
-- Duplicates are hard-blocked. Returns a breakdown so the upload modal can
-- report "312 imported · 14 duplicates · 3 invalid" instead of failing opaquely
-- on the first bad row.
create or replace function public.admin_import_leads(
  p_rows   jsonb,
  p_source public.lead_source default 'csv'
)
returns table (inserted integer, skipped_duplicate integer, skipped_invalid integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_total integer;
  v_valid integer;
  v_ins   integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array of lead objects';
  end if;

  with src as (
    select
      nullif(btrim(t.r ->> 'full_name'), '') as full_name,
      nullif(btrim(t.r ->> 'phone'), '')     as phone,
      nullif(btrim(t.r ->> 'email'), '')     as email,
      nullif(btrim(t.r ->> 'city'), '')      as city,
      nullif(btrim(t.r ->> 'company'), '')   as company,
      nullif(btrim(t.r ->> 'notes'), '')     as notes,
      t.r                                    as raw
    from jsonb_array_elements(p_rows) as t(r)
  ),
  valid as (
    select * from src
    where full_name is not null
      and phone is not null
      and length(public.normalize_phone(phone)) between 7 and 15
  ),
  -- Collapse duplicates *within* the batch first. ON CONFLICT resolves each
  -- row against rows already committed; two identical numbers in the same
  -- upload need handling here.
  deduped as (
    select distinct on (public.normalize_phone(phone)) *
    from valid
    order by public.normalize_phone(phone)
  ),
  ins as (
    insert into public.leads (
      full_name, phone, email, city, company, notes, source, source_meta, created_by
    )
    select full_name, phone, email, city, company, notes, p_source, raw, v_actor
    from deduped
    -- Bare DO NOTHING, so it works against the partial unique index
    -- leads_phone_unique without restating its predicate.
    on conflict do nothing
    returning 1
  )
  select
    (select count(*) from src)::integer,
    (select count(*) from valid)::integer,
    (select count(*) from ins)::integer
  into v_total, v_valid, v_ins;

  return query select v_ins, (v_valid - v_ins), (v_total - v_valid);
end $$;


-- ---------------------------------------------------------------------------
-- admin_assign_leads — manual assignment / return to pool
-- ---------------------------------------------------------------------------
-- Pass p_user_id => null to strip assignment and return leads to the
-- unassigned pool manually (the same effect the SLA engine produces, but
-- logged as 'unassigned' by a named admin rather than 'sla_revoked').
create or replace function public.admin_assign_leads(
  p_lead_ids uuid[],
  p_user_id  uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if p_lead_ids is null or array_length(p_lead_ids, 1) is null then
    raise exception 'no leads selected';
  end if;

  if p_user_id is not null and not exists (
    select 1 from public.users
    where id = p_user_id and role = 'telecaller' and is_active
  ) then
    raise exception 'target must be an active telecaller'
      using hint = 'Deactivated users cannot receive new leads.';
  end if;

  update public.leads
     set assigned_to = p_user_id
   where id = any(p_lead_ids)
     and deleted_at is null
     and assigned_to is distinct from p_user_id;

  get diagnostics v_count = row_count;
  return v_count;
end $$;


-- ---------------------------------------------------------------------------
-- admin_round_robin_assign — even batch distribution
-- ---------------------------------------------------------------------------
-- Deterministic modulo distribution, resumed from and advanced past
-- system_settings.round_robin_cursor so consecutive batches keep the workload
-- level rather than always reloading the alphabetically-first telecaller.
create or replace function public.admin_round_robin_assign(
  p_lead_ids uuid[],
  p_user_ids uuid[]
)
returns table (user_id uuid, full_name text, assigned_count integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_n      integer;
  v_cursor integer;
  v_leads  integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if p_lead_ids is null or array_length(p_lead_ids, 1) is null then
    raise exception 'no leads selected';
  end if;

  select count(*) into v_n
  from public.users u
  where u.id = any(p_user_ids) and u.role = 'telecaller' and u.is_active;

  -- Guard the modulo below: v_n = 0 would be a division-by-zero rather than a
  -- comprehensible error.
  if v_n = 0 then
    raise exception 'no active telecallers in the selection'
      using hint = 'Deactivated users are excluded from round-robin distribution.';
  end if;

  select count(*) into v_leads
  from public.leads l
  where l.id = any(p_lead_ids) and l.deleted_at is null;

  if v_leads = 0 then
    raise exception 'none of the selected leads are available for assignment';
  end if;

  select s.round_robin_cursor into v_cursor
  from public.system_settings s where s.id = true;
  v_cursor := coalesce(v_cursor, 0);

  with targets as (
    select u.id, (row_number() over (order by u.full_name, u.id) - 1)::integer as idx
    from public.users u
    where u.id = any(p_user_ids) and u.role = 'telecaller' and u.is_active
  ),
  ordered as (
    select l.id, (row_number() over (order by l.created_at, l.id) - 1)::integer as rn
    from public.leads l
    where l.id = any(p_lead_ids) and l.deleted_at is null
  )
  update public.leads l
     set assigned_to = t.id
    from ordered o
    join targets t on t.idx = ((o.rn + v_cursor) % v_n)
   where l.id = o.id
     and l.assigned_to is distinct from t.id;

  -- Advance the cursor by the number of leads distributed, so the next batch
  -- starts on the next telecaller in rotation.
  update public.system_settings
     set round_robin_cursor = (v_cursor + v_leads) % v_n,
         updated_by = auth.uid()
   where id = true;

  return query
    select u.id, u.full_name, count(l.id)::integer
    from public.users u
    left join public.leads l
      on l.assigned_to = u.id
     and l.id = any(p_lead_ids)
     and l.deleted_at is null
    where u.id = any(p_user_ids) and u.role = 'telecaller' and u.is_active
    group by u.id, u.full_name
    order by u.full_name;
end $$;

comment on function public.admin_round_robin_assign(uuid[], uuid[]) is
  'Even distribution across selected active telecallers. assigned_at and the '
  'assigned/reassigned audit entries are produced by the triggers in 0300/0400.';


-- ---------------------------------------------------------------------------
-- admin_archive_lead — soft delete
-- ---------------------------------------------------------------------------
create or replace function public.admin_archive_lead(
  p_lead_id uuid,
  p_reason  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  perform set_config(
    'app.audit_note',
    coalesce(nullif(btrim(p_reason), ''), 'Archived by admin.'),
    true
  );

  update public.leads
     set deleted_at = now()
   where id = p_lead_id
     and deleted_at is null;

  if not found then
    raise exception 'lead not found or already archived' using errcode = 'P0002';
  end if;

  -- Assignment is intentionally left intact: the archived record should still
  -- show who was working it. The RLS predicate already hides archived leads
  -- from the telecaller's queue.
end $$;


-- ---------------------------------------------------------------------------
-- admin_update_settings
-- ---------------------------------------------------------------------------
-- Backs the Settings panel: the recycling ON/OFF toggle and the SLA hours
-- input. Null arguments leave the existing value untouched.
create or replace function public.admin_update_settings(
  p_enabled           boolean default null,
  p_sla_hours         integer default null,
  p_whatsapp_template text    default null
)
returns public.system_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.system_settings;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if p_sla_hours is not null and p_sla_hours not between 1 and 720 then
    raise exception 'SLA hours must be between 1 and 720 (30 days)';
  end if;

  update public.system_settings
     set stale_recycling_enabled = coalesce(p_enabled, stale_recycling_enabled),
         stale_sla_hours         = coalesce(p_sla_hours, stale_sla_hours),
         whatsapp_template       = coalesce(
                                     nullif(btrim(p_whatsapp_template), ''),
                                     whatsapp_template
                                   ),
         updated_by              = auth.uid()
   where id = true
  returning * into v_row;

  return v_row;
end $$;


-- ---------------------------------------------------------------------------
-- admin_set_user_role / admin_set_user_active
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_user_role(
  p_user_id uuid,
  p_role    public.user_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  update public.users set role = p_role where id = p_user_id;

  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.admin_set_user_active(
  p_user_id uuid,
  p_active  boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  -- Refuse to strand the last admin: with no active admin, is_admin() is false
  -- for everyone and the settings panel becomes permanently unreachable.
  if p_active is false and exists (
    select 1 from public.users where id = p_user_id and role = 'admin'
  ) and (
    select count(*) from public.users where role = 'admin' and is_active
  ) <= 1 then
    raise exception 'cannot deactivate the last active admin';
  end if;

  update public.users set is_active = p_active where id = p_user_id;

  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- Execution grants
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default; revoke before granting so
-- anon can never reach an admin RPC even though each re-checks is_admin().
revoke execute on function public.admin_import_leads(jsonb, public.lead_source)      from public;
revoke execute on function public.admin_assign_leads(uuid[], uuid)                   from public;
revoke execute on function public.admin_round_robin_assign(uuid[], uuid[])           from public;
revoke execute on function public.admin_archive_lead(uuid, text)                     from public;
revoke execute on function public.admin_update_settings(boolean, integer, text)      from public;
revoke execute on function public.admin_set_user_role(uuid, public.user_role)        from public;
revoke execute on function public.admin_set_user_active(uuid, boolean)               from public;

grant execute on function public.admin_import_leads(jsonb, public.lead_source)       to authenticated;
grant execute on function public.admin_assign_leads(uuid[], uuid)                    to authenticated;
grant execute on function public.admin_round_robin_assign(uuid[], uuid[])            to authenticated;
grant execute on function public.admin_archive_lead(uuid, text)                      to authenticated;
grant execute on function public.admin_update_settings(boolean, integer, text)       to authenticated;
grant execute on function public.admin_set_user_role(uuid, public.user_role)         to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean)                to authenticated;

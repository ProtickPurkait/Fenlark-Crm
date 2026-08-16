-- ============================================================================
-- Trace · 1400 — Business type + address on leads
-- ============================================================================
-- Every lead in this CRM is a business, not an individual — Fenlark sells to
-- businesses, and full_name/phone have always been filled in with the
-- business's own name and line in practice. This migration adds the two
-- fields an admin actually types (business_type, address) so a telecaller
-- has real context ("this is a cafe") before they dial, without touching
-- full_name/phone/company at the schema level — renaming those would ripple
-- through every RPC, CSV import path, and JSONB payload that already keys on
-- them for no functional gain, since this is purely a labeling change in the
-- UI (see lead-import-panel.tsx, csv.ts).
--
-- business_type is deliberately plain text, not an enum: the agency's leads
-- span far more categories than any fixed list would hold ("cafe", "interior
-- decor", "hotels", "restaurants", ... "anything"), and a telecaller or admin
-- should never be blocked from recording an unlisted one. The UI offers
-- common suggestions via a <datalist>, not a hard constraint.

alter table public.leads
  add column business_type text,
  add column address text;

comment on column public.leads.business_type is
  'Free-text business category (e.g. "Cafe", "Restaurant", "Interior Decor") '
  'shown to the telecaller before they call. Not an enum on purpose — see '
  'migration 1400 for why.';

comment on column public.leads.address is
  'Full business address. Distinct from leads.city, which stays as-is for '
  'quick city-level display/search.';

-- ---------------------------------------------------------------------------
-- admin_import_leads — extended to accept the two new optional fields
-- ---------------------------------------------------------------------------
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
      nullif(btrim(t.r ->> 'full_name'), '')     as full_name,
      nullif(btrim(t.r ->> 'phone'), '')         as phone,
      nullif(btrim(t.r ->> 'email'), '')         as email,
      nullif(btrim(t.r ->> 'city'), '')          as city,
      nullif(btrim(t.r ->> 'company'), '')       as company,
      nullif(btrim(t.r ->> 'business_type'), '') as business_type,
      nullif(btrim(t.r ->> 'address'), '')       as address,
      nullif(btrim(t.r ->> 'notes'), '')         as notes,
      t.r                                        as raw
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
      full_name, phone, email, city, company, business_type, address, notes,
      source, source_meta, created_by
    )
    select
      full_name, phone, email, city, company, business_type, address, notes,
      p_source, raw, v_actor
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

revoke execute on function public.admin_import_leads(jsonb, public.lead_source) from public, anon;
grant execute on function public.admin_import_leads(jsonb, public.lead_source) to authenticated;

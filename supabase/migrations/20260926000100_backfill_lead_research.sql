-- ============================================================================
-- Trace · 2800 — Backfilling website-audit research onto existing leads
-- ============================================================================
-- Migration 2700 added website/observed_opportunity/website_issues/
-- alternate_phone and taught admin_import_leads() to store them on INSERT.
-- What it cannot do is help a lead that already exists: admin_import_leads()
-- inserts only, and ON CONFLICT DO NOTHING means a re-uploaded sheet for a
-- business already in the pipeline is correctly recognised as a duplicate
-- and then — correctly, for every OTHER field — left untouched. For these
-- four fields specifically that is the wrong behaviour: the whole point of
-- re-running a research pass is to attach (or refresh) exactly this data on
-- a lead a telecaller may already be mid-conversation with. Deleting and
-- re-inserting it (the existing "Replace" duplicate option) is not a
-- substitute — it would hand that lead a new id and erase its assignment,
-- status and remark history to do it.
--
-- admin_backfill_lead_research() is the missing third path: an UPDATE, not
-- an INSERT, scoped to exactly these four columns, matched by phone. Every
-- other field on the lead — status, assigned_to, full_name, everything the
-- CSV might also carry — is untouched, so this is safe to run against any
-- CSV (even one with no audit columns at all; see WHERE src below) and safe
-- to run after every import, not just when the admin knows duplicates exist.

create or replace function public.admin_backfill_lead_research(p_rows jsonb)
returns table (updated integer, not_found integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total   integer;
  v_updated integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array of lead objects';
  end if;

  with extracted as (
    select
      public.normalize_phone(nullif(btrim(t.r ->> 'phone'), ''))  as phone_norm,
      nullif(btrim(t.r ->> 'website'), '')                        as website,
      nullif(btrim(t.r ->> 'observed_opportunity'), '')           as observed_opportunity,
      nullif(btrim(t.r ->> 'website_issues'), '')                 as website_issues,
      nullif(btrim(t.r ->> 'alternate_phone'), '')                as alternate_phone
    from jsonb_array_elements(p_rows) as t(r)
  ),
  -- Two filters, same reasoning as admin_import_leads()'s own `valid`/
  -- `deduped` CTEs: skip a row with no usable phone, and skip a row that
  -- carries none of the four fields at all — an ordinary lead CSV with no
  -- audit columns should cost this function nothing, not a no-op UPDATE
  -- per row. distinct on collapses the same business appearing twice in
  -- one upload, same as the insert path, so one row doesn't update the
  -- same lead twice in a way whose final value would depend on row order.
  src as (
    select distinct on (phone_norm)
      phone_norm, website, observed_opportunity, website_issues, alternate_phone
    from extracted
    where phone_norm is not null
      and length(phone_norm) between 7 and 15
      and (website is not null or observed_opportunity is not null
           or website_issues is not null or alternate_phone is not null)
    order by phone_norm
  ),
  upd as (
    update public.leads l
       set website              = coalesce(s.website, l.website),
           observed_opportunity = coalesce(s.observed_opportunity, l.observed_opportunity),
           website_issues       = coalesce(s.website_issues, l.website_issues),
           alternate_phone      = coalesce(s.alternate_phone, l.alternate_phone)
      from src s
     where l.phone_normalized = s.phone_norm
       and l.deleted_at is null
    returning l.id
  )
  select (select count(*) from src)::integer, (select count(*) from upd)::integer
  into v_total, v_updated;

  return query select v_updated, (v_total - v_updated);
end $$;

revoke execute on function public.admin_backfill_lead_research(jsonb) from public, anon;
grant execute on function public.admin_backfill_lead_research(jsonb) to authenticated;

comment on function public.admin_backfill_lead_research(jsonb) is
  'Updates website/observed_opportunity/website_issues/alternate_phone on '
  'leads that already exist, matched by phone. Every other column is left '
  'alone — this is not a general lead editor, just the missing update path '
  'admin_import_leads() (insert-only) cannot provide for these four fields.';

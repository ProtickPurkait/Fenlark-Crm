-- ============================================================================
-- Trace · 2700 — Website-audit fields on leads
-- ============================================================================
-- Each lead already arrives with a cold-call angle baked in: a researcher
-- checked the business's Google listing and its website (if any) before the
-- lead ever reaches a telecaller, and that finding is the actual reason to
-- call ("your site returns a 404", "Google links to a dead business.site
-- page"). Four free-text columns, mirroring the CSV this already comes in
-- as (website, observed_opportunity, website_issues) plus one this
-- migration introduces at the database level rather than the CSV
-- (alternate_phone):
--
--   * website             — the business's site, when one exists and was
--                            found. Null (not the string "none found") when
--                            there isn't one — see csv.ts's NO_WEBSITE_
--                            SENTINELS for why that normalisation happens at
--                            parse time rather than here: by the time a row
--                            reaches this function, "none found" is already
--                            gone, so there is nothing for this migration to
--                            re-strip.
--   * observed_opportunity — one sentence stating what's wrong / the sales
--                            angle. Free text, not an enum — the whole point
--                            is a researcher can phrase a finding no fixed
--                            list anticipated.
--   * website_issues       — the technical detail behind that opportunity,
--                            when there is a live site to diagnose (a dead
--                            Google listing has nothing further to say here,
--                            so this is blank far more often than it isn't).
--   * alternate_phone      — a second number from the same source row.
--                            Plain text, deliberately NOT run through
--                            normalize_phone() or added to leads_phone_
--                            unique: it is a courtesy "also try this
--                            number", not a second identity for the lead,
--                            and must never block a legitimate re-import or
--                            participate in duplicate detection. phone/
--                            phone_normalized stay exactly what they always
--                            were — the one number everything else in this
--                            schema keys on.
--
-- Business type and address went through the exact same reasoning in
-- migration 1400; this is that same shape of change, same no-enum rationale,
-- one cycle later.

alter table public.leads
  add column website              text,
  add column observed_opportunity text,
  add column website_issues       text,
  add column alternate_phone      text;

comment on column public.leads.website is
  'The business''s website, when the research pass found one. Null means '
  'none exists (or none was found), not "we didn''t check" — see '
  'observed_opportunity for which.';

comment on column public.leads.observed_opportunity is
  'One sentence: the reason this lead is worth calling right now (e.g. '
  '"Website returns error HTTP 404"). Free text, not an enum, same '
  'reasoning as business_type (migration 1400).';

comment on column public.leads.website_issues is
  'Technical detail behind observed_opportunity, when there was a live '
  'site to diagnose. Often null — a lead with no website at all has '
  'nothing further to report here.';

comment on column public.leads.alternate_phone is
  'A second phone number from the same source row as phone. Informational '
  'only: never normalized, never unique-constrained, never used for '
  'dedup or dialing by default — phone/phone_normalized remain the one '
  'number this schema treats as the lead''s identity.';


-- ---------------------------------------------------------------------------
-- admin_import_leads — extended to accept the four new optional fields
-- ---------------------------------------------------------------------------
-- Same signature as migration 1400 left it (p_rows jsonb, p_source
-- lead_source) — only the row shape it reads grows, so create or replace is
-- safe here with no drop/grant changes needed.
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
      nullif(btrim(t.r ->> 'full_name'), '')             as full_name,
      nullif(btrim(t.r ->> 'phone'), '')                 as phone,
      nullif(btrim(t.r ->> 'email'), '')                 as email,
      nullif(btrim(t.r ->> 'city'), '')                  as city,
      nullif(btrim(t.r ->> 'company'), '')               as company,
      nullif(btrim(t.r ->> 'business_type'), '')         as business_type,
      nullif(btrim(t.r ->> 'address'), '')               as address,
      nullif(btrim(t.r ->> 'notes'), '')                 as notes,
      nullif(btrim(t.r ->> 'website'), '')                as website,
      nullif(btrim(t.r ->> 'observed_opportunity'), '')   as observed_opportunity,
      nullif(btrim(t.r ->> 'website_issues'), '')         as website_issues,
      nullif(btrim(t.r ->> 'alternate_phone'), '')        as alternate_phone,
      t.r                                                 as raw
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
      website, observed_opportunity, website_issues, alternate_phone,
      source, source_meta, created_by
    )
    select
      full_name, phone, email, city, company, business_type, address, notes,
      website, observed_opportunity, website_issues, alternate_phone,
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

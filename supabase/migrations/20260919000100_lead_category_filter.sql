-- ============================================================================
-- Trace · 2200 — Lead category (business_type) filter
-- ============================================================================
-- The Leads screen showed business_type as a chip but offered no way to filter
-- by it, so "assign only the Cafe leads to Bina" or "take the Interior Decor
-- leads back off her, that category isn't converting" meant picking rows out
-- of the list by eye.
--
-- The filter's options cannot be derived from the page being displayed — a
-- category with no lead on page 1 would simply be missing from the list — so
-- this returns every distinct category in the pool, with counts.
-- ============================================================================

create or replace function public.admin_lead_categories()
returns table (
  business_type    text,
  lead_count       integer,
  unassigned_count integer
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
    l.business_type,
    count(*)::integer,
    count(*) filter (where l.assigned_to is null)::integer
  from public.leads l
  where l.deleted_at is null
  group by l.business_type
  -- Biggest categories first: that is the order an admin actually wants to
  -- hand work out in. business_type breaks ties so the list is stable between
  -- requests rather than reshuffling on every render.
  --
  -- The uncategorised group (business_type is null) is returned like any
  -- other rather than filtered out: leads imported before the field existed
  -- land there, and they still need to be assignable as a group.
  order by count(*) desc, l.business_type asc nulls last;
end $$;

revoke execute on function public.admin_lead_categories() from public, anon;
grant execute on function public.admin_lead_categories() to authenticated;

comment on function public.admin_lead_categories() is
  'Distinct lead categories with totals, for the Leads screen filter. Counts '
  'the whole pool, not the page on screen.';

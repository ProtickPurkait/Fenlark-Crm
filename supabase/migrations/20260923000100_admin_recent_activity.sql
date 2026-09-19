-- ============================================================================
-- Trace · 2500 — Recent Activity feed, with an optional date filter
-- ============================================================================
-- Backs the dashboard's "Recent Activity" card. Previously the page queried
-- lead_history_logs directly (relying on RLS) and resolved actor/lead names
-- with two extra round trips. Folding that into one RPC does two things:
--
--   1. Lets the card filter by a specific day. Day boundaries must be
--      computed against report_timezone in Postgres, not the server's UTC —
--      the same trap noted throughout 2300/2400 (JS date arithmetic against
--      an arbitrary IANA zone is not safe to hand-roll).
--   2. With no date, keeps the original "most recent N, any day" behaviour
--      the card always had, so nothing about the default view changes.
-- ============================================================================

create or replace function public.admin_recent_activity(
  p_date  date default null,
  p_limit integer default 50
)
returns table (
  id         bigint,
  event_type public.audit_event,
  created_at timestamptz,
  actor_kind text,
  -- Null when the event is a system action, or when the acting account was
  -- later deleted (actor_id FK-nulled, actor_kind stays 'user'). The client
  -- already distinguishes those two cases from actor_kind; this just carries
  -- the raw fact rather than baking a display string into the database.
  actor_name text,
  lead_name  text,
  to_status  public.lead_status
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz    text;
  v_start timestamptz;
  v_end   timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if p_date is not null then
    -- Qualified id = true (not the bare column) — the OUT parameter list
    -- above declares an "id" of its own (bigint), which would otherwise
    -- shadow system_settings.id (boolean) inside this function body.
    select coalesce(s.report_timezone, 'Asia/Kolkata') into v_tz
    from public.system_settings s where s.id = true;
    v_start := p_date::timestamp at time zone v_tz;
    v_end   := (p_date + 1)::timestamp at time zone v_tz;
  end if;

  return query
  select
    h.id,
    h.event_type,
    h.created_at,
    h.actor_kind,
    u.full_name,
    l.full_name,
    h.to_status
  from public.lead_history_logs h
  left join public.users u on u.id = h.actor_id
  left join public.leads l on l.id = h.lead_id
  where p_date is null or (h.created_at >= v_start and h.created_at < v_end)
  -- id as a tiebreaker, not just cosmetic: log_call_interaction() writes its
  -- status_changed and remark_added rows in the same transaction, so they
  -- share one created_at exactly. id (an identity column) is the only thing
  -- that still reflects which was written first.
  order by h.created_at desc, h.id desc
  limit p_limit;
end $$;

revoke execute on function public.admin_recent_activity(date, integer) from public, anon;
grant execute on function public.admin_recent_activity(date, integer) to authenticated;

comment on function public.admin_recent_activity(date, integer) is
  'Recent Activity card. p_date null = most recent p_limit events, any day '
  '(the dashboard''s default). p_date set = every event on that day in '
  'report_timezone, up to p_limit.';

-- ============================================================================
-- Trace · 1500 — Sales & Commission
-- ============================================================================
-- A telecaller logs a sale against one of their own leads; it lands in an
-- admin approval queue; approval locks a fixed ₹500 commission to that
-- telecaller with a timestamp, rejection notifies them with a reason.
--
-- ONE TABLE, not a sales table plus a separate ledger/notifications table.
-- The wallet balance is `sum(commission_amount) where status='approved'`,
-- computed live — a stored running balance would just be a second number that
-- can drift from the ledger it is supposed to summarise. A rejection
-- notification is just this same row with `acknowledged_at is null`; no
-- separate notifications table needed for a single, narrowly-scoped alert
-- type.
--
-- WRITE PATH: RPC-only from day one (unlike leads, which had direct grants
-- until the 1000 hardening pass) — see C-1's lesson in 1000.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.sale_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

comment on type public.sale_status is
  'pending -> approved | rejected. Both are terminal — see '
  'enforce_sale_immutability().';


-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.sales (
  id                 uuid primary key default gen_random_uuid(),

  lead_id            uuid not null references public.leads (id),
  -- Matches lead_history_logs.actor_id / call_sessions.caller_id: a departed
  -- telecaller's account can be deleted without erasing that the sale, and
  -- the commission, happened.
  telecaller_id      uuid references public.users (id) on delete set null,

  status             public.sale_status not null default 'pending',
  -- Snapshotted per row rather than hardcoded in queries, so a future change
  -- to the standard rate never rewrites history.
  commission_amount  integer not null default 500 check (commission_amount >= 0),
  sale_note          text,

  submitted_at       timestamptz not null default now(),

  reviewed_by        uuid references public.users (id) on delete set null,
  reviewed_at        timestamptz,
  rejection_reason   text,

  -- Doubles as the rejection notification's "seen" flag. Deliberately the one
  -- column enforce_sale_immutability() still allows to change after review.
  acknowledged_at    timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- A lead can only have one live commission claim at a time. A rejected sale
-- does not block resubmission — only pending/approved are "active".
create unique index if not exists sales_lead_active_unique
  on public.sales (lead_id)
  where status in ('pending', 'approved');

-- Wallet balance and transaction-history queries.
create index if not exists sales_telecaller_status_idx
  on public.sales (telecaller_id, status);

-- The admin approval queue.
create index if not exists sales_status_pending_idx
  on public.sales (submitted_at)
  where status = 'pending';

-- The rejection bell's badge count.
create index if not exists sales_telecaller_unseen_idx
  on public.sales (telecaller_id)
  where status = 'rejected' and acknowledged_at is null;

comment on table public.sales is
  'One row per commission claim. Wallet balance is computed on read as '
  'sum(commission_amount) where status=''approved'', never stored — see '
  'my_wallet_summary().';


-- ---------------------------------------------------------------------------
-- enforce_sale_immutability() — "once reviewed, locked" as a trigger
-- ---------------------------------------------------------------------------
-- Once a sale leaves 'pending', every column is frozen except
-- acknowledged_at. This is what "the ₹500 is locked to the telecaller's
-- account with a timestamp" means at the data layer: reviewed_at and
-- commission_amount cannot be touched again by anyone, including an admin
-- retrying admin_approve_sale/admin_reject_sale on an already-decided row —
-- those RPCs already guard on status='pending' in their WHERE clause, and
-- this trigger is the second, unconditional lock behind that.
create or replace function public.enforce_sale_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if old.status <> 'pending' then
    if new.status            is distinct from old.status
       or new.commission_amount is distinct from old.commission_amount
       or new.lead_id           is distinct from old.lead_id
       or new.telecaller_id     is distinct from old.telecaller_id
       or new.sale_note         is distinct from old.sale_note
       or new.submitted_at      is distinct from old.submitted_at
       or new.reviewed_by       is distinct from old.reviewed_by
       or new.reviewed_at       is distinct from old.reviewed_at
       or new.rejection_reason  is distinct from old.rejection_reason
    then
      raise exception
        'a reviewed sale is locked; only acknowledging a rejection is permitted'
        using errcode = '55000';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_sales_immutability on public.sales;
create trigger trg_sales_immutability
  before update on public.sales
  for each row execute function public.enforce_sale_immutability();


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.sales enable row level security;

grant select on public.sales to authenticated;
revoke insert, update, delete on public.sales from authenticated, anon;

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
  for select to authenticated
  using (public.is_admin() or telecaller_id = auth.uid());


-- ---------------------------------------------------------------------------
-- caller_log_sale
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, so it re-verifies lead ownership itself — same rule as
-- log_call_interaction and start_call_session: RLS does not protect the body
-- of a SECURITY DEFINER function.
--
-- Also flips the lead to 'converted'. A sale *is* a conversion, and piggy-
-- backing on the leads UPDATE means log_lead_change() (0400) writes the
-- status_changed audit row for free — no separate "sale logged" entry needed
-- on the lead's timeline.
create or replace function public.caller_log_sale(
  p_lead_id uuid,
  p_note    text default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_lead  public.leads;
  v_sale  public.sales;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and deleted_at is null
  for update;

  if not found then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;

  if not (public.is_admin() or v_lead.assigned_to = v_actor) then
    raise exception 'forbidden: this lead is not assigned to you'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.sales
    where lead_id = p_lead_id and status in ('pending', 'approved')
  ) then
    raise exception 'a sale is already pending or approved for this lead'
      using errcode = '23505';
  end if;

  insert into public.sales (lead_id, telecaller_id, sale_note)
  values (p_lead_id, v_actor, nullif(btrim(p_note), ''))
  returning * into v_sale;

  update public.leads
     set status = 'converted', scheduled_at = null
   where id = p_lead_id and status <> 'converted';

  return v_sale;
end $$;


-- ---------------------------------------------------------------------------
-- admin_approve_sale / admin_reject_sale
-- ---------------------------------------------------------------------------
-- Both guard `where id = p_sale_id and status = 'pending'` so two admins
-- clicking Approve/Reject on the same row at once serialise into one winner
-- and one P0002, rather than a double-paid commission.
create or replace function public.admin_approve_sale(p_sale_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  update public.sales
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_sale_id and status = 'pending'
  returning * into v_sale;

  if v_sale.id is null then
    raise exception 'sale not found or already reviewed' using errcode = 'P0002';
  end if;

  return v_sale;
end $$;

-- A reason is required — it is the whole content of the rejection
-- notification the telecaller sees on the bell.
create or replace function public.admin_reject_sale(
  p_sale_id uuid,
  p_reason  text
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale   public.sales;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'a rejection reason is required';
  end if;

  update public.sales
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         rejection_reason = v_reason
   where id = p_sale_id and status = 'pending'
  returning * into v_sale;

  if v_sale.id is null then
    raise exception 'sale not found or already reviewed' using errcode = 'P0002';
  end if;

  return v_sale;
end $$;


-- ---------------------------------------------------------------------------
-- caller_acknowledge_sale — dismiss a rejection notice
-- ---------------------------------------------------------------------------
create or replace function public.caller_acknowledge_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sales
     set acknowledged_at = now()
   where id = p_sale_id
     and telecaller_id = auth.uid()
     and status = 'rejected'
     and acknowledged_at is null;
end $$;


-- ---------------------------------------------------------------------------
-- my_wallet_summary — one round trip for the Earnings tab header
-- ---------------------------------------------------------------------------
-- Aggregated in Postgres rather than summed client-side, same reasoning as
-- admin_dashboard_summary() in 1000: PostgREST's default 1000-row response
-- cap would eventually make a client-side sum quietly wrong.
create or replace function public.my_wallet_summary()
returns table (
  balance            integer,
  approved_count     integer,
  pending_count      integer,
  unseen_rejections  integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(commission_amount) filter (where status = 'approved'), 0)::integer,
    count(*) filter (where status = 'approved')::integer,
    count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'rejected' and acknowledged_at is null)::integer
  from public.sales
  where telecaller_id = auth.uid();
$$;


-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.caller_log_sale(uuid, text)   from public, anon;
revoke execute on function public.admin_approve_sale(uuid)      from public, anon;
revoke execute on function public.admin_reject_sale(uuid, text) from public, anon;
revoke execute on function public.caller_acknowledge_sale(uuid) from public, anon;
revoke execute on function public.my_wallet_summary()           from public, anon;

grant execute on function public.caller_log_sale(uuid, text)   to authenticated;
grant execute on function public.admin_approve_sale(uuid)      to authenticated;
grant execute on function public.admin_reject_sale(uuid, text) to authenticated;
grant execute on function public.caller_acknowledge_sale(uuid) to authenticated;
grant execute on function public.my_wallet_summary()           to authenticated;


-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- Lets the telecaller's rejection bell subscribe instead of polling. Delivery
-- still respects the RLS policy above, so a telecaller subscribing to this
-- table only ever receives their own rows.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sales'
  ) then
    alter publication supabase_realtime add table public.sales;
  end if;
exception when undefined_object then
  raise notice 'supabase_realtime publication not present; skipping';
end $$;

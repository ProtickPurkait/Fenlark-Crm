-- ============================================================================
-- Fenlark CRM · 0200 — Core Tables
-- ============================================================================
-- Four tables: users (auth profile), leads, lead_history_logs (append-only
-- audit trail) and system_settings (singleton config).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Phone normalisation
-- ---------------------------------------------------------------------------
-- Defined here (not in 0300) because public.leads depends on it for a STORED
-- generated column, so it must exist before the table.
--
-- A naive regexp_replace(phone, '[^0-9]', '', 'g') is NOT sufficient for the
-- duplicate-blocking requirement: the same person arrives as '9876543210' from
-- a CSV and '+91 98765 43210' from a Facebook/webhook lead, which strip to
-- '9876543210' and '919876543210' — two different keys, and two telecallers
-- calling the same person. This canonicalises to the bare national number.
--
-- MUST be IMMUTABLE to be legal in a generated column.
--
-- WARNING: because a stored generated column depends on this function, editing
-- it does NOT recompute existing rows. See README ("Changing phone
-- normalisation") for the required backfill procedure.
create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    -- +91 98765 43210 / 919876543210  -> 9876543210
    when length(d) = 12 and left(d, 2) = '91' then right(d, 10)
    -- 098765 43210                    -> 9876543210
    when length(d) = 11 and left(d, 1) = '0'  then right(d, 10)
    else d
  end
  from (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d
  ) s;
$$;

comment on function public.normalize_phone(text) is
  'Canonicalises an Indian phone number to its bare 10-digit national form so '
  'that CSV, manual and webhook variants of the same number collide on the '
  'unique index. Mirrored by lib/phone.ts on the frontend — keep in sync.';


-- ---------------------------------------------------------------------------
-- users — profile mirror of auth.users
-- ---------------------------------------------------------------------------
-- Keyed to auth.users(id) rather than being a standalone table. Any other
-- design forks application identity from auth.uid() and breaks every RLS
-- policy in migration 0500.
create table if not exists public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text not null check (length(btrim(full_name)) > 0),
  phone       text,
  role        public.user_role not null default 'telecaller',
  -- Drives "actively selected telecallers" in round-robin distribution.
  -- Deactivating a caller removes them from assignment without deleting the
  -- person, which would take their audit history with them.
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists users_role_active_idx
  on public.users (role, is_active);

comment on column public.users.is_active is
  'False removes the user from round-robin distribution and admin pickers '
  'without destroying their audit history. Prefer this over deletion.';


-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                uuid primary key default gen_random_uuid(),

  full_name         text not null check (length(btrim(full_name)) > 0),
  phone             text not null,
  phone_normalized  text generated always as (public.normalize_phone(phone)) stored,
  email             text,
  city              text,
  company           text,
  notes             text,

  source            public.lead_source not null default 'manual',
  -- Raw inbound payload (CSV row / webhook body) retained verbatim for
  -- forensics: "where did this bad number come from?"
  source_meta       jsonb not null default '{}'::jsonb,

  status            public.lead_status not null default 'new',

  assigned_to       uuid references public.users (id) on delete set null,
  -- The SLA clock. Maintained exclusively by enforce_lead_update_rules() in
  -- migration 0300 — never written by a client, an RPC, or by hand. That is
  -- what makes the recycling engine impossible to game by backdating.
  assigned_at       timestamptz,

  last_contacted_at timestamptz,
  scheduled_at      timestamptz,          -- next follow-up
  last_remark       text,                 -- denormalised for fast list rendering
  sla_revoked_count integer not null default 0,

  created_by        uuid references public.users (id) on delete set null,
  -- Soft delete only. See migration 0400 for why hard deletes are impossible.
  deleted_at        timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint leads_phone_plausible
    check (length(public.normalize_phone(phone)) between 7 and 15)
);

-- Hard-block duplicates. Partial on deleted_at so archiving a lead releases the
-- number for future campaigns rather than burning it permanently.
create unique index if not exists leads_phone_unique
  on public.leads (phone_normalized)
  where deleted_at is null;

-- Telecaller queue: "my leads, by pipeline stage".
create index if not exists leads_assigned_status_idx
  on public.leads (assigned_to, status)
  where deleted_at is null;

-- Admin unassigned pool + conversion funnel counts.
create index if not exists leads_status_idx
  on public.leads (status)
  where deleted_at is null;

-- "Due Soon" / "Overdue" follow-up surfacing.
create index if not exists leads_scheduled_idx
  on public.leads (scheduled_at)
  where scheduled_at is not null and deleted_at is null;

-- The SLA sweep (migration 0800). Narrowly partial so the recycler touches a
-- handful of rows instead of seq-scanning the whole lead table every 15 min.
create index if not exists leads_sla_sweep_idx
  on public.leads (assigned_at)
  where status = 'new' and assigned_to is not null and deleted_at is null;

comment on column public.leads.assigned_at is
  'Set automatically whenever assigned_to changes. Client-supplied values are '
  'overwritten by trigger — the SLA clock cannot be backdated.';


-- ---------------------------------------------------------------------------
-- lead_history_logs — append-only audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.lead_history_logs (
  id            bigint generated always as identity primary key,

  -- Deliberately NOT "on delete cascade": a cascade would trip the
  -- immutability guard in 0400 and make lead deletion fail in a confusing way.
  -- Leads are soft-deleted instead.
  lead_id       uuid not null references public.leads (id),

  actor_id      uuid references public.users (id) on delete set null,
  -- Survives actor_id being nulled by a user deletion. A departed telecaller's
  -- row can disappear without erasing the fact that *something happened*.
  actor_kind    text not null default 'user'
                  check (actor_kind in ('user', 'system')),

  event_type    public.audit_event not null,

  from_status   public.lead_status,
  to_status     public.lead_status,
  from_assignee uuid references public.users (id) on delete set null,
  to_assignee   uuid references public.users (id) on delete set null,

  remark        text,
  scheduled_at  timestamptz,
  -- Free-text system annotation, e.g.
  -- 'System revoked assignment due to SLA breach.'
  note          text,

  created_at    timestamptz not null default now()
);

-- The lead timeline, newest first.
create index if not exists lead_history_lead_idx
  on public.lead_history_logs (lead_id, created_at desc);

-- Per-telecaller productivity ("Calls Made Today").
create index if not exists lead_history_actor_idx
  on public.lead_history_logs (actor_id, created_at desc);

create index if not exists lead_history_event_idx
  on public.lead_history_logs (event_type, created_at desc);

comment on table public.lead_history_logs is
  'Append-only. Enforced three independent ways: no UPDATE/DELETE policy '
  '(0500), revoked table grants (0500), and a raising trigger (0400).';


-- ---------------------------------------------------------------------------
-- system_settings — singleton
-- ---------------------------------------------------------------------------
-- The `id boolean primary key default true check (id)` idiom makes a second
-- row structurally impossible: the only value that satisfies the CHECK is
-- true, and the PK forbids a duplicate of it.
create table if not exists public.system_settings (
  id                      boolean primary key default true check (id),

  -- Stale Lead Recycling Engine
  stale_recycling_enabled boolean not null default true,
  stale_sla_hours         integer not null default 72
                            check (stale_sla_hours between 1 and 720),

  -- One-click WhatsApp. {{name}} and {{agent}} are substituted client-side.
  whatsapp_template       text not null default
    'Hello {{name}}, this is {{agent}} from Fenlark Technologies. '
    'Thank you for your interest in our digital marketing and web development '
    'services. When would be a good time to connect?',

  -- Keeps distribution fair across separate batches. Without it every batch
  -- restarts at telecaller #1, and the first name in the list quietly
  -- accumulates the heaviest workload over a week.
  round_robin_cursor      integer not null default 0 check (round_robin_cursor >= 0),

  -- "Calls Made Today" must reset at IST midnight, not UTC midnight — a UTC
  -- boundary would roll the counter over at 05:30 IST, mid-shift.
  report_timezone         text not null default 'Asia/Kolkata',

  updated_by              uuid references public.users (id) on delete set null,
  updated_at              timestamptz not null default now()
);

comment on table public.system_settings is
  'Single-row configuration. Read at runtime by the recycling engine, so SLA '
  'changes made in the admin UI take effect on the next tick with no redeploy.';

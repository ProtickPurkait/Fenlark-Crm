-- ============================================================================
-- Fenlark CRM · 0100 — Extensions & Enumerated Types
-- ============================================================================
-- Establishes the vocabulary the rest of the schema is written in. Enums are
-- used instead of `text + CHECK` so that (a) the pipeline is enforced at the
-- type level and (b) Supabase's type generator emits a real TypeScript union
-- for the frontend rather than a bare `string`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

-- gen_random_uuid() is core since PG13, so nothing here depends on pgcrypto —
-- it is installed only so digest()/hmac() are available if webhook signature
-- verification is added later. Wrapped because the `extensions` schema is a
-- Supabase convention that a plain Postgres target will not have.
do $$
begin
  create extension if not exists pgcrypto with schema extensions;
exception
  when others then
    begin
      create extension if not exists pgcrypto;
    exception when others then
      raise notice 'pgcrypto unavailable (%); not required by this schema.', sqlerrm;
    end;
end $$;

-- pg_cron drives the Stale Lead Recycling Engine (migration 0800). It is
-- wrapped defensively: some managed/CI environments do not ship the extension,
-- and a hard failure here would block the entire schema from being created.
-- If it is unavailable the schema still applies cleanly and the recycler can be
-- driven externally via public.admin_run_recycle_now().
do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice
      'pg_cron unavailable (%). Schema will apply, but the stale-lead sweep '
      'must be triggered externally (see README).', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
-- Created idempotently so the file can be replayed against an existing database
-- without erroring (CREATE TYPE has no IF NOT EXISTS).

do $$ begin
  create type public.user_role as enum ('admin', 'telecaller');
exception when duplicate_object then null; end $$;

-- The standardised sales pipeline. Order of declaration is the natural forward
-- progression, which also gives us a free sort order for funnel reporting
-- (enums sort by declaration order, not alphabetically).
do $$ begin
  create type public.lead_status as enum (
    'new',
    'attempted',
    'connected',
    'warm',
    'rescheduled',
    'converted',
    'dead'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_source as enum ('manual', 'csv', 'webhook');
exception when duplicate_object then null; end $$;

-- Every distinct thing that can appear on a lead's timeline.
do $$ begin
  create type public.audit_event as enum (
    'lead_created',
    'assigned',
    'reassigned',
    'unassigned',
    'status_changed',
    'remark_added',
    'reschedule_set',
    'sla_revoked',
    'lead_archived'
  );
exception when duplicate_object then null; end $$;

comment on type public.lead_status is
  'Standardised Fenlark pipeline. Movement is deliberately unrestricted (a lead '
  'may move backwards); the audit trail is what makes reversals accountable.';

comment on type public.audit_event is
  'Discriminator for lead_history_logs. sla_revoked is written only by the '
  'automated recycling engine.';

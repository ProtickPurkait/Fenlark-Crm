-- ============================================================================
-- Test shim — NOT a migration, never applied to a real database.
-- ============================================================================
-- Stands in for the parts of a Supabase database that the migrations depend on
-- (the auth schema, auth.uid(), and the anon/authenticated/service_role roles)
-- so the real migration files can run unmodified against a plain Postgres.
--
-- Deliberately mirrors Supabase's shapes exactly. If Supabase changes
-- auth.uid()'s definition, this is the file that needs updating.
-- ============================================================================

create role anon          nologin;
create role authenticated nologin;
create role service_role  nologin;

grant anon, authenticated, service_role to postgres;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists extensions;
create schema if not exists auth;

create table auth.users (
  id                 uuid primary key,
  instance_id        uuid,
  aud                text,
  role               text,
  email              text,
  encrypted_password text,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  is_sso_user        boolean not null default false,
  is_anonymous       boolean not null default false,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- Matches Supabase's implementation, including missing_ok = true so that an
-- unauthenticated context (such as pg_cron) yields null rather than raising.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to public;

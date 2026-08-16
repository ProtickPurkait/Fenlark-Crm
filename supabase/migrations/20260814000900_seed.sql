-- ============================================================================
-- Fenlark CRM · 0900 — Configuration Seed & Admin Bootstrap
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Singleton settings row. Idempotent: safe to replay.
-- ---------------------------------------------------------------------------
insert into public.system_settings (
  id,
  stale_recycling_enabled,
  stale_sla_hours,
  whatsapp_template,
  round_robin_cursor,
  report_timezone
)
values (
  true,
  true,
  72,
  'Hello {{name}}, this is {{agent}} from Fenlark Technologies. '
  'Thank you for your interest in our digital marketing and web development '
  'services. When would be a good time to connect?',
  0,
  'Asia/Kolkata'
)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- bootstrap_first_admin — resolves the chicken-and-egg problem
-- ---------------------------------------------------------------------------
-- admin_set_user_role() requires an existing admin to call it, and
-- enforce_user_update_rules() blocks self-promotion. So the very first admin
-- cannot be created through the API at all — by design.
--
-- This function is the one-time escape hatch. It refuses to run once any
-- active admin exists, and EXECUTE is revoked from every API-reachable role,
-- so it is usable only from the Supabase SQL editor or a direct psql session.
--
-- Usage: sign the person up through the app first, then run
--     select public.bootstrap_first_admin('you@fenlark.in');
create or replace function public.bootstrap_first_admin(p_email text)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.users;
begin
  if exists (select 1 from public.users where role = 'admin' and is_active) then
    raise exception 'an active admin already exists'
      using hint = 'Use admin_set_user_role() from an admin session instead.';
  end if;

  -- enforce_user_update_rules() would otherwise reject the role change, since
  -- there is no admin in existence to authorise it.
  perform set_config('app.actor_kind', 'system', true);

  update public.users
     set role = 'admin'
   where lower(email) = lower(btrim(p_email))
  returning * into v_row;

  perform set_config('app.actor_kind', 'user', true);

  if v_row.id is null then
    raise exception 'no user found with email %', p_email
      using hint = 'Sign the user up through the app first, then re-run this.';
  end if;

  return v_row;
end $$;

revoke execute on function public.bootstrap_first_admin(text)
  from public, anon, authenticated;

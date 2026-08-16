-- ============================================================================
-- Fenlark CRM · Smoke Test
-- ============================================================================
-- Verifies data isolation, the field-level write guards, audit immutability,
-- duplicate blocking, round-robin fairness and the recycling engine.
--
-- Runs entirely inside one transaction and ROLLS BACK at the end, so it leaves
-- no trace. Deliberately free of psql meta-commands (\echo, \set) so the same
-- file works in psql and in the Supabase SQL editor.
--
-- Run against a local stack:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/smoke.sql
-- or paste the whole file into the Supabase SQL editor.
--
-- Any failure raises and aborts the transaction. A clean run ends with
-- "ALL SMOKE TESTS PASSED".
--
-- Do not run against production: it briefly toggles system_settings, and while
-- the rollback undoes that, a concurrent live sweep could observe the change.
-- ============================================================================

begin;

set local client_min_messages = notice;


-- ---------------------------------------------------------------------------
-- Assertion helpers (created inside the transaction, rolled back with it)
-- ---------------------------------------------------------------------------
-- Results are recorded to a table AND raised as notices, so this file reports
-- itself in any client: psql shows the notices, the Supabase SQL editor and
-- the Node runner read the summary grid printed just before the rollback.
--
-- An identity column rather than serial: identity needs only INSERT on the
-- table, so no separate sequence grant is required for the anon/authenticated
-- roles the test switches into.
create table public.zz_log (
  id     bigint generated always as identity primary key,
  kind   text not null,
  label  text not null,
  detail text
);
grant insert, select on public.zz_log to public;

create or replace function public.zz_section(p_title text)
returns void language plpgsql as $fn$
begin
  insert into public.zz_log (kind, label) values ('section', p_title);
  raise notice '';
  raise notice '--- % ---', p_title;
end $fn$;

create or replace function public.zz_expect(p_condition boolean, p_label text)
returns void language plpgsql as $fn$
begin
  if p_condition is not true then
    raise exception 'FAILED: %', p_label;
  end if;
  insert into public.zz_log (kind, label) values ('ok', p_label);
  raise notice '  ok       %', p_label;
end $fn$;

-- Asserts that a statement is rejected. Used for every negative security test:
-- a silent success here is a security hole, so "it worked" is the failure.
create or replace function public.zz_expect_error(p_sql text, p_label text)
returns void language plpgsql as $fn$
begin
  begin
    execute p_sql;
  exception when others then
    -- The subtransaction opened by EXECUTE has rolled back, but this handler
    -- runs in the outer transaction, so the record persists.
    insert into public.zz_log (kind, label, detail)
      values ('blocked', p_label, replace(sqlerrm, E'\n', ' '));
    raise notice '  blocked  %  [%]', p_label, replace(sqlerrm, E'\n', ' ');
    return;
  end;
  raise exception 'FAILED: %  — statement succeeded but should have been blocked', p_label;
end $fn$;


-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Fixed UUIDs so the script is plain SQL with no client variables and can be
-- pasted anywhere. a1 = admin, c1..c3 = telecallers, d* = leads.

select public.zz_section('0. Fixtures');

-- Permits the role promotion below; reset immediately afterwards.
select set_config('app.actor_kind', 'system', true);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@fenlark.test',  '{}', '{"full_name":"Aditi Admin"}',   now(), now()),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bina@fenlark.test',   '{}', '{"full_name":"Bina Caller"}',   now(), now()),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chetan@fenlark.test', '{}', '{"full_name":"Chetan Caller"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'divya@fenlark.test',  '{}', '{"full_name":"Divya Caller"}',  now(), now());

select public.zz_expect(
  (select count(*) from public.users
    where id in ('00000000-0000-0000-0000-0000000000a1',
                 '00000000-0000-0000-0000-0000000000c1',
                 '00000000-0000-0000-0000-0000000000c2',
                 '00000000-0000-0000-0000-0000000000c3')) = 4,
  'auth.users mirrored into public.users by handle_new_user()');

select public.zz_expect(
  (select full_name from public.users where id = '00000000-0000-0000-0000-0000000000c1')
    = 'Bina Caller',
  'full_name lifted from signup metadata');

update public.users set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';

-- Back to being a normal human actor. Without this the system escape hatch
-- stays open and every guard test below becomes meaningless.
select set_config('app.actor_kind', 'user', true);

insert into public.leads (id, full_name, phone, status, assigned_to, assigned_at, source) values
  ('00000000-0000-0000-0000-0000000000d1', 'Lead One',   '9811100001', 'new',       '00000000-0000-0000-0000-0000000000c1', now(),                        'manual'),
  ('00000000-0000-0000-0000-0000000000d2', 'Lead Two',   '9811100002', 'attempted', '00000000-0000-0000-0000-0000000000c1', now(),                        'manual'),
  ('00000000-0000-0000-0000-0000000000d3', 'Lead Three', '9811100003', 'new',       '00000000-0000-0000-0000-0000000000c2', now(),                        'manual'),
  ('00000000-0000-0000-0000-0000000000d4', 'Lead Four',  '9811100004', 'new',       null,                                   null,                         'manual'),
  -- Stale: 'new' and assigned 100h ago. The only lead the recycler should take.
  ('00000000-0000-0000-0000-0000000000d5', 'Lead Five',  '9811100005', 'new',       '00000000-0000-0000-0000-0000000000c1', now() - interval '100 hours', 'manual'),
  -- Negative control: equally old, but someone actually worked it.
  ('00000000-0000-0000-0000-0000000000d6', 'Lead Six',   '9811100006', 'attempted', '00000000-0000-0000-0000-0000000000c2', now() - interval '100 hours', 'manual'),
  -- Negative control: 'new' but comfortably inside the 72h SLA. Two hours, not
  -- one: now() is fixed at transaction start, so a lead assigned at exactly
  -- now() - 1h can never satisfy `assigned_at < now() - 1h` later in the same
  -- transaction, and the SLA-tightening test at the end would assert nothing.
  ('00000000-0000-0000-0000-0000000000d7', 'Lead Seven', '9811100007', 'new',       '00000000-0000-0000-0000-0000000000c3', now() - interval '2 hours',   'manual');

select public.zz_expect(
  (select assigned_at from public.leads where id = '00000000-0000-0000-0000-0000000000d5')
    < now() - interval '99 hours',
  'INSERT honours an explicit assigned_at (spreadsheet migration support)');


-- ===========================================================================
select public.zz_section('1. Telecaller data isolation');
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1"}', true);

select public.zz_expect(
  (select count(*) from public.leads) = 3,
  'caller sees exactly their own 3 leads, not all 7');

select public.zz_expect(
  not exists (select 1 from public.leads where id = '00000000-0000-0000-0000-0000000000d3'),
  'another caller''s lead is invisible');

select public.zz_expect(
  not exists (select 1 from public.leads where id = '00000000-0000-0000-0000-0000000000d4'),
  'the unassigned pool is invisible to telecallers');

select public.zz_expect(
  (select count(*) from public.users) = 1,
  'caller sees only their own user row');

select public.zz_expect(
  (select count(*) from public.telecaller_directory) = 4,
  'but can still resolve actor names via telecaller_directory');

-- Migration 1000 (C-3): the full config row is admin-only; telecallers get a
-- two-column projection instead of round_robin_cursor and updated_by.
--
-- Asserted as zero rows, not as an error: admins and telecallers are the same
-- Postgres role, so this has to be enforced by RLS rather than by revoking the
-- grant — and an RLS-filtered SELECT returns an empty set, it does not raise.
select public.zz_expect(
  (select count(*) from public.system_settings) = 0,
  'caller sees no rows in the full system_settings table');

select public.zz_expect(
  (select length(whatsapp_template) > 0 from public.app_settings),
  'caller can still read the WhatsApp template via app_settings');

-- Regression guard for that same change: lead_queue is security_invoker, so
-- locking system_settings down would have silently nulled this column for
-- every telecaller and killed the "returns to pool in Nh" warning — with no
-- error to notice. d5 is 'new' and 100h into a 72h SLA, so it reads 0.
select public.zz_expect(
  (select sla_hours_remaining is not null from public.lead_queue
    where id = '00000000-0000-0000-0000-0000000000d5'),
  'SLA countdown still resolves for telecallers after the settings lockdown');


-- ===========================================================================
select public.zz_section('2. Write guards');
-- ===========================================================================

select public.zz_expect_error(
  $q$update public.leads
        set assigned_to = '00000000-0000-0000-0000-0000000000c2'
      where id = '00000000-0000-0000-0000-0000000000d1'$q$,
  'caller cannot hand a lead to another caller');

select public.zz_expect_error(
  $q$update public.leads
        set assigned_to = '00000000-0000-0000-0000-0000000000c1'
      where id = '00000000-0000-0000-0000-0000000000d3'$q$,
  'caller cannot claim a lead that is not theirs');

reset role;
select public.zz_expect(
  (select assigned_to from public.leads where id = '00000000-0000-0000-0000-0000000000d3')
    = '00000000-0000-0000-0000-0000000000c2',
  'attempt to claim another caller''s lead leaves it untouched');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1"}', true);

-- Migration 1000 (C-1). Before it, these three succeeded: a telecaller could
-- write straight to the table and skip log_call_interaction's remark
-- requirement and future-date check entirely, letting them mark leads
-- converted with no explanation or zero out their own overdue counter.
select public.zz_expect_error(
  $q$update public.leads set status = 'converted'
      where id = '00000000-0000-0000-0000-0000000000d1'$q$,
  'caller cannot set status by direct table write (must use the RPC)');

select public.zz_expect_error(
  $q$update public.leads set scheduled_at = now() + interval '10 years'
      where id = '00000000-0000-0000-0000-0000000000d1'$q$,
  'caller cannot move their own follow-up date to hide an overdue lead');

select public.zz_expect_error(
  $q$update public.leads set last_remark = 'forged'
      where id = '00000000-0000-0000-0000-0000000000d1'$q$,
  'caller cannot write a remark without an audit entry');

select public.zz_expect_error(
  $q$insert into public.leads (full_name, phone) values ('Self Serve', '9700000001')$q$,
  'caller cannot insert leads');

select public.zz_expect_error(
  $q$update public.leads set phone = '9999999999'
      where id = '00000000-0000-0000-0000-0000000000d1'$q$,
  'caller cannot rewrite the phone number (would break the dedupe key)');

-- Must be a value that differs from the current one: the guard compares
-- old/new, so writing the existing value back is a no-op and is correctly
-- allowed through.
select public.zz_expect_error(
  $q$update public.leads set sla_revoked_count = 99
      where id = '00000000-0000-0000-0000-0000000000d1'$q$,
  'caller cannot tamper with the SLA revocation counter');

select public.zz_expect_error(
  $q$update public.leads set deleted_at = now()
      where id = '00000000-0000-0000-0000-0000000000d1'$q$,
  'caller cannot archive a lead');

select public.zz_expect_error(
  $q$update public.users set role = 'admin'
      where id = '00000000-0000-0000-0000-0000000000c1'$q$,
  'caller cannot self-promote to admin');

select public.zz_expect_error(
  $q$delete from public.leads where id = '00000000-0000-0000-0000-0000000000d1'$q$,
  'DELETE on leads is not granted to anyone');

select public.zz_expect_error(
  $q$select public.admin_assign_leads(
       array['00000000-0000-0000-0000-0000000000d4']::uuid[],
       '00000000-0000-0000-0000-0000000000c1')$q$,
  'caller cannot invoke an admin RPC');

select public.zz_expect_error(
  $q$select public.admin_run_recycle_now()$q$,
  'caller cannot trigger the recycling engine');


-- ===========================================================================
select public.zz_section('3. Call logging and audit completeness');
-- ===========================================================================

select public.log_call_interaction(
  '00000000-0000-0000-0000-0000000000d1',
  'connected',
  'Discussed website redesign scope. Sending proposal.',
  null);

select public.zz_expect(
  (select status from public.leads where id = '00000000-0000-0000-0000-0000000000d1') = 'connected',
  'status advanced to connected');

select public.zz_expect(
  (select last_contacted_at is not null from public.leads
    where id = '00000000-0000-0000-0000-0000000000d1'),
  'last_contacted_at stamped');

select public.zz_expect(
  exists (select 1 from public.lead_history_logs
           where lead_id = '00000000-0000-0000-0000-0000000000d1'
             and event_type = 'status_changed'
             and from_status = 'new' and to_status = 'connected'
             and actor_id = '00000000-0000-0000-0000-0000000000c1'),
  'audit: status_changed logged with correct actor and transition');

select public.zz_expect(
  exists (select 1 from public.lead_history_logs
           where lead_id = '00000000-0000-0000-0000-0000000000d1'
             and event_type = 'remark_added'
             and remark like 'Discussed website redesign%'),
  'audit: remark_added logged');

select public.zz_expect(
  (select count(*) from public.lead_history_logs
    where lead_id = '00000000-0000-0000-0000-0000000000d1'
      and event_type = 'remark_added') = 1,
  'audit: remark logged exactly once, not duplicated by the trigger');

select public.zz_expect_error(
  $q$select public.log_call_interaction(
       '00000000-0000-0000-0000-0000000000d3', 'connected', 'Poaching attempt', null)$q$,
  'RPC re-checks ownership: cannot log against another caller''s lead');

select public.zz_expect_error(
  $q$select public.log_call_interaction(
       '00000000-0000-0000-0000-0000000000d2', 'connected', '   ', null)$q$,
  'an empty remark is rejected');

select public.zz_expect_error(
  $q$select public.log_call_interaction(
       '00000000-0000-0000-0000-0000000000d2', 'rescheduled', 'Call back later', null)$q$,
  'Rescheduled without a follow-up date is rejected');

select public.zz_expect_error(
  $q$select public.log_call_interaction(
       '00000000-0000-0000-0000-0000000000d2', 'rescheduled', 'Call back later',
       now() - interval '1 day')$q$,
  'Rescheduled with a date in the past is rejected');

select public.log_call_interaction(
  '00000000-0000-0000-0000-0000000000d2', 'rescheduled', 'Asked for a callback Friday',
  now() + interval '2 days');

select public.zz_expect(
  (select follow_up_bucket from public.lead_queue
    where id = '00000000-0000-0000-0000-0000000000d2') = 'scheduled',
  'lead_queue buckets a future follow-up as scheduled');

select public.zz_expect(
  (select calls_made_today from public.my_dashboard_stats()) = 2,
  'my_dashboard_stats counts both logged calls');

select public.zz_expect(
  (select followups_pending from public.my_dashboard_stats()) = 1,
  'my_dashboard_stats counts the pending follow-up');

select public.zz_expect(
  (select untouched_new from public.my_dashboard_stats()) = 1,
  'my_dashboard_stats surfaces the untouched new lead burning its SLA');


-- ===========================================================================
select public.zz_section('4. Audit trail immutability');
-- ===========================================================================

reset role;

-- Attempted as the table owner, which is the strongest form of the claim: an
-- audit trail an admin can quietly edit is not an audit trail.
select public.zz_expect_error(
  $q$update public.lead_history_logs set remark = 'tampered'
      where id = (select min(id) from public.lead_history_logs)$q$,
  'UPDATE on the audit trail is blocked even for the table owner');

select public.zz_expect_error(
  $q$delete from public.lead_history_logs
      where id = (select min(id) from public.lead_history_logs)$q$,
  'DELETE on the audit trail is blocked even for the table owner');

select public.zz_expect_error(
  $q$truncate public.lead_history_logs$q$,
  'TRUNCATE on the audit trail is blocked');


-- ===========================================================================
select public.zz_section('5. Duplicate blocking');
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);

select public.zz_expect(
  public.normalize_phone('+91 98765 43210') = '9876543210'
  and public.normalize_phone('098765-43210') = '9876543210'
  and public.normalize_phone('9876543210')   = '9876543210',
  'normalize_phone canonicalises +91, leading-0 and bare formats identically');

select public.zz_expect(
  (select inserted from public.admin_import_leads(
    '[{"full_name":"Dup Test","phone":"9876543210"},
      {"full_name":"Dup Test","phone":"+91 98765 43210"},
      {"full_name":"Dup Test","phone":"098765-43210"}]'::jsonb)) = 1,
  'three formats of one number import as a single lead');

select public.zz_expect(
  (select inserted from public.admin_import_leads(
    '[{"full_name":"Dup Test","phone":"91 9876543210"}]'::jsonb)) = 0,
  're-importing an existing number inserts nothing');

select public.zz_expect(
  (select skipped_invalid from public.admin_import_leads(
    '[{"full_name":"","phone":"9811100099"},
      {"full_name":"No Phone","phone":""},
      {"full_name":"Too Short","phone":"12"}]'::jsonb)) = 3,
  'rows missing a name or carrying an unusable phone are reported as invalid');


-- ===========================================================================
select public.zz_section('6. Round-robin distribution');
-- ===========================================================================

reset role;

-- Sequential ids so `order by created_at, id` is deterministic.
insert into public.leads (id, full_name, phone, source)
select
  ('00000000-0000-0000-0000-0000000000' || to_hex(16 + g))::uuid,
  'RR Lead ' || g,
  '90000000' || lpad(g::text, 2, '0'),
  'csv'
from generate_series(0, 9) g;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);

select public.zz_expect(
  (select array_agg(assigned_count order by full_name)
     from public.admin_round_robin_assign(
       (select array_agg(id) from public.leads where full_name like 'RR Lead %'),
       array['00000000-0000-0000-0000-0000000000c1',
             '00000000-0000-0000-0000-0000000000c2',
             '00000000-0000-0000-0000-0000000000c3']::uuid[]
     )) = array[4, 3, 3],
  '10 leads across 3 callers distribute 4 / 3 / 3');

select public.zz_expect(
  (select round_robin_cursor from public.system_settings) = 1,
  'cursor advanced to 1 after a batch of 10 across 3 callers');

reset role;
insert into public.leads (id, full_name, phone, source)
select
  ('00000000-0000-0000-0000-0000000000' || to_hex(32 + g))::uuid,
  'RR2 Lead ' || g,
  '90000010' || lpad(g::text, 2, '0'),
  'csv'
from generate_series(0, 2) g;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);

select public.admin_round_robin_assign(
  (select array_agg(id) from public.leads where full_name like 'RR2 Lead %'),
  array['00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-0000000000c3']::uuid[]);

-- The fairness claim: without the persisted cursor this lead would go back to
-- Bina, and the alphabetically-first caller would head every single batch.
select public.zz_expect(
  (select assigned_to from public.leads where full_name = 'RR2 Lead 0')
    = '00000000-0000-0000-0000-0000000000c2',
  'second batch resumes at Chetan rather than restarting at Bina');

select public.zz_expect_error(
  $q$select public.admin_round_robin_assign(
       array['00000000-0000-0000-0000-0000000000d4']::uuid[],
       array[]::uuid[])$q$,
  'round-robin with no active telecallers errors instead of dividing by zero');


-- ===========================================================================
select public.zz_section('7. Stale lead recycling engine');
-- ===========================================================================

-- Feature toggle OFF: the sweep must be a no-op.
select public.admin_update_settings(p_enabled => false);

select public.zz_expect(
  public.admin_run_recycle_now() = 0,
  'recycler returns 0 while disabled');

select public.zz_expect(
  (select assigned_to from public.leads where id = '00000000-0000-0000-0000-0000000000d5')
    = '00000000-0000-0000-0000-0000000000c1',
  'the stale lead is untouched while the feature is off');

-- Feature toggle ON.
select public.admin_update_settings(p_enabled => true, p_sla_hours => 72);

select public.zz_expect(
  public.admin_run_recycle_now() = 1,
  'exactly one lead breaches the 72h SLA');

select public.zz_expect(
  (select assigned_to is null and assigned_at is null and sla_revoked_count = 1
     from public.leads where id = '00000000-0000-0000-0000-0000000000d5'),
  'breaching lead returned to the pool with its counter incremented');

select public.zz_expect(
  exists (select 1 from public.lead_history_logs
           where lead_id = '00000000-0000-0000-0000-0000000000d5'
             and event_type = 'sla_revoked'
             and actor_kind = 'system'
             and actor_id is null
             and from_assignee = '00000000-0000-0000-0000-0000000000c1'
             and note = 'System revoked assignment due to SLA breach.'),
  'audit: sla_revoked logged as system with the exact required wording');

-- Negative controls.
select public.zz_expect(
  (select assigned_to from public.leads where id = '00000000-0000-0000-0000-0000000000d6')
    = '00000000-0000-0000-0000-0000000000c2',
  'a 100h-old lead that was actually worked (attempted) is NOT recycled');

select public.zz_expect(
  (select assigned_to from public.leads where id = '00000000-0000-0000-0000-0000000000d7')
    = '00000000-0000-0000-0000-0000000000c3',
  'a new lead inside the SLA window is NOT recycled');

select public.zz_expect(
  (select count(*) from public.leads where full_name like 'RR%' and assigned_to is null) = 0,
  'leads assigned moments ago are NOT recycled');

-- SLA is read at runtime, so tightening it takes effect on the next sweep with
-- no migration and no redeploy.
select public.admin_update_settings(p_sla_hours => 1);

select public.zz_expect(
  public.admin_run_recycle_now() >= 1,
  'lowering the SLA to 1h immediately widens the sweep on the next run');

select public.zz_expect_error(
  $q$select public.admin_update_settings(p_sla_hours => 0)$q$,
  'an out-of-range SLA value is rejected');


-- ===========================================================================
select public.zz_section('8. Call session tracking');
-- ===========================================================================

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1"}', true);

-- Bina starts a call on her own lead.
select public.start_call_session('00000000-0000-0000-0000-0000000000d1');

select public.zz_expect(
  (select count(*) from public.call_sessions
    where caller_id = '00000000-0000-0000-0000-0000000000c1' and ended_at is null) = 1,
  'starting a call opens exactly one active session');

select public.zz_expect_error(
  $q$select public.start_call_session('00000000-0000-0000-0000-0000000000d3')$q$,
  'caller cannot start a call on a lead assigned to someone else');

-- Same protection as leads: the RPC is the only write path.
select public.zz_expect_error(
  $q$insert into public.call_sessions (lead_id, caller_id)
     values ('00000000-0000-0000-0000-0000000000d1',
             '00000000-0000-0000-0000-0000000000c1')$q$,
  'caller cannot insert a call session directly');

select public.zz_expect_error(
  $q$update public.call_sessions set duration_seconds = 99999
      where caller_id = '00000000-0000-0000-0000-0000000000c1'$q$,
  'caller cannot inflate their own talk time by direct write');

-- Starting a second call closes the first rather than tripping the unique
-- index — switching leads mid-session is normal behaviour, not an error.
select public.start_call_session('00000000-0000-0000-0000-0000000000d2');

select public.zz_expect(
  (select count(*) from public.call_sessions
    where caller_id = '00000000-0000-0000-0000-0000000000c1' and ended_at is null) = 1,
  'starting a second call supersedes the first, never two active at once');

select public.zz_expect(
  (select ended_reason from public.call_sessions
    where lead_id = '00000000-0000-0000-0000-0000000000d1'
      and caller_id = '00000000-0000-0000-0000-0000000000c1') = 'superseded',
  'the superseded session is closed and labelled as such');

-- Ending with a client-measured duration.
select public.end_call_session(
  (select id from public.call_sessions
    where caller_id = '00000000-0000-0000-0000-0000000000c1' and ended_at is null),
  137);

select public.zz_expect(
  (select duration_seconds from public.call_sessions
    where lead_id = '00000000-0000-0000-0000-0000000000d2'
      and caller_id = '00000000-0000-0000-0000-0000000000c1') = 137,
  'the client-measured duration is what gets stored');

-- Idempotency: the client fires this from both a visibilitychange handler and
-- an explicit End Call tap, so a second call must not raise or overwrite.
select public.end_call_session(
  (select id from public.call_sessions where lead_id = '00000000-0000-0000-0000-0000000000d2'),
  999);

select public.zz_expect(
  (select duration_seconds from public.call_sessions
    where lead_id = '00000000-0000-0000-0000-0000000000d2') = 137,
  'ending an already-ended session is a no-op, not an overwrite');

-- An implausible duration is discarded rather than poisoning the averages.
select public.start_call_session('00000000-0000-0000-0000-0000000000d1');
select public.end_call_session(
  (select id from public.call_sessions
    where caller_id = '00000000-0000-0000-0000-0000000000c1' and ended_at is null),
  50000);

select public.zz_expect(
  (select duration_seconds from public.call_sessions
    where caller_id = '00000000-0000-0000-0000-0000000000c1'
    order by started_at desc limit 1) is null,
  'an absurd duration (app left backgrounded overnight) is stored as null');

-- Isolation: Chetan must not see Bina's calls.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2"}', true);

select public.zz_expect(
  (select count(*) from public.call_sessions
    where caller_id = '00000000-0000-0000-0000-0000000000c1') = 0,
  'a caller cannot see another caller''s call sessions');

select public.zz_expect_error(
  $q$select public.admin_call_activity()$q$,
  'a telecaller cannot read the live calls panel');

-- The sweep closes sessions the app never reported back on.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2"}', true);
select public.start_call_session('00000000-0000-0000-0000-0000000000d3');

reset role;
update public.call_sessions
   set started_at = now() - interval '5 hours'
 where caller_id = '00000000-0000-0000-0000-0000000000c2' and ended_at is null;

select public.zz_expect(
  public.sweep_abandoned_calls(120) = 1,
  'the sweep closes exactly the one abandoned session');

select public.zz_expect(
  (select ended_reason from public.call_sessions
    where caller_id = '00000000-0000-0000-0000-0000000000c2'
    order by started_at desc limit 1) = 'sweep'
  and (select duration_seconds from public.call_sessions
    where caller_id = '00000000-0000-0000-0000-0000000000c2'
    order by started_at desc limit 1) is null,
  'a swept session has a null duration — unknown, not zero');

-- Admin reporting excludes swept sessions from talk time.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);

select public.zz_expect(
  (select (elem ->> 'talk_seconds')::int
     from jsonb_array_elements(
            (select stats from public.admin_call_activity())) elem
    where elem ->> 'caller_id' = '00000000-0000-0000-0000-0000000000c1') = 137,
  'talk time counts the real call only, ignoring nulled and superseded rows');

select public.zz_expect(
  jsonb_array_length((select active from public.admin_call_activity())) = 0,
  'admin_call_activity reports no active calls once everything is ended or swept');

reset role;


-- ===========================================================================
select public.zz_section('9. User deletion vs the append-only audit trail');
-- ===========================================================================

reset role;

-- Regression guard for the bug fixed in migration 1200: deleting a telecaller
-- who had ever been assigned a lead used to fail outright. The FK action
-- (on delete set null) is an UPDATE on lead_history_logs, and the append-only
-- trigger rejected every UPDATE — so the FK and the guard deadlocked and the
-- delete died. Divya has assignment history from the fixtures.
select public.zz_expect(
  (select count(*) from public.lead_history_logs
    where to_assignee = '00000000-0000-0000-0000-0000000000c3') > 0,
  'the caller about to be deleted has audit history referencing them');

delete from auth.users where id = '00000000-0000-0000-0000-0000000000c3';

select public.zz_expect(
  (select count(*) from public.users
    where id = '00000000-0000-0000-0000-0000000000c3') = 0,
  'a telecaller with audit history can actually be deleted');

select public.zz_expect(
  (select count(*) from public.lead_history_logs
    where to_assignee = '00000000-0000-0000-0000-0000000000c3') = 0,
  'their assignee references were nulled rather than blocking the delete');

-- The entries themselves must survive — that is the entire point of the
-- on-delete-set-null design.
select public.zz_expect(
  (select count(*) from public.lead_history_logs
    where lead_id = '00000000-0000-0000-0000-0000000000d7') > 0,
  'the audit entries themselves survive the deletion');

-- The narrowed exception must not have opened the door to real tampering.
select public.zz_expect_error(
  $q$update public.lead_history_logs set remark = 'rewritten' where id =
      (select min(id) from public.lead_history_logs)$q$,
  'editing a remark on the audit trail is still rejected');

select public.zz_expect_error(
  $q$update public.lead_history_logs set to_status = 'converted' where id =
      (select min(id) from public.lead_history_logs)$q$,
  'editing a status on the audit trail is still rejected');

select public.zz_expect_error(
  $q$update public.lead_history_logs
        set actor_id = '00000000-0000-0000-0000-0000000000c2'
      where id = (select min(id) from public.lead_history_logs
                   where actor_id = '00000000-0000-0000-0000-0000000000c1')$q$,
  're-attributing an entry to a different user is still rejected');

select public.zz_expect_error(
  $q$delete from public.lead_history_logs where id =
      (select min(id) from public.lead_history_logs)$q$,
  'deleting an audit entry is still rejected');


-- ===========================================================================
select public.zz_section('10. Sales & commission');
-- ===========================================================================

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1"}', true);

-- d1 is Bina's (c1) lead, currently 'connected' from section 3 — logging a
-- sale against a non-'new' lead is the realistic case and doubles as the
-- auto-convert check.
select public.caller_log_sale('00000000-0000-0000-0000-0000000000d1', 'Paid via UPI, confirmed on call.');

select public.zz_expect(
  (select status from public.leads where id = '00000000-0000-0000-0000-0000000000d1') = 'converted',
  'logging a sale flips the lead to converted');

select public.zz_expect(
  (select status = 'pending' and commission_amount = 500 and telecaller_id = '00000000-0000-0000-0000-0000000000c1'
     from public.sales where lead_id = '00000000-0000-0000-0000-0000000000d1'),
  'the sale is recorded pending at the standard 500 commission');

select public.zz_expect_error(
  $q$select public.caller_log_sale('00000000-0000-0000-0000-0000000000d3', 'Poaching attempt')$q$,
  'caller cannot log a sale for a lead assigned to someone else');

select public.zz_expect_error(
  $q$select public.caller_log_sale('00000000-0000-0000-0000-0000000000d1', 'Trying again')$q$,
  'a second sale cannot be logged while one is already pending for the same lead');

-- A second, independent sale to exercise the reject path separately from d1's
-- approve path below.
select public.caller_log_sale('00000000-0000-0000-0000-0000000000d2', null);

select public.zz_expect_error(
  $q$select public.admin_approve_sale(
       (select id from public.sales where lead_id = '00000000-0000-0000-0000-0000000000d1'))$q$,
  'a telecaller cannot approve their own sale');

select public.zz_expect_error(
  $q$select public.admin_reject_sale(
       (select id from public.sales where lead_id = '00000000-0000-0000-0000-0000000000d2'), 'no')$q$,
  'a telecaller cannot reject a sale either');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);

select public.admin_approve_sale(
  (select id from public.sales where lead_id = '00000000-0000-0000-0000-0000000000d1'));

select public.zz_expect(
  (select status = 'approved' and reviewed_at is not null and reviewed_by = '00000000-0000-0000-0000-0000000000a1'
     from public.sales where lead_id = '00000000-0000-0000-0000-0000000000d1'),
  'admin_approve_sale approves and stamps the reviewer and timestamp');

select public.zz_expect_error(
  $q$select public.admin_approve_sale(
       (select id from public.sales where lead_id = '00000000-0000-0000-0000-0000000000d1'))$q$,
  'approving an already-reviewed sale is rejected, not silently re-applied');

select public.zz_expect_error(
  $q$select public.admin_reject_sale(
       (select id from public.sales where lead_id = '00000000-0000-0000-0000-0000000000d2'), '   ')$q$,
  'rejecting requires a non-empty reason');

select public.admin_reject_sale(
  (select id from public.sales where lead_id = '00000000-0000-0000-0000-0000000000d2'),
  'Customer denied placing this order.');

select public.zz_expect(
  (select status = 'rejected' and rejection_reason = 'Customer denied placing this order.'
     from public.sales where lead_id = '00000000-0000-0000-0000-0000000000d2'),
  'admin_reject_sale records the rejection reason');

-- Immutability: once reviewed, nothing but acknowledged_at may change again.
-- Attempted here as the table owner (reset role), the strongest form of the
-- claim — same reasoning as the lead_history_logs immutability checks above:
-- the trigger itself blocks this, not merely the revoked authenticated grant.
reset role;

select public.zz_expect_error(
  $q$update public.sales set rejection_reason = 'rewritten'
      where lead_id = '00000000-0000-0000-0000-0000000000d2'$q$,
  'a reviewed sale''s rejection_reason cannot be edited afterwards');

select public.zz_expect_error(
  $q$update public.sales set commission_amount = 0
      where lead_id = '00000000-0000-0000-0000-0000000000d1'$q$,
  'a reviewed sale''s commission amount is locked');

select public.zz_expect_error(
  $q$update public.sales set status = 'pending'
      where lead_id = '00000000-0000-0000-0000-0000000000d1'$q$,
  'a reviewed sale cannot be reverted to pending');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1"}', true);

-- The one column the immutability guard still permits post-review — this is
-- the rejection bell's "dismiss" action.
select public.caller_acknowledge_sale(
  (select id from public.sales where lead_id = '00000000-0000-0000-0000-0000000000d2'));

select public.zz_expect(
  (select acknowledged_at is not null from public.sales
    where lead_id = '00000000-0000-0000-0000-0000000000d2'),
  'acknowledging a rejection is permitted even though the row is locked');

select public.zz_expect(
  (select balance = 500 and approved_count = 1 and pending_count = 0 and unseen_rejections = 0
     from public.my_wallet_summary()),
  'my_wallet_summary reflects one approved 500 commission and zero unseen rejections');

reset role;


-- ===========================================================================
select public.zz_section('11. Anonymous access');
-- ===========================================================================

reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

select public.zz_expect_error(
  $q$select count(*) from public.leads$q$,
  'anon has no access to leads');

select public.zz_expect_error(
  $q$select count(*) from public.lead_history_logs$q$,
  'anon has no access to the audit trail');

select public.zz_expect_error(
  $q$select count(*) from public.call_sessions$q$,
  'anon has no access to call sessions');

select public.zz_expect_error(
  $q$select count(*) from public.sales$q$,
  'anon has no access to sales');

reset role;


-- ---------------------------------------------------------------------------
do $$
begin
  raise notice '';
  raise notice '==========================================';
  raise notice ' ALL SMOKE TESTS PASSED';
  raise notice '==========================================';
end $$;

-- Final result set. Reaching this line at all means every assertion passed —
-- any failure raises and aborts the transaction before it. The grid is here so
-- the Supabase SQL editor (which does not display notices) still shows what ran.
select kind, label, detail from public.zz_log order by id;
-- ---------------------------------------------------------------------------

rollback;

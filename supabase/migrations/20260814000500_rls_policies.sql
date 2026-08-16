-- ============================================================================
-- Fenlark CRM · 0500 — Row Level Security
-- ============================================================================
-- Data isolation lives here, in Postgres — not in React. A leaked anon key, a
-- hand-rolled fetch() against the REST endpoint, or a bug in a server component
-- still cannot walk the lead table.
--
-- Deliberate omission: ENABLE, not FORCE.
-- FORCE ROW LEVEL SECURITY would subject the table *owner* to RLS as well, and
-- the audit trigger in 0400 runs SECURITY DEFINER as that owner. Under FORCE it
-- would need an INSERT policy on lead_history_logs — and any policy permissive
-- enough for the trigger would also be usable by clients to forge log entries.
-- Plain ENABLE keeps the trigger working while clients stay fully governed.
-- ============================================================================

alter table public.users              enable row level security;
alter table public.leads              enable row level security;
alter table public.lead_history_logs  enable row level security;
alter table public.system_settings    enable row level security;


-- ---------------------------------------------------------------------------
-- Table grants
-- ---------------------------------------------------------------------------
-- RLS filters rows, but only among the operations a role is granted at all.
-- Removing DELETE at the grant level means no policy mistake can ever expose
-- deletion to a client.

revoke all on public.users             from anon, authenticated;
revoke all on public.leads             from anon, authenticated;
revoke all on public.lead_history_logs from anon, authenticated;
revoke all on public.system_settings   from anon, authenticated;

grant select, insert, update on public.users            to authenticated;
grant select, insert, update on public.leads            to authenticated;
grant select                 on public.lead_history_logs to authenticated;
grant select, update         on public.system_settings  to authenticated;

-- anon (pre-login) gets nothing at all.


-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists users_insert_admin on public.users;
create policy users_insert_admin on public.users
  for insert to authenticated
  with check (public.is_admin());

-- Self-service profile edits are allowed; the guard trigger in 0300 freezes
-- role, is_active and email so this cannot become a privilege escalation.
drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update to authenticated
  using      (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- No DELETE policy. Deactivate via is_active instead — deleting a user would
-- null out their actor_id across the audit trail.


-- ---------------------------------------------------------------------------
-- leads — the core isolation guarantee
-- ---------------------------------------------------------------------------
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (
    public.is_admin()
    or (assigned_to = auth.uid() and deleted_at is null)
  );

drop policy if exists leads_insert_admin on public.leads;
create policy leads_insert_admin on public.leads
  for insert to authenticated
  with check (public.is_admin());

-- USING gates which rows may be targeted; WITH CHECK gates the row's state
-- *after* the write. Both are required.
--
-- With USING alone, a telecaller could run
--     update leads set assigned_to = '<another caller>' where id = '<mine>';
-- The pre-image passes (they own it), the row is written, and the lead is gone
-- from their queue — an unlogged transfer they had no right to make. WITH CHECK
-- rejects the post-image. The guard trigger in 0300 rejects it a second time.
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to authenticated
  using      (public.is_admin() or (assigned_to = auth.uid() and deleted_at is null))
  with check (public.is_admin() or (assigned_to = auth.uid() and deleted_at is null));

-- No DELETE policy, and DELETE is not granted. Archival is admin_archive_lead().


-- ---------------------------------------------------------------------------
-- lead_history_logs
-- ---------------------------------------------------------------------------
-- SELECT only. There is no INSERT policy by design (see the header note): the
-- audit trigger writes as owner and bypasses RLS entirely.
drop policy if exists logs_select on public.lead_history_logs;
create policy logs_select on public.lead_history_logs
  for select to authenticated
  using (public.is_admin() or public.owns_lead(lead_id));


-- ---------------------------------------------------------------------------
-- system_settings
-- ---------------------------------------------------------------------------
-- Readable by everyone: telecallers need whatsapp_template and report_timezone.
drop policy if exists settings_select on public.system_settings;
create policy settings_select on public.system_settings
  for select to authenticated
  using (true);

drop policy if exists settings_update_admin on public.system_settings;
create policy settings_update_admin on public.system_settings
  for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());


-- ---------------------------------------------------------------------------
-- telecaller_directory
-- ---------------------------------------------------------------------------
-- Telecallers must render actor names on a lead's audit timeline, but the
-- users policy above deliberately hides other users' rows (which carry email
-- and phone). Postgres has no column-level RLS, so a view owned by the schema
-- owner provides column-level exposure instead: id, name and status only.
create or replace view public.telecaller_directory
with (security_invoker = false) as
  select u.id, u.full_name, u.role, u.is_active
  from public.users u;

revoke all on public.telecaller_directory from anon, authenticated;
grant select on public.telecaller_directory to authenticated;

comment on view public.telecaller_directory is
  'Name-only projection of public.users. security_invoker = false so it runs '
  'with the view owner''s rights, exposing names without exposing contact '
  'details. Join audit-timeline actor_id against this, not against users.';


-- ---------------------------------------------------------------------------
-- Function execution grants
-- ---------------------------------------------------------------------------
-- Revoke from PUBLIC, not from anon: EXECUTE is granted to PUBLIC by default,
-- and revoking from anon alone leaves that blanket grant in place.
revoke execute on function public.is_admin()                      from public;
revoke execute on function public.owns_lead(uuid)                 from public;
revoke execute on function public.normalize_phone(text)           from public;

grant execute on function public.is_admin()                       to authenticated;
grant execute on function public.owns_lead(uuid)                  to authenticated;
grant execute on function public.normalize_phone(text)            to authenticated;

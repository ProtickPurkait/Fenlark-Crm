# Trace

Lead & telecaller pipeline management for Fenlark Technologies LLP.

> The repo directory is still `fenlark-crm/`; only the product name changed.
> Renaming the folder means updating `.claude/launch.json` too.

Lead & Telecaller Project Management CRM for Fenlark Technologies LLP.
Next.js (App Router) + Supabase (Postgres, RLS, `pg_cron`).

Two layers:

- **Database** (`supabase/`) — schema, Row Level Security, the immutable audit
  trail, the full admin/telecaller RPC surface, and the Stale Lead Recycling
  Engine. See [Design in one page](#design-in-one-page) below.
- **App** (`src/`) — auth, role-based routing, the telecaller queue +
  disposition drawer, and all four admin screens (dashboard, leads with CSV
  import + assignment, telecallers, settings) are built and verified against
  the live project — see [App layer](#app-layer).

The app never writes to tables directly — every mutation goes through an RPC
(see [RPC surface](#rpc-surface)), so validation and audit logging can't be
bypassed by a client-side bug.

---

## Design in one page

**Isolation lives in Postgres, not in React.** Every restriction is enforced by
RLS policies and triggers, so a leaked anon key, a hand-rolled `fetch` against
the REST endpoint, or a bug in a server component still cannot walk the lead
table.

**The audit trail cannot be edited.** `lead_history_logs` rejects `UPDATE`,
`DELETE` and `TRUNCATE` for everyone including the table owner. Corrections are
made by appending, never by rewriting. This is what makes "who did what, even if
a status is reversed months later" true rather than aspirational.

**There is no unaudited write path.** All lead mutations pass through a single
`AFTER` trigger that writes the timeline. The recycling engine writes no log
entries of its own — it performs an ordinary `UPDATE` and lets the same trigger
record it, so the system trail and the human trail can never drift apart.

**The SLA clock cannot be backdated.** `leads.assigned_at` is owned by a trigger.
An `INSERT` may supply it (so an existing spreadsheet can be migrated with its
history), but no `UPDATE` by any role can ever move it again.

**The recycler runs without the app.** `pg_cron` executes the sweep inside
Postgres every 15 minutes. If Vercel is down or a deploy is broken, stale leads
still return to the pool.

---

## Layout

```
dist/
└── all_migrations.sql                         generated one-paste deploy artifact
scripts/
├── test.mjs                                   npm test — no Docker
├── bundle.mjs                                 npm run bundle
└── pglite-shim.sql                            test-only auth/roles stand-in
supabase/
├── config.toml
├── migrations/
│   ├── 20260814000100_extensions_enums.sql    enums, pg_cron
│   ├── 20260814000200_tables.sql              4 tables, indexes, phone normalisation
│   ├── 20260814000300_helpers_guards.sql      is_admin(), field-level write guards
│   ├── 20260814000400_audit_triggers.sql      the immutable trail
│   ├── 20260814000500_rls_policies.sql        RLS + grants
│   ├── 20260814000600_rpc_admin.sql           import, assign, round-robin, settings
│   ├── 20260814000700_rpc_caller.sql          call logging, dashboard, queue view
│   ├── 20260814000800_recycling_engine.sql    SLA sweep + cron schedule
│   └── 20260814000900_seed.sql                settings row + admin bootstrap
└── tests/
    └── smoke.sql                              53 assertions, rolls back
```

Requires PostgreSQL 15 or newer (`security_invoker` views).

---

## Security model

**Clients have no write access to `public.leads` at all.** `INSERT`/`UPDATE`/
`DELETE` are revoked from `authenticated` and `anon` (migration `1000`). Every
write goes through a `SECURITY DEFINER` RPC that executes as the table owner.

This was not the original design, and the reason it changed is worth keeping in
mind when adding features: RLS answered *"is this row yours?"*, which was true
and sufficient for isolation — a telecaller could never touch someone else's
lead. But owning a row also let them `UPDATE` it directly through PostgREST,
skipping `log_call_interaction` and therefore skipping the remark requirement
and the future-date check. In practice that let a telecaller mark leads
`converted` with no explanation, or push `scheduled_at` into 2099 to zero out
their own overdue counter without logging a single call. **Confirmed
exploitable against the live project before the fix.**

The lesson generalises: *authorisation is not validation*. If you add a table
clients write to, either revoke the grant and expose an RPC, or accept that
every constraint you enforce in the RPC is optional.

Re-check the posture at any time:

```bash
npm run security:probe
```

That asserts `anon` cannot reach any table, view, or privileged RPC. To also
re-test the direct-write bypass, sign in as a telecaller:

```bash
PROBE_EMAIL=someone@fenlark.in PROBE_PASSWORD=... node scripts/security-probe.mjs --write-probe
```

Other guarantees, all covered by `npm run db:test`:

| Guarantee | Enforced by |
|---|---|
| Telecallers see only their own leads | RLS `leads_select` |
| Telecallers cannot reassign, in either direction | RLS `WITH CHECK` + `enforce_lead_update_rules` |
| Audit trail cannot be edited or truncated | `prevent_log_mutation` (fires for the table owner too) |
| SLA clock cannot be backdated | `enforce_lead_update_rules` owns `assigned_at` |
| No unaudited write path | Single `AFTER` trigger on every lead mutation |
| Full config row is admin-only | RLS `settings_select_admin`; telecallers read `app_settings` |
| Recycler is unreachable from the API | `EXECUTE` revoked; runs in-database via `pg_cron` |
| Only an admin may change roles | `enforce_user_update_rules` |

**Not in scope of the above:** the `service_role` key bypasses RLS by design.
It lives only in `.env.local` (gitignored, no `NEXT_PUBLIC_` prefix) and is
imported only by `src/lib/supabase/admin.ts`, which carries `import
"server-only"` so the bundler throws a build error if a client component ever
reaches it.

## Testing — no Docker required

```bash
npm install && npm test
```

Applies every migration and runs all 53 smoke-test assertions against a real
Postgres in about five seconds. No daemon, no containers, no Supabase CLI —
[PGlite](https://pglite.dev) is Postgres compiled to WASM running inside Node.
`scripts/pglite-shim.sql` supplies the `auth` schema and the
`anon`/`authenticated`/`service_role` roles so the migrations run unmodified.

Two things this cannot cover, both verified by the deploy below:

- **`pg_cron` scheduling.** The extension is absent under PGlite, so migration
  `0800` logs a notice and skips `cron.schedule()`. The function it would call
  is fully exercised through `admin_run_recycle_now()`.
- **The trigger on Supabase's real `auth.users`**, which the shim stands in for.

## Deploying

### Hosted project (recommended)

1. Dashboard → Database → Extensions → enable **pg_cron**.
2. Paste `dist/all_migrations.sql` into the SQL editor and run it. That is all
   nine migrations concatenated in order — regenerate with `npm run bundle`
   after any schema change, and never edit `dist/` by hand.
3. Paste `supabase/tests/smoke.sql` and run it. It rolls itself back and prints
   a grid of every assertion.
4. Confirm the sweep registered — this is the check PGlite cannot do:

```sql
select jobname, schedule, active from cron.job where jobname = 'recycle-stale-leads';
```

### Local Supabase stack (optional)

Only worth it once you need Auth, Storage or PostgREST locally; it is not
required to work on the schema.

```bash
npx supabase start && npx supabase db reset
```

### Create the first admin

`admin_set_user_role()` needs an existing admin, and the guard trigger blocks
self-promotion — so the first admin cannot be created through the API by design.
Sign the person up through the app, then run this **once** from the SQL editor:

```sql
select public.bootstrap_first_admin('you@fenlark.in');
```

It refuses to run again once any active admin exists.

---

## RPC surface

This is the complete contract for the frontend. Clients should not `INSERT` or
`UPDATE` `public.leads` directly — `log_call_interaction` enforces the remark
requirement and the reschedule validation that a raw `UPDATE` would skip.

### Telecaller

| Function | Purpose |
|---|---|
| `log_call_interaction(lead_id, status, remark, scheduled_at)` | The disposition drawer's single write. Status + remark + reschedule, atomically. |
| `my_dashboard_stats()` | `calls_made_today`, `followups_pending`, `followups_overdue`, `assigned_total`, `untouched_new`. |
| `select * from lead_queue` | RLS-scoped working queue with `follow_up_bucket`, `queue_rank`, `sla_hours_remaining`. |

Order the queue by `queue_rank, scheduled_at nulls last` and Overdue → Due Soon
→ SLA-burning New rises to the top automatically.

### Admin

| Function | Purpose |
|---|---|
| `admin_import_leads(rows jsonb, source)` | CSV/manual/webhook ingest. Returns `inserted`, `skipped_duplicate`, `skipped_invalid`. |
| `admin_assign_leads(lead_ids, user_id)` | Manual assignment. Pass `null` to return leads to the pool. |
| `admin_round_robin_assign(lead_ids, user_ids)` | Even distribution. Returns per-caller counts. |
| `admin_archive_lead(lead_id, reason)` | Soft delete with an audit note. |
| `admin_update_settings(enabled, sla_hours, whatsapp_template)` | Backs the Settings panel. Nulls leave values untouched. |
| `admin_run_recycle_now()` | Manual SLA sweep; returns the number reclaimed. |
| `admin_set_user_role(user_id, role)` / `admin_set_user_active(user_id, active)` | Team management. Refuses to strand the last admin. |

---

## Things that will bite you

**`is_admin()` must stay `SECURITY DEFINER`.** The RLS policy on `public.users`
reads `public.users`. As `SECURITY INVOKER` that re-enters the same policy and
Postgres aborts with *"infinite recursion detected in policy for relation
users"* — the schema will not even come up.

**RLS is `ENABLE`, never `FORCE`.** `FORCE` would subject the table owner to RLS,
and the audit trigger runs `SECURITY DEFINER` as that owner. Under `FORCE` it
would need an `INSERT` policy on `lead_history_logs`, and any policy permissive
enough for the trigger would also let clients forge log entries.

**Field-level rules are a trigger, not column grants.** Admins and telecallers
are both the `authenticated` Postgres role. `GRANT UPDATE (col)` is role-wide, so
locking telecallers out of `phone` would lock admins out too. The trigger
branches on `is_admin()` at runtime; a `GRANT` cannot.

**`lead_id` is not `ON DELETE CASCADE`.** A cascade would trip the immutability
guard and make lead deletion fail confusingly. Leads are soft-deleted via
`deleted_at`; every index and policy already filters on it.

**Changing phone normalisation requires a backfill.** `leads.phone_normalized` is
a `STORED` generated column depending on `public.normalize_phone()`. Editing that
function does **not** recompute existing rows, so the dedupe index silently goes
stale. To change it:

```sql
begin;
alter table public.leads drop column phone_normalized;
create or replace function public.normalize_phone(text) returns text language sql immutable as $$ ... $$;
alter table public.leads add column phone_normalized text generated always as (public.normalize_phone(phone)) stored;
create unique index leads_phone_unique on public.leads (phone_normalized) where deleted_at is null;
commit;
```

The index creation will fail if the new rule merges rows that are currently
distinct — which is the correct outcome. Resolve those duplicates first.

**`lib/phone.ts` must mirror `normalize_phone()` exactly.** The frontend uses it
to warn about duplicates before upload; a mismatch means the UI reports a clean
import and the database silently skips rows.

---

## Recycling engine

Runs every 15 minutes via `pg_cron`. A lead is reclaimed when **all** of:

- `status = 'new'` — a lead that was actually worked is never taken
- `assigned_to is not null`
- `assigned_at < now() - stale_sla_hours`
- `deleted_at is null`

Settings are read at runtime, so changing the SLA or toggling the feature in the
admin UI takes effect on the next tick with no migration and no redeploy. The
`enabled` flag is checked *inside* the function, so the job itself is never
rescheduled.

Reclaimed leads get `assigned_to = null`, an incremented `sla_revoked_count`, and
an audit entry with `actor_kind = 'system'` and the note
`System revoked assignment due to SLA breach.`

Inspect runs:

```sql
select jobname, status, start_time, return_message from cron.job_run_details order by start_time desc limit 20;
```

---

## Pipeline

`new → attempted → connected → warm → rescheduled → converted → dead`

Movement is deliberately unconstrained — a lead may go backwards, because real
sales conversations do. The audit trail is what makes reversals accountable, and
it records every transition with actor and timestamp.

---

## App layer

### Setup

```bash
npm install
```

Copy `.env.local.example` → `.env.local` and fill in from Dashboard → Settings
→ API: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the
publishable key), and `SUPABASE_SERVICE_ROLE_KEY` (the secret key — server-only,
see the security note in `src/lib/supabase/admin.ts`).

```bash
npm run dev
```

Runs on Turbopack (`next dev --turbopack`) for faster route compilation. If you
ever run a plain `next build` (webpack) against a `.next` directory that a
Turbopack dev server wrote to, the build fails with a confusing
`Cannot find module '.../[turbopack]_runtime.js'` — the two compilers' output
isn't interchangeable. Fix: delete `.next` and rebuild. This isn't a real
incompatibility, just stale cross-compiler cache; it never happens in a fresh
clone or CI.

### Structure

```
src/
├── middleware.ts                 # session refresh + role-based routing
├── app/
│   ├── (auth)/login/              # /login
│   └── (dashboard)/               # shared shell (nav, sign-out), auth-gated
│       ├── admin/                 # /admin — dashboard, leads, telecallers, settings
│       └── caller/                # /caller — queue + disposition drawer
├── components/
│   ├── ui/                        # shadcn primitives (hand-authored, "new-york" style)
│   ├── shared/                    # LeadStatusBadge, FollowUpBadge, WhatsAppButton, AuditTimeline
│   └── caller/                    # CallDispositionDrawer, CallerQueueClient
└── lib/
    ├── supabase/
    │   ├── client.ts               # browser client (anon key)
    │   ├── server.ts               # RSC/route-handler client (anon key, cookie-based session)
    │   ├── admin.ts                # service-role client — server-only, see its header comment
    │   └── database.types.ts       # hand-authored to match the live schema exactly
    └── phone.ts                    # mirrors normalize_phone() — keep both in sync
```

Admin-only account creation (no public signup page, no email) was the
confirmed design decision. `app/api/admin/create-user` creates the account
directly via the service-role client with an admin-supplied password
(`email_confirm: true`, so it's usable immediately) — the admin relays the
credentials to the telecaller themselves through whatever channel they
already use. `app/api/admin/delete-user` permanently removes an account
(guarded against self-delete and deleting the last active admin); past calls
and audit entries survive since `leads.assigned_to` and
`lead_history_logs.actor_id` both `on delete set null` rather than cascading.

### Call tracking

Records when a telecaller starts a call, how long it ran, and surfaces both
live on the admin dashboard (`supabase/migrations/20260816001100_call_sessions.sql`,
`src/lib/use-call-session.ts`, `src/components/admin/live-calls-panel.tsx`).

**What is and isn't measurable.** Tapping a `tel:` link hands control to the
phone's native dialer, and a web page can observe nothing that happens there —
not connection, not hangup, not duration. No browser API exposes it; the W3C
Telephony spec was never implemented by any shipping browser. So the duration
is derived from **how long the app was backgrounded** while the dialer was in
front (`visibilitychange`). That includes ringing time, so it runs slightly
long, which is why the disposition form shows it as an *editable* field rather
than saving it silently.

Consequently: **treat talk time as a work record, not an audited metric.** The
value is client-reported, so a telecaller can influence their own figure. The
`duration_source` column (`app_estimate` | `manual` | `provider`) exists so
that routing calls through a cloud telephony provider later can write exact,
tamper-proof values into the same table with no schema change — the dashboard,
RLS and UI all stay as they are.

Design points worth keeping:

- **Separate table, not `lead_history_logs`.** A session is mutable (created on
  start, updated on end); the audit trail is append-only and its
  `prevent_log_mutation()` trigger raises on any UPDATE, so a session row
  physically cannot live there.
- **No client write grants**, same as `leads` after migration 1000 — the
  `SECURITY DEFINER` RPCs are the only write path, so ownership and the
  duration ceiling can't be bypassed by a direct PostgREST call.
- **`end_call_session` is idempotent.** It fires from both a `visibilitychange`
  handler and an explicit End Call tap, and survives a reload. Re-ending is a
  no-op *unless* `p_source = 'manual'`, which is the deliberate-correction path.
- **Absurd durations are stored as null**, not clamped. A "14 hour call" is
  always the app left backgrounded overnight; recording it would wreck the
  averages. Same reasoning for swept sessions — duration unknown, so null
  rather than a fabricated zero.
- **Starting a second call supersedes the first** rather than erroring on the
  one-active-session unique index. Switching leads mid-session is normal.
- **`sweep_abandoned_calls()` runs every 5 minutes** on pg_cron, closing
  sessions the app never reported back on, so a killed browser doesn't leave a
  permanent "live call" on the dashboard.
- **Realtime is a signal, not a data source.** The `postgres_changes` payload
  carries raw ids with no names, so each event triggers a refetch of the
  reporting RPC instead of patching rows client-side — simpler, and it cannot
  drift from the database.
- **The two reporting RPCs were merged into one (`admin_call_activity()`,
  migration 1300).** The admin dashboard's initial load already fires several
  Supabase requests in one `Promise.all`, and measuring against the live
  project showed that concurrent requests do not parallelize for free on this
  backend — going from 3 to 5 concurrent RPCs in that batch added real,
  close-to-serial latency (~250ms), not the ~0ms true concurrency would cost.
  A raw `fetch()` concurrency test up to 8 in parallel scaled fine, which rules
  out Node/network and points at limited backend/connection-pool headroom
  instead. The fix is fewer round trips: `admin_active_calls()` and
  `admin_call_stats_today()` were dropped in favour of one function returning
  both result sets as jsonb in a single row, cutting the round-trip count at
  both call sites (the SSR fetch and the Realtime-triggered client refetch).

### Mobile-first and PWA install

Telecallers work from phones, so the phone layout is the default and desktop
is the enhancement (`sm:`/`lg:` variants), not the reverse.

- **`viewport` export in `app/layout.tsx` is load-bearing.** Without it mobile
  browsers assume a ~980px canvas and zoom the whole page out — the app looks
  broken on a phone regardless of any CSS. `viewportFit: "cover"` plus
  `env(safe-area-inset-*)` padding is what keeps content clear of the notch
  and home indicator in the installed app.
- **Inputs are `text-base` (16px) on mobile, `sm:text-sm` above.** iOS Safari
  force-zooms the page whenever a focused input is under 16px. The fix is the
  font size, *not* `maximum-scale=1` — disabling pinch-zoom is an
  accessibility failure. Applies to `ui/input.tsx`, `ui/textarea.tsx`,
  `ui/select.tsx`, and the `datetime-local` in the disposition drawer.
- **Navigation is a bottom tab bar on phones** (`MobileTabBar`) and the inline
  top nav from `sm:` up. Thumb reach while dialling, and the four admin nav
  items simply do not fit a 375px top bar.
- **The disposition drawer is a bottom sheet on phones**, side drawer on
  desktop — `side="responsive"` in `ui/sheet.tsx`. A right-edge slide fights
  the OS back-swipe gesture. Capped at `92svh` (`svh`, not `vh`, so the
  collapsing mobile URL bar can't leave it taller than the visible area).
- **Admin tables become stacked cards below `lg:`.** A 62rem-wide table on a
  375px screen means sideways-scrolling every row to read it.

**Installability.** `public/manifest.webmanifest` + `public/sw.js`, both
static assets rather than the `app/manifest.ts` metadata convention — same
apostrophe-path reason as the icon (see the Windows path caveat below).
Icons are generated by a one-off `sharp` script into `public/icons/`
(192/512 `any`, 192/512 `maskable` at a smaller glyph scale so Android's
circular crop doesn't slice the F's tail, plus a 180px apple-touch-icon).

The service worker exists mainly because **Chrome will not offer to install a
PWA unless one with a fetch handler is registered**. It deliberately caches
*only* content-hashed `/_next/static` and `/icons` assets. Nothing else —
no HTML, no Supabase responses. This is a CRM whose job is showing a
telecaller their *current* queue; a stale cached lead list would be worse
than a slow one. Verified in the browser: 11 static entries cached, zero
HTML/API entries.

Registration is production-only (`next dev` would cache dev asset URLs and
fight Fast Refresh), so **test installability against `npm run build && npm
run start`, not the dev server.** The CSP needs `manifest-src 'self'` and
`worker-src 'self'` or both are silently blocked.

iOS never implements `beforeinstallprompt`, so `InstallPrompt` has two
separate paths: a real install button on Chrome/Android, and printed
Share → Add to Home Screen instructions on iOS.

### Performance, round 2 — the CSP directive that broke client-side navigation

`upgrade-insecure-requests` in the CSP does **not** exempt localhost. On the
dev server it rewrote Next's own same-origin RSC fetches to
`https://localhost:3100`, which has no TLS listener, so every one failed with
`ERR_SSL_PROTOCOL_ERROR` and Next silently fell back to a **full browser
navigation** — turning every in-app link into a complete page reload. Nothing
looked broken; navigation just took seconds. The tell is
`Failed to fetch RSC payload ... Falling back to browser navigation` in the
console, and the confirmation is that a plain `fetch('/login')` from the page
throws. It is now emitted in production only (which is HTTPS, where it is a
no-op and worth keeping).

Two more changes on top of that:

- **`experimental.staleTimes.dynamic: 30`.** Next 15 defaults this to `0`,
  which discards a prefetched or already-visited dynamic route immediately —
  so every tab switch refetched the full payload and paid middleware's two
  sequential Supabase round trips (~460ms TTFB, measured). With a non-zero
  value, returning to a tab visited in the last 30s issues *no request at
  all*. Measured before/after on a production build: **~600ms → 10-25ms**.
  Safe because every mutation path already calls `router.refresh()` or
  refetches client-side, both of which bust this cache.
- **A `loading.tsx` for every route** (`components/shared/page-skeletons.tsx`).
  Previously only `/admin` and `/caller` had one, and a parent `loading.tsx`
  does *not* cover a child segment — so `/caller/history`, `/admin/leads`,
  `/admin/telecallers` and `/admin/settings` showed nothing at all while
  loading. On a cache miss the skeleton now paints in ~20ms.

Also rewrote the Telecallers page, which was the slowest in the app (~1.9s
warm): it ran two `count: exact` requests *per user* (1+2N round trips across
two waves). It now pages through `(assigned_to, status)` once and tallies in
memory — paginated deliberately, since a plain `.select()` stops at
PostgREST's 1000-row cap and would silently under-report.

**Measuring this yourself:** timing navigation from the browser console is
unreliable if the tab is not visible — Chrome throttles background-tab
`setTimeout` to ~1s, which will make every navigation look like it takes
exactly ~1000ms. Check `document.hidden` first, and prefer a
`MutationObserver` (delivered on a microtask, not throttled) over a polling
loop.

### Performance — why navigation used to feel slow, and the fix

Every dashboard navigation was making four sequential round trips to Supabase
purely for auth, before a page's own data even started loading:
`middleware.ts` ran `getUser()` + a profile query, then
`(dashboard)/layout.tsx` ran the exact same two calls again from scratch (its
own comment called this "belt-and-suspenders" — true, but it ran on *every*
navigation, not just as a rare fallback, because Next.js re-executes layouts
that read cookies on every request). Several individual pages
(`caller/page.tsx`, `admin/leads/page.tsx`, `admin/telecallers/page.tsx`)
independently called `getUser()` a third time on top of that, just to get the
id for a redirect guard or a query filter.

Fixed by having `middleware.ts` forward its already-validated
`user.id` / `role` / `full_name` via request headers (`x-user-id`,
`x-user-role`, `x-user-full-name`) — safe because middleware always runs
first on every matched route and overwrites these with `Headers.set()`, so a
client cannot forge them by sending the same header names. `(dashboard)/layout.tsx`
reads the headers instead of re-querying (falling back to a real `getUser()`
only if they're somehow absent — the true "middleware bypassed" case).
`src/lib/supabase/current-user.ts` exports `requireUserId()` for the same
pattern in individual pages. This took four Supabase round trips per
navigation down to one.

### Verified against the live project

Login → role-based redirect → telecaller queue (RLS-scoped, sorted
Overdue/Due Soon first) → disposition drawer → `log_call_interaction` RPC →
live audit trail → stats refresh, all confirmed working end-to-end in a real
browser session against the actual Supabase project (not a mock).

### Windows path caveat — the apostrophe in `Protick's Laptop`

This machine's profile directory contains an apostrophe. Two separate tools
have now broken on it in ways that produce no useful error, so check this
first whenever something fails inconceivably:

- **Tailwind** — silently scans zero files (details below).
- **Next.js metadata routes** — using the `src/app/icon.svg` (or
  `apple-icon`, `opengraph-image`, …) file convention makes the **entire app
  fail to compile**. Next's `next-metadata-route-loader` interpolates the
  asset's absolute path into generated JS inside a *single-quoted* string
  without escaping it, so `Protick's` terminates the literal early:

  ```
  Module parse failed: Unexpected token (11:72)
  throw new Error('File size for Open Graph image "C:\Users\Protick's Laptop\...
  ```

  The error names webpack and an 8MB size check, neither of which is the real
  problem. **Fix:** don't use the file convention — put the asset in `public/`
  and declare it in `metadata.icons`, which skips that loader. This is what
  `src/app/layout.tsx` does.

### A Windows-specific Tailwind gotcha, if content-scanned classes ever go missing again

If Tailwind utilities like `flex` or `bg-*` stop appearing in the compiled CSS
while base/plugin styles (things applied via `@apply` inside `globals.css`
itself) keep working — that combination is the signature — check
`tailwind.config.js`'s `content` array before anything else.

Two independent issues stacked here, both silent (zero matches, no error,
`.next` deletion doesn't help):

1. A relative `content` glob resolved incorrectly under Next's
   webpack/postcss-loader specifically (the standalone Tailwind CLI handled the
   same relative glob fine) — fixed by making it absolute.
2. `path.join()` on Windows returns backslash-separated segments, and
   fast-glob/micromatch (Tailwind's content scanner) treat `\` as a glob
   **escape character**, not a path separator — fixed by normalizing to `/`.
3. A third, environment-specific one: this machine's Windows profile directory
   contains an apostrophe (`...\Protick's Laptop\...`), and fast-glob silently
   returns **zero matches** for an absolute pattern that combines an apostrophe
   with a brace group — `/**/*.tsx` alone matches fine, `/**/*.{ts,tsx}`
   together matches nothing. Fixed by listing `*.ts` and `*.tsx` as two
   separate glob entries instead of one `{ts,tsx}` group.

`tailwind.config.js` is plain CommonJS, not `.ts` — Tailwind's TS-config loader
(`jiti`) was found to cache its transpiled output in the OS temp directory
(`%LOCALAPPDATA%\Temp\jiti`, `...\node-jiti`), outside `.next`, and edits to
`tailwind.config.ts` were not reliably invalidating that cache in this
environment. Plain `.js` needs no transpilation, so there's no cache to go
stale. If you ever move back to a `.ts` config and colors/spacing look frozen
after an edit, clear those two temp directories first.

### Known test artifacts on the live project

A `qa.telecaller@fenlark.test` account and 3 leads named `Overdue Test Lead` /
`Due Soon Test Lead` / `Fresh New Test Lead` (phones `980000000X`) were created
to verify the queue and disposition drawer end-to-end. They could not be
cleaned up from outside the app: `enforce_lead_update_rules()` and the
append-only trigger on `lead_history_logs` both correctly reject writes from a
service-role client with no admin session — proof the guards hold even against
direct API/service-role access, not just RLS, but it also means archiving them
needs either the real admin UI (once built) or a one-time SQL Editor session
using the same `app.actor_kind = 'system'` escape hatch the recycling engine
itself uses:

```sql
begin;
select set_config('app.actor_kind', 'system', true);

update public.leads set deleted_at = now()
 where phone like '9800000%' and deleted_at is null;

delete from auth.users where email = 'qa.telecaller@fenlark.test';
commit;
```

A second pair was left behind while verifying call tracking: a
`calltest.probe@fenlark.test` account and a `Call Test Lead` on phone
`9700000123`. Same situation, same escape hatch — and note the user delete
only succeeds **after migration 1200 is applied**, since that is the migration
which fixed user deletion in the first place:

```sql
begin;
select set_config('app.actor_kind', 'system', true);

update public.leads set deleted_at = now()
 where phone = '9700000123' and deleted_at is null;

delete from auth.users where email = 'calltest.probe@fenlark.test';
commit;
```

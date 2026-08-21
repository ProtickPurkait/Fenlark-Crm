# Handoff — Trace (Fenlark CRM)

This file is for picking this project back up with a **different AI assistant**
(Gemini, Grok, ChatGPT, a different Claude session, etc.) that has none of the
prior conversation history. Read this whole file before touching code — several
sections describe non-obvious bugs and locked decisions that cost real
debugging time to discover the first time.

If you're a human: this is also just an accurate project status doc, read it
too.

---

## 1. What this is

**Trace** is a custom Lead & Telecaller CRM built for **Fenlark Technologies
LLP** (a digital marketing/web dev agency run by the user, Protick). Fenlark is
the company; Trace is the product name — the repo directory is still
`fenlark-crm/` and should **not** be renamed casually (`.claude/launch.json`,
one level up from this repo, hardcodes that path).

Two user roles: **Admin** (manages leads, telecallers, settings, sales
approval) and **Telecaller** (works an assigned lead queue, logs calls, logs
sales).

## 2. Stack

- **Next.js 15 App Router**, TypeScript, plain `next dev` (webpack) — NOT
  Turbopack, see §4.
- **Tailwind CSS v3**, hand-authored shadcn "new-york"-style components (no
  shadcn CLI dependency), `framer-motion` for animation, `lucide-react` icons.
- **Light-only theme** (`Plus Jakarta Sans` + `JetBrains Mono` via `next/font`,
  one signal-blue accent). This replaced an earlier dark glass/neon-glow
  identity wholesale — see §6 for what changed and why, and don't assume
  `dark:` variants or the old near-black palette from any pre-redesign mental
  model or screenshot.
- **Supabase**: Postgres + Row Level Security + `pg_cron`, `@supabase/ssr` for
  the Next.js client/server split. **No ORM.** No PostgREST embedded/foreign
  selects anywhere — every multi-table view is a manual `id → row` map built in
  JS after two separate queries (this is a deliberate, consistent convention,
  not an oversight — follow it in new code).
- **No ORM, no direct table writes from the client.** Every mutation goes
  through a Postgres RPC (`security definer` function). This is a hard,
  load-bearing architectural rule for this project (see §7 Security Model) —
  do not add a table the client writes to directly without revoking grants and
  wrapping it in an RPC.
- Deploy target: **Vercel**, auto-deploys on push to `main`.
- Live Supabase project ref: `bsfofcxagxeqrhbolmuf`.

## 3. Repo / environment

- Path: `C:\Users\Protick's Laptop\Desktop\claude\fenlark-crm\` (Windows).
- Git remote: `https://github.com/ProtickPurkait/Fenlark-Crm.git`, branch
  `main`. Working tree is clean as of this handoff (last commit `55b8dad`).
- `.env.local` (gitignored) needs three vars — see `.env.local.example`:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`. The service role key is server-only, imported
  only by `src/lib/supabase/admin.ts` (which has `import "server-only"` so a
  client bundle would fail to build if it ever leaked into one).
- npm scripts: `npm run dev` (port 3100 via `next dev`), `npm run build`,
  `npm start`, `npm run db:test` (PGlite-based migration+smoke-test runner, no
  Docker needed), `npm run security:probe`.
- There's also a `fenlark-crm-prod` dev-server config
  (`C:\Users\Protick's Laptop\Desktop\claude\.claude\launch.json`, one
  directory above this repo) that runs `next start --port 3101` for
  prod-vs-dev perf comparisons — see §5.

## 4. Environment-specific bugs on this machine (Windows, apostrophe in path)

The Windows profile path is `C:\Users\Protick's Laptop\...` — the apostrophe
has broken multiple Node build tools in ways that produce **misleading error
messages**. If you hit an inexplicable build/tooling failure on this machine,
check for these before deep-debugging anything else:

1. **Tailwind v3 content globs silently match zero files** if a glob is both
   an absolute path *and* uses brace expansion (e.g. `*.{ts,tsx}`) —
   `fast-glob` (Tailwind's scanner) returns zero matches with **no error**.
   Symptom: base/preflight CSS compiles fine, but content-scanned utility
   classes (`flex`, `bg-*`, etc.) never appear — unstyled HTML, no console
   error. `tailwind.config.js` in this repo already works around it: forward
   slashes via `.replace(/\\/g, "/")`, and `*.ts`/`*.tsx` as **separate** glob
   entries, never braced together. Don't "clean up" that config back to a
   braced pattern. Also avoid switching to `tailwind.config.ts` — its `jiti`
   transpile cache lives outside `.next` and didn't reliably invalidate here.

2. **Next.js App Router metadata file conventions break the entire build.**
   `src/app/icon.svg`, `apple-icon.*`, `opengraph-image.*`, etc. go through
   `next-metadata-route-loader`, which interpolates the absolute file path
   into a **single-quoted JS string literal** without escaping — the
   apostrophe terminates the string early and every route 500s, not just the
   icon route. The error text is misleading (mentions an 8MB size limit and
   Open Graph, neither of which is the real cause). **Fix already applied in
   this repo:** icons live in `public/` and are declared via the `metadata`
   export (`icons: { icon: "/icon.svg", ... }` in `src/app/layout.tsx`) —
   never re-introduce an `app/`-convention metadata file here.

General rule: if a Node/webpack tool fails with a parse error pointing inside
`node_modules/next/dist/...` or a glob silently matches nothing, suspect the
apostrophe before anything else.

## 5. Performance characteristics already diagnosed (don't re-diagnose from scratch)

This project went through several rounds of real perf investigation. Findings,
so a new assistant doesn't repeat the measurement work:

- **Warm Supabase round-trip time from this dev environment is ~90–210ms per
  call** (measured with `curl -w`, warm connection) — this is a genuine network
  RTT floor (project region distance), not fixable in app code.
- **`Promise.all`-batched Supabase calls do NOT parallelize for free on this
  project's backend** — going from a 3-way to a 5-way `Promise.all` measurably
  added ~250ms, close to serial cost. Raw `fetch()` concurrency to the same
  project scaled fine up to 8-way, ruling out client/network limits — the
  constraint is specifically this Supabase project's backend/connection-pool
  handling of concurrent RPC execution. **Design takeaway: budget close to a
  full round trip for every additional Supabase call you add to a hot page,
  even if batched.** This has already caused one real regression (call
  tracking added 2 RPCs to the admin dashboard's Promise.all → fixed by
  merging them into one `admin_call_activity()` RPC returning both result sets
  as jsonb).
- **`next dev` (Turbopack) is unstable on this project** — it crashed with a
  React Client Manifest resolution error that cascaded until even `/login`
  500'd. Reverted to plain `next dev` (webpack). Don't re-enable
  `--turbopack` here without flagging that it broke once already.
- **`next dev` and `next build`/`next start` must never run concurrently
  against the same `.next/` directory** — they write incompatible manifest
  formats and corrupt each other, even in a stop-then-run sequence sometimes.
  If you see `Cannot find module '.../[turbopack]_runtime.js'` or similar
  after switching between dev and a production build, `rm -rf .next` and
  restart — this is a known, expected step, not a real bug to chase.
- **A CSP `upgrade-insecure-requests` directive broke client-side navigation
  entirely** at one point — it rewrote same-origin RSC fetches to `https://`
  on localhost (no TLS listener there), so every fetch failed and Next fell
  back to full browser page reloads on every link click. Fixed by emitting
  that CSP directive in production only. If "every click looks like a full
  page reload," check the CSP before profiling anything.
- **Duplicate `auth.getUser()` calls were a real bug, now fixed.** Before the
  fix, middleware, the shared dashboard layout, and several individual pages
  each independently re-validated auth for the same request (3–5 round trips
  per navigation). Fixed by having `middleware.ts` forward the already-
  validated `user.id`/`role`/`full_name` via **request headers**
  (`x-user-id`, `x-user-role`, `x-user-full-name`), which `(dashboard)/
  layout.tsx` and pages read via `headers()` instead of calling Supabase
  again. **If you add a new page/layout that needs the current user, read
  these headers first — do not add a fresh `getUser()` call** unless the route
  genuinely isn't covered by middleware's matcher (real fallback case, kept
  intentionally).
- `next.config.ts` sets `experimental.staleTimes: { dynamic: 30 }` — Next 15
  otherwise discards prefetched dynamic routes instantly, forcing a full
  middleware re-run on every tab switch. Don't remove this without expecting
  navigation to get slower again.
- The `@supabase/supabase-js` SDK (~190kB) doesn't tree-shake — any page that
  statically imports `createClient` pays for the whole SDK even if it only
  calls `.auth`. **Established pattern in this codebase:** replace the
  top-level `import { createClient } from "@/lib/supabase/client"` with a
  dynamic `const { createClient } = await import("@/lib/supabase/client")`
  inside the event handler/effect that actually needs it. This has already
  been applied to essentially every client component that talks to Supabase
  (admin screens, caller queue, disposition drawer, sign-out button, sales
  approval, etc.) — cut First Load JS 25–30% per route with zero behavior
  change. **Apply this same pattern to any new client component you add.**
  Exception: a component needing Supabase immediately on mount (e.g. opening a
  Realtime channel) needs a cancellation-safe async effect instead of a plain
  dynamic import (see `src/components/admin/live-calls-panel.tsx` and
  `src/components/caller/rejection-bell.tsx` for the pattern — a `cancelled`
  flag closed over locally-scoped `client`/`channel` variables so an unmount
  racing the in-flight `import()` can't leak a subscription).

To reproduce any of the above measurements yourself: `fenlark-crm-prod` (port
3101, `next start`) is the correct baseline for perf comparisons, not `next
dev` (port 3100) — dev mode itself adds real overhead (~90-130ms vs ~5ms on an
identical static page) that has nothing to do with app code.

## 6. Current build status

**Done and live** (migrated to production, `npm run db:test` passing,
`git push`ed to `main`):

- **Database layer**: schema, RLS, immutable append-only audit trail
  (`lead_history_logs` rejects UPDATE/DELETE/TRUNCATE for everyone including
  the table owner, with two narrow, non-client-reachable exceptions — see §7),
  phone-number dedup (normalized, hard-blocked), round-robin assignment,
  SLA-based stale-lead recycling via `pg_cron` (runs every 15 min, independent
  of the app being up).
- **Auth + middleware role-routing.**
- **Telecaller app**: lead queue, call-disposition drawer, call-session
  tracking (client-side estimated duration — see §8), Earnings tab
  (wallet balance + transaction history), Log Sale flow, live rejection-alert
  bell (Supabase Realtime).
- **Admin app**: Dashboard (bento grid, live-calls panel), Leads (CSV import,
  manual add with pre-commit duplicate-phone check, assignment/round-robin,
  bulk archive, bulk permanent delete, page-size selector, sort), Telecallers
  (manual account creation/deactivation, no email invite flow — see §8),
  Settings (SLA toggle, recycle-now), **Sales** (approval queue: approve/
  reject with reason, page-size + status filter).
- **Mobile-first + installable PWA**: phone layout is the default (not an
  afterthought), bottom tab bar on mobile, service worker + manifest for
  home-screen install. The service worker caches ONLY content-hashed static
  assets, never HTML or Supabase responses. **Installability only works
  against `fenlark-crm-prod` (port 3101), not `next dev`** — the service
  worker is production-only by design.
- **Sales & commission system** (migration
  `20260816001500_sales_commission.sql`): telecaller logs a sale from their
  queue → lands in admin's Sales tab as `pending` → admin approves (₹500
  commission locked to telecaller with a timestamp, immutable via a
  `BEFORE UPDATE` trigger) or rejects (with a required reason, telecaller
  gets a live bell notification). Logging a sale also auto-flips the lead's
  status to `converted`. Full RPC surface: `caller_log_sale`,
  `admin_approve_sale`, `admin_reject_sale`, `caller_acknowledge_sale`,
  `my_wallet_summary`.
- **Permanent lead delete + pre-import duplicate check** (migration
  `20260816001600_lead_hard_delete.sql`): the Leads screen's bulk-action bar
  has a "Delete forever" action alongside Archive. It permanently purges a
  lead's row, audit trail (`lead_history_logs`), and call sessions — *unless*
  the lead has any sale/commission history (pending, approved, or rejected),
  in which case it's archived instead, specifically so an approved ₹500 can
  never lose the lead record its wallet entry points back to. Separately,
  both CSV and manual "Add leads" now call `admin_check_duplicate_phones`
  (a read-only dry run) *before* committing, and if any phone in the batch
  already matches a live lead, a dialog offers "Keep duplicates" (skip the
  new ones, existing behavior just surfaced up front) or "Delete duplicates &
  add leads" (removes/archives the existing match via `admin_delete_leads`,
  then imports). Full RPC surface: `admin_delete_leads(lead_ids)` →
  `{deleted, archived_instead}`, `admin_check_duplicate_phones(phones)`.
  See §7 for the narrow audit-trail DELETE exception this required, and §9
  for a real bug this introduced-then-fixed in the same session.
- **Telecaller mobile-layout fix + Log Sale relocated into the drawer**: the
  queue row had a genuine overflow bug — the WhatsApp button and a separate
  Log Sale button were both `w-full shrink-0` inside a non-wrapping flex row,
  so on a phone the two competed for 100% width each. Fixed by removing the
  standalone Log Sale button from the row entirely and surfacing it as an
  action inside `CallDispositionDrawer` instead, alongside Call Now/WhatsApp/
  status/follow-up/remarks — matching how every other lead action already
  works, per the user's explicit ask that it live "under the lead," not
  beside it in the list.
- **Business category/address now surfaced everywhere they're missing**: the
  disposition drawer shows a labeled Category/Address panel (previously
  category was an unlabeled pill and address wasn't shown with any label);
  `leads-client.tsx` (admin) now renders `address` in both the mobile card and
  desktop table — it was already in the row type and query but was never
  actually rendered. See §9 for the deeper root-cause bug this surfaced
  (migration `20260816001700_lead_queue_business_fields.sql`) — **that
  migration's live-DB status is unconfirmed as of this handoff; until it's
  run, the telecaller queue will keep showing "Not specified" for both
  fields even though this UI code is deployed.**
- **Full visual redesign: dark glass/neon-glow → light, ink-neutral, one-accent
  theme.** Started from a mockup built with the ui-ux-pro-max and taste-skill
  design skills, then implemented for real across the whole app. What changed:
  - `globals.css`: every CSS custom property repointed to a light HSL palette
    (paper background, near-white cards, ink-950 text, `--primary` = an
    electric signal blue `230 100% 60%`). `--success`/`--warning`/`--critical`
    are new semantic tokens, kept deliberately separate from `--primary` so a
    button is never mistaken for a status. **The `--neon-*` variable names
    (`--neon-blue`, `--neon-emerald`, etc.) were kept as aliases onto the new
    semantic tokens** rather than hunting down every `hsl(var(--neon-blue))`
    call site — cheapest way to re-theme ~20 files that reference them
    directly. Same reasoning for the `.glass` / `.glass-strong` class names:
    redefined in `globals.css` as flat bordered cards with a soft shadow (no
    more `backdrop-blur`/`border-white/10`), so every component built on
    `<Card>`, `<Sheet>`, `BentoCard`, etc. picked up the new look for free
    without a single call-site edit. **If you ever see `neon-` or `glass` in
    this codebase, that's legacy naming carried forward for low-risk
    migration — it does not mean the app is still dark or still glowing.**
  - `src/app/layout.tsx`: `next/font/google` now loads Plus Jakarta Sans
    (`--font-sans`) and JetBrains Mono (`--font-mono`); the root `<html>` no
    longer forces `className="dark"` — `colorScheme` is `"light"` instead.
  - New `src/components/admin/admin-sidebar.tsx`: admin gets a fixed dark
    rail (the one place the product deliberately stays dark) on `md:` and up,
    replacing the shared top nav for that role. Below `md:`, admin falls back
    to the same top header + bottom `MobileTabBar` telecallers always use —
    the rail has no mobile variant. `(dashboard)/layout.tsx` branches on
    `isAdmin` to pick which chrome renders; `NAV_ICONS` was exported from
    `dashboard-nav.tsx` so the sidebar can reuse the same icon map.
  - Every remaining hardcoded dark-mode utility (`border-white/10`,
    `bg-white/[0.0x]`, `backdrop-blur-*`, `shadow-glow-*`, `shadow-[0_0_
    ...currentColor]` glow dots) was swept from ~30 files — primitives in
    `src/components/ui/` first (`card`, `input`, `select`, `switch`,
    `textarea`, `sheet`, `bento`, `skeleton`, `motion-button`), then every
    page/panel component. **If a new component still has a literal
    `white/`-opacity or `backdrop-blur` class, it was missed by this pass —
    treat it as a bug, not an intentional dark accent.**
  - `public/manifest.webmanifest` and the `themeColor` in `layout.tsx` were
    repointed from the old near-black `#030711` to the new paper background
    `#F4F5F7`, so the installed-PWA splash screen and Android status bar tint
    match the new theme.
  - **Verification note for whoever picks this up next:** `npx tsc --noEmit`
    and `npm run build` both pass clean (every route compiles, including
    every `admin/*`/`caller/*` page). Only `/login` could be visually
    confirmed live in a real browser this session — no assistant here has
    real admin/telecaller credentials (see the note further down in this
    section), so the authenticated screens were verified by the exhaustive
    grep sweep + clean build, not a click-through. **Ask the user to eyeball
    the admin dashboard, leads table, and the telecaller queue/drawer on a
    real login before trusting this is pixel-perfect everywhere.**
- Bundle-weight pass across essentially every client component (see §5).
- Speed-tested three times this session; last known-clean state. The delete/
  duplicate-check feature only moved `/admin/leads` (167 kB → 181 kB, all new
  app code, no new dependency) — every other route is unchanged. The redesign
  itself added `next/font` (self-hosted, subsetted) but no new npm dependency;
  bundle sizes per route are essentially unchanged from before it.

**Immediate pending action (not a code task — a live-DB step for the user):**

- **Run migration `20260816001700_lead_queue_business_fields.sql` in the
  Supabase SQL Editor.** It rebuilds the `lead_queue` view (drop + recreate,
  not `create or replace` — see §9 for why) so it stops omitting
  `business_type`/`address`. The code side of this fix is already pushed
  (commit `55b8dad`); as of this handoff the user has not yet confirmed
  running the SQL side. If you're picking this up, ask first — don't assume
  it's done, and don't re-diagnose the "Not specified" symptom from scratch
  if it's reported again; check this first.

**Not yet done / explicitly deferred:**

- Full interactive end-to-end testing of the sales flow, the permanent-
  delete / duplicate-check flow, and now the full light-theme redesign
  (admin sidebar, every recolored screen) using real admin/telecaller
  logins — no assistant in this project has had actual login credentials,
  so this has always been the user's job to verify at
  `http://localhost:3100` (dev) or against the deployed Vercel URL.
  **If you're picking this up, ask the user whether they've done this and
  what broke, if anything.**
- A JWT-custom-claims approach to cut middleware from 2 Supabase round trips
  to 1 — deliberately not built because it trades away instant enforcement of
  `admin_set_user_active(false)` (a deactivated user's existing JWT wouldn't
  reflect that until natural token refresh). Needs explicit user sign-off
  before implementing, not just a speed win.
- Cloud telephony integration (e.g. Exotel, ~₹0.50–0.70/min) for exact call
  duration/recording — current call tracking is a client-side estimate only
  (see §8); the `call_sessions.duration_source` column already anticipates
  this so no schema change would be needed later.

**Known cleanup item, not yet done:** a `qa.telecaller@fenlark.test` test
account + 3 test leads (`980000000X` phone prefix) exist on the live Supabase
project from browser-testing. Cleanup SQL is in `README.md` under "Known test
artifacts" — safe to run from the Supabase SQL Editor whenever convenient.

## 7. Security model (read before adding any table or write path)

- **Clients have zero direct write access to any table.** `INSERT`/`UPDATE`/
  `DELETE` are revoked from `authenticated` and `anon` on every table. All
  writes go through `SECURITY DEFINER` RPC functions that run as the table
  owner and internally re-verify ownership/authorization (RLS does not
  protect the *inside* of a SECURITY DEFINER function body — the function
  itself must re-check, e.g. `caller_log_sale` re-verifies
  `leads.assigned_to = auth.uid()` even though RLS would also block a
  mismatched row).
- **This was learned the hard way**, not designed up front: an earlier version
  relied on RLS alone (`is this row yours?`), which let a telecaller `UPDATE`
  their own lead directly via PostgREST — bypassing the audit trigger and the
  "remark required" validation, letting them mark leads converted with zero
  explanation. **Confirmed exploitable against the live project before the
  fix.** Generalized lesson, stated in the README: *authorization is not
  validation*. Any new client-writable table needs the same treatment:
  revoke grants, wrap in an RPC.
- Every RPC that's admin-only checks `is_admin()` and raises with errcode
  `42501` if it fails; every RPC also sets `set search_path = public`
  (prevents search-path hijacking) and ends with an explicit
  `revoke execute ... from public, anon; grant execute ... to authenticated;`
  pair — a bare `revoke from public` does **not** strip Supabase's separate
  by-name grant to `anon`, so always do both.
- **Every migration must be idempotent** — `create or replace function` for
  all functions (never bare `create function`; this bit us once — see §9),
  and enums use a `do $$ ... exception when duplicate_object then null; end
  $$;` wrapper. `npm run db:test` replays every migration from scratch each
  run and would catch a broken enum wrapper, but it will NOT catch a
  non-idempotent function definition, since PGlite always starts from empty —
  that class of bug only shows up when re-running against a live database
  that already has the function. Re-check any new migration manually for
  `create function` vs `create or replace function` before calling it done.
- Immutability (e.g. "once approved, a commission is locked forever") is
  implemented via a `BEFORE UPDATE` trigger comparing `OLD`/`NEW`
  column-by-column and raising on any disallowed change — not via column
  GRANTs, because GRANTs can't distinguish admin vs. telecaller within the
  same `authenticated` Postgres role.
- Supabase Realtime requires a **separate** opt-in per table:
  `alter publication supabase_realtime add table public.<table>;` — RLS
  alone does not make a table's changes flow over Realtime. This has already
  caused one full debugging cycle in this project; don't forget it for a new
  realtime-backed feature.
- **`lead_history_logs`'s append-only guard (`prevent_log_mutation()`) has
  exactly two exceptions, both added across this session, both unreachable
  from any client.** UPDATE: a user deletion nulling `actor_id`/
  `from_assignee`/`to_assignee` via their `on delete set null` FKs (migration
  `1200`) — every other column, and re-populating an already-nulled
  reference, still raises. DELETE: `admin_delete_leads` purging a fully-
  deleted lead's own log rows (migration `1600`), gated behind a transaction-
  local `app.allow_log_purge` flag that only that one `is_admin()`-checked
  function ever sets. **If you ever redefine `prevent_log_mutation()` again,
  `create or replace function` replaces the *entire* function body — you must
  carry both existing exceptions forward explicitly, not just add a new one.**
  This bit us once already in this exact session: a first draft of the
  DELETE exception silently dropped the UPDATE exception, and the only reason
  it was caught was `npm run db:test` failing on an unrelated-looking
  assertion (a user-deletion test from a different section) — not from
  reading the diff. Re-run the full suite after touching this function, don't
  eyeball it.
- **`set_config(name, value, true)` (the `is_local => true` form used
  throughout this codebase for `app.*` GUCs) is scoped to the whole
  transaction, not to one statement.** If a function sets a flag like
  `app.allow_log_purge` to permit one specific write, reset it back
  explicitly right after that write, in the same function — don't rely on it
  falling out of scope, because PostgREST's "one RPC call = one transaction"
  behavior is a runtime assumption, not something the database itself
  enforces. `admin_delete_leads` does this correctly (see its source); the
  smoke-test suite caught the case where an earlier draft didn't, because the
  whole suite runs inside one big transaction and the leaked flag stayed
  "on" for every statement after it.
- Re-verify the security posture any time: `npm run security:probe` (asserts
  `anon` cannot reach any table/view/privileged RPC).

## 8. Other locked-in decisions — don't re-litigate without the user raising it

- **No email invite flow, ever.** The user explicitly rejected it
  ("I don't want to send any invite. I want to do it manually"). Admin
  accounts are created directly via `app/api/admin/create-user` with an
  admin-supplied password (`email_confirm: true`), shown once in the UI for
  the admin to relay manually.
- **Call duration is a client-side estimate**, not a hard telephony record —
  measured from how long the app is backgrounded while the phone's native
  dialer is in front. A `tel:` handoff is unobservable to a web page, so this
  is deliberately editable by the telecaller (`duration_source`:
  `'app_estimate' | 'manual' | 'provider'`). Recording audio from a PWA is
  impossible on any platform without a paid telephony provider — the user was
  told this and chose the free estimate-based tracker instead.
- **Hard-block duplicate phone numbers**, normalized via `normalize_phone()`
  in SQL, mirrored in `src/lib/phone.ts` — keep both in sync if the
  normalization rule ever changes.
- **pg_cron runs the SLA recycler**, not a Vercel cron job — so it keeps
  running even if a Vercel deploy is broken or the app is down.
- Fixed ₹500 commission amount is stored per-row (`sales.commission_amount`),
  not hardcoded in every query, in case it needs to vary later — but there is
  currently no UI to set a different amount; it always defaults to 500.
- **A lead with any sale/commission history can never be permanently
  deleted**, full stop — `admin_delete_leads` archives it instead, no matter
  how the request got there (direct bulk delete, or the "delete duplicates &
  add" path from the import dialog). The user explicitly chose this over
  "delete everything, no exceptions" and over "delete the lead but keep the
  commission row orphaned" when asked directly — don't relitigate without
  raising it with them again.
- **"Keep duplicate" in the import-duplicate dialog means keep the existing
  lead and skip the new one** — it does *not* mean allow two leads with the
  same phone number to coexist. The user explicitly chose this over loosening
  the hard-block-duplicate-phone constraint when asked directly. The
  `leads_phone_unique` partial unique index is unchanged and still the real
  enforcement; the dialog only changes *when* the admin finds out.

## 9. Recent bug history worth knowing (root causes, already fixed)

- **`admin_call_activity` migration used `create function` instead of
  `create or replace function`** — the only non-idempotent function
  definition in the whole migration set, causing `ERROR: 42723: function
  "admin_call_activity" already exists with same argument types` on
  live-database re-runs. One-line fix; re-verified with `npm run db:test`
  (behavior-neutral). **This is exactly the class of bug §7's idempotency
  rule exists to prevent — check for it specifically in any new migration.**
- **Deleting a telecaller who had ever been assigned a lead used to fail** —
  two stacked causes: (a) the append-only audit trigger unconditionally
  rejected the `on delete set null` nulling of
  `lead_history_logs.{actor_id,from_assignee,to_assignee}`; (b) once relaxed,
  nulling `leads.assigned_to` fired the audit trigger again, which tried to
  insert a new row referencing the user mid-deletion, violating its own FK.
  Fixed by narrowing the audit-mutation guard to permit only set-to-null on
  person columns, and by resolving assignee/actor ids through an existence
  check before writing.
- **Dashboard silently showed all zeros despite 300+ real leads** — a
  security-hardening migration had sat unapplied on the live DB for a day
  while the app code already called the RPC it defined; every field fell back
  to `?? 0` with no error surfaced. If a similar "everything shows 0/empty,
  no error" report ever comes in, check `node scripts/security-probe.mjs` for
  `PGRST202`/`PGRST205` before anything else — it means a migration exists
  locally but was never run against the live database. **General lesson: this
  project's local test suite (PGlite) can prove a migration is *valid*, but
  can never prove it was actually *applied* to production** — that requires a
  live check (a temporary Node script against the service-role key is the
  established pattern; see `scripts/security-probe.mjs` for the shape).
- **Redefining `prevent_log_mutation()` for the permanent-delete feature
  silently reverted an earlier, unrelated fix** (migration `1200`'s UPDATE
  exception for FK-nulling on user deletion) because `create or replace
  function` was written from the *original* migration `0400` version of the
  function instead of its current, already-patched form. Caught by
  `npm run db:test` failing on a user-deletion assertion in a completely
  different section of the smoke suite — not by code review. See §7 for the
  generalized rule this produced.
- **A transaction-local escape-hatch GUC (`app.allow_log_purge`) was left set
  to `'true'` after use**, so within one transaction it stayed open for every
  statement that followed, not just the one DELETE it was meant to permit.
  Invisible in production (PostgREST gives each RPC call its own
  transaction), but caught immediately by the smoke suite, which runs
  entirely inside one transaction — a regression-guard assertion that tried a
  raw `DELETE` afterwards unexpectedly succeeded. Fixed by resetting the flag
  back to `'false'` immediately after the one statement that needs it, inside
  the same function. See §7 for the generalized rule.
- **`lead_queue` silently omitted `business_type`/`address` for two
  migrations' worth of time, even though `leads` itself always had correct
  data.** The view is defined as `select l.*, ... from public.leads l`, and
  Postgres expands `l.*` into a fixed column list **at CREATE/CREATE OR
  REPLACE time** — it does not track the underlying table afterwards. The
  view was last (re)created by migration `1000`, before migration `1400`
  added those two columns to `leads`, so every telecaller-facing read of the
  queue (and the disposition drawer built from it) silently dropped both
  fields from that point on, while the admin Leads screen — which queries
  `leads` directly, not the view — was unaffected. Root-caused via a
  temporary, read-only Node script against the live service-role key
  (proving the data itself was correct) plus static analysis of migration
  history (proving the view predated the columns). Fixed in migration
  `1700` with `drop view` + `create view` (not `create or replace view`):
  Postgres only allows `CREATE OR REPLACE VIEW` to *append* new columns at
  the very end of the existing list, and `business_type`/`address` land in
  the middle (wherever `l.*` expands them, ahead of the computed
  `follow_up_bucket`/`queue_rank`/`sla_hours_remaining` columns) — Postgres
  rejects that with `cannot change name of view column "follow_up_bucket" to
  "business_type"`. **General lesson, not specific to these two columns: any
  future column added to `leads` will need this same view rebuilt again, or
  it will silently vanish from the telecaller queue the same way.** A
  regression-guard smoke-test assertion now checks `lead_queue` surfaces both
  columns, not just `leads` itself — see the migration's own comments for
  the full reasoning.

## 10. How to verify changes in this project

1. `npx tsc --noEmit` — typecheck.
2. `npm run db:test` — replays all migrations fresh + runs every smoke-test
   assertion (currently 115). Fast (~5s), no Docker/Supabase CLI needed
   (PGlite = Postgres-to-WASM).
3. For bundle-size-sensitive changes: stop dev, `npm run build`, check the
   route's First Load JS, then `rm -rf .next` and restart dev (see §5 for why
   the wipe is necessary).
4. Browser check at `http://localhost:3100` (dev) — but expect a transient
   slow/erroring first load right after a `.next` wipe purely from
   Turbopack-free webpack's on-demand compile; a second load or fresh tab is
   the trustworthy read.
5. If a migration is new, it must be applied to the live Supabase project
   (SQL Editor, paste-and-run) separately from being merged into the repo —
   they are not automatically synced. Confirm with the user whether they've
   run it before assuming a new RPC/table exists live.

---

*Generated 2026-08-16 by Claude (Sonnet 5) at the end of a long build session,
specifically so a different AI assistant (or a future session with no memory
of this one) can pick this project up without re-discovering the above the
hard way. Updated same day after a follow-up session added permanent lead
delete + the pre-import duplicate check (commit `5cde36f`), then again after a
session that fixed the telecaller mobile layout, moved Log Sale into the
drawer, and fixed `lead_queue` silently omitting business_type/address
(commit `55b8dad`) — see §9 for that bug and the pending live-DB step in §6.*

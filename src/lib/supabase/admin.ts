import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// SERVICE-ROLE CLIENT — bypasses Row Level Security entirely.
//
// The `server-only` import above is not decorative: it makes the Next.js
// bundler throw a BUILD ERROR if any Client Component ever imports this file,
// even transitively. That is the real backstop; do not rely on discipline
// alone to keep SUPABASE_SERVICE_ROLE_KEY out of the browser bundle.
//
// There is exactly one legitimate reason to reach for this today: creating a
// telecaller account via auth.admin.inviteUserByEmail() in
// app/api/admin/invite-telecaller/route.ts, which itself re-checks is_admin()
// before doing anything (see that route for why — a service-role client skips
// RLS, so the route's own authorization check is the only gate that exists).
//
// Every other admin action (assignment, round-robin, settings, archiving) has
// a SECURITY DEFINER RPC that already enforces is_admin() inside Postgres —
// call those through the normal server/browser client instead of reaching
// for this file. Using the admin client where an RPC would do throws away the
// database-level authorization check for no benefit.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing Supabase admin credentials. Check SUPABASE_SERVICE_ROLE_KEY and " +
        "NEXT_PUBLIC_SUPABASE_URL in .env.local.",
    );
  }

  return createSupabaseClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

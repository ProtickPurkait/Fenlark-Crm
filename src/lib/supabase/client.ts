import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

// For use in Client Components only. Carries the anon/publishable key, which
// is safe to ship to the browser — every table it can reach is governed by
// the RLS policies in supabase/migrations/0500_rls_policies.sql.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

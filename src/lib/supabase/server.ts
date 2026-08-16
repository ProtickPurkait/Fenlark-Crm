import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

// For use in Server Components, Route Handlers and Server Actions. Still the
// anon key — the user's own session cookie is what determines which RLS rows
// they can see, exactly as in the browser client. This is not the admin path.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, which cannot set cookies.
            // Harmless as long as middleware.ts is refreshing the session
            // on every request, which it is.
          }
        },
      },
    },
  );
}

import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./server";

/**
 * Current user's id for Server Components under (dashboard).
 *
 * Reads the x-user-id header middleware.ts forwards after its own
 * getUser() call, so pages never repeat that network round trip on a normal
 * request — before this, middleware, the dashboard layout, and several
 * individual pages each ran their own getUser() for the same request, which
 * is what made every navigation feel slow (200-400ms per Supabase round
 * trip, stacked four deep before a page's own data even started loading).
 *
 * Falls back to a real getUser() call only if the header is somehow missing
 * (e.g. a future route added outside middleware's matcher), and redirects to
 * /login if there is truly no session either way.
 */
export async function requireUserId(): Promise<string> {
  const hdrs = await headers();
  const headerId = hdrs.get("x-user-id");
  if (headerId) return headerId;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

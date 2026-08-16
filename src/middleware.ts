import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Runs on every request. Two jobs:
//   1. Refresh the Supabase session cookie (required by @supabase/ssr — without
//      this, sessions silently expire and Server Components see a logged-out
//      user even though the browser still has a cookie).
//   2. Role-based routing: unauthenticated -> /login, telecallers kept out of
//      /admin/*, everyone routed to their home on a bare "/" hit.
//
// This is a convenience layer, not the security boundary — RLS in Postgres is
// (see supabase/README.md). A bug here can misroute a page; it cannot expose
// a row the database wouldn't already return.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not remove: this call is what actually refreshes the token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login");
  const isAdminRoute = pathname.startsWith("/admin");
  const isCallerRoute = pathname.startsWith("/caller");

  if (!user) {
    if (isAdminRoute || isCallerRoute || pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      if (pathname !== "/") url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Authenticated from here on. Resolve role for routing decisions — allowed
  // by the users_select RLS policy, which always permits reading your own row.
  // full_name rides along on the same query so the dashboard layout below
  // never has to ask again.
  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active, full_name")
    .eq("id", user.id)
    .single();

  // MUST be checked before the auth-route redirect below. When it came after,
  // a deactivated user was caught in an infinite redirect loop: /login sent
  // them to /caller (they still have a valid session), /caller sent them back
  // to /login, forever. Returning `response` on /login lets them actually land
  // on the page and read the message.
  if (profile && !profile.is_active) {
    if (isAuthRoute) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "account_deactivated");
    return NextResponse.redirect(url);
  }

  // An authenticated user with no profile row should be impossible — the
  // handle_new_user trigger mirrors every auth.users insert. If it happens
  // anyway, fail closed rather than defaulting them into the caller role.
  if (!profile) {
    if (isAuthRoute) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "no_profile");
    return NextResponse.redirect(url);
  }

  const home = profile.role === "admin" ? "/admin" : "/caller";

  if (isAuthRoute || pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = home;
    return NextResponse.redirect(url);
  }

  if (isAdminRoute && profile.role !== "admin") {
    const url = request.nextUrl.clone();
    url.pathname = "/caller";
    return NextResponse.redirect(url);
  }

  // Forward what was just validated so (dashboard)/layout.tsx can read it for
  // free via headers() instead of re-running getUser() + a second profile
  // query on every navigation. Every route this layout serves is covered by
  // the matcher below, so this always runs first and overwrites whatever a
  // client sent — a request cannot forge these by sending the same header
  // names itself.
  //
  // Headers must set() (not append) onto the *request* object specifically —
  // setting them on `response.headers` would only reach the browser, not the
  // Server Component render this same request triggers. Rebuilding the
  // response here would normally drop any Set-Cookie queued by the Supabase
  // client above, so those are copied across explicitly.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-user-id", user.id);
  forwardedHeaders.set("x-user-role", profile.role);
  forwardedHeaders.set("x-user-full-name", encodeURIComponent(profile.full_name ?? ""));

  const finalResponse = NextResponse.next({ request: { headers: forwardedHeaders } });
  response.cookies.getAll().forEach((cookie) => finalResponse.cookies.set(cookie));
  return finalResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

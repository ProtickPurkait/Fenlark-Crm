import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Creates a telecaller account directly with an admin-supplied password —
// replaces the earlier email-invite flow, which depended on Supabase's
// built-in mailer (rate-limited without custom SMTP) and left the account
// unusable until the recipient found and clicked an email link. The admin
// now hands the credentials to the telecaller through whatever channel they
// already use (WhatsApp, in person, etc.).
//
// Same authorization note as the invite route this replaces: creating an
// auth user has no SECURITY DEFINER RPC behind it (auth.users lives in a
// schema our migrations don't own), so this goes through the service-role
// client — which bypasses RLS entirely. The two checks below are the ONLY
// authorization that exists for this endpoint. Do not "simplify" them.
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Ask Postgres, not the session — is_admin() also checks is_active, so a
  // deactivated admin holding a valid cookie is rejected here too.
  const { data: isAdmin, error: adminCheckError } = await supabase.rpc("is_admin");
  if (adminCheckError || !isAdmin) {
    return NextResponse.json({ error: "Admin role required." }, { status: 403 });
  }

  let body: { email?: unknown; full_name?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (fullName.length < 2) {
    return NextResponse.json({ error: "Enter the telecaller's full name." }, { status: 400 });
  }
  // Matches Supabase Auth's own default minimum — anything shorter is
  // rejected by createUser() anyway, but this gives a clean message instead
  // of surfacing that provider error verbatim.
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // email_confirm: true — there is no email step in this flow, so the
  // account must be usable immediately. full_name is read by the
  // handle_new_user() trigger out of raw_user_meta_data; role is NOT passed,
  // since the trigger hardcodes 'telecaller' and ignores client metadata —
  // promotion stays an explicit, separate admin action.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) {
    const raw = error.message.toLowerCase();
    if (raw.includes("already been registered") || raw.includes("already exists")) {
      return NextResponse.json(
        { error: "That email already has an account." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.user?.id, email: data.user?.email ?? email });
}

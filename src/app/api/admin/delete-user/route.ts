import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Permanently removes an account. Unlike admin_set_user_active (a reversible
// RPC-enforced toggle), there is no SECURITY DEFINER RPC for this — deleting
// an auth.users row isn't something Postgres RLS/RPCs can reach, since that
// table lives in a schema our migrations don't own. So, same as
// create-user/route.ts, this goes through the service-role client, and the
// checks below are the ONLY authorization gate that exists for this route.
//
// Safe by construction on the data side: leads.assigned_to and
// lead_history_logs.actor_id both use `on delete set null`, so a deleted
// telecaller's call history and audit trail survive intact — only the login
// itself disappears. public.users cascades away via its FK to auth.users,
// so no manual cleanup is needed there.
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: isAdmin, error: adminCheckError } = await supabase.rpc("is_admin");
  if (adminCheckError || !isAdmin) {
    return NextResponse.json({ error: "Admin role required." }, { status: 403 });
  }

  let body: { user_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const targetId = typeof body.user_id === "string" ? body.user_id : "";
  if (!targetId) {
    return NextResponse.json({ error: "Missing user_id." }, { status: 400 });
  }

  if (targetId === user.id) {
    return NextResponse.json(
      { error: "You cannot delete your own account." },
      { status: 400 },
    );
  }

  const { data: target, error: targetError } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", targetId)
    .single();

  if (targetError || !target) {
    return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });
  }

  // Mirrors the guard admin_set_user_active() enforces in Postgres for
  // deactivation — deleting the last active admin is worse than
  // deactivating them, since it can't be undone from inside the app at all.
  if (target.role === "admin" && target.is_active) {
    const { count } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "You cannot delete the only active admin." },
        { status: 400 },
      );
    }
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(targetId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

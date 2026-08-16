import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/current-user";
import { CallerQueueClient } from "@/components/caller/caller-queue-client";

export default async function CallerQueuePage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const [{ data: leads }, { data: settings }, { data: profile }, { data: stats }, { data: sales }] =
    await Promise.all([
      supabase
        .from("lead_queue")
        .select("*")
        .order("queue_rank", { ascending: true })
        .order("scheduled_at", { ascending: true, nullsFirst: false }),
      // app_settings, not system_settings: the full config row is admin-only
      // as of migration 1000, and this page runs under the caller's session.
      supabase.from("app_settings").select("whatsapp_template").single(),
      supabase.from("users").select("full_name").eq("id", userId).single(),
      supabase.rpc("my_dashboard_stats"),
      // RLS already scopes this to the caller's own rows. Only active
      // (pending/approved) claims — a rejected sale doesn't block the
      // "Log Sale" button from reappearing on that lead.
      supabase.from("sales").select("lead_id, status").in("status", ["pending", "approved"]),
    ]);

  const saleStatusByLead = Object.fromEntries(
    (sales ?? []).map((s) => [s.lead_id, s.status]),
  );

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">My Queue</h1>
      <CallerQueueClient
        initialLeads={leads ?? []}
        whatsappTemplate={settings?.whatsapp_template ?? ""}
        agentName={profile?.full_name ?? "Telecaller"}
        initialStats={stats?.[0] ?? null}
        initialSaleStatusByLead={saleStatusByLead}
      />
    </div>
  );
}

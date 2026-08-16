import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/current-user";
import { CallerQueueClient } from "@/components/caller/caller-queue-client";

export default async function CallerQueuePage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const [{ data: leads }, { data: settings }, { data: profile }, { data: stats }] =
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
    ]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">My Queue</h1>
      <CallerQueueClient
        initialLeads={leads ?? []}
        whatsappTemplate={settings?.whatsapp_template ?? ""}
        agentName={profile?.full_name ?? "Telecaller"}
        initialStats={stats?.[0] ?? null}
      />
    </div>
  );
}

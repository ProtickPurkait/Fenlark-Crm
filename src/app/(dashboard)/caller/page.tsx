import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/current-user";
import { CallerQueueClient } from "@/components/caller/caller-queue-client";
import { AttendanceCard } from "@/components/caller/attendance-card";

export default async function CallerQueuePage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  // Approximate: caller_clock_in/out resolve "today" against
  // system_settings.report_timezone (IST), while this is the server's UTC
  // date. The two disagree only during 18:30–23:59 UTC (00:00–05:29 IST),
  // outside normal working hours, so this stays a plain UTC date rather than
  // threading the timezone through an extra query just for this fetch.
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: leads }, { data: settings }, { data: profile }, { data: stats }, { data: sales }, { data: attendance }] =
    await Promise.all([
      supabase
        .from("lead_queue")
        .select("*")
        .order("queue_rank", { ascending: true })
        .order("scheduled_at", { ascending: true, nullsFirst: false }),
      // app_settings, not system_settings: the full config row is admin-only
      // as of migration 1000, and this page runs under the caller's session.
      supabase
        .from("app_settings")
        .select("whatsapp_template, admin_whatsapp_number, daily_report_template")
        .single(),
      supabase.from("users").select("full_name").eq("id", userId).single(),
      supabase.rpc("my_dashboard_stats"),
      // RLS already scopes this to the caller's own rows. Only active
      // (pending/approved) claims — a rejected sale doesn't block the
      // "Log Sale" button from reappearing on that lead.
      supabase.from("sales").select("lead_id, status").in("status", ["pending", "approved"]),
      supabase
        .from("attendance")
        .select("*")
        .eq("telecaller_id", userId)
        .eq("work_date", today)
        .maybeSingle(),
    ]);

  const saleStatusByLead = Object.fromEntries(
    (sales ?? []).map((s) => [s.lead_id, s.status]),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">My Queue</h1>
      <AttendanceCard
        initialAttendance={attendance}
        agentName={profile?.full_name ?? "Telecaller"}
        adminWhatsappNumber={settings?.admin_whatsapp_number ?? null}
        dailyReportTemplate={settings?.daily_report_template ?? ""}
      />
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

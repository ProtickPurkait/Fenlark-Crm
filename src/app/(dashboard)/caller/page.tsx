import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/current-user";
import { CallerQueueClient, QUEUE_PAGE_SIZE } from "@/components/caller/caller-queue-client";
import { AttendanceCard } from "@/components/caller/attendance-card";

export default async function CallerQueuePage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const [{ data: leads, count }, { data: settings }, { data: profile }, { data: stats }, { data: sales }, { data: attendance }] =
    await Promise.all([
      // Bounded, not the whole book. This used to select every lead the
      // telecaller had ever owned: at 2,000 leads that is a 1.3 MB payload on
      // the screen they keep open all day, against 35 KB for the first page.
      //
      // Closed leads are deliberately NOT filtered out — a caller's pending
      // sale badge renders on the converted lead it belongs to, so hiding
      // them would hide the sale. queue_rank already sorts them last, so they
      // fall off the first page on their own.
      supabase
        .from("lead_queue")
        .select("*", { count: "exact" })
        .order("queue_rank", { ascending: true })
        .order("scheduled_at", { ascending: true, nullsFirst: false })
        .range(0, QUEUE_PAGE_SIZE - 1),
      // app_settings, not system_settings: the full config row is admin-only
      // as of migration 1000, and this page runs under the caller's session.
      supabase
        .from("app_settings")
        .select("whatsapp_template, admin_whatsapp_number, daily_report_template, report_timezone")
        .single(),
      supabase.from("users").select("full_name").eq("id", userId).single(),
      supabase.rpc("my_dashboard_stats"),
      // RLS already scopes this to the caller's own rows. Only active
      // (pending/approved) claims — a rejected sale doesn't block the
      // "Log Sale" button from reappearing on that lead.
      supabase.from("sales").select("lead_id, status").in("status", ["pending", "approved"]),
      // Via the RPC rather than a work_date filter here: "today" belongs to
      // system_settings.report_timezone, and this server runs in UTC. Asking
      // for the UTC date returned the wrong row every day between 00:00 and
      // 05:29 IST, which is exactly when an overnight shift needs closing.
      supabase.rpc("my_current_attendance").maybeSingle(),
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
        reportTimezone={settings?.report_timezone ?? ""}
      />
      <CallerQueueClient
        initialLeads={leads ?? []}
        totalLeads={count ?? (leads?.length ?? 0)}
        whatsappTemplate={settings?.whatsapp_template ?? ""}
        agentName={profile?.full_name ?? "Telecaller"}
        initialStats={stats?.[0] ?? null}
        initialSaleStatusByLead={saleStatusByLead}
      />
    </div>
  );
}

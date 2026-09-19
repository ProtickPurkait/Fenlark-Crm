import { createClient } from "@/lib/supabase/server";
import {
  AdminDashboardClient,
  type AdminDashboardData,
} from "@/components/admin/admin-dashboard-client";
import { emptyStatusCounts, LEAD_STATUS_ORDER } from "@/lib/pipeline";
import type { LeadStatus } from "@/lib/pipeline";

// A whole day's worth of audit activity for a small team comfortably fits
// under this; the un-filtered "most recent" view keeps its original 50.
const DAY_ACTIVITY_LIMIT = 500;
const RECENT_ACTIVITY_LIMIT = 50;

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;

  // "Today" belongs to the business timezone, not this server's UTC — same
  // reasoning as the Activity page (migration 2100/2300). Read the configured
  // zone rather than hardcoding IST.
  const { data: settings } = await supabase
    .from("app_settings")
    .select("report_timezone")
    .single();
  const timeZone = settings?.report_timezone || "Asia/Kolkata";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

  const raw = typeof params.date === "string" ? params.date : "";
  const activityDate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;

  // Counts are aggregated in Postgres by admin_dashboard_summary(). This page
  // used to SELECT every lead row and count them in JavaScript, which
  // PostgREST silently truncates at 1000 rows — so past lead #1001 the funnel
  // and the reclaimed-leads total would have gone quietly wrong with no error.
  const [{ data: summaryRows }, { data: sla }, { data: recentRows }, { data: callActivityRows }] =
    await Promise.all([
      supabase.rpc("admin_dashboard_summary"),
      supabase
        .from("system_settings")
        .select("stale_recycling_enabled, stale_sla_hours")
        .single(),
      // Names are resolved inside the RPC now, rather than with two extra
      // round trips here, which also made it straightforward to add the
      // date filter (the day boundary has to be computed in Postgres against
      // report_timezone — see the function's own comment).
      supabase.rpc("admin_recent_activity", {
        p_date: activityDate,
        p_limit: activityDate ? DAY_ACTIVITY_LIMIT : RECENT_ACTIVITY_LIMIT,
      }),
      // Degrades to null rather than throwing if migration 1300 has not been
      // applied yet, so the rest of the dashboard still renders.
      supabase.rpc("admin_call_activity"),
    ]);

  const summary = summaryRows?.[0];
  const callActivity = callActivityRows?.[0];

  const statusCounts = emptyStatusCounts();
  for (const [status, n] of Object.entries(
    (summary?.status_counts ?? {}) as Record<string, number>,
  )) {
    const s = status as LeadStatus;
    if (LEAD_STATUS_ORDER.includes(s)) statusCounts[s] = n;
  }

  const data: AdminDashboardData = {
    totalLeads: summary?.total_leads ?? 0,
    unassigned: summary?.unassigned ?? 0,
    activeCallers: summary?.active_callers ?? 0,
    convertedCount: statusCounts.converted,
    statusCounts,
    slaEnabled: sla?.stale_recycling_enabled ?? false,
    slaHours: sla?.stale_sla_hours ?? 72,
    slaRevokedTotal: summary?.sla_revoked_total ?? 0,
    recent: recentRows ?? [],
  };

  return (
    <AdminDashboardClient
      data={data}
      activeCalls={callActivity?.active ?? []}
      callStats={callActivity?.stats ?? []}
      activityDate={activityDate}
      today={today}
    />
  );
}

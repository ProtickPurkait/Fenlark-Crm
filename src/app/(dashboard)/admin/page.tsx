import { createClient } from "@/lib/supabase/server";
import {
  AdminDashboardClient,
  type AdminDashboardData,
} from "@/components/admin/admin-dashboard-client";
import { emptyStatusCounts, LEAD_STATUS_ORDER } from "@/lib/pipeline";
import type { LeadStatus } from "@/lib/pipeline";

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  // Counts are aggregated in Postgres by admin_dashboard_summary(). This page
  // used to SELECT every lead row and count them in JavaScript, which
  // PostgREST silently truncates at 1000 rows — so past lead #1001 the funnel
  // and the reclaimed-leads total would have gone quietly wrong with no error.
  const [
    { data: summaryRows },
    { data: settings },
    { data: recentRows },
    { data: callActivityRows },
  ] = await Promise.all([
    supabase.rpc("admin_dashboard_summary"),
    supabase
      .from("system_settings")
      .select("stale_recycling_enabled, stale_sla_hours")
      .single(),
    supabase
      .from("lead_history_logs")
      .select("id, event_type, created_at, actor_kind, actor_id, lead_id, to_status")
      .order("created_at", { ascending: false })
      .limit(8),
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

  // Resolve actor and lead names for the activity feed in one round trip each,
  // rather than an embedded select (the audit table has no FK relationship
  // hints configured in the generated types).
  const actorIds = [
    ...new Set((recentRows ?? []).map((r) => r.actor_id).filter(Boolean)),
  ] as string[];
  const leadIds = [
    ...new Set((recentRows ?? []).map((r) => r.lead_id).filter(Boolean)),
  ] as string[];

  const [{ data: actors }, { data: leadNames }] = await Promise.all([
    actorIds.length
      ? supabase.from("telecaller_directory").select("id, full_name").in("id", actorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    leadIds.length
      ? supabase.from("leads").select("id, full_name").in("id", leadIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const actorMap = Object.fromEntries((actors ?? []).map((a) => [a.id, a.full_name]));
  const leadMap = Object.fromEntries((leadNames ?? []).map((l) => [l.id, l.full_name]));

  const data: AdminDashboardData = {
    totalLeads: summary?.total_leads ?? 0,
    unassigned: summary?.unassigned ?? 0,
    activeCallers: summary?.active_callers ?? 0,
    convertedCount: statusCounts.converted,
    statusCounts,
    slaEnabled: settings?.stale_recycling_enabled ?? false,
    slaHours: settings?.stale_sla_hours ?? 72,
    slaRevokedTotal: summary?.sla_revoked_total ?? 0,
    recent: (recentRows ?? []).map((r) => ({
      id: r.id,
      event_type: r.event_type,
      created_at: r.created_at,
      actor_kind: r.actor_kind,
      actor_name: r.actor_id ? (actorMap[r.actor_id] ?? null) : null,
      lead_name: r.lead_id ? (leadMap[r.lead_id] ?? null) : null,
      to_status: r.to_status,
    })),
  };

  return (
    <AdminDashboardClient
      data={data}
      activeCalls={callActivity?.active ?? []}
      callStats={callActivity?.stats ?? []}
    />
  );
}

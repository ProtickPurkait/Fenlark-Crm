import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/current-user";
import {
  DailyReportsClient,
  type TelecallerReportRow,
} from "@/components/admin/daily-reports-client";

export const metadata = { title: "Reports" };

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireUserId();
  const supabase = await createClient();

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const rawDate = typeof params.date === "string" ? params.date : today;
  // A malformed or hand-edited ?date= falls back to today rather than
  // reaching the query below with garbage.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today;

  const [{ data: telecallers }, { data: reports }] = await Promise.all([
    supabase
      .from("telecaller_directory")
      .select("id, full_name")
      .eq("role", "telecaller")
      .order("full_name"),
    supabase.from("daily_reports").select("*").eq("report_date", date),
  ]);

  const nameById = new Map((telecallers ?? []).map((t) => [t.id, t.full_name]));
  const reportById = new Map((reports ?? []).map((r) => [r.telecaller_id, r]));

  // Union of registered telecallers and any report's telecaller_id: a
  // telecaller with no report yet still needs a "not submitted" row, and a
  // report whose account was since deleted (telecaller_id nulled by the
  // users FK) still needs its numbers counted rather than silently dropped.
  const ids = new Set<string>([
    ...nameById.keys(),
    ...[...reportById.keys()].filter((id): id is string => id !== null),
  ]);

  const rows: TelecallerReportRow[] = [...ids]
    .map((id) => {
      const report = reportById.get(id) ?? null;
      return {
        telecaller_id: id,
        full_name: nameById.get(id) ?? "Unknown (deleted account)",
        submitted: report !== null,
        warm_leads_count: report?.warm_leads_count ?? 0,
        converted_count: report?.converted_count ?? 0,
        schedules_count: report?.schedules_count ?? 0,
        appointments_count: report?.appointments_count ?? 0,
        notes: report?.notes ?? null,
        updated_at: report?.updated_at ?? null,
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return <DailyReportsClient rows={rows} date={date} today={today} />;
}

import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/current-user";
import { DailyReportForm } from "@/components/caller/daily-report-form";

export const metadata = { title: "Daily Report" };

export default async function CallerReportPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  // Server's own clock, not the browser's — a telecaller's local date should
  // never disagree with what the RPC on the same server considers "today".
  const reportDate = new Date().toISOString().slice(0, 10);

  const { data: report } = await supabase
    .from("daily_reports")
    .select("*")
    .eq("telecaller_id", userId)
    .eq("report_date", reportDate)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-lg font-semibold">Daily Report</h1>
      <DailyReportForm reportDate={reportDate} initialReport={report} />
    </div>
  );
}

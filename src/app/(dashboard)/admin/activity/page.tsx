import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/current-user";
import { ActivityClient } from "@/components/admin/activity-client";

export const metadata = { title: "Activity" };

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireUserId();
  const supabase = await createClient();

  const params = await searchParams;

  // "Today" belongs to the business timezone, not this server's UTC — the same
  // trap that made the caller page read the wrong attendance row (migration
  // 2100). Read the configured zone rather than hardcoding IST, so an admin
  // who changes it in Settings gets a consistent answer everywhere.
  const { data: settings } = await supabase
    .from("app_settings")
    .select("report_timezone")
    .single();
  const timeZone = settings?.report_timezone || "Asia/Kolkata";

  // en-CA formats as YYYY-MM-DD, which is exactly what a date column and a
  // <input type="date"> both want.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

  const raw = typeof params.date === "string" ? params.date : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;

  const { data: rows } = await supabase.rpc("admin_telecaller_activity", {
    p_date: date,
  });

  return (
    <ActivityClient
      rows={rows ?? []}
      date={date}
      today={today}
      timeZone={timeZone}
    />
  );
}

import type { DailyReportLead } from "@/lib/supabase/database.types";

/**
 * Renders one of my_daily_report_summary()'s lead lists as numbered plain
 * text for a WhatsApp message. scheduled_at (schedules/appointments only) is
 * shown as a plain date, not a time — a telecaller's own note or the client
 * call covers the time; the report just needs which day.
 */
export function formatLeadList(items: DailyReportLead[]): string {
  if (items.length === 0) return "None";
  return items
    .map((item, i) => {
      const when = item.scheduled_at
        ? ` — ${new Date(item.scheduled_at).toLocaleDateString()}`
        : "";
      return `${i + 1}. ${item.full_name} (${item.phone})${when}`;
    })
    .join("\n");
}

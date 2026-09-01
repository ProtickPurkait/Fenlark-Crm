import { fillTemplate } from "@/lib/phone";
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

/**
 * The structure the report falls back to when the stored template predates
 * the detail lists (migration 2000) — i.e. it still asks only for counts.
 *
 * Kept in code, not only in the database default, because the two can drift:
 * an admin who customised their template before 2000 never receives the new
 * one, and a report that silently omits the lead names is the exact failure
 * this fallback exists to prevent.
 */
const DEFAULT_TEMPLATE = [
  "Daily Report — {{date}}",
  "Telecaller: {{agent}}",
  "",
  "Warm leads ({{warm_count}}):",
  "{{warm}}",
  "",
  "Converted ({{converted_count}}):",
  "{{converted}}",
  "",
  "Schedules ({{schedules_count}}):",
  "{{schedules}}",
  "",
  "Appointments ({{appointments_count}}):",
  "{{appointments}}",
].join("\n");

/** Both shapes my_daily_report_summary() has returned: lists (migration 2000)
 *  and the bare counts it returned before that. Accepting both means a
 *  frontend and database that are briefly out of step with each other still
 *  produce a correct report rather than the word "undefined". */
interface ReportSummaryRow {
  warm_leads?: DailyReportLead[] | null;
  converted?: DailyReportLead[] | null;
  schedules?: DailyReportLead[] | null;
  appointments?: DailyReportLead[] | null;
  warm_leads_count?: number | null;
  converted_count?: number | null;
  schedules_count?: number | null;
  appointments_count?: number | null;
}

function section(
  list: DailyReportLead[] | null | undefined,
  fallbackCount: number | null | undefined,
): { text: string; count: string } {
  if (Array.isArray(list)) {
    return { text: formatLeadList(list), count: String(list.length) };
  }
  // Pre-2000 shape: a count with no names behind it. Report the number
  // honestly rather than inventing a list.
  const n = fallbackCount ?? 0;
  return { text: n === 0 ? "None" : `${n} (details unavailable)`, count: String(n) };
}

/**
 * Builds the finished WhatsApp message body.
 *
 * A stored template that never mentions {{warm}} is treated as stale and
 * replaced with DEFAULT_TEMPLATE: an admin who has not re-saved their
 * settings since the lists shipped should still get the lists, not a report
 * that quietly drops them.
 */
export function buildReportMessage(
  template: string,
  data: ReportSummaryRow,
  meta: { date: string; agent: string },
): string {
  const warm = section(data.warm_leads, data.warm_leads_count);
  const converted = section(data.converted, data.converted_count);
  const schedules = section(data.schedules, data.schedules_count);
  const appointments = section(data.appointments, data.appointments_count);

  const usable = template.includes("{{warm}}") ? template : DEFAULT_TEMPLATE;

  return fillTemplate(usable, {
    date: meta.date,
    agent: meta.agent,
    warm: warm.text,
    warm_count: warm.count,
    converted: converted.text,
    converted_count: converted.count,
    schedules: schedules.text,
    schedules_count: schedules.count,
    appointments: appointments.text,
    appointments_count: appointments.count,
  });
}

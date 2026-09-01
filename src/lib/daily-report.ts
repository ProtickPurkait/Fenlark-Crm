import { fillTemplate } from "@/lib/phone";
import type { DailyReportLead } from "@/lib/supabase/database.types";

/** Fallback when the caller page could not read system_settings.report_timezone. */
export const DEFAULT_REPORT_TIMEZONE = "Asia/Kolkata";

/**
 * Formats an appointment date for the report.
 *
 * Both the locale and the timezone are pinned deliberately. A bare
 * toLocaleDateString() resolves against the *device*, so the same appointment
 * rendered on two telecallers' phones produced two different dates (an 19:30
 * UTC slot is the 4th in IST and the 3rd in UTC), and the day/month order
 * followed whatever the handset was set to — leaving an admin unable to tell
 * 4 September from 9 April. This is a report people book real meetings from,
 * so it renders one way everywhere: the business's own timezone, and a
 * spelled-out month that cannot be read back-to-front.
 */
export function formatReportDate(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Formats attendance.work_date, which is already a calendar date in the
 * business's timezone, for the report header.
 *
 * Built through Date.UTC and rendered back in UTC on purpose: converting a
 * bare "2026-09-01" through any other zone shifts it a day west of UTC, and
 * this value has no time component to convert in the first place.
 */
export function formatWorkDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const [, y, mo, d] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).toLocaleDateString(
    "en-IN",
    { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" },
  );
}

/**
 * Renders one of my_daily_report_summary()'s lead lists as numbered plain
 * text for a WhatsApp message. scheduled_at (schedules/appointments only) is
 * shown as a plain date, not a time — a telecaller's own note or the client
 * call covers the time; the report just needs which day.
 */
export function formatLeadList(
  items: DailyReportLead[],
  timeZone: string = DEFAULT_REPORT_TIMEZONE,
): string {
  if (items.length === 0) return "None";
  return items
    .map((item, i) => {
      const when = item.scheduled_at
        ? ` — ${formatReportDate(item.scheduled_at, timeZone)}`
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
  timeZone: string,
): { text: string; count: string } {
  if (Array.isArray(list)) {
    return { text: formatLeadList(list, timeZone), count: String(list.length) };
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
  meta: { date: string; agent: string; timeZone?: string },
): string {
  const tz = meta.timeZone || DEFAULT_REPORT_TIMEZONE;
  const warm = section(data.warm_leads, data.warm_leads_count, tz);
  const converted = section(data.converted, data.converted_count, tz);
  const schedules = section(data.schedules, data.schedules_count, tz);
  const appointments = section(data.appointments, data.appointments_count, tz);

  const usable = template.includes("{{warm}}") ? template : DEFAULT_TEMPLATE;

  return fillTemplate(usable, {
    date: formatWorkDate(meta.date),
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

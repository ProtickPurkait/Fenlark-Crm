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
  maxItems?: number,
): string {
  if (items.length === 0) return "None";
  const shown = maxItems && items.length > maxItems ? items.slice(0, maxItems) : items;
  const lines = shown.map((item, i) => {
    const when = item.scheduled_at
      ? ` — ${formatReportDate(item.scheduled_at, timeZone)}`
      : "";
    return `${i + 1}. ${item.full_name} (${item.phone})${when}`;
  });
  const omitted = items.length - shown.length;
  if (omitted > 0) {
    // Not silent truncation: the header count (see section() below) still
    // reports every item, so a list that stops short of it needs to say why.
    lines.push(`…and ${omitted} more`);
  }
  return lines.join("\n");
}

/**
 * The starting-point template offered to a brand-new admin, and the only
 * thing substituted in when the stored template is missing or blank.
 *
 * It is NOT applied to a template that is merely unusual — a template an
 * admin deliberately wrote that skips the lead-list tokens used to be
 * silently replaced with this one, every single time, forever. That meant an
 * admin who wanted a shorter report (say, just the counts) could never
 * actually have one: whatever they saved, the message that shipped was this
 * one. A template the admin chose to save is what they get; see
 * templateOmitsLeadLists() below for how the UI now surfaces that choice's
 * consequence instead of overriding it.
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
  maxItems?: number,
): { text: string; count: string } {
  if (Array.isArray(list)) {
    // count is always the true total, even when the printed text is capped —
    // "Appointments (37):" must stay an honest number regardless of how many
    // of the 37 actually get listed underneath it.
    return { text: formatLeadList(list, timeZone, maxItems), count: String(list.length) };
  }
  // Pre-2000 shape: a count with no names behind it. Report the number
  // honestly rather than inventing a list.
  const n = fallbackCount ?? 0;
  return { text: n === 0 ? "None" : `${n} (details unavailable)`, count: String(n) };
}

/** Every token that expands to a list of leads by name, rather than a bare
 *  count. Kept as one list because buildReportMessage() and
 *  templateOmitsLeadLists() both have to agree on exactly what "mentions the
 *  lead lists" means — drift between them would reopen the bug this file
 *  exists to close. */
const LEAD_LIST_TOKENS = ["{{warm}}", "{{converted}}", "{{schedules}}", "{{appointments}}"] as const;

/**
 * Cap on how many appointments a report actually lists by name.
 *
 * The other three lists — warm, converted, schedules — are naturally
 * bounded: each can only ever hold what one telecaller did in one calendar
 * day. Appointments is not scoped to today at all (see the header comment on
 * my_daily_report_summary() in the migrations) — it is "everything still
 * ahead of me", which only grows as a telecaller keeps booking. At 120 items
 * that section alone measured out to roughly 9KB of encoded WhatsApp URL,
 * long past the point of being read on a phone. 15 keeps the message to a
 * size someone will actually open and scan; the header count and the
 * trailing "…and N more" line in formatLeadList() keep the real total
 * honest regardless.
 */
const MAX_APPOINTMENTS_SHOWN = 15;

/**
 * True when a template will never print a single lead's name — every list
 * token is absent, so whatever it does say, it can only ever report counts.
 *
 * Used by the Settings screen to tell an admin what their template actually
 * does, since buildReportMessage() below no longer silently rewrites it for
 * them. Not an error: an admin may want exactly this, a short report with
 * just the numbers. It's an FYI, not a block.
 */
export function templateOmitsLeadLists(template: string): boolean {
  return !LEAD_LIST_TOKENS.some((token) => template.includes(token));
}

/**
 * Builds the finished WhatsApp message body.
 *
 * The template is used exactly as the admin saved it. It used to be
 * discarded and swapped for DEFAULT_TEMPLATE whenever it didn't mention
 * {{warm}} — meant to upgrade a template saved before the lead lists existed
 * (migration 2000 already handles that, once, at the database level, for
 * every row still on the exact old default), but it could not tell that case
 * apart from an admin who had deliberately written a shorter template, and
 * silently overrode that choice every time the report was sent. Only a
 * template that is empty or unset falls back to DEFAULT_TEMPLATE now — never
 * one that is merely short.
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
  const appointments = section(data.appointments, data.appointments_count, tz, MAX_APPOINTMENTS_SHOWN);

  const usable = template.trim() === "" ? DEFAULT_TEMPLATE : template;

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

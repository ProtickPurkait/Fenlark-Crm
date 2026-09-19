-- ============================================================================
-- Trace · 2500 — Relabel the report's Appointments section
-- ============================================================================
-- Every other section in the daily report is scoped to the report's own
-- date — "Warm leads" means warm leads *on that date*. Appointments never
-- was: my_daily_report_summary() (2000) deliberately returns the live
-- backlog "as of now", not "as of the report date", because that is the
-- number a telecaller actually needs — see that function's own header
-- comment. The behaviour was correct; the label just didn't say so, so a
-- report dated three weeks ago still listed today's appointments under a
-- header that read exactly like the other three, with nothing to explain
-- the mismatch.
--
-- Same pattern as migration 2000's own template upgrade: applied only to a
-- row whose template still matches the current default text exactly, so an
-- admin who has customised their message is never touched.
-- ============================================================================

update public.system_settings
   set daily_report_template =
    'Daily Report — {{date}}' || chr(10) ||
    'Telecaller: {{agent}}' || chr(10) || chr(10) ||
    'Warm leads ({{warm_count}}):' || chr(10) || '{{warm}}' || chr(10) || chr(10) ||
    'Converted ({{converted_count}}):' || chr(10) || '{{converted}}' || chr(10) || chr(10) ||
    'Schedules ({{schedules_count}}):' || chr(10) || '{{schedules}}' || chr(10) || chr(10) ||
    'Upcoming appointments — as of today ({{appointments_count}}):' || chr(10) || '{{appointments}}'
 where id = true
   and daily_report_template =
    'Daily Report — {{date}}' || chr(10) ||
    'Telecaller: {{agent}}' || chr(10) || chr(10) ||
    'Warm leads ({{warm_count}}):' || chr(10) || '{{warm}}' || chr(10) || chr(10) ||
    'Converted ({{converted_count}}):' || chr(10) || '{{converted}}' || chr(10) || chr(10) ||
    'Schedules ({{schedules_count}}):' || chr(10) || '{{schedules}}' || chr(10) || chr(10) ||
    'Appointments ({{appointments_count}}):' || chr(10) || '{{appointments}}';

alter table public.system_settings
  alter column daily_report_template set default
    'Daily Report — {{date}}' || chr(10) ||
    'Telecaller: {{agent}}' || chr(10) || chr(10) ||
    'Warm leads ({{warm_count}}):' || chr(10) || '{{warm}}' || chr(10) || chr(10) ||
    'Converted ({{converted_count}}):' || chr(10) || '{{converted}}' || chr(10) || chr(10) ||
    'Schedules ({{schedules_count}}):' || chr(10) || '{{schedules}}' || chr(10) || chr(10) ||
    'Upcoming appointments — as of today ({{appointments_count}}):' || chr(10) || '{{appointments}}';

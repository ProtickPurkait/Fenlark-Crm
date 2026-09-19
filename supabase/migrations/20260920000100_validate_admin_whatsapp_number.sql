-- ============================================================================
-- Trace · 2400 — Validate the admin's daily-report WhatsApp number
-- ============================================================================
-- admin_update_settings() (1900) stored admin_whatsapp_number verbatim,
-- whatever it was given — "not-a-number", "123", stray HTML, anything. The
-- Generate Report button only checked the value was non-null, so it stayed
-- enabled and produced a wa.me link with no valid destination: a telecaller
-- taps it, WhatsApp opens on nothing, and neither of them can tell why.
--
-- Fixed in one place, the write path, using the same normalize_phone() every
-- lead phone number already goes through — a second bespoke validation rule
-- here would be one more place to keep in sync.
--
-- Storage changes from raw text to the canonical 10-digit form. This is safe:
-- toWhatsAppNumber() on the frontend already renormalizes whatever it reads
-- before building the wa.me link, so every existing caller of this value
-- keeps working unchanged — it will just never again read something that
-- fails to normalize into a real number.
-- ============================================================================

create or replace function public.admin_update_settings(
  p_enabled               boolean default null,
  p_sla_hours             integer default null,
  p_whatsapp_template     text    default null,
  p_admin_whatsapp_number text    default null,
  p_daily_report_template text    default null
)
returns public.system_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.system_settings;
  v_wa   text;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if p_sla_hours is not null and p_sla_hours not between 1 and 720 then
    raise exception 'SLA hours must be between 1 and 720 (30 days)';
  end if;

  -- Same three-way logic as before: null means "leave it alone", an empty
  -- string means "clear it" (a deliberate action — the Generate Report button
  -- disables itself without a destination), and anything else must normalize
  -- to a real 10-digit Indian mobile number or the save is rejected outright.
  -- Validating before the update, not inside it, means a bad number never
  -- touches the row — the admin's previous working number stays in place.
  if p_admin_whatsapp_number is not null then
    v_wa := nullif(btrim(p_admin_whatsapp_number), '');
    if v_wa is not null then
      v_wa := public.normalize_phone(v_wa);
      if length(v_wa) <> 10 then
        raise exception
          'WhatsApp number must be a valid 10-digit mobile number'
          using errcode = '22023'; -- invalid_parameter_value
      end if;
    end if;
  end if;

  update public.system_settings
     set stale_recycling_enabled = coalesce(p_enabled, stale_recycling_enabled),
         stale_sla_hours         = coalesce(p_sla_hours, stale_sla_hours),
         whatsapp_template       = coalesce(
                                     nullif(btrim(p_whatsapp_template), ''),
                                     whatsapp_template
                                   ),
         -- v_wa is null both when the caller passed no change (p_...number is
         -- null) and when they asked to clear it (btrim'd to ''); the case
         -- below is what tells those two apart, exactly as before.
         admin_whatsapp_number   = case
                                     when p_admin_whatsapp_number is null then admin_whatsapp_number
                                     else v_wa
                                   end,
         daily_report_template   = coalesce(
                                     nullif(btrim(p_daily_report_template), ''),
                                     daily_report_template
                                   ),
         updated_by              = auth.uid()
   where id = true
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function public.admin_update_settings(boolean, integer, text, text, text) from public, anon;
grant execute on function public.admin_update_settings(boolean, integer, text, text, text) to authenticated;

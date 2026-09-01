// Mirrors public.normalize_phone() in
// supabase/migrations/20260814000200_tables.sql EXACTLY. If you change the
// rule in one place, change it in the other — see the README section
// "Changing phone normalisation" for why a mismatch is dangerous (the UI
// would report a clean CSV import while the database silently drops rows).

/** Canonicalises a phone number to its bare 10-digit Indian national form. */
export function normalizePhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/[^0-9]/g, "");

  if (digits.length === 12 && digits.slice(0, 2) === "91") {
    return digits.slice(-10);
  }
  if (digits.length === 11 && digits.slice(0, 1) === "0") {
    return digits.slice(-10);
  }
  return digits;
}

/** wa.me requires the country code with no leading +, spaces or punctuation. */
export function toWhatsAppNumber(phone: string): string {
  const national = normalizePhone(phone);
  return national.length === 10 ? `91${national}` : national;
}

/**
 * Substitutes {{name}} / {{agent}} placeholders in the configurable template.
 *
 * A key that is present but holds undefined/null renders as an empty string,
 * never the word "undefined". Without this, a template token whose value went
 * missing (a renamed RPC field, a half-deployed frontend) silently shipped
 * literal "undefined" into a customer-facing WhatsApp message.
 */
export function fillTemplate(
  template: string,
  vars: Record<string, string | undefined | null>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in vars ? (vars[key] ?? "") : match,
  );
}

export function buildWhatsAppLink(
  phone: string,
  template: string,
  vars: Record<string, string | undefined | null>,
): string {
  const number = toWhatsAppNumber(phone);
  const text = encodeURIComponent(fillTemplate(template, vars));
  return `https://wa.me/${number}?text=${text}`;
}

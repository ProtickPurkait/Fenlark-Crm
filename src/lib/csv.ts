// Minimal RFC-4180 CSV reader and writer.
//
// Hand-rolled rather than pulling in papaparse: lead CSVs are small, and the
// only tricky parts (quoted fields containing commas or newlines, and the ""
// escape for a literal quote) are ~30 lines. No dependency, no bundle cost.

import { normalizePhone } from "@/lib/phone";

/**
 * Serializes rows into RFC-4180 CSV text, quoting only where needed and
 * doubling embedded quotes. Leads with a UTF-8 BOM so Excel — which
 * guesses encoding from the first bytes rather than reading the file as
 * UTF-8 by default — renders names like "Café" correctly instead of
 * mangling them.
 */
export function toCsv(rows: (string | number)[][]): string {
  const escape = (cell: string | number) => {
    const s = String(cell);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((row) => row.map(escape).join(",")).join("\r\n");
}

/** Triggers a browser download of `text` as a file named `filename`. */
export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Splits raw CSV text into rows of raw cell strings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM — Excel adds one, and it would otherwise become part of
  // the first header name ("﻿name"), silently breaking column matching.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      // Treat \r\n as one break, not two.
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  // Flush the trailing cell/row unless the file ended on a clean newline.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

/**
 * Column aliases accepted in an uploaded header row, normalised to our keys.
 *
 * Originally exactly four fields — business name, contact, category,
 * address — because every lead here is a business, not an individual, with
 * no email/city/company/notes columns. Extended for the website-audit
 * research pipeline: each lead already comes with a cold-call angle baked
 * in (what's wrong with their current web presence), so that has to survive
 * the import rather than being dropped on the floor.
 */
const HEADER_ALIASES: Record<string, string> = {
  name: "full_name",
  "full name": "full_name",
  full_name: "full_name",
  fullname: "full_name",
  lead: "full_name",
  "lead name": "full_name",
  contact: "full_name",
  "business name": "full_name",

  phone: "phone",
  mobile: "phone",
  "phone number": "phone",
  phone_number: "phone",
  number: "phone",
  contact_number: "phone",
  "contact number": "phone",
  "business contact": "phone",
  whatsapp: "phone",

  // What kind of business this is (cafe, restaurant, interior decor, ...) —
  // free text, not a fixed list, so a telecaller always has some context
  // before dialling even for a category no one anticipated.
  business_type: "business_type",
  "business type": "business_type",
  "business category": "business_type",
  type: "business_type",
  category: "business_type",

  address: "address",
  "business address": "address",
  "street address": "address",
  location: "address",

  website: "website",
  "website url": "website",
  "website link": "website",
  "business website": "website",
  url: "website",

  observed_opportunity: "observed_opportunity",
  "observed opportunity": "observed_opportunity",
  opportunity: "observed_opportunity",
  "sales opportunity": "observed_opportunity",
  "sales angle": "observed_opportunity",

  website_issues: "website_issues",
  "website issues": "website_issues",
  "website issue": "website_issues",
  issues: "website_issues",
  "technical issues": "website_issues",
};

export const IMPORT_FIELDS = [
  "full_name",
  "phone",
  "business_type",
  "address",
  "website",
  "observed_opportunity",
  "website_issues",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportRow = Partial<Record<ImportField, string>> & {
  /**
   * A second phone number from the same cell as `phone` (see
   * splitPhoneNumbers below). Not header-mapped — there is no separate
   * "alternate phone" column in the source sheet — so it never appears in
   * HEADER_ALIASES/IMPORT_FIELDS; parseLeadCsv fills it in by splitting the
   * phone cell itself.
   */
  alternate_phone?: string;
};

/**
 * A `website` cell carries one of three things in practice: a real URL, a
 * blank (not yet checked), or one of a handful of stock phrases the research
 * process uses for "checked, there isn't one". Storing that phrase as if it
 * were a website is worse than storing nothing — the UI already has a
 * dedicated "no website found" state (see call-disposition-drawer.tsx), and
 * observed_opportunity/website_issues carry the actual explanation.
 */
const NO_WEBSITE_SENTINELS = new Set([
  "none found", "not found", "none", "n/a", "na",
  "no website", "no website found", "-", "n.a.",
]);

export interface CsvParseResult {
  rows: ImportRow[];
  /** Header cells we could not map to a known field — shown so the admin can
   *  see what was ignored rather than wondering why a column vanished. */
  unmappedHeaders: string[];
  /** Rows dropped before reaching the server, with the reason. */
  rejected: { line: number; reason: string }[];
  matchedHeaders: Partial<Record<ImportField, string>>;
  /** Rows whose phone cell held more than one number (the common case is a
   *  landline alongside a mobile, or two owners' numbers). Shown so the
   *  admin can see which number became primary at a glance, rather than
   *  discovering it only by opening the lead later. */
  multiPhone: { line: number; raw: string; primary: string; alternates: string[] }[];
}

/**
 * Splits a phone cell that may hold more than one number. The overwhelming
 * majority of rows have exactly one — this is a no-op for those, returning
 * the cell untouched as `primary` with no alternates.
 *
 * When there's more than one, the first number plausible enough to pass the
 * same length check the database applies (normalize_phone(...) 7-15 digits —
 * see leads_phone_plausible in 0200_tables.sql) becomes `primary`: that's
 * the one that drives dialling, dedup and the phone_normalized unique index,
 * so it must be something the database will actually accept. The rest ride
 * along as `alternates` — informational only, never deduped or validated as
 * strictly, surfaced to the telecaller as "also try this number" rather than
 * silently discarded.
 */
function splitPhoneNumbers(raw: string): { primary: string; alternates: string[] } {
  const parts = raw
    .split(/[;,/]| and | or /i)
    .map((p) => p.trim())
    .filter((p) => p !== "");

  if (parts.length <= 1) return { primary: raw.trim(), alternates: [] };

  const plausible = parts.filter((p) => {
    const n = normalizePhone(p).length;
    return n >= 7 && n <= 15;
  });
  const ordered = plausible.length > 0 ? plausible : parts;
  const [primary, ...alternates] = ordered;
  return { primary, alternates };
}

/**
 * Reads a lead CSV into the shape `admin_import_leads(p_rows jsonb)` expects.
 *
 * Rows missing a name or phone are rejected here so the admin sees the line
 * numbers. The database still enforces the same rules — this is a preview, not
 * the validation boundary.
 */
export function parseLeadCsv(text: string): CsvParseResult {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));

  if (table.length === 0) {
    return { rows: [], unmappedHeaders: [], rejected: [], matchedHeaders: {}, multiPhone: [] };
  }

  const header = table[0].map((h) => h.trim());
  const unmappedHeaders: string[] = [];
  const matchedHeaders: Partial<Record<ImportField, string>> = {};

  // index in the CSV row -> our field name
  const columnMap = new Map<number, ImportField>();
  header.forEach((raw, i) => {
    const key = HEADER_ALIASES[raw.toLowerCase().trim()];
    if (key) {
      const field = key as ImportField;
      // First matching column wins; a duplicate would otherwise overwrite it.
      if (!(field in matchedHeaders)) {
        columnMap.set(i, field);
        matchedHeaders[field] = raw;
      } else {
        unmappedHeaders.push(`${raw} (duplicate of ${field})`);
      }
    } else if (raw !== "") {
      unmappedHeaders.push(raw);
    }
  });

  const rows: ImportRow[] = [];
  const rejected: { line: number; reason: string }[] = [];
  const multiPhone: { line: number; raw: string; primary: string; alternates: string[] }[] = [];

  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const row: ImportRow = {};

    for (const [i, field] of columnMap) {
      const v = (cells[i] ?? "").trim();
      if (v !== "") row[field] = v;
    }

    // +1 because `r` is zero-based and row 0 was the header.
    const line = r + 1;
    if (!row.full_name) {
      rejected.push({ line, reason: "no name" });
      continue;
    }
    if (!row.phone) {
      rejected.push({ line, reason: "no phone" });
      continue;
    }

    const rawPhone = row.phone;
    const { primary, alternates } = splitPhoneNumbers(rawPhone);
    if (alternates.length > 0) {
      row.phone = primary;
      row.alternate_phone = alternates.join(", ");
      multiPhone.push({ line, raw: rawPhone, primary, alternates });
    }

    if (row.website && NO_WEBSITE_SENTINELS.has(row.website.toLowerCase().trim())) {
      delete row.website;
    }

    rows.push(row);
  }

  return { rows, unmappedHeaders, rejected, matchedHeaders, multiPhone };
}

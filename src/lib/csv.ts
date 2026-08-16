// Minimal RFC-4180 CSV reader.
//
// Hand-rolled rather than pulling in papaparse: lead CSVs are small, and the
// only tricky parts (quoted fields containing commas or newlines, and the ""
// escape for a literal quote) are ~30 lines. No dependency, no bundle cost.

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
 * Deliberately exactly four fields — business name, contact, category,
 * address. Every lead here is a business, not an individual, so that's the
 * whole shape: no email, city, company or notes columns.
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
};

export const IMPORT_FIELDS = [
  "full_name",
  "phone",
  "business_type",
  "address",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportRow = Partial<Record<ImportField, string>>;

export interface CsvParseResult {
  rows: ImportRow[];
  /** Header cells we could not map to a known field — shown so the admin can
   *  see what was ignored rather than wondering why a column vanished. */
  unmappedHeaders: string[];
  /** Rows dropped before reaching the server, with the reason. */
  rejected: { line: number; reason: string }[];
  matchedHeaders: Partial<Record<ImportField, string>>;
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
    return { rows: [], unmappedHeaders: [], rejected: [], matchedHeaders: {} };
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
    rows.push(row);
  }

  return { rows, unmappedHeaders, rejected, matchedHeaders };
}

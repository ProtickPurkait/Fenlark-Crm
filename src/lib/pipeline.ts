import type { LeadStatus } from "@/lib/supabase/database.types";

export type { LeadStatus };

/**
 * Canonical pipeline order, matching the declaration order of the
 * `lead_status` enum in supabase/migrations/..._extensions_enums.sql.
 * Anything rendering the funnel should iterate this rather than
 * Object.keys() on a counts map, which has no guaranteed order.
 */
export const LEAD_STATUS_ORDER: LeadStatus[] = [
  "new",
  "attempted",
  "connected",
  "warm",
  "rescheduled",
  "converted",
  "dead",
];

export function emptyStatusCounts(): Record<LeadStatus, number> {
  return {
    new: 0,
    attempted: 0,
    connected: 0,
    warm: 0,
    rescheduled: 0,
    converted: 0,
    dead: 0,
  };
}

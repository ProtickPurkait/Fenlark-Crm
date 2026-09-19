import type { LeadStatus } from "@/lib/supabase/database.types";

export type { LeadStatus };

/**
 * Canonical pipeline order, matching the declaration order of the
 * `lead_status` enum in supabase/migrations/..._extensions_enums.sql.
 * Anything rendering the funnel should iterate this rather than
 * Object.keys() on a counts map, which has no guaranteed order.
 */
/**
 * Rows the telecaller queue fetches per request.
 *
 * Lives here, not in caller-queue-client.tsx, because the /caller server
 * component needs it for its first page. A "use client" module's exports
 * reach the server as client-reference proxies rather than their values, so
 * importing this from there compiled to `.range(0, <proxy> - 1)` — NaN — and
 * the page rendered "Showing 0 of 1006 leads" while the count query happily
 * reported the real total. Neither tsc nor the build can catch that: the type
 * is still `number` and the transform is legal. Keep it in a plain module.
 */
export const QUEUE_PAGE_SIZE = 100;

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

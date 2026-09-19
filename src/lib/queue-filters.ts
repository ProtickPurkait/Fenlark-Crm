// Filters for the telecaller queue.
//
// A PLAIN module on purpose — no "use client". The /caller server component
// fetches the first page and the client component fetches every page after
// it, so both sides import from here. A constant or helper that lives in a
// "use client" module reaches the server as a client-reference proxy rather
// than its value, which is what silently emptied the queue once already (see
// the note on QUEUE_PAGE_SIZE in pipeline.ts).
//
// Both sides also have to build the *same* query. If the server's first page
// and the client's "Load more" applied filters differently, page two would
// come from a different result set than page one — so the filtering lives in
// one function that all three call sites share.
import { LEAD_STATUS_ORDER, type LeadStatus } from "@/lib/pipeline";

/** Follow-up urgency, expressed over lead_queue.follow_up_bucket so the
 *  definition of "overdue" stays in the view and cannot drift from what the
 *  FollowUpBadge shows on the card. */
export const DUE_FILTERS = {
  overdue: { label: "Overdue", buckets: ["overdue"] },
  today: { label: "Due today", buckets: ["due_soon", "due_today"] },
  unscheduled: { label: "No follow-up", buckets: ["unscheduled"] },
} as const;

export type DueFilter = keyof typeof DUE_FILTERS;

export interface QueueFilters {
  /** "" means every status. */
  status: LeadStatus | "";
  /** "" means every follow-up state. */
  due: DueFilter | "";
}

export const EMPTY_QUEUE_FILTERS: QueueFilters = { status: "", due: "" };

/** Telecaller-facing names. "Callback" rather than "Rescheduled" because that
 *  is what callers actually say; the disposition drawer already bridges the
 *  two with "Rescheduled / Call Back". */
export const STATUS_FILTER_LABELS: Record<LeadStatus, string> = {
  new: "New",
  attempted: "Attempted",
  connected: "Connected",
  warm: "Warm",
  rescheduled: "Callback",
  converted: "Converted",
  dead: "Dead",
};

/** Statuses worth offering a telecaller, in queue order. */
export const QUEUE_STATUS_FILTERS: LeadStatus[] = [...LEAD_STATUS_ORDER];

/** Narrows whatever arrived in the URL to something the query can trust. */
export function parseQueueFilters(params: {
  [key: string]: string | string[] | undefined;
}): QueueFilters {
  const rawStatus = typeof params.status === "string" ? params.status : "";
  const rawDue = typeof params.due === "string" ? params.due : "";
  return {
    status: LEAD_STATUS_ORDER.find((s) => s === rawStatus) ?? "",
    due: rawDue in DUE_FILTERS ? (rawDue as DueFilter) : "",
  };
}

/** Structural shape rather than PostgrestFilterBuilder's full generics: this
 *  only ever narrows, and typing it this way keeps the helper readable. */
interface QueryLike {
  eq(column: string, value: string): QueryLike;
  in(column: string, values: readonly string[]): QueryLike;
}

/** The one place the queue's filters become a query. Called by the server
 *  page, by refetch() and by loadMore(). */
export function applyQueueFilters<T extends QueryLike>(query: T, filters: QueueFilters): T {
  let q: QueryLike = query;
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.due) q = q.in("follow_up_bucket", DUE_FILTERS[filters.due].buckets);
  return q as T;
}

/** True when anything is narrowing the queue — drives the "clear" affordance
 *  and the empty-state wording, which must not say "your queue is clear" when
 *  the queue is full and a filter is simply hiding it. */
export function hasActiveQueueFilter(f: QueueFilters): boolean {
  return Boolean(f.status || f.due);
}

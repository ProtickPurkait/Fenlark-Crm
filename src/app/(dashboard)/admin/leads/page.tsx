import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/current-user";
import { LeadsClient, type AdminLeadRow } from "@/components/admin/leads-client";
import { LEAD_STATUS_ORDER } from "@/lib/pipeline";

export const metadata = { title: "Leads" };

// Bulk actions (assign, round-robin, archive) operate on whatever is
// currently loaded and selected — a bigger page size is how an admin
// batches a bulk delete/assign across hundreds or thousands of leads at
// once, not a separate "select N" control. 50 stays the default so a normal
// day-to-day visit doesn't render thousands of rows nobody asked for.
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 1000, 2000, 5000] as const;
const DEFAULT_PAGE_SIZE = 50;

// Server Component: owns the URL (filters live in the query string, so a
// filtered view is shareable/bookmarkable and survives a refresh) and the
// first data fetch. Everything interactive after that — selection, the
// import panel, assignment — is client-side in LeadsClient.
export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireUserId();
  const supabase = await createClient();

  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "all";
  const assignment = typeof params.assignment === "string" ? params.assignment : "all";
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const page = Math.max(1, Number(params.page) || 1);
  const sort = params.sort === "asc" ? "asc" : "desc";
  const pageSize =
    PAGE_SIZE_OPTIONS.find((n) => n === Number(params.pageSize)) ?? DEFAULT_PAGE_SIZE;

  let query = supabase
    .from("leads")
    .select(
      "id, full_name, phone, email, city, company, business_type, address, status, assigned_to, scheduled_at, last_remark, sla_revoked_count, created_at",
      { count: "exact" },
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: sort === "asc" });

  const statusFilter = LEAD_STATUS_ORDER.find((s) => s === status);
  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }
  if (assignment === "unassigned") query = query.is("assigned_to", null);
  if (assignment === "assigned") query = query.not("assigned_to", "is", null);

  if (q) {
    // Phone search matches on digits typed, name search is a simple ilike —
    // good enough at CRM-lead volumes without adding full-text search.
    const digits = q.replace(/[^0-9]/g, "");
    query =
      digits.length >= 4
        ? query.ilike("phone", `%${digits}%`)
        : query.ilike("full_name", `%${q}%`);
  }

  const from = (page - 1) * pageSize;
  const { data: leads, count } = await query.range(from, from + pageSize - 1);

  const assignedIds = [
    ...new Set((leads ?? []).map((l) => l.assigned_to).filter(Boolean)),
  ] as string[];

  const [{ data: assignees }, { data: telecallers }] = await Promise.all([
    assignedIds.length
      ? supabase.from("telecaller_directory").select("id, full_name").in("id", assignedIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    // Every active telecaller, for the assignment dropdown and round-robin —
    // fetched regardless of the current filter so switching filters doesn't
    // need a second round trip.
    supabase
      .from("telecaller_directory")
      .select("id, full_name, is_active")
      .eq("role", "telecaller")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
  ]);

  const assigneeMap = Object.fromEntries((assignees ?? []).map((a) => [a.id, a.full_name]));

  const rows: AdminLeadRow[] = (leads ?? []).map((l) => ({
    ...l,
    assignee_name: l.assigned_to ? (assigneeMap[l.assigned_to] ?? "Unknown") : null,
  }));

  return (
    <LeadsClient
      // Remounts LeadsClient whenever a filter or the page number changes, so
      // its internal state (row selection, the search box, any in-flight
      // busy flag) always starts clean rather than carrying a selection of
      // ids that belonged to a different page or filter.
      key={`${page}-${status}-${assignment}-${q}-${pageSize}-${sort}`}
      initialRows={rows}
      totalCount={count ?? 0}
      page={page}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      filters={{ status, assignment, q, sort }}
      telecallers={(telecallers ?? []).map(({ id, full_name }) => ({ id, full_name }))}
    />
  );
}

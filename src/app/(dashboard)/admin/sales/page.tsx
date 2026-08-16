import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/current-user";
import { SalesApprovalClient, type AdminSaleRow } from "@/components/admin/sales-approval-client";

export const metadata = { title: "Sales" };

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 25;

export default async function AdminSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireUserId();
  const supabase = await createClient();

  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "pending";
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize =
    PAGE_SIZE_OPTIONS.find((n) => n === Number(params.pageSize)) ?? DEFAULT_PAGE_SIZE;

  let query = supabase
    .from("sales")
    .select(
      "id, lead_id, telecaller_id, status, commission_amount, sale_note, submitted_at, reviewed_at, rejection_reason",
      { count: "exact" },
    )
    // Pending first by default (oldest first, so nothing sits waiting behind
    // newer claims), newest-first for the reviewed history views.
    .order("submitted_at", { ascending: status === "pending" });

  if (status !== "all") {
    query = query.eq("status", status as "pending" | "approved" | "rejected");
  }

  const from = (page - 1) * pageSize;
  const { data: sales, count } = await query.range(from, from + pageSize - 1);

  const leadIds = [...new Set((sales ?? []).map((s) => s.lead_id))];
  const telecallerIds = [
    ...new Set((sales ?? []).map((s) => s.telecaller_id).filter(Boolean)),
  ] as string[];

  const [{ data: leads }, { data: telecallers }] = await Promise.all([
    leadIds.length
      ? supabase.from("leads").select("id, full_name, phone, business_type").in("id", leadIds)
      : Promise.resolve({
          data: [] as { id: string; full_name: string; phone: string; business_type: string | null }[],
        }),
    telecallerIds.length
      ? supabase.from("telecaller_directory").select("id, full_name").in("id", telecallerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const leadMap = Object.fromEntries((leads ?? []).map((l) => [l.id, l]));
  const telecallerMap = Object.fromEntries((telecallers ?? []).map((t) => [t.id, t.full_name]));

  const rows: AdminSaleRow[] = (sales ?? []).map((s) => ({
    ...s,
    lead_name: leadMap[s.lead_id]?.full_name ?? "Unknown lead",
    lead_phone: leadMap[s.lead_id]?.phone ?? "",
    business_type: leadMap[s.lead_id]?.business_type ?? null,
    telecaller_name: s.telecaller_id
      ? (telecallerMap[s.telecaller_id] ?? "Unknown")
      : "Unknown",
  }));

  return (
    <SalesApprovalClient
      key={`${page}-${status}-${pageSize}`}
      initialRows={rows}
      totalCount={count ?? 0}
      page={page}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      status={status}
    />
  );
}

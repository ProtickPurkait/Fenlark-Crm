import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/current-user";
import { EarningsClient, type EarningsRow } from "@/components/caller/earnings-client";

export const metadata = { title: "Earnings" };

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

export default async function CallerEarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireUserId();
  const supabase = await createClient();

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize =
    PAGE_SIZE_OPTIONS.find((n) => n === Number(params.pageSize)) ?? DEFAULT_PAGE_SIZE;

  const from = (page - 1) * pageSize;

  const [{ data: summary }, { data: sales, count }] = await Promise.all([
    supabase.rpc("my_wallet_summary"),
    // RLS already scopes this to the caller's own rows (telecaller_id = auth.uid()).
    supabase
      .from("sales")
      .select(
        "id, lead_id, status, commission_amount, submitted_at, reviewed_at, rejection_reason, acknowledged_at",
        { count: "exact" },
      )
      .order("submitted_at", { ascending: false })
      .range(from, from + pageSize - 1),
  ]);

  const leadIds = [...new Set((sales ?? []).map((s) => s.lead_id))];
  const { data: leads } = leadIds.length
    ? await supabase.from("leads").select("id, full_name, business_type").in("id", leadIds)
    : { data: [] as { id: string; full_name: string; business_type: string | null }[] };

  const leadMap = Object.fromEntries((leads ?? []).map((l) => [l.id, l]));

  const rows: EarningsRow[] = (sales ?? []).map((s) => ({
    ...s,
    lead_name: leadMap[s.lead_id]?.full_name ?? "Unknown lead",
    business_type: leadMap[s.lead_id]?.business_type ?? null,
  }));

  return (
    <EarningsClient
      key={`${page}-${pageSize}`}
      summary={
        summary?.[0] ?? {
          balance: 0,
          approved_count: 0,
          pending_count: 0,
          unseen_rejections: 0,
        }
      }
      initialRows={rows}
      totalCount={count ?? 0}
      page={page}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
    />
  );
}

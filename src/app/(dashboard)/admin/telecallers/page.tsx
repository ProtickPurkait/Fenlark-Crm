import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/current-user";
import {
  TelecallersClient,
  type TelecallerRow,
} from "@/components/admin/telecallers-client";

export const metadata = { title: "Telecallers" };

// Statuses that mean "no longer needs working". Mirrors the `closed` bucket in
// the lead_queue view.
const CLOSED = ["converted", "dead"] as const;

export default async function AdminTelecallersPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { data: users } = await supabase
    .from("users")
    .select("id, email, full_name, role, is_active, created_at")
    .order("role", { ascending: true })
    .order("full_name", { ascending: true });

  // Assignment counts for every user in one pass.
  //
  // This previously ran two `count: exact` HEAD requests *per user* — so a
  // team of six meant thirteen round trips across two waves, and the page was
  // measurably the slowest in the app (~1.9s warm). PostgREST has no GROUP BY,
  // so the alternatives were a new RPC (needs a migration applied by hand
  // before the page works at all) or this: fetch the two columns actually
  // needed and tally them here.
  //
  // Paginated deliberately. PostgREST caps a select at 1000 rows by default,
  // and a plain `.select()` would silently stop there — the exact trap that
  // made the admin dashboard under-report before it moved to an RPC. Looping
  // until a short page comes back keeps the totals exact at any lead volume.
  const PAGE = 1000;
  const tally = new Map<string, { assigned: number; open: number }>();

  for (let from = 0; ; from += PAGE) {
    const { data: page } = await supabase
      .from("leads")
      .select("assigned_to, status")
      .not("assigned_to", "is", null)
      .is("deleted_at", null)
      .range(from, from + PAGE - 1);

    for (const lead of page ?? []) {
      if (!lead.assigned_to) continue;
      const entry = tally.get(lead.assigned_to) ?? { assigned: 0, open: 0 };
      entry.assigned += 1;
      if (!CLOSED.includes(lead.status as (typeof CLOSED)[number])) entry.open += 1;
      tally.set(lead.assigned_to, entry);
    }

    if (!page || page.length < PAGE) break;
  }

  const rows: TelecallerRow[] = (users ?? []).map((u) => ({
    ...u,
    assigned_total: tally.get(u.id)?.assigned ?? 0,
    open_total: tally.get(u.id)?.open ?? 0,
  }));

  return <TelecallersClient initial={rows} currentUserId={userId} />;
}

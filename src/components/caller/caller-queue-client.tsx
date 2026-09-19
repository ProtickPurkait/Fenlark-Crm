"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle } from "lucide-react";
import { MotionButton } from "@/components/ui/motion-button";
import { LeadStatusBadge } from "@/components/shared/lead-status-badge";
import { FollowUpBadge } from "@/components/shared/follow-up-badge";
import { SaleStatusBadge } from "@/components/shared/sale-status-badge";
import { CallDispositionDrawer } from "@/components/caller/call-disposition-drawer";
import { LogSaleSheet } from "@/components/caller/log-sale-sheet";
import { buildWhatsAppLink } from "@/lib/phone";
// Shared with the /caller server component, which fetches the first page.
import { QUEUE_PAGE_SIZE } from "@/lib/pipeline";
import {
  applyQueueFilters,
  hasActiveQueueFilter,
  DUE_FILTERS,
  QUEUE_STATUS_FILTERS,
  STATUS_FILTER_LABELS,
  type DueFilter,
  type QueueFilters,
} from "@/lib/queue-filters";
import {
  springSoft,
  staggerContainer,
  staggerItem,
  staggerTile,
} from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { LeadQueueRow, SaleStatus } from "@/lib/supabase/database.types";

interface DashboardStats {
  calls_made_today: number;
  followups_pending: number;
  followups_overdue: number;
  assigned_total: number;
  untouched_new: number;
}

interface CallerQueueClientProps {
  initialLeads: LeadQueueRow[];
  totalLeads: number;
  filters: QueueFilters;
  whatsappTemplate: string;
  agentName: string;
  initialStats: DashboardStats | null;
  initialSaleStatusByLead: Record<string, SaleStatus>;
}

export function CallerQueueClient({
  initialLeads,
  totalLeads,
  filters,
  whatsappTemplate,
  agentName,
  initialStats,
  initialSaleStatusByLead,
}: CallerQueueClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [leads, setLeads] = useState(initialLeads);
  const [total, setTotal] = useState(totalLeads);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stats, setStats] = useState(initialStats);
  const [saleStatusByLead, setSaleStatusByLead] = useState(initialSaleStatusByLead);
  const [selected, setSelected] = useState<LeadQueueRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saleLead, setSaleLead] = useState<LeadQueueRow | null>(null);
  const [saleSheetOpen, setSaleSheetOpen] = useState(false);

  // Same rationale as login: Supabase is the heaviest chunk this app ships,
  // and nothing on first paint needs it — only a refetch, a call, a save, or
  // opening a lead's audit timeline, all of which happen after this mounts.
  // Warming it here in the background keeps it off the initial bundle
  // without adding latency to any of those actions.
  useEffect(() => {
    void import("@/lib/supabase/client");
  }, []);

  async function refetch() {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    // Refetch exactly as many rows as are on screen, not the first page: a
    // caller who has loaded three pages and then saves a disposition should
    // not watch two of them disappear.
    const windowSize = Math.max(leads.length, QUEUE_PAGE_SIZE);
    const [{ data: freshLeads, count }, { data: freshStats }, { data: freshSales }] = await Promise.all([
      applyQueueFilters(
        supabase
          .from("lead_queue")
          .select("*", { count: "exact" })
          .order("queue_rank", { ascending: true })
          .order("scheduled_at", { ascending: true, nullsFirst: false }),
        filters,
      ).range(0, windowSize - 1),
      supabase.rpc("my_dashboard_stats"),
      supabase.from("sales").select("lead_id, status").in("status", ["pending", "approved"]),
    ]);
    setLeads(freshLeads ?? []);
    if (typeof count === "number") setTotal(count);
    setStats(freshStats?.[0] ?? null);
    setSaleStatusByLead(
      Object.fromEntries((freshSales ?? []).map((s) => [s.lead_id, s.status])),
    );

    if (selected) {
      setSelected((freshLeads ?? []).find((l) => l.id === selected.id) ?? null);
    }
  }

  function setFilter(next: Partial<QueueFilters>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // Navigating remounts this component with a fresh first page from the
    // server, so there is no local list state to reconcile — the same reason
    // the admin lead list drives its filters through the URL.
    router.push(`${pathname}?${params.toString()}`);
  }

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data: nextPage, count } = await applyQueueFilters(
      supabase
        .from("lead_queue")
        .select("*", { count: "exact" })
        .order("queue_rank", { ascending: true })
        .order("scheduled_at", { ascending: true, nullsFirst: false }),
      filters,
    ).range(leads.length, leads.length + QUEUE_PAGE_SIZE - 1);

    setLoadingMore(false);
    if (typeof count === "number") setTotal(count);
    if (!nextPage?.length) return;

    // Dedupe by id: a lead whose rank changed between the two requests can
    // otherwise arrive on this page having already been on an earlier one,
    // and React would warn on the duplicate key.
    setLeads((prev) => {
      const seen = new Set(prev.map((l) => l.id));
      return [...prev, ...nextPage.filter((l) => !seen.has(l.id))];
    });
  }

  return (
    <div className="space-y-6">
      <motion.div
        variants={staggerContainer(0.05)}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <StatTile label="Calls Today" value={stats?.calls_made_today ?? 0} accent="blue" />
        <StatTile label="Pending" value={stats?.followups_pending ?? 0} accent="cyan" />
        <StatTile
          label="Overdue"
          value={stats?.followups_overdue ?? 0}
          accent="rose"
          emphasize={Boolean(stats?.followups_overdue)}
        />
        <StatTile label="Untouched" value={stats?.untouched_new ?? 0} accent="amber" />
      </motion.div>

      {/* Horizontally scrollable on a phone rather than wrapping to four rows
          and pushing the actual leads below the fold. -mx-4/px-4 lets the row
          bleed to the screen edges so it reads as scrollable. */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-slim sm:mx-0 sm:flex-wrap sm:px-0">
        <QueueChip
          active={!hasActiveQueueFilter(filters)}
          onClick={() => setFilter({ status: "", due: "" })}
        >
          All
        </QueueChip>

        {(Object.keys(DUE_FILTERS) as DueFilter[]).map((key) => (
          <QueueChip
            key={key}
            active={filters.due === key}
            // Due and status are independent axes, but only one due filter at
            // a time: tapping the active one clears it.
            onClick={() => setFilter({ due: filters.due === key ? "" : key })}
            urgent={key === "overdue"}
          >
            {DUE_FILTERS[key].label}
          </QueueChip>
        ))}

        <span className="mx-0.5 my-1 w-px shrink-0 self-stretch bg-border" aria-hidden />

        {QUEUE_STATUS_FILTERS.map((st) => (
          <QueueChip
            key={st}
            active={filters.status === st}
            onClick={() => setFilter({ status: filters.status === st ? "" : st })}
          >
            {STATUS_FILTER_LABELS[st]}
          </QueueChip>
        ))}
      </div>

      {leads.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSoft}
          className="glass rounded-2xl px-6 py-16 text-center"
        >
          {/* Never claim the queue is clear when a filter is simply hiding it
              — that reads as "you are done for the day" and it is the exact
              moment a telecaller would stop working. */}
          {hasActiveQueueFilter(filters) ? (
            <>
              <p className="text-sm font-medium">No leads match this filter</p>
              <p className="mt-1 text-xs text-muted-foreground">
                You have {totalLeads.toLocaleString()} lead
                {totalLeads === 1 ? "" : "s"} in total.
              </p>
              <MotionButton
                variant="glass"
                size="sm"
                className="mt-4"
                onClick={() => setFilter({ status: "", due: "" })}
              >
                Show all leads
              </MotionButton>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Your queue is clear</p>
              <p className="mt-1 text-xs text-muted-foreground">
                New assignments will appear here automatically.
              </p>
            </>
          )}
        </motion.div>
      ) : (
        // `layout` on the list + items means a lead that changes rank after a
        // save glides to its new position instead of teleporting.
        <motion.div
          variants={staggerContainer(0.06, 0.1)}
          initial="hidden"
          animate="show"
          className="space-y-2.5"
        >
          <AnimatePresence mode="popLayout">
            {leads.map((lead) => (
              <motion.div
                key={lead.id}
                layout
                variants={staggerItem}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.995 }}
                transition={springSoft}
                onClick={() => {
                  setSelected(lead);
                  setDrawerOpen(true);
                }}
                className="glass group cursor-pointer rounded-xl p-4"
              >
                {/* Stacks on phones so the lead details get full width and the
                    WhatsApp button becomes a full-width row beneath, rather
                    than the two fighting over a 375px line. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium tracking-tight">
                        {lead.full_name}
                      </span>
                      <LeadStatusBadge status={lead.status} />
                      <FollowUpBadge bucket={lead.follow_up_bucket} />
                      {lead.business_type && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                          {lead.business_type}
                        </span>
                      )}
                      {saleStatusByLead[lead.id] && (
                        <SaleStatusBadge status={saleStatusByLead[lead.id]} />
                      )}
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      {lead.phone}
                      {lead.city ? ` · ${lead.city}` : ""}
                      {lead.scheduled_at &&
                        ` · ${new Date(lead.scheduled_at).toLocaleString()}`}
                    </div>
                    {lead.last_remark && (
                      <p className="mt-1.5 truncate text-sm text-foreground/70">
                        {lead.last_remark}
                      </p>
                    )}
                  </div>
                  {/* Just WhatsApp here — every other action (Call Now, Log
                      Sale, disposition) lives inside the drawer once you tap
                      the lead, instead of competing for space in this row. */}
                  <MotionButton
                    variant="emerald"
                    size="sm"
                    // Full 44px target on phones; the compact size is fine
                    // once there's a mouse pointer.
                    className="h-11 w-full shrink-0 sm:h-8 sm:w-auto"
                    onClick={(e) => {
                      // Without this the card's own onClick also fires and
                      // the drawer opens behind the new WhatsApp tab.
                      e.stopPropagation();
                      window.open(
                        buildWhatsAppLink(lead.phone, whatsappTemplate, {
                          name: lead.full_name,
                          agent: agentName,
                        }),
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    WhatsApp
                  </MotionButton>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {leads.length < total && (
        <div className="flex flex-col items-center gap-2 pt-1">
          <p className="text-xs text-muted-foreground tabular-nums">
            Showing {leads.length.toLocaleString()} of {total.toLocaleString()} leads
          </p>
          <MotionButton
            variant="glass"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
            className="h-10 w-full sm:h-8 sm:w-auto"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </MotionButton>
        </div>
      )}

      <CallDispositionDrawer
        lead={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        agentName={agentName}
        whatsappTemplate={whatsappTemplate}
        onSaved={refetch}
        saleStatus={selected ? saleStatusByLead[selected.id] : undefined}
        onLogSale={() => {
          if (!selected) return;
          const lead = selected;
          // Close this sheet before opening the next one — Radix handles two
          // independent open Dialogs fine, but stacking their overlays reads
          // as broken rather than a deliberate handoff. 300ms matches the
          // sheet's own close transition (see sheet.tsx).
          setDrawerOpen(false);
          setTimeout(() => {
            setSaleLead(lead);
            setSaleSheetOpen(true);
          }, 300);
        }}
      />

      <LogSaleSheet
        lead={saleLead}
        open={saleSheetOpen}
        onOpenChange={setSaleSheetOpen}
        onLogged={refetch}
      />
    </div>
  );
}

function QueueChip({
  active,
  onClick,
  urgent,
  children,
}: {
  active: boolean;
  onClick: () => void;
  urgent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // h-8 and shrink-0: thumbed on a phone, and a chip must never compress
      // to an unreadable sliver inside the scrolling row.
      className={cn(
        "h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-medium ring-1 transition-colors",
        active
          ? "bg-[hsl(var(--neon-blue)/0.16)] text-[hsl(var(--neon-blue))] ring-[hsl(var(--neon-blue)/0.4)]"
          : urgent
            ? "text-[hsl(var(--neon-rose))] ring-[hsl(var(--neon-rose)/0.3)] hover:bg-[hsl(var(--neon-rose)/0.08)]"
            : "text-muted-foreground ring-border hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const ACCENT_TEXT = {
  blue: "text-[hsl(var(--neon-blue))]",
  cyan: "text-[hsl(var(--neon-cyan))]",
  rose: "text-[hsl(var(--neon-rose))]",
  amber: "text-[hsl(var(--neon-amber))]",
} as const;

function StatTile({
  label,
  value,
  accent,
  emphasize,
}: {
  label: string;
  value: number;
  accent: keyof typeof ACCENT_TEXT;
  emphasize?: boolean;
}) {
  return (
    <motion.div variants={staggerTile} className="glass rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
          emphasize ? ACCENT_TEXT[accent] : "text-foreground",
        )}
      >
        {value}
      </p>
    </motion.div>
  );
}

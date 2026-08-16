"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, Wallet } from "lucide-react";
import { MotionButton } from "@/components/ui/motion-button";
import { LeadStatusBadge } from "@/components/shared/lead-status-badge";
import { FollowUpBadge } from "@/components/shared/follow-up-badge";
import { SaleStatusBadge } from "@/components/shared/sale-status-badge";
import { CallDispositionDrawer } from "@/components/caller/call-disposition-drawer";
import { LogSaleSheet } from "@/components/caller/log-sale-sheet";
import { buildWhatsAppLink } from "@/lib/phone";
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
  whatsappTemplate: string;
  agentName: string;
  initialStats: DashboardStats | null;
  initialSaleStatusByLead: Record<string, SaleStatus>;
}

export function CallerQueueClient({
  initialLeads,
  whatsappTemplate,
  agentName,
  initialStats,
  initialSaleStatusByLead,
}: CallerQueueClientProps) {
  const [leads, setLeads] = useState(initialLeads);
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
    const [{ data: freshLeads }, { data: freshStats }, { data: freshSales }] = await Promise.all([
      supabase
        .from("lead_queue")
        .select("*")
        .order("queue_rank", { ascending: true })
        .order("scheduled_at", { ascending: true, nullsFirst: false }),
      supabase.rpc("my_dashboard_stats"),
      supabase.from("sales").select("lead_id, status").in("status", ["pending", "approved"]),
    ]);
    setLeads(freshLeads ?? []);
    setStats(freshStats?.[0] ?? null);
    setSaleStatusByLead(
      Object.fromEntries((freshSales ?? []).map((s) => [s.lead_id, s.status])),
    );

    if (selected) {
      setSelected((freshLeads ?? []).find((l) => l.id === selected.id) ?? null);
    }
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

      {leads.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSoft}
          className="glass rounded-2xl px-6 py-16 text-center"
        >
          <p className="text-sm font-medium">Your queue is clear</p>
          <p className="mt-1 text-xs text-muted-foreground">
            New assignments will appear here automatically.
          </p>
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
                className={cn(
                  "glass group cursor-pointer rounded-xl p-4 transition-shadow duration-300",
                  lead.follow_up_bucket === "overdue"
                    ? "hover:shadow-glow-rose"
                    : "hover:shadow-glow-blue",
                )}
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
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-white/10">
                          {lead.business_type}
                        </span>
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
                  <div className="flex w-full shrink-0 gap-2 sm:w-auto">
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

                    {saleStatusByLead[lead.id] ? (
                      <span className="flex h-11 w-full shrink-0 items-center justify-center sm:h-8 sm:w-auto">
                        <SaleStatusBadge status={saleStatusByLead[lead.id]} />
                      </span>
                    ) : (
                      <MotionButton
                        variant="glass"
                        size="sm"
                        className="h-11 w-full shrink-0 sm:h-8 sm:w-auto"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSaleLead(lead);
                          setSaleSheetOpen(true);
                        }}
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        Log Sale
                      </MotionButton>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <CallDispositionDrawer
        lead={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        agentName={agentName}
        whatsappTemplate={whatsappTemplate}
        onSaved={refetch}
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

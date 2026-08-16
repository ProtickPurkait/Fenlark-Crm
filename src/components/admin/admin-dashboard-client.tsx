"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import {
  Activity,
  Inbox,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { BentoGrid, BentoCard } from "@/components/ui/bento";
import { PipelineDonut } from "@/components/admin/pipeline-donut";
import { LiveCallsPanel } from "@/components/admin/live-calls-panel";
import { LeadStatusBadge } from "@/components/shared/lead-status-badge";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { LeadStatus } from "@/lib/pipeline";

interface RecentActivity {
  id: number;
  event_type: string;
  created_at: string;
  actor_kind: "user" | "system";
  actor_name: string | null;
  lead_name: string | null;
  to_status: LeadStatus | null;
}

export interface AdminDashboardData {
  totalLeads: number;
  unassigned: number;
  activeCallers: number;
  convertedCount: number;
  statusCounts: Record<LeadStatus, number>;
  slaEnabled: boolean;
  slaHours: number;
  slaRevokedTotal: number;
  recent: RecentActivity[];
}

interface ActiveCallRow {
  session_id: string;
  caller_id: string | null;
  caller_name: string | null;
  lead_id: string;
  lead_name: string;
  lead_phone: string;
  started_at: string;
}

interface CallStatRow {
  caller_id: string;
  caller_name: string;
  calls_today: number;
  talk_seconds: number;
  longest_call: number;
}

export function AdminDashboardClient({
  data,
  activeCalls = [],
  callStats = [],
}: {
  data: AdminDashboardData;
  activeCalls?: ActiveCallRow[];
  callStats?: CallStatRow[];
}) {
  const conversionRate =
    data.totalLeads > 0
      ? ((data.convertedCount / data.totalLeads) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="space-y-6">
      <motion.div
        variants={staggerContainer(0.05)}
        initial="hidden"
        animate="show"
      >
        <motion.h1
          variants={staggerItem}
          className="text-2xl font-semibold tracking-tight"
        >
          Dashboard
        </motion.h1>
        <motion.p
          variants={staggerItem}
          className="mt-1 text-sm text-muted-foreground"
        >
          Live pipeline overview for Fenlark Technologies.
        </motion.p>
      </motion.div>

      <BentoGrid>
        <StatTile
          span="lg:col-span-2"
          glow="blue"
          icon={<Inbox className="h-4 w-4" />}
          label="Total Leads"
          value={data.totalLeads}
        />
        <StatTile
          span="lg:col-span-2"
          glow={data.unassigned > 0 ? "rose" : "blue"}
          icon={<Activity className="h-4 w-4" />}
          label="Unassigned Pool"
          value={data.unassigned}
          emphasize={data.unassigned > 0}
        />
        <StatTile
          span="lg:col-span-2"
          glow="violet"
          icon={<Users className="h-4 w-4" />}
          label="Active Telecallers"
          value={data.activeCallers}
        />

        {/* Pipeline breakdown — the wide hero tile. */}
        <BentoCard span="lg:col-span-4 sm:col-span-2" glow="blue" className="p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Pipeline Breakdown</h2>
              <p className="text-xs text-muted-foreground">
                Distribution across all stages
              </p>
            </div>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </div>
          {data.totalLeads > 0 ? (
            <PipelineDonut counts={data.statusCounts} total={data.totalLeads} />
          ) : (
            <EmptyState
              title="No leads yet"
              body="Import a CSV or connect a webhook to start populating the pipeline."
            />
          )}
        </BentoCard>

        {/* Conversion + SLA status stacked in the remaining two columns. */}
        <BentoCard span="lg:col-span-2" glow="emerald" className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Conversion</h2>
            <TrendingUp className="h-4 w-4 text-[hsl(var(--neon-emerald))]" />
          </div>
          <div className="mt-4 flex items-baseline gap-1.5">
            <AnimatedNumber
              value={Number(conversionRate)}
              className="text-4xl font-semibold tabular-nums tracking-tight text-[hsl(var(--neon-emerald))]"
              decimals={1}
            />
            <span className="text-lg text-[hsl(var(--neon-emerald))]">%</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.convertedCount} of {data.totalLeads} leads converted
          </p>

          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3" />
                SLA Recycling
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1",
                  data.slaEnabled
                    ? "bg-[hsl(var(--neon-emerald)/0.14)] text-[hsl(var(--neon-emerald))] ring-[hsl(var(--neon-emerald)/0.35)]"
                    : "bg-white/5 text-muted-foreground ring-white/10",
                )}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_6px_currentColor]"
                />
                {data.slaEnabled ? `On · ${data.slaHours}h` : "Off"}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {data.slaRevokedTotal} lead
              {data.slaRevokedTotal === 1 ? "" : "s"} reclaimed to date
            </p>
          </div>
        </BentoCard>

        {/* Live call activity. Placed directly under the KPI row because it is
            the most time-sensitive thing on the page — everything else here is
            a historical total that can wait a scroll. */}
        <BentoCard
          span="lg:col-span-6 sm:col-span-2"
          glow="emerald"
          spotlight={false}
          className="p-5 sm:p-6"
        >
          <LiveCallsPanel initialActive={activeCalls} initialStats={callStats} />
        </BentoCard>

        {/* Recent activity, straight off the audit trail. */}
        <BentoCard span="lg:col-span-6 sm:col-span-2" glow="violet" className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Recent Activity</h2>
              <p className="text-xs text-muted-foreground">
                Live from the immutable audit trail
              </p>
            </div>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>

          {data.recent.length === 0 ? (
            <EmptyState
              title="Nothing logged yet"
              body="Call activity and assignment changes will appear here as they happen."
            />
          ) : (
            <motion.ul
              variants={staggerContainer(0.04, 0.2)}
              initial="hidden"
              animate="show"
              className="divide-y divide-white/5"
            >
              {data.recent.map((item) => (
                // Stacks into two lines on phones. As one row it does not fit:
                // the actor name plus a full timestamp is ~280px, which on a
                // 375px screen left nothing for the lead name and pushed the
                // status badge (which cannot shrink below its own content)
                // out of its container and on top of the actor name.
                <motion.li
                  key={item.id}
                  variants={staggerItem}
                  className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        item.actor_kind === "system"
                          ? "bg-[hsl(var(--neon-rose))]"
                          : "bg-[hsl(var(--neon-blue))]",
                      )}
                    />
                    <span className="min-w-0 truncate">
                      <span className="font-medium">
                        {item.lead_name ?? "Lead"}
                      </span>
                      <span className="text-muted-foreground">
                        {" — "}
                        {humanizeEvent(item.event_type)}
                      </span>
                    </span>
                    {/* shrink-0 is the actual overlap fix: a flex item that
                        cannot shrink below min-content will overflow its
                        parent instead, colliding with the next block. */}
                    {item.to_status && (
                      <LeadStatusBadge status={item.to_status} className="shrink-0" />
                    )}
                  </div>
                  {/* pl-4 aligns the second line under the text rather than
                      under the status dot (dot 0.375rem + gap 0.625rem = 1rem).
                      Deliberately NOT shrink-0 — letting this block shrink and
                      the actor name truncate is what keeps long names from
                      overflowing at any width, not just on phones. */}
                  <div className="flex min-w-0 items-center gap-2 pl-4 text-xs text-muted-foreground sm:gap-3 sm:pl-0">
                    <span className="truncate">
                      {item.actor_kind === "system" ? (
                        <span className="text-[hsl(var(--neon-rose))]">System</span>
                      ) : (
                        // null here means the acting account was later
                        // deleted (its id is FK-nulled, actor_kind stays
                        // "user") — not that no one acted.
                        (item.actor_name ?? "a deleted user")
                      )}
                    </span>
                    <time className="shrink-0 font-mono text-[10px]">
                      {new Date(item.created_at).toLocaleString()}
                    </time>
                  </div>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </BentoCard>
      </BentoGrid>
    </div>
  );
}

function StatTile({
  span,
  glow,
  icon,
  label,
  value,
  emphasize,
}: {
  span: string;
  glow: "blue" | "emerald" | "violet" | "rose";
  icon: React.ReactNode;
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <BentoCard span={span} glow={glow} className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <AnimatedNumber
        value={value}
        className={cn(
          "mt-2 block text-3xl font-semibold tabular-nums tracking-tight",
          emphasize && "text-[hsl(var(--neon-rose))]",
        )}
      />
    </BentoCard>
  );
}

/**
 * Count-up on mount, driven by a motion value so the digits tick without a
 * React re-render per frame. `useTransform` formats to a fixed number of
 * decimals, which also keeps the character width stable so the tile doesn't
 * jitter mid-count.
 */
function AnimatedNumber({
  value,
  className,
  decimals = 0,
}: {
  value: number;
  className?: string;
  decimals?: number;
}) {
  const count = useMotionValue(0);
  const display = useTransform(count, (v) => v.toFixed(decimals));

  useEffect(() => {
    // Nothing to count toward at zero — skip the animation so an empty
    // dashboard doesn't play a 0 → 0 tick.
    if (value === 0) {
      count.set(0);
      return;
    }
    const controls = animate(count, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [value, count]);

  return <motion.span className={className}>{display}</motion.span>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 px-6 py-10 text-center">
      <p className="text-sm font-medium text-foreground/80">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

function humanizeEvent(event: string): string {
  return (
    {
      lead_created: "created",
      assigned: "assigned",
      reassigned: "reassigned",
      unassigned: "returned to pool",
      status_changed: "status updated",
      remark_added: "call logged",
      reschedule_set: "follow-up scheduled",
      sla_revoked: "reclaimed on SLA breach",
      lead_archived: "archived",
    }[event] ?? event
  );
}

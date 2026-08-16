"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import { SaleStatusBadge } from "@/components/shared/sale-status-badge";
import { staggerContainer, staggerItem, staggerTile } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { SaleStatus } from "@/lib/supabase/database.types";

export interface EarningsRow {
  id: string;
  lead_id: string;
  status: SaleStatus;
  commission_amount: number;
  submitted_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
  acknowledged_at: string | null;
  lead_name: string;
  business_type: string | null;
}

interface WalletSummary {
  balance: number;
  approved_count: number;
  pending_count: number;
  unseen_rejections: number;
}

function formatRupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function EarningsClient({
  summary,
  initialRows,
  totalCount,
  page,
  pageSize,
  pageSizeOptions,
}: {
  summary: WalletSummary;
  initialRows: EarningsRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rows = initialRows;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function pushParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    if (!("page" in next)) params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <motion.div
      variants={staggerContainer(0.06)}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      <motion.div variants={staggerItem}>
        <h1 className="text-2xl font-semibold tracking-tight">Earnings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Commission from sales approved by an admin.
        </p>
      </motion.div>

      {/* Wallet hero */}
      <motion.div
        variants={staggerItem}
        className="glass rounded-2xl p-6 shadow-glow-soft"
      >
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Wallet className="h-3.5 w-3.5" />
          Wallet balance
        </div>
        <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight text-[hsl(var(--neon-emerald))]">
          {formatRupees(summary.balance)}
        </p>
      </motion.div>

      {/* Stat chips */}
      <motion.div
        variants={staggerContainer(0.05)}
        initial="hidden"
        animate="show"
        className="grid grid-cols-3 gap-3"
      >
        <StatTile label="Approved" value={summary.approved_count} accent="emerald" />
        <StatTile label="Pending review" value={summary.pending_count} accent="amber" />
        <StatTile
          label="Unseen rejections"
          value={summary.unseen_rejections}
          accent="rose"
          emphasize={summary.unseen_rejections > 0}
        />
      </motion.div>

      {/* Page size */}
      <motion.div variants={staggerItem} className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Show</span>
        {pageSizeOptions.map((n) => (
          <FilterChip
            key={n}
            active={pageSize === n}
            onClick={() => pushParams({ pageSize: String(n) })}
          >
            {n}
          </FilterChip>
        ))}
      </motion.div>

      {/* Phone layout */}
      <motion.div variants={staggerItem} className="space-y-2 lg:hidden">
        {rows.map((row) => (
          <div key={row.id} className="glass rounded-xl p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium tracking-tight">
                    {row.lead_name}
                  </span>
                  {row.business_type && (
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-white/10">
                      {row.business_type}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  #{row.id.slice(0, 8)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {new Date(row.submitted_at).toLocaleString()}
                </div>
                {row.status === "rejected" && row.rejection_reason && (
                  <p className="mt-1.5 text-xs text-[hsl(var(--neon-rose))]">
                    {row.rejection_reason}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm font-semibold tabular-nums">
                  {formatRupees(row.commission_amount)}
                </p>
                <SaleStatusBadge status={row.status} className="mt-1" />
              </div>
            </div>
          </div>
        ))}

        {rows.length === 0 && (
          <div className="glass rounded-2xl px-6 py-16 text-center text-sm text-muted-foreground">
            No sales logged yet.
          </div>
        )}
      </motion.div>

      {/* Table — laptop and up */}
      <motion.div
        variants={staggerItem}
        className="glass hidden overflow-hidden rounded-2xl lg:block"
      >
        <div className="overflow-x-auto scrollbar-slim">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Sale</th>
                <th className="px-2 py-3 font-medium">Date</th>
                <th className="px-2 py-3 font-medium">Time</th>
                <th className="px-2 py-3 font-medium">Amount</th>
                <th className="px-2 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const submitted = new Date(row.submitted_at);
                return (
                  <tr
                    key={row.id}
                    className="border-b border-white/5 transition-colors last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium tracking-tight">{row.lead_name}</span>
                        {row.business_type && (
                          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-white/10">
                            {row.business_type}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        #{row.id.slice(0, 8)}
                      </div>
                      {row.status === "rejected" && row.rejection_reason && (
                        <div className="mt-0.5 text-[10px] text-[hsl(var(--neon-rose))]">
                          {row.rejection_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-3 text-xs text-muted-foreground">
                      {submitted.toLocaleDateString()}
                    </td>
                    <td className="px-2 py-3 text-xs text-muted-foreground">
                      {submitted.toLocaleTimeString()}
                    </td>
                    <td className="px-2 py-3 font-mono text-sm font-semibold tabular-nums">
                      {formatRupees(row.commission_amount)}
                    </td>
                    <td className="px-2 py-3">
                      <SaleStatusBadge status={row.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">
            No sales logged yet.
          </p>
        )}
      </motion.div>

      {totalPages > 1 && (
        <motion.div
          variants={staggerItem}
          className="flex items-center justify-between text-xs text-muted-foreground"
        >
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <FilterChip
              active={false}
              disabled={page <= 1}
              onClick={() => pushParams({ page: String(page - 1) })}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </FilterChip>
            <FilterChip
              active={false}
              disabled={page >= totalPages}
              onClick={() => pushParams({ page: String(page + 1) })}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </FilterChip>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

const ACCENT_TEXT = {
  emerald: "text-[hsl(var(--neon-emerald))]",
  amber: "text-[hsl(var(--neon-amber))]",
  rose: "text-[hsl(var(--neon-rose))]",
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
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
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

function FilterChip({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors disabled:pointer-events-none disabled:opacity-40",
        active
          ? "bg-[hsl(var(--neon-blue)/0.16)] text-[hsl(var(--neon-blue))] ring-[hsl(var(--neon-blue)/0.4)]"
          : "text-muted-foreground ring-white/10 hover:bg-white/5 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

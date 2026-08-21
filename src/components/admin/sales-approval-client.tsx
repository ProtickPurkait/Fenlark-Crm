"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Loader2, TriangleAlert, X } from "lucide-react";
import { MotionButton } from "@/components/ui/motion-button";
import { Textarea } from "@/components/ui/textarea";
import { SaleStatusBadge } from "@/components/shared/sale-status-badge";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { SaleStatus } from "@/lib/supabase/database.types";

export interface AdminSaleRow {
  id: string;
  lead_id: string;
  telecaller_id: string | null;
  status: SaleStatus;
  commission_amount: number;
  sale_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
  lead_name: string;
  lead_phone: string;
  business_type: string | null;
  telecaller_name: string;
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function formatRupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function SalesApprovalClient({
  initialRows,
  totalCount,
  page,
  pageSize,
  pageSizeOptions,
  status,
}: {
  initialRows: AdminSaleRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  status: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rows = initialRows;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function pushParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    if (!("page" in next)) params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  async function approve(saleId: string) {
    if (busyRef.current) return;
    busyRef.current = saleId;
    setBusyId(saleId);
    setError(null);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("admin_approve_sale", {
      p_sale_id: saleId,
    });

    busyRef.current = null;
    setBusyId(null);

    if (rpcError) {
      setError(
        rpcError.message.includes("already reviewed")
          ? "This sale was already reviewed."
          : "Could not approve this sale. Try again.",
      );
      return;
    }
    router.refresh();
  }

  function startReject(saleId: string) {
    setRejectingId(saleId);
    setReason("");
    setError(null);
  }

  async function confirmReject(saleId: string) {
    if (busyRef.current) return;
    if (!reason.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    busyRef.current = saleId;
    setBusyId(saleId);
    setError(null);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("admin_reject_sale", {
      p_sale_id: saleId,
      p_reason: reason.trim(),
    });

    busyRef.current = null;
    setBusyId(null);

    if (rpcError) {
      setError(
        rpcError.message.includes("already reviewed")
          ? "This sale was already reviewed."
          : "Could not reject this sale. Try again.",
      );
      return;
    }
    setRejectingId(null);
    setReason("");
    router.refresh();
  }

  return (
    <motion.div
      variants={staggerContainer(0.06)}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      <motion.div variants={staggerItem}>
        <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalCount.toLocaleString()} {status === "all" ? "" : status} sale
          {totalCount === 1 ? "" : "s"}.
        </p>
      </motion.div>

      <motion.div variants={staggerItem} className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            active={status === f.value}
            onClick={() => pushParams({ status: f.value === "pending" ? null : f.value })}
          >
            {f.label}
          </FilterChip>
        ))}
      </motion.div>

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

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-2 rounded-lg border border-[hsl(var(--neon-rose)/0.3)] bg-[hsl(var(--neon-rose)/0.1)] p-3 text-sm text-[hsl(var(--neon-rose))]"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </motion.p>
        )}
      </AnimatePresence>

      <motion.div variants={staggerItem} className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.id} className="glass rounded-xl p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium tracking-tight">{row.lead_name}</span>
                  {row.business_type && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                      {row.business_type}
                    </span>
                  )}
                  <SaleStatusBadge status={row.status} />
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {row.lead_phone}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>Sold by {row.telecaller_name}</span>
                  <span>{new Date(row.submitted_at).toLocaleString()}</span>
                </div>
                {row.sale_note && (
                  <p className="mt-1.5 text-sm text-foreground/70">{row.sale_note}</p>
                )}
                {row.status === "rejected" && row.rejection_reason && (
                  <p className="mt-1.5 text-xs text-[hsl(var(--neon-rose))]">
                    {row.rejection_reason}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {formatRupees(row.commission_amount)}
                </span>

                {row.status === "pending" && (
                  <div className="flex gap-2">
                    <MotionButton
                      variant="emerald"
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => approve(row.id)}
                    >
                      {busyId === row.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Approve
                    </MotionButton>
                    <MotionButton
                      variant="destructive"
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() =>
                        rejectingId === row.id ? setRejectingId(null) : startReject(row.id)
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </MotionButton>
                  </div>
                )}
              </div>
            </div>

            <AnimatePresence>
              {rejectingId === row.id && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    <Textarea
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason the telecaller will see…"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <MotionButton
                        variant="ghost"
                        size="sm"
                        onClick={() => setRejectingId(null)}
                      >
                        Cancel
                      </MotionButton>
                      <MotionButton
                        variant="destructive"
                        size="sm"
                        disabled={busyId === row.id}
                        onClick={() => confirmReject(row.id)}
                      >
                        {busyId === row.id && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                        Confirm reject
                      </MotionButton>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}

        {rows.length === 0 && (
          <div className="glass rounded-2xl px-6 py-16 text-center text-sm text-muted-foreground">
            No sales match this filter.
          </div>
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
            <MotionButton
              variant="glass"
              size="sm"
              disabled={page <= 1}
              onClick={() => pushParams({ page: String(page - 1) })}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </MotionButton>
            <MotionButton
              variant="glass"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => pushParams({ page: String(page + 1) })}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </MotionButton>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors",
        active
          ? "bg-[hsl(var(--neon-blue)/0.16)] text-[hsl(var(--neon-blue))] ring-[hsl(var(--neon-blue)/0.4)]"
          : "text-muted-foreground ring-border hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

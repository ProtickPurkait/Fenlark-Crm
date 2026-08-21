"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { springSnappy } from "@/lib/motion";
import type { SaleStatus } from "@/lib/supabase/database.types";

const LABELS: Record<SaleStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

const STYLES: Record<SaleStatus, string> = {
  pending:
    "bg-[hsl(var(--neon-amber)/0.14)] text-[hsl(var(--neon-amber))] ring-[hsl(var(--neon-amber)/0.35)]",
  approved:
    "bg-[hsl(var(--neon-emerald)/0.14)] text-[hsl(var(--neon-emerald))] ring-[hsl(var(--neon-emerald)/0.35)]",
  rejected:
    "bg-[hsl(var(--neon-rose)/0.14)] text-[hsl(var(--neon-rose))] ring-[hsl(var(--neon-rose)/0.35)]",
};

export function SaleStatusBadge({
  status,
  className,
}: {
  status: SaleStatus;
  className?: string;
}) {
  return (
    <motion.span
      key={status}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={springSnappy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1",
        STYLES[status],
        className,
      )}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {LABELS[status]}
    </motion.span>
  );
}

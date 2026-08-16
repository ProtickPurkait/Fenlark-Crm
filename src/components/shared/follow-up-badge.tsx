"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { FollowUpBucket } from "@/lib/supabase/database.types";

const CONFIG: Record<
  FollowUpBucket,
  { label: string; className: string; pulse: boolean } | null
> = {
  overdue: {
    label: "Overdue",
    className:
      "bg-[hsl(var(--neon-rose)/0.14)] text-[hsl(var(--neon-rose))] ring-[hsl(var(--neon-rose)/0.4)]",
    // Only Overdue pulses. If everything pulses, nothing is urgent.
    pulse: true,
  },
  due_soon: {
    label: "Due Soon",
    className:
      "bg-[hsl(var(--neon-amber)/0.14)] text-[hsl(var(--neon-amber))] ring-[hsl(var(--neon-amber)/0.4)]",
    pulse: false,
  },
  due_today: {
    label: "Due Today",
    className:
      "bg-[hsl(var(--neon-cyan)/0.14)] text-[hsl(var(--neon-cyan))] ring-[hsl(var(--neon-cyan)/0.4)]",
    pulse: false,
  },
  scheduled: null,
  unscheduled: null,
  closed: null,
};

export function FollowUpBadge({
  bucket,
  className,
}: {
  bucket: FollowUpBucket;
  className?: string;
}) {
  const config = CONFIG[bucket];
  if (!config) return null;

  return (
    <motion.span
      animate={
        config.pulse
          ? { opacity: [1, 0.62, 1], scale: [1, 1.03, 1] }
          : undefined
      }
      transition={
        config.pulse
          ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1",
        config.className,
        className,
      )}
    >
      {config.label}
    </motion.span>
  );
}

"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Shimmer skeleton. The travelling highlight is a Framer Motion `x` animation
 * on an overlaid gradient bar rather than a CSS @keyframes sweep — same visual,
 * but the timing lives in JS with the rest of the motion system.
 *
 * `aria-hidden` + role=presentation: a shimmering box is decorative; the
 * loading state itself should be announced by the region that owns it.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-md bg-white/[0.06]",
        className,
      )}
      {...props}
    >
      <motion.div
        className="absolute inset-y-0 -left-full w-full bg-gradient-to-r from-transparent via-white/[0.09] to-transparent"
        animate={{ x: ["0%", "200%"] }}
        transition={{
          duration: 1.6,
          ease: "linear",
          repeat: Infinity,
          repeatDelay: 0.25,
        }}
      />
    </div>
  );
}

/** Skeleton shaped like a queue lead card. */
export function LeadCardSkeleton() {
  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-56" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
    </div>
  );
}

/** Skeleton shaped like a bento KPI tile. */
export function StatTileSkeleton() {
  return (
    <div className="glass rounded-2xl p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-9 w-16" />
    </div>
  );
}

/** Skeleton for the audit timeline inside the disposition drawer. */
export function TimelineSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-l-2 border-white/10 pl-3">
          <div className="flex items-baseline justify-between gap-2">
            <Skeleton className="h-3.5 w-44" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

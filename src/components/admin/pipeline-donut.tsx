"use client";

import { motion } from "framer-motion";
import { LEAD_STATUS_ORDER, type LeadStatus } from "@/lib/pipeline";

interface PipelineDonutProps {
  counts: Record<LeadStatus, number>;
  total: number;
}

const LABELS: Record<LeadStatus, string> = {
  new: "New",
  attempted: "Attempted",
  connected: "Connected",
  warm: "Warm",
  rescheduled: "Rescheduled",
  converted: "Converted",
  dead: "Dead",
};

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Animated pipeline breakdown. Built from a plain SVG circle per segment,
 * animated via stroke-dashoffset + Framer Motion — no charting dependency, and
 * it stays on the same motion system as everything else.
 *
 * Each segment is a full circle whose dash pattern exposes only its own arc,
 * rotated to start where the previous one ended.
 */
export function PipelineDonut({ counts, total }: PipelineDonutProps) {
  const segments = LEAD_STATUS_ORDER.map((status) => ({
    status,
    count: counts[status] ?? 0,
  })).filter((s) => s.count > 0);

  let cumulative = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative h-36 w-36 shrink-0">
        {/* overflow-visible: an SVG clips to its own viewBox by default, and
            the ring's radius leaves only ~2px of margin before that edge —
            not enough room for the drop-shadow glow below, which was getting
            clipped into a flat edge at the top and bottom of the ring. */}
        <svg
          viewBox="0 0 120 120"
          className="h-full w-full -rotate-90 overflow-visible"
        >
          {/* Track */}
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke="hsl(0 0% 100% / 0.06)"
            strokeWidth="12"
          />
          {segments.map(({ status, count }, i) => {
            const fraction = count / total;
            const offset = cumulative;
            cumulative += fraction;

            return (
              <motion.circle
                key={status}
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                stroke={`hsl(var(--status-${status}))`}
                strokeWidth="12"
                strokeLinecap="round"
                // Expose only this segment's arc, positioned at its offset.
                strokeDasharray={`${fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
                strokeDashoffset={-offset * CIRCUMFERENCE}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{
                  pathLength: { duration: 0.9, delay: 0.15 + i * 0.1, ease: "easeOut" },
                  opacity: { duration: 0.3, delay: 0.15 + i * 0.1 },
                }}
                style={{ filter: "drop-shadow(0 0 6px currentColor)" }}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.35 }}
            className="text-3xl font-semibold tabular-nums tracking-tight"
          >
            {total}
          </motion.span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Leads
          </span>
        </div>
      </div>

      <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 sm:flex-1">
        {LEAD_STATUS_ORDER.map((status, i) => (
          <motion.li
            key={status}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + i * 0.04 }}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: `hsl(var(--status-${status}))`,
                  boxShadow: `0 0 6px hsl(var(--status-${status}) / 0.8)`,
                }}
              />
              <span className="truncate">{LABELS[status]}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums text-foreground">
              {counts[status] ?? 0}
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

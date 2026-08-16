"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { springSnappy } from "@/lib/motion";
import type { LeadStatus } from "@/lib/supabase/database.types";

const LABELS: Record<LeadStatus, string> = {
  new: "New",
  attempted: "Attempted",
  connected: "Connected",
  warm: "Warm",
  rescheduled: "Rescheduled",
  converted: "Converted",
  dead: "Dead",
};

// Neon-on-dark: a tinted translucent fill, a matching 1px ring, and the pure
// accent for the text itself. The ring is what makes it glow rather than just
// sit there.
const STYLES: Record<LeadStatus, string> = {
  new: "bg-[hsl(var(--status-new)/0.14)] text-[hsl(var(--status-new))] ring-[hsl(var(--status-new)/0.35)]",
  attempted:
    "bg-[hsl(var(--status-attempted)/0.14)] text-[hsl(var(--status-attempted))] ring-[hsl(var(--status-attempted)/0.35)]",
  connected:
    "bg-[hsl(var(--status-connected)/0.14)] text-[hsl(var(--status-connected))] ring-[hsl(var(--status-connected)/0.35)]",
  warm: "bg-[hsl(var(--status-warm)/0.14)] text-[hsl(var(--status-warm))] ring-[hsl(var(--status-warm)/0.35)]",
  rescheduled:
    "bg-[hsl(var(--status-rescheduled)/0.14)] text-[hsl(var(--status-rescheduled))] ring-[hsl(var(--status-rescheduled)/0.35)]",
  converted:
    "bg-[hsl(var(--status-converted)/0.14)] text-[hsl(var(--status-converted))] ring-[hsl(var(--status-converted)/0.35)]",
  dead: "bg-[hsl(var(--status-dead)/0.14)] text-[hsl(var(--status-dead))] ring-[hsl(var(--status-dead)/0.3)]",
};

export function LeadStatusBadge({
  status,
  className,
}: {
  status: LeadStatus;
  className?: string;
}) {
  return (
    // Keyed on status so a pipeline change remounts and replays the pop —
    // the badge visibly reacts the moment a call is logged.
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
        className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_6px_currentColor]"
      />
      {LABELS[status]}
    </motion.span>
  );
}

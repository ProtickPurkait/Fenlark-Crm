"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TimelineSkeleton } from "@/components/ui/skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AuditEvent, LeadHistoryLog } from "@/lib/supabase/database.types";

interface AuditTimelineProps {
  leadId: string;
  /** Bumped by the parent after a write, to force a refetch. */
  refreshKey?: number;
}

// Marker colour per event kind. System actions are rose so an SLA revocation
// is instantly distinguishable from anything a human did.
const DOT: Record<AuditEvent, string> = {
  lead_created: "bg-muted-foreground",
  assigned: "bg-[hsl(var(--neon-blue))]",
  reassigned: "bg-[hsl(var(--neon-violet))]",
  unassigned: "bg-[hsl(var(--neon-amber))]",
  status_changed: "bg-[hsl(var(--neon-blue))]",
  remark_added: "bg-[hsl(var(--neon-cyan))]",
  reschedule_set: "bg-[hsl(var(--neon-cyan))]",
  sla_revoked: "bg-[hsl(var(--neon-rose))]",
  lead_archived: "bg-muted-foreground",
};

// Two different meanings of a null id, so two different fallbacks: an
// assignee field is null because the lead is genuinely unassigned ("the
// pool"), while an actor field is null only because that account was later
// deleted (admin_set_user_active/admin_set_user_role's user still exists;
// this is specifically the delete-user path, where the FK sets actor_id to
// null but leaves actor_kind = 'user' so the row still reads as a human
// action, not a system one). Reusing one helper for both used to render a
// deleted user's past action as "the pool did X", which is nonsensical.
function describe(
  log: LeadHistoryLog,
  nameOf: (id: string | null) => string,
): string {
  switch (log.event_type) {
    case "lead_created":
      return "Lead created";
    case "assigned":
      return `Assigned to ${nameOf(log.to_assignee)}`;
    case "reassigned":
      return `Reassigned from ${nameOf(log.from_assignee)} to ${nameOf(log.to_assignee)}`;
    case "unassigned":
      return `Unassigned from ${nameOf(log.from_assignee)}`;
    case "sla_revoked":
      return `System revoked assignment (SLA breach) — was ${nameOf(log.from_assignee)}`;
    case "status_changed":
      return `Status changed: ${log.from_status ?? "—"} → ${log.to_status ?? "—"}`;
    case "remark_added":
      return "Remark added";
    case "reschedule_set":
      return `Follow-up scheduled for ${log.scheduled_at ? new Date(log.scheduled_at).toLocaleString() : "—"}`;
    case "lead_archived":
      return "Lead archived";
    default:
      return log.event_type;
  }
}

export function AuditTimeline({ leadId, refreshKey }: AuditTimelineProps) {
  const [logs, setLogs] = useState<LeadHistoryLog[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const [{ data: history }, { data: directory }] = await Promise.all([
        supabase
          .from("lead_history_logs")
          .select("*")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false }),
        supabase.from("telecaller_directory").select("id, full_name"),
      ]);

      if (cancelled) return;
      setLogs(history ?? []);
      setNames(
        Object.fromEntries((directory ?? []).map((d) => [d.id, d.full_name])),
      );
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [leadId, refreshKey]);

  const nameOfAssignee = (id: string | null) => (id ? (names[id] ?? "Unknown") : "the pool");
  const nameOfActor = (id: string | null) => (id ? (names[id] ?? "Unknown") : "a deleted user");

  if (loading) return <TimelineSkeleton rows={3} />;

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <motion.ol
      // Re-keyed on refreshKey so newly written entries replay the stagger,
      // making the just-saved rows visibly land.
      key={refreshKey}
      variants={staggerContainer(0.04)}
      initial="hidden"
      animate="show"
      className="space-y-3"
    >
      {logs.map((log) => (
        <motion.li
          key={log.id}
          variants={staggerItem}
          className="relative border-l border-white/10 pl-4 text-sm"
        >
          <span
            aria-hidden
            className={cn(
              "absolute -left-[3px] top-1.5 h-1.5 w-1.5 rounded-full",
              DOT[log.event_type],
            )}
          />
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium leading-snug">{describe(log, nameOfAssignee)}</span>
            <time className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {new Date(log.created_at).toLocaleString()}
            </time>
          </div>
          <div className="text-xs text-muted-foreground">
            {log.actor_kind === "system" ? (
              <span className="text-[hsl(var(--neon-rose))]">System</span>
            ) : (
              nameOfActor(log.actor_id)
            )}
          </div>
          {log.remark && (
            <p className="mt-1 rounded-md border border-white/5 bg-white/[0.03] px-2 py-1.5 text-foreground/80">
              {log.remark}
            </p>
          )}
          {log.note && !log.remark && (
            <p className="mt-1 italic text-muted-foreground">{log.note}</p>
          )}
        </motion.li>
      ))}
    </motion.ol>
  );
}

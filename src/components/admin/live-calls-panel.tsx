"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PhoneCall, Radio } from "lucide-react";
import type { createClient } from "@/lib/supabase/client";
import { formatDuration, formatDurationLabel } from "@/lib/use-call-session";
import { springSoft, staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

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

/**
 * Live call activity for the admin dashboard.
 *
 * Realtime is used as a *signal*, not a data source: the postgres_changes
 * payload carries raw ids with no caller or lead names, so each event triggers
 * a refetch of admin_call_activity() rather than trying to patch rows
 * client-side. At this volume (a handful of calls a minute) that is far
 * simpler than maintaining a local mirror, and it can never drift from the
 * database.
 *
 * Supabase's SDK (the heaviest chunk this app ships) is loaded via a dynamic
 * import rather than a top-level one, same as everywhere else — it's still
 * needed immediately on mount to open the realtime channel, so this doesn't
 * delay the subscription, it just moves the SDK out of the synchronously
 * -bundled main chunk into its own async-loaded one.
 */
export function LiveCallsPanel({
  initialActive,
  initialStats,
}: {
  initialActive: ActiveCallRow[];
  initialStats: CallStatRow[];
}) {
  const [active, setActive] = useState(initialActive);
  const [stats, setStats] = useState(initialStats);
  // Drives the ticking timers. The clock has to advance on its own — nothing
  // arrives from the server between the start and end of a call.
  const [now, setNow] = useState(() => Date.now());

  const refetch = useCallback(async () => {
    const { createClient: getClient } = await import("@/lib/supabase/client");
    const supabase = getClient();
    const { data } = await supabase.rpc("admin_call_activity");
    const row = data?.[0];
    if (row) {
      setActive(row.active);
      setStats(row.stats);
    }
  }, []);

  useEffect(() => {
    // Guards against the component unmounting before the dynamic import
    // resolves — without this, a fast unmount (e.g. navigating away right
    // after landing on the dashboard) would subscribe a channel for a
    // component that's already gone, and cleanup below would run before
    // `client`/`channel` are ever assigned.
    let cancelled = false;
    let client: ReturnType<typeof createClient> | null = null;
    let channel: ReturnType<
      ReturnType<typeof createClient>["channel"]
    > | null = null;

    void (async () => {
      const { createClient: getClient } = await import("@/lib/supabase/client");
      if (cancelled) return;
      client = getClient();
      channel = client
        .channel("call-sessions-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "call_sessions" },
          () => void refetch(),
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (client && channel) {
        void client.removeChannel(channel);
      }
    };
  }, [refetch]);

  // Only tick while something is actually running, so an idle dashboard isn't
  // re-rendering once a second all day.
  useEffect(() => {
    if (active.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active.length]);

  const totalCalls = stats.reduce((sum, s) => sum + s.calls_today, 0);
  const totalTalk = stats.reduce((sum, s) => sum + s.talk_seconds, 0);

  return (
    <div className="space-y-4">
      {/* ---------------- Live now ---------------- */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">On a call now</h2>
            {active.length > 0 && (
              <span className="relative flex h-2 w-2">
                {/* Two-layer dot: a static core plus an expanding ring, so the
                    "live" cue reads at a glance without being distracting. */}
                <motion.span
                  className="absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--neon-emerald))]"
                  animate={{ scale: [1, 2.2], opacity: [0.7, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[hsl(var(--neon-emerald))]" />
              </span>
            )}
          </div>
          <Radio className="h-4 w-4 text-muted-foreground" />
        </div>

        <AnimatePresence mode="popLayout">
          {active.length === 0 ? (
            <motion.p
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-6 text-center text-xs text-muted-foreground"
            >
              No calls in progress.
            </motion.p>
          ) : (
            <motion.ul
              key="list"
              variants={staggerContainer(0.05)}
              initial="hidden"
              animate="show"
              className="space-y-2"
            >
              {active.map((call) => {
                const seconds = Math.max(
                  0,
                  Math.floor((now - new Date(call.started_at).getTime()) / 1000),
                );
                return (
                  <motion.li
                    key={call.session_id}
                    layout
                    variants={staggerItem}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={springSoft}
                    className="flex items-center gap-3 rounded-xl border border-[hsl(var(--neon-emerald)/0.25)] bg-[hsl(var(--neon-emerald)/0.07)] p-3"
                  >
                    <PhoneCall className="h-4 w-4 shrink-0 text-[hsl(var(--neon-emerald))]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {call.caller_name ?? "Unknown caller"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {call.lead_name}
                        <span className="mx-1.5 text-border">·</span>
                        <span className="font-mono">{call.lead_phone}</span>
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-sm tabular-nums text-[hsl(var(--neon-emerald))]">
                      {formatDuration(seconds)}
                    </span>
                  </motion.li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>

      {/* ---------------- Today ---------------- */}
      <div className="border-t border-white/5 pt-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Talk time today</h2>
          <span className="text-xs text-muted-foreground">
            {totalCalls} call{totalCalls === 1 ? "" : "s"}
            <span className="mx-1.5 text-border">·</span>
            {formatDurationLabel(totalTalk)}
          </span>
        </div>

        {stats.length === 0 ? (
          <p className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-6 text-center text-xs text-muted-foreground">
            No calls logged today yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {stats.map((s) => {
              // Bar is relative to the busiest caller, so the comparison stays
              // readable regardless of absolute volume.
              const max = Math.max(...stats.map((x) => x.talk_seconds), 1);
              const pct = Math.round((s.talk_seconds / max) * 100);
              return (
                <li key={s.caller_id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{s.caller_name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {s.calls_today} · {formatDurationLabel(s.talk_seconds)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                    <motion.div
                      className={cn(
                        "h-full rounded-full",
                        "bg-[hsl(var(--neon-blue))]",
                      )}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={springSoft}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

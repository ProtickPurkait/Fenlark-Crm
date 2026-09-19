"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Info, TriangleAlert } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { TelecallerActivityRow } from "@/lib/supabase/database.types";

// Thresholds for flagging a day as worth a conversation. Deliberately generous:
// a false alarm costs an admin's trust in the whole screen, and a telecaller
// unfairly accused costs a great deal more.
const GAP_WARN_SECONDS = 90 * 60;
const GAP_CRITICAL_SECONDS = 180 * 60;
// A call too short to have been a conversation. Below this it is a dial that
// rang out or was cut — normal in volume, suspicious as a *pattern*.
const SHORT_CALL_RATIO = 0.4;
const SHORT_CALL_FLOOR = 5;

function hm(seconds: number | null): string {
  if (seconds === null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function clockTime(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Flag {
  level: "warn" | "critical";
  text: string;
}

/** Every flag states the observation, never a conclusion: "4h 20m with no
 *  activity" is a fact this data supports; "not working" is not. */
function flagsFor(r: TelecallerActivityRow): Flag[] {
  const flags: Flag[] = [];

  if (r.longest_gap_seconds !== null) {
    if (r.longest_gap_seconds >= GAP_CRITICAL_SECONDS) {
      flags.push({ level: "critical", text: `${hm(r.longest_gap_seconds)} with no calls or updates` });
    } else if (r.longest_gap_seconds >= GAP_WARN_SECONDS) {
      flags.push({ level: "warn", text: `${hm(r.longest_gap_seconds)} quiet stretch` });
    }
  }

  if (r.clocked_seconds > 0 && r.dispositions === 0) {
    flags.push({ level: "critical", text: "Clocked in, nothing logged" });
  }

  if (r.calls >= SHORT_CALL_FLOOR && r.short_calls / r.calls >= SHORT_CALL_RATIO) {
    flags.push({ level: "warn", text: `${r.short_calls} of ${r.calls} calls under 20s` });
  }

  if (r.manual_duration_count > 0) {
    flags.push({
      level: "warn",
      text: `${r.manual_duration_count} call time${r.manual_duration_count === 1 ? "" : "s"} typed by hand`,
    });
  }

  return flags;
}

export function ActivityClient({
  rows,
  date,
  today,
  timeZone,
}: {
  rows: TelecallerActivityRow[];
  date: string;
  today: string;
  timeZone: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function goToDate(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === today) params.delete("date");
    else params.set("date", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  function shiftDay(days: number) {
    // Parsed as UTC and shifted in UTC: this is a plain calendar date with no
    // time component, and running it through the local zone would slide it a
    // day for any viewer west of UTC.
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    goToDate(d.toISOString().slice(0, 10));
  }

  return (
    <motion.div
      variants={staggerContainer(0.06)}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      <motion.div variants={staggerItem} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What each telecaller actually did, from the records they cannot edit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shiftDay(-1)}
            aria-label="Previous day"
            className="flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-border transition-colors hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && goToDate(e.target.value)}
            className="h-9 rounded-lg bg-transparent px-3 text-sm ring-1 ring-border"
          />
          <button
            type="button"
            onClick={() => shiftDay(1)}
            disabled={date >= today}
            aria-label="Next day"
            className="flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-border transition-colors hover:bg-accent disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </motion.div>

      {rows.length === 0 ? (
        <motion.div
          variants={staggerItem}
          className="glass rounded-2xl px-6 py-16 text-center text-sm text-muted-foreground"
        >
          No active telecallers to report on.
        </motion.div>
      ) : (
        <motion.div variants={staggerItem} className="grid gap-3 lg:grid-cols-2">
          {rows.map((r) => {
            const flags = flagsFor(r);
            const worst = flags.some((f) => f.level === "critical")
              ? "critical"
              : flags.length > 0
                ? "warn"
                : null;

            return (
              <div
                key={r.telecaller_id}
                className={cn(
                  "glass rounded-xl p-4",
                  worst === "critical" && "ring-1 ring-[hsl(var(--neon-rose)/0.4)]",
                  worst === "warn" && "ring-1 ring-[hsl(var(--neon-amber)/0.35)]",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium tracking-tight">{r.full_name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {r.clock_in_at ? (
                      <>
                        {clockTime(r.clock_in_at, timeZone)} –{" "}
                        {r.clock_out_at ? clockTime(r.clock_out_at, timeZone) : "still in"}
                        {" · "}
                        {hm(r.clocked_seconds)}
                      </>
                    ) : (
                      <span className="text-[hsl(var(--neon-amber))]">Did not clock in</span>
                    )}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-4 gap-2">
                  <Metric label="Logged" value={String(r.dispositions)} />
                  <Metric label="Calls" value={String(r.calls)} />
                  <Metric label="Talk" value={hm(r.talk_seconds)} soft />
                  <Metric
                    label="Longest gap"
                    value={hm(r.longest_gap_seconds)}
                    tone={
                      r.longest_gap_seconds === null
                        ? undefined
                        : r.longest_gap_seconds >= GAP_CRITICAL_SECONDS
                          ? "critical"
                          : r.longest_gap_seconds >= GAP_WARN_SECONDS
                            ? "warn"
                            : undefined
                    }
                  />
                </div>

                <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
                  <span>Median call {r.median_call_seconds}s</span>
                  <span>·</span>
                  <span>{r.warm_count} warm</span>
                  <span>{r.converted_count} converted</span>
                  <span>{r.dead_count} dead</span>
                  {r.first_action_at && (
                    <>
                      <span>·</span>
                      <span>
                        Worked {clockTime(r.first_action_at, timeZone)}–
                        {clockTime(r.last_action_at, timeZone)}
                      </span>
                    </>
                  )}
                </div>

                {flags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {flags.map((f) => (
                      <span
                        key={f.text}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                          f.level === "critical"
                            ? "bg-[hsl(var(--neon-rose)/0.1)] text-[hsl(var(--neon-rose))] ring-[hsl(var(--neon-rose)/0.3)]"
                            : "bg-[hsl(var(--neon-amber)/0.1)] text-[hsl(var(--neon-amber))] ring-[hsl(var(--neon-amber)/0.3)]",
                        )}
                      >
                        <TriangleAlert className="h-3 w-3" />
                        {f.text}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </motion.div>
      )}

      {/* Stated on the screen itself, not buried in a doc: these numbers get
          read before difficult conversations, and their reliability is not
          uniform. An admin who treats talk time as fact will eventually
          accuse the wrong person. */}
      <motion.div
        variants={staggerItem}
        className="flex items-start gap-2.5 rounded-xl border border-border bg-muted px-4 py-3 text-xs text-muted-foreground"
      >
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="space-y-1">
          <p>
            <span className="font-medium text-foreground">Longest gap and Logged are the reliable numbers.</span>{" "}
            Both come from the audit trail, which is append-only — a telecaller
            can add to it, never erase from it.
          </p>
          <p>
            <span className="font-medium text-foreground">Talk is an estimate, not a measurement.</span>{" "}
            The app cannot see the phone dialer, so it times how long the app
            was in the background, and a telecaller can edit that number before
            saving — which is what &ldquo;typed by hand&rdquo; counts. Treat a
            high talk time on its own as a question, never an answer. Routing
            calls through a telephony provider is what would make it a fact.
          </p>
          <p>
            Clock-in and clock-out are self-reported. A gap flag means the
            records show nothing happened, not that nothing happened.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Metric({
  label,
  value,
  tone,
  soft,
}: {
  label: string;
  value: string;
  tone?: "warn" | "critical";
  soft?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tone === "critical" && "text-[hsl(var(--neon-rose))]",
          tone === "warn" && "text-[hsl(var(--neon-amber))]",
          // Talk time is rendered quieter than the columns beside it on
          // purpose — it is the least trustworthy number on the card.
          !tone && soft && "text-muted-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

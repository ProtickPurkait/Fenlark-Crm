"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, Info, TriangleAlert } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type {
  TelecallerActivityCallEntry,
  TelecallerActivityLogEntry,
  TelecallerActivityRow,
} from "@/lib/supabase/database.types";

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

                <ActivityLogSection
                  telecallerId={r.telecaller_id}
                  date={date}
                  timeZone={timeZone}
                />
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

type TimelineEntry =
  | { kind: "log"; at: string; log: TelecallerActivityLogEntry }
  | { kind: "call"; at: string; call: TelecallerActivityCallEntry };

function mergeTimeline(
  logs: TelecallerActivityLogEntry[],
  calls: TelecallerActivityCallEntry[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...logs.map((log): TimelineEntry => ({ kind: "log", at: log.created_at, log })),
    ...calls.map((call): TimelineEntry => ({ kind: "call", at: call.started_at, call })),
  ];
  // Newest first, matching the lead-level timeline (AuditTimeline).
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

function describeLog(log: TelecallerActivityLogEntry): string {
  switch (log.event_type) {
    case "lead_created":
      return "Lead created";
    case "assigned":
      return `Assigned to ${log.to_assignee_name ?? "Unknown"}`;
    case "reassigned":
      return `Reassigned from ${log.from_assignee_name ?? "Unknown"} to ${log.to_assignee_name ?? "Unknown"}`;
    case "unassigned":
      return `Unassigned from ${log.from_assignee_name ?? "Unknown"}`;
    case "sla_revoked":
      return `System revoked assignment (SLA breach) — was ${log.from_assignee_name ?? "Unknown"}`;
    case "status_changed":
      return `Status changed: ${log.from_status ?? "—"} → ${log.to_status ?? "—"}`;
    case "remark_added":
      return "Call logged";
    case "reschedule_set":
      return `Follow-up scheduled for ${log.scheduled_at ? new Date(log.scheduled_at).toLocaleString() : "—"}`;
    case "lead_archived":
      return "Lead archived";
    default:
      return log.event_type;
  }
}

function describeCall(call: TelecallerActivityCallEntry): string {
  if (call.ended_reason === "sweep") return "Call ended without reporting back";
  if (call.duration_seconds === null) return "Call in progress";
  const suffix = call.duration_source === "manual" ? " (typed by hand)" : "";
  return `Call · ${hm(call.duration_seconds)}${suffix}`;
}

/**
 * Per-telecaller drill-down for one day: the individual audit-trail entries
 * and calls behind the Logged/Calls numbers on the card above. Fetched on
 * demand (not with the page load) since most cards on a busy day are never
 * expanded, and cached per telecaller+date so toggling twice doesn't refetch.
 */
function ActivityLogSection({
  telecallerId,
  date,
  timeZone,
}: {
  telecallerId: string;
  date: string;
  timeZone: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error" }
    | { status: "loaded"; entries: TimelineEntry[] }
  >({ status: "idle" });

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || state.status === "loading" || state.status === "loaded") return;

    setState({ status: "loading" });
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_telecaller_activity_log", {
      p_date: date,
      p_telecaller_id: telecallerId,
    });

    if (error) {
      setState({ status: "error" });
      return;
    }
    if (!data || data.length === 0) {
      setState({ status: "loaded", entries: [] });
      return;
    }

    const row = data[0];
    setState({ status: "loaded", entries: mergeTimeline(row.logs, row.calls) });
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        {open ? "Hide activity log" : "View activity log"}
      </button>

      {open && (
        <div className="mt-2.5">
          {state.status === "loading" && (
            <p className="text-xs text-muted-foreground">Loading…</p>
          )}
          {state.status === "error" && (
            <p className="text-xs text-[hsl(var(--neon-rose))]">Could not load the log.</p>
          )}
          {state.status === "loaded" && state.entries.length === 0 && (
            <p className="text-xs text-muted-foreground">Nothing recorded for this day.</p>
          )}
          {state.status === "loaded" && state.entries.length > 0 && (
            <ol className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
              {state.entries.map((entry) => (
                <li
                  key={`${entry.kind}-${entry.kind === "log" ? entry.log.id : entry.call.id}`}
                  className="text-xs"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium leading-snug text-foreground">
                      {entry.kind === "log" ? describeLog(entry.log) : describeCall(entry.call)}
                    </span>
                    <time className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {clockTime(entry.at, timeZone)}
                    </time>
                  </div>
                  <div className="text-muted-foreground">
                    {entry.kind === "log" ? entry.log.lead_full_name : entry.call.lead_full_name}
                  </div>
                  {entry.kind === "log" && entry.log.remark && (
                    <p className="mt-1 rounded-md border border-border bg-muted px-2 py-1.5 text-foreground/80">
                      {entry.log.remark}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

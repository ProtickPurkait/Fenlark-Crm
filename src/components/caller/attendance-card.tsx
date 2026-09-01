"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, LogIn, LogOut, Loader2, MessageCircle, TriangleAlert } from "lucide-react";
import { MotionButton } from "@/components/ui/motion-button";
import { toWhatsAppNumber } from "@/lib/phone";
import { buildReportMessage, DEFAULT_REPORT_TIMEZONE } from "@/lib/daily-report";
import { springSoft, staggerContainer, staggerItem } from "@/lib/motion";
import type { Attendance } from "@/lib/supabase/database.types";

interface AttendanceCardProps {
  initialAttendance: Attendance | null;
  agentName: string;
  adminWhatsappNumber: string | null;
  dailyReportTemplate: string;
  reportTimezone: string;
}

// Pinned to the business timezone rather than the device's, for the same
// reason the report's dates are (see formatReportDate): a shift that started
// at 09:00 IST must read 09:00 on every handset, whatever it is set to.
function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * One shift per day (see caller_clock_in()'s unique constraint) — there is no
 * "clock in again" path here once clock_out_at is set, matching that model.
 */
export function AttendanceCard({
  initialAttendance,
  agentName,
  adminWhatsappNumber,
  dailyReportTemplate,
  reportTimezone,
}: AttendanceCardProps) {
  const tz = reportTimezone || DEFAULT_REPORT_TIMEZONE;
  const [attendance, setAttendance] = useState(initialAttendance);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function handleClockIn() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("caller_clock_in");

    busyRef.current = false;
    setBusy(false);

    if (rpcError) {
      setError("Could not clock in. Refresh and try again.");
      return;
    }
    setAttendance(data);
  }

  async function handleClockOut() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("caller_clock_out");

    busyRef.current = false;
    setBusy(false);

    if (rpcError) {
      setError("Could not clock out. Refresh and try again.");
      return;
    }
    setAttendance(data);
  }

  async function handleGenerateReport() {
    if (!attendance || generating) return;
    setGenerating(true);
    setError(null);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data, error: rpcError } = await supabase
      .rpc("my_daily_report_summary", { p_date: attendance.work_date })
      .single();

    setGenerating(false);

    if (rpcError || !data) {
      setError("Could not build the report. Refresh and try again.");
      return;
    }

    const message = buildReportMessage(dailyReportTemplate, data, {
      date: attendance.work_date,
      agent: agentName,
      timeZone: tz,
    });
    const link = `https://wa.me/${toWhatsAppNumber(adminWhatsappNumber ?? "")}?text=${encodeURIComponent(message)}`;
    window.open(link, "_blank", "noopener,noreferrer");
  }

  return (
    <motion.div
      variants={staggerContainer(0.05)}
      initial="hidden"
      animate="show"
      className="glass rounded-xl p-4"
    >
      <motion.div
        variants={staggerItem}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2.5 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          {!attendance ? (
            <span className="text-muted-foreground">Not clocked in yet</span>
          ) : !attendance.clock_out_at ? (
            <span>
              Clocked in at{" "}
              <span className="font-medium tabular-nums">
                {formatTime(attendance.clock_in_at, tz)}
              </span>
            </span>
          ) : (
            <span>
              <span className="font-medium tabular-nums">
                {formatTime(attendance.clock_in_at, tz)}
              </span>
              {" – "}
              <span className="font-medium tabular-nums">
                {formatTime(attendance.clock_out_at, tz)}
              </span>
            </span>
          )}
        </div>

        {!attendance ? (
          <MotionButton size="sm" onClick={handleClockIn} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
            Clock In
          </MotionButton>
        ) : !attendance.clock_out_at ? (
          <MotionButton variant="glass" size="sm" onClick={handleClockOut} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            Clock Out
          </MotionButton>
        ) : (
          <MotionButton
            variant="emerald"
            size="sm"
            onClick={handleGenerateReport}
            disabled={generating || !adminWhatsappNumber}
            title={
              adminWhatsappNumber
                ? undefined
                : "Ask your admin to add a WhatsApp number in Settings"
            }
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MessageCircle className="h-3.5 w-3.5" />
            )}
            Generate Report
          </MotionButton>
        )}
      </motion.div>

      {attendance?.clock_out_at && !adminWhatsappNumber && (
        <motion.p variants={staggerItem} className="mt-2 text-xs text-muted-foreground">
          Ask your admin to add a WhatsApp number in Settings before this can send.
        </motion.p>
      )}

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={springSoft}
            role="alert"
            className="mt-2 flex items-start gap-2 overflow-hidden rounded-lg border border-[hsl(var(--neon-rose)/0.3)] bg-[hsl(var(--neon-rose)/0.1)] px-3 py-2 text-xs text-[hsl(var(--neon-rose))]"
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

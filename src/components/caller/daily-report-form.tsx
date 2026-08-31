"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MotionButton } from "@/components/ui/motion-button";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { DailyReport } from "@/lib/supabase/database.types";

interface DailyReportFormProps {
  reportDate: string;
  initialReport: DailyReport | null;
}

interface Counts {
  warm_leads_count: string;
  converted_count: string;
  schedules_count: string;
  appointments_count: string;
}

const FIELDS: { key: keyof Counts; label: string; hint: string }[] = [
  { key: "warm_leads_count", label: "Warm Leads", hint: "Interested, still deciding" },
  { key: "converted_count", label: "Converted", hint: "Closed today" },
  { key: "schedules_count", label: "Schedules", hint: "Follow-up calls booked" },
  { key: "appointments_count", label: "Appointments", hint: "With a confirmed date" },
];

function countsFrom(report: DailyReport | null): Counts {
  return {
    warm_leads_count: String(report?.warm_leads_count ?? 0),
    converted_count: String(report?.converted_count ?? 0),
    schedules_count: String(report?.schedules_count ?? 0),
    appointments_count: String(report?.appointments_count ?? 0),
  };
}

/**
 * One row per telecaller per day (see caller_submit_daily_report() in
 * migration 1800). Submitting again the same day edits that same row rather
 * than creating a duplicate, so this form always opens pre-filled with
 * whatever was last saved for `reportDate`.
 */
export function DailyReportForm({ reportDate, initialReport }: DailyReportFormProps) {
  const [counts, setCounts] = useState<Counts>(countsFrom(initialReport));
  const [notes, setNotes] = useState(initialReport?.notes ?? "");
  const [lastSaved, setLastSaved] = useState(initialReport?.updated_at ?? null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("caller_submit_daily_report", {
      p_report_date: reportDate,
      p_warm_leads_count: Number(counts.warm_leads_count) || 0,
      p_converted_count: Number(counts.converted_count) || 0,
      p_schedules_count: Number(counts.schedules_count) || 0,
      p_appointments_count: Number(counts.appointments_count) || 0,
      p_notes: notes.trim() || null,
    });

    savingRef.current = false;
    setSaving(false);

    if (rpcError) {
      setError("Could not save your report. Check your connection and try again.");
      return;
    }

    if (data) setLastSaved(data.updated_at);
    setSaved(true);
    setTimeout(() => setSaved(false), 2400);
  }

  return (
    <motion.form
      variants={staggerContainer(0.06)}
      initial="hidden"
      animate="show"
      onSubmit={handleSubmit}
      className="glass space-y-5 rounded-2xl p-5 sm:p-6"
    >
      <motion.div variants={staggerItem} className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">
            {reportDate === new Date().toISOString().slice(0, 10) ? "Today's Report" : "Report"}
          </h2>
          <p className="text-xs text-muted-foreground">{reportDate}</p>
        </div>
        {lastSaved && (
          <p className="shrink-0 text-[10px] text-muted-foreground">
            Last saved {new Date(lastSaved).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </motion.div>

      <motion.div variants={staggerItem} className="grid grid-cols-2 gap-3 sm:gap-4">
        {FIELDS.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={field.key} className="text-xs uppercase tracking-wider text-muted-foreground">
              {field.label}
            </Label>
            <Input
              id={field.key}
              type="number"
              inputMode="numeric"
              min={0}
              value={counts[field.key]}
              onChange={(e) => setCounts((c) => ({ ...c, [field.key]: e.target.value }))}
              className="text-center text-lg font-semibold tabular-nums"
            />
            <p className="text-[10px] text-muted-foreground">{field.hint}</p>
          </div>
        ))}
      </motion.div>

      <motion.div variants={staggerItem} className="space-y-1.5">
        <Label htmlFor="report_notes" className="text-xs uppercase tracking-wider text-muted-foreground">
          Notes (optional)
        </Label>
        <Textarea
          id="report_notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything worth flagging for the admin…"
        />
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            role="alert"
            className="flex items-start gap-2 overflow-hidden rounded-lg border border-[hsl(var(--neon-rose)/0.3)] bg-[hsl(var(--neon-rose)/0.1)] px-3 py-2 text-sm text-[hsl(var(--neon-rose))]"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </motion.p>
        )}
      </AnimatePresence>

      <motion.div variants={staggerItem}>
        <MotionButton type="submit" variant="emerald" size="lg" className="w-full" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : saved ? (
            <>
              <Check className="h-4 w-4" />
              Saved
            </>
          ) : (
            "Submit report"
          )}
        </MotionButton>
      </motion.div>
    </motion.form>
  );
}

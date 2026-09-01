"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { MotionButton } from "@/components/ui/motion-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { fillTemplate } from "@/lib/phone";
import { formatLeadList } from "@/lib/daily-report";
import { springSoft, staggerContainer, staggerItem } from "@/lib/motion";
import type { SystemSettings } from "@/lib/supabase/database.types";

// Mirrors `check (stale_sla_hours between 1 and 720)` in
// supabase/migrations/..._tables.sql. Checked here so the admin gets an
// inline message instead of a raw Postgres constraint error.
const SLA_MIN = 1;
const SLA_MAX = 720;

export function SettingsClient({
  initial,
  updatedByName,
}: {
  initial: SystemSettings;
  updatedByName: string | null;
}) {
  const [settings, setSettings] = useState(initial);
  const [enabled, setEnabled] = useState(initial.stale_recycling_enabled);
  const [hours, setHours] = useState(String(initial.stale_sla_hours));
  const [template, setTemplate] = useState(initial.whatsapp_template);
  const [adminWhatsapp, setAdminWhatsapp] = useState(initial.admin_whatsapp_number ?? "");
  const [reportTemplate, setReportTemplate] = useState(initial.daily_report_template);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recycling, setRecycling] = useState(false);
  const [recycleResult, setRecycleResult] = useState<number | null>(null);

  // Synchronous latches. React state updates are async, so a fast double-click
  // can fire two RPCs before `saving` has re-rendered as true.
  const savingRef = useRef(false);
  const recyclingRef = useRef(false);

  const dirty =
    enabled !== settings.stale_recycling_enabled ||
    hours !== String(settings.stale_sla_hours) ||
    template !== settings.whatsapp_template ||
    adminWhatsapp !== (settings.admin_whatsapp_number ?? "") ||
    reportTemplate !== settings.daily_report_template;

  async function handleSave() {
    if (savingRef.current) return;

    const parsedHours = Number(hours);
    if (!Number.isInteger(parsedHours) || parsedHours < SLA_MIN || parsedHours > SLA_MAX) {
      setError(`SLA hours must be a whole number between ${SLA_MIN} and ${SLA_MAX}.`);
      return;
    }
    if (template.trim() === "") {
      setError("The WhatsApp template cannot be empty.");
      return;
    }
    if (reportTemplate.trim() === "") {
      setError("The daily report template cannot be empty.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("admin_update_settings", {
      p_enabled: enabled,
      p_sla_hours: parsedHours,
      p_whatsapp_template: template,
      // Sent as "" rather than omitted when cleared: the RPC treats an actual
      // empty string as "clear it" and a genuinely absent argument as "leave
      // it alone" — see admin_update_settings() in migration 1900.
      p_admin_whatsapp_number: adminWhatsapp,
      p_daily_report_template: reportTemplate,
    });

    savingRef.current = false;
    setSaving(false);

    if (rpcError) {
      setError(
        rpcError.message.includes("forbidden")
          ? "Your account no longer has admin rights. Sign out and back in."
          : "Could not save settings. Check your connection and try again.",
      );
      return;
    }

    // Re-seed from the row the database actually returned, so `dirty` compares
    // against persisted truth rather than what we hoped we wrote.
    if (data) setSettings(data as SystemSettings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2400);
  }

  async function handleRecycleNow() {
    if (recyclingRef.current) return;
    recyclingRef.current = true;
    setRecycling(true);
    setError(null);
    setRecycleResult(null);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("admin_run_recycle_now");

    recyclingRef.current = false;
    setRecycling(false);

    if (rpcError) {
      setError("Could not run the sweep. Check your connection and try again.");
      return;
    }
    setRecycleResult(data ?? 0);
  }

  return (
    <motion.div
      variants={staggerContainer(0.07)}
      initial="hidden"
      animate="show"
      className="max-w-3xl space-y-4"
    >
      <motion.div variants={staggerItem}>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Applies to every telecaller immediately — the recycler reads these
          values on each run, so there is nothing to redeploy.
        </p>
      </motion.div>

      {/* ---------------------------------------------------------------- */}
      <motion.section variants={staggerItem} className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-medium tracking-tight">Stale lead recycling</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Returns a lead to the unassigned pool if it is still{" "}
              <span className="text-foreground/80">New</span> after the SLA
              window. The audit trail records it as a system action, not as the
              telecaller&apos;s.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {enabled ? "On" : "Off"}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              label="Stale lead recycling"
            />
          </div>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label
              htmlFor="sla-hours"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              SLA window (hours)
            </Label>
            <Input
              id="sla-hours"
              type="number"
              min={SLA_MIN}
              max={SLA_MAX}
              step={1}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Between {SLA_MIN} and {SLA_MAX}. The sweep runs every 15 minutes
              via pg_cron, independently of this app.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Manual sweep
            </Label>
            <MotionButton
              variant="glass"
              onClick={handleRecycleNow}
              disabled={recycling}
              className="w-full"
            >
              {recycling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
              {recycling ? "Sweeping…" : "Run now"}
            </MotionButton>
            <AnimatePresence mode="wait">
              {recycleResult !== null && (
                <motion.p
                  key={recycleResult}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={springSoft}
                  className="text-xs text-[hsl(var(--neon-emerald))]"
                >
                  {recycleResult === 0
                    ? "No leads were past their SLA."
                    : `Reclaimed ${recycleResult} lead${recycleResult === 1 ? "" : "s"}.`}
                </motion.p>
              )}
            </AnimatePresence>
            {!enabled && (
              <p className="text-xs text-muted-foreground">
                Recycling is off, so a manual run will reclaim nothing.
              </p>
            )}
          </div>
        </div>
      </motion.section>

      {/* ---------------------------------------------------------------- */}
      <motion.section variants={staggerItem} className="glass rounded-2xl p-6">
        <h2 className="font-medium tracking-tight">WhatsApp template</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pre-filled when a telecaller taps WhatsApp on a lead.{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {"{{name}}"}
          </code>{" "}
          and{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {"{{agent}}"}
          </code>{" "}
          are substituted per message.
        </p>

        <Textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={4}
          className="mt-4 resize-none"
        />

        <div className="mt-3 rounded-lg border border-border bg-muted p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Preview
          </p>
          <p className="mt-1 text-sm text-foreground/80">
            {fillTemplate(template, { name: "Rohit Sharma", agent: "Priya" })}
          </p>
        </div>
      </motion.section>

      {/* ---------------------------------------------------------------- */}
      <motion.section variants={staggerItem} className="glass rounded-2xl p-6">
        <h2 className="font-medium tracking-tight">Daily report WhatsApp</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Where a telecaller&apos;s Generate Report button sends to, once they
          clock out for the day. Left empty, that button stays disabled for
          everyone.
        </p>

        <div className="mt-4 space-y-1.5">
          <Label
            htmlFor="admin-whatsapp"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Your WhatsApp number
          </Label>
          <Input
            id="admin-whatsapp"
            type="tel"
            placeholder="+91 98765 43210"
            value={adminWhatsapp}
            onChange={(e) => setAdminWhatsapp(e.target.value)}
            className="font-mono"
          />
        </div>

        <div className="mt-4 space-y-1.5">
          <Label
            htmlFor="report-template"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Report message
          </Label>
          <p className="text-xs text-muted-foreground">
            {(
              [
                "date",
                "agent",
                "warm_count",
                "warm",
                "converted_count",
                "converted",
                "schedules_count",
                "schedules",
                "appointments_count",
                "appointments",
              ] as const
            ).map((token, i) => (
              <span key={token}>
                {i > 0 && " · "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  {`{{${token}}}`}
                </code>
              </span>
            ))}
          </p>
          <p className="text-xs text-muted-foreground">
            The <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{"{{warm}}"}</code>
            -style tokens (and converted/schedules/appointments) expand to a numbered list of
            leads by name and phone, not a count — use the <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">_count</code> tokens
            for the number on its own.
          </p>
          <Textarea
            id="report-template"
            value={reportTemplate}
            onChange={(e) => setReportTemplate(e.target.value)}
            rows={10}
            className="resize-none font-mono text-sm"
          />
        </div>

        <div className="mt-3 rounded-lg border border-border bg-muted p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Preview
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-foreground/80">
            {fillTemplate(reportTemplate, {
              date: "2026-09-01",
              agent: "Priya",
              warm_count: "2",
              warm: formatLeadList([
                { full_name: "Rohit Sharma", phone: "9876543210" },
                { full_name: "Anjali Mehta", phone: "9876543211" },
              ]),
              converted_count: "1",
              converted: formatLeadList([{ full_name: "Karan Gupta", phone: "9876543212" }]),
              schedules_count: "1",
              schedules: formatLeadList([
                { full_name: "Sana Khan", phone: "9876543213", scheduled_at: "2026-09-03T11:00:00Z" },
              ]),
              appointments_count: "1",
              appointments: formatLeadList([
                { full_name: "Vikram Rao", phone: "9876543214", scheduled_at: "2026-09-05T09:30:00Z" },
              ]),
            })}
          </p>
        </div>
      </motion.section>

      {/* ---------------------------------------------------------------- */}
      <motion.div
        variants={staggerItem}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-xs text-muted-foreground">
          Last changed {new Date(settings.updated_at).toLocaleString()}
          {updatedByName ? ` by ${updatedByName}` : ""}
        </p>

        <div className="flex items-center gap-3">
          <AnimatePresence mode="wait">
            {saved && (
              <motion.span
                key="saved"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={springSoft}
                className="inline-flex items-center gap-1.5 text-xs text-[hsl(var(--neon-emerald))]"
              >
                <Check className="h-3.5 w-3.5" />
                Saved
              </motion.span>
            )}
          </AnimatePresence>
          <MotionButton onClick={handleSave} disabled={saving || !dirty}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Saving…" : "Save changes"}
          </MotionButton>
        </div>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={springSoft}
            className="flex items-start gap-2 rounded-lg border border-[hsl(var(--neon-rose)/0.3)] bg-[hsl(var(--neon-rose)/0.1)] p-3 text-sm text-[hsl(var(--neon-rose))]"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

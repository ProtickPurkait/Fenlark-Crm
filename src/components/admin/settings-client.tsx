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
    template !== settings.whatsapp_template;

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

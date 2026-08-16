"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Loader2,
  MessageCircle,
  Phone,
  PhoneOff,
  TriangleAlert,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MotionButton } from "@/components/ui/motion-button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeadStatusBadge } from "@/components/shared/lead-status-badge";
import { AuditTimeline } from "@/components/shared/audit-timeline";
import { buildWhatsAppLink } from "@/lib/phone";
import {
  useCallSession,
  formatDuration,
  formatDurationLabel,
} from "@/lib/use-call-session";
import {
  springSnappy,
  staggerContainer,
  staggerItem,
} from "@/lib/motion";
import type { LeadQueueRow, LeadStatus } from "@/lib/supabase/database.types";

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "attempted", label: "Attempted / No Answer" },
  { value: "connected", label: "Connected / In Discussion" },
  { value: "warm", label: "Warm Lead" },
  { value: "rescheduled", label: "Rescheduled / Call Back" },
  { value: "converted", label: "Converted" },
  { value: "dead", label: "Dead / Not Interested" },
];

interface CallDispositionDrawerProps {
  lead: LeadQueueRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  whatsappTemplate: string;
  onSaved: () => void;
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in *local* time with no timezone
// suffix — new Date(iso).toISOString() would shift it to UTC and silently show
// the telecaller the wrong hour.
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CallDispositionDrawer({
  lead,
  open,
  onOpenChange,
  agentName,
  whatsappTemplate,
  onSaved,
}: CallDispositionDrawerProps) {
  const [status, setStatus] = useState<LeadStatus>("attempted");
  const [remark, setRemark] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Seconds measured for the call just made, pre-filled into the form. Null
  // until a tracked call completes, so a disposition logged without dialling
  // from the app doesn't claim a fabricated duration.
  const [callSeconds, setCallSeconds] = useState<number | null>(null);
  // The session the duration above belongs to, kept so an edited value can be
  // written back against the right row when the disposition is saved.
  const [callSessionId, setCallSessionId] = useState<string | null>(null);
  const autoSecondsRef = useRef<number | null>(null);

  const {
    active: activeCall,
    elapsed,
    startCall,
    endCall,
    correctDuration,
  } = useCallSession({
    onCallEnded: ({ sessionId, durationSeconds }) => {
      setCallSessionId(sessionId);
      setCallSeconds(durationSeconds);
      autoSecondsRef.current = durationSeconds;
    },
  });
  // Synchronous latch. The `submitting` state alone is not enough: setState is
  // async, so two clicks dispatched in the same tick can both clear the guard
  // before React re-renders with the button disabled — writing the call twice.
  const inFlight = useRef(false);

  // Keyed on lead.id, NOT the whole `lead` object. refetch() returns a fresh
  // object every save, so depending on `lead` re-ran this effect immediately
  // after a successful write and wiped the "Saved" confirmation ~200ms after
  // it appeared.
  useEffect(() => {
    if (!lead) return;
    setStatus(lead.status === "new" ? "attempted" : lead.status);
    setRemark("");
    setScheduledAt(toDatetimeLocal(lead.scheduled_at));
    setError(null);
    setSaved(false);
    // A measured duration belongs to the lead it was measured on — carrying it
    // to the next lead would attribute one call's time to another.
    setCallSeconds(null);
    setCallSessionId(null);
    autoSecondsRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

  if (!lead) return null;

  const requiresSchedule = status === "rescheduled";
  // Feeds the input's `min`, so the native picker will not offer a past slot.
  const nowLocal = toDatetimeLocal(new Date().toISOString());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lead || inFlight.current) return;
    setError(null);

    if (!remark.trim()) {
      setError("A remark is required.");
      return;
    }
    if (requiresSchedule) {
      if (!scheduledAt) {
        setError("Rescheduled leads need a follow-up date and time.");
        return;
      }
      // Mirrors log_call_interaction's own check. Without this the database
      // rejected it correctly but the raw Postgres error string ended up
      // rendered in the UI.
      if (new Date(scheduledAt).getTime() <= Date.now()) {
        setError("The follow-up date and time must be in the future.");
        return;
      }
    }

    inFlight.current = true;
    setSubmitting(true);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("log_call_interaction", {
      p_lead_id: lead.id,
      p_status: status,
      p_remark: remark.trim(),
      p_scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    });

    setSubmitting(false);
    inFlight.current = false;

    if (rpcError) {
      // Map the exceptions we deliberately raise; never surface raw Postgres
      // text, which leaks schema details and reads as a crash to the user.
      setError(
        rpcError.message.includes("not assigned to you")
          ? "This lead is no longer assigned to you. Refresh your queue."
          : rpcError.message.includes("future")
            ? "The follow-up date and time must be in the future."
            : rpcError.message.includes("remark is required")
              ? "A remark is required."
              : "Could not save the interaction. Please try again.",
      );
      return;
    }

    // Persist a hand-edited duration. Only when it actually differs from what
    // was measured — an untouched value is already stored, and rewriting it
    // would relabel an automatic measurement as a manual one.
    if (
      callSessionId &&
      callSeconds !== null &&
      callSeconds !== autoSecondsRef.current
    ) {
      await correctDuration(callSessionId, callSeconds);
    }

    setRemark("");
    setRefreshKey((k) => k + 1);
    // Brief success state on the button itself, so the save is confirmed
    // in place rather than only implied by the list refreshing behind.
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="responsive"
        className="scrollbar-slim flex w-full flex-col gap-6 overflow-y-auto pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-6"
      >
        <motion.div
          variants={staggerContainer(0.05, 0.08)}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-6"
        >
          <motion.div variants={staggerItem}>
            <SheetHeader>
              {/* min-w-0 + truncate on the name, shrink-0 on the badge: without
                  both, a long lead name squeezes the badge below its content
                  width and it overflows on top of the name on narrow screens. */}
              <div className="flex items-center justify-between gap-2 pr-8">
                <SheetTitle className="min-w-0 truncate text-xl tracking-tight">
                  {lead.full_name}
                </SheetTitle>
                <LeadStatusBadge status={lead.status} className="shrink-0" />
              </div>
              <SheetDescription className="font-mono text-xs">
                {lead.phone}
                {lead.city ? ` · ${lead.city}` : ""}
              </SheetDescription>
            </SheetHeader>

            {/* SLA countdown — only while the lead is still untouched, since
                that is the only state the recycling engine reclaims from. */}
            {lead.status === "new" && lead.sla_hours_remaining !== null && (
              <motion.div
                variants={staggerItem}
                className="mt-3 flex items-center gap-2 rounded-lg border border-[hsl(var(--neon-amber)/0.25)] bg-[hsl(var(--neon-amber)/0.08)] px-3 py-2 text-xs text-[hsl(var(--neon-amber))]"
              >
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Returns to the unassigned pool in{" "}
                  <strong className="font-semibold">
                    {Math.floor(lead.sla_hours_remaining)}h
                  </strong>{" "}
                  unless you log a call.
                </span>
              </motion.div>
            )}
          </motion.div>

          {/* The two actions a telecaller actually reaches for mid-call, so
              they get a full 44px+ target on phones (h-12) rather than the
              default control height. */}
          <motion.div variants={staggerItem} className="flex gap-2">
            {activeCall ? (
              // Mid-call state. Returning to the app ends the call
              // automatically; this is the manual escape hatch for when the
              // telecaller stays in the browser (e.g. dialling on a desk phone).
              <MotionButton
                variant="destructive"
                className="h-12 w-full text-base sm:h-10 sm:text-sm"
                onClick={() => endCall()}
              >
                <PhoneOff className="h-4 w-4" />
                <span className="flex items-center gap-2">
                  End call
                  <span className="font-mono tabular-nums">
                    {formatDuration(elapsed)}
                  </span>
                </span>
              </MotionButton>
            ) : (
              <MotionButton
                variant="glass"
                className="h-12 w-full text-base sm:h-10 sm:text-sm"
                onClick={() => startCall(lead.id, lead.phone)}
              >
                <Phone className="h-4 w-4" />
                Call Now
              </MotionButton>
            )}
            <MotionButton
              variant="emerald"
              className="h-12 w-full text-base sm:h-10 sm:text-sm"
              onClick={() =>
                window.open(
                  buildWhatsAppLink(lead.phone, whatsappTemplate, {
                    name: lead.full_name,
                    agent: agentName,
                  }),
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </MotionButton>
          </motion.div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <motion.div variants={staggerItem} className="space-y-1.5">
              <Label htmlFor="status" className="text-xs uppercase tracking-wider text-muted-foreground">
                Update Pipeline Status
              </Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as LeadStatus)}
              >
                <SelectTrigger id="status" className="group">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </motion.div>

            <motion.div variants={staggerItem} className="space-y-1.5">
              <Label
                htmlFor="scheduled_at"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Next Follow-Up
                {/* AnimatePresence so the required marker fades in with the
                    field's new state rather than popping. */}
                <AnimatePresence>
                  {requiresSchedule && (
                    <motion.span
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -4 }}
                      className="ml-1 text-[hsl(var(--neon-rose))]"
                    >
                      required
                    </motion.span>
                  )}
                </AnimatePresence>
              </Label>
              <motion.input
                id="scheduled_at"
                type="datetime-local"
                value={scheduledAt}
                min={nowLocal}
                onChange={(e) => setScheduledAt(e.target.value)}
                animate={
                  requiresSchedule && !scheduledAt
                    ? { borderColor: "hsl(var(--neon-rose) / 0.5)" }
                    : { borderColor: "hsl(0 0% 100% / 0.1)" }
                }
                transition={springSnappy}
                // h-11/text-base on mobile matches ui/input.tsx — a
                // datetime-local under 16px triggers the same iOS focus-zoom.
                className="flex h-11 w-full rounded-lg border bg-white/5 px-3 text-base backdrop-blur-md transition-colors hover:border-white/20 focus-visible:border-[hsl(var(--neon-blue)/0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:h-10 sm:text-sm [color-scheme:dark]"
              />
            </motion.div>

            {/* Only shown once a call has actually been tracked, so a
                disposition logged without dialling from the app never carries
                an invented duration. */}
            <AnimatePresence>
              {callSeconds !== null && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-3 rounded-lg border border-[hsl(var(--neon-emerald)/0.25)] bg-[hsl(var(--neon-emerald)/0.08)] p-3">
                    <Phone className="h-4 w-4 shrink-0 text-[hsl(var(--neon-emerald))]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">
                        Call duration recorded
                      </p>
                      <p className="text-sm font-medium text-[hsl(var(--neon-emerald))]">
                        {formatDurationLabel(callSeconds)}
                      </p>
                    </div>
                    {/* Editable: the measurement includes ringing time, so the
                        telecaller gets the last word on what is recorded. */}
                    <input
                      type="number"
                      min={0}
                      max={14400}
                      step={1}
                      aria-label="Call duration in seconds"
                      value={callSeconds}
                      onChange={(e) =>
                        setCallSeconds(Math.max(0, Number(e.target.value) || 0))
                      }
                      className="h-9 w-20 shrink-0 rounded-md border border-white/10 bg-white/5 px-2 text-center font-mono text-sm [color-scheme:dark]"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">sec</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div variants={staggerItem} className="space-y-1.5">
              <Label htmlFor="remark" className="text-xs uppercase tracking-wider text-muted-foreground">
                Call Remarks
              </Label>
              <Textarea
                id="remark"
                rows={3}
                required
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Client requested a quote for web design…"
              />
            </motion.div>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  role="alert"
                  className="overflow-hidden rounded-lg border border-[hsl(var(--neon-rose)/0.3)] bg-[hsl(var(--neon-rose)/0.1)] px-3 py-2 text-sm text-[hsl(var(--neon-rose))]"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <motion.div variants={staggerItem}>
              <MotionButton
                type="submit"
                size="lg"
                className="w-full"
                disabled={submitting}
              >
                {/* mode="wait" so the outgoing label finishes before the next
                    one enters — crossfading three states in place looks broken. */}
                <AnimatePresence mode="wait" initial={false}>
                  {submitting ? (
                    <motion.span
                      key="saving"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="flex items-center gap-2"
                    >
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </motion.span>
                  ) : saved ? (
                    <motion.span
                      key="saved"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="flex items-center gap-2"
                    >
                      <Check className="h-4 w-4" />
                      Saved
                    </motion.span>
                  ) : (
                    <motion.span
                      key="idle"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                    >
                      Save Interaction
                    </motion.span>
                  )}
                </AnimatePresence>
              </MotionButton>
            </motion.div>
          </form>

          <motion.div variants={staggerItem} className="border-t border-white/10 pt-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Audit History
            </h4>
            <AuditTimeline leadId={lead.id} refreshKey={refreshKey} />
          </motion.div>
        </motion.div>
      </SheetContent>
    </Sheet>
  );
}

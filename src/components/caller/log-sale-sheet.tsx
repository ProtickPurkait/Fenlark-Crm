"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, TriangleAlert } from "lucide-react";
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
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { LeadQueueRow } from "@/lib/supabase/database.types";

interface LogSaleSheetProps {
  lead: LeadQueueRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogged: () => void;
}

/**
 * Kept separate from CallDispositionDrawer: a sale claim is a distinct action
 * from a disposition, and letting a telecaller reach it straight from the
 * queue card (rather than nested inside another form) keeps both flows
 * simple to reason about independently.
 */
export function LogSaleSheet({ lead, open, onOpenChange, onLogged }: LogSaleSheetProps) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    setNote("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

  if (!lead) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lead || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("caller_log_sale", {
      p_lead_id: lead.id,
      p_note: note.trim() || null,
    });

    setSubmitting(false);
    inFlight.current = false;

    if (rpcError) {
      setError(
        rpcError.message.includes("not assigned to you")
          ? "This lead is no longer assigned to you. Refresh your queue."
          : rpcError.message.includes("already pending or approved")
            ? "A sale is already pending or approved for this lead."
            : "Could not log the sale. Please try again.",
      );
      return;
    }

    onOpenChange(false);
    onLogged();
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
              <SheetTitle className="truncate pr-8 text-xl tracking-tight">
                Log a sale
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {lead.full_name} · {lead.phone}
              </SheetDescription>
            </SheetHeader>
            <p className="mt-3 text-xs text-muted-foreground">
              Submits a ₹500 commission claim for admin review and sets this
              lead to Converted.
            </p>
          </motion.div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <motion.div variants={staggerItem} className="space-y-1.5">
              <Label
                htmlFor="sale_note"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Note (optional)
              </Label>
              <Textarea
                id="sale_note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Confirmed order over a call, payment via UPI…"
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
              <MotionButton
                type="submit"
                variant="emerald"
                size="lg"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Submit sale
                  </>
                )}
              </MotionButton>
            </motion.div>
          </form>
        </motion.div>
      </SheetContent>
    </Sheet>
  );
}

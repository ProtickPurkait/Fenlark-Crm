"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MotionButton } from "@/components/ui/motion-button";

export interface DuplicateMatch {
  existing_lead_id: string;
  existing_full_name: string;
  phone_normalized: string;
}

interface DuplicateChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matches: DuplicateMatch[];
  newCount: number;
  busy: boolean;
  onKeep: () => void;
  onReplace: () => void;
}

const PREVIEW_LIMIT = 5;

/**
 * Shared by both the CSV and manual-entry import flows in
 * lead-import-panel.tsx. Shown after admin_check_duplicate_phones finds one
 * or more phones in the about-to-be-imported batch already belonging to a
 * live lead — before admin_import_leads is ever called, not after.
 */
export function DuplicateChoiceDialog({
  open,
  onOpenChange,
  matches,
  newCount,
  busy,
  onKeep,
  onReplace,
}: DuplicateChoiceDialogProps) {
  const preview = matches.slice(0, PREVIEW_LIMIT);
  const remaining = matches.length - preview.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="responsive" className="flex w-full flex-col gap-5">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 pr-8 text-xl tracking-tight">
            <TriangleAlert className="h-5 w-5 shrink-0 text-[hsl(var(--neon-amber))]" />
            Duplicate{matches.length === 1 ? "" : "s"} found
          </SheetTitle>
          <SheetDescription>
            {matches.length} of {newCount} lead{newCount === 1 ? "" : "s"} you&rsquo;re
            about to add already {matches.length === 1 ? "exists" : "exist"} in the
            database, matched by phone number.
          </SheetDescription>
        </SheetHeader>

        <ul className="scrollbar-slim max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm">
          {preview.map((m) => (
            <li key={m.existing_lead_id} className="flex items-center justify-between gap-3">
              <span className="truncate">{m.existing_full_name}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {m.phone_normalized}
              </span>
            </li>
          ))}
          {remaining > 0 && (
            <li className="text-xs text-muted-foreground">…and {remaining} more</li>
          )}
        </ul>

        <div className="space-y-2">
          <MotionButton
            variant="destructive"
            className="w-full"
            disabled={busy}
            onClick={onReplace}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete duplicates &amp; add leads
          </MotionButton>
          <p className="text-xs text-muted-foreground">
            Removes the existing duplicate lead{matches.length === 1 ? "" : "s"} (or
            archives it if it has sale history) and adds the new one in its place.
          </p>

          <MotionButton variant="glass" className="w-full" disabled={busy} onClick={onKeep}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Keep duplicate{matches.length === 1 ? "" : "s"}
          </MotionButton>
          <p className="text-xs text-muted-foreground">
            Keeps the existing lead{matches.length === 1 ? "" : "s"} untouched and skips
            adding {matches.length === 1 ? "that one" : "those"}. Anything else in this
            batch still gets added.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

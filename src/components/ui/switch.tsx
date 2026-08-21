"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { springSnappy } from "@/lib/motion";

/**
 * Toggle switch. Hand-rolled rather than adding @radix-ui/react-switch — the
 * only behaviour Radix would add here is the same role/aria-checked pair
 * written below, and the knob needs to be a motion element anyway.
 *
 * The knob rides `layout` rather than a CSS transition on `left`, so it
 * springs on the same curve as the rest of the app.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  /** Accessible name, used when no visible <label> is wired up via `id`. */
  label?: string;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-[hsl(var(--neon-emerald)/0.45)] bg-[hsl(var(--neon-emerald)/0.22)]"
          : "border-border bg-muted",
        className,
      )}
    >
      {/* justify-* + layout gives the spring its start and end positions
          without hardcoding pixel offsets that would drift if the size changes. */}
      <span
        className={cn(
          "flex w-full px-0.5",
          checked ? "justify-end" : "justify-start",
        )}
      >
        <motion.span
          layout
          transition={springSnappy}
          className={cn(
            "block h-5 w-5 rounded-full",
            checked
              ? "bg-[hsl(var(--neon-emerald))]"
              : "bg-muted-foreground/70",
          )}
        />
      </span>
    </button>
  );
}

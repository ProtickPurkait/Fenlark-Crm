"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { springSnappy, tapScaleStrong } from "@/lib/motion";

// Separate from ui/button.tsx rather than replacing it: Button is used with
// `asChild` (Radix Slot) in places, and Slot + motion don't compose cleanly.
// This is the interactive variant for primary actions.
const motionButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-glow-soft hover:bg-primary/90 hover:shadow-glow-blue",
        glass:
          "border border-white/10 bg-white/5 text-foreground backdrop-blur-md hover:border-white/20 hover:bg-white/10",
        emerald:
          "border border-[hsl(var(--neon-emerald)/0.3)] bg-[hsl(var(--neon-emerald)/0.12)] text-[hsl(var(--neon-emerald))] hover:bg-[hsl(var(--neon-emerald)/0.2)] hover:shadow-glow-emerald",
        ghost: "text-muted-foreground hover:bg-white/5 hover:text-foreground",
        destructive:
          "border border-[hsl(var(--neon-rose)/0.3)] bg-[hsl(var(--neon-rose)/0.12)] text-[hsl(var(--neon-rose))] hover:bg-[hsl(var(--neon-rose)/0.2)]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type MotionButtonProps = Omit<
  React.ComponentProps<typeof motion.button>,
  "ref"
> &
  VariantProps<typeof motionButtonVariants>;

export const MotionButton = React.forwardRef<
  HTMLButtonElement,
  MotionButtonProps
>(({ className, variant, size, disabled, type = "button", ...props }, ref) => (
  <motion.button
    ref={ref}
    // Explicit default. A bare <button> inside a <form> defaults to
    // type="submit" — the Call Now and WhatsApp buttons sit just outside the
    // disposition form today, and moving either one inside would have silently
    // submitted it. Callers that want submission pass type="submit".
    type={type}
    disabled={disabled}
    // Guarded so a disabled button doesn't animate on press — that reads as
    // "it worked" when nothing happened.
    whileTap={disabled ? undefined : tapScaleStrong}
    whileHover={disabled ? undefined : { y: -1 }}
    transition={springSnappy}
    className={cn(motionButtonVariants({ variant, size }), className)}
    {...props}
  />
));
MotionButton.displayName = "MotionButton";

export { motionButtonVariants };

import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // h-11/text-base on mobile, h-10/text-sm from sm: up. Two reasons,
          // both mobile-specific: iOS Safari force-zooms the page on focus for
          // any input under 16px (text-base), and 44px is the minimum
          // comfortable touch target. Desktop keeps the tighter original.
          "flex h-11 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-base backdrop-blur-md transition-all sm:h-10 sm:text-sm",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "placeholder:text-muted-foreground/70 hover:border-white/20",
          "focus-visible:border-[hsl(var(--neon-blue)/0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };

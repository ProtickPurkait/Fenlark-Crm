import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        // text-base on mobile so iOS Safari doesn't force-zoom on focus — this
        // is the field a telecaller types into on every single call.
        "flex min-h-16 w-full rounded-lg border border-input bg-card px-3 py-2 text-base transition-colors sm:text-sm",
        "placeholder:text-muted-foreground/70 hover:border-foreground/20",
        "focus-visible:border-[hsl(var(--neon-blue)/0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };

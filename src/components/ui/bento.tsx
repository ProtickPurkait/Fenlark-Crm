"use client";

import * as React from "react";
import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerTile, springSoft } from "@/lib/motion";

/**
 * Bento grid. A 6-column base so tiles can claim halves and thirds cleanly;
 * everything collapses to a single column on mobile.
 */
export function BentoGrid({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      variants={staggerContainer(0.07)}
      initial="hidden"
      animate="show"
      className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6", className)}
    >
      {children}
    </motion.div>
  );
}

type Glow = "blue" | "emerald" | "violet" | "rose" | "none";

const GLOW_HSL: Record<Exclude<Glow, "none">, string> = {
  blue: "var(--neon-blue)",
  emerald: "var(--neon-emerald)",
  violet: "var(--neon-violet)",
  rose: "var(--neon-rose)",
};

interface BentoCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tailwind col-span classes, e.g. "lg:col-span-2". */
  span?: string;
  glow?: Glow;
  /** Render the cursor-tracking spotlight. Off for purely static tiles. */
  spotlight?: boolean;
}

/**
 * Glass tile with two separate light effects:
 *  1. A cursor-tracking radial "spotlight" that follows the pointer across the
 *     surface (the Aceternity signature). Implemented with motion values +
 *     useMotionTemplate so it updates without a React re-render per mousemove.
 *  2. A static neon edge glow on hover, keyed to the tile's accent colour.
 */
export function BentoCard({
  span,
  glow = "none",
  spotlight = true,
  className,
  children,
  ...props
}: BentoCardProps) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const accent = glow === "none" ? "var(--neon-blue)" : GLOW_HSL[glow];

  const spotlightBg = useMotionTemplate`radial-gradient(22rem circle at ${mouseX}px ${mouseY}px, hsl(${accent} / 0.12), transparent 70%)`;

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!spotlight) return;
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  }

  return (
    <motion.div
      variants={staggerTile}
      onMouseMove={handleMouseMove}
      whileHover={{ y: -3, transition: springSoft }}
      className={cn("group relative overflow-hidden rounded-2xl glass", span, className)}
      {...(props as React.ComponentProps<typeof motion.div>)}
    >
      {spotlight && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: spotlightBg }}
        />
      )}
      <div className="relative">{children}</div>
    </motion.div>
  );
}

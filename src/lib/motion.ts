import type { Variants, Transition } from "framer-motion";

// Shared motion vocabulary. Defined once so every surface animates on the same
// curve and cadence — the thing that separates "premium" from "animated".

/** Spring used for anything that should feel physical (cards, tiles, panels). */
export const springSoft: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 30,
  mass: 0.9,
};

/** Snappier spring for small, immediate feedback (taps, badges, icons). */
export const springSnappy: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 28,
  mass: 0.6,
};

/**
 * Parent of a staggered list. `delayChildren` lets the container's own
 * entrance land before children start, so the two don't compete.
 */
export const staggerContainer = (
  stagger = 0.06,
  delayChildren = 0.04,
): Variants => ({
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: stagger, delayChildren },
  },
});

/** Standard child entrance: rise + fade. Pairs with staggerContainer. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16, filter: "blur(4px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: springSoft,
  },
};

/** Slightly larger travel, for hero/bento tiles. */
export const staggerTile: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: springSoft,
  },
};

/** Universal press feedback. */
export const tapScale = { scale: 0.97 } as const;
export const tapScaleStrong = { scale: 0.95 } as const;

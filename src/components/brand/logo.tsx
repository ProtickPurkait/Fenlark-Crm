import { cn } from "@/lib/utils";

/**
 * The Fenlark "F" mark, redrawn as vector geometry.
 *
 * Inline SVG rather than an <img>/<Image> for three reasons: it stays crisp at
 * every size without shipping @2x rasters, it recolours from CSS custom
 * properties, and it needs no `img-src` allowance in the CSP.
 *
 * The mark is drawn on a 64 x 68 grid — deliberately taller than it is wide,
 * because the folded tail at the bottom of the stem descends past the letter's
 * baseline. Pair it with `items-center`; the optical centre sits slightly above
 * the geometric one.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 68"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      // Decorative by default: every lockup below pairs it with a text node,
      // so announcing it again would just make screen readers repeat the name.
      aria-hidden="true"
      focusable="false"
      className={cn("h-6 w-auto", className)}
    >
      {/* Stem + both arms + the angled tail, as one continuous outline. */}
      <path d="M0 0H64V16H16V30H50V44H16V68L0 58Z" fill="hsl(var(--brand))" />
      {/* Accent dot, right-aligned to the top bar and centred on the arm edge. */}
      <circle cx="57.8" cy="30.4" r="6.2" fill="hsl(var(--brand-dot))" />
    </svg>
  );
}

/**
 * Primary lockup: the Fenlark mark alongside the product name.
 *
 * The mark is sized in `em` so the whole lockup scales from whatever font size
 * the parent sets — bump the text and the mark follows, no second knob.
 */
export function Logo({
  className,
  markClassName,
  wordClassName,
}: {
  className?: string;
  markClassName?: string;
  wordClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={cn("h-[1.15em] w-auto", markClassName)} />
      <span className={cn("font-semibold tracking-tight", wordClassName)}>
        Trace
      </span>
    </span>
  );
}

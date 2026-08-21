/**
 * Plain CommonJS, not tailwind.config.ts. Next's webpack/postcss pipeline in
 * this project got permanently stuck serving a stale compiled CSS bundle
 * (identical byte count, no safelist canary, no content-scan classes) across
 * every combination of: rm -rf .next, full dev-server process restart, and
 * edits to the .ts config's content/safelist arrays. The most likely culprit
 * is Tailwind's jiti-based TS-config loader caching the transpiled config on
 * disk keyed by a path/mtime that this environment isn't invalidating
 * correctly. Plain .js sidesteps that loader entirely — no transpilation, no
 * cache layer, Node just requires the file directly.
 */
const path = require("path");

// Absolute AND forward-slash-normalized: path.join() on Windows returns
// backslash-separated segments, and fast-glob/micromatch (Tailwind's content
// scanner) treat backslash as a glob ESCAPE character, not a path separator.
const srcDir = path.join(__dirname, "src").replace(/\\/g, "/");

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  // Two entries, NOT one braced "*.{ts,tsx}" pattern. This project's own path
  // contains an apostrophe (this machine's Windows profile folder is named
  // "...\Protick's Laptop\..."), and fast-glob's brace-expansion silently
  // returns zero matches for an absolute pattern containing both an
  // apostrophe and a `{...}` group — confirmed directly against fast-glob:
  // "/**/*.tsx" alone matches 27 files, "/**/*.ts" alone matches 7, but
  // "/**/*.{ts,tsx}" together matches 0. No error, no warning — Tailwind
  // just silently compiled with zero content-scanned utilities, which is why
  // every page rendered as unstyled HTML while theme-level and plugin CSS
  // (which don't depend on content scanning) compiled fine. Splitting into
  // two ungrouped globs avoids brace expansion entirely.
  content: [`${srcDir}/**/*.ts`, `${srcDir}/**/*.tsx`],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        neon: {
          blue: "hsl(var(--neon-blue))",
          emerald: "hsl(var(--neon-emerald))",
          violet: "hsl(var(--neon-violet))",
          amber: "hsl(var(--neon-amber))",
          rose: "hsl(var(--neon-rose))",
          cyan: "hsl(var(--neon-cyan))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        // Neon glows for active/hovered elements. Layered (tight core + wide
        // falloff) so they read as emitted light rather than a flat outline.
        "glow-blue":
          "0 0 0 1px hsl(var(--neon-blue) / 0.35), 0 0 20px -2px hsl(var(--neon-blue) / 0.45), 0 0 48px -12px hsl(var(--neon-blue) / 0.6)",
        "glow-emerald":
          "0 0 0 1px hsl(var(--neon-emerald) / 0.35), 0 0 20px -2px hsl(var(--neon-emerald) / 0.45), 0 0 48px -12px hsl(var(--neon-emerald) / 0.6)",
        "glow-violet":
          "0 0 0 1px hsl(var(--neon-violet) / 0.35), 0 0 20px -2px hsl(var(--neon-violet) / 0.45), 0 0 48px -12px hsl(var(--neon-violet) / 0.6)",
        "glow-rose":
          "0 0 0 1px hsl(var(--neon-rose) / 0.35), 0 0 20px -2px hsl(var(--neon-rose) / 0.45), 0 0 48px -12px hsl(var(--neon-rose) / 0.6)",
        "glow-soft": "0 0 24px -6px hsl(var(--neon-blue) / 0.35)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { MotionButton } from "@/components/ui/motion-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { staggerContainer, staggerItem, springSoft } from "@/lib/motion";
import { Logo } from "@/components/brand/logo";

const ERROR_MESSAGES: Record<string, string> = {
  account_deactivated: "Your account has been deactivated. Contact an admin.",
  no_profile: "Your account is not fully set up. Contact an admin.",
};

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    ERROR_MESSAGES[searchParams.get("error") ?? ""] ?? null,
  );
  const [loading, setLoading] = useState(false);

  // The Supabase SDK is the single heaviest chunk this app ships (it bundles
  // auth-js, realtime-js, storage-js as one package) and login is the one
  // page every session pays for it cold. It isn't needed until submit, so it
  // stays out of the initial bundle — this just warms it in the background
  // right after mount, so it's already in the module cache by the time a
  // human finishes typing credentials and clicks Sign in.
  useEffect(() => {
    void import("@/lib/supabase/client");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // A hard navigation, not router.push(): the client router cache (see
    // staleTimes in next.config.ts) is keyed by URL alone, not by session, so
    // switching accounts within that window could serve the *previous*
    // account's cached /admin or /caller payload instead of asking the server
    // to re-evaluate this new session. A full page load bypasses that cache
    // entirely and lets middleware resolve the destination by this session's
    // actual role.
    window.location.assign(searchParams.get("next") ?? "/");
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={springSoft}
      className="glass-strong relative overflow-hidden rounded-2xl p-8"
    >
      {/* Soft neon wash across the top edge of the card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-48 w-64 -translate-x-1/2 rounded-full bg-[hsl(var(--neon-blue)/0.18)] blur-3xl"
      />

      <motion.div
        variants={staggerContainer(0.07, 0.15)}
        initial="hidden"
        animate="show"
        className="relative"
      >
        <motion.div variants={staggerItem} className="mb-6">
          <h1 className="text-2xl">
            <Logo />
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Lead &amp; telecaller pipeline
            <span className="mx-1.5 text-border">·</span>
            <span className="text-foreground/70">Fenlark Technologies</span>
          </p>
        </motion.div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <motion.div variants={staggerItem} className="space-y-1.5">
            <Label
              htmlFor="email"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </motion.div>

          <motion.div variants={staggerItem} className="space-y-1.5">
            <Label
              htmlFor="password"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </motion.div>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                role="alert"
                className="overflow-hidden rounded-lg border border-[hsl(var(--neon-rose)/0.3)] bg-[hsl(var(--neon-rose)/0.1)] px-3 py-2 text-sm text-[hsl(var(--neon-rose))]"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <motion.div variants={staggerItem}>
            <MotionButton
              type="submit"
              size="lg"
              className="w-full"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </MotionButton>
          </motion.div>
        </form>
      </motion.div>
    </motion.div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

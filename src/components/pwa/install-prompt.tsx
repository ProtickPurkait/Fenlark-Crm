"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Share, Plus, X, Download } from "lucide-react";
import { MotionButton } from "@/components/ui/motion-button";
import { LogoMark } from "@/components/brand/logo";
import { springSoft } from "@/lib/motion";

// Chrome fires this with a deferred prompt we can trigger later from a real
// user gesture. It is not in lib.dom yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "trace:install-dismissed";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own non-standard flag — it does not implement display-mode.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; the touch-point check separates it
    // from an actual desktop Safari.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Prompts the telecaller to install Trace to their home screen.
 *
 * Two entirely separate paths, because iOS does not implement
 * `beforeinstallprompt` and never has:
 *   - Chrome/Edge/Android: capture the deferred event, then show a real
 *     install button that calls prompt().
 *   - iOS Safari: no API exists, so the only option is to *explain* the
 *     Share → Add to Home Screen gesture.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true); // assume hidden until checked
  const installing = useRef(false);

  useEffect(() => {
    if (isStandalone()) return; // already installed — nothing to offer
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    setDismissed(false);

    if (isIos()) {
      setShowIosHint(true);
      return;
    }

    const onBeforeInstall = (e: Event) => {
      // Chrome shows its own mini-infobar unless the event is cancelled; we
      // want the prompt to appear as part of the app, not floating over it.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setShowIosHint(false);
      setDismissed(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function close() {
    // Remembered so the banner doesn't nag on every navigation. Clearing site
    // data resets it, which is the expected way to get it back.
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  async function install() {
    if (!deferred || installing.current) return;
    installing.current = true;
    await deferred.prompt();
    await deferred.userChoice;
    installing.current = false;
    // The prompt is single-use — Chrome will fire a fresh event if the user
    // declines and becomes eligible again, so just drop this one either way.
    setDeferred(null);
    setDismissed(true);
  }

  const visible = !dismissed && (Boolean(deferred) || showIosHint);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={springSoft}
          role="dialog"
          aria-label="Install Trace"
          // Sits above the mobile tab bar (3.5rem + safe area) rather than on
          // top of it; from sm: up the tab bar is hidden, so it drops back to
          // the bottom edge.
          className="fixed inset-x-3 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] z-50 mx-auto max-w-md sm:bottom-3"
        >
          <div className="glass-strong relative flex items-start gap-3 rounded-2xl p-4">
            <button
              type="button"
              onClick={close}
              aria-label="Dismiss"
              className="absolute right-2 top-2 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>

            <LogoMark className="mt-0.5 h-8 w-auto shrink-0" />

            <div className="min-w-0 flex-1 pr-6">
              <p className="text-sm font-medium tracking-tight">Install Trace</p>

              {showIosHint ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs leading-relaxed text-muted-foreground">
                  <span>Tap</span>
                  <Share className="inline h-3.5 w-3.5 text-[hsl(var(--neon-blue))]" />
                  <span>then</span>
                  <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-foreground/80">
                    <Plus className="h-3 w-3" />
                    Add to Home Screen
                  </span>
                </p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add it to your home screen — opens full screen, no browser
                    bars.
                  </p>
                  <MotionButton size="sm" className="mt-2.5" onClick={install}>
                    <Download className="h-3.5 w-3.5" />
                    Install
                  </MotionButton>
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

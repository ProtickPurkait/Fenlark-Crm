"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js. Rendered once from the root layout.
 *
 * Registration is deferred until after `load` so it never competes with the
 * first paint or the initial Supabase queries for bandwidth — the service
 * worker only matters from the *second* visit onward, so nothing is lost by
 * waiting a beat.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registering from the dev server would cache dev-mode asset URLs and
    // fight Fast Refresh; the worker is only useful in a real build anyway.
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration only costs offline caching and installability,
        // so it must never surface as an error to a telecaller mid-call.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

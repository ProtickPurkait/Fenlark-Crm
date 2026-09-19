"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CallTracker, isNativeCallTrackerAvailable } from "@/lib/native-call-tracker";

/**
 * Owns the lifecycle of one tracked phone call.
 *
 * The constraint this works around, on the plain web PWA: tapping a `tel:`
 * link hands control to the phone's native dialer, and a web page can see
 * nothing that happens there — not connection, not hangup, not duration. No
 * browser API exposes it.
 *
 * What the page *can* see is its own visibility. While the dialer is in front,
 * the page is hidden; when the call ends and the telecaller returns, it becomes
 * visible again. That backgrounded span is the duration estimate.
 *
 * It runs slightly long, because it includes ringing time and any seconds spent
 * in the dialer afterwards — which is why the drawer shows the number as an
 * editable field rather than saving it silently.
 *
 * Inside the native Android shell (see native-call-tracker.ts), none of the
 * above applies: CallTrackerPlugin reports the OS's own call state, so this
 * hook uses that instead — an authoritative, telecaller-proof duration
 * (duration_source = 'device') — and disables the visibility-based estimate
 * entirely rather than let the two race to close the same session. If the
 * permission it needs is denied, or the plugin fails to start for any reason,
 * this falls back to the web behaviour above rather than leaving the call
 * untracked.
 */

export interface ActiveCall {
  sessionId: string;
  leadId: string;
  startedAt: number;
}

/** Total ms the page has spent hidden since a call started. */
function useHiddenTimeTracker() {
  const hiddenSinceRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);

  const reset = useCallback(() => {
    hiddenSinceRef.current = null;
    accumulatedRef.current = 0;
  }, []);

  /** Call when a session starts, so an already-hidden page is handled. */
  const begin = useCallback(() => {
    accumulatedRef.current = 0;
    hiddenSinceRef.current = document.hidden ? Date.now() : null;
  }, []);

  const onVisibilityChange = useCallback(() => {
    if (document.hidden) {
      // Guard against duplicate hidden events — only the first starts the clock.
      if (hiddenSinceRef.current === null) hiddenSinceRef.current = Date.now();
    } else if (hiddenSinceRef.current !== null) {
      accumulatedRef.current += Date.now() - hiddenSinceRef.current;
      hiddenSinceRef.current = null;
    }
  }, []);

  /** Elapsed hidden time including any span still open. */
  const read = useCallback(() => {
    const open = hiddenSinceRef.current === null ? 0 : Date.now() - hiddenSinceRef.current;
    return accumulatedRef.current + open;
  }, []);

  // Memoized: every field is already a stable useCallback, but a fresh
  // object literal on every render would still give endCall (and anything
  // depending on it) a new identity each time. During an active call, the
  // elapsed-time timer re-renders this hook every second — a churning
  // `hidden` reference would tear down and rebuild the native call-state
  // listener on the same cadence, risking a callEnded event landing in the
  // gap between removing the old listener and attaching the new one.
  return useMemo(
    () => ({ begin, reset, onVisibilityChange, read }),
    [begin, reset, onVisibilityChange, read],
  );
}

export function useCallSession({
  onCallEnded,
}: {
  /**
   * Fires when a call finishes. `sessionId` is included so the caller can
   * apply a manual correction later (see correctDuration) — but only when
   * `source` is `"app_estimate"`. A `"device"` duration is OS-measured and
   * end_call_session() will silently ignore a manual correction attempt
   * against it, so the UI should not offer one.
   */
  onCallEnded?: (info: {
    sessionId: string;
    leadId: string;
    durationSeconds: number;
    source: "app_estimate" | "device";
  }) => void;
} = {}) {
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Synchronous latches: state updates are async, and both a tap and a
  // visibilitychange can land in the same tick.
  const startingRef = useRef(false);
  const endingRef = useRef(false);
  const activeRef = useRef<ActiveCall | null>(null);

  const hidden = useHiddenTimeTracker();

  // Read by endCall via a ref, not as a useCallback dependency: the drawer
  // passes an inline onCallEnded that is a new closure every render, and
  // depending on it directly would give endCall a new identity on every one
  // of those renders too — reintroducing the same listener-churn risk the
  // memoized `hidden` above exists to avoid.
  const onCallEndedRef = useRef(onCallEnded);
  useEffect(() => {
    onCallEndedRef.current = onCallEnded;
  }, [onCallEnded]);

  // True once CallTrackerPlugin has permission and is actively listening.
  // Read by both the visibilitychange handler (to stand down so the two
  // paths never race to close the same session) and startCall (to decide
  // whether this call even needs the hidden-time tracker running at all).
  const nativeReadyRef = useRef(false);

  // Kept in a ref so the visibilitychange listener (registered once) always
  // sees the current session without being torn down and rebuilt per call.
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const endCall = useCallback(
    async (opts?: { auto?: boolean; native?: { durationSeconds: number } }) => {
      const current = activeRef.current;
      if (!current || endingRef.current) return;
      endingRef.current = true;

      let durationSeconds: number;
      let source: "app_estimate" | "device";
      if (opts?.native) {
        // CallTrackerPlugin already measured this from the OS's own call
        // state (offhook -> idle) — authoritative, and not something the
        // hidden-time estimate below could improve on.
        durationSeconds = Math.max(0, Math.round(opts.native.durationSeconds));
        source = "device";
      } else {
        // Prefer the backgrounded span; fall back to wall clock if the page
        // was never hidden (desktop, or the dialer never took focus).
        const hiddenMs = hidden.read();
        const wallMs = Date.now() - current.startedAt;
        durationSeconds = Math.max(0, Math.round((hiddenMs > 0 ? hiddenMs : wallMs) / 1000));
        source = "app_estimate";
      }

      setActive(null);
      activeRef.current = null;
      hidden.reset();

      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("end_call_session", {
        p_session_id: current.sessionId,
        p_duration_seconds: durationSeconds,
        p_source: source,
      });

      endingRef.current = false;

      if (rpcError) {
        // Non-fatal by design: the sweep will close the row server-side, and
        // a telecaller mid-shift should never see a failure for bookkeeping.
        setError(null);
      }

      onCallEndedRef.current?.({
        sessionId: current.sessionId,
        leadId: current.leadId,
        durationSeconds,
        source,
      });
      void opts;
    },
    [hidden],
  );

  /**
   * Overwrites a finished session's duration with a telecaller-corrected value.
   * Separate from endCall because the normal end path must stay idempotent —
   * `p_source: "manual"` is what tells the RPC this is a deliberate edit
   * rather than a duplicate end event.
   */
  const correctDuration = useCallback(
    async (sessionId: string, durationSeconds: number) => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      await supabase.rpc("end_call_session", {
        p_session_id: sessionId,
        p_duration_seconds: Math.max(0, Math.round(durationSeconds)),
        p_source: "manual",
      });
    },
    [],
  );

  const startCall = useCallback(
    async (leadId: string, phone: string) => {
      if (startingRef.current || activeRef.current) return;
      startingRef.current = true;
      setError(null);

      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("start_call_session", {
        p_lead_id: leadId,
      });

      startingRef.current = false;

      if (rpcError || !data) {
        setError("Could not start call tracking. The call will still connect.");
      } else {
        const session: ActiveCall = {
          sessionId: data.id,
          leadId,
          startedAt: new Date(data.started_at).getTime(),
        };
        setActive(session);
        activeRef.current = session;
        setElapsed(0);
        hidden.begin();
      }

      // The dialer opens regardless of whether tracking succeeded — failing to
      // record a call must never stop the telecaller from making it.
      window.location.href = `tel:${phone}`;
    },
    [hidden],
  );

  // Live timer for the on-screen chip.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - active.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  // Single listener for the whole hook's lifetime.
  useEffect(() => {
    const handler = () => {
      hidden.onVisibilityChange();
      if (document.hidden || !activeRef.current) return;

      if (!nativeReadyRef.current) {
        // Web PWA: returning to the app is the only signal that the call is
        // over at all.
        void endCall({ auto: true });
        return;
      }

      // Native shell: CallTracker's callEnded event is what normally closes
      // this session (see below), and fires close to instantly once Android
      // reports the call as idle. This is a backstop, not the primary path —
      // if the telecaller is back in the app and the session is *still* open
      // a few seconds later, something kept the plugin from reporting (a
      // device quirk I have no way to test for), and leaving the call open
      // until the 120-minute sweep would be worse than falling back to the
      // same estimate the web-only path already relies on. Not cancelled
      // explicitly if callEnded wins the race first — endCall's own
      // activeRef guard is what makes this a no-op in that case.
      setTimeout(() => {
        if (activeRef.current) void endCall({ auto: true });
      }, 5000);
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [hidden, endCall]);

  // Native call-state tracking. A no-op on the web PWA (isNativeCallTrackerAvailable
  // is false there), and permission denial or any plugin failure just leaves
  // nativeReadyRef false — the visibilitychange path above keeps working
  // exactly as it does today, so this can never leave a call untracked.
  useEffect(() => {
    if (!isNativeCallTrackerAvailable()) return;

    let cancelled = false;
    let listenerHandle: { remove: () => Promise<void> } | null = null;

    (async () => {
      try {
        const perm = await CallTracker.requestCallStatePermission();
        if (perm.phoneState !== "granted") return;

        listenerHandle = await CallTracker.addListener("callEnded", (event) => {
          if (activeRef.current) {
            void endCall({ native: { durationSeconds: event.durationSeconds } });
          }
        });

        await CallTracker.startListening();
        if (!cancelled) nativeReadyRef.current = true;
      } catch {
        // Leave nativeReadyRef false; the web fallback covers this device.
        nativeReadyRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      nativeReadyRef.current = false;
      void listenerHandle?.remove();
    };
  }, [endCall]);

  return { active, elapsed, error, startCall, endCall, correctDuration };
}

/** mm:ss for a live timer; adds hours only when the call actually runs that long. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Compact human form for reports — "4m 12s", "45s", "1h 3m". */
export function formatDurationLabel(totalSeconds: number | null): string {
  if (totalSeconds === null) return "—";
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

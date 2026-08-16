"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, TriangleAlert, X } from "lucide-react";
import type { createClient } from "@/lib/supabase/client";
import { springSoft } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface RejectionRow {
  id: string;
  lead_id: string;
  lead_name: string;
  rejection_reason: string | null;
  reviewed_at: string | null;
}

/**
 * Rejection notifications for a telecaller's own sales, live via Supabase
 * Realtime — same "refetch on event" pattern as admin/live-calls-panel.tsx,
 * and no `filter` needed on the channel: RLS already scopes delivery to this
 * caller's own rows, the same way it scopes call_sessions.
 *
 * Deliberately self-contained with no server-fetched initial props: this
 * mounts in the shared dashboard layout (visible on every page), and that
 * layout intentionally avoids extra per-navigation Supabase round trips (see
 * requireUserId's header fast-path). A brief empty badge on first mount is a
 * better trade than reintroducing that cost on every navigation.
 */
export function RejectionBell() {
  const [rejections, setRejections] = useState<RejectionRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const { createClient: getClient } = await import("@/lib/supabase/client");
    const supabase = getClient();
    const { data: sales } = await supabase
      .from("sales")
      .select("id, lead_id, rejection_reason, reviewed_at")
      .eq("status", "rejected")
      .is("acknowledged_at", null)
      .order("reviewed_at", { ascending: false });

    const leadIds = [...new Set((sales ?? []).map((s) => s.lead_id))];
    const { data: leads } = leadIds.length
      ? await supabase.from("leads").select("id, full_name").in("id", leadIds)
      : { data: [] as { id: string; full_name: string }[] };
    const leadMap = Object.fromEntries((leads ?? []).map((l) => [l.id, l.full_name]));

    setRejections(
      (sales ?? []).map((s) => ({ ...s, lead_name: leadMap[s.lead_id] ?? "Unknown lead" })),
    );
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    // Same cancellation-safe pattern as live-calls-panel.tsx: guards against
    // unmounting before the dynamic import resolves.
    let cancelled = false;
    let client: ReturnType<typeof createClient> | null = null;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;

    void (async () => {
      const { createClient: getClient } = await import("@/lib/supabase/client");
      if (cancelled) return;
      client = getClient();
      channel = client
        .channel("my-sales-rejections")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "sales" },
          () => void refetch(),
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (client && channel) void client.removeChannel(channel);
    };
  }, [refetch]);

  async function dismiss(saleId: string) {
    setBusyId(saleId);
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    await supabase.rpc("caller_acknowledge_sale", { p_sale_id: saleId });
    setBusyId(null);
    setRejections((prev) => prev.filter((r) => r.id !== saleId));
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Rejection notifications"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {rejections.length > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--neon-rose))] px-1 text-[10px] font-semibold text-white">
            {rejections.length}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={springSoft}
              className="glass-strong absolute right-0 z-50 mt-2 max-h-80 w-72 overflow-auto rounded-xl p-2 scrollbar-slim sm:w-80"
            >
              {rejections.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  No rejected sales to review.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {rejections.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-lg border border-[hsl(var(--neon-rose)/0.25)] bg-[hsl(var(--neon-rose)/0.07)] p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--neon-rose))]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{r.lead_name}</p>
                          {r.rejection_reason && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {r.rejection_reason}
                            </p>
                          )}
                          {r.reviewed_at && (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {new Date(r.reviewed_at).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => dismiss(r.id)}
                          disabled={busyId === r.id}
                          className={cn(
                            "shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
                            busyId === r.id && "opacity-50",
                          )}
                          aria-label="Dismiss"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

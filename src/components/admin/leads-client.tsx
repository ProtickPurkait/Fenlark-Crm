"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  Shuffle,
  TriangleAlert,
  UserCheck,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { MotionButton } from "@/components/ui/motion-button";
import { Input } from "@/components/ui/input";
import { LeadStatusBadge } from "@/components/shared/lead-status-badge";
import { LeadImportPanel } from "@/components/admin/lead-import-panel";
import { LEAD_STATUS_ORDER, type LeadStatus } from "@/lib/pipeline";
import { springSoft, staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface AdminLeadRow {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  city: string | null;
  company: string | null;
  status: LeadStatus;
  assigned_to: string | null;
  scheduled_at: string | null;
  last_remark: string | null;
  sla_revoked_count: number;
  created_at: string;
  assignee_name: string | null;
}

interface Telecaller {
  id: string;
  full_name: string;
}

export function LeadsClient({
  initialRows,
  totalCount,
  page,
  pageSize,
  filters,
  telecallers,
}: {
  initialRows: AdminLeadRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  filters: { status: string; assignment: string; q: string };
  telecallers: Telecaller[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // No local copy of the rows: the server (via router.refresh() below) is the
  // only writer of lead data, so rendering initialRows directly guarantees
  // the table can never show stale assignee/status text after a mutation.
  // An earlier version kept a local `rows` state synced by comparing row IDs,
  // which missed exactly that case — a same-page reassignment changes
  // `assignee_name` on existing ids, not the id set, so the id-keyed sync
  // never fired and the column kept showing "Unassigned" after a successful
  // assign.
  const rows = initialRows;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [searchInput, setSearchInput] = useState(filters.q);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function pushParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    // Any filter change invalidates the current page number.
    if (!("page" in next)) params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function runBulk(fn: () => Promise<string | null>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);

    const message = await fn();

    busyRef.current = false;
    setBusy(false);
    if (message?.startsWith("!")) setError(message.slice(1));
    else if (message) setNotice(message);

    setSelected(new Set());
    router.refresh();
  }

  function assignTo(userId: string | null) {
    const ids = [...selected];
    return runBulk(async () => {
      const supabase = createClient();
      const { error: rpcError, data: count } = await supabase.rpc("admin_assign_leads", {
        p_lead_ids: ids,
        p_user_id: userId,
      });
      if (rpcError) return `!Could not assign: ${rpcError.message}`;
      return userId
        ? `Assigned ${count ?? ids.length} lead${ids.length === 1 ? "" : "s"}.`
        : `Unassigned ${count ?? ids.length} lead${ids.length === 1 ? "" : "s"}.`;
    });
  }

  function roundRobin() {
    const ids = [...selected];
    return runBulk(async () => {
      if (telecallers.length === 0) {
        return "!No active telecallers to distribute to.";
      }
      const supabase = createClient();
      const { error: rpcError, data } = await supabase.rpc("admin_round_robin_assign", {
        p_lead_ids: ids,
        p_user_ids: telecallers.map((t) => t.id),
      });
      if (rpcError) return `!Could not distribute: ${rpcError.message}`;
      const summary = (data ?? [])
        .filter((d) => d.assigned_count > 0)
        .map((d) => `${d.full_name} +${d.assigned_count}`)
        .join(", ");
      return `Distributed ${ids.length} lead${ids.length === 1 ? "" : "s"} — ${summary}.`;
    });
  }

  function archiveSelected() {
    const ids = [...selected];
    return runBulk(async () => {
      const supabase = createClient();
      // No bulk archive RPC exists — admin_archive_lead takes one id, so this
      // fans out. Sequential rather than Promise.all: each call is a real
      // write (soft-delete + audit log), and running dozens concurrently
      // against a free-tier Postgres connection pool is worse than a short
      // wait here.
      let failed = 0;
      for (const id of ids) {
        const { error: rpcError } = await supabase.rpc("admin_archive_lead", {
          p_lead_id: id,
          p_reason: "Archived from Leads screen",
        });
        if (rpcError) failed++;
      }
      if (failed > 0) {
        return `!Archived ${ids.length - failed} of ${ids.length}; ${failed} failed.`;
      }
      return `Archived ${ids.length} lead${ids.length === 1 ? "" : "s"}.`;
    });
  }

  return (
    <motion.div
      variants={staggerContainer(0.06)}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      <motion.div
        variants={staggerItem}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalCount.toLocaleString()} lead{totalCount === 1 ? "" : "s"} in
            the pipeline.
          </p>
        </div>
        <MotionButton onClick={() => setShowImport((v) => !v)}>
          <Plus className="h-4 w-4" />
          Add leads
        </MotionButton>
      </motion.div>

      <AnimatePresence>
        {showImport && (
          <LeadImportPanel
            onClose={() => setShowImport(false)}
            onImported={() => router.refresh()}
          />
        )}
      </AnimatePresence>

      {/* Filters */}
      <motion.div variants={staggerItem} className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pushParams({ q: searchInput || null });
          }}
          className="relative"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or phone…"
            className="h-9 w-56 pl-8 text-sm"
          />
        </form>

        <FilterChip
          active={filters.status === "all"}
          onClick={() => pushParams({ status: null })}
        >
          All statuses
        </FilterChip>
        {LEAD_STATUS_ORDER.map((s) => (
          <FilterChip
            key={s}
            active={filters.status === s}
            onClick={() => pushParams({ status: s })}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </FilterChip>
        ))}

        <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />

        <FilterChip
          active={filters.assignment === "all"}
          onClick={() => pushParams({ assignment: null })}
        >
          Any assignment
        </FilterChip>
        <FilterChip
          active={filters.assignment === "unassigned"}
          onClick={() => pushParams({ assignment: "unassigned" })}
        >
          Unassigned
        </FilterChip>
        <FilterChip
          active={filters.assignment === "assigned"}
          onClick={() => pushParams({ assignment: "assigned" })}
        >
          Assigned
        </FilterChip>
      </motion.div>

      {/* Bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={springSoft}
            className="glass flex flex-wrap items-center gap-2 overflow-hidden rounded-xl px-4 py-3"
          >
            <span className="text-sm font-medium">
              {selected.size} selected
            </span>
            <div className="mx-1 h-4 w-px bg-white/10" aria-hidden />

            <AssignMenu telecallers={telecallers} onAssign={assignTo} disabled={busy} />

            <MotionButton
              variant="glass"
              size="sm"
              onClick={roundRobin}
              disabled={busy || telecallers.length === 0}
            >
              <Shuffle className="h-3.5 w-3.5" />
              Round-robin
            </MotionButton>

            <MotionButton
              variant="glass"
              size="sm"
              onClick={() => assignTo(null)}
              disabled={busy}
            >
              <UserCheck className="h-3.5 w-3.5" />
              Unassign
            </MotionButton>

            <MotionButton
              variant="destructive"
              size="sm"
              onClick={archiveSelected}
              disabled={busy}
            >
              <Archive className="h-3.5 w-3.5" />
              Archive
            </MotionButton>

            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}

            <MotionButton
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setSelected(new Set())}
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </MotionButton>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-2 rounded-lg border border-[hsl(var(--neon-rose)/0.3)] bg-[hsl(var(--neon-rose)/0.1)] p-3 text-sm text-[hsl(var(--neon-rose))]"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </motion.p>
        )}
        {notice && !error && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-lg border border-[hsl(var(--neon-emerald)/0.3)] bg-[hsl(var(--neon-emerald)/0.1)] p-3 text-sm text-[hsl(var(--neon-emerald))]"
          >
            {notice}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Phone layout: one card per lead. A 62rem-wide table on a 375px screen
          means every row has to be scrolled sideways to read, which makes
          scanning the pipeline on a phone effectively impossible. Same data,
          stacked. The table below takes over from lg: up. */}
      <motion.div variants={staggerItem} className="space-y-2 lg:hidden">
        {rows.map((lead) => (
          <div
            key={lead.id}
            onClick={() => toggleRow(lead.id)}
            className={cn(
              "glass rounded-xl p-3.5 transition-colors",
              selected.has(lead.id) && "bg-[hsl(var(--neon-blue)/0.08)]",
            )}
          >
            <div className="flex items-start gap-3">
              <div className="pt-0.5">
                <Checkbox
                  checked={selected.has(lead.id)}
                  onChange={() => toggleRow(lead.id)}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium tracking-tight">{lead.full_name}</span>
                  <LeadStatusBadge status={lead.status} />
                </div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {lead.phone}
                  {lead.city ? ` · ${lead.city}` : ""}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {lead.assignee_name ?? (
                      <span className="text-[hsl(var(--neon-amber))]">Unassigned</span>
                    )}
                  </span>
                  {lead.scheduled_at && (
                    <span>{new Date(lead.scheduled_at).toLocaleString()}</span>
                  )}
                  {lead.sla_revoked_count > 0 && (
                    <span className="text-[hsl(var(--neon-amber))]">
                      Recycled {lead.sla_revoked_count}×
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}

        {rows.length === 0 && (
          <div className="glass rounded-2xl px-6 py-16 text-center text-sm text-muted-foreground">
            No leads match these filters.
          </div>
        )}
      </motion.div>

      {/* Table — laptop and up */}
      <motion.div
        variants={staggerItem}
        className="glass hidden overflow-hidden rounded-2xl lg:block"
      >
        <div className="overflow-x-auto scrollbar-slim">
          <table className="w-full min-w-[62rem] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="w-10 px-4 py-3">
                  <Checkbox checked={allSelected} onChange={toggleAll} />
                </th>
                <th className="px-2 py-3 font-medium">Lead</th>
                <th className="px-2 py-3 font-medium">Status</th>
                <th className="px-2 py-3 font-medium">Assigned to</th>
                <th className="px-2 py-3 font-medium">Follow-up</th>
                <th className="px-2 py-3 font-medium">Added</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => (
                <tr
                  key={lead.id}
                  className={cn(
                    "border-b border-white/5 transition-colors last:border-0 hover:bg-white/[0.03]",
                    selected.has(lead.id) && "bg-[hsl(var(--neon-blue)/0.06)]",
                  )}
                >
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={selected.has(lead.id)}
                      onChange={() => toggleRow(lead.id)}
                    />
                  </td>
                  <td className="px-2 py-3">
                    <div className="font-medium tracking-tight">{lead.full_name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {lead.phone}
                      {lead.city ? ` · ${lead.city}` : ""}
                    </div>
                    {lead.sla_revoked_count > 0 && (
                      <div className="mt-0.5 text-[10px] text-[hsl(var(--neon-amber))]">
                        Recycled {lead.sla_revoked_count}×
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <LeadStatusBadge status={lead.status} />
                  </td>
                  <td className="px-2 py-3">
                    {lead.assignee_name ?? (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-xs text-muted-foreground">
                    {lead.scheduled_at
                      ? new Date(lead.scheduled_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-2 py-3 text-xs text-muted-foreground">
                    {new Date(lead.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">
            No leads match these filters.
          </p>
        )}
      </motion.div>

      {/* Pagination */}
      {totalPages > 1 && (
        <motion.div
          variants={staggerItem}
          className="flex items-center justify-between text-xs text-muted-foreground"
        >
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <MotionButton
              variant="glass"
              size="sm"
              disabled={page <= 1}
              onClick={() => pushParams({ page: String(page - 1) })}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </MotionButton>
            <MotionButton
              variant="glass"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => pushParams({ page: String(page + 1) })}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </MotionButton>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors",
        active
          ? "bg-[hsl(var(--neon-blue)/0.16)] text-[hsl(var(--neon-blue))] ring-[hsl(var(--neon-blue)/0.4)]"
          : "text-muted-foreground ring-white/10 hover:bg-white/5 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        "flex h-4 w-4 items-center justify-center rounded border transition-colors",
        checked
          ? "border-[hsl(var(--neon-blue))] bg-[hsl(var(--neon-blue))]"
          : "border-white/20 hover:border-white/40",
      )}
    >
      {checked && (
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 fill-none stroke-[hsl(var(--background))] stroke-[2.5]">
          <path d="M2 6l2.5 2.5L10 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

function AssignMenu({
  telecallers,
  onAssign,
  disabled,
}: {
  telecallers: Telecaller[];
  onAssign: (userId: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => telecallers, [telecallers]);

  return (
    <div className="relative">
      <MotionButton
        variant="glass"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || options.length === 0}
      >
        <UserCheck className="h-3.5 w-3.5" />
        Assign to…
      </MotionButton>
      <AnimatePresence>
        {open && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={springSoft}
              className="glass-strong absolute left-0 top-full z-50 mt-1.5 max-h-64 w-52 overflow-auto rounded-xl p-1 scrollbar-slim"
            >
              {options.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onAssign(t.id);
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10"
                >
                  {t.full_name}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

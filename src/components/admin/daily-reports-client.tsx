"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ClipboardList, TrendingUp, Users } from "lucide-react";
import { BentoGrid, BentoCard } from "@/components/ui/bento";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface TelecallerReportRow {
  telecaller_id: string;
  full_name: string;
  submitted: boolean;
  warm_leads_count: number;
  converted_count: number;
  schedules_count: number;
  appointments_count: number;
  notes: string | null;
  updated_at: string | null;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function DailyReportsClient({
  rows,
  date,
  today,
}: {
  rows: TelecallerReportRow[];
  date: string;
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function goToDate(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === today) params.delete("date");
    else params.set("date", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  const submittedRows = rows.filter((r) => r.submitted);
  const totals = submittedRows.reduce(
    (acc, r) => ({
      warm: acc.warm + r.warm_leads_count,
      converted: acc.converted + r.converted_count,
      schedules: acc.schedules + r.schedules_count,
      appointments: acc.appointments + r.appointments_count,
    }),
    { warm: 0, converted: 0, schedules: 0, appointments: 0 },
  );

  return (
    <motion.div variants={staggerContainer(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={staggerItem} className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">Daily roll-up submitted by each telecaller.</p>
        </div>

        <div className="glass flex items-center gap-1 rounded-lg p-1">
          <button
            type="button"
            onClick={() => goToDate(shiftDate(date, -1))}
            aria-label="Previous day"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && goToDate(e.target.value)}
            className="bg-transparent px-1 text-sm tabular-nums outline-none"
          />
          <button
            type="button"
            onClick={() => goToDate(shiftDate(date, 1))}
            disabled={date >= today}
            aria-label="Next day"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </motion.div>

      <BentoGrid>
        <SummaryTile label="Warm Leads" value={totals.warm} glow="blue" />
        <SummaryTile label="Converted" value={totals.converted} glow="emerald" />
        <SummaryTile label="Schedules" value={totals.schedules} glow="violet" />
        <SummaryTile label="Appointments" value={totals.appointments} glow="rose" icon={<ClipboardList className="h-4 w-4" />} />
        <BentoCard span="lg:col-span-2" glow="none" spotlight={false} className="flex flex-col justify-center p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Submitted</p>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
            {submittedRows.length}
            <span className="text-lg text-muted-foreground">/{rows.length}</span>
          </p>
        </BentoCard>
      </BentoGrid>

      <motion.div variants={staggerItem} className="glass overflow-hidden rounded-2xl">
        {/* Horizontal scroll rather than a stacked mobile card layout — this
            screen is an admin end-of-day review, not something worked from a
            phone mid-shift like the caller queue is. */}
        <div className="overflow-x-auto scrollbar-slim">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Telecaller</th>
                <th className="px-2 py-3 font-medium">Warm</th>
                <th className="px-2 py-3 font-medium">Converted</th>
                <th className="px-2 py-3 font-medium">Schedules</th>
                <th className="px-2 py-3 font-medium">Appointments</th>
                <th className="px-2 py-3 font-medium">Notes</th>
                <th className="px-2 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.telecaller_id}
                  className={cn(
                    "border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]",
                    !row.submitted && "opacity-50",
                  )}
                >
                  <td className="px-4 py-3 font-medium tracking-tight">{row.full_name}</td>
                  {row.submitted ? (
                    <>
                      <td className="px-2 py-3 tabular-nums">{row.warm_leads_count}</td>
                      <td className="px-2 py-3 tabular-nums">{row.converted_count}</td>
                      <td className="px-2 py-3 tabular-nums">{row.schedules_count}</td>
                      <td className="px-2 py-3 tabular-nums">{row.appointments_count}</td>
                      <td className="max-w-[16rem] truncate px-2 py-3 text-xs text-muted-foreground">
                        {row.notes ?? "—"}
                      </td>
                      <td className="px-2 py-3 text-xs text-muted-foreground">
                        {row.updated_at
                          ? new Date(row.updated_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                    </>
                  ) : (
                    <td colSpan={6} className="px-2 py-3 text-xs text-muted-foreground">
                      Not submitted
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">
            No telecallers to report on.
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}

function SummaryTile({
  label,
  value,
  glow,
  icon,
}: {
  label: string;
  value: number;
  glow: "blue" | "emerald" | "violet" | "rose";
  icon?: React.ReactNode;
}) {
  return (
    <BentoCard span="lg:col-span-1" glow={glow} className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <span className="text-muted-foreground">{icon ?? <TrendingUp className="h-4 w-4" />}</span>
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
    </BentoCard>
  );
}

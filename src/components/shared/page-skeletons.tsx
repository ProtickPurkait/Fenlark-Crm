import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeletons for the admin routes.
 *
 * These exist so every navigation gets *immediate* visual feedback. Without a
 * `loading.tsx` at a route, Next.js has no Suspense boundary to show while the
 * server component fetches, so clicking a nav link does nothing visible until
 * the whole page is ready — which reads as a frozen UI even when the wait is
 * only a few hundred milliseconds.
 *
 * Each skeleton mirrors the real page's layout so the content lands in roughly
 * the same place it was sketched, instead of the page jumping on arrival.
 */

function PageHeaderSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton className={wide ? "h-8 w-56" : "h-8 w-40"} />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

/** Rows of a data table — used by the Leads and Telecallers screens. */
function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="space-y-0 divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="hidden h-4 w-16 lg:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function LeadsPageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading leads">
      <PageHeaderSkeleton />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
      <TableSkeleton rows={6} />
    </div>
  );
}

export function TelecallersPageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading telecallers">
      <PageHeaderSkeleton />
      <Skeleton className="h-10 w-44 rounded-lg" />
      <TableSkeleton rows={4} />
    </div>
  );
}

export function SettingsPageSkeleton() {
  return (
    <div className="max-w-3xl space-y-4" aria-busy="true" aria-label="Loading settings">
      <PageHeaderSkeleton wide />
      <div className="glass space-y-5 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-6 w-11 rounded-full" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      </div>
      <div className="glass space-y-4 rounded-2xl p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function HistoryPageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading history">
      <Skeleton className="h-7 w-32" />
      <div className="glass space-y-4 rounded-2xl p-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-l-2 border-border pl-3">
            <div className="flex items-baseline justify-between gap-2">
              <Skeleton className="h-3.5 w-44" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

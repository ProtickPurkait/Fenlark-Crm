import { Skeleton, StatTileSkeleton } from "@/components/ui/skeleton";

// Streamed while the dashboard's queries resolve. Mirrors the bento layout so
// the page doesn't reflow when real data lands.
export default function AdminDashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <StatTileSkeleton />
        </div>
        <div className="lg:col-span-2">
          <StatTileSkeleton />
        </div>
        <div className="lg:col-span-2">
          <StatTileSkeleton />
        </div>

        <div className="glass rounded-2xl p-6 sm:col-span-2 lg:col-span-4">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-2 h-3 w-48" />
          <div className="mt-6 flex items-center gap-8">
            <Skeleton className="h-36 w-36 rounded-full" />
            <div className="flex-1 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-full" />
              ))}
            </div>
          </div>
        </div>

        <div className="glass rounded-2xl p-6 lg:col-span-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-10 w-28" />
          <Skeleton className="mt-2 h-3 w-40" />
          <div className="mt-6 border-t border-white/10 pt-4">
            <Skeleton className="h-3 w-full" />
          </div>
        </div>

        <div className="glass rounded-2xl p-6 sm:col-span-2 lg:col-span-6">
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

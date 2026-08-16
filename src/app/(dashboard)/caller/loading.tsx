import { LeadCardSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function CallerQueueLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading your queue">
      <Skeleton className="h-7 w-32" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass rounded-xl p-4">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="mt-2 h-7 w-10" />
          </div>
        ))}
      </div>

      <div className="space-y-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <LeadCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

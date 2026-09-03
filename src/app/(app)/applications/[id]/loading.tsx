import { Skeleton } from '@/components/ui/skeleton';

/**
 * The LOADING state for `/applications/[id]` (SPEC Block E: "full-screen
 * skeleton (rail + tabs)").
 *
 * Its own file for the same structural reason as the other two: the page awaits
 * the application and its vacancy, and an awaited Server Component renders
 * nothing until they resolve.
 */
export default function ApplicationDetailLoading() {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-6">
          <Skeleton className="size-32 self-center rounded-full" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-2 w-full" />
              </div>
            ))}
          </div>
          <Skeleton className="h-28 w-full" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </section>
  );
}

import { Skeleton } from '@/components/ui/skeleton';

/**
 * The LOADING state for `/applications` (SPEC Block E: "8 skeleton rows").
 *
 * Its own file, like `/career`'s: the page awaits its rows, and an awaited
 * Server Component renders nothing until they resolve, so a `loading === true`
 * branch inside it could never run.
 */
export default function ApplicationsLoading() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-9 w-28" />
      </header>
      <div className="flex flex-col gap-2">
        {/* Eight, per Block E. */}
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </section>
  );
}

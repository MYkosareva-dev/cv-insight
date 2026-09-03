import { Skeleton } from '@/components/ui/skeleton';

/**
 * The LOADING state for `/scan` (Block E: the two panels, before the counts
 * that fill them have resolved).
 *
 * Its own file for the same reason `/career`'s is: the page awaits two counts,
 * and an awaited Server Component renders nothing until they resolve — there is
 * no moment at which a `loading === true` branch inside it could run.
 */
export default function ScanLoading() {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
      <Skeleton className="h-10 w-32" />
    </section>
  );
}

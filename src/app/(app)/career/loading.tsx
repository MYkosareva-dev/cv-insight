import { Skeleton } from '@/components/ui/skeleton';

/**
 * The LOADING state for `/career` (SPEC Block E: "6 skeleton cards").
 *
 * It lives in its own file rather than as a branch inside `page.tsx` because it
 * has to: the page awaits `listCareerItems()`, and an awaited Server Component
 * renders NOTHING until it resolves — there is no moment at which a
 * `loading === true` branch could run. Next wraps the route in a Suspense
 * boundary with this as the fallback, which is the only mechanism that makes the
 * state reachable at all.
 */
export default function CareerLoading() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-9 w-36" />
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Six, per Block E. */}
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="border-border flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-3 w-24" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

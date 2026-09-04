import { Skeleton } from '@/components/ui/skeleton';

/**
 * The LOADING state for `/quality` (SPEC Block E: "skeleton tiles").
 *
 * Its own file, like `/career`'s and `/applications`': the page awaits three DAL
 * reads, and an awaited Server Component renders nothing until they resolve, so a
 * `loading === true` branch inside it could never run.
 *
 * TEN TILES AND THREE TABLE BLOCKS, matching what the page actually draws. A
 * skeleton that shows a different shape from the screen it stands in for is a
 * layout shift dressed as a loading state.
 */
export default function QualityLoading() {
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      ))}
    </section>
  );
}

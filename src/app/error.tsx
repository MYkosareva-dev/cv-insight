'use client';

import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import { ERROR_PAGE } from '@/lib/copy';

/**
 * App-level error boundary — the counterpart to not-found.tsx.
 *
 * Every DAL mutation and both gates currently throw; without this, an uncaught
 * throw in a Server Component renders Next's stock error page instead of app
 * copy. Per-screen error states (SPEC Block E's three-state requirement) are
 * still each screen's own job; this is the floor beneath them.
 *
 * The error MESSAGE is never rendered: it can carry resume or vacancy text,
 * which must not leave the database rows the user owns. Only `digest` — the
 * server-side hash Next provides — is shown, so a report can be correlated
 * with the server log without exposing content.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">{ERROR_PAGE.title}</h1>
      <p className="text-muted-foreground max-w-prose text-sm">{ERROR_PAGE.body}</p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>{ERROR_PAGE.retry}</Button>
        <Link href="/applications" className={buttonVariants({ variant: 'outline' })}>
          {ERROR_PAGE.home}
        </Link>
      </div>

      {error.digest ? (
        <p className="text-muted-foreground text-xs">
          {ERROR_PAGE.reference}: {error.digest}
        </p>
      ) : null}
    </main>
  );
}

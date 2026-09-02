import Link from 'next/link';

/**
 * A row that is absent and a row owned by another user look identical here:
 * both render "Not found", never 403 — don't leak existence (edge case S3).
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-muted-foreground text-sm">This page does not exist.</p>
      <Link href="/" className="text-primary text-sm underline-offset-4 hover:underline">
        Back to CV Insight
      </Link>
    </main>
  );
}

import type { Metadata } from 'next';

import { APP_NAME } from '@/lib/copy';

import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'AI resume tailoring grounded in your own career base.',
};

/**
 * `suppressHydrationWarning` on `<html>` — the only place in the app's own
 * layout, and never on `<body>` or in a component.
 *
 * Browser extensions — LanguageTool and Grammarly among them — write attributes
 * onto `<html>` while the page is still loading, i.e. before React hydrates. The
 * server markup and the client DOM then differ on an element nothing in this app
 * controls, and owner testing saw the hydration mismatch that follows. This is
 * the framework's own remedy for it, and it is deliberately narrow: the flag
 * suppresses the warning ONE level deep, on this element's own attributes, so a
 * real mismatch anywhere inside the tree is still reported.
 *
 * Do not copy it onto `<body>` or into a component. There it would silence
 * mismatches the app IS responsible for — a value read from `localStorage`
 * during render, a layout that differs between server and client — which is the
 * class of bug this warning exists to catch, and the reason the flag is scoped
 * rather than global.
 *
 * ONE other element in the app carries it, for a different and equally narrow
 * reason: the `<time>` cell in `src/app/(app)/applications/page.tsx`, where the
 * server formats a date in the server's timezone and the client re-formats it in
 * the viewer's, so the two renders differ by design (edge case T1). That one is
 * an intended difference on a known element; this one is an unknown attribute
 * written by software outside the page. Both are single elements, and neither is
 * a licence to add a third.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}

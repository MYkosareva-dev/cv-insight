'use client';

import { Toaster as Sonner } from 'sonner';

/**
 * Toast host (SPEC Block E, "Toast mechanism").
 *
 * No theme provider: Block E defines a single light palette, so the toast is
 * styled from the same tokens as everything else rather than from a `theme`
 * prop. That is also why `next-themes` is not a dependency.
 */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'border-border bg-background text-foreground rounded-md border shadow-md',
          description: 'text-muted-foreground',
        },
      }}
    />
  );
}

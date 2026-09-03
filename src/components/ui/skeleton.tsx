import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Loading state primitive. Block E gives every screen three mandatory states,
 * and this is the one the /career list shows while its items load.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-muted animate-pulse rounded-md', className)}
      {...props}
    />
  );
}

export { Skeleton };

import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input bg-background text-foreground placeholder:text-muted-foreground flex w-full min-w-0 rounded-md border px-3 py-2 text-sm shadow-xs transition-colors outline-none',
        'focus-visible:ring-ring focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-offset-1',
        'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };

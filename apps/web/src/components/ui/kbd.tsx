import * as React from 'react';
import { cn } from 'cn';

/** A keyboard key, e.g. a shortcut hint next to a button; hidden on touch (UX-SIMPLIFICATION.md §3.13 item 3). */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 [@media(hover:none)]:hidden items-center justify-center rounded-sm border border-border bg-muted px-1 font-mono text-[11px] font-medium text-muted-foreground select-none',
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };

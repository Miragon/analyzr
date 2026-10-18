import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import type { ReactNode } from 'react';

import { healthQuery } from '@/lib/queries';

/** The official Miragon app icon (green comet on blue), unchanged from the CI. */
export function MiragonMark({ className }: { className?: string }) {
  return <img src="/favicon.svg" alt="" aria-hidden className={cn('size-6', className)} />;
}

/**
 * The server's state, only when something is wrong (UX-SIMPLIFICATION.md §3.1
 * item 4): a banner instead of „Server verbunden“ on every page; the version
 * sits in the logo's tooltip.
 */
function ServerAlert() {
  const health = useQuery(healthQuery);
  const text = health.isError
    ? 'Server nicht erreichbar'
    : health.data && health.data.status !== 'ok'
      ? 'Datenbank nicht erreichbar'
      : null;
  if (text === null) return null;
  return (
    <div
      role="alert"
      data-testid="server-status"
      className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 pt-3 text-sm font-medium text-danger sm:px-6"
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-danger" />
      {text}
    </div>
  );
}

/**
 * Page frame for list and settings pages: brand mark (the version in its
 * tooltip), breadcrumbs, a banner only while the server or its database is
 * unreachable, content on the 1152px grid (16 px gutters on a phone). The model view has its own
 * borderless canvas layout instead.
 */
export function PageShell({ crumbs, children }: { crumbs?: ReactNode; children: ReactNode }) {
  const health = useQuery(healthQuery);
  return (
    <div className="flex min-h-app-viewport flex-col">
      <ServerAlert />
      <header className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 pt-5 pb-2 sm:px-6">
        <Link
          to="/"
          title={health.data ? `analyzr ${health.data.version}` : 'analyzr'}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <MiragonMark />
          analyzr
        </Link>
        {crumbs ? (
          <nav
            aria-label="Brotkrumen"
            className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
          >
            {crumbs}
          </nav>
        ) : null}
      </header>
      <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col gap-6 px-4 pt-4 pb-12 sm:px-6">
        {children}
      </main>
    </div>
  );
}

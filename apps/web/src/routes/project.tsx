import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, createRoute, useRouterState } from '@tanstack/react-router';
import { cn } from 'cn';
import { ChevronRightIcon, SettingsIcon, UploadIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { ErrorText } from '@/components/error-text';
import { LightPopover, MENU_ITEM_CLASS } from '@/components/light-popover';
import { PageShell } from '@/components/page-shell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { useProjectPermissions } from '@/lib/permissions';
import { useProjectCounts } from '@/lib/project-counts';
import { projectQuery } from '@/lib/queries';

import { rootRoute } from './root';

export const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$project',
  component: ProjectLayout,
});

type TabPath =
  | '/projects/$project'
  | '/projects/$project/review'
  | '/projects/$project/value-chain'
  | '/projects/$project/open-questions';

/**
 * One of the four object tabs (UX-SIMPLIFICATION.md §2.2, owner decision 26):
 * its badge counts that object's open work, never 0 (P7); `active` is decided
 * by the layout, since „Relationen“ covers `/review` and `/relations`.
 */
function TabLink({
  to,
  children,
  count,
  hint,
  active,
}: {
  to: TabPath;
  children: ReactNode;
  count?: number | undefined;
  /** What the count counts, for screen readers. */
  hint?: string;
  active: boolean;
}) {
  const { project } = projectRoute.useParams();
  return (
    <Link
      to={to}
      params={{ project }}
      activeOptions={{ exact: true, includeSearch: false }}
      aria-current={active ? 'page' : undefined}
      data-status={active ? 'active' : undefined}
      className="relative inline-flex shrink-0 items-center gap-1.5 rounded-md px-1 pt-1 pb-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-[status=active]:text-foreground data-[status=active]:after:absolute data-[status=active]:after:inset-x-0 data-[status=active]:after:-bottom-px data-[status=active]:after:h-0.5 data-[status=active]:after:bg-primary"
    >
      {children}
      {count === undefined || count === 0 ? null : (
        <span className="rounded-sm bg-muted px-1.5 text-xs tabular-nums">
          {count}
          {hint ? <span className="sr-only"> {hint}</span> : null}
        </span>
      )}
    </Link>
  );
}

/** The owners' menu „Einstellungen“: „Agent verbinden“ and „Annahmeregeln“ (Q1). */
function SettingsMenu({ project }: { project: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <LightPopover
      open={open}
      onOpenChange={setOpen}
      role="menu"
      label="Einstellungen"
      testId="settings-menu"
      trigger={(props) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Einstellungen"
          title="Einstellungen"
          data-testid="settings"
          {...props}
        >
          <SettingsIcon />
        </Button>
      )}
    >
      <Link
        role="menuitem"
        to="/projects/$project/agents"
        params={{ project }}
        className={MENU_ITEM_CLASS}
        onClick={close}
      >
        Agent verbinden
      </Link>
      <Link
        role="menuitem"
        to="/projects/$project/rules"
        params={{ project }}
        className={MENU_ITEM_CLASS}
        onClick={close}
      >
        Annahmeregeln
      </Link>
    </LightPopover>
  );
}

/**
 * The tab row on a phone (§3.1 item 5): it scrolls sideways, so the active
 * tab is scrolled into it on every route change, and while more lies to the
 * right a fade at the edge says so (`more`).
 */
function useTabRow(active: string, counts: unknown) {
  const ref = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const tab = nav.querySelector<HTMLElement>('[aria-current=page]');
    if (tab) {
      const row = nav.getBoundingClientRect();
      const box = tab.getBoundingClientRect();
      if (box.right > row.right) nav.scrollLeft += box.right - row.right;
      else if (box.left < row.left) nav.scrollLeft -= row.left - box.left;
    }
    const update = () => setMore(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
    update();
    nav.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      nav.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [active, counts]);
  return [ref, more] as const;
}

/** Pages of the project without a tab of their own: their crumb names them. */
const SECTIONS: Record<string, string> = {
  upload: 'Hochladen',
  agents: 'Agent verbinden',
  rules: 'Annahmeregeln',
  findings: 'Befunde',
};

/**
 * The project shell (UX-SIMPLIFICATION.md §2.2, §3.1): the project's name with
 * its key, four object tabs („Übersicht“, „Relationen“, „Wertschöpfungskette“,
 * „Offene Fragen“, each badge from `useProjectCounts`), and pinned at the
 * right, outside the scrolling part, the button „Hochladen“ (editors and
 * owners) and the owners' menu „Einstellungen“. The URLs stay: `/review` and
 * `/relations` are both „Relationen“, `/upload`, `/agents`, `/rules` and
 * `/findings` name themselves in the crumb.
 */
function ProjectLayout() {
  const { project } = projectRoute.useParams();
  const info = useQuery(projectQuery(project));
  const counts = useProjectCounts(project);
  const can = useProjectPermissions(project);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const notFound = info.error instanceof ApiError && info.error.status === 404;
  const base = `/projects/${project}`;
  const rest = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1) : '';
  const section = SECTIONS[rest.split('/')[0] ?? ''];
  const name = info.data?.name ?? project;
  const [rowRef, moreTabs] = useTabRow(
    rest.split('/')[0] ?? '',
    [counts.reviewItems, counts.openPlacements, counts.ask].join(),
  );

  return (
    <PageShell
      crumbs={
        <>
          <ChevronRightIcon className="size-4 shrink-0" aria-hidden />
          {section ? (
            <>
              <Link
                to="/projects/$project"
                params={{ project }}
                className="truncate hover:text-foreground"
              >
                {name}
              </Link>
              <ChevronRightIcon className="size-4 shrink-0" aria-hidden />
              <span className="shrink-0 text-foreground" aria-current="page">
                {section}
              </span>
            </>
          ) : (
            <span className="truncate text-foreground" aria-current="page">
              {name}
            </span>
          )}
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {info.isPending ? (
          <Skeleton className="h-9 w-64" />
        ) : (
          <h1 className="text-[28px] leading-tight font-bold break-words">{name}</h1>
        )}
        <p className="font-mono text-xs text-muted-foreground" data-testid="project-key">
          {project}
        </p>
      </div>
      {info.isError ? (
        <Alert variant="destructive">
          <AlertTitle>
            {notFound ? 'Projekt nicht gefunden' : 'Projekt konnte nicht geladen werden'}
          </AlertTitle>
          <AlertDescription>
            {notFound ? (
              `Es gibt kein Projekt „${project}“, oder du hast keinen Zugriff.`
            ) : (
              <ErrorText error={info.error} />
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="-mt-2 flex min-w-0 items-end gap-2 border-b" data-testid="project-tabs">
            <nav
              ref={rowRef}
              aria-label="Projektbereiche"
              className={cn(
                '-mb-px flex min-w-0 flex-1 gap-5 overflow-x-auto whitespace-nowrap [scrollbar-width:none]',
                moreTabs &&
                  '[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]',
              )}
              data-more={moreTabs || undefined}
            >
              <TabLink to="/projects/$project" active={rest === ''}>
                Übersicht
              </TabLink>
              <TabLink
                to="/projects/$project/review"
                active={rest.startsWith('review') || rest.startsWith('relations')}
                count={counts.reviewItems}
                hint="zu prüfen"
              >
                Relationen
              </TabLink>
              <TabLink
                to="/projects/$project/value-chain"
                active={rest.startsWith('value-chain')}
                count={counts.openPlacements}
                hint="Platzierungen zu prüfen"
              >
                Wertschöpfungskette
              </TabLink>
              <TabLink
                to="/projects/$project/open-questions"
                active={rest.startsWith('open-questions')}
                count={counts.ask}
                hint="zu klären"
              >
                Offene Fragen
              </TabLink>
            </nav>
            {/* Write entries only for whoever may use them (never on the read-only demo). */}
            {can.canWrite || can.isOwner ? (
              <div className="flex shrink-0 items-center gap-1 pb-1.5">
                {can.canWrite ? (
                  <Button
                    asChild
                    variant={section === 'Hochladen' ? 'secondary' : 'outline'}
                    size="sm"
                  >
                    <Link
                      to="/projects/$project/upload"
                      params={{ project }}
                      aria-label="Hochladen"
                    >
                      <UploadIcon data-icon="inline-start" />
                      <span className="hidden sm:inline">Hochladen</span>
                    </Link>
                  </Button>
                ) : null}
                {can.isOwner ? <SettingsMenu project={project} /> : null}
              </div>
            ) : null}
          </div>
          <Outlet />
        </>
      )}
    </PageShell>
  );
}

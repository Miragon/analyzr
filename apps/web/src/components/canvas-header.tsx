import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { MiragonMark } from '@/components/page-shell';

/**
 * The header of the canvas pages (UX-SIMPLIFICATION.md §3.13 item 2; built
 * in UX3 for the model view): the crumb „<Projekt> › <Bereich>“ as the one
 * way back (without an area, as on the chain page, „‹ <Projekt>“ alone), the
 * title with a small subtitle or a disclosure beside it, at most three chips
 * and the page's „Mehr“, and a line below (the model view's import loss, the
 * chain's edit toolbar). From 1024 px a floating card at the top left; below
 * it a full-width top bar (back crumb, title, the first chip), so the canvas
 * keeps the view.
 */
export function CanvasHeader({
  wide,
  project,
  projectName,
  area,
  title,
  titleExtra,
  subtitle,
  chips,
  more,
  below,
  size = 'default',
  testId,
}: {
  wide: boolean;
  project: string;
  projectName: string;
  /**
   * The area the crumb leads back to, e.g. „Übersicht“ (the project's
   * landing); without it the project is the way back (the chain, a project
   * area of its own).
   */
  area?: { label: string; to: '/projects/$project' };
  title: ReactNode;
  /** Beside the title: a disclosure (the chain's revision), badges (unsaved). */
  titleExtra?: ReactNode;
  /** Small under the title, e.g. the model's key. */
  subtitle?: ReactNode;
  /** At most three; on a phone only the first. */
  chips?: readonly ReactNode[];
  /** The page's menu „Mehr“. */
  more?: ReactNode;
  below?: ReactNode;
  /** `wide`: next to the 440 px panel (the chain), else the 380 px one. */
  size?: 'default' | 'wide';
  testId?: string;
}) {
  const shown = (chips ?? []).filter(Boolean).slice(0, 3);
  const back = (
    <Link
      to="/projects/$project"
      params={{ project }}
      className="inline-flex min-w-0 shrink items-center gap-0.5 text-sm text-link hover:underline"
      data-testid="canvas-back"
    >
      <ChevronLeftIcon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{projectName}</span>
    </Link>
  );
  if (!wide && !area) {
    return (
      <header
        className="absolute inset-x-0 top-0 z-30 flex flex-col gap-1 border-b bg-card/95 px-3 py-2 shadow-sm backdrop-blur-sm"
        data-testid={testId}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex max-w-[40%] min-w-0">{back}</span>
          <h1
            className="min-w-0 flex-1 truncate text-base font-semibold"
            data-testid="canvas-title"
          >
            {title}
          </h1>
          {titleExtra}
          {more}
        </div>
        {shown[0] ? <div className="flex flex-wrap items-center gap-1.5">{shown[0]}</div> : null}
        {below}
      </header>
    );
  }
  if (!wide && area) {
    return (
      <header
        className="absolute inset-x-0 top-0 z-30 flex flex-col gap-1 border-b bg-card/95 px-3 py-2 shadow-sm backdrop-blur-sm"
        data-testid={testId}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={area.to}
            params={{ project }}
            className="inline-flex shrink-0 items-center gap-0.5 text-sm text-link"
            aria-label={`Zurück zu „${area.label}“ von ${projectName}`}
            data-testid="canvas-back"
          >
            <ChevronLeftIcon className="size-4" aria-hidden />
            {area.label}
          </Link>
          <h1
            className="min-w-0 flex-1 truncate text-base font-semibold"
            data-testid="canvas-title"
          >
            {title}
          </h1>
          {titleExtra}
          {more}
        </div>
        {shown[0] ? <div className="flex flex-wrap items-center gap-1.5">{shown[0]}</div> : null}
        {below}
      </header>
    );
  }
  return (
    <header
      className={cn(
        'absolute top-4 left-4 z-30 flex flex-col gap-2 rounded-xl border bg-card/90 p-3 shadow-md backdrop-blur-sm',
        size === 'wide'
          ? 'max-w-[min(560px,calc(100vw-520px))]'
          : 'max-w-[min(520px,calc(100vw-460px))]',
      )}
      data-testid={testId}
    >
      {area ? (
        <nav
          aria-label="Brotkrumen"
          className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground"
        >
          <Link to="/" aria-label="Zu den Projekten" className="shrink-0">
            <MiragonMark className="size-5" />
          </Link>
          <ChevronRightIcon className="size-4 shrink-0" aria-hidden />
          <Link
            to="/projects/$project"
            params={{ project }}
            className="truncate hover:text-foreground"
          >
            {projectName}
          </Link>
          <ChevronRightIcon className="size-4 shrink-0" aria-hidden />
          <Link
            to={area.to}
            params={{ project }}
            className="shrink-0 text-link hover:underline"
            data-testid="canvas-back"
          >
            {area.label}
          </Link>
        </nav>
      ) : (
        <nav aria-label="Zurück" className="flex min-w-0">
          {back}
        </nav>
      )}
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="min-w-0 truncate text-base font-semibold" data-testid="canvas-title">
            {title}
          </h1>
          {titleExtra}
        </div>
        {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {shown.length > 0 || more ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {shown}
          {more ? <span className="ml-auto">{more}</span> : null}
        </div>
      ) : null}
      {below}
    </header>
  );
}

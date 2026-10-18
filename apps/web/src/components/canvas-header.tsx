import { Link } from '@tanstack/react-router';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { MiragonMark } from '@/components/page-shell';

/**
 * The header of the canvas pages (UX-SIMPLIFICATION.md §3.13 item 2; built
 * in UX3 for the model view): the crumb „<Projekt> › <Bereich>“ as the one
 * way back, the title with a small subtitle, at most three chips and the
 * page's „Mehr“, and a line below (the model view's import loss). From
 * 1024 px a floating card at the top left; below it a full-width top bar
 * (back crumb, title, the first chip), so the canvas keeps the view.
 */
export function CanvasHeader({
  wide,
  project,
  projectName,
  area,
  title,
  subtitle,
  chips,
  more,
  below,
  testId,
}: {
  wide: boolean;
  project: string;
  projectName: string;
  /** The area the crumb leads back to, e.g. „Übersicht“ (the project's landing). */
  area: { label: string; to: '/projects/$project' };
  title: ReactNode;
  /** Small under the title, e.g. the model's key. */
  subtitle?: ReactNode;
  /** At most three; on a phone only the first. */
  chips?: readonly ReactNode[];
  /** The page's menu „Mehr“. */
  more?: ReactNode;
  below?: ReactNode;
  testId?: string;
}) {
  const shown = (chips ?? []).filter(Boolean).slice(0, 3);
  if (!wide) {
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
          {more}
        </div>
        {shown[0] ? <div className="flex flex-wrap items-center gap-1.5">{shown[0]}</div> : null}
        {below}
      </header>
    );
  }
  return (
    <header
      className="absolute top-4 left-4 z-30 flex max-w-[min(520px,calc(100vw-460px))] flex-col gap-2 rounded-xl border bg-card/90 p-3 shadow-md backdrop-blur-sm"
      data-testid={testId}
    >
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
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-base font-semibold" data-testid="canvas-title">
          {title}
        </h1>
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

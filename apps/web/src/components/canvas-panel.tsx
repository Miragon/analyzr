import { cn } from 'cn';
import { ChevronUpIcon } from 'lucide-react';
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { SHEET_HANDLE, SHEET_HEIGHT, type CanvasSheet } from '@/lib/canvas-sheet';

/**
 * The floating panel of the canvas pages (UX-SIMPLIFICATION.md §3.13 item 1;
 * built in UX3 for the model view, its API meant for the review screen (UX5)
 * and the chain (UX6) too): from 1024 px an aside at the right; below it a
 * view-first bottom sheet, collapsed to a handle that sums the content up
 * („Fragen 2 · Relationen 11“). The canvas container ends above the sheet in
 * both states (`CanvasSheet.inset`), so the bpmn.io watermark at its bottom
 * right stays fully visible and the sheet never overlays the canvas. The
 * handle is a button with `aria-expanded` and `aria-controls`; collapsed, the
 * content is `inert`; Escape collapses it and expanding moves the focus into
 * it; the height change respects `prefers-reduced-motion`.
 */

export function CanvasPanel({
  sheet,
  label,
  summary,
  header,
  footer,
  size = 'default',
  children,
  testId,
}: {
  sheet: CanvasSheet;
  /** The landmark's name (`aside aria-label`); probes of the CSS checks find the panel by it. */
  label: string;
  /** The collapsed sheet's handle: what the panel holds, in a few words (expanded: `label`). */
  summary: string;
  /** Above the scrolling content: tabs, the selected element. */
  header?: ReactNode;
  /** Below it, pinned: the review screen's decisions (UX5). */
  footer?: ReactNode;
  /** `wide`: 440 px from 1024 (the review screen), else 380. */
  size?: 'default' | 'wide';
  children: ReactNode;
  testId?: string;
}) {
  const contentId = useId();
  const content = useRef<HTMLDivElement>(null);
  const { wide, expanded, setExpanded } = sheet;
  const open = wide || expanded;

  // Expanding by the handle moves the focus into the content.
  const focusOnOpen = useRef(false);
  useEffect(() => {
    if (!wide && expanded && focusOnOpen.current) {
      focusOnOpen.current = false;
      content.current?.focus();
    }
  }, [wide, expanded]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!wide && expanded && event.key === 'Escape') {
      event.stopPropagation();
      setExpanded(false);
    }
  };

  return (
    <aside
      aria-label={label}
      data-testid={testId}
      data-sheet={wide ? undefined : expanded ? 'expanded' : 'collapsed'}
      onKeyDown={onKeyDown}
      className={cn(
        'z-30 flex flex-col overflow-hidden bg-card/95 shadow-md backdrop-blur-sm',
        wide
          ? cn(
              'absolute top-4 right-4 bottom-4 max-w-[calc(100vw-32px)] rounded-xl border',
              size === 'wide' ? 'w-[440px]' : 'w-[380px]',
            )
          : 'absolute inset-x-0 bottom-0 rounded-t-xl border-t transition-[height] motion-reduce:transition-none',
      )}
      style={wide ? undefined : { height: expanded ? SHEET_HEIGHT : SHEET_HANDLE }}
    >
      {wide ? null : (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => {
            focusOnOpen.current = !expanded;
            setExpanded(!expanded);
          }}
          className="flex h-[3.25rem] shrink-0 items-center gap-2 px-4 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          data-testid="panel-handle"
        >
          {/* expanded, the tabs say what the summary does: the handle names the panel */}
          <span className="min-w-0 flex-1 truncate text-left">{expanded ? label : summary}</span>
          <ChevronUpIcon
            className={cn(
              'size-4 transition-transform motion-reduce:transition-none',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      )}
      <div
        id={contentId}
        ref={content}
        tabIndex={-1}
        inert={!open}
        className="flex min-h-0 flex-1 flex-col outline-none"
      >
        {header}
        <div className={cn('min-h-0 flex-1 overflow-y-auto', size === 'wide' ? 'p-4' : 'p-2')}>
          {children}
        </div>
        {footer}
      </div>
    </aside>
  );
}

export interface PanelTab<T extends string> {
  id: T;
  label: string;
  /** Shown after the label once known. */
  count?: number | undefined;
}

/**
 * The panel's tabs: a light tablist (no Radix, the model view is in the
 * entry chunk, §3.13 item 8): buttons with `role=tab`, the arrow keys, Home
 * and End move between them; {@link PanelTabPanel} holds each one's content.
 */
export function PanelTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idBase,
}: {
  tabs: readonly PanelTab<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** Shared with the tab panels: `${idBase}-tab-${id}`, `${idBase}-panel-${id}`. */
  idBase: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.id === value);
    const to =
      event.key === 'ArrowRight'
        ? (at + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (at - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1;
    const next = tabs[to];
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-4 px-3" onKeyDown={move}>
      {tabs.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
              else refs.current.delete(t.id);
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            data-testid="panel-tab"
            data-tab={t.id}
            className={cn(
              'relative -mb-px inline-flex items-center gap-1.5 rounded-md px-1 pt-2 pb-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              selected &&
                'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary',
            )}
          >
            {t.label}
            {t.count === undefined ? null : (
              <span className="rounded-sm bg-muted px-1.5 text-xs tabular-nums">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** One tab's content; the others stay mounted but hidden, so their state and queries keep. */
export function PanelTabPanel<T extends string>({
  id,
  value,
  idBase,
  children,
}: {
  id: T;
  value: T;
  idBase: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${id}`}
      aria-labelledby={`${idBase}-tab-${id}`}
      hidden={id !== value}
      data-testid="panel-tabpanel"
      data-tab={id}
    >
      {children}
    </div>
  );
}

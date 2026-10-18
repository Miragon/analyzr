import { cn } from 'cn';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

/**
 * A light disclosure for the shell's menus and popovers (UX-SIMPLIFICATION.md
 * §3.13 item 8): a trigger with `aria-expanded` and an absolutely positioned
 * panel that Escape and an outside click close. No floating-ui, so the entry
 * chunk stays small (Radix's dropdown loads with the lazy chunks only).
 */

function useDismiss(
  open: boolean,
  close: (focusTrigger: boolean) => void,
  root: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close, root]);
}

export interface TriggerProps {
  'aria-expanded': boolean;
  'aria-controls': string;
  'aria-haspopup': 'menu' | 'dialog';
  onClick: () => void;
  ref: RefObject<HTMLButtonElement | null>;
}

/**
 * The panel opens below its trigger, aligned to its `align` edge, as wide as
 * its widest entry (`w-max`, never wider than the screen); `role` `menu`
 * focuses the first item and moves with the arrow keys, `dialog` its first
 * focusable element.
 */
export function LightPopover({
  open,
  onOpenChange,
  trigger,
  children,
  role = 'dialog',
  label,
  align = 'end',
  className,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: (props: TriggerProps) => ReactNode;
  children: ReactNode;
  role?: 'menu' | 'dialog';
  /** Accessible name of the panel. */
  label: string;
  align?: 'start' | 'end';
  className?: string;
  testId?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(
    (focusTrigger: boolean) => {
      onOpenChange(false);
      if (focusTrigger) triggerRef.current?.focus();
    },
    [onOpenChange],
  );
  useDismiss(open, close, root);
  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>(
      role === 'menu'
        ? '[role=menuitem]'
        : 'button, a[href], input, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
  }, [open, role]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (role !== 'menu' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>('[role=menuitem]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else if (event.key === 'Tab') close(false);
  };

  return (
    <div ref={root} className="relative inline-flex">
      {trigger({
        'aria-expanded': open,
        'aria-controls': id,
        'aria-haspopup': role,
        onClick: () => onOpenChange(!open),
        ref: triggerRef,
      })}
      {open ? (
        <div
          ref={panel}
          id={id}
          role={role}
          aria-label={label}
          data-testid={testId}
          onKeyDown={onKeyDown}
          className={cn(
            'absolute top-full z-50 mt-1 w-max max-w-[calc(100vw-2rem)] rounded-lg border bg-card p-1 text-sm shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Class of an entry of a {@link LightPopover} menu (a link or a button with `role=menuitem`). */
export const MENU_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left whitespace-nowrap outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground';

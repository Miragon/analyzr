import type { OpenQuestion } from '@analyzr/client';
import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * After an action the item leaves the list (or turns „Erledigt
 * (außerhalb)“), and the focus moves to the next item (M6 §4.8 a): its
 * primary action, else its first action, else the item itself; after the
 * last item to the one before; in an empty list to `fallback`. The order is
 * the one shown when the action started: the item may already be gone from
 * the current render when its action reports back.
 */
export function useActionFocus(
  ids: readonly string[],
  container: RefObject<HTMLElement | null>,
  fallback: () => HTMLElement | null,
): (q: Pick<OpenQuestion, 'id'>) => void {
  const current = useRef<readonly string[]>(ids);
  const previous = useRef<readonly string[]>(ids);
  useEffect(() => {
    if (current.current === ids) return;
    previous.current = current.current;
    current.current = ids;
  }, [ids]);

  return useCallback(
    (q) => {
      const order = current.current.includes(q.id) ? current.current : previous.current;
      const at = order.indexOf(q.id);
      const candidates = at < 0 ? [] : [...order.slice(at + 1), ...order.slice(0, at).reverse()];
      // After the next render (the item gone or changed), so the target is the one left standing.
      requestAnimationFrame(() => {
        const root = container.current;
        for (const id of candidates) {
          const item = root?.querySelector<HTMLElement>(
            `[data-testid="open-question"][data-question-id="${id}"]`,
          );
          if (!item) continue;
          const target =
            item.querySelector<HTMLElement>(
              '[data-testid="question-action"][data-primary="true"]',
            ) ??
            item.querySelector<HTMLElement>(
              '[data-testid="question-actions"] button, [data-testid="question-actions"] a',
            ) ??
            item;
          target.focus();
          return;
        }
        fallback()?.focus();
      });
    },
    [container, fallback],
  );
}

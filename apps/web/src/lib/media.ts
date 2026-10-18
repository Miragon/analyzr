import { useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, kept current (`matchMedia`'s `change`).
 * `fallback` answers where there is no `matchMedia` (server rendering).
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (callback) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', callback);
      return () => list.removeEventListener('change', callback);
    },
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : fallback,
    () => fallback,
  );
}

/** The canvas pages' breakpoint: an aside from here, a bottom sheet below (UX-SIMPLIFICATION.md §3.13 item 1). */
export const CANVAS_WIDE = '(min-width: 1024px)';

import { useSyncExternalStore } from 'react';

/**
 * „Agent starten“ from a toast (UX-SIMPLIFICATION.md §2.6: the toast after an
 * amendment save): a toast's action cannot anchor a popover, so it asks the
 * root's host to show the popover's content for the project
 * (`components/agent-start-host.tsx`). One request at a time.
 */

let current: string | null = null;
const listeners = new Set<() => void>();

function emit(next: string | null) {
  current = next;
  for (const listener of listeners) listener();
}

/** Shows „Agent starten“ for `project`. */
export const requestAgentStart = (project: string): void => emit(project);

export const closeAgentStart = (): void => emit(null);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const get = () => current;

/** The project whose „Agent starten“ the host shows, else `null`. */
export const useAgentStartRequest = (): string | null => useSyncExternalStore(subscribe, get, get);

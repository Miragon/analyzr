/**
 * Toast store (modeler-tool-design §9): feedback is never silent. Rendered by
 * `components/toaster.tsx`; call {@link toast} from anywhere.
 */
export type ToastTone = 'success' | 'info' | 'warning' | 'danger';

/**
 * One button in a toast, e.g. „Rückgängig“ after an action on an open
 * question (M6 S5c-1); a toast with an action stays longer.
 */
export interface ToastAction {
  label: string;
  onAction: () => void;
  /** What the action does, for screen readers (Radix announces it with the toast). */
  altText?: string;
}

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: ToastAction;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function toast(input: Omit<ToastItem, 'id'>): void {
  items = [...items, { ...input, id: nextId++ }].slice(-4);
  emit();
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getToasts = (): readonly ToastItem[] => items;

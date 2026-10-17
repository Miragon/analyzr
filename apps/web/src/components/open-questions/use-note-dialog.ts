import type { OpenQuestion } from '@analyzr/client';
import { useCallback, useState } from 'react';

/** The dialog's state in its parent: the item a note is added to, kept while the dialog closes. */
export interface NoteDialogState {
  question: OpenQuestion | null;
  open: boolean;
  /** Bumped on every opening, so each starts with an empty form. */
  round: number;
  /** The button that opened it: the focus returns there (one dialog serves many buttons). */
  trigger: HTMLElement | null;
}

/** State and handlers of one note dialog (the tab and the model view's section each have one). */
export function useNoteDialog() {
  const [state, setState] = useState<NoteDialogState>({
    question: null,
    open: false,
    round: 0,
    trigger: null,
  });
  const open = useCallback(
    (question: OpenQuestion, trigger: HTMLElement) =>
      setState((s) => ({ question, open: true, round: s.round + 1, trigger })),
    [],
  );
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  return { state, open, close };
}

import type { OpenQuestion } from '@analyzr/client';
import { PERSONAL_DATA_HINT, personalDataWarnings } from '@analyzr/contracts/personal-data';
import { cn } from 'cn';
import { InfoIcon, MessageSquarePlusIcon, NotebookPenIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';

import { PlainText } from '@/components/review/plain-text';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api';
import { MAX_ANSWER_CHARS } from '@/lib/limits';
import { useAddQuestionNote } from '@/lib/open-question-actions';
import {
  ANSWER_TARGET_LABELS,
  NOTE_PERMANENT,
  answerTargetOf,
  charCountText,
  noteEffectText,
  noteKeepsOpen,
  notesBeforeText,
  personalDataFindings,
  personalDataHint,
} from '@/lib/open-question-answers';
import { toast } from '@/lib/toast';

import type { NoteDialogState } from './use-note-dialog';

const isUnknownQuestion = (error: unknown) =>
  error instanceof ApiError && error.status === 404 && error.problem.code === 'not-found';

/**
 * „Notiz hinzufügen“ (M6 §4.8 b, S5c-1; S5a's „Beantworten“ without the
 * answer kinds): the reviewer adds a note to one open question (≤ 2,000
 * characters, no personal data). The dialog says that a stored note cannot
 * be changed or deleted, and where it goes (`noteEffectText`, by the item's
 * subject and kind): on the item's relation (the agents take it into
 * account with the pair's next judgement) or placement (on an agent's
 * question the process becomes due; a held placement stays held, so no
 * agent gets the process until the reviewer decides), else at the question.
 * A note informs and leaves the item open; its action ends it. The
 * personal-data check of the contracts runs as the reviewer types and warns,
 * never blocks.
 */
export function NoteDialog({
  project,
  state,
  onClose,
  fallbackFocusId,
}: {
  project: string;
  state: NoteDialogState;
  onClose: () => void;
  /** Where the focus goes when the item left the list meanwhile. */
  fallbackFocusId?: string;
}) {
  const answer = useAddQuestionNote(project);
  const { question } = state;
  return (
    <Dialog
      open={state.open && question !== null}
      onOpenChange={(open) => {
        if (!open && !answer.isPending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        data-testid="note-dialog"
        onCloseAutoFocus={(event) => {
          // Back to the button that opened it (Radix knows only a DialogTrigger).
          event.preventDefault();
          if (state.trigger?.isConnected) state.trigger.focus();
          else if (fallbackFocusId) document.getElementById(fallbackFocusId)?.focus();
        }}
      >
        {question ? (
          <NoteForm
            key={state.round}
            question={question}
            pending={answer.isPending}
            onCancel={onClose}
            onSubmit={(text, setError) =>
              answer.mutate(
                { questionId: question.id, text },
                {
                  onSuccess: (result) => {
                    onClose();
                    toast(
                      result.result === 'recorded'
                        ? {
                            tone: 'success',
                            title: 'Notiz gespeichert',
                            description: `Gespeichert ${ANSWER_TARGET_LABELS[result.answer.target]}.${result.question.state === 'open' ? ` ${noteKeepsOpen(result.question)}` : ''}`,
                          }
                        : {
                            tone: 'info',
                            title: 'Notiz schon gespeichert',
                            description:
                              'Dieselbe Notiz steht schon an der Frage; nichts geändert.',
                          },
                    );
                  },
                  onError: (error) => {
                    if (isUnknownQuestion(error)) {
                      onClose();
                      toast({
                        tone: 'warning',
                        title: 'Frage gibt es so nicht mehr',
                        description:
                          'Die Quelle der Frage hat sich inzwischen geändert (dann hat die Frage eine neue Kennung), oder die Frage ist erledigt. Die Liste ist neu geladen; ergänze die Notiz dort, wenn die Frage noch offen ist.',
                      });
                    } else {
                      setError(errorMessage(error));
                    }
                  },
                },
              )
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NoteForm({
  question,
  pending,
  onCancel,
  onSubmit,
}: {
  question: OpenQuestion;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (text: string, setError: (message: string | null) => void) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const warnings = useMemo(() => personalDataWarnings(text), [text]);
  const hint = personalDataHint(warnings);
  const findings = personalDataFindings(text, warnings);
  const target = answerTargetOf(question.subject);
  const before = notesBeforeText(question.answers.filter((a) => a.role === 'note').length);
  const empty = text.trim() === '';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (empty || pending) return;
    setError(null);
    onSubmit(text.trim(), setError);
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => {
        // Cmd/Ctrl+Enter submits, as in the decision forms.
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
      className="flex min-w-0 flex-col gap-4"
      data-target={target}
    >
      <DialogHeader>
        <DialogTitle>Notiz hinzufügen</DialogTitle>
        <DialogDescription asChild>
          <div className="flex min-w-0 flex-col gap-1" data-testid="note-question">
            <span className="font-medium break-words text-foreground">{question.subjectLabel}</span>
            <PlainText as="span" text={question.text} className="line-clamp-4" />
          </div>
        </DialogDescription>
      </DialogHeader>

      {before ? (
        <p
          className="flex items-start gap-2 text-sm text-muted-foreground"
          data-testid="note-before"
        >
          <NotebookPenIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{before}</span>
        </p>
      ) : null}

      <Field>
        <FieldLabel htmlFor={`${id}-text`}>Deine Notiz</FieldLabel>
        <Textarea
          id={`${id}-text`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_ANSWER_CHARS}
          required
          autoFocus
          aria-describedby={`${id}-hint ${id}-permanent ${id}-count ${id}-personal`}
          placeholder="Was weißt du dazu?"
          className="min-h-28"
          data-testid="note-text"
        />
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <FieldDescription id={`${id}-hint`} data-testid="note-hint">
            {PERSONAL_DATA_HINT}.
          </FieldDescription>
          <FieldDescription id={`${id}-count`} className="text-xs tabular-nums">
            {charCountText(text.length)}
          </FieldDescription>
        </div>
        <FieldDescription id={`${id}-permanent`} data-testid="note-permanent">
          {NOTE_PERMANENT}
        </FieldDescription>
        {/*
          The personal-data warning, a warning only: saving stays possible. The
          live region (always there, so it is announced) holds the sentence,
          which changes only with what was found; the list of finds sits
          outside it, so typing on in an address is not read out each time.
        */}
        <div
          className={cn(
            hint &&
              'grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-lg border border-warning bg-warning-soft px-2.5 py-2 text-sm',
          )}
          data-testid="note-personal-data"
        >
          {hint ? (
            <TriangleAlertIcon
              className="row-span-2 size-4 translate-y-0.5 text-warning"
              aria-hidden
            />
          ) : null}
          <div role="status" id={`${id}-personal`} className="col-start-2 flex flex-col gap-0.5">
            {hint ? (
              <>
                <span className="font-medium">Vermutlich personenbezogene Daten</span>
                <span>{hint}</span>
              </>
            ) : null}
          </div>
          {hint ? (
            <ul className="col-start-2 flex flex-col gap-0.5 text-xs" aria-label="Gefunden">
              {findings.map((f, i) => (
                <li key={`${f.kind}:${i}`} className="break-all">
                  {f.label}: <span className="font-mono">{f.found}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Field>

      <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="note-effect">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{noteEffectText(question)}</span>
      </p>

      {error ? (
        <Alert variant="destructive" data-testid="note-error">
          <AlertTitle>Notiz nicht gespeichert</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={empty || pending}>
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <MessageSquarePlusIcon data-icon="inline-start" />
          )}
          Notiz speichern
        </Button>
      </DialogFooter>
    </form>
  );
}

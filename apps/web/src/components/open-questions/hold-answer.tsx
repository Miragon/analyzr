import { listOpenQuestions, type OpenQuestion } from '@analyzr/client';
import { PERSONAL_DATA_HINT } from '@analyzr/contracts/personal-data';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { MessageSquarePlusIcon, MessageSquareReplyIcon } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage, unwrap } from '@/lib/api';
import { MAX_NOTE_CHARS, MAX_PAGE_LIMIT } from '@/lib/limits';
import { ANSWER_SAVE_LABEL, HOLD_STAYS } from '@/lib/open-question-answers';
import { CARD_ACTION_LABELS, holdAnswered } from '@/lib/open-questions';
import { allPages, keys } from '@/lib/queries';
import { useAddNote } from '@/lib/review-actions';
import { toast } from '@/lib/toast';
import { useAddPlacementNote } from '@/lib/value-chain-actions';

import { NoteDialog } from './note-dialog';
import { useNoteDialog } from './use-note-dialog';

/**
 * The open holds as questions (UX2b): the „Vorgemerkt“ row and the review
 * screen answer a hold through the same note dialog as its card in „Offene
 * Fragen“ (UX-SIMPLIFICATION.md §2.4), so they find its item here. Under the
 * open questions' key, so every write on the project refreshes it.
 */
const heldOpenQuestionsQuery = (project: string) =>
  queryOptions({
    queryKey: keys.heldOpenQuestions(project),
    queryFn: (): Promise<OpenQuestion[]> =>
      allPages((cursor) =>
        unwrap(
          listOpenQuestions({
            client: api,
            path: { project },
            query: { kind: 'held', state: 'open', limit: MAX_PAGE_LIMIT, cursor },
          }),
        ),
      ),
  });

/**
 * „Antwort geben“ on a held relation or placement outside „Offene Fragen“
 * (UX2b, owner decision 26: one place to answer a hold): the button opens
 * the tab's note dialog for the hold's open question, so a note from here,
 * from its card and from the customer's CSV land on the same item; once the
 * hold has its answer, „Antwort ergänzen“. A held relation or placement
 * without such an item (an end of it is missing from the head models, or the
 * placement's step was removed, so it asks nothing in „Offene Fragen“), or
 * while the list cannot be loaded, is answered on the item itself, as before
 * UX2b. Loaded lazily by the „Vorgemerkt“ list, the review screen and the
 * chain's placement cards (reviewers only).
 */
export default function HoldAnswer({
  project,
  subject,
  className,
  size = 'sm',
}: {
  project: string;
  subject: { type: 'relation' | 'placement'; id: string };
  className?: string;
  /** `default` in the review screen's decision grid (UX5), beside the other decisions. */
  size?: 'sm' | 'default';
}) {
  const holds = useQuery(heldOpenQuestionsQuery(project));
  const noting = useNoteDialog();
  if (holds.isPending) return null;
  const question = holds.data?.find(
    (q) => q.subject.type === subject.type && q.subject.id === subject.id,
  );
  if (!question) {
    return <ItemAnswer project={project} subject={subject} className={className} size={size} />;
  }
  return (
    <>
      <Button
        variant="outline"
        size={size}
        className={className}
        onClick={(event) => noting.open(question, event.currentTarget)}
        data-testid="hold-answer"
      >
        <MessageSquareReplyIcon data-icon="inline-start" />
        {holdAnswered(question) ? CARD_ACTION_LABELS.answerMore : CARD_ACTION_LABELS.answer}
      </Button>
      <NoteDialog project={project} state={noting.state} onClose={noting.close} />
    </>
  );
}

/**
 * The answer as a note on the held relation or placement (`POST
 * …/relations/{r}/notes`, `…/placements/{p}/notes`), in the note dialog's
 * words, for a hold without an open question.
 */
function ItemAnswer({
  project,
  subject,
  className,
  size,
}: {
  project: string;
  subject: { type: 'relation' | 'placement'; id: string };
  className?: string | undefined;
  size: 'sm' | 'default';
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const addRelationNote = useAddNote(project);
  const addPlacementNote = useAddPlacementNote(project);
  const pending = addRelationNote.isPending || addPlacementNote.isPending;
  const empty = text.trim() === '';
  const where = subject.type === 'relation' ? 'an der Relation' : 'an der Platzierung';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (empty || pending) return;
    setError(null);
    const done = {
      onSuccess: () => {
        setOpen(false);
        setText('');
        toast({
          tone: 'success',
          title: 'Antwort gespeichert',
          description: `Gespeichert ${where}. ${HOLD_STAYS}`,
        });
      },
      onError: setError,
    };
    if (subject.type === 'relation')
      addRelationNote.mutate({ relationId: subject.id, text: text.trim() }, done);
    else addPlacementNote.mutate({ placementId: subject.id, text: text.trim() }, done);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size={size} className={className} data-testid="hold-answer">
          <MessageSquareReplyIcon data-icon="inline-start" />
          {CARD_ACTION_LABELS.answer}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl" data-testid="note-dialog">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{CARD_ACTION_LABELS.answer}</DialogTitle>
            <DialogDescription>
              Die Antwort wird {where} gespeichert. {HOLD_STAYS}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`${id}-text`}>Deine Antwort</FieldLabel>
            <Textarea
              id={`${id}-text`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_NOTE_CHARS}
              required
              autoFocus
              placeholder="Was hat die Klärung ergeben?"
              className="min-h-28"
            />
            <FieldDescription>{PERSONAL_DATA_HINT}.</FieldDescription>
          </Field>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Antwort nicht gespeichert</AlertTitle>
              <AlertDescription>{errorMessage(error)}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={empty || pending}>
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <MessageSquarePlusIcon data-icon="inline-start" />
              )}
              {ANSWER_SAVE_LABEL}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

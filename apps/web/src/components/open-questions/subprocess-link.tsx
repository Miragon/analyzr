import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinkIcon, SquarePlusIcon } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';

import { PickerList } from '@/components/picker-list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/api';
import { useManualRelation } from '@/lib/open-question-actions';
import {
  collapsedSubprocess,
  processChoices,
  processSection,
  refName,
  subprocessRationale,
  type ProcessChoice,
} from '@/lib/open-question-pickers';
import { useProjectPermissions } from '@/lib/permissions';
import { modelsQuery } from '@/lib/queries';
import type { RefResolver } from '@/lib/refs';
import { toast } from '@/lib/toast';
import { useProjectFacts } from '@/lib/use-project-facts';

import { undoWrites } from './action-feedback';
import { OptionalNote, ProcessLabel } from './action-panels';

/**
 * „Verknüpfen mit …“ on a collapsed subprocess selected in the model view
 * (M6 §4.8 a, S5c-1): facts v1 have no fact for it, and in exports from
 * other tools it often stands for another diagram. The reviewer picks the
 * process it means; analyzr writes an accepted manual relation from the
 * subprocess's process to it through `POST …/relations` (kind `manual`,
 * humans only), without a question, the rationale from code; „Rückgängig“
 * rejects it again. The button stays (expanded while the form is open), and
 * the focus returns to it when the form closes; render it keyed by the
 * selected element, so another element starts closed. Nothing for any other
 * element, for viewers and on the read-only demo.
 */
export default function SubprocessLink({
  project,
  modelKey,
  xml,
  elementId,
  resolve,
}: {
  project: string;
  modelKey: string;
  xml: string;
  elementId: string;
  resolve: RefResolver;
}) {
  const { canReview } = useProjectPermissions(project);
  const sub = useMemo(() => collapsedSubprocess(xml, elementId), [xml, elementId]);
  const [open, setOpen] = useState(false);
  const formId = useId();
  const button = useRef<HTMLButtonElement>(null);
  if (!canReview || !sub) return null;
  const processRef = `${modelKey}#${sub.processId}`;
  function close() {
    setOpen(false);
    requestAnimationFrame(() => {
      if (button.current?.isConnected) button.current.focus();
    });
  }
  return (
    <div
      className="mb-2 flex flex-col gap-2 rounded-lg border bg-muted/40 p-2.5"
      data-testid="subprocess-link"
    >
      <div className="flex items-start gap-2">
        <SquarePlusIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium break-words">
            Eingeklappter Teilprozess „{sub.name}“
          </span>
          <span className="text-xs text-muted-foreground">
            {`Er steht oft für ein anderes Diagramm. Verknüpfe seinen Prozess „${refName(resolve, processRef)}“ mit dem Prozess, den er meint.`}
          </span>
        </div>
      </div>
      <Button
        ref={button}
        size="sm"
        className="self-start"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={formId}
        data-testid="subprocess-link-open"
      >
        <LinkIcon data-icon="inline-start" />
        Verknüpfen mit …
      </Button>
      {open ? (
        <SubprocessLinkForm
          key={elementId}
          id={formId}
          project={project}
          processRef={processRef}
          subName={sub.name}
          resolve={resolve}
          rationale={subprocessRationale(sub, refName(resolve, processRef))}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

function SubprocessLinkForm({
  id,
  project,
  processRef,
  subName,
  resolve,
  rationale,
  onClose,
}: {
  id: string;
  project: string;
  processRef: string;
  subName: string;
  resolve: RefResolver;
  rationale: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const models = useQuery(modelsQuery(project));
  const { byModel } = useProjectFacts(project, models.data);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manual = useManualRelation(project);
  // the subprocess's name ranks the processes it likely means („Passt vermutlich“, UX4)
  const choices = useMemo(
    () => processChoices(byModel.values(), { exclude: [processRef], hints: [subName] }),
    [byModel, processRef, subName],
  );
  const modelName = (key: string) => models.data?.find((m) => m.key === key)?.name ?? key;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (picked === null || manual.isPending) return;
    setError(null);
    const trimmed = noteOpen ? note.trim() : '';
    try {
      const result = await manual.mutateAsync({
        from: processRef,
        to: picked,
        rationale: trimmed ? `${rationale}\n\n${trimmed}` : rationale,
      });
      const pair = `„${refName(resolve, processRef)}“ → „${refName(resolve, picked)}“`;
      if (result.result === 'applied' || result.result === 'reopened') {
        const relation = result.relation;
        toast({
          tone: 'success',
          title: 'Verknüpft',
          description: `Angenommene Relation ${pair} angelegt.`,
          action: {
            label: 'Rückgängig',
            altText: 'Die angelegte Relation wieder ablehnen',
            onAction: () =>
              void undoWrites(queryClient, project, {
                relations: [{ id: relation.id, version: relation.version }],
                placements: [],
              }),
          },
        });
      } else {
        toast({
          tone: 'info',
          title: 'Schon verknüpft',
          description: `Die Relation ${pair} war schon angenommen; nichts geändert.`,
        });
      }
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <form
      id={id}
      aria-label={`Teilprozess „${subName}“ verknüpfen`}
      onSubmit={(e) => void submit(e)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      className="flex flex-col gap-3"
      data-testid="subprocess-link-form"
    >
      <PickerList<ProcessChoice>
        items={choices}
        valueOf={(c) => c.ref}
        searchText={(c) => `${c.name} ${c.modelKey} ${c.ref}`}
        render={(c) => <ProcessLabel c={c} modelName={modelName(c.modelKey)} />}
        value={picked}
        onChange={setPicked}
        search={search}
        onSearch={setSearch}
        searchLabel="Prozess suchen"
        placeholder="Name oder Modell"
        label="Prozesse"
        emptyText="Das Projekt hat keinen anderen Prozess."
        testId="action-option"
        valueAttribute="ref"
        {...(choices.some((c) => c.likely) ? { sectionOf: processSection } : {})}
        autoFocus
      />
      <OptionalNote
        open={noteOpen}
        onOpen={() => setNoteOpen(true)}
        value={note}
        onChange={setNote}
        description="Steht mit in der Begründung der Relation."
      />
      {picked ? (
        <p className="text-sm" data-testid="action-preview">
          {`Legt eine angenommene Relation „${refName(resolve, processRef)}“ → „${refName(resolve, picked)}“ an.`}
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive" data-testid="action-error">
          <AlertTitle>Nicht verknüpft</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={picked === null || manual.isPending}
          data-testid="action-submit"
        >
          {manual.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <LinkIcon data-icon="inline-start" />
          )}
          Verknüpfen
        </Button>
      </div>
    </form>
  );
}

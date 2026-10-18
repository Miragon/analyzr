import type {
  AmendModelItem,
  AmendableField,
  OpenQuestion,
  OpenQuestionAction,
  OpenQuestionActionBody,
  OpenQuestionActionResult,
  TypedPair,
} from '@analyzr/client';
import { PERSONAL_DATA_HINT, personalDataWarnings } from '@analyzr/contracts/personal-data';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import {
  InfoIcon,
  LinkIcon,
  MapPinIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import { ImportHint } from '@/components/amendments/amend-form';
import { AmendEffect } from '@/components/amendments/amend-summary';
import { PICKER_SHOWN, PickerList, PickerTruncated } from '@/components/picker-list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { StepOptionLabel } from '@/components/value-chain/step-options';
import {
  amendableQuery,
  refusalLabel,
  useAmendDraft,
  useClaimedConfirm,
  useSavedToast,
} from '@/lib/amendments';
import { ApiError, errorMessage } from '@/lib/api';
import { nameWords } from '@/lib/generic-names';
import { MAX_ANSWER_CHARS, MAX_LINK_TARGETS } from '@/lib/limits';
import { personalDataHint } from '@/lib/open-question-answers';
import { useQuestionAction } from '@/lib/open-question-actions';
import {
  catchesOnly,
  chooseCopyNote,
  chooseCopyPreview,
  endpointChoices,
  endpointSection,
  linkExclusions,
  linkPreview,
  pairLabel,
  pairPreview,
  pairValue,
  placePreview,
  processChoices,
  processSection,
  refName,
  refusalText,
  subjectHints,
  type EndpointChoice,
  type ModelFacts,
  type ProcessChoice,
} from '@/lib/open-question-pickers';
import { useProjectPermissions } from '@/lib/permissions';
import { modelsQuery, valueChainQuery } from '@/lib/queries';
import { splitRef, type RefResolver } from '@/lib/refs';
import { conflictOf } from '@/lib/review';
import { useProjectFacts } from '@/lib/use-project-facts';
import { stepOptions, type StepOption } from '@/lib/value-chain';

import { useActionFeedback } from './action-feedback';

/**
 * The inline panels of an open question's actions (M6 §4.8 a, S5c-1): the
 * pickers of `link`, `place` and `choose-copy`, each naming what it will
 * write before it does. They open below the item, in the tab and in the
 * model view's section, and load with those lazy chunks only. A `decide` has
 * no panel since UX2b: it is decided where the diagrams are (owner decision
 * 26, Q4), the review screen or the chain. Since UX4 a link and the
 * amendment of the same gap share one entry („Ziel wählen …“, „Partner
 * wählen …“): after the pick, „Im Modell eintragen (statt nur zu
 * verknüpfen)“ chooses which one is sent, never both.
 */

export interface PanelProps {
  q: OpenQuestion;
  action: OpenQuestionAction;
  project: string;
  resolve: RefResolver;
  /** The `amend` the link shares its entry with (UX4), and whether it was the item's primary action. */
  amend?: { action: OpenQuestionAction; first: boolean } | undefined;
  /** The action ran (the item changed or left the list). */
  onDone: () => void;
  onCancel: () => void;
}

/** The head facts of every model, as the pickers read them, and the models' names. */
function useModelFacts(project: string): {
  facts: ModelFacts[];
  loading: boolean;
  modelName: (key: string) => string;
} {
  const models = useQuery(modelsQuery(project));
  const { byModel, loading } = useProjectFacts(project, models.data);
  return useMemo(() => {
    const names = new Map((models.data ?? []).map((m) => [m.key, m.name ?? m.key]));
    return {
      facts: [...byModel.values()],
      loading,
      modelName: (key: string) => names.get(key) ?? key,
    };
  }, [byModel, loading, models.data]);
}

const isGone = (error: unknown) =>
  error instanceof ApiError && error.status === 404 && error.problem.code === 'not-found';

/** The text of a refused action: the server's reason in German where there is one. */
function refusal(error: unknown, resolve: RefResolver): string {
  if (error instanceof ApiError && error.problem.code === 'validation-failed') {
    const text = refusalText(error.problem['reason'], error.problem.detail ?? '', resolve);
    if (text !== null) return text;
  }
  return errorMessage(error);
}

/** Escape cancels a panel; Cmd/Ctrl+Enter submits it. */
function panelKeys(onCancel: () => void) {
  return (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  };
}

/** The optional note of an action, with the personal-data warning (warns, never blocks). */
export function NoteField({
  value,
  onChange,
  description,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  description: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const hint = personalDataHint(useMemo(() => personalDataWarnings(value), [value]));
  return (
    <Field>
      <FieldLabel htmlFor={`${id}-note`}>Notiz (optional)</FieldLabel>
      <Textarea
        id={`${id}-note`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={MAX_ANSWER_CHARS}
        className="min-h-12"
        autoFocus={autoFocus}
        aria-describedby={`${id}-desc ${id}-personal`}
        data-testid="action-note"
      />
      <FieldDescription id={`${id}-desc`}>
        {description} {PERSONAL_DATA_HINT}.
      </FieldDescription>
      <p
        id={`${id}-personal`}
        role="status"
        className={cn(hint && 'flex items-start gap-1.5 text-sm text-warning')}
      >
        {hint ? (
          <>
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{hint}</span>
          </>
        ) : null}
      </p>
    </Field>
  );
}

/**
 * „+ Notiz“ (UX-SIMPLIFICATION.md §3.4 item 5): the optional note of a link,
 * a placement or the valid copy behind a link; once opened, the field with
 * its hint. Only an opened note is sent.
 */
export function OptionalNote({
  open,
  onOpen,
  ...field
}: {
  open: boolean;
  onOpen: () => void;
  value: string;
  onChange: (value: string) => void;
  description: string;
}) {
  if (open) return <NoteField {...field} autoFocus />;
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="self-start px-0"
      onClick={onOpen}
      data-testid="action-note-toggle"
    >
      <PlusIcon data-icon="inline-start" />
      Notiz
    </Button>
  );
}

/** What the action will write, said before it runs. */
function Preview({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="flex items-start gap-2 text-sm" data-testid="action-preview">
      <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-0.5">
        {lines.map((line, i) => (
          <span key={i}>{line}</span>
        ))}
      </div>
    </div>
  );
}

/** The panel's frame: the form, its error, and the buttons. */
function PanelForm({
  label,
  onSubmit,
  onCancel,
  submitLabel,
  submitIcon,
  submitVariant = 'default',
  submitDescribedBy,
  canSubmit,
  pending,
  error,
  children,
}: {
  label: string;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  submitIcon: ReactNode;
  submitVariant?: 'default' | 'destructive';
  submitDescribedBy?: string | undefined;
  canSubmit: boolean;
  pending: boolean;
  error: string | null;
  children: ReactNode;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit && !pending) onSubmit();
  }
  return (
    <form
      aria-label={label}
      onSubmit={submit}
      onKeyDown={panelKeys(onCancel)}
      className="flex min-w-0 flex-col gap-3"
      data-testid="action-form"
    >
      {children}
      {error ? (
        <Alert variant="destructive" data-testid="action-error">
          <AlertTitle>Nicht ausgeführt</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={pending}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          size="sm"
          variant={submitVariant}
          disabled={!canSubmit || pending}
          aria-describedby={submitDescribedBy}
          data-testid="action-submit"
        >
          {pending ? <Spinner data-icon="inline-start" /> : submitIcon}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * Runs the action and reports it (toast with „Rückgängig“ or the way to the
 * decision); keeps the panel open with the server's reason when refused,
 * and closes on an item that changed meanwhile.
 */
function useSubmit(props: PanelProps) {
  const { q, project, resolve, onDone } = props;
  const act = useQuestionAction(project);
  const feedback = useActionFeedback(project, resolve);
  const [error, setError] = useState<string | null>(null);
  async function submit(body: OpenQuestionActionBody, type: OpenQuestionAction['type']) {
    setError(null);
    let result: OpenQuestionActionResult;
    try {
      result = await act.mutateAsync({ questionId: q.id, body });
    } catch (e) {
      if (isGone(e)) {
        feedback.gone();
        onDone();
        return;
      }
      const conflict = conflictOf(e);
      setError(conflict ? `${conflict.title}. ${conflict.description}` : refusal(e, resolve));
      return;
    }
    feedback.done(q, type, result);
    onDone();
  }
  return { submit, pending: act.isPending, error };
}

// --------------------------------------------------------------- link

/** Said to screen readers after a ranked option's name. */
const rankText = (c: { suggested: boolean; likely: boolean }) =>
  c.suggested ? ', vorgeschlagen' : c.likely ? ', passt vermutlich' : '';

/** „Name – Modellname“ (UX4); the ref only in the tooltip (P2). */
export function ProcessLabel({ c, modelName }: { c: ProcessChoice; modelName: string }) {
  return (
    <span className="min-w-0 truncate" title={c.ref}>
      <span className="font-medium">{c.name}</span>
      <span className="text-muted-foreground"> – {modelName}</span>
      {rankText(c) ? <span className="sr-only">{rankText(c)}</span> : null}
    </span>
  );
}

function EndpointLabel({ c, modelName }: { c: EndpointChoice; modelName: string }) {
  return (
    <span className="flex min-w-0 flex-col" title={c.ref}>
      <span className="truncate font-medium">
        {c.kind === 'process' ? `Ganzer Prozess „${c.name}“` : c.name}
        {rankText(c) ? <span className="sr-only">{rankText(c)}</span> : null}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {c.kind === 'process' ? modelName : `${c.processName} – ${modelName}`}
      </span>
    </span>
  );
}

const processSearch = (c: ProcessChoice) => `${c.name} ${c.modelKey} ${c.ref}`;

/**
 * Several processes at once (`call-target-dynamic`: the possible targets,
 * at most `max`): a search field and a list of checkboxes, the suggested
 * ones first.
 */
function MultiProcessPicker({
  items,
  values,
  onChange,
  max,
  label,
  modelName,
}: {
  items: readonly ProcessChoice[];
  values: readonly string[];
  onChange: (values: string[]) => void;
  max: number;
  label: string;
  modelName: (key: string) => string;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const words = nameWords(search);
  const visible =
    words.length === 0
      ? items
      : items.filter((c) => {
          const hay = nameWords(processSearch(c)).join(' ');
          return words.every((w) => hay.includes(w));
        });
  const full = values.length >= max;
  const sectioned = items.some((c) => c.suggested || c.likely);
  return (
    <div className="flex flex-col gap-2">
      <Field>
        <FieldLabel htmlFor={`${id}-search`}>Prozesse suchen</FieldLabel>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={`${id}-search`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name oder Modell"
            className="pl-8"
            autoComplete="off"
            autoFocus
          />
        </div>
      </Field>
      {visible.length === 0 ? (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          {items.length === 0
            ? 'Das Projekt hat keinen anderen Prozess.'
            : 'Nichts passt zur Suche.'}
        </p>
      ) : (
        <ul className="max-h-64 overflow-y-auto rounded-lg border" aria-label={label}>
          {visible.slice(0, PICKER_SHOWN).map((c, i, shown) => {
            const checked = values.includes(c.ref);
            const section = processSection(c);
            return (
              <li key={c.ref}>
                {sectioned && (i === 0 || processSection(shown[i - 1]!) !== section) ? (
                  <div
                    aria-hidden
                    className="border-b bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground"
                    data-testid="picker-section"
                  >
                    {section}
                  </div>
                ) : null}
                <Label
                  htmlFor={`${id}-${c.ref}`}
                  className="flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm font-normal hover:bg-muted"
                  data-testid="action-option"
                  data-ref={c.ref}
                >
                  <Checkbox
                    id={`${id}-${c.ref}`}
                    checked={checked}
                    disabled={!checked && full}
                    onCheckedChange={(next) =>
                      onChange(
                        next === true ? [...values, c.ref] : values.filter((v) => v !== c.ref),
                      )
                    }
                  />
                  <ProcessLabel c={c} modelName={modelName(c.modelKey)} />
                </Label>
              </li>
            );
          })}
        </ul>
      )}
      <PickerTruncated total={visible.length} />
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {values.length} von höchstens {max} gewählt
      </p>
    </div>
  );
}

/** The amendment a pick makes, or why the pick can only be linked. */
type InModel = { item: AmendModelItem } | { reason: string | null };

/**
 * „Im Modell eintragen“ for the picked target (UX4): a call target the
 * landscape offers as a process, or a partner whose name the endpoint can
 * take (the name's partner pairs both); else the reason it can only be
 * linked. `null` reason while the field loads.
 */
function inModelFor(
  field: AmendableField | undefined,
  amend: OpenQuestionAction,
  picked: string | null,
): InModel {
  const target = amend.amend?.targets[0];
  if (!field || !target || picked === null) return { reason: null };
  if (!field.settable) return { reason: `${refusalLabel(field.reason)}.` };
  const replaces = field.live?.id ?? amend.amend?.replaces;
  const base = { elementId: target.elementId, op: target.op, ...(replaces ? { replaces } : {}) };
  if (target.op === 'call-target') {
    return field.suggestions.processes?.some((p) => p.ref === picked)
      ? { item: { ...base, target: picked } }
      : { reason: 'Diesen Prozess kann analyzr nicht als Aufrufziel eintragen; nur verknüpfen.' };
  }
  for (const n of field.suggestions.names ?? [])
    if (n.endpoints.some((e) => e.ref === picked && e.partner))
      return { item: { ...base, after: n.name, partner: picked } };
  return {
    reason:
      'Der gewählte Partner hat keinen Namen, den analyzr hier eintragen könnte; nur verknüpfen.',
  };
}

/**
 * `link`: a process, endpoint or pair picker (the targets a live proposal
 * names first, under „Vorgeschlagen“, then „Passt vermutlich“), „+ Notiz“,
 * and the sentence naming what it will write. With the item's `amend`
 * (UX4, owner decision 26 Q5), editors and owners choose after the pick:
 * „Im Modell eintragen (statt nur zu verknüpfen)“, checked where the
 * amendment was the item's primary action (no key or name yet). Checked,
 * only the amendment is sent (its re-derivation makes the link; the dry
 * run's effect and cost stand above „Speichern“); unchecked, only the link.
 */
export function LinkPanel(props: PanelProps) {
  const { q, action, resolve, project, onCancel, onDone } = props;
  const id = useId();
  const { facts, loading, modelName } = useModelFacts(project);
  const { canWrite } = useProjectPermissions(project);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [many, setMany] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [choice, setChoice] = useState<boolean | null>(null);
  const { submit, pending, error } = useSubmit(props);
  const multiple = action.multiple === true;
  const suggested = useMemo(() => action.suggested ?? [], [action.suggested]);
  const hints = useMemo(() => subjectHints(facts, q), [facts, q]);

  // The amendment the entry can choose instead (editors and owners: it needs `write`).
  const amend = canWrite && props.amend?.action.amend ? props.amend : undefined;
  const target = amend?.action.amend?.targets[0];
  const element = useQuery({
    ...amendableQuery(project, amend?.action.amend?.modelId ?? '', target?.elementId ?? ''),
    enabled: amend !== undefined && target !== undefined,
  });
  const field = element.data?.fields.find((f) => f.op === target?.op);
  const inModel = amend ? inModelFor(field, amend.action, picked) : { reason: null };
  const possible = 'item' in inModel;
  const checked = possible && (choice ?? amend?.first ?? false);
  const items = checked && 'item' in inModel ? [inModel.item] : null;
  const rev = element.data?.headRev ?? null;
  const request = items !== null && rev !== null ? JSON.stringify({ items, rev }) : null;
  const savedToastOf = useSavedToast(project);
  const draft = useAmendDraft({
    project,
    modelId: amend?.action.amend?.modelId ?? '',
    items,
    rev,
    onSaved: (result) => {
      savedToastOf(result, modelName(amend?.action.amend?.modelKey ?? ''));
      onDone();
    },
  });
  const confirm = useClaimedConfirm(draft.check, request);

  const processes = useMemo(
    () =>
      action.pick === 'process'
        ? processChoices(facts, { suggested, exclude: linkExclusions(facts, q, action), hints })
        : [],
    [facts, action, suggested, q, hints],
  );
  const endpoints = useMemo(
    () =>
      action.pick === 'endpoint' ? endpointChoices(facts, q.subject.id, suggested, hints) : [],
    [facts, action.pick, suggested, q.subject.id, hints],
  );
  // „Vorgeschlagen“, „Passt vermutlich“ and „Alle Prozesse“ as headings only when one is ranked.
  const sectioned = processes.some((c) => c.suggested || c.likely);
  const pairs = action.pairs ?? [];
  const pair: TypedPair | undefined =
    action.pick === 'pair' ? pairs.find((p) => pairValue(p) === picked) : undefined;

  const targets = multiple ? many : picked !== null && action.pick !== 'pair' ? [picked] : [];
  const incoming =
    (q.kind === 'message-partner-missing' ||
      q.kind === 'message-without-name' ||
      q.kind === 'external-partner') &&
    catchesOnly(facts, q.subject.id);
  const preview =
    action.pick === 'pair'
      ? pair
        ? [pairPreview(pair, resolve)]
        : []
      : linkPreview(q, action, targets, resolve, incoming);

  const canLink = action.pick === 'pair' ? pair !== undefined : targets.length > 0;
  const trimmed = noteOpen ? note.trim() : '';

  let picker: ReactNode;
  if (loading && facts.length === 0 && action.pick !== 'pair') {
    picker = <Skeleton className="h-32" />;
  } else if (action.pick === 'pair') {
    picker = (
      <PickerList
        items={pairs}
        valueOf={pairValue}
        searchText={(p) =>
          `${refName(resolve, p.from)} ${refName(resolve, p.to)} ${p.from} ${p.to}`
        }
        render={(p) => <span className="min-w-0 break-words">{pairLabel(p, resolve)}</span>}
        value={picked}
        onChange={setPicked}
        search={search}
        onSearch={setSearch}
        searchLabel="Paar suchen"
        placeholder="Bezeichnung oder Modell"
        label="Paare ohne Urteil"
        emptyText="Kein Paar mehr offen."
        testId="action-option"
        valueAttribute="pair"
        autoFocus
      />
    );
  } else if (action.pick === 'endpoint') {
    picker = (
      <PickerList
        items={endpoints}
        valueOf={(c) => c.ref}
        searchText={(c) => `${c.name} ${c.processName} ${c.modelKey} ${c.ref}`}
        render={(c) => <EndpointLabel c={c} modelName={modelName(c.modelKey)} />}
        value={picked}
        onChange={setPicked}
        search={search}
        onSearch={setSearch}
        searchLabel="Partner suchen"
        placeholder="Nachricht, Prozess oder Modell"
        label="Passende Elemente und Prozesse"
        emptyText="Kein passendes Element in anderen Prozessen."
        testId="action-option"
        valueAttribute="ref"
        sectionOf={endpointSection}
        autoFocus
      />
    );
  } else if (multiple) {
    picker = (
      <MultiProcessPicker
        items={processes}
        values={many}
        onChange={setMany}
        max={MAX_LINK_TARGETS}
        label="Mögliche Ziele"
        modelName={modelName}
      />
    );
  } else {
    picker = (
      <PickerList
        items={processes}
        valueOf={(c) => c.ref}
        searchText={processSearch}
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
        {...(sectioned ? { sectionOf: processSection } : {})}
        autoFocus
      />
    );
  }

  const effectId = `${id}-effect`;
  const claimedId = `${id}-claimed`;
  return (
    <PanelForm
      label={
        props.amend
          ? target?.op === 'call-target'
            ? 'Ziel wählen'
            : 'Partner wählen'
          : action.label
      }
      onCancel={onCancel}
      submitLabel={checked ? (confirm.armed ? 'Trotzdem speichern' : 'Speichern') : 'Verknüpfen'}
      submitIcon={
        checked ? <SaveIcon data-icon="inline-start" /> : <LinkIcon data-icon="inline-start" />
      }
      submitVariant={confirm.armed ? 'destructive' : 'default'}
      submitDescribedBy={
        checked && draft.check.phase === 'ready'
          ? confirm.claimed
            ? `${effectId} ${claimedId}`
            : effectId
          : undefined
      }
      canSubmit={checked ? draft.check.phase === 'ready' : canLink}
      pending={checked ? draft.saving || draft.check.phase === 'checking' : pending}
      error={checked ? null : error}
      onSubmit={() => {
        if (checked) {
          if (confirm.confirm()) draft.save();
          return;
        }
        void submit(
          action.pick === 'pair' && pair
            ? {
                type: 'link',
                pair: { from: pair.from, to: pair.to },
                ...(trimmed ? { note: trimmed } : {}),
              }
            : { type: 'link', targets, ...(trimmed ? { note: trimmed } : {}) },
          'link',
        );
      }}
    >
      {picker}
      {amend && picked !== null ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-start gap-2">
            <Checkbox
              id={`${id}-in-model`}
              checked={checked}
              disabled={!possible}
              onCheckedChange={(next) => setChoice(next === true)}
              data-testid="action-in-model"
            />
            <Label htmlFor={`${id}-in-model`} className="text-sm leading-snug font-normal">
              Im Modell eintragen (statt nur zu verknüpfen)
            </Label>
          </div>
          {!possible && inModel.reason ? (
            <p className="pl-6 text-xs text-muted-foreground" data-testid="action-in-model-reason">
              {inModel.reason}
            </p>
          ) : null}
        </div>
      ) : null}
      {checked ? (
        <>
          <AmendEffect
            project={project}
            check={draft.check}
            pending={items?.map((item) => ({ item, label: q.subjectLabel, display: '' })) ?? []}
            effectId={effectId}
            claimedId={claimedId}
          />
          <ImportHint />
        </>
      ) : (
        <>
          <OptionalNote
            open={noteOpen}
            onOpen={() => setNoteOpen(true)}
            value={note}
            onChange={setNote}
            description="Steht mit in der Begründung der Relation."
          />
          <Preview lines={preview} />
        </>
      )}
    </PanelForm>
  );
}

// --------------------------------------------------------------- place

/**
 * `place`: the step picker over the live chain (with „außerhalb der
 * Kette“) for a process, or the process picker for a step; a manual
 * placement, accepted at once.
 */
export function PlacePanel(props: PanelProps) {
  const { q, action, resolve, project, onCancel } = props;
  const chain = useQuery({
    ...valueChainQuery(project),
    enabled: action.pick === 'step' || q.subject.type === 'step',
  });
  const { facts, loading, modelName } = useModelFacts(project);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const { submit, pending, error } = useSubmit(props);
  const trimmed = noteOpen ? note.trim() : '';
  const steps = useMemo(
    () => (chain.data ? stepOptions(chain.data.steps, { outside: true }) : []),
    [chain.data],
  );
  const processes = useMemo(
    () => (action.pick === 'process' ? processChoices(facts) : []),
    [facts, action.pick],
  );

  const forStep = q.subject.type === 'step';
  const stepId = forStep ? q.subject.id : picked;
  const processRef = forStep ? picked : q.subject.id;
  const stepName = forStep
    ? (chain.data?.steps.find((s) => s.elementId === q.subject.id)?.name ?? q.subject.id)
    : (steps.find((s) => s.elementId === picked)?.name ?? '');
  const preview =
    stepId !== null && processRef !== null
      ? [placePreview(refName(resolve, processRef), stepName, stepId)]
      : [];

  let picker: ReactNode;
  if (forStep) {
    picker =
      loading && facts.length === 0 ? (
        <Skeleton className="h-32" />
      ) : (
        <PickerList
          items={processes}
          valueOf={(c) => c.ref}
          searchText={processSearch}
          render={(c) => <ProcessLabel c={c} modelName={modelName(c.modelKey)} />}
          value={picked}
          onChange={setPicked}
          search={search}
          onSearch={setSearch}
          searchLabel={`Prozess für „${stepName}“ suchen`}
          placeholder="Name oder Modell"
          label="Prozesse"
          emptyText="Das Projekt hat noch keinen Prozess."
          testId="action-option"
          valueAttribute="ref"
          autoFocus
        />
      );
  } else if (chain.isPending) {
    picker = <Skeleton className="h-32" />;
  } else if (chain.isError) {
    picker = (
      <p className="text-sm text-destructive">
        Die Wertschöpfungskette konnte nicht geladen werden: {errorMessage(chain.error)}
      </p>
    );
  } else {
    picker = (
      <PickerList<StepOption>
        items={steps}
        valueOf={(s) => s.elementId}
        searchText={(s) => `${s.name} ${s.path} ${s.elementId}`}
        render={(s) => <StepOptionLabel option={s} />}
        value={picked}
        onChange={setPicked}
        search={search}
        onSearch={setSearch}
        searchLabel={`Schritt für „${refName(resolve, q.subject.id)}“ suchen`}
        placeholder="Name oder Pfad"
        label="Schritte"
        emptyText="Die Kette hat noch keinen Schritt."
        testId="action-option"
        valueAttribute="step"
        autoFocus
      />
    );
  }

  return (
    <PanelForm
      label={action.label}
      onCancel={onCancel}
      submitLabel={forStep ? 'Zuordnen' : 'Platzieren'}
      submitIcon={<MapPinIcon data-icon="inline-start" />}
      canSubmit={stepId !== null && processRef !== null}
      pending={pending}
      error={error}
      onSubmit={() => {
        if (stepId === null || processRef === null) return;
        void submit(
          {
            type: 'place',
            step: stepId,
            ...(forStep ? { process: processRef } : {}),
            ...(trimmed ? { note: trimmed } : {}),
          },
          'place',
        );
      }}
    >
      {picker}
      <OptionalNote
        open={noteOpen}
        onOpen={() => setNoteOpen(true)}
        value={note}
        onChange={setNote}
        description="Steht mit in der Begründung der Platzierung."
      />
      <Preview lines={preview} />
    </PanelForm>
  );
}

// --------------------------------------------------------------- choose-copy

/**
 * `choose-copy`: the valid copy of a duplicated process id; the calls
 * towards the copies are accepted towards it and rejected towards the
 * others, all or nothing. With the value chain, the other copies not yet on
 * a step go to „außerhalb“ (checked by default). The copies by their model's
 * path (UX4), the shared process id behind „Technische Angaben“; „+ Notiz“
 * opens the note prefilled with the valid copy, a note on the item. No
 * „Rückgängig“: the decisions are changed in the review.
 */
export function ChooseCopyPanel(props: PanelProps) {
  const { q, action, resolve, project, onCancel } = props;
  const id = useId();
  const chain = useQuery(valueChainQuery(project));
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [edited, setEdited] = useState(false);
  const [outside, setOutside] = useState(true);
  const { submit, pending, error } = useSubmit(props);
  const copies = action.choices ?? [];
  const calls = action.decides ?? [];
  const hasChain = chain.isSuccess;
  const processIds = [...new Set(copies.map((ref) => splitRef(ref).elementId))];

  return (
    <PanelForm
      label={action.label}
      onCancel={onCancel}
      submitLabel="Kopie bestätigen"
      submitIcon={<LinkIcon data-icon="inline-start" />}
      canSubmit={picked !== null && calls.length > 0}
      pending={pending}
      error={error}
      onSubmit={() => {
        if (picked === null) return;
        const trimmed = noteOpen ? note.trim() : '';
        void submit(
          {
            type: 'choose-copy',
            process: picked,
            items: calls.map((c) => ({ id: c.id, version: c.version })),
            placeOthersOutside: hasChain && outside,
            ...(trimmed ? { note: trimmed } : {}),
          },
          'choose-copy',
        );
      }}
    >
      <PickerList
        items={copies}
        valueOf={(ref) => ref}
        searchText={(ref) => `${splitRef(ref).modelKey} ${refName(resolve, ref)}`}
        render={(ref) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{splitRef(ref).modelKey}</span>
            <span className="truncate text-xs text-muted-foreground">{refName(resolve, ref)}</span>
          </span>
        )}
        value={picked}
        onChange={(ref) => {
          setPicked(ref);
          if (!edited) setNote(chooseCopyNote(resolve, ref));
        }}
        search=""
        onSearch={() => undefined}
        searchLabel="Kopie"
        placeholder=""
        label={`Kopien von ${q.subjectLabel}`}
        emptyText="Keine Kopie gefunden."
        testId="action-option"
        valueAttribute="ref"
        searchable={false}
      />
      {processIds.length > 0 ? (
        <details className="text-xs text-muted-foreground" data-testid="action-copy-technical">
          <summary className="cursor-pointer hover:text-foreground">Technische Angaben</summary>
          <p className="mt-1">
            Prozess-ID in jeder Kopie:{' '}
            <span className="font-mono break-all">{processIds.join(', ')}</span>
          </p>
        </details>
      ) : null}
      {hasChain ? (
        <div className="flex items-start gap-2">
          <Checkbox
            id={`${id}-outside`}
            checked={outside}
            onCheckedChange={(next) => setOutside(next === true)}
            data-testid="action-copy-outside"
          />
          <Label htmlFor={`${id}-outside`} className="text-sm leading-snug font-normal">
            Andere Kopien in der Wertschöpfungskette auf „außerhalb“ setzen
          </Label>
        </div>
      ) : null}
      <OptionalNote
        open={noteOpen}
        onOpen={() => setNoteOpen(true)}
        value={note}
        onChange={(value) => {
          setNote(value);
          setEdited(true);
        }}
        description="Wird als Notiz an der Frage gespeichert."
      />
      <Preview lines={picked ? [chooseCopyPreview(calls.length, refName(resolve, picked))] : []} />
    </PanelForm>
  );
}

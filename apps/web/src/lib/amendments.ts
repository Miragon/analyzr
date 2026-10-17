import {
  amendModel,
  exportAmendments,
  getAmendable,
  getRevisionContent,
  listRevisions,
  withdrawAmendment,
  withdrawModelAmendments,
  type AmendModelItem,
  type AmendModelItemResult,
  type AmendModelResult,
  type AmendableElement,
  type AmendmentExportFormat,
  type AmendmentOp,
  type ModelAmendment,
  type Revision,
  type RevisionSource,
  type WithdrawAmendmentsResult,
} from '@analyzr/client';
import {
  AMENDMENT_CONFLICT_LABELS,
  AMENDMENT_FIELD_LABELS,
  AMENDMENT_MODEL_DELETED_LABEL,
  AMENDMENT_REFUSAL_LABELS,
  AMENDMENT_STATE_LABELS,
} from '@analyzr/contracts/amendment-labels';
import { personalDataList } from '@analyzr/contracts/personal-data';
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ApiError, api, errorMessage, unwrap, unwrapWithResponse } from './api';
import { downloadBlob } from './download';
import { keys } from './queries';

/**
 * Model amendments in the web (M6 §4.8 c, decision 25, slice S5c-2): the
 * amendable fields of an element, the dry run and the save with `If-Match`,
 * the sentence naming the effect and the cost before every save, the values
 * normalized as the server stores them, „Sammeln“ (amendments kept in the
 * page per model until one save), withdrawals, the head's plan for the
 * badge and the overlays, both BPMN downloads and the change list. Loaded
 * with the tab's page and the model view's lazy section only, never with the
 * entry (the bundle guard, decision 21).
 */

// ------------------------------------------------------------------ limits

/** Most amendments one request records (`MAX_AMENDMENT_ITEMS` in the contracts). */
export const MAX_AMENDMENT_ITEMS = 20;

/**
 * The fact limit of each field (`@analyzr/bpmn-facts` `sanitize.ts`):
 * `MAX_KEY_LENGTH` for call targets and names, `MAX_LABEL_LENGTH` for start
 * and end names, `MAX_DOCUMENTATION_LENGTH` for documentation. Longer values
 * are refused, never cut.
 */
export const AMENDMENT_VALUE_LIMITS: Readonly<Record<AmendmentOp, number>> = {
  'call-target': 1000,
  'message-name': 1000,
  'event-name': 200,
  'process-documentation': 2000,
};

/** The hint every amend form shows (M6 §4.8 c "Web"). */
export const AMEND_HINT =
  'Der nächste Import aus dem Quellsystem behält die Ergänzung, solange das Feld dort unverändert ist.';

/** The warning before a save that cancels a claimed relations task (M6 §4.8 c). */
export const CLAIMED_WARNING =
  'Ein Agent bearbeitet dieses Modell gerade; seine Arbeit geht verloren.';

/**
 * The personal-data hint under names and documentation: „Personennamen“,
 * since the field itself asks for a name (of a message, an event).
 */
export const AMEND_PERSONAL_DATA_HINT = 'Keine Personennamen oder anderen personenbezogenen Daten';

/** Why „Sammeln“ helps, shown where the human decides (not only as a tooltip). */
export const COLLECT_HINT =
  'Mehrere Ergänzungen an diesem Modell? „Sammeln“ und zusammen speichern – dann wird nur einmal neu beurteilt.';

/** Why a field no question names cannot be set, and where it is changed instead. */
export const ONLY_OPEN_QUESTIONS_TEXT =
  'Diesen Wert änderst du im Quellsystem; ergänzen lässt sich nur, wonach eine offene Frage fragt oder was leer ist.';

// ------------------------------------------------------------- normalizing

const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
const CONTROL = /\p{Cc}/gu;
const CONTROL_EXCEPT_NEWLINE = /[^\P{Cc}\n]/gu;
/** Characters XML 1.0 cannot carry (with `u`, a lone surrogate is one code point). */
const NOT_XML_CHAR = /[\uD800-\uDFFF\uFFFE\uFFFF]/u;

/** Whether a value is an expression in either dialect (`=…`, `${…}`, `#{…}`). */
export function isExpression(value: string): boolean {
  return /^\s*=/.test(value) || value.includes('${') || value.includes('#{');
}

export type NormalizedValue =
  | { ok: true; value: string }
  | { ok: false; problem: 'empty' | 'too-long' | 'expression' | 'invalid-character' };

/**
 * The value as the server stores it (`normalizeAmendmentValue` in
 * `@analyzr/bpmn-facts`): one line for targets and names (every whitespace
 * run one space), documentation with its line breaks (at most one empty line
 * in a row), control and bidi characters removed, trimmed; refused when
 * empty, longer than the field's limit, an expression (targets and names) or
 * holding a character XML cannot carry. The dry run says the last word.
 */
export function normalizeAmendmentValue(op: AmendmentOp, raw: string): NormalizedValue {
  const text =
    op === 'process-documentation'
      ? raw
          .replace(/\r\n?/g, '\n')
          .replace(/[^\S\n]+/gu, ' ')
          .replace(CONTROL_EXCEPT_NEWLINE, '')
          .replace(BIDI, '')
          .replace(/ {2,}/g, ' ')
          .replace(/ ?\n ?/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      : raw
          .replace(/\s+/gu, ' ')
          .replace(CONTROL, '')
          .replace(BIDI, '')
          .replace(/ {2,}/g, ' ')
          .trim();
  if (NOT_XML_CHAR.test(text)) return { ok: false, problem: 'invalid-character' };
  if (text.length > AMENDMENT_VALUE_LIMITS[op]) return { ok: false, problem: 'too-long' };
  if (text === '') return { ok: false, problem: 'empty' };
  if ((op === 'call-target' || op === 'message-name') && isExpression(text))
    return { ok: false, problem: 'expression' };
  return { ok: true, value: text };
}

/** The German text of a value the form refuses before sending. */
export function valueProblemText(
  op: AmendmentOp,
  problem: Extract<NormalizedValue, { ok: false }>['problem'],
): string {
  switch (problem) {
    case 'empty':
      return 'Trag einen Wert ein.';
    case 'too-long':
      return `Höchstens ${AMENDMENT_VALUE_LIMITS[op].toLocaleString('de-DE')} Zeichen.`;
    case 'expression':
      return 'Ein Ausdruck wie „=…“, „${…}“ oder „#{…}“ wird erst zur Laufzeit ausgewertet; trag einen festen Namen ein.';
    case 'invalid-character':
      return 'Der Wert enthält ein Zeichen, das BPMN nicht speichern kann.';
  }
}

// ------------------------------------------------------------------ labels

const quote = (text: string) => `„${text}“`;

/** A value as the form and the history show it: „…“, or „leer“ for none. */
export function valueText(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'leer' : quote(value);
}

/** The German field label of an op. */
export const fieldLabel = (op: AmendmentOp): string => AMENDMENT_FIELD_LABELS[op];

/** Why a field cannot be set, in German. */
export function refusalLabel(reason: AmendModelItemResult['reason'] | null | undefined): string {
  return reason ? AMENDMENT_REFUSAL_LABELS[reason] : 'Nicht ergänzbar';
}

/** Whether an amendment is live (its outcome on the head), not withdrawn or superseded. */
export const isLive = (a: Pick<ModelAmendment, 'state'>): boolean =>
  a.state === 'applied' || a.state === 'in-source' || a.state === 'conflict';

/** The state of an amendment in German, with the conflict's reason and „Modell gelöscht“. */
export function stateText(a: Pick<ModelAmendment, 'state' | 'conflict' | 'modelDeleted'>): string {
  const base = AMENDMENT_STATE_LABELS[a.state];
  const reason =
    a.state === 'conflict' && a.conflict ? `: ${AMENDMENT_CONFLICT_LABELS[a.conflict]}` : '';
  return `${base}${reason}${a.modelDeleted ? ` · ${AMENDMENT_MODEL_DELETED_LABEL}` : ''}`;
}

/** The tone of an amendment's state badge. */
export function stateTone(
  a: Pick<ModelAmendment, 'state'>,
): 'success' | 'info' | 'warning' | 'neutral' {
  switch (a.state) {
    case 'applied':
      return 'success';
    case 'in-source':
      return 'info';
    case 'conflict':
      return 'warning';
    default:
      return 'neutral';
  }
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/**
 * What a save will set off, said before it (M6 §4.8 c "Web"): „Danach: 1
 * Aufruf angenommen, 1 Befund erledigt, 214 Paare werden neu beurteilt.“,
 * from the dry run's effect and cost.
 */
export function effectSentence(result: Pick<AmendModelResult, 'effect' | 'cost'>): string {
  const { effect, cost } = result;
  const calls = effect.accepted.filter((r) => r.type === 'call').length;
  const otherAccepted = effect.accepted.length - calls;
  const parts = [
    calls > 0 ? `${count(calls, 'Aufruf', 'Aufrufe')} angenommen` : null,
    otherAccepted > 0 ? `${count(otherAccepted, 'Relation', 'Relationen')} angenommen` : null,
    effect.partnerAccepted.length > 0
      ? `${count(effect.partnerAccepted.length, 'Vorschlag', 'Vorschläge')} zum gewählten Partner angenommen`
      : null,
    effect.proposed.length > 0
      ? `${count(effect.proposed.length, 'neuer Vorschlag', 'neue Vorschläge')} zum Prüfen`
      : null,
    effect.findingsResolved.length > 0
      ? `${count(effect.findingsResolved.length, 'Befund', 'Befunde')} erledigt`
      : null,
    effect.findingsAdded.length > 0
      ? count(effect.findingsAdded.length, 'neuer Befund', 'neue Befunde')
      : null,
    effect.withdrawn.length > 0
      ? effect.withdrawn.length === 1
        ? '1 Relation entfällt'
        : `${effect.withdrawn.length} Relationen entfallen`
      : null,
    effect.changed.length > 0
      ? effect.changed.length === 1
        ? '1 angenommene Relation muss neu bestätigt werden'
        : `${effect.changed.length} angenommene Relationen müssen neu bestätigt werden`
      : null,
    effect.retired.length > 0
      ? `${count(effect.retired.length, 'manuelle Verknüpfung', 'manuelle Verknüpfungen')} durch die Ergänzung ersetzt`
      : null,
    pairsText(cost),
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? 'Danach: sonst ändert sich nichts.' : `Danach: ${parts.join(', ')}.`;
}

/**
 * The cost part of a sentence: the pairs the agents judge again, said with
 * what a pair is („mögliche Verbindungen zu anderen Modellen“); `null`
 * without.
 */
function pairsText(cost: Pick<AmendModelResult['cost'], 'factsChange' | 'pairsToRejudge'>) {
  if (!cost.factsChange || cost.pairsToRejudge <= 0) return null;
  return cost.pairsToRejudge === 1
    ? '1 Paar (eine mögliche Verbindung zu einem anderen Modell) wird von den Agenten neu beurteilt'
    : `${cost.pairsToRejudge.toLocaleString('de-DE')} Paare (mögliche Verbindungen zu anderen Modellen) werden von den Agenten neu beurteilt`;
}

/**
 * What a withdrawal sets off, said before it: a new revision without the
 * amendments, and the cost from the withdrawal's dry run.
 */
export function withdrawEffectSentence(
  result: Pick<WithdrawAmendmentsResult, 'cost' | 'model'>,
  count: number,
): string {
  if (result.model === null) {
    return 'Das Modell ist gelöscht: Die Ergänzung wird nur als zurückgenommen vermerkt, ohne neue Revision.';
  }
  const what =
    count === 1
      ? 'Das Modell bekommt eine neue Revision ohne diese Ergänzung'
      : `Das Modell bekommt eine neue Revision ohne diese ${count} Ergänzungen`;
  const pairs = result.cost ? pairsText(result.cost) : null;
  return pairs === null ? `${what}; sonst ändert sich nichts.` : `${what}; danach: ${pairs}.`;
}

/** What the personal-data check found in a stored value, said after the dry run; `null` without. */
export function itemWarning(item: Pick<AmendModelItemResult, 'warnings'>): string | null {
  const list = personalDataList(item.warnings ?? []);
  return list === null ? null : `Enthält vermutlich ${list}. ${AMEND_PERSONAL_DATA_HINT}.`;
}

// ------------------------------------------------------------- the plan

/** The live amendments a head's plan lists, by outcome. */
export interface PlanCounts {
  applied: number;
  inSource: number;
  conflicts: number;
}

export function planCounts(source: RevisionSource | null | undefined): PlanCounts {
  const plan = source?.amendments ?? [];
  return {
    applied: plan.filter((e) => e.outcome === 'applied').length,
    inSource: plan.filter((e) => e.outcome === 'in-source').length,
    conflicts: plan.filter((e) => e.outcome === 'conflict').length,
  };
}

/**
 * The elements whose field the head's applied amendments wrote (a call, an
 * event, a process, a message or signal, an endpoint without a reference):
 * the canvas marks them „ergänzt“, resolving a message or signal to the
 * shapes that reference it.
 */
export function amendedElements(source: RevisionSource | null | undefined): string[] {
  return [
    ...new Set(
      (source?.amendments ?? []).filter((e) => e.outcome === 'applied').map((e) => e.elementId),
    ),
  ];
}

/** How a revision came to be, in German: „hochgeladen“, „importiert“, „in analyzr ergänzt (aus r3)“. */
export function revisionOrigin(revision: Pick<Revision, 'source'>): string {
  const { source } = revision;
  switch (source.kind) {
    case 'amendment':
      return source.upstream
        ? `in analyzr ergänzt (aus r${source.upstream.rev})`
        : 'in analyzr ergänzt';
    case 'import':
      return 'importiert';
    case 'seed':
      return 'geladen (Seed)';
    default:
      return 'hochgeladen';
  }
}

// ------------------------------------------------------------------ queries

/** The amendable fields of one element and its history; `ETag` = the head the form saves on. */
export const amendableQuery = (project: string, modelId: string, elementId: string) =>
  queryOptions({
    queryKey: [...keys.project(project), 'amendable', modelId, elementId] as const,
    queryFn: (): Promise<AmendableElement> =>
      unwrap(getAmendable({ client: api, path: { project, model: modelId, elementId } })),
    staleTime: 0,
    retry: false,
  });

/** The newest revisions of a model (newest first): the head's plan and provenance, the history. */
export const modelRevisionsQuery = (project: string, modelId: string) =>
  queryOptions({
    queryKey: [...keys.project(project), 'model-revisions', modelId] as const,
    queryFn: async (): Promise<Revision[]> =>
      (
        await unwrap(
          listRevisions({ client: api, path: { project, model: modelId }, query: { limit: 20 } }),
        )
      ).items,
  });

/** A 404 `not-found`: a deleted model, or an element without a fact or field. */
export const isNotFound = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 404;

// ------------------------------------------------------------- saving

/** One amendment the form or the collection sends, with what the summary shows. */
export interface PendingAmendment {
  item: AmendModelItem;
  /** German, e.g. „Aufrufaktivität „Rechnung stellen““. */
  label: string;
  /** The value as typed or picked, shown before the dry run normalizes it (a process by its name). */
  display: string;
  /** The field's German name, a name by its family („Nachrichtenname“); else by its op. */
  field?: string;
}

/** The state of a save: dry run, its summary, the save, and what can go wrong. */
export type AmendSaveState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'confirm'; dry: AmendModelResult; rev: number }
  | { phase: 'saving'; dry: AmendModelResult; rev: number }
  /** An item is not applicable (the dry run's items, or a refused save's). */
  | { phase: 'refused'; items: AmendModelItemResult[] }
  /** 412 `revision-conflict`: the model changed since the form was read. */
  | { phase: 'conflict'; headRev: number | null }
  | { phase: 'error'; message: string };

const precondition = (rev: number) => ({ 'if-match': `"r${rev}"` });

/** The items of a refused save (422 `amendment-not-applicable`), else `null`. */
function refusedItems(error: unknown): AmendModelItemResult[] | null {
  if (!(error instanceof ApiError) || error.problem.code !== 'validation-failed') return null;
  const problem = error.problem as Record<string, unknown>;
  return problem['reason'] === 'amendment-not-applicable' && Array.isArray(problem['items'])
    ? (problem['items'] as AmendModelItemResult[])
    : null;
}

/** What a refused dry run or save means for the state machine. */
export function stateOfAmendError(error: unknown): AmendSaveState {
  if (error instanceof ApiError && error.status === 412) {
    const headRev = (error.problem as Record<string, unknown>)['headRev'];
    return { phase: 'conflict', headRev: typeof headRev === 'number' ? headRev : null };
  }
  const items = refusedItems(error);
  if (items) return { phase: 'refused', items };
  if (error instanceof ApiError && error.status === 409) {
    return {
      phase: 'error',
      message:
        'Inzwischen gilt an diesem Feld eine andere Ergänzung. Lade die Werte neu und prüf sie noch einmal.',
    };
  }
  if (isNotFound(error)) {
    return { phase: 'error', message: 'Das Modell gibt es nicht mehr (gelöscht).' };
  }
  return { phase: 'error', message: errorMessage(error) };
}

/** Refreshes everything of the project: the new head, its facts, relations and questions. */
function invalidateProject(queryClient: QueryClient, project: string) {
  return queryClient.invalidateQueries({ queryKey: keys.project(project) });
}

/**
 * Saving amendments of one model (M6 §4.8 c): `check` runs the dry run with
 * `If-Match: "r<rev>"` and shows its summary (the effect, the cost, each
 * value as it will be stored), `confirm` saves with the same precondition;
 * nothing is written before the human confirmed the summary. A dry run whose
 * items are all identical to their live amendments ends at once.
 */
export function useAmendSave({
  project,
  modelId,
  onSaved,
  onUnchanged,
}: {
  project: string;
  modelId: string;
  onSaved: (result: AmendModelResult) => void;
  onUnchanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AmendSaveState>({ phase: 'idle' });
  const items = useRef<AmendModelItem[]>([]);
  const latest = useRef({ onSaved, onUnchanged });
  useEffect(() => {
    latest.current = { onSaved, onUnchanged };
  });

  async function post(body: AmendModelItem[], rev: number, dryRun: boolean) {
    return unwrap(
      amendModel({
        client: api,
        path: { project, model: modelId },
        query: { dryRun: dryRun ? 'true' : 'false' },
        headers: precondition(rev),
        body: { items: body },
      }),
    );
  }

  async function check(next: readonly AmendModelItem[], rev: number) {
    items.current = [...next];
    setState({ phase: 'checking' });
    let dry: AmendModelResult;
    try {
      dry = await post(items.current, rev, true);
    } catch (error) {
      setState(stateOfAmendError(error));
      return;
    }
    if (dry.items.some((i) => i.outcome === 'not-applicable')) {
      setState({ phase: 'refused', items: dry.items });
      return;
    }
    if (dry.outcome === 'unchanged') {
      setState({ phase: 'idle' });
      latest.current.onUnchanged?.();
      return;
    }
    setState({ phase: 'confirm', dry, rev });
  }

  async function confirm() {
    if (state.phase !== 'confirm') return;
    const { dry, rev } = state;
    setState({ phase: 'saving', dry, rev });
    try {
      const saved = await post(items.current, rev, false);
      setState({ phase: 'idle' });
      await invalidateProject(queryClient, project);
      latest.current.onSaved(saved);
    } catch (error) {
      setState(stateOfAmendError(error));
      void invalidateProject(queryClient, project);
    }
  }

  return {
    state,
    check: (next: readonly AmendModelItem[], rev: number) => void check(next, rev),
    confirm: () => void confirm(),
    reset: () => setState({ phase: 'idle' }),
    busy: state.phase === 'checking' || state.phase === 'saving',
  };
}

/** The toast after a save: the new head and what it set off. */
export function savedToast(
  result: AmendModelResult,
  modelName: string,
): {
  tone: 'success' | 'info';
  title: string;
  description: string;
} {
  if (result.outcome === 'unchanged')
    return {
      tone: 'info',
      title: 'Schon so ergänzt',
      description: 'Die Werte stehen schon so im Modell; nichts geändert.',
    };
  const recorded = result.items.filter((i) => i.outcome === 'recorded').length;
  return {
    tone: 'success',
    title: recorded === 1 ? 'Ergänzung gespeichert' : `${recorded} Ergänzungen gespeichert`,
    description: `${quote(modelName)} ist jetzt r${result.model.headRev}. ${effectSentence(result)}`,
  };
}

// ------------------------------------------------------------- withdrawing

/** What a withdrawal ends: one amendment, or every live one of a model. */
export type WithdrawTarget = { amendment: string } | { modelId: string };

/**
 * A withdrawal (humans only, `review` and `write`): with `dryRun` it writes
 * nothing and answers the cost; with `rev` it sends `If-Match: "r<rev>"`,
 * the head the human saw in the dry run, so an amendment recorded since is
 * never withdrawn unseen (412).
 */
export function postWithdrawal(
  project: string,
  target: WithdrawTarget,
  options: { dryRun?: boolean; rev?: number } = {},
): Promise<WithdrawAmendmentsResult> {
  const query = { dryRun: options.dryRun ? ('true' as const) : ('false' as const) };
  const headers = options.rev === undefined ? undefined : precondition(options.rev);
  return 'amendment' in target
    ? unwrap(
        withdrawAmendment({
          client: api,
          path: { project, amendment: target.amendment },
          query,
          ...(headers ? { headers } : {}),
        }),
      )
    : unwrap(
        withdrawModelAmendments({
          client: api,
          path: { project, model: target.modelId },
          query,
          ...(headers ? { headers } : {}),
        }),
      );
}

/** The withdrawal itself, after its dry run was shown: refreshes the project afterwards. */
export function useWithdraw(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ target, rev }: { target: WithdrawTarget; rev?: number }) =>
      postWithdrawal(project, target, rev === undefined ? {} : { rev }),
    onSettled: () => invalidateProject(queryClient, project),
  });
}

/** The head a 412 names, else `null` (a withdrawal's or a save's). */
export function conflictHeadRev(error: unknown): number | null | undefined {
  if (!(error instanceof ApiError) || error.status !== 412) return undefined;
  const headRev = (error.problem as Record<string, unknown>)['headRev'];
  return typeof headRev === 'number' ? headRev : null;
}

/** The toast after a withdrawal. */
export function withdrawnToast(
  result: WithdrawAmendmentsResult,
  title = 'Ergänzung zurückgenommen',
): { tone: 'success' | 'info'; title: string; description: string } {
  if (result.result === 'unchanged')
    return {
      tone: 'info',
      title: 'Schon zurückgenommen',
      description: 'Die Ergänzung galt schon nicht mehr; nichts geändert.',
    };
  return {
    tone: 'success',
    title,
    description: result.revision
      ? `Das Modell ist jetzt r${result.revision.rev}, ohne diese Ergänzung.`
      : 'Das Modell ist gelöscht; die Ergänzung ist zurückgenommen.',
  };
}

// ------------------------------------------------------------- downloads

/** The file name of a Content-Disposition header, else `fallback`. */
export function attachmentName(header: string | null, fallback: string): string {
  const match = header === null ? null : /filename="([^"]+)"/i.exec(header);
  return match?.[1] ?? fallback;
}

/** The file name of a model's BPMN download: the key with `-` for `/`, `-original-r3` for the uploaded one. */
export function bpmnFileName(modelKey: string, original?: { rev: number }): string {
  const base = modelKey.replaceAll('/', '-');
  return original ? `${base}-original-r${original.rev}.bpmn` : `${base}.bpmn`;
}

function blobOf(data: unknown, response: Response, type: string): Blob {
  if (data instanceof Blob) return data;
  return new Blob([String(data)], { type: response.headers.get('content-type') ?? type });
}

/** A revision's bytes as a download, byte for byte (`getRevisionContent`). */
export async function downloadRevision(
  project: string,
  modelId: string,
  revisionId: string,
  filename: string,
): Promise<void> {
  const { data, response } = await unwrapWithResponse(
    getRevisionContent({
      client: api,
      path: { project, model: modelId, revision: revisionId },
      parseAs: 'blob',
    }),
  );
  downloadBlob(filename, blobOf(data, response, 'application/xml'));
}

/** The change list for the source tool (Markdown or CSV), for the project or one model. */
export async function downloadChangeList(
  project: string,
  format: AmendmentExportFormat,
  modelKey?: string,
): Promise<void> {
  const { data, response } = await unwrapWithResponse(
    exportAmendments({
      client: api,
      path: { project },
      query: { format, ...(modelKey ? { modelKey } : {}) },
      parseAs: 'blob',
    }),
  );
  downloadBlob(
    attachmentName(
      response.headers.get('content-disposition'),
      `ergaenzungen-${project}.${format === 'csv' ? 'csv' : 'md'}`,
    ),
    blobOf(data, response, format === 'csv' ? 'text/csv' : 'text/markdown'),
  );
}

// ------------------------------------------------------------- „Sammeln“

/** An amendment kept in the page until its model's collection is saved. */
export interface CollectedAmendment extends PendingAmendment {
  /** The project (the collection lives in the page, across projects). */
  project: string;
  modelId: string;
  modelKey: string;
  /** The model's name for the bar, else its key. */
  modelName: string;
  /** The head the form was read at (`If-Match` of the collection's save). */
  rev: number;
  /** The question it was collected at, if any (the item says „gesammelt“). */
  questionId?: string;
}

/** The key of a collected amendment within its model: one per element and op. */
export const collectedKey = (item: Pick<AmendModelItem, 'op' | 'elementId'>) =>
  `${item.op}\u0000${item.elementId}`;

let collected: readonly CollectedAmendment[] = [];
const collectListeners = new Set<() => void>();

function emitCollected(next: readonly CollectedAmendment[]) {
  collected = next;
  for (const listener of collectListeners) listener();
}

/**
 * Keeps amendments in the page (M6 §4.8 c "Web", „Sammeln“): a later one of
 * the same model, element and op replaces the earlier; at most
 * {@link MAX_AMENDMENT_ITEMS} per model (one request). Returns how many the
 * model's collection holds, or `null` when it would hold too many.
 */
export function collectAmendments(add: readonly CollectedAmendment[]): number | null {
  const next = [...collected];
  for (const a of add) {
    const at = next.findIndex(
      (c) => c.modelId === a.modelId && collectedKey(c.item) === collectedKey(a.item),
    );
    if (at >= 0) next[at] = a;
    else next.push(a);
  }
  const modelIds = new Set(add.map((a) => a.modelId));
  for (const id of modelIds) {
    if (next.filter((c) => c.modelId === id).length > MAX_AMENDMENT_ITEMS) return null;
  }
  emitCollected(next);
  return next.filter((c) => modelIds.has(c.modelId)).length;
}

/** Drops one collected amendment, or every one of a model. */
export function discardCollected(modelId: string, key?: string): void {
  emitCollected(
    collected.filter(
      (c) => c.modelId !== modelId || (key !== undefined && collectedKey(c.item) !== key),
    ),
  );
}

/** For tests: an empty collection. */
export function resetCollected(): void {
  emitCollected([]);
}

function subscribeCollected(listener: () => void) {
  collectListeners.add(listener);
  return () => collectListeners.delete(listener);
}
const getCollected = () => collected;

/** Every collected amendment, in the order collected. */
export function useCollected(): readonly CollectedAmendment[] {
  return useSyncExternalStore(subscribeCollected, getCollected, getCollected);
}

/**
 * Asks before the page is left (reload, closed tab) while amendments are
 * collected: the collection lives in the page only.
 */
export function useCollectedLeaveGuard(): void {
  const pending = useCollected().length > 0;
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);
}

/** A project's collected amendments grouped per model, in the order their first one was collected. */
export function collectedByModel(
  list: readonly CollectedAmendment[],
  project: string,
): { modelId: string; modelKey: string; modelName: string; items: CollectedAmendment[] }[] {
  const groups = new Map<
    string,
    { modelId: string; modelKey: string; modelName: string; items: CollectedAmendment[] }
  >();
  for (const c of list) {
    if (c.project !== project) continue;
    const group = groups.get(c.modelId) ?? {
      modelId: c.modelId,
      modelKey: c.modelKey,
      modelName: c.modelName,
      items: [],
    };
    group.items.push(c);
    groups.set(c.modelId, group);
  }
  return [...groups.values()];
}

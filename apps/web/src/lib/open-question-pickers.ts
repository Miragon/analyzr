import type {
  Fact,
  OpenQuestion,
  OpenQuestionAction,
  OpenQuestionActionResult,
  OpenQuestionSubject,
  ProcessInfo,
  TypedPair,
} from '@analyzr/client';
import { personalDataList } from '@analyzr/contracts/personal-data';

import type { CollapsedSubprocess } from './collapsed-subprocess';
import { endpointRole, processRefOf } from './endpoints';
import { bestFits } from './generic-names';
import { OUTSIDE_LABEL, RELATION_TYPES } from './labels';
import { OUTSIDE_STEP } from './limits';
import { splitRef, type RefResolver } from './refs';

/**
 * Answering by action (M6 §4.8 a, S5c-1), the web's pure side: what the
 * pickers of an open question's actions offer (processes as „Name – Modell“
 * with the targets a live proposal names first, under „Vorgeschlagen“, then
 * the best fits by name, under „Passt vermutlich“ (UX4); the
 * complementary message or signal endpoints of other processes; the copies
 * of a process id), the sentence that names what an action will write
 * before it does, the toast after it, what „Rückgängig“ rejects, and the
 * collapsed subprocess a click in the model view selects. Loaded with the
 * tab's page and the model view's section (both lazy), never with the entry.
 */

/** The facts of one head revision, as `useProjectFacts` holds them. */
export interface ModelFacts {
  modelKey: string;
  facts: readonly Fact[];
  processes: readonly Pick<ProcessInfo, 'ref' | 'processId' | 'name' | 'participantName'>[];
}

/** The section of the targets a live proposal already names. */
export const SUGGESTED = 'Vorgeschlagen';

/** The section of the best fits by name (UX-SIMPLIFICATION.md §3.4 item 2). */
export const LIKELY = 'Passt vermutlich';

/** How many best fits „Passt vermutlich“ lists. */
export const LIKELY_COUNT = 3;

/** The reason „Rückgängig“ rejects with (from code, M6 §4.8 a). */
export const UNDO_REASON = 'Rückgängig gemacht';

const quote = (text: string) => `„${text}“`;

/** The display name of a ref: its label, else its element id, else the model key. */
export function refName(resolve: RefResolver, ref: string): string {
  const label = resolve(ref);
  return label.label ?? (label.elementId || label.modelKey);
}

/** The process a subject lies in (`<model>#<process>`): itself for a process, its fact's process for an element. */
export function subjectProcess(
  facts: Iterable<ModelFacts>,
  subject: Pick<OpenQuestionSubject, 'type' | 'id'>,
): string | null {
  if (subject.type === 'process') return subject.id;
  if (subject.type !== 'ref') return null;
  const { modelKey } = splitRef(subject.id);
  for (const m of facts) {
    if (m.modelKey !== modelKey) continue;
    const fact = m.facts.find((f) => f.ref === subject.id);
    if (fact) return processRefOf(fact) ?? (fact.kind === 'process' ? fact.ref : null);
  }
  return null;
}

/** A process to pick: „Name – Modell“. */
export interface ProcessChoice {
  ref: string;
  /** Process name, else the pool name, else the process id. */
  name: string;
  modelKey: string;
  /** A live proposal already names it (listed first, under „Vorgeschlagen“). */
  suggested: boolean;
  /** One of the best fits by name (next, under „Passt vermutlich“). */
  likely: boolean;
}

const byName = (a: { modelKey: string; name: string }, b: { modelKey: string; name: string }) =>
  a.name.localeCompare(b.name, 'de') || a.modelKey.localeCompare(b.modelKey);

/**
 * Puts the suggested items first (in their order), then the best fits to
 * the hints by name, then the rest as they come (UX-SIMPLIFICATION.md §3.4
 * item 2).
 */
function ranked<T extends { ref: string; suggested: boolean; likely: boolean }>(
  items: readonly T[],
  suggested: readonly string[],
  hints: readonly string[],
  nameOf: (item: T) => string,
): T[] {
  const byRef = new Map(items.map((c) => [c.ref, c]));
  const first = suggested.flatMap((ref) => {
    const c = byRef.get(ref);
    return c ? [{ ...c, suggested: true }] : [];
  });
  const taken = new Set(first.map((c) => c.ref));
  const likely = bestFits(
    items.filter((c) => !taken.has(c.ref)),
    nameOf,
    hints,
    LIKELY_COUNT,
  ).map((c) => ({ ...c, likely: true }));
  for (const c of likely) taken.add(c.ref);
  return [...first, ...likely, ...items.filter((c) => !taken.has(c.ref))];
}

/**
 * The head processes to pick from: the suggested ones first (in their
 * order), then the best fits to `hints` by name („Passt vermutlich“), then
 * every other by name and model key; the excluded processes (the item's
 * own) left out.
 */
export function processChoices(
  facts: Iterable<ModelFacts>,
  {
    suggested = [],
    exclude = [],
    hints = [],
  }: {
    suggested?: readonly string[];
    exclude?: readonly (string | null)[];
    /** What the item names: the call's label and its unresolved value, an endpoint's name. */
    hints?: readonly string[];
  } = {},
): ProcessChoice[] {
  const skip = new Set(exclude.filter((e): e is string => e !== null));
  const all = new Map<string, ProcessChoice>();
  for (const m of facts) {
    for (const p of m.processes) {
      if (skip.has(p.ref)) continue;
      all.set(p.ref, {
        ref: p.ref,
        name: p.name ?? p.participantName ?? p.processId,
        modelKey: m.modelKey,
        suggested: false,
        likely: false,
      });
    }
  }
  return ranked([...all.values()].sort(byName), suggested, hints, (c) => c.name);
}

/** The section heading of a process choice: „Vorgeschlagen“, „Passt vermutlich“ or „Alle Prozesse“. */
export function processSection(c: Pick<ProcessChoice, 'suggested' | 'likely'>): string {
  return c.suggested ? SUGGESTED : c.likely ? LIKELY : 'Alle Prozesse';
}

/**
 * What an item names, for „Passt vermutlich“: the subject's label, its
 * unresolved value (a call's `calledElement`) and its message or signal
 * name, else its label in the list.
 */
export function subjectHints(
  facts: Iterable<ModelFacts>,
  q: Pick<OpenQuestion, 'subject' | 'subjectLabel'>,
): string[] {
  const hints: string[] = [];
  for (const m of facts)
    for (const f of m.facts)
      if (f.ref === q.subject.id)
        hints.push(f.label, f.keyRaw, f.attrs.messageName ?? '', f.attrs.signalName ?? '');
  const own = hints.filter((h) => h.trim() !== '');
  return own.length > 0 ? own : [q.subjectLabel];
}

/** A link target for an endpoint: a complementary endpoint, or a whole process where none fits. */
export interface EndpointChoice {
  ref: string;
  /** The endpoint's label (or id), or the process's name. */
  name: string;
  kind: 'endpoint' | 'process';
  processName: string;
  modelKey: string;
  suggested: boolean;
  likely: boolean;
}

const THROWS = new Set<Fact['kind']>(['msg_throw', 'sig_throw']);
const CATCHES = new Set<Fact['kind']>(['msg_catch', 'sig_catch']);

/** Whether a link at this endpoint points towards it: it only catches (the server's rule). */
export function catchesOnly(facts: Iterable<ModelFacts>, ref: string): boolean {
  const kinds: Fact['kind'][] = [];
  for (const m of facts) for (const f of m.facts) if (f.ref === ref) kinds.push(f.kind);
  return !kinds.some((k) => THROWS.has(k)) && kinds.some((k) => CATCHES.has(k));
}

/**
 * The targets of a link from a message or signal endpoint (M6 §4.8 a): the
 * complementary endpoints of other processes (a thrown message's catches, a
 * caught signal's throws), grouped by model and process, then every other
 * process as a whole („the pickers offer the whole process when no endpoint
 * fits“); the suggested targets first, then the best fits to `hints` by name.
 */
export function endpointChoices(
  facts: readonly ModelFacts[],
  subjectRef: string,
  suggested: readonly string[] = [],
  hints: readonly string[] = [],
): EndpointChoice[] {
  const own = facts.flatMap((m) => m.facts.filter((f) => f.ref === subjectRef));
  const ownProcess = subjectProcess(facts, { type: 'ref', id: subjectRef });
  const wanted = own.flatMap((f) => {
    const role = endpointRole(f);
    return role ? [{ type: role.type, side: role.side === 'from' ? 'to' : 'from' }] : [];
  });
  const processNames = new Map<string, string>();
  for (const m of facts)
    for (const p of m.processes)
      processNames.set(p.ref, p.name ?? p.participantName ?? p.processId);
  const endpoints = new Map<string, EndpointChoice>();
  for (const m of facts) {
    for (const f of m.facts) {
      if (endpoints.has(f.ref) || f.ref === subjectRef) continue;
      const role = endpointRole(f);
      if (!role || !wanted.some((w) => w.type === role.type && w.side === role.side)) continue;
      const process = processRefOf(f);
      if (process === null || process === ownProcess) continue;
      endpoints.set(f.ref, {
        ref: f.ref,
        name: f.label || f.elementId,
        kind: 'endpoint',
        processName: processNames.get(process) ?? splitRef(process).elementId,
        modelKey: m.modelKey,
        suggested: false,
        likely: false,
      });
    }
  }
  const processes = processChoices(facts, { exclude: [ownProcess] }).map((p): EndpointChoice => ({
    ref: p.ref,
    name: p.name,
    kind: 'process',
    processName: p.name,
    modelKey: p.modelKey,
    suggested: false,
    likely: false,
  }));
  const ordered = [
    ...[...endpoints.values()].sort(
      (a, b) =>
        a.modelKey.localeCompare(b.modelKey) ||
        a.processName.localeCompare(b.processName, 'de') ||
        a.name.localeCompare(b.name, 'de'),
    ),
    ...processes,
  ];
  return ranked(ordered, suggested, hints, (c) => c.name);
}

/** The section heading of an endpoint choice: „Vorgeschlagen“, „Passt vermutlich“, its process, or „Ganzer Prozess“. */
export function endpointSection(c: EndpointChoice): string {
  if (c.suggested) return SUGGESTED;
  if (c.likely) return LIKELY;
  return c.kind === 'process' ? 'Ganzer Prozess' : `${c.processName} (${c.modelKey})`;
}

/** A pair of an `unjudged` item, as the pair picker lists it: „A“ → „B“ (type). */
export function pairLabel(pair: TypedPair, resolve: RefResolver): string {
  return `${quote(refName(resolve, pair.from))} → ${quote(refName(resolve, pair.to))} (${RELATION_TYPES[pair.type].label})`;
}

/** The value of a pair in the picker (`from` and `to` joined; refs never hold a line break). */
export const pairValue = (pair: Pick<TypedPair, 'from' | 'to'>) => `${pair.from}\n${pair.to}`;

// ------------------------------------------------------------- what it writes

/**
 * What a `link` will write, before it does (M6 §4.8 a), one sentence per
 * target: it accepts the proposals a live relation already makes for the
 * target (the action's `proposals`, named one by one: „Nimmt den Vorschlag
 * … an.“), else writes an accepted relation („Legt eine angenommene
 * Relation … an.“), directed away from the item's anchor (towards an
 * endpoint that only catches); a pool's flows each get theirs, a flow
 * without a proposal a new relation.
 */
export function linkPreview(
  q: Pick<OpenQuestion, 'kind' | 'subject'>,
  action: Pick<OpenQuestionAction, 'proposals'>,
  targets: readonly string[],
  resolve: RefResolver,
  incoming: boolean,
): string[] {
  const pairText = (from: string, to: string) =>
    `${quote(refName(resolve, from))} → ${quote(refName(resolve, to))}`;
  return targets.map((target) => {
    const to = quote(refName(resolve, target));
    const proposals = (action.proposals ?? []).filter((p) => p.target === target);
    const named =
      proposals.length === 1
        ? `den Vorschlag ${pairText(proposals[0]!.from, proposals[0]!.to)}`
        : `die Vorschläge ${proposals.map((p) => pairText(p.from, p.to)).join(' und ')}`;
    if (q.kind === 'black-box-partner') {
      return proposals.length > 0
        ? `Verknüpft jeden Nachrichtenfluss des Pools mit ${to}: nimmt ${named} an und legt für jeden Fluss ohne Vorschlag eine angenommene Relation in Richtung des Flusses an.`
        : `Legt für jeden Nachrichtenfluss des Pools eine angenommene Relation mit ${to} an, in Richtung des Flusses.`;
    }
    if (proposals.length > 0) return `Nimmt ${named} an.`;
    const from = quote(refName(resolve, q.subject.id));
    return `Legt eine angenommene Relation ${incoming ? `${to} → ${from}` : `${from} → ${to}`} an.`;
  });
}

/**
 * The processes a link's process picker leaves out: the processes of the
 * item's anchors as the server names them (`exclude`), else the subject's
 * own process.
 */
export function linkExclusions(
  facts: Iterable<ModelFacts>,
  q: Pick<OpenQuestion, 'subject'>,
  action: Pick<OpenQuestionAction, 'exclude'>,
): (string | null)[] {
  return action.exclude ?? [subjectProcess(facts, q.subject)];
}

/** A refusal of the action route in German, where the server's reason has one; else `null`. */
export function refusalText(reason: unknown, message: string, resolve: RefResolver): string | null {
  switch (reason) {
    case 'same-process': {
      const [, target, anchor] = /^(\S+) lies in the process of (\S+)$/.exec(message) ?? [];
      return target && anchor
        ? `${quote(refName(resolve, target))} liegt im selben Prozess wie ${quote(refName(resolve, anchor))}; eine Relation verbindet zwei Prozesse.`
        : 'Das Ziel liegt im selben Prozess wie die Frage; eine Relation verbindet zwei Prozesse.';
    }
    case 'unknown-ref':
      return 'Das Ziel gibt es im aktuellen Stand der Modelle nicht mehr. Lade die Liste neu.';
    case 'not-a-process':
      return 'Das Ziel ist kein Prozess.';
    case 'action-not-offered':
      return 'Die Frage bietet diese Aktion nicht mehr an. Lade die Liste neu.';
    default:
      return null;
  }
}

/** What linking a listed pair will write: the pair's open proposal accepted, or an accepted relation. */
export function pairPreview(pair: TypedPair, resolve: RefResolver): string {
  return `Verknüpft ${quote(refName(resolve, pair.from))} → ${quote(refName(resolve, pair.to))}: nimmt einen offenen Vorschlag zu dem Paar an, sonst legt es eine angenommene Relation an.`;
}

/** What a `place` will write: a manual placement, accepted at once. */
export function placePreview(processName: string, stepName: string, step: string): string {
  return step === OUTSIDE_STEP
    ? `Setzt ${quote(processName)} bewusst außerhalb der Kette (manuell, gilt sofort).`
    : `Platziert ${quote(processName)} auf ${quote(stepName)} (manuell, gilt sofort).`;
}

/** What `choose-copy` will decide (no „Rückgängig“: decisions are changed in the review). */
export function chooseCopyPreview(calls: number, copyName: string): string {
  const n = calls === 1 ? 'den offenen Aufruf' : `die ${calls} offenen Aufrufe`;
  return `Entscheidet ${n} zu den Kopien: angenommen zu ${quote(copyName)}, abgelehnt zu den anderen Kopien. Ändern kannst du jede Entscheidung danach unter „Relationen“.`;
}

/** The prefilled note of `choose-copy` (M6 §4.8 a), naming the valid copy. */
export function chooseCopyNote(resolve: RefResolver, ref: string): string {
  return `Gültig ist ${quote(refName(resolve, ref))} in ${splitRef(ref).modelKey}; die anderen Kopien sind veraltet oder Varianten.`;
}

// ------------------------------------------------------------- after it ran

/** What „Rückgängig“ rejects: the relations and placements the action wrote (`manual`), at their versions. */
export interface UndoPlan {
  relations: { id: string; version: number }[];
  placements: { id: string; version: number }[];
}

export function undoPlan(
  result: Pick<OpenQuestionActionResult, 'relations' | 'placements'>,
): UndoPlan {
  return {
    relations: result.relations
      .filter((r) => r.effect === 'manual')
      .map((r) => ({ id: r.relation.id, version: r.relation.version })),
    placements: result.placements
      .filter((p) => p.effect === 'manual')
      .map((p) => ({ id: p.placement.id, version: p.placement.version })),
  };
}

export const undoable = (plan: UndoPlan) => plan.relations.length + plan.placements.length > 0;

/** The relations an action decided (accepted proposals, decided calls): their toast leads to them. */
export function decidedRelations(result: Pick<OpenQuestionActionResult, 'relations'>): string[] {
  return result.relations.filter((r) => r.effect === 'decision').map((r) => r.relation.id);
}

/** The placements an action decided (a proposal on the picked step accepted): the toast leads to the value chain. */
export function decidedPlacements(result: Pick<OpenQuestionActionResult, 'placements'>): string[] {
  return result.placements.filter((p) => p.effect === 'decision').map((p) => p.placement.id);
}

/**
 * What the personal-data check found in an action's note, said after it was
 * stored (it warns, never blocks; the panel warned while typing); `null`
 * without a finding.
 */
export function storedNoteWarning(warnings: OpenQuestionActionResult['warnings']): string | null {
  const list = personalDataList(warnings);
  return list === null
    ? null
    : `Die Notiz enthält vermutlich ${list}; gespeichert ist sie so. Keine Namen oder anderen personenbezogenen Daten.`;
}

/** The toast after an action, from what it did (M6 §4.8 a). */
export function actionToast(
  type: OpenQuestionAction['type'],
  result: OpenQuestionActionResult,
  resolve: RefResolver,
): { tone: 'success' | 'info'; title: string; description: string } {
  const pair = (r: { from: string; to: string }) =>
    `${quote(refName(resolve, r.from))} → ${quote(refName(resolve, r.to))}`;
  const manual = result.relations.filter((r) => r.effect === 'manual').map((r) => r.relation);
  const decided = result.relations.filter((r) => r.effect === 'decision').map((r) => r.relation);
  switch (type) {
    case 'outside':
      return result.result === 'unchanged'
        ? {
            tone: 'info',
            title: 'Schon als außerhalb markiert',
            description:
              'Die Frage ist schon als außerhalb der Landschaft markiert; nichts geändert.',
          }
        : {
            tone: 'success',
            title: 'Als außerhalb der Landschaft markiert',
            description: 'Die Frage ist erledigt. „Rückgängig“ nimmt die Markierung zurück.',
          };
    case 'place': {
      const placed = result.placements.map((p) => p.placement);
      if (placed.length === 0)
        return {
          tone: 'info',
          title: 'War schon platziert',
          description: 'Diese Platzierung gab es schon; nichts geändert.',
        };
      const p = placed[0]!;
      const step = p.elementId === OUTSIDE_STEP ? OUTSIDE_LABEL : (p.stepName ?? p.elementId);
      const decision = result.placements[0]?.effect === 'decision';
      return {
        tone: 'success',
        title: 'Platziert',
        description:
          `${quote(p.processName ?? refName(resolve, p.process))} → ${quote(step)}.` +
          (decision
            ? ' Damit ist der Vorschlag auf diesem Schritt angenommen; ändern kannst du das in der Wertschöpfungskette.'
            : ''),
      };
    }
    case 'choose-copy': {
      const accepted = decided.filter((r) => r.status === 'accepted').length;
      const rejected = decided.length - accepted;
      const outside = result.placements.length;
      return {
        tone: 'success',
        title: 'Gültige Kopie gewählt',
        description:
          `${decided.length === 1 ? '1 Aufruf' : `${decided.length} Aufrufe`} entschieden: ${accepted} angenommen, ${rejected} abgelehnt` +
          (outside > 0
            ? `; ${outside === 1 ? '1 andere Kopie' : `${outside} andere Kopien`} auf „außerhalb“ gesetzt.`
            : '.'),
      };
    }
    default: {
      if (manual.length + decided.length === 0)
        return {
          tone: 'info',
          title: 'Schon verknüpft',
          description: 'Eine angenommene Relation gab es schon; nichts geändert.',
        };
      const parts = [
        manual.length === 1
          ? `Angenommene Relation ${pair(manual[0]!)} angelegt.`
          : manual.length > 1
            ? `${manual.length} angenommene Relationen angelegt.`
            : null,
        decided.length === 1
          ? `Vorschlag ${pair(decided[0]!)} angenommen.`
          : decided.length > 1
            ? `${decided.length} Vorschläge angenommen.`
            : null,
      ].filter((p) => p !== null);
      return { tone: 'success', title: 'Verknüpft', description: parts.join(' ') };
    }
  }
}

// ------------------------------------------------------- collapsed subprocess

export { collapsedSubprocess, type CollapsedSubprocess } from './collapsed-subprocess';

/** The rationale of the manual relation from a collapsed subprocess's process (German, from code). */
export function subprocessRationale(sub: CollapsedSubprocess, processName: string): string {
  return `Aus der Modellansicht: Der eingeklappte Teilprozess ${quote(sub.name)} in ${quote(processName)} verweist auf diesen Prozess.`;
}

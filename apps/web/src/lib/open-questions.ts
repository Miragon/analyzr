import type {
  OpenQuestion,
  OpenQuestionAction,
  OpenQuestionAskWho,
  OpenQuestionGroup,
  OpenQuestionKind,
  OpenQuestionSource,
  OpenQuestionState,
} from '@analyzr/client';
// The server's labels (M6 S4): zod-free, loaded with the lazy open-questions chunks only.
import {
  OPEN_QUESTION_GROUP_LABELS,
  OPEN_QUESTION_KIND_LABELS,
  OPEN_QUESTION_SOURCE_LABELS,
  OPEN_QUESTION_STATE_LABELS,
  isInformationalKind,
  isVerbatimSource,
} from '@analyzr/contracts/open-question-labels';

import type { Presentation } from './labels';
import type { RefLabel } from './refs';

/**
 * The open questions (M6 §4.2–§4.4; the tab reworked in UX2b,
 * UX-SIMPLIFICATION.md §3.3): German labels, the tab's view („Zu klären“
 * as cards, the closed groups „Zur Information“ and „Erledigt“), its three
 * filters, where an item and its actions lead, and the export's groups.
 * Pure. Loaded with the tab's page and the model view's section (both lazy),
 * never with the entry.
 */

/** An open question's kind, presented. `informational` items ask nothing themselves. */
export interface KindPresentation extends Presentation {
  informational?: true;
}

type Style = Omit<Presentation, 'label'>;

/** Tone and hint of each kind (the badge's tooltip, repeating it); the label is the server's. */
const KIND_STYLES: Record<OpenQuestionKind, Style> = {
  'call-target-unknown': {
    tone: 'danger',
    hint: 'Ein Aufruf trifft keinen Prozess des Projekts, oder ein Agent kennt das Ziel nicht.',
  },
  'call-target-dynamic': {
    tone: 'warning',
    hint: 'Welcher Prozess aufgerufen wird, steht erst beim Ausführen fest.',
  },
  'duplicate-process-id': {
    tone: 'danger',
    hint: 'Mehrere Modelle haben dieselbe Prozess-ID; Aufrufe darauf sind dadurch mehrdeutig.',
  },
  'message-partner-missing': {
    tone: 'warning',
    hint: 'Kein Modell sendet oder empfängt diese Nachricht oder dieses Signal.',
  },
  held: {
    tone: 'warning',
    hint: 'Eine Relation oder Platzierung ist vorgemerkt, bis eine Frage geklärt ist.',
  },
  'agent-question': {
    tone: 'info',
    hint: 'Ein Agent fragt zu seinem Vorschlag etwas, das nicht in den Modellen steht.',
  },
  'placement-unsure': {
    tone: 'info',
    hint: 'Der Agent konnte den Prozess keinem Schritt der Wertschöpfungskette sicher zuordnen.',
  },
  'process-without-step': {
    tone: 'warning',
    hint: 'Der Prozess steht auf keinem Schritt der Wertschöpfungskette.',
  },
  'step-without-process': {
    tone: 'warning',
    hint: 'Weder auf dem Schritt noch darunter ist ein Prozess platziert.',
  },
  'unresolved-link': {
    tone: 'warning',
    hint: 'Der Link des Schritts ist weder ein Prozess des Projekts noch eine Webadresse.',
  },
  'external-partner': {
    tone: 'info',
    hint: 'Ein Agent sieht hier eine Zusammenarbeit mit einem Partner außerhalb der Modelle.',
  },
  'summary-note': {
    tone: 'neutral',
    hint: 'Was ein Agent nach seiner Analyse zusammengefasst hat, etwa vermutete Lücken. Nur zum Lesen.',
  },
  unjudged: {
    tone: 'info',
    hint: 'Eine Analyse hat mögliche Relationen ohne Urteil gelassen.',
  },
  'black-box-partner': {
    tone: 'info',
    hint: 'Ein Nachrichtenfluss endet an einem Pool ohne Prozess: ein externer Partner oder ein fehlendes Modell?',
  },
  'unlabelled-boundary': {
    tone: 'info',
    hint: 'Ein Start- oder Endereignis ohne Namen: Was startet oder beendet den Prozess?',
  },
  'message-without-name': {
    tone: 'info',
    hint: 'Ein Nachrichtenereignis ohne Nachrichtennamen.',
  },
  'undocumented-process': {
    tone: 'info',
    hint: 'Der Prozess hat keine Dokumentation, die wichtigste Grundlage der Agenten.',
  },
  'isolated-process': {
    tone: 'info',
    hint: 'Der Prozess hat keine Relation, keinen Kandidaten und keinen Nachrichtenfluss zu einem anderen Prozess.',
  },
  'descriptive-model': {
    tone: 'neutral',
    hint: 'Ein Modell ohne Engine und ohne ausführbaren Prozess: Die automatische Verknüpfung findet hier wenig.',
  },
  'amendment-conflict': {
    tone: 'warning',
    hint: 'Eine Ergänzung aus analyzr passt nicht mehr zum Modell aus dem Quellsystem.',
  },
  'extractor-loss': {
    tone: 'warning',
    hint: 'Beim Import wurden Elemente übersprungen, etwa wegen doppelter oder ungültiger IDs.',
  },
};

/**
 * Every kind, presented. The labels and the informational kinds come from
 * `@analyzr/contracts/open-question-labels`, which the server's export uses
 * too, so the tab and the exported sheet say the same.
 */
export const OPEN_QUESTION_KINDS = Object.fromEntries(
  (Object.keys(KIND_STYLES) as OpenQuestionKind[]).map((kind) => [
    kind,
    {
      label: OPEN_QUESTION_KIND_LABELS[kind],
      ...KIND_STYLES[kind],
      ...(isInformationalKind(kind) ? { informational: true as const } : {}),
    },
  ]),
) as Record<OpenQuestionKind, KindPresentation>;

/** The kinds in the order of the filter „Art“: holds and the agents' first, then the findings. */
export const OPEN_QUESTION_KIND_ORDER: readonly OpenQuestionKind[] = [
  'held',
  'placement-unsure',
  'external-partner',
  'unjudged',
  'call-target-unknown',
  'call-target-dynamic',
  'duplicate-process-id',
  'message-partner-missing',
  'process-without-step',
  'step-without-process',
  'unresolved-link',
  'black-box-partner',
  'unlabelled-boundary',
  'message-without-name',
  'undocumented-process',
  'isolated-process',
  'amendment-conflict',
  'extractor-loss',
  // the web twin of `analyzr questions --group agent` (UX2b): last, it switches the list
  'agent-question',
  'descriptive-model',
  'summary-note',
];

/** The server's labels of the sources: only the chip of a `?source=` filter shows one. */
export const OPEN_QUESTION_SOURCES: Readonly<Record<OpenQuestionSource, string>> =
  OPEN_QUESTION_SOURCE_LABELS;

/** The states (`answered`: a live outside mark, „Außerhalb der Landschaft“, M6 §4.8 b). */
export const OPEN_QUESTION_STATES: Readonly<Record<OpenQuestionState, string>> =
  OPEN_QUESTION_STATE_LABELS;

/** The groups' headings (UX2a): „Zu klären“, „Fragen der Agenten“, „Zur Information“. */
export const OPEN_QUESTION_GROUPS: Readonly<Record<OpenQuestionGroup, string>> =
  OPEN_QUESTION_GROUP_LABELS;

/**
 * Whether an item's texts are a human's or an agent's, verbatim (plain text,
 * never from code): the contracts' rule, so the card's „Laut Agent: …“ and
 * the export's say the same.
 */
export function isVerbatim(q: Pick<OpenQuestion, 'source'>): boolean {
  return isVerbatimSource(q.source);
}

/**
 * The meta line of a card (UX2b): „Betrifft 6 offene Entscheidungen“ from
 * two on, so the order stays explained; it ranks, it predicts nothing.
 */
export function unlocksText(q: Pick<OpenQuestion, 'kind' | 'unlocks'>): string | null {
  if (OPEN_QUESTION_KINDS[q.kind].informational || q.unlocks < 2) return null;
  return `Betrifft ${q.unlocks} offene Entscheidungen`;
}

/**
 * Whom to ask, as one line (UX2b): the org units owning the subject's steps,
 * then its lanes, each once; the folder is not a person and stays out (it is
 * the model filter already). Empty when nobody is named.
 */
export function askWhoText(askWho: OpenQuestionAskWho): string {
  return [...new Set([...askWho.stepOwners, ...askWho.lanes])].join(', ');
}

/** The handle without the `agent:` prefix (as „Übersicht“ shows the holder). */
export function handleName(handle: string | null): string {
  return (handle ?? 'Agent').replace(/^agent:/, '');
}

// ------------------------------------------------------------------ filters

/** The filters of the tab, as in the URL (`model` is the API's `modelKey`). */
export interface OpenQuestionFilters {
  kind?: OpenQuestionKind;
  /** No select since UX2b; a link or bookmark with it shows a removable chip. */
  source?: OpenQuestionSource;
  /** A model key or a folder (`finanzen` matches `finanzen/mahnwesen`). */
  model?: string;
  /** A lane or one step owner, exactly (a folder still matches, as on the server). */
  askWho?: string;
  /** `answered` opens „Erledigt“ (UX2b: the list shows open items; no select). */
  state?: OpenQuestionState;
}

const isKind = (v: unknown): v is OpenQuestionKind =>
  typeof v === 'string' && Object.hasOwn(OPEN_QUESTION_KINDS, v);
const isSource = (v: unknown): v is OpenQuestionSource =>
  typeof v === 'string' && Object.hasOwn(OPEN_QUESTION_SOURCES, v);
const isState = (v: unknown): v is OpenQuestionState =>
  typeof v === 'string' && Object.hasOwn(OPEN_QUESTION_STATES, v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** The valid filters of a URL search; unknown values are dropped. */
export function parseOpenQuestionFilters(search: Record<string, unknown>): OpenQuestionFilters {
  return {
    ...(isKind(search['kind']) ? { kind: search['kind'] } : {}),
    ...(isSource(search['source']) ? { source: search['source'] } : {}),
    ...(nonEmpty(search['model']) ? { model: search['model'] } : {}),
    ...(nonEmpty(search['askWho']) ? { askWho: search['askWho'] } : {}),
    ...(isState(search['state']) ? { state: search['state'] } : {}),
  };
}

/** How many of the list's filters are set (the phone's „Filter (n)“; `state` is no filter). */
export function activeFilterCount(filters: OpenQuestionFilters): number {
  return [filters.kind, filters.model, filters.askWho, filters.source].filter(
    (v) => v !== undefined,
  ).length;
}

/** The model itself or a model below that folder, as the server's `modelKey` filter. */
export function inModel(modelKeys: readonly string[], filter: string): boolean {
  return modelKeys.some((k) => k === filter || k.startsWith(`${filter}/`));
}

function matchesAskWho(askWho: OpenQuestionAskWho, value: string): boolean {
  return (
    askWho.lanes.includes(value) || askWho.stepOwners.includes(value) || askWho.folder === value
  );
}

/**
 * The items matching every filter, in their order (questions, then the value
 * chain findings, then informational items, each by `unlocks` descending).
 * The same rules as the server's `filterOpenQuestions`, which the export
 * applies to the same filters.
 */
export function filterOpenQuestions(
  items: readonly OpenQuestion[],
  filters: OpenQuestionFilters,
): OpenQuestion[] {
  return items.filter(
    (q) =>
      (filters.model === undefined || inModel(q.modelKeys, filters.model)) &&
      (filters.kind === undefined || q.kind === filters.kind) &&
      (filters.source === undefined || q.source === filters.source) &&
      (filters.state === undefined || q.state === filters.state) &&
      (filters.askWho === undefined || matchesAskWho(q.askWho, filters.askWho)),
  );
}

/** The group the tab's cards show: the agents' questions only while „Art“ asks for them. */
export function cardGroup(filters: Pick<OpenQuestionFilters, 'kind'>): 'ask' | 'agent' {
  return filters.kind === 'agent-question' ? 'agent' : 'ask';
}

/**
 * What the tab shows (UX-SIMPLIFICATION.md §2.4, §3.3): the open items of
 * the card group („Zu klären“, or the agents' questions under „Art“), the
 * informational items for the closed group „Zur Information“, and the
 * answered items (a live outside mark) for „Erledigte zeigen“, each under the
 * filters. `proposal` items are never shown (the chain's badge counts them).
 * `total` counts the open items of the card group without filters, the
 * badge's number for `ask`.
 */
export interface QuestionView {
  group: 'ask' | 'agent';
  cards: OpenQuestion[];
  done: OpenQuestion[];
  info: OpenQuestion[];
  total: number;
}

export function questionView(
  items: readonly OpenQuestion[],
  filters: OpenQuestionFilters,
): QuestionView {
  const group = cardGroup(filters);
  const matching = filterOpenQuestions(items, { ...filters, state: undefined });
  return {
    group,
    cards: matching.filter((q) => q.group === group && q.state === 'open'),
    done: matching.filter((q) => q.group === group && q.state === 'answered'),
    info: matching.filter((q) => q.group === 'info'),
    total: items.filter((q) => q.group === group && q.state === 'open').length,
  };
}

/** „21 zu klären“, „3 von 21 zu klären“, „19 Fragen der Agenten“. */
export function countText(view: Pick<QuestionView, 'group' | 'cards' | 'total'>): string {
  const what = view.group === 'agent' ? 'Fragen der Agenten' : 'zu klären';
  const shown = view.cards.length;
  return shown === view.total ? `${shown} ${what}` : `${shown} von ${view.total} ${what}`;
}

/** One option of a filter, with the number of cards it leaves (given the other filters). */
export interface FacetOption<T extends string = string> {
  value: T;
  label: string;
  count: number;
}

export interface OpenQuestionFacets {
  kinds: FacetOption<OpenQuestionKind>[];
  folders: FacetOption[];
  models: FacetOption[];
  /** Step owners and lanes in one list, by name. */
  askWho: FacetOption[];
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byLocale = (a: string, b: string): number => a.localeCompare(b, 'de');

function counted<T extends string>(
  values: Iterable<T>,
  items: readonly OpenQuestion[],
  matches: (q: OpenQuestion, value: T) => boolean,
): Map<T, number> {
  const out = new Map<T, number>();
  for (const v of values) out.set(v, items.filter((q) => matches(q, v)).length);
  return out;
}

/**
 * The options of the three filters (UX2b): each counts the cards the other
 * filters leave and lists only values with cards (and the selected one), in
 * a fixed order (kinds as above, models and folders by key, contact names
 * by name). „Art“ counts the open „Zu klären“ items per kind and, last, the
 * open agents' questions („Frage eines Agenten“, which switches the list).
 */
export function openQuestionFacets(
  items: readonly OpenQuestion[],
  filters: OpenQuestionFilters,
): OpenQuestionFacets {
  const open = items.filter((q) => q.state === 'open');
  const shown = open.filter((q) => q.group === cardGroup(filters));
  const without = (key: keyof OpenQuestionFilters, list: readonly OpenQuestion[]) =>
    filterOpenQuestions(list, { ...filters, state: undefined, [key]: undefined });
  const keep = <T extends string>(
    order: readonly T[],
    counts: Map<T, number>,
    selected: T | undefined,
    label: (v: T) => string,
  ): FacetOption<T>[] =>
    order
      .filter((v) => (counts.get(v) ?? 0) > 0 || v === selected)
      .map((v) => ({ value: v, label: label(v), count: counts.get(v) ?? 0 }));

  const forKind = without(
    'kind',
    open.filter((q) => q.group === 'ask' || q.group === 'agent'),
  );
  const kinds = counted(OPEN_QUESTION_KIND_ORDER, forKind, (q, v) =>
    v === 'agent-question' ? q.group === 'agent' : q.group === 'ask' && q.kind === v,
  );

  const forModel = without('model', shown);
  const modelKeys = new Set<string>();
  const folderKeys = new Set<string>();
  for (const q of shown) {
    for (const key of q.modelKeys) {
      modelKeys.add(key);
      const parts = key.split('/');
      for (let i = 1; i < parts.length; i += 1) folderKeys.add(parts.slice(0, i).join('/'));
    }
  }
  if (filters.model !== undefined && !modelKeys.has(filters.model)) folderKeys.add(filters.model);
  const inKey = (q: OpenQuestion, v: string) => inModel(q.modelKeys, v);
  const models = counted([...modelKeys].sort(byCodePoint), forModel, inKey);
  const folders = counted([...folderKeys].sort(byCodePoint), forModel, inKey);

  const forAskWho = without('askWho', shown);
  const names = new Set<string>();
  for (const q of shown)
    for (const name of [...q.askWho.stepOwners, ...q.askWho.lanes]) names.add(name);
  if (filters.askWho !== undefined) names.add(filters.askWho);
  const sortedNames = [...names].sort(byLocale);
  const askWho = counted(sortedNames, forAskWho, (q, v) => matchesAskWho(q.askWho, v));

  return {
    kinds: keep(OPEN_QUESTION_KIND_ORDER, kinds, filters.kind, (v) => OPEN_QUESTION_KINDS[v].label),
    folders: keep([...folders.keys()], folders, filters.model, (v) => `${v}/`),
    models: keep([...models.keys()], models, filters.model, (v) => v),
    askWho: keep(sortedNames, askWho, filters.askWho, (v) => v),
  };
}

// ------------------------------------------------------------------ export

/** The query of the export route for the same filters (without `state`: the export keeps every state). */
export function exportQuery(filters: OpenQuestionFilters) {
  return {
    ...(filters.model !== undefined ? { modelKey: filters.model } : {}),
    ...(filters.kind !== undefined ? { kind: filters.kind } : {}),
    ...(filters.source !== undefined ? { source: filters.source } : {}),
    ...(filters.askWho !== undefined ? { askWho: filters.askWho } : {}),
  };
}

/**
 * The groups the export for the customer holds (owner decision 26, Q11):
 * „Zu klären“, with „Auch Fragen der Agenten“ their questions too, or only
 * the agents' questions while „Art“ shows them. `group=ask` keeps the old
 * file name (`offene-fragen-<p>.csv`).
 */
export function exportGroups(
  filters: Pick<OpenQuestionFilters, 'kind'>,
  withAgents: boolean,
): OpenQuestionGroup[] {
  if (cardGroup(filters) === 'agent') return ['agent'];
  return withAgents ? ['ask', 'agent'] : ['ask'];
}

/** The agents' open questions under the filters other than „Art“ (the export's checkbox). */
export function agentQuestionCount(
  items: readonly OpenQuestion[],
  filters: OpenQuestionFilters,
): number {
  if (filters.kind !== undefined) return 0;
  return filterOpenQuestions(items, { ...filters, state: 'open' }).filter(
    (q) => q.group === 'agent',
  ).length;
}

/** The file name of a download from `Content-Disposition`, else `fallback`. */
export function attachmentName(header: string | null, fallback: string): string {
  const match = header === null ? null : /filename="([^"]+)"/i.exec(header);
  return match?.[1] ?? fallback;
}

// -------------------------------------------------------------------- links

/** Where an item's subject or a `decide` leads: the model view, the review screen or the chain. */
export type QuestionLink =
  | { to: 'model'; modelKey: string; element?: string }
  | { to: 'review'; relation: string; held?: true }
  | { to: 'chain'; step?: string; placement?: string };

/** `vertrieb/auftrag#Task_1` → its model key and element id. */
function refParts(ref: string): { modelKey: string; elementId: string } {
  const at = ref.indexOf('#');
  return at <= 0
    ? { modelKey: ref, elementId: '' }
    : { modelKey: ref.slice(0, at), elementId: ref.slice(at + 1) };
}

/**
 * Where the subject's name leads (UX2b: the subject is the card's link): an
 * element or a process to the model view at it, a model to the model view,
 * a relation to its review screen, a placement or a step to the chain page
 * at it, the chain to the chain page.
 */
export function subjectLink(q: Pick<OpenQuestion, 'subject'>): QuestionLink {
  const { type, id } = q.subject;
  switch (type) {
    case 'relation':
      return { to: 'review', relation: id };
    case 'placement':
      return { to: 'chain', placement: id };
    case 'step':
      return { to: 'chain', step: id };
    case 'value-chain':
      return { to: 'chain' };
    case 'model':
      return { to: 'model', modelKey: id };
    case 'ref':
    case 'process': {
      const { modelKey, elementId } = refParts(id);
      return { to: 'model', modelKey, ...(elementId ? { element: elementId } : {}) };
    }
  }
}

/**
 * Where a `decide` leads (owner decision 26, Q4: decided where the diagrams
 * are): the chain at the step of the `proposal` items („Auf der Kette
 * prüfen“), else the first relation's review screen (a hold's in the view
 * „Vorgemerkt“) or the first placement on the chain.
 */
export function decideLink(
  q: Pick<OpenQuestion, 'kind'>,
  action: Pick<OpenQuestionAction, 'step' | 'decides'>,
): QuestionLink | null {
  if (action.step !== undefined) return { to: 'chain', step: action.step };
  const first = action.decides?.[0];
  if (!first) return null;
  return first.type === 'relation'
    ? { to: 'review', relation: first.id, ...(q.kind === 'held' ? { held: true as const } : {}) }
    : { to: 'chain', placement: first.id };
}

/** Fact kinds that start a relation (the sending, throwing or calling end). */
const FROM_KINDS: ReadonlySet<string> = new Set(['msg_throw', 'sig_throw', 'call', 'evt_end']);

/**
 * The processes of a relation's two ends, as the card's muted line (UX2b
 * review): „in „Bestellanforderung“ → „Lieferantenanlage““, since message,
 * signal and trigger ends often carry the same name. The ends are the
 * item's refs in the order its label names them („„from“ → „to““), else by
 * which end sends, throws or calls; `null` when that stays open, for any
 * other subject, or when both ends are processes the label names already.
 */
export function relationProcessesText(
  q: Pick<OpenQuestion, 'subject' | 'subjectLabel' | 'refs'>,
  resolve: (ref: string) => RefLabel,
): string | null {
  if (q.subject.type !== 'relation' || q.refs.length !== 2) return null;
  const [a, b] = q.refs.map(resolve) as [RefLabel, RefLabel];
  const name = (r: RefLabel) => r.label ?? r.elementId;
  const label = (x: RefLabel, y: RefLabel) => `„${name(x)}“ → „${name(y)}“`;
  const sends = (r: RefLabel) => r.kind !== null && FROM_KINDS.has(r.kind);
  let ends: [RefLabel, RefLabel] | null = null;
  if (name(a) !== name(b) && q.subjectLabel === label(a, b)) ends = [a, b];
  else if (name(a) !== name(b) && q.subjectLabel === label(b, a)) ends = [b, a];
  else if (sends(a) !== sends(b)) ends = sends(a) ? [a, b] : [b, a];
  if (ends === null) return null;
  const [from, to] = ends;
  const side = (r: RefLabel) => r.processName ?? name(r);
  if (side(from) === name(from) && side(to) === name(to)) return null;
  return `in „${side(from)}“ → „${side(to)}“`;
}

/** The items touching exactly this model (the server's `modelKey` filter also matches a folder). */
export function questionsOfModel(items: readonly OpenQuestion[], modelKey: string): OpenQuestion[] {
  return items.filter((q) => q.modelKeys.includes(modelKey));
}

// ------------------------------------------------------------------ actions

/** The web's labels where they differ from the API's (UX-SIMPLIFICATION.md §4). */
export const CARD_ACTION_LABELS = {
  /** A hold's note: its answer (the one place to answer a hold, §2.4). */
  answer: 'Antwort geben',
  /** A hold's note once it has an answer: one more (§3.7 item 3). */
  answerMore: 'Antwort ergänzen',
  /** A hold's `decide`: the review screen or the chain. */
  decideNow: 'Jetzt entscheiden',
  /** An agent's question's `decide`: its proposal. */
  openProposal: 'Vorschlag öffnen',
  /** The id, in the menu instead of on the card (P2). */
  copyId: 'Kennung kopieren',
} as const;

/** An action as the card offers it: the API's action with the web's label. */
export interface CardAction {
  action: OpenQuestionAction;
  label: string;
}

/** The card's actions (UX2b): one primary, at most one visible second, the rest in a menu. */
export interface CardActions {
  primary: CardAction | undefined;
  secondary: CardAction | undefined;
  menu: CardAction[];
}

/** Whether a hold has its answer: a note on it (its notes are its answers). */
export function holdAnswered(q: Pick<OpenQuestion, 'kind' | 'answers'>): boolean {
  return q.kind === 'held' && q.answers.some((a) => a.role === 'note');
}

/** The card's label of an API action. */
export function cardActionLabel(
  q: Pick<OpenQuestion, 'kind' | 'answers'>,
  action: Pick<OpenQuestionAction, 'type' | 'label' | 'step'>,
): string {
  if (action.type === 'note' && q.kind === 'held')
    return holdAnswered(q) ? CARD_ACTION_LABELS.answerMore : CARD_ACTION_LABELS.answer;
  if (action.type === 'decide' && action.step === undefined)
    return q.kind === 'held' ? CARD_ACTION_LABELS.decideNow : CARD_ACTION_LABELS.openProposal;
  return action.label;
}

/**
 * Arranges an item's actions on its card (UX-SIMPLIFICATION.md §3.3 items 5
 * and 10, Q4): a hold answers first („Antwort geben“, the note dialog) and
 * offers „Jetzt entscheiden“ beside it; once it has its answer, the next step
 * is the decision, so „Jetzt entscheiden“ leads and „Antwort ergänzen“ sits
 * beside it; every other item shows the API's
 * primary action, an amendment conflict also „Meine Ergänzung behalten“
 * beside „Wert aus dem Quellsystem übernehmen“; the rest goes in the menu.
 * An outside mark that counts leaves nothing to do but take it back (the
 * done card), so the arrangement is empty then.
 */
export function cardActions(q: Pick<OpenQuestion, 'kind' | 'actions' | 'answers'>): CardActions {
  const marked = q.answers.some((a) => a.role === 'outside-mark' && a.withdrawal === null);
  if (marked) return { primary: undefined, secondary: undefined, menu: [] };
  const card = (action: OpenQuestionAction): CardAction => ({
    action,
    label: cardActionLabel(q, action),
  });
  let primary: OpenQuestionAction | undefined;
  let secondary: OpenQuestionAction | undefined;
  if (q.kind === 'held') {
    const note = q.actions.find((a) => a.type === 'note');
    const decide = q.actions.find((a) => a.type === 'decide');
    [primary, secondary] = holdAnswered(q) && decide ? [decide, note] : [note, decide];
  } else {
    primary = q.actions.find((a) => a.primary);
    const replaced = primary?.type === 'withdraw-amendment' ? primary.withdraw : undefined;
    secondary = replaced?.compare
      ? q.actions.find((a) => a.type === 'amend' && a.amend?.replaces === replaced.amendment)
      : undefined;
  }
  return {
    primary: primary ? card(primary) : undefined,
    secondary: secondary ? card(secondary) : undefined,
    menu: q.actions.filter((a) => a !== primary && a !== secondary).map(card),
  };
}

// ------------------------------------------------------------- informational

/**
 * „Zur Information“ (decision 24.8, UX2b): two or more descriptive models
 * with the same reason become one notice („6 von 6 Modellen sind
 * beschreibend …“); the rest stays one line each.
 */
export interface InfoGroup {
  /** The notice for the descriptive models, when two or more share their reason. */
  descriptive: { text: string; items: OpenQuestion[] } | null;
  rest: OpenQuestion[];
}

export function infoGroup(info: readonly OpenQuestion[], modelCount: number): InfoGroup {
  const descriptive = info.filter((q) => q.kind === 'descriptive-model');
  const reasons = new Set(descriptive.map((q) => q.detail ?? ''));
  if (descriptive.length < 2 || reasons.size !== 1) return { descriptive: null, rest: [...info] };
  const reason = [...reasons][0] ?? '';
  const of = Math.max(modelCount, descriptive.length);
  return {
    descriptive: {
      text: `${descriptive.length} von ${of} Modellen sind beschreibend (ohne Engine).${reason ? ` ${reason}` : ''}`,
      items: descriptive,
    },
    rest: info.filter((q) => q.kind !== 'descriptive-model'),
  };
}

/** The latest note of an item (its text inline on the card), if any. */
export function latestNote(
  q: Pick<OpenQuestion, 'answers'>,
): OpenQuestion['answers'][number] | null {
  return q.answers.filter((a) => a.role === 'note').at(-1) ?? null;
}

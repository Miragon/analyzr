import type {
  OpenQuestion,
  OpenQuestionAskWho,
  OpenQuestionKind,
  OpenQuestionSource,
  OpenQuestionState,
} from '@analyzr/client';
// The server's labels (M6 S4): zod-free, loaded with the lazy open-questions chunks only.
import {
  OPEN_QUESTION_KIND_LABELS,
  OPEN_QUESTION_SOURCE_LABELS,
  OPEN_QUESTION_STATE_LABELS,
  isInformationalKind,
} from '@analyzr/contracts/open-question-labels';

import type { Presentation } from './labels';

/**
 * The open questions (M6 §4.2–§4.4): German labels, the filters of the tab
 * „Offene Fragen“ and where each item links to. Pure. Loaded with the tab's
 * page and the model view's section (both lazy), never with the entry.
 */

/** An open question's kind, presented. `informational` items ask nothing themselves. */
export interface KindPresentation extends Presentation {
  informational?: true;
}

type Style = Omit<Presentation, 'label'>;

/** Tone and hint of each kind; the label is the server's. */
const KIND_STYLES: Record<OpenQuestionKind, Style> = {
  'call-target-unknown': {
    tone: 'danger',
    hint: 'Ein Aufruf trifft keinen Prozess des Projekts, oder ein Agent kennt das Ziel nicht.',
  },
  'call-target-dynamic': {
    tone: 'warning',
    hint: 'Das Ziel des Aufrufs ist ein Ausdruck und steht erst zur Laufzeit fest.',
  },
  'duplicate-process-id': {
    tone: 'danger',
    hint: 'Mehrere Modelle definieren dieselbe Prozess-ID; Aufrufe sind dadurch mehrdeutig.',
  },
  'message-partner-missing': {
    tone: 'warning',
    hint: 'Kein Modell sendet oder empfängt diese Nachricht oder dieses Signal.',
  },
  held: {
    tone: 'warning',
    hint: 'Ein Mensch hat eine Relation oder Platzierung vorgemerkt, bis eine Frage geklärt ist.',
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
    hint: 'Der Prozess hat keinen angenommenen Schritt auf der Wertschöpfungskette.',
  },
  'step-without-process': {
    tone: 'warning',
    hint: 'Weder auf dem Schritt noch darunter ist ein Prozess angenommen.',
  },
  'unresolved-link': {
    tone: 'warning',
    hint: 'Der Link des Schritts ist weder ein Prozess des Projekts noch eine http(s)-Adresse.',
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
    hint: 'Eine Analyse hat zugewiesene Paare ohne Urteil gelassen.',
  },
  'black-box-partner': {
    tone: 'info',
    hint: 'Ein Nachrichtenfluss endet außerhalb jedes Prozesses des Modells, vermutlich an einem Pool ohne Prozess: ein externer Partner oder ein fehlendes Modell?',
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
    hint: 'Ein Modell ohne Engine und ohne ausführbaren Prozess: Die Regelstufe findet hier wenig.',
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

/** The kinds in the order of the filter: mapped sources first, then the gap signals. */
export const OPEN_QUESTION_KIND_ORDER: readonly OpenQuestionKind[] = [
  'held',
  'agent-question',
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
  'descriptive-model',
  'summary-note',
  'amendment-conflict',
  'extractor-loss',
];

/** Tone and hint of each source; the label is the server's. */
const SOURCE_STYLES: Record<OpenQuestionSource, Style> = {
  finding: { tone: 'neutral', hint: 'Ein Befund der Regelstufe (Tab „Befunde“).' },
  'value-chain-finding': { tone: 'neutral', hint: 'Ein Befund der Wertschöpfungskette.' },
  hold: { tone: 'neutral', hint: 'Eine Vormerkung eines Menschen.' },
  'agent-question': { tone: 'neutral', hint: 'Die Frage eines Agenten zu seinem Vorschlag.' },
  unsure: { tone: 'neutral', hint: 'Die Einschätzung „unsicher“ des Platzierungsagenten.' },
  'no-link': {
    tone: 'neutral',
    hint: 'Begründungen von Agenten, die auf fehlende Information zeigen (Aufrufziel, Zusammenarbeit).',
  },
  summary: { tone: 'neutral', hint: 'Die Zusammenfassung einer aktuellen Abgabe eines Agenten.' },
  unjudged: { tone: 'neutral', hint: 'Paare, die eine Analyse ohne Urteil gelassen hat.' },
  signal: { tone: 'neutral', hint: 'Von analyzr ohne LLM aus den Fakten erkannt.' },
  amendment: {
    tone: 'neutral',
    hint: 'Eine Ergänzung in analyzr, die der nächste Import nicht mehr anwenden kann.',
  },
};

/** Every source, presented (the server's labels, as in the export). */
export const OPEN_QUESTION_SOURCES = Object.fromEntries(
  (Object.keys(SOURCE_STYLES) as OpenQuestionSource[]).map((source) => [
    source,
    { label: OPEN_QUESTION_SOURCE_LABELS[source], ...SOURCE_STYLES[source] },
  ]),
) as Record<OpenQuestionSource, Presentation>;

export const OPEN_QUESTION_SOURCE_ORDER: readonly OpenQuestionSource[] = [
  'hold',
  'agent-question',
  'unsure',
  'no-link',
  'unjudged',
  'summary',
  'finding',
  'value-chain-finding',
  'signal',
  'amendment',
];

/** The states, as the Status filter names them (`answered`: a live outside mark, „Erledigt (außerhalb)“, M6 §4.8 b). */
export const OPEN_QUESTION_STATES: Readonly<Record<OpenQuestionState, string>> =
  OPEN_QUESTION_STATE_LABELS;

export const OPEN_QUESTION_STATE_ORDER: readonly OpenQuestionState[] = ['open', 'answered'];

/** Sources whose text is a human's or an agent's, verbatim (rendered as plain text, attributed). */
const VERBATIM: ReadonlySet<OpenQuestionSource> = new Set([
  'hold',
  'agent-question',
  'unsure',
  'no-link',
  'summary',
]);

export function isVerbatim(q: Pick<OpenQuestion, 'source'>): boolean {
  return VERBATIM.has(q.source);
}

/** Who said the verbatim text, as the line above it. */
export const VERBATIM_INTRO: Partial<Record<OpenQuestionSource, string>> = {
  hold: 'Vorgemerkt von',
  'agent-question': 'Frage von',
  unsure: 'Unsicher laut',
  'no-link': 'Kein Zusammenhang laut',
  summary: 'Zusammenfassung von',
};

/** `3 offene Entscheidungen`, `Keine offene Entscheidung`; informational items say so instead. */
export function unlocksText(q: Pick<OpenQuestion, 'kind' | 'unlocks'>): string {
  if (OPEN_QUESTION_KINDS[q.kind].informational) return 'Zur Information';
  if (q.unlocks === 0) return 'Keine offene Entscheidung';
  return q.unlocks === 1 ? '1 offene Entscheidung' : `${q.unlocks} offene Entscheidungen`;
}

/**
 * The contact hint as one line, as in the export: `Organisationseinheit: …;
 * Lanes: …; Ordner: …` (several org units joined for display only).
 */
export function askWhoText(askWho: OpenQuestionAskWho): string {
  const owners = askWho.stepOwners;
  return [
    owners.length === 0
      ? null
      : `${owners.length === 1 ? 'Organisationseinheit' : 'Organisationseinheiten'}: ${owners.join(', ')}`,
    askWho.lanes.length === 0 ? null : `Lanes: ${askWho.lanes.join(', ')}`,
    askWho.folder === null ? null : `Ordner: ${askWho.folder}`,
  ]
    .filter((p) => p !== null)
    .join('; ');
}

// ------------------------------------------------------------------ filters

/** The filters of the tab, as in the URL (`model` is the API's `modelKey`). */
export interface OpenQuestionFilters {
  kind?: OpenQuestionKind;
  source?: OpenQuestionSource;
  /** A model key or a folder (`finanzen` matches `finanzen/mahnwesen`). */
  model?: string;
  /** A lane, one step owner or the folder, exactly. */
  askWho?: string;
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

export function hasFilters(filters: OpenQuestionFilters): boolean {
  return Object.values(filters).some((v) => v !== undefined);
}

/** The query of the export route for the same filters. */
export function exportQuery(filters: OpenQuestionFilters) {
  return {
    ...(filters.model !== undefined ? { modelKey: filters.model } : {}),
    ...(filters.kind !== undefined ? { kind: filters.kind } : {}),
    ...(filters.source !== undefined ? { source: filters.source } : {}),
    ...(filters.askWho !== undefined ? { askWho: filters.askWho } : {}),
    ...(filters.state !== undefined ? { state: filters.state } : {}),
  };
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
 * applies to the same filters, so the download holds what the tab shows.
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

/** One option of a filter, with the number of items it leaves (given the other filters). */
export interface FacetOption<T extends string = string> {
  value: T;
  label: string;
  count: number;
}

export interface AskWhoGroup {
  label: string;
  options: FacetOption[];
}

export interface OpenQuestionFacets {
  kinds: FacetOption<OpenQuestionKind>[];
  sources: FacetOption<OpenQuestionSource>[];
  states: FacetOption<OpenQuestionState>[];
  folders: FacetOption[];
  models: FacetOption[];
  askWho: AskWhoGroup[];
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
 * The options of every filter: each counts the items the other filters
 * leave, lists only values with items (and the selected one), in a fixed
 * order (kinds and sources as above, models and folders by key, contact
 * hints by name).
 */
export function openQuestionFacets(
  items: readonly OpenQuestion[],
  filters: OpenQuestionFilters,
): OpenQuestionFacets {
  const without = (key: keyof OpenQuestionFilters) =>
    filterOpenQuestions(items, { ...filters, [key]: undefined });
  const keep = <T extends string>(
    order: readonly T[],
    counts: Map<T, number>,
    selected: T | undefined,
    label: (v: T) => string,
  ): FacetOption<T>[] =>
    order
      .filter((v) => (counts.get(v) ?? 0) > 0 || v === selected)
      .map((v) => ({ value: v, label: label(v), count: counts.get(v) ?? 0 }));

  const forKind = without('kind');
  const kinds = counted(OPEN_QUESTION_KIND_ORDER, forKind, (q, v) => q.kind === v);
  const forSource = without('source');
  const sources = counted(OPEN_QUESTION_SOURCE_ORDER, forSource, (q, v) => q.source === v);
  const forState = without('state');
  const states = counted(OPEN_QUESTION_STATE_ORDER, forState, (q, v) => q.state === v);

  const forModel = without('model');
  const modelKeys = new Set<string>();
  const folderKeys = new Set<string>();
  for (const q of items) {
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

  const forAskWho = without('askWho');
  const owners = new Set<string>();
  const lanes = new Set<string>();
  const folderHints = new Set<string>();
  for (const q of items) {
    for (const owner of q.askWho.stepOwners) owners.add(owner);
    for (const lane of q.askWho.lanes) lanes.add(lane);
    if (q.askWho.folder !== null) folderHints.add(q.askWho.folder);
  }
  // A value names one option, in the first group that has it.
  const seen = new Set<string>();
  const group = (label: string, values: Set<string>): AskWhoGroup => {
    const fresh = [...values].filter((v) => !seen.has(v)).sort(byLocale);
    for (const v of fresh) seen.add(v);
    const counts = counted(fresh, forAskWho, (q, v) => matchesAskWho(q.askWho, v));
    return { label, options: keep(fresh, counts, filters.askWho, (v) => v) };
  };
  const askWho = [
    group('Organisationseinheiten', owners),
    group('Lanes', lanes),
    group('Ordner', folderHints),
  ];
  if (filters.askWho !== undefined && !seen.has(filters.askWho))
    askWho.push({
      label: 'Gewählt',
      options: [{ value: filters.askWho, label: filters.askWho, count: 0 }],
    });

  return {
    kinds: keep(OPEN_QUESTION_KIND_ORDER, kinds, filters.kind, (v) => OPEN_QUESTION_KINDS[v].label),
    sources: keep(
      OPEN_QUESTION_SOURCE_ORDER,
      sources,
      filters.source,
      (v) => OPEN_QUESTION_SOURCES[v].label,
    ),
    states: keep(OPEN_QUESTION_STATE_ORDER, states, filters.state, (v) => OPEN_QUESTION_STATES[v]),
    folders: keep([...folders.keys()], folders, filters.model, (v) => `${v}/`),
    models: keep([...models.keys()], models, filters.model, (v) => v),
    askWho: askWho.filter((g) => g.options.length > 0),
  };
}

// -------------------------------------------------------------------- links

/** Where an item leads: the model view, the review screen or the value chain page. */
export type QuestionLink =
  | { to: 'model'; modelKey: string; element?: string; label: string }
  | { to: 'review'; relation: string; label: string }
  | { to: 'chain'; step?: string; placement?: string; label: string };

/** `vertrieb/auftrag#Task_1` → its model key and element id. */
function refParts(ref: string): { modelKey: string; elementId: string } {
  const at = ref.indexOf('#');
  return at <= 0
    ? { modelKey: ref, elementId: '' }
    : { modelKey: ref.slice(0, at), elementId: ref.slice(at + 1) };
}

/** Kinds about a process's place on the value chain: they also lead to the chain page. */
const CHAIN_KINDS: ReadonlySet<OpenQuestionKind> = new Set([
  'process-without-step',
  'placement-unsure',
]);

/**
 * The links of an item, by its subject: a relation to its review screen, a
 * placement, step or the chain to the value chain page, an element or a
 * process to the model view at it (and to the chain page when the question
 * is about the process's step), a model to the model view.
 */
export function questionLinks(q: Pick<OpenQuestion, 'kind' | 'subject'>): QuestionLink[] {
  const { type, id } = q.subject;
  switch (type) {
    case 'relation':
      return [{ to: 'review', relation: id, label: 'Prüfen' }];
    case 'placement':
      return [{ to: 'chain', placement: id, label: 'Auf der Kette prüfen' }];
    case 'step':
      return [{ to: 'chain', step: id, label: 'Schritt auf der Kette zeigen' }];
    case 'value-chain':
      return [{ to: 'chain', label: 'Zur Wertschöpfungskette' }];
    case 'model':
      return [{ to: 'model', modelKey: id, label: 'Modell öffnen' }];
    case 'ref':
    case 'process': {
      const { modelKey, elementId } = refParts(id);
      const model: QuestionLink = {
        to: 'model',
        modelKey,
        ...(elementId ? { element: elementId } : {}),
        label: 'Im Modell zeigen',
      };
      return CHAIN_KINDS.has(q.kind)
        ? [model, { to: 'chain', label: 'Zur Wertschöpfungskette' }]
        : [model];
    }
  }
}

/** The refs worth listing besides the subject (it has its own link). */
export function extraRefs(q: Pick<OpenQuestion, 'subject' | 'refs'>): string[] {
  return q.refs.filter((r) => r !== q.subject.id);
}

/** The items touching exactly this model (the server's `modelKey` filter also matches a folder). */
export function questionsOfModel(items: readonly OpenQuestion[], modelKey: string): OpenQuestion[] {
  return items.filter((q) => q.modelKeys.includes(modelKey));
}

/** The file name of a download from `Content-Disposition`, else `fallback`. */
export function attachmentName(header: string | null, fallback: string): string {
  const match = header === null ? null : /filename="([^"]+)"/i.exec(header);
  return match?.[1] ?? fallback;
}

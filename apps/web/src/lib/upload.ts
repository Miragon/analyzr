import type {
  AmendmentCounts,
  ExtractWarning,
  ImportFileOutcome,
  ImportImpact,
} from '@analyzr/client';
// The batches' merge of a preview (S2b follow-up) and the shared file rule and key derivation
// (M6 S1): zod-free, the runtime imports from the contracts.
import { mergeImpacts } from '@analyzr/contracts/impact-merge';
import {
  BPMN_FILE_SUFFIXES,
  bpmnSuffixOf,
  comparePaths,
  isHiddenPath,
  keyTakenBy,
  modelKeyFromPath,
  modelKeyOwners,
} from '@analyzr/contracts/paths';

import { agentCostText } from './agent-cost';
import { OUTSIDE_LABEL, RELATION_TYPES, formatBytes } from './labels';
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FILES,
  MAX_MODEL_BYTES,
  OUTSIDE_STEP,
  PROBLEM_TYPE_BASE,
} from './limits';
import { problemText } from './problem-texts';
import { trustReasonLabel } from './provenance';

/** A file picked or dropped for import, with its path below the import root. */
export interface UploadEntry {
  /** Path below the dropped folder (or the bare file name); the server slugifies it into the model key. */
  path: string;
  file: File;
}

/** The BPMN suffixes in reading order: `.bpmn`, `.bpmn2`, `.bpmn20.xml`, `.xml`. */
const SUFFIXES = [...BPMN_FILE_SUFFIXES].sort();

/** `accept` of the file picker: every BPMN suffix. */
export const BPMN_ACCEPT = SUFFIXES.join(',');

/** „.bpmn, .bpmn2, .bpmn20.xml und .xml“ for texts. */
export const BPMN_SUFFIX_TEXT = `${SUFFIXES.slice(0, -1).join(', ')} und ${SUFFIXES.at(-1) ?? ''}`;

/**
 * Drops the first segment of a folder path: dropping `models/` imports
 * `models/vertrieb/auftrag.bpmn` as `vertrieb/auftrag.bpmn`, like
 * `analyzr import models`.
 */
export function stripRoot(path: string): string {
  const slash = path.indexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

/** Files from `<input type="file" webkitdirectory>` or a plain multi-file input. */
export function entriesFromFileList(files: Iterable<File>): UploadEntry[] {
  return [...files].map((file) => ({
    path: file.webkitRelativePath ? stripRoot(file.webkitRelativePath) : file.name,
    file,
  }));
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walk(entry: FileSystemEntry, prefix: string, out: UploadEntry[]): Promise<void> {
  if (entry.isFile) {
    out.push({ path: `${prefix}${entry.name}`, file: await fileOf(entry as FileSystemFileEntry) });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns at most ~100 entries per call; repeat until empty.
  for (;;) {
    const batch = await readEntries(reader);
    if (batch.length === 0) break;
    for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out);
  }
}

/**
 * Files of a drop, folders included. A dropped folder is the import root:
 * its own name is not part of the paths.
 */
export async function entriesFromDataTransfer(data: DataTransfer): Promise<UploadEntry[]> {
  const roots = [...data.items]
    .filter((item) => item.kind === 'file')
    .map((item) => ({ entry: item.webkitGetAsEntry?.() ?? null, file: item.getAsFile() }));
  const out: UploadEntry[] = [];
  for (const { entry, file } of roots) {
    if (entry?.isDirectory) {
      const inner: UploadEntry[] = [];
      await walk(entry, '', inner);
      out.push(...inner.map((e) => ({ ...e, path: stripRoot(e.path) })));
    } else if (file) {
      out.push({ path: file.name, file });
    }
  }
  return out;
}

/**
 * A file that is not imported: `not-bpmn` (no BPMN suffix, or a plain `.xml`
 * the server found to be no BPMN), `too-large`, or `key-taken`: a plain `.xml`
 * whose model key a `.bpmn…` file of this import has (a tool's sidecar
 * `Prozess.xml` next to `Prozess.bpmn`), never sent; `takenBy` names that file.
 */
export type SkippedFile =
  | { path: string; reason: 'not-bpmn' | 'too-large' }
  | { path: string; reason: 'key-taken'; takenBy: string };

/** Why a file was skipped, in German: „kein BPMN“, „größer als 5,0 MB“, „gleicher Kurzname wie Prozess.bpmn“. */
export function skippedReasonText(skipped: SkippedFile): string {
  switch (skipped.reason) {
    case 'not-bpmn':
      return 'kein BPMN';
    case 'too-large':
      return `größer als ${formatBytes(MAX_MODEL_BYTES)}`;
    case 'key-taken':
      return `gleicher Kurzname wie ${skipped.takenBy}`;
  }
}

export interface UploadPlan {
  /** Batches for `POST …/imports`, each within the file and byte limits. */
  batches: UploadEntry[][];
  /** Files that are not sent, with the reason. */
  skipped: SkippedFile[];
  /**
   * Files that are not sent because their path gives no valid model key or
   * another file gets their key (other than a `key-taken` skip), as `failed`
   * outcomes in the server's wording.
   */
  failed: ImportFileOutcome[];
}

/**
 * A `validation-failed` outcome decided before sending, worded as the server
 * words it, with its `reason` for the German text ({@link fileProblemText}):
 * `no-model-key`, or `duplicate-key` with the file that gets the key (`owner`).
 */
function failedLocally(
  path: string,
  modelKey: string | null,
  detail: string,
  why: { reason: 'no-model-key' } | { reason: 'duplicate-key'; owner: string },
): ImportFileOutcome {
  return {
    path,
    modelKey,
    outcome: 'failed',
    problem: {
      type: `${PROBLEM_TYPE_BASE}validation-failed`,
      title: 'Validation failed',
      status: 422,
      code: 'validation-failed',
      detail,
      ...why,
    },
  };
}

/**
 * Filters BPMN files (the shared file rule of `@analyzr/contracts/paths`:
 * hidden files are dropped silently, others without a BPMN suffix are
 * skipped `not-bpmn`), derives each model key as the server does and splits
 * the rest into batches the import endpoint accepts, in path order
 * (`comparePaths`, as `analyzr import`). A file without a valid key, or whose
 * key another file gets, fails before sending: in another batch the server
 * could not tell, and it would revise the first. A key goes to the first
 * `.bpmn…` file and only then to a plain `.xml` (`modelKeyOwners`), so an XML
 * that may be no BPMN never keeps a model out. A plain `.xml` whose key a
 * `.bpmn…` file got is skipped (`key-taken`, `keyTakenBy`), as `analyzr
 * import` does; every other duplicate fails, naming the file that gets the key.
 */
export function planUpload(
  entries: readonly UploadEntry[],
  limits = {
    maxFiles: MAX_IMPORT_FILES,
    maxBytes: MAX_IMPORT_BYTES,
    maxModelBytes: MAX_MODEL_BYTES,
  },
  bundle: {
    /** A path's key: with a bundle's manifest the key it pins, else the path's (UX8). */
    keyOf?: (path: string) => string | null;
    /** The bundle's own files (manifest, chain, inventory): neither sent nor skipped. */
    own?: ReadonlySet<string>;
  } = {},
): UploadPlan {
  const keyOf = bundle.keyOf ?? modelKeyFromPath;
  const skipped: UploadPlan['skipped'] = [];
  const failed: UploadPlan['failed'] = [];
  const batches: UploadEntry[][] = [];
  let batch: UploadEntry[] = [];
  let bytes = 0;
  const sorted = [...entries]
    .filter((entry) => !isHiddenPath(entry.path) && !bundle.own?.has(entry.path))
    .sort((a, b) => comparePaths(a.path, b.path));
  const owners = modelKeyOwners(
    sorted
      .filter((e) => bpmnSuffixOf(e.path) !== null && e.file.size <= limits.maxModelBytes)
      .map((e) => e.path),
    keyOf,
  );
  const sent = new Set<string>();
  for (const entry of sorted) {
    if (bpmnSuffixOf(entry.path) === null) {
      skipped.push({ path: entry.path, reason: 'not-bpmn' });
      continue;
    }
    const key = keyOf(entry.path);
    if (key === null) {
      failed.push(
        failedLocally(entry.path, null, 'the path gives no valid model key', {
          reason: 'no-model-key',
        }),
      );
      continue;
    }
    const takenBy = keyTakenBy(entry.path, owners, keyOf);
    if (takenBy !== null) {
      skipped.push({ path: entry.path, reason: 'key-taken', takenBy });
      continue;
    }
    const owner = owners.get(key);
    if (owner !== undefined && (owner !== entry.path || sent.has(key))) {
      failed.push(
        failedLocally(
          entry.path,
          key,
          `another file of this import has model key ${key} (${owner})`,
          { reason: 'duplicate-key', owner },
        ),
      );
      continue;
    }
    if (entry.file.size > limits.maxModelBytes) {
      skipped.push({ path: entry.path, reason: 'too-large' });
      continue;
    }
    sent.add(key);
    if (batch.length >= limits.maxFiles || bytes + entry.file.size > limits.maxBytes) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(entry);
    bytes += entry.file.size;
  }
  if (batch.length > 0) batches.push(batch);
  return { batches, skipped, failed };
}

/**
 * A plain `.xml` file the server refused as no BPMN (422 `bpmn-invalid`,
 * reason `not-bpmn`): listed with the skipped files, not as a failed model.
 * Every other refusal (a DOCTYPE, for example) stays `failed`.
 */
export function isSkippedXml(outcome: ImportFileOutcome): boolean {
  return (
    outcome.outcome === 'failed' &&
    outcome.problem?.code === 'bpmn-invalid' &&
    outcome.problem['reason'] === 'not-bpmn' &&
    bpmnSuffixOf(outcome.path) === '.xml'
  );
}

/** German labels of the extractor's warning codes (`ExtractWarning.code`); the skill's report uses the same. */
const WARNING_LABELS: Readonly<Record<string, string>> = {
  'parse-warning': 'Unbekannter oder fehlerhafter Inhalt',
  'missing-id': 'Element ohne ID übersprungen',
  'invalid-id': 'Ungültige ID: Element übersprungen',
  'duplicate-id': 'Doppelte ID: zweites Element übersprungen',
  'call-without-target': 'Aufruf ohne Ziel',
  'multiple-event-definitions': 'Mehrere Ereignisdefinitionen',
  'message-flow-unresolved': 'Nachrichtenfluss ohne gültiges Ende übersprungen',
  'label-truncated': 'Text gekürzt',
  'key-truncated': 'Text gekürzt',
  'documentation-truncated': 'Text gekürzt',
  'too-many-warnings': 'Weitere Hinweise ausgelassen',
};

/** The German label of a warning code; an unknown code shows the code itself. */
export function warningLabel(code: string): string {
  return Object.hasOwn(WARNING_LABELS, code) ? (WARNING_LABELS[code] ?? code) : code;
}

/** The converter skill that cleans up an export (M6 S3), named in remedies. */
export const INTEGRATE_SKILL = '/analyzr-integrate:integrate-landscape';

/** BPMN element types in German, by their local name; others read „Element“. */
const ELEMENT_TYPES: Readonly<Record<string, string>> = {
  task: 'Aufgabe',
  userTask: 'Benutzeraufgabe',
  serviceTask: 'Serviceaufgabe',
  sendTask: 'Sendeaufgabe',
  receiveTask: 'Empfangsaufgabe',
  manualTask: 'Manuelle Aufgabe',
  scriptTask: 'Skriptaufgabe',
  businessRuleTask: 'Geschäftsregelaufgabe',
  callActivity: 'Aufrufaktivität',
  subProcess: 'Teilprozess',
  transaction: 'Transaktion',
  startEvent: 'Startereignis',
  endEvent: 'Endereignis',
  intermediateThrowEvent: 'Zwischenereignis',
  intermediateCatchEvent: 'Zwischenereignis',
  boundaryEvent: 'Randereignis',
  exclusiveGateway: 'Gateway',
  inclusiveGateway: 'Gateway',
  parallelGateway: 'Gateway',
  eventBasedGateway: 'Gateway',
  complexGateway: 'Gateway',
  sequenceFlow: 'Sequenzfluss',
  messageFlow: 'Nachrichtenfluss',
  dataStoreReference: 'Datenspeicher',
  dataObjectReference: 'Datenobjekt',
  dataObject: 'Datenobjekt',
  participant: 'Pool',
  lane: 'Lane',
  process: 'Prozess',
  textAnnotation: 'Textanmerkung',
  association: 'Assoziation',
  message: 'Nachricht',
  signal: 'Signal',
};

/** `bpmn:dataStoreReference` (an XML tag) or `bpmn:DataStoreReference` (a moddle type) → „Datenspeicher“. */
export function elementTypeLabel(type: string): string {
  const name = type.slice(type.indexOf(':') + 1);
  const local = name.charAt(0).toLowerCase() + name.slice(1);
  return Object.hasOwn(ELEMENT_TYPES, local) ? (ELEMENT_TYPES[local] ?? 'Element') : 'Element';
}

/** An element the parser skipped, as its warning names it. */
export interface SkippedElement {
  /** The German type („Aufgabe“), „Element“ where the message names none. */
  type: string;
  id: string;
}

/** Why elements were skipped: an id that is not a valid XML or element id, or a second use of one. */
export type SkipCause = 'invalid-id' | 'duplicate-id';

/**
 * A file's warnings as the result lists them (UX-SIMPLIFICATION.md §3.9 item
 * 3): the elements skipped for the same cause in one entry, the lines about
 * their diagram shapes and the references to them folded into it (`raw`
 * keeps every message for „Technische Details“); every other warning one
 * entry of its own.
 */
export type WarningGroup =
  | { kind: 'skipped'; cause: SkipCause; elements: SkippedElement[]; raw: ExtractWarning[] }
  | { kind: 'single'; warning: ExtractWarning };

/** bpmn-moddle's message for an element it could not read: its type, and the id's fault. */
const UNPARSABLE =
  /^unparsable content <([^>]+)> detected\b.*\bnested error: (illegal|duplicate) ID <([^>]*)>/;
const UNRESOLVED = /^unresolved reference <([^>]*)>/;
/** The extractor's own: `<bpmn:Task> id "x y" is not a valid element id; skipped`. */
const INVALID_ID = /^<([^>]+)> id (".*") is not a valid element id; skipped$/;

/** A shape, edge or other diagram element (`bpmndi:BPMNShape`, Signavio's `sbpmndi:…`). */
const isDiagramType = (type: string) => /(^|:)BPMN[A-Z]\w*$/.test(type) || /^\w*di:/i.test(type);

function parseJsonString(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** The element a warning says was skipped, with its cause; `null` for any other warning. */
function skippedOf(w: ExtractWarning): { cause: SkipCause; type: string; id: string } | null {
  if (w.code === 'parse-warning') {
    const m = UNPARSABLE.exec(w.message);
    if (!m) return null;
    const [, type = '', fault, id = ''] = m;
    return { cause: fault === 'illegal' ? 'invalid-id' : 'duplicate-id', type, id };
  }
  if (w.code === 'invalid-id') {
    const m = INVALID_ID.exec(w.message);
    const id = m?.[2] === undefined ? null : parseJsonString(m[2]);
    return id === null ? null : { cause: 'invalid-id', type: m?.[1] ?? '', id };
  }
  if (w.code === 'duplicate-id' && w.elementId)
    return { cause: 'duplicate-id', type: '', id: w.elementId };
  return null;
}

/**
 * Groups a file's listed warnings ({@link warningDisplay}`.listed`) for
 * display: skipped elements by cause, in the order their first element
 * appears; a diagram shape of the same cause and an unresolved reference to
 * a skipped element fold into that entry. A diagram line without a skipped
 * element of its cause, and every other warning, stays an entry of its own.
 */
export function groupWarnings(listed: readonly ExtractWarning[]): WarningGroup[] {
  type Skipped = Extract<WarningGroup, { kind: 'skipped' }>;
  const parsed = listed.map(skippedOf);
  const byCause = new Map<SkipCause, Skipped>();
  const byElement = new Map<string, Skipped>();
  // The elements first, so a shape or a reference listed before its element still folds in.
  for (const s of parsed) {
    if (s === null || isDiagramType(s.type)) continue;
    let group = byCause.get(s.cause);
    if (!group) {
      group = { kind: 'skipped', cause: s.cause, elements: [], raw: [] };
      byCause.set(s.cause, group);
    }
    if (!byElement.has(s.id)) {
      group.elements.push({ type: s.type === '' ? 'Element' : elementTypeLabel(s.type), id: s.id });
      byElement.set(s.id, group);
    }
  }
  const out: WarningGroup[] = [];
  const placed = new Set<Skipped>();
  for (const [i, w] of listed.entries()) {
    const s = parsed[i];
    const reference = w.code === 'parse-warning' ? UNRESOLVED.exec(w.message)?.[1] : undefined;
    const group = s
      ? byCause.get(s.cause)
      : reference === undefined
        ? undefined
        : byElement.get(reference);
    if (group === undefined) {
      out.push({ kind: 'single', warning: w });
      continue;
    }
    group.raw.push(w);
    if (!placed.has(group)) {
      placed.add(group);
      out.push(group);
    }
  }
  return out;
}

/** „Aufgabe „X“, Datenspeicher „4711““. */
function elementsText(elements: readonly SkippedElement[]): string {
  return elements.map((e) => `${e.type} „${e.id}“`).join(', ');
}

/**
 * The sentence of a skipped group: „2 Elemente übersprungen, weil ihre ID
 * ungültig ist: Aufgabe „Aufgabe_Bonität_prüfen“, Datenspeicher „4711“.“ and
 * what that means, „Sie fehlen im Diagramm und in den Verbindungen.“
 */
export function skippedGroupText(group: Extract<WarningGroup, { kind: 'skipped' }>): {
  what: string;
  effect: string;
} {
  const one = group.elements.length === 1;
  const count = one ? '1 Element' : `${group.elements.length} Elemente`;
  const why =
    group.cause === 'invalid-id'
      ? `weil ${one ? 'seine' : 'ihre'} ID ungültig ist`
      : `weil ${one ? 'seine' : 'ihre'} ID schon vergeben ist`;
  return {
    what: `${count} übersprungen, ${why}: ${elementsText(group.elements)}.`,
    effect: `${one ? 'Es fehlt' : 'Sie fehlen'} im Diagramm und in den Verbindungen.`,
  };
}

/**
 * „N Hinweise“ of a file: every skipped element counts once, every other
 * entry once, and the warnings the server did not list (`unlisted`) too.
 */
export function warningGroupCount(groups: readonly WarningGroup[], unlisted: number): number {
  return groups.reduce((n, g) => n + (g.kind === 'skipped' ? g.elements.length : 1), 0) + unlisted;
}

/** What the server said about a file, for „Technische Details“: `Validation failed (422): …`. */
export function problemDetail(problem: NonNullable<ImportFileOutcome['problem']>): string {
  return `${problem.title} (${problem.status})${problem.detail ? `: ${problem.detail}` : ''}`;
}

/**
 * Why a file was not imported, in German (UX-SIMPLIFICATION.md §3.9 item 5),
 * by the problem's code, `reason` and `encoding` (M6 contracts:
 * `ImportFileOutcome.problem`), with the remedy where there is one; the
 * server's English words are {@link problemDetail}.
 */
export function fileProblemText(problem: NonNullable<ImportFileOutcome['problem']>): string {
  const reason = problem['reason'];
  const remedy = `Speichere sie als UTF-8 oder wandle den Export mit ${INTEGRATE_SKILL} um.`;
  if (problem.code === 'bpmn-invalid') {
    switch (reason) {
      case 'not-xml':
        if (problem['encoding'] === 'utf-16')
          return `Die Datei ist UTF-16-kodiert; analyzr liest nur UTF-8. ${remedy}`;
        if (problem['encoding'] === 'not-utf-8')
          return `Die Datei ist nicht UTF-8-kodiert (oft ISO-8859-1 oder Windows-1252); analyzr liest nur UTF-8. ${remedy}`;
        return 'Die Datei ist kein vollständiges XML, zum Beispiel fehlt ein schließendes Element. Exportier das Modell erneut.';
      case 'not-bpmn':
        return 'Die Datei enthält kein BPMN-2.0-Modell.';
      case 'doctype-forbidden':
      case 'entity-forbidden':
        return 'Die Datei enthält eine DOCTYPE- oder ENTITY-Angabe; solche Dateien liest analyzr aus Sicherheitsgründen nicht. Entferne die Angabe und lade die Datei erneut hoch.';
      case 'too-many-elements':
        return 'Das Modell hat mehr als 50.000 XML-Elemente; teile es auf mehrere Dateien auf.';
      case 'invalid-model-key':
        return 'Aus dem Pfad ergibt sich kein gültiger Kurzname.';
    }
  }
  if (problem.code === 'payload-too-large')
    return `Die Datei ist größer als ${formatBytes(MAX_MODEL_BYTES)}.`;
  if (problem.code === 'validation-failed') {
    if (reason === 'no-model-key') return 'Aus dem Pfad ergibt sich kein gültiger Kurzname.';
    if (reason === 'duplicate-key' && typeof problem['owner'] === 'string')
      return `Eine andere Datei dieses Imports bekommt denselben Kurznamen: ${problem['owner']}.`;
  }
  return problemText(problem.code, reason);
}

/** A file's warnings as the result lists them, split for display. */
export interface WarningDisplay {
  /** The listed entries, without the extractor's `too-many-warnings` entry. */
  listed: readonly ExtractWarning[];
  /** The extractor's `too-many-warnings` entry („N more warnings omitted“), which the server lists last. */
  omitted?: ExtractWarning;
  /** The warnings the extractor counted, without that entry. */
  count: number;
  /** Counted warnings the result does not list. */
  unlisted: number;
}

/**
 * Splits a result's `warnings` and `warningCount` for display, as
 * `analyzr import` does: beyond 100 warnings the server lists the first 19
 * and the extractor's `too-many-warnings` entry, which is shown after the
 * unlisted ones („… und 81 weitere“) and not counted itself.
 */
export function warningDisplay(
  warnings: readonly ExtractWarning[],
  warningCount: number,
): WarningDisplay {
  const last = warnings.at(-1);
  const omitted = last?.code === 'too-many-warnings' ? last : undefined;
  const listed = omitted ? warnings.slice(0, -1) : warnings;
  const count = omitted ? warningCount - 1 : warningCount;
  return {
    listed,
    ...(omitted ? { omitted } : {}),
    count,
    unlisted: Math.max(0, count - listed.length),
  };
}

/**
 * What became of a model's amendments at an upload (M6 S5c-2), as the CLI
 * says it: „2 Ergänzungen angewendet, 1 im Quellsystem übernommen, 1
 * Konflikt“; `null` for a model without live amendments.
 */
export function amendmentCountsText(counts: AmendmentCounts | undefined): string | null {
  if (!counts) return null;
  const { applied, inSource, conflicts } = counts;
  const parts = [
    applied.count > 0
      ? `${applied.count === 1 ? '1 Ergänzung' : `${applied.count} Ergänzungen`} angewendet`
      : null,
    inSource.count > 0 ? `${inSource.count} im Quellsystem übernommen` : null,
    conflicts.count > 0
      ? conflicts.count === 1
        ? '1 Konflikt'
        : `${conflicts.count} Konflikte`
      : null,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : parts.join(', ');
}

/** „1 Hinweis“, „3 Hinweise“. */
export function warningCountText(count: number): string {
  return count === 1 ? '1 Hinweis' : `${count} Hinweise`;
}

/**
 * The multipart parts of one import batch. The part's file name carries the
 * path, from which the server derives the model key.
 */
export function filesOf(batch: readonly UploadEntry[]): File[] {
  return batch.map(
    ({ path, file }) =>
      new File([file], path, {
        type: file.type || 'application/xml',
        lastModified: file.lastModified,
      }),
  );
}

/** `1 Datei`, `3 Dateien`. */
function fileCount(n: number): string {
  return n === 1 ? '1 Datei' : `${n} Dateien`;
}

/**
 * The result's headline (UX-SIMPLIFICATION.md §3.9 item 1): „5 Modelle
 * importiert · 1 Fehler · 1 übersprungen“, only the non-zero parts besides
 * the imported (created or revised) models; while it runs „Importiere … 3
 * von 6 Dateien“.
 */
export function importHeadline(
  outcomes: readonly Pick<ImportFileOutcome, 'outcome' | 'importWarnings'>[],
  skipped: number,
  progress?: { total: number },
): string {
  if (progress) return `Importiere … ${outcomes.length} von ${fileCount(progress.total)}`;
  const count = (o: ImportFileOutcome['outcome']) => outcomes.filter((x) => x.outcome === o).length;
  const imported = count('created') + count('revised');
  // A tool id that moved or changed (UX8): the identity of a model is in question.
  const identity = outcomes
    .flatMap((o) => o.importWarnings ?? [])
    .filter((w) => w.code === 'external-id-moved' || w.code === 'external-id-changed').length;
  const parts = [
    imported === 0
      ? 'Kein Modell importiert'
      : `${imported === 1 ? '1 Modell' : `${imported} Modelle`} importiert`,
    count('unchanged') > 0 ? `${count('unchanged')} unverändert` : null,
    count('failed') > 0 ? `${count('failed')} Fehler` : null,
    skipped > 0 ? `${skipped} übersprungen` : null,
    identity === 0
      ? null
      : identity === 1
        ? '1 Hinweis zur Identität'
        : `${identity} Hinweise zur Identität`,
  ];
  return parts.filter((p) => p !== null).join(' · ');
}

/** Skipped files the result names inline; the rest under „und N weitere“. */
export const SKIPPED_INLINE = 3;

/**
 * The skipped files in one line (§3.9 item 5): „1 Datei übersprungen:
 * Prozesslandkarte.pdf (kein BPMN)“, at most {@link SKIPPED_INLINE} named,
 * the rest counted („und 2 weitere“).
 */
export function skippedText(skipped: readonly SkippedFile[]): { text: string; more: number } {
  const named = skipped
    .slice(0, SKIPPED_INLINE)
    .map((s) => `${s.path} (${skippedReasonText(s)})`)
    .join(', ');
  const more = Math.max(0, skipped.length - SKIPPED_INLINE);
  return {
    text: `${fileCount(skipped.length)} übersprungen: ${named}${more > 0 ? ` und ${more} weitere` : ''}`,
    more,
  };
}

/**
 * What waits for an agent after an import, as `analyzr import` says it
 * (`formatNextSteps`): the models whose relations task is queued (their
 * stage `waiting_for_agent`) and the chain's placement task when it is
 * queued; `null` when nothing waits.
 */
export function waitingText(waitingModels: number, placementQueued: boolean): string | null {
  if (waitingModels === 0 && !placementQueued) return null;
  if (waitingModels === 0) return 'Die Platzierungen warten auf den Agenten';
  const models = waitingModels === 1 ? '1 Modell' : `${waitingModels} Modelle`;
  if (placementQueued) return `${models} und die Platzierungen warten auf den Agenten`;
  return waitingModels === 1
    ? '1 Modell wartet auf den Agenten'
    : `${models} warten auf den Agenten`;
}

/**
 * „12 eindeutige Aufrufe warten auf deine Bestätigung“ (M6 S2c): the open
 * unique calls from derived models after an import, the group „Gesammelt
 * annehmen“ opens; `null` for none.
 */
export function callsWaitingText(calls: number): string | null {
  if (calls === 0) return null;
  return calls === 1
    ? '1 eindeutiger Aufruf wartet auf deine Bestätigung'
    : `${calls} eindeutige Aufrufe warten auf deine Bestätigung`;
}

/** „9 offene Fragen gibt es schon jetzt“; `null` for none. */
export function askNowText(ask: number): string | null {
  if (ask === 0) return null;
  return ask === 1
    ? '1 offene Frage gibt es schon jetzt'
    : `${ask} offene Fragen gibt es schon jetzt`;
}

// ------------------------------------------------------------- the preview (M6 S2b)

/**
 * The impacts of a preview's batches as one, as `analyzr import --dry-run`
 * merges them (the zod-free merge of `@analyzr/contracts/impact-merge`):
 * files and counts added up, items concatenated up to the server's cap of
 * 100; the absent keys are the first batch's (each batch sends the whole
 * manifest).
 */
export { mergeImpacts };

/**
 * The preview's headline (UX-SIMPLIFICATION.md §6): „Vorschau: 5 Modelle neu
 * · 1 neue Revision · 1 Fehler · 1 übersprungen“, the non-zero parts.
 */
export function previewHeadline(
  outcomes: readonly Pick<ImportFileOutcome, 'outcome'>[],
  skipped: number,
): string {
  const count = (o: ImportFileOutcome['outcome']) => outcomes.filter((x) => x.outcome === o).length;
  const created = count('created');
  const revised = count('revised');
  const parts = [
    created > 0 ? `${created === 1 ? '1 Modell' : `${created} Modelle`} neu` : null,
    revised > 0 ? `${revised === 1 ? '1 neue Revision' : `${revised} neue Revisionen`}` : null,
    count('unchanged') > 0 ? `${count('unchanged')} unverändert` : null,
    count('failed') > 0 ? `${count('failed')} Fehler` : null,
    skipped > 0 ? `${skipped} übersprungen` : null,
  ].filter((p) => p !== null);
  return `Vorschau: ${parts.length === 0 ? 'nichts zu importieren' : parts.join(' · ')}`;
}

/** A count as German text: „1.234“. */
const de = (n: number) => n.toLocaleString('de-DE');

/** „deine Regel „Signavio-Export“ nimmt“, or „deine Regeln nehmen“ for more than one (M6 S2c-3). */
function rulesWho(auto: NonNullable<ImportImpact['autoAcceptedCalls']>): string {
  const [one] = auto.byRule;
  return auto.byRule.length === 1 && one
    ? `deine Regel „${one.ruleName}“ nimmt`
    : 'deine Regeln nehmen';
}

/**
 * What an owner's rules for derived calls accept at once in the import's
 * write (M6 S2c-3, `autoAcceptedCalls`, only an owner's preview has it):
 * after the calls the import proposes, „deine Regel „Signavio-Export“ nimmt
 * 12 davon gleich an“, with „und 3 bereits vorgeschlagene“ for calls
 * proposed before that the import proposes again (`ofProposed` tells them
 * apart); without calls proposed anew, a line of its own („1 bereits
 * vorgeschlagener Aufruf – deine Regel „…“ nimmt ihn gleich an“). `null`
 * for none.
 */
export function autoAcceptedText(impact: ImportImpact): string | null {
  const auto = impact.autoAcceptedCalls;
  if (!auto || auto.count === 0) return null;
  const who = rulesWho(auto);
  const proposed = impact.callsProposed.count;
  const of = Math.min(auto.ofProposed, auto.count, proposed);
  const again = auto.count - of;
  if (proposed === 0) {
    return again === 1
      ? `1 bereits vorgeschlagener Aufruf – ${who} ihn gleich an`
      : `${de(again)} bereits vorgeschlagene Aufrufe – ${who} sie gleich an`;
  }
  const parts = [
    of > 0 ? `${de(of)} davon` : null,
    again > 0 ? `${de(again)} bereits ${again === 1 ? 'vorgeschlagenen' : 'vorgeschlagene'}` : null,
  ].filter((p) => p !== null);
  return `${who} ${parts.join(' und ')} gleich an`;
}

/**
 * At most three lines of what the import would change, the weightiest
 * first: calls the rule tier would link, unique calls of derived models it
 * only proposes (M6 S2c, the trust rule, with the reason most of them rest
 * on; since S2c-3 with what an owner's rules for derived calls accept at
 * once, {@link autoAcceptedText}, and without „gesammelt annehmen“ when
 * they take every call proposed anew),
 * accepted relations whose end changes or goes missing, accepted placements
 * whose process does (S2b follow-up, with a live chain), rule proposals
 * added, stances withdrawn, models of the system the bundle no longer names
 * (kept), findings added. The agent work the import sets off (S2b follow-up
 * step 3, {@link agentCostText}, „etwa“ for a preview of several `batches`)
 * always takes the last of the three, on a first import too; an unchanged
 * re-import has none.
 */
export function impactLines(impact: ImportImpact, batches = 1): string[] {
  const n = (count: number, one: string, many: string) =>
    `${de(count)} ${count === 1 ? one : many}`;
  // The reason most calls rest on (the server counts each under its caller's first one).
  const reason = [...impact.callsProposed.byReason].sort((a, b) => b.count - a.count)[0]?.reason;
  const proposed = impact.callsProposed.count;
  // How many of the calls proposed anew the rules take; the rest waits for „gesammelt annehmen“.
  const taken = Math.min(impact.autoAcceptedCalls?.ofProposed ?? 0, proposed);
  const rules = autoAcceptedText(impact);
  const placements = impact.placementsChanged?.count ?? 0;
  const lines = [
    impact.acceptedCalls.count > 0
      ? `${n(impact.acceptedCalls.count, 'Aufruf', 'Aufrufe')} automatisch verknüpft`
      : null,
    proposed > 0
      ? `${n(proposed, 'Aufruf', 'Aufrufe')} nur vorgeschlagen${reason ? ` (${trustReasonLabel(reason)})` : ''}` +
        (taken >= proposed ? '' : ' – nach dem Import gesammelt annehmen') +
        (rules ? ` · ${rules}` : '')
      : rules,
    impact.endpointsChanged.count > 0
      ? `${n(impact.endpointsChanged.count, 'angenommene Relation', 'angenommene Relationen')} mit geändertem oder fehlendem Endpunkt`
      : null,
    placements > 0
      ? `${n(placements, 'angenommene Platzierung', 'angenommene Platzierungen')} mit geändertem oder fehlendem Prozess`
      : null,
    impact.proposalsAdded.count > 0
      ? `${n(impact.proposalsAdded.count, 'neuer Vorschlag', 'neue Vorschläge')} der Regeln zu prüfen`
      : null,
    impact.proposalsWithdrawn.count > 0
      ? `${n(impact.proposalsWithdrawn.count, 'Vorschlag', 'Vorschläge')} der Regeln zurückgezogen`
      : null,
    impact.absentKeys.count > 0
      ? `${n(impact.absentKeys.count, 'Modell', 'Modelle')} des Quellsystems nicht im Bundle (bleiben erhalten)`
      : null,
    impact.findingsAdded.count > 0
      ? `${n(impact.findingsAdded.count, 'neuer Befund', 'neue Befunde')}`
      : null,
  ].filter((l) => l !== null);
  const cost = agentCostText(impact, batches);
  return cost ? [...lines.slice(0, 2), cost] : lines.slice(0, 3);
}

/** A pair judged again in „Was ändert sich?“: „Aufruf a#Call_X → b#Process_Y“. */
export function rejudgedText(
  r: ImportImpact['relationsTasks']['rejudged']['items'][number],
): string {
  return `${RELATION_TYPES[r.type].label} ${r.from} → ${r.to}`;
}

/**
 * An accepted placement whose process changes, in „Was ändert sich?“:
 * „lager/versand#Process_1 → „Versand“ (fehlt)“, „… → Außerhalb der Kette
 * (geändert)“; a step without a name by its id.
 */
export function placementChangeText(
  p: NonNullable<ImportImpact['placementsChanged']>['items'][number],
): string {
  const step = p.step === OUTSIDE_STEP ? OUTSIDE_LABEL : p.stepName ? `„${p.stepName}“` : p.step;
  return `${p.process} → ${step} (${p.endpointState === 'missing' ? 'fehlt' : 'geändert'})`;
}

/**
 * The folder every key starts with (two keys or more), for the hint „Alle
 * Kurznamen beginnen mit „x/““: keys are fixed for good (M6 §3.4), so a
 * dropped parent folder should not become part of every name.
 */
export function sharedTopFolder(keys: readonly string[]): string | null {
  if (keys.length < 2) return null;
  const firsts = new Set(keys.map((k) => (k.includes('/') ? k.slice(0, k.indexOf('/')) : null)));
  const [only] = [...firsts];
  return firsts.size === 1 && only != null ? only : null;
}

/**
 * The note under a preview of several batches (M6 S2b): each batch is
 * previewed against the head without the others, so a call into another
 * batch shows as unresolved; with new models in two batches or more (a first
 * import), the possible relations between them count in no batch, so the
 * cost line's „etwa“ falls short, and the note says so too. `null` for one
 * batch.
 */
export function batchNoteText(
  batches: readonly (readonly { path: string }[])[],
  outcomes: readonly { path: string; outcome: string }[],
): string | null {
  if (batches.length < 2) return null;
  const created = new Set(outcomes.flatMap((o) => (o.outcome === 'created' ? [o.path] : [])));
  const apart = batches.filter((b) => b.some((e) => created.has(e.path))).length > 1;
  return `Vorschau je 50 Dateien; Aufrufe zwischen den Teilen erscheinen hier als unaufgelöst${
    apart
      ? ', mögliche Relationen zwischen neuen Modellen verschiedener Teile fehlen in der Zahl'
      : ''
  }.`;
}

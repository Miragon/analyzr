import type { ExtractWarning, ImportFileOutcome } from '@analyzr/client';
// The shared file rule and key derivation (M6 S1): zod-free, the one runtime import from the contracts.
import {
  BPMN_FILE_SUFFIXES,
  bpmnSuffixOf,
  comparePaths,
  isHiddenPath,
  keyTakenBy,
  modelKeyFromPath,
  modelKeyOwners,
} from '@analyzr/contracts/paths';

import { MAX_IMPORT_BYTES, MAX_IMPORT_FILES, MAX_MODEL_BYTES, PROBLEM_TYPE_BASE } from './limits';

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

/** Why a file was skipped, in German: „kein BPMN“, „zu groß“, „gleicher Modellschlüssel wie Prozess.bpmn“. */
export function skippedReasonText(skipped: SkippedFile): string {
  switch (skipped.reason) {
    case 'not-bpmn':
      return 'kein BPMN';
    case 'too-large':
      return 'zu groß';
    case 'key-taken':
      return `gleicher Modellschlüssel wie ${skipped.takenBy}`;
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

/** A `validation-failed` outcome decided before sending, worded as the server words it. */
function failedLocally(path: string, modelKey: string | null, detail: string): ImportFileOutcome {
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
): UploadPlan {
  const skipped: UploadPlan['skipped'] = [];
  const failed: UploadPlan['failed'] = [];
  const batches: UploadEntry[][] = [];
  let batch: UploadEntry[] = [];
  let bytes = 0;
  const sorted = [...entries]
    .filter((entry) => !isHiddenPath(entry.path))
    .sort((a, b) => comparePaths(a.path, b.path));
  const owners = modelKeyOwners(
    sorted
      .filter((e) => bpmnSuffixOf(e.path) !== null && e.file.size <= limits.maxModelBytes)
      .map((e) => e.path),
  );
  const sent = new Set<string>();
  for (const entry of sorted) {
    if (bpmnSuffixOf(entry.path) === null) {
      skipped.push({ path: entry.path, reason: 'not-bpmn' });
      continue;
    }
    const key = modelKeyFromPath(entry.path);
    if (key === null) {
      failed.push(failedLocally(entry.path, null, 'the path gives no valid model key'));
      continue;
    }
    const takenBy = keyTakenBy(entry.path, owners);
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

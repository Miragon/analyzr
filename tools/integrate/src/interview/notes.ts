/**
 * The guide's optional notes file `interviews/guides/<name>.notes.yaml` (format
 * `analyzr-guide-notes/1`, M6 S6 §2.4): what the agent adds from the landscape (analyzr's
 * read-only MCP tools) — the processes the landscape knows in the group's area, per question at
 * most one short statement of what the landscape already says and up to three follow-up
 * questions in the guide's „du“. Agent-written, so the script checks it before anything is
 * rendered: parsed with the shared strict YAML reader, every key known, every id one of the
 * questions of the guide's groups, every text within its limit, on one line, without a question
 * id (the guide shows each id once, at its question) and without the personal data the shared
 * check finds (e-mail addresses, phone numbers, IBANs). A follow-up in the formal address is a
 * warning (`address-form`: the guide says „du“, owner decision 31 (2)).
 */
import { personalDataList, personalDataWarnings } from '@analyzr/contracts/personal-data';

import { parseStrictYaml } from '../yaml.ts';

export const NOTES_FORMAT = 'analyzr-guide-notes/1';

/** Largest notes file read (bytes). */
export const MAX_NOTES_BYTES = 256 * 1024;

export const LIMITS = {
  known: 50,
  knownChars: 200,
  landscapeChars: 300,
  followUps: 3,
  followUpChars: 200,
} as const;

/** The notes of one question. */
export interface QuestionNotes {
  landscape: string | null;
  followUps: string[];
}

export interface GuideNotes {
  /** The processes the landscape knows in this area (in the given order). */
  known: string[] | null;
  questions: ReadonlyMap<string, QuestionNotes>;
}

/** A problem of the notes file: the field path (or line and column) and what. */
export interface NotesProblem {
  path: string;
  code: string;
  message: string;
}

export interface CheckedNotes {
  notes: GuideNotes | null;
  errors: NotesProblem[];
  warnings: NotesProblem[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `Sie` and `Ihnen`, formal anywhere in a question to the interviewee (decision 31 (2)). */
const FORMAL = /\b(?:Sie|Ihnen)\b/;
/** `Ihr…`, formal inside a sentence (at its start it may be the informal plural „ihr“). */
const FORMAL_POSSESSIVE = /\b(?:Ihr|Ihre|Ihrem|Ihren|Ihrer|Ihres)\b/g;

/**
 * Whether `text`, a question to the interviewee, addresses someone formally: `Sie` or `Ihnen`
 * anywhere (at a sentence start, too, a follow-up's „Sie“ is the formal address far more often
 * than „they“; it is only a warning), `Ihr…` inside a sentence.
 */
export function formalAddress(text: string): boolean {
  if (FORMAL.test(text)) return true;
  for (const m of text.matchAll(FORMAL_POSSESSIVE)) {
    const before = text.slice(0, m.index).trimEnd();
    if (before === '' || /[.!?:„“"»«(–-]$/.test(before)) continue;
    return true;
  }
  return false;
}

/** A question id in a text (the guide shows each id once, at its question). */
const QUESTION_ID = /\bq-[0-9a-f]{16}\b/;

/**
 * Reads and checks a notes file's text against the guide's question ids.
 */
export function checkNotes(text: string, questionIds: ReadonlySet<string>): CheckedNotes {
  const parsed = parseStrictYaml(text, {
    maxBytes: MAX_NOTES_BYTES,
    tooLarge: (bytes) => ({
      path: '',
      code: 'notes-too-large',
      message: `${bytes} bytes; a notes file holds at most ${MAX_NOTES_BYTES}`,
    }),
    multipleDocs: 'more than one YAML document: write the notes as one document',
    parserMessages: true,
  });
  if (parsed.errors.length > 0) return { notes: null, errors: parsed.errors, warnings: [] };
  const errors: NotesProblem[] = [];
  const warnings: NotesProblem[] = [];
  const error = (path: string, code: string, message: string) =>
    errors.push({ path, code, message });
  const value = parsed.value;
  if (!isRecord(value)) {
    error('', 'notes-format', `not a mapping: start with "format: ${NOTES_FORMAT}"`);
    return { notes: null, errors, warnings };
  }
  for (const key of Object.keys(value)) {
    if (!['format', 'known', 'questions'].includes(key)) {
      error(key, 'notes-key', 'unknown key: a notes file has format, known and questions');
    }
  }
  if (value['format'] !== NOTES_FORMAT) {
    error('format', 'notes-format', `must be ${NOTES_FORMAT}`);
  }
  /** A checked text, or `null` (an error recorded). */
  const textAt = (v: unknown, path: string, max: number): string | null => {
    if (typeof v !== 'string') {
      error(path, 'notes-type', 'must be a text');
      return null;
    }
    const t = v.trim();
    if (t === '') error(path, 'notes-empty', 'must not be empty');
    else if (/[\r\n]/.test(t)) error(path, 'notes-line-break', 'one line only');
    else if ([...t].length > max) error(path, 'notes-too-long', `at most ${max} characters`);
    else if (QUESTION_ID.test(t)) {
      error(
        path,
        'notes-question-id',
        'names a question id: the guide shows each id at its question',
      );
    } else {
      const found = personalDataList(personalDataWarnings(t));
      if (found !== null) {
        error(path, 'notes-personal-data', `holds personal data (${found}): leave it out`);
      } else return t;
    }
    return null;
  };
  let known: string[] | null = null;
  if (value['known'] !== undefined) {
    const list = value['known'];
    if (!Array.isArray(list)) error('known', 'notes-type', 'must be a list of process names');
    else if (list.length > LIMITS.known) {
      error('known', 'notes-too-many', `at most ${LIMITS.known} names`);
    } else {
      known = [];
      list.forEach((v, i) => {
        const t = textAt(v, `known[${i}]`, LIMITS.knownChars);
        if (t !== null && !known?.includes(t)) known?.push(t);
      });
    }
  }
  const questions = new Map<string, QuestionNotes>();
  if (value['questions'] !== undefined) {
    const map = value['questions'];
    if (!isRecord(map)) error('questions', 'notes-type', 'must map question ids to notes');
    else {
      for (const [id, entry] of Object.entries(map)) {
        const at = `questions.${id}`;
        if (!questionIds.has(id)) {
          error(at, 'notes-unknown-question', 'no question of the chosen groups has this id');
          continue;
        }
        if (!isRecord(entry)) {
          error(at, 'notes-type', 'must be a mapping with landscape and followUps');
          continue;
        }
        for (const key of Object.keys(entry)) {
          if (key !== 'landscape' && key !== 'followUps') {
            error(
              `${at}.${key}`,
              'notes-key',
              'unknown key: a question has landscape and followUps',
            );
          }
        }
        const landscape =
          entry['landscape'] === undefined
            ? null
            : textAt(entry['landscape'], `${at}.landscape`, LIMITS.landscapeChars);
        const followUps: string[] = [];
        const list = entry['followUps'];
        if (list !== undefined) {
          if (!Array.isArray(list)) error(`${at}.followUps`, 'notes-type', 'must be a list');
          else if (list.length > LIMITS.followUps) {
            error(`${at}.followUps`, 'notes-too-many', `at most ${LIMITS.followUps} follow-ups`);
          } else {
            list.forEach((v, i) => {
              const path = `${at}.followUps[${i}]`;
              const t = textAt(v, path, LIMITS.followUpChars);
              if (t === null) return;
              if (formalAddress(t)) {
                warnings.push({
                  path,
                  code: 'address-form',
                  message: 'says „Sie“ or „Ihr…“: the guide addresses the interviewee with „du“',
                });
              }
              followUps.push(t);
            });
          }
        }
        questions.set(id, { landscape, followUps });
      }
    }
  }
  if (errors.length > 0) return { notes: null, errors, warnings };
  return { notes: { known, questions }, errors, warnings };
}

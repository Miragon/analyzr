/**
 * Answers to open questions (M6 §4.5 S5a, simplified by S5c-1, §4.8 b), the
 * pure part: where a note's text lands, how a stored row counts (a note or
 * an outside mark), the API view of a stored answer, and the check of a
 * filled-in sheet's rows against the current items. The use case
 * (`use-cases/open-questions.ts`) records what this lets through.
 */
import {
  MAX_ANSWER_CHARS,
  answerKindFromCell,
  hasControlCharacters,
  normalizeAnswerText,
  personalDataWarnings,
  type AnswerSheetResult,
  type AnswerSheetRowResult,
  type OpenQuestion,
  type OpenQuestionAnswer,
  type OpenQuestionAnswerKind,
  type OpenQuestionAnswerRole,
  type OpenQuestionAnswerTarget,
  type OpenQuestionSubject,
} from '@analyzr/contracts';

import type { StoredOpenQuestionAnswer } from '../ports.ts';

/**
 * Where the text of an answer on this subject lands (M6 §4.5 "Where the text
 * lands"): a human note on a relation or placement, else the answer row.
 */
export function answerTarget(subject: Pick<OpenQuestionSubject, 'type'>): OpenQuestionAnswerTarget {
  return subject.type === 'relation'
    ? 'relation-note'
    : subject.type === 'placement'
      ? 'placement-note'
      : 'answer';
}

/** Whether an item about this subject can carry an outside mark (never a relation or placement). */
export function markable(subject: Pick<OpenQuestionSubject, 'type'>): boolean {
  return answerTarget(subject) === 'answer';
}

/**
 * How a stored row counts since S5c-1 (§4.8 b): a row of kind
 * `outside-landscape` on a subject that is neither a relation nor a
 * placement is an outside mark; every other row is a note (S5a's kinds
 * `answer` and `will-be-modelled`, and its `outside-landscape` rows on a
 * relation or placement, which S5a stored as notes there).
 */
export function answerRole(a: {
  kind: OpenQuestionAnswerKind;
  subjectType: OpenQuestionSubject['type'];
}): OpenQuestionAnswerRole {
  return a.kind === 'outside-landscape' && markable({ type: a.subjectType })
    ? 'outside-mark'
    : 'note';
}

/** A stored answer as the API shows it. */
export function toOpenQuestionAnswer(a: StoredOpenQuestionAnswer): OpenQuestionAnswer {
  return {
    id: a.id,
    questionId: a.questionId,
    kind: a.kind,
    role: answerRole(a),
    target: answerTarget({ type: a.subjectType }),
    text: a.answerText,
    note:
      a.noteAssertionId === null || (a.subjectType !== 'relation' && a.subjectType !== 'placement')
        ? null
        : { type: a.subjectType, subjectId: a.subjectId, assertionId: a.noteAssertionId },
    by: a.handle,
    sourceKind: 'human',
    seq: a.seq,
    at: a.createdAt.toISOString(),
    withdrawal:
      a.withdrawal === null
        ? null
        : {
            by: a.withdrawal.handle,
            seq: a.withdrawal.seq,
            at: a.withdrawal.createdAt.toISOString(),
          },
  };
}

/** Whether an answer is an outside mark that still counts (not withdrawn). */
export function isLiveMark(a: Pick<OpenQuestionAnswer, 'role' | 'withdrawal'>): boolean {
  return a.role === 'outside-mark' && a.withdrawal === null;
}

/** The item's live outside mark (the oldest, if several), if any. */
export function liveMark(question: Pick<OpenQuestion, 'answers'>): OpenQuestionAnswer | undefined {
  return question.answers.find(isLiveMark);
}

/** The item's latest note, if any: the one the export's `Antwort` shows. */
export function latestNote(
  question: Pick<OpenQuestion, 'answers'>,
): OpenQuestionAnswer | undefined {
  return question.answers.findLast((a) => a.role === 'note');
}

/**
 * One answer to record: the current item, and a note (`answer`: its text,
 * normalized and valid) or an outside mark (`outside-landscape`: its
 * optional note, `null` without one).
 */
export type AnswerDraft =
  | { question: OpenQuestion; kind: 'answer'; text: string }
  | { question: OpenQuestion; kind: 'outside-landscape'; text: string | null };

/**
 * The answer that makes recording the draft a no-op (§4.8 b): for a note,
 * the item's latest note when its text is identical (going back to an
 * earlier note records it again, so it becomes the latest); for an outside
 * mark, a live mark of the item, whatever the latest note says.
 */
export function sameAnswer(draft: AnswerDraft): OpenQuestionAnswer | undefined {
  if (draft.kind === 'outside-landscape') return liveMark(draft.question);
  const latest = latestNote(draft.question);
  return latest?.text === draft.text ? latest : undefined;
}

/** The rows of a sheet as `POST …/open-questions/answers` takes them. */
export interface SheetRow {
  id: string;
  text: string;
  kind: string;
}

/** A sheet checked against the current items: the result without the stored answers, and what to record. */
export interface CheckedSheet {
  counts: AnswerSheetResult['counts'];
  rows: AnswerSheetRowResult[];
  /** The rows to record, in order, each with its result (for the stored answer). */
  record: { result: AnswerSheetRowResult; draft: AnswerDraft }[];
}

/**
 * Checks a filled-in sheet (M6 §4.5 "Bulk answers", §4.8 b) against the
 * current items, row by row: an empty answer is ignored (counted only); an
 * id that names no current item is `unknown` (also one whose source changed
 * since the export, which changed the id); a second row for an id, a text
 * over {@link MAX_ANSWER_CHARS} characters, control characters or an
 * unknown `Antwortart` are `invalid`. Every filled `Antwort` is a note,
 * except that S5a's `Antwortart` „Liegt außerhalb der Landschaft“ records
 * an outside mark with the text as its note on an item that can carry one
 * (on a relation or placement it is a note). A note identical to the item's
 * latest note, or a mark on an item a live mark marks, is `unchanged`; the
 * rest is `recorded`. Texts are normalized ({@link normalizeAnswerText});
 * every listed row carries the personal-data check's warnings.
 */
export function checkSheet(
  rows: readonly SheetRow[],
  items: ReadonlyMap<string, OpenQuestion>,
): CheckedSheet {
  const counts = { recorded: 0, unchanged: 0, unknown: 0, invalid: 0, ignored: 0 };
  const out: AnswerSheetRowResult[] = [];
  const record: CheckedSheet['record'] = [];
  const seen = new Set<string>();
  for (const [i, cells] of rows.entries()) {
    const text = normalizeAnswerText(cells.text);
    if (text === '') {
      counts.ignored++;
      continue;
    }
    const id = cells.id.trim();
    const result: AnswerSheetRowResult = {
      row: i + 1,
      id: cells.id,
      outcome: 'invalid',
      warnings: personalDataWarnings(text),
    };
    out.push(result);
    const question = items.get(id);
    const kind = answerKindFromCell(cells.kind);
    if (!question) result.outcome = 'unknown';
    else if (seen.has(id)) result.reason = 'duplicate-id';
    else if (text.length > MAX_ANSWER_CHARS) result.reason = 'too-long';
    else if (hasControlCharacters(text)) result.reason = 'control-characters';
    else if (kind === null) result.reason = 'unknown-kind';
    else {
      const draft: AnswerDraft =
        kind === 'outside-landscape' && markable(question.subject)
          ? { question, kind: 'outside-landscape', text }
          : { question, kind: 'answer', text };
      const same = sameAnswer(draft);
      result.outcome = same ? 'unchanged' : 'recorded';
      result.kind = draft.kind;
      result.target = answerTarget(question.subject);
      if (same) result.answer = same;
      else record.push({ result, draft });
    }
    if (question) seen.add(id);
    counts[result.outcome]++;
  }
  return { counts, rows: out, record };
}
